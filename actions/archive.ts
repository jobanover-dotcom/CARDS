'use server';

import { prisma, runTx } from '@/lib/prisma';
import { getCurrentUser } from './auth';
import { lockMRS } from '@/src/lib/poChain';
import { reconcileMRSCompletion } from '@/src/lib/poStatusReconcile';
import { createAdminSupabase } from '@/lib/supabase-server';
import { Prisma } from '@prisma/client';
import { archiveReportRows, type ArchiveRelatedData, type ArchiveSnapshot } from '@/src/lib/archiveReportRows';
import { REPORT_ORDER, type ReportType } from '@/src/lib/reports';

type PO = Prisma.PurchaseOrderGetPayload<object>;
type Req = Prisma.WarehouseRequestGetPayload<object>;

/**
 * Everything the delete cascade destroys that poData/requestData never held.
 *
 * MUST be read before the POs and requests are deleted: ReceivingRecord,
 * ReceivingDiscrepancy, PurchaseOrderMonitoringItem and PurchaseOrderReceipt all
 * carry ON DELETE CASCADE off PurchaseOrder, and RequestApprovalLog off
 * WarehouseRequest (prisma/schema.prisma lines 122, 152, 218, 265, 300). After
 * the delete there is nothing left to read, and the archive would hold the same
 * two tables it always did.
 *
 * Called INSIDE the same transaction as the delete so no receiving event can
 * land between the read and the cascade and be silently dropped from the
 * snapshot. Two extra round trips, not six: one per parent key, not per PO.
 *
 * `auditLog` is scoped to deliveryId null rows. DeliveryAuditLog also holds the
 * retired DEL-* delivery events, whose deliveryId points at a Delivery that is
 * itself cascade-deleted; those are archive-of-an-archive and out of scope here
 * (see the migration comment).
 */
async function readRelatedData(
  tx: Prisma.TransactionClient,
  poNumbers: string[],
  reqNumbers: string[],
): Promise<ArchiveRelatedData> {
  const [receivingRecords, discrepancies, auditLog, monitoringItems, receipts, approvalLogs] =
    await Promise.all([
      poNumbers.length
        ? tx.receivingRecord.findMany({ where: { poNumber: { in: poNumbers } } })
        : Promise.resolve([]),
      poNumbers.length
        ? tx.receivingDiscrepancy.findMany({ where: { poNumber: { in: poNumbers } } })
        : Promise.resolve([]),
      poNumbers.length
        ? tx.deliveryAuditLog.findMany({
            where: { poNumber: { in: poNumbers }, deliveryId: null },
          })
        : Promise.resolve([]),
      poNumbers.length
        ? tx.purchaseOrderMonitoringItem.findMany({ where: { poNumber: { in: poNumbers } } })
        : Promise.resolve([]),
      poNumbers.length
        ? tx.purchaseOrderReceipt.findMany({ where: { poNumber: { in: poNumbers } } })
        : Promise.resolve([]),
      reqNumbers.length
        ? tx.requestApprovalLog.findMany({ where: { reqNumber: { in: reqNumbers } } })
        : Promise.resolve([]),
    ]);
  return {
    receivingRecords: JSON.parse(JSON.stringify(receivingRecords)),
    discrepancies: JSON.parse(JSON.stringify(discrepancies)),
    auditLog: JSON.parse(JSON.stringify(auditLog)),
    monitoringItems: JSON.parse(JSON.stringify(monitoringItems)),
    receipts: JSON.parse(JSON.stringify(receipts)),
    approvalLogs: JSON.parse(JSON.stringify(approvalLogs)),
  };
}

const EMPTY_RELATED: ArchiveRelatedData = {
  receivingRecords: [],
  discrepancies: [],
  auditLog: [],
  monitoringItems: [],
  receipts: [],
  approvalLogs: [],
};

/**
 * The snapshot's related rows, or an empty set.
 *
 * Tolerant of an archive written before the column existed (null) AND of a blob
 * that is present but malformed. A restore is a recovery operation: it must not
 * fail halfway through because one field is the wrong shape, because a thrown
 * error rolls the whole transaction back and restores nothing at all.
 */
function relatedFrom(entry: { relatedData: unknown }): ArchiveRelatedData {
  const raw = entry.relatedData as Partial<Record<keyof ArchiveRelatedData, unknown>> | null;
  if (!raw || typeof raw !== 'object') return EMPTY_RELATED;
  const pick = (key: keyof ArchiveRelatedData) =>
    Array.isArray(raw[key]) ? (raw[key] as Array<Record<string, unknown>>) : [];
  return {
    receivingRecords: pick('receivingRecords'),
    discrepancies: pick('discrepancies'),
    auditLog: pick('auditLog'),
    monitoringItems: pick('monitoringItems'),
    receipts: pick('receipts'),
    approvalLogs: pick('approvalLogs'),
  };
}

async function assertElevated() {
  const user = await getCurrentUser();
  if (!user || user.role === 'Warehouse') {
    throw new Error('Unauthorized');
  }
  return user;
}

type LogInput = {
  warehouseName: string;
  action: 'archived' | 'restored' | 'downloaded';
  detail?: string;
  actor?: string | null;
};

async function logActivity(data: LogInput) {
  await prisma.archiveActivityLog.create({ data });
}

export async function getArchiveEntries() {
  await assertElevated();
  return prisma.warehouseArchive.findMany({
    orderBy: { clearedAt: 'desc' },
    select: {
      id: true,
      warehouseName: true,
      reason: true,
      clearedAt: true,
      poCount: true,
      requestCount: true,
    },
  });
}

export async function getArchiveActivity() {
  await assertElevated();
  return prisma.archiveActivityLog.findMany({
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
}

/**
 * The archive snapshot, shaped into the four report row sets.
 *
 * Shaping happens HERE rather than in the browser for the same reason the live
 * reports do (getReportRows in actions/procurement.ts): the archive download and
 * the dashboard export must be built by one code path, and a browser-side copy
 * is exactly the kind of duplication that lets a spreadsheet quietly disagree
 * with its own dashboard. It also means the raw poData/requestData/relatedData
 * blobs no longer cross the server-action wire on every download.
 */
export async function getArchiveReportRows(id: string): Promise<Record<ReportType, Record<string, unknown>[]>> {
  const user = await assertElevated();
  const entry = await prisma.warehouseArchive.findUnique({ where: { id } });
  if (!entry) throw new Error('Archive entry not found');

  const rows = archiveReportRows({
    warehouseName: entry.warehouseName,
    reason: entry.reason,
    clearedAt: entry.clearedAt,
    poData: entry.poData,
    requestData: entry.requestData,
    // Deliberately forwarded as-is, including null. A pre-upgrade archive never
    // captured the receiving history, and archiveReportRows() degrades those
    // cells to blanks rather than the caller having to know the difference.
    relatedData: entry.relatedData,
  } as ArchiveSnapshot);

  await logActivity({
    warehouseName: entry.warehouseName,
    action: 'downloaded',
    detail:
      `Downloaded ${entry.poCount} purchase order(s) and ${entry.requestCount} request(s) ` +
      `(${REPORT_ORDER.map((r) => rows[r].length).join('/')} rows per report)`,
    actor: user.username,
  });

  return rows;
}

/** The archive's own identifying detail, for the workbook subtitle. */
export async function getArchiveMeta(id: string) {
  await assertElevated();
  const entry = await prisma.warehouseArchive.findUnique({
    where: { id },
    select: { warehouseName: true, reason: true, clearedAt: true },
  });
  if (!entry) throw new Error('Archive entry not found');
  return entry;
}

/**
 * Put an archived purchase order and its related rows back, unchanged.
 *
 * Three deliberate departures from the obvious implementation, each one a bug it
 * fixes:
 *
 * 1. THE PRIMARY KEY IS PRESERVED. Item `id` is kept rather than regenerated,
 *    because ReceivingDiscrepancy, ReceivingRecord, PurchaseOrderMonitoringItem
 *    and PurchaseOrderReceipt all key on `poItemId`. Regenerating it would leave
 *    every restored related row pointing at a line that no longer exists — the
 *    rows would come back and silently attach to nothing.
 *
 * 2. `profileId` IS NULLED. deleteWarehouseWithArchive deletes the site's
 *    profiles AND their Supabase logins. Worse, resolvePoWarehouse() (pos.ts)
 *    forces every direct purchase order onto its creator's OWN warehouse, so a
 *    deleted warehouse's purchase orders all point at exactly those deleted
 *    profiles. Passing the archived value through is therefore not an edge case
 *    but a guaranteed foreign-key violation that aborts the whole transaction.
 *    Every other accountability column (requisitioner, listedBy, approvedBy,
 *    purchasedBy) is free text and restores verbatim; this one is a pointer to
 *    an identity record that no longer exists, so it cannot be honoured.
 *
 * 3. `itemId` IS NULLED WHEN THE CATALOG ENTRY IS GONE. Item is an optional
 *    relation with no explicit onDelete, so a deleted catalog row leaves a
 *    dangling id that would abort the insert.
 */
async function restorePurchaseOrder(
  tx: Prisma.TransactionClient,
  p: PO & { items?: any[] },
  related: ArchiveRelatedData,
  liveItemIds: Set<string>,
): Promise<void> {
  const { items, profileId: _profileId, ...poRest } = p as any;
  await tx.purchaseOrder.create({
    data: {
      ...poRest,
      profileId: null,
      // `poNumber` is re-derived from the parent, the only key an item carries
      // that would otherwise conflict.
      items: {
        create: (items || []).map(({ poNumber: _pn, ...itemRest }: any) => ({
          ...itemRest,
          itemId: liveItemIds.has(itemRest.itemId) ? itemRest.itemId : null,
        })),
      },
    },
  });

  const poNumber = p.poNumber;
  const itemIds = new Set((items || []).map((i: any) => i.id));
  const forPO = {
    receivingRecords: related.receivingRecords.filter((r) => r.poNumber === poNumber),
    discrepancies: related.discrepancies.filter((d) => d.poNumber === poNumber),
    auditLog: related.auditLog.filter((a) => a.poNumber === poNumber),
    monitoringItems: related.monitoringItems.filter((m) => m.poNumber === poNumber),
    receipts: related.receipts.filter((r) => r.poNumber === poNumber),
  };
  // A related row whose poItemId is not in THIS order's item set belongs to a
  // line that was never snapshotted (or a pre-upgrade archive). Re-inserting it
  // would produce a row attached to nothing, which is worse than not having it.
  const onThisPO = (r: { poItemId?: unknown }) =>
    typeof r.poItemId === 'string' && itemIds.has(r.poItemId);

  if (forPO.receivingRecords.length) {
    await tx.receivingRecord.createMany({
      data: forPO.receivingRecords.filter(onThisPO).map(stripId),
    });
  }
  if (forPO.discrepancies.length) {
    await tx.receivingDiscrepancy.createMany({
      data: forPO.discrepancies.filter(onThisPO).map(stripId),
    });
  }
  if (forPO.monitoringItems.length) {
    await tx.purchaseOrderMonitoringItem.createMany({
      data: forPO.monitoringItems.filter(onThisPO).map(stripId),
    });
  }
  if (forPO.receipts.length) {
    await tx.purchaseOrderReceipt.createMany({ data: forPO.receipts.map(stripId) });
  }
  if (forPO.auditLog.length) {
    // DeliveryAuditLog has no foreign key to PurchaseOrder — it is keyed on the
    // poNumber string alone — so these restore by string alone, no item id.
    await tx.deliveryAuditLog.createMany({ data: forPO.auditLog.map(stripId) });
  }
}

/** Drop the surrogate key so the database issues a fresh one; keep everything else. */
function stripId(row: Record<string, unknown>) {
  const { id: _id, ...rest } = row;
  return rest as any;
}

export async function restoreArchive(id: string) {
  const user = await assertElevated();
  const entry = await prisma.warehouseArchive.findUnique({ where: { id } });
  if (!entry) throw new Error('Archive entry not found');

  const pos = entry.poData as unknown as (PO & { items?: any[] })[];
  const reqs = entry.requestData as unknown as (Req & { items?: any[] })[];

  const uniquePos = Array.from(new Map(pos.map(p => [p.poNumber, p])).values());
  const uniqueReqs = Array.from(new Map(reqs.map(r => [r.reqNumber, r])).values());

  const result = await runTx(async (tx) => {
    const existingPoNumbers = new Set(
      (await tx.purchaseOrder.findMany({ where: { poNumber: { in: uniquePos.map(p => p.poNumber) } }, select: { poNumber: true } })).map(p => p.poNumber)
    );
    const existingReqNumbers = new Set(
      (await tx.warehouseRequest.findMany({ where: { reqNumber: { in: uniqueReqs.map(r => r.reqNumber) } }, select: { reqNumber: true } })).map(r => r.reqNumber)
    );

    // Catalogs that still exist. Archived itemId values pointing at rows deleted
    // since the archive was taken would abort the insert; dropping just those
    // keeps every line while never inventing a catalog link that is not there.
    const referencedItemIds = [
      ...new Set(
        [
          ...uniquePos.flatMap(p => (p.items || []).map((i: any) => i.itemId)),
          ...uniqueReqs.flatMap(r => (r.items || []).map((i: any) => i.itemId)),
        ].filter((v): v is string => typeof v === 'string' && v.length > 0),
      ),
    ];
    const liveItemIds = new Set(
      referencedItemIds.length
        ? (await tx.item.findMany({ where: { id: { in: referencedItemIds } }, select: { id: true } })).map(i => i.id)
        : [],
    );

    // An archive predating the relatedData column has none. It restores the two
    // tables it does hold and says nothing about the rest, which is honest: those
    // rows were never captured and cannot be recovered from here.
    const related = relatedFrom(entry);

    let restoredPOs = 0;
    for (const p of uniquePos) {
      if (existingPoNumbers.has(p.poNumber)) continue;
      await restorePurchaseOrder(tx, p, related, liveItemIds);
      restoredPOs++;
    }

    let restoredReqs = 0;
    for (const r of uniqueReqs) {
      if (existingReqNumbers.has(r.reqNumber)) continue;
      const { items, ...reqRest } = r as any;
      await tx.warehouseRequest.create({
        data: {
          ...reqRest,
          // `reqNumber` is re-derived from the parent; the key is the same.
          items: {
            create: (items || []).map(({ reqNumber: _rn, ...itemRest }: any) => ({
              ...itemRest,
              itemId: liveItemIds.has(itemRest.itemId) ? itemRest.itemId : null,
            })),
          },
        },
      });
      restoredReqs++;

      // Who approved or rejected each line, when, and why. Without these, a
      // rejected balance is indistinguishable from a never-decided one — which
      // is the entire reason RequestApprovalLog exists (prisma/schema.prisma
      // lines 292-296). Restored after the request so its foreign key resolves.
      const logs = related.approvalLogs.filter((a) => a.reqNumber === r.reqNumber);
      if (logs.length) await tx.requestApprovalLog.createMany({ data: logs.map(stripId) });
    }

    if (entry.reason === 'deleted') {
      await tx.warehouse.upsert({
        where: { name: entry.warehouseName },
        update: {},
        create: { name: entry.warehouseName },
      });
    }

    // Stated explicitly because an operator reading the log must be able to tell a
    // complete restore from a partial one. An archive predating the relatedData
    // column restores the two tables it holds and nothing else; saying so beats a
    // log line that implies the receiving history came back too.
    const hasRelated = entry.relatedData != null;

    await tx.archiveActivityLog.create({
      data: {
        warehouseName: entry.warehouseName,
        action: 'restored',
        detail: `Restored ${restoredPOs} purchase order(s) and ${restoredReqs} request(s)` +
          `${hasRelated
            ? `, with receiving history, discrepancies and approval records`
            : ` (archive predates the receiving-history snapshot, so it was not restored)`}` +
          `; skipped ${uniquePos.length - restoredPOs} duplicate PO(s) and ${uniqueReqs.length - restoredReqs} duplicate request(s)`,
        actor: user.username,
      },
    });

    // A restore recreates purchase orders AND their requests wholesale, so it can
    // move any requirement's allocation in either direction: a restored PO reserves
    // its share, and a restored request rewrites the `approvedQty` that seeds the
    // pool. Settle every affected requirement, both ways — a purchase order left
    // recorded as completed while owing units has silently left the queue that
    // would surface it. See src/lib/poStatusReconcile.ts.
    const affected = new Set<string>();
    for (const p of uniquePos) if (p.mrsNo) affected.add(p.mrsNo);
    for (const r of uniqueReqs) if (r.mrsNo) affected.add(r.mrsNo);
    // Sorted, so the MRS locks are always taken in the same order. A restore can
    // touch several requirements at once, and iterating a Set takes them in
    // insertion order — which depends on row order and can differ between two
    // restores over the same rows. Two transactions taking MRS-2 then MRS-1 and
    // MRS-1 then MRS-2 would deadlock. Sorting makes the order total.
    for (const mrsNo of [...affected].sort()) {
      await lockMRS(tx, mrsNo);
      await reconcileMRSCompletion(tx, mrsNo, user.username, 'both');
    }

    await tx.warehouseArchive.delete({ where: { id: entry.id } });

    return {
      restoredPOs,
      skippedPOs: uniquePos.length - restoredPOs,
      restoredReqs,
      skippedReqs: uniqueReqs.length - restoredReqs,
    };
  });

  return result;
}

/**
 * Destroying a warehouse is irreversible for its people: the POs and requests
 * move to the archive, but every Supabase login assigned to the site is DELETED
 * (lines below). That makes this the most privileged operation in the file, so
 * it uses an explicit Superadmin allow-list rather than `assertElevated()`.
 *
 * An allow-list, not "reject Warehouse": a deny-list admits any role string that
 * is not literally 'Warehouse', which would hand the capability to a future or
 * mistyped role.
 */
async function assertSuperadmin() {
  const user = await getCurrentUser();
  if (!user || user.role !== 'Superadmin') {
    throw new Error('Unauthorized: only the Superadmin can delete a warehouse');
  }
  return user;
}

export async function deleteWarehouseWithArchive(name: string) {
  // Authorization runs before the Supabase login deletions AND before the
  // transaction, so a refused caller destroys nothing.
  const user = await assertSuperadmin();

  const profiles = await prisma.profile.findMany({ where: { warehouse: name } });

  const supabase = await createAdminSupabase();
  for (const profile of profiles) {
    const { error } = await supabase.auth.admin.deleteUser(profile.id);
    if (error) {
      throw new Error(`Failed to delete login for ${profile.username}: ${error.message}. No changes were made.`);
    }
  }

  const { archivedPOs, archivedRequests, deletedUsers } = await runTx(async (tx) => {
    const pos = await tx.purchaseOrder.findMany({ where: { warehouse: name }, include: { items: true } });
    const reqs = await tx.warehouseRequest.findMany({ where: { warehouse: name }, include: { items: true } });
    // Read before the deletes below: every one of these tables cascades off its
    // parent, so after `deleteMany` there is nothing left to snapshot.
    const related = await readRelatedData(
      tx,
      pos.map(p => p.poNumber),
      reqs.map(r => r.reqNumber),
    );

    await tx.warehouseArchive.create({
      data: {
        warehouseName: name,
        reason: 'deleted',
        poCount: pos.length,
        requestCount: reqs.length,
        poData: JSON.parse(JSON.stringify(pos)),
        requestData: JSON.parse(JSON.stringify(reqs)),
        relatedData: related,
      },
    });
    await tx.purchaseOrder.deleteMany({ where: { warehouse: name } });
    await tx.warehouseRequest.deleteMany({ where: { warehouse: name } });
    await tx.profile.deleteMany({ where: { warehouse: name } });
    await tx.warehouse.delete({ where: { name } });

    await tx.archiveActivityLog.create({
      data: {
        warehouseName: name,
        action: 'archived',
        detail: `Warehouse deleted — archived ${pos.length} purchase order(s), ${reqs.length} request(s); removed ${profiles.length} assigned user(s) with their logins`,
        actor: user.username,
      },
    });

    return { archivedPOs: pos.length, archivedRequests: reqs.length, deletedUsers: profiles.length };
  });

  return { success: true, archivedPOs, archivedRequests, deletedUsers };
}

export async function deleteArchiveEntry(id: string) {
  const user = await assertElevated();
  if (user.role !== 'Superadmin') {
    throw new Error('Only Superadmin can permanently delete archive entries');
  }

  const entry = await prisma.warehouseArchive.findUnique({ where: { id } });
  if (!entry) throw new Error('Archive entry not found');

  const result = await runTx(async (tx) => {
    await tx.archiveActivityLog.deleteMany({ where: { warehouseName: entry.warehouseName } });
    await tx.warehouseArchive.delete({ where: { id: entry.id } });
  });

  await logActivity({
    warehouseName: entry.warehouseName,
    action: 'archived',
    detail: `Archive entry permanently deleted by Superadmin ${user.username}`,
    actor: user.username,
  });

  return { success: true, deletedWarehouse: entry.warehouseName };
}

export async function systemReset() {
  const user = await getCurrentUser();
  if (!user || user.role !== 'Superadmin') {
    throw new Error('Only the Superadmin can perform a system reset');
  }

  const warehouses = await prisma.warehouse.findMany({ orderBy: { name: 'asc' } });
  const whNames = warehouses.map(w => w.name);

  let clearedPOs = 0;
  let clearedRequests = 0;
  let archived = 0;

  for (const wh of warehouses) {
    const result = await runTx(async (tx) => {
      const pos = await tx.purchaseOrder.findMany({ where: { warehouse: wh.name }, include: { items: true } });
      const reqs = await tx.warehouseRequest.findMany({ where: { warehouse: wh.name }, include: { items: true } });
      if (pos.length === 0 && reqs.length === 0) return null;
      // Read before the deletes below: these tables cascade off their parents.
      const related = await readRelatedData(
        tx,
        pos.map(p => p.poNumber),
        reqs.map(r => r.reqNumber),
      );

      await tx.warehouseArchive.create({
        data: {
          warehouseName: wh.name,
          reason: 'reset',
          poCount: pos.length,
          requestCount: reqs.length,
          poData: JSON.parse(JSON.stringify(pos)),
          requestData: JSON.parse(JSON.stringify(reqs)),
          relatedData: related,
        },
      });
      await tx.purchaseOrder.deleteMany({ where: { warehouse: wh.name } });
      await tx.warehouseRequest.deleteMany({ where: { warehouse: wh.name } });

      await tx.archiveActivityLog.create({
        data: {
          warehouseName: wh.name,
          action: 'archived',
          detail: `System reset — archived ${pos.length} purchase order(s), ${reqs.length} request(s)`,
          actor: user.username,
        },
      });

      return { pos: pos.length, reqs: reqs.length };
    });

    if (result) {
      archived += 1;
      clearedPOs += result.pos;
      clearedRequests += result.reqs;
    }
  }

  const [orphanPos, orphanReqs] = await prisma.$transaction([
    prisma.purchaseOrder.findMany({ where: { OR: [{ warehouse: { notIn: whNames } }, { warehouse: null }] }, include: { items: true } }),
    prisma.warehouseRequest.findMany({ where: { OR: [{ warehouse: { notIn: whNames } }, { warehouse: null }] }, include: { items: true } }),
  ]);

  if (orphanPos.length > 0 || orphanReqs.length > 0) {
    await runTx(async (tx) => {
      // Read before the deletes below: these tables cascade off their parents.
      const related = await readRelatedData(
        tx,
        orphanPos.map(p => p.poNumber),
        orphanReqs.map(r => r.reqNumber),
      );
      await tx.warehouseArchive.create({
        data: {
          warehouseName: '(Unassigned records)',
          reason: 'reset',
          poCount: orphanPos.length,
          requestCount: orphanReqs.length,
          poData: JSON.parse(JSON.stringify(orphanPos)),
          requestData: JSON.parse(JSON.stringify(orphanReqs)),
          relatedData: related,
        },
      });
      const orphanIds = orphanPos.map(p => p.id);
      await tx.purchaseOrder.deleteMany({ where: { id: { in: orphanIds } } });
      const orphanReqIds = orphanReqs.map(r => r.id);
      await tx.warehouseRequest.deleteMany({ where: { id: { in: orphanReqIds } } });

      await tx.archiveActivityLog.create({
        data: {
          warehouseName: '(Unassigned records)',
          action: 'archived',
          detail: `System reset — archived ${orphanPos.length} purchase order(s), ${orphanReqs.length} request(s) not linked to any warehouse`,
          actor: user.username,
        },
      });
    });
    archived += 1;
    clearedPOs += orphanPos.length;
    clearedRequests += orphanReqs.length;
  }

  return { success: true, archived, clearedPOs, clearedRequests };
}
