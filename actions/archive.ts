'use server';

import { prisma } from '@/lib/prisma';
import { getCurrentUser } from './auth';
import { createAdminSupabase } from '@/lib/supabase-server';
import { Prisma } from '@prisma/client';

type PO = Prisma.PurchaseOrderGetPayload<object>;
type Req = Prisma.WarehouseRequestGetPayload<object>;

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

export async function recordArchiveDownload(id: string) {
  const user = await assertElevated();
  const entry = await prisma.warehouseArchive.findUnique({ where: { id } });
  if (!entry) throw new Error('Archive entry not found');

  await logActivity({
    warehouseName: entry.warehouseName,
    action: 'downloaded',
    detail: `Downloaded ${entry.poCount} purchase order(s) and ${entry.requestCount} request(s)`,
    actor: user.username,
  });

  return entry;
}

export async function restoreArchive(id: string) {
  const user = await assertElevated();
  const entry = await prisma.warehouseArchive.findUnique({ where: { id } });
  if (!entry) throw new Error('Archive entry not found');

  const pos = entry.poData as unknown as (PO & { items?: any[] })[];
  const reqs = entry.requestData as unknown as (Req & { items?: any[] })[];

  const uniquePos = Array.from(new Map(pos.map(p => [p.poNumber, p])).values());
  const uniqueReqs = Array.from(new Map(reqs.map(r => [r.reqNumber, r])).values());

  const result = await prisma.$transaction(async (tx) => {
    const existingPoNumbers = new Set(
      (await tx.purchaseOrder.findMany({ where: { poNumber: { in: uniquePos.map(p => p.poNumber) } }, select: { poNumber: true } })).map(p => p.poNumber)
    );
    const existingReqNumbers = new Set(
      (await tx.warehouseRequest.findMany({ where: { reqNumber: { in: uniqueReqs.map(r => r.reqNumber) } }, select: { reqNumber: true } })).map(r => r.reqNumber)
    );

    let restoredPOs = 0;
    for (const p of uniquePos) {
      if (existingPoNumbers.has(p.poNumber)) continue;
      const { id: _id, items, createdAt, updatedAt, ...rest } = p as any;
      await tx.purchaseOrder.create({
        data: {
          ...rest,
          items: {
            create: (items || []).map(({ id: _iid, poNumber: _pn, createdAt: _ic, ...itemRest }: any) => itemRest),
          },
        },
      });
      restoredPOs++;
    }

    let restoredReqs = 0;
    for (const r of uniqueReqs) {
      if (existingReqNumbers.has(r.reqNumber)) continue;
      const { id: _id, items, createdAt, updatedAt, ...rest } = r as any;
      await tx.warehouseRequest.create({
        data: {
          ...rest,
          items: {
            create: (items || []).map(({ id: _iid, reqNumber: _rn, createdAt: _ic, ...itemRest }: any) => itemRest),
          },
        },
      });
      restoredReqs++;
    }

    if (entry.reason === 'deleted') {
      await tx.warehouse.upsert({
        where: { name: entry.warehouseName },
        update: {},
        create: { name: entry.warehouseName },
      });
    }

    await tx.archiveActivityLog.create({
      data: {
        warehouseName: entry.warehouseName,
        action: 'restored',
        detail: `Restored ${restoredPOs} purchase order(s) and ${restoredReqs} request(s); skipped ${uniquePos.length - restoredPOs} duplicate PO(s) and ${uniqueReqs.length - restoredReqs} duplicate request(s)`,
        actor: user.username,
      },
    });

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

export async function deleteWarehouseWithArchive(name: string) {
  const user = await assertElevated();

  const profiles = await prisma.profile.findMany({ where: { warehouse: name } });

  const supabase = await createAdminSupabase();
  for (const profile of profiles) {
    const { error } = await supabase.auth.admin.deleteUser(profile.id);
    if (error) {
      throw new Error(`Failed to delete login for ${profile.username}: ${error.message}. No changes were made.`);
    }
  }

  const { archivedPOs, archivedRequests, deletedUsers } = await prisma.$transaction(async (tx) => {
    const pos = await tx.purchaseOrder.findMany({ where: { warehouse: name }, include: { items: true } });
    const reqs = await tx.warehouseRequest.findMany({ where: { warehouse: name }, include: { items: true } });

    await tx.warehouseArchive.create({
      data: {
        warehouseName: name,
        reason: 'deleted',
        poCount: pos.length,
        requestCount: reqs.length,
        poData: JSON.parse(JSON.stringify(pos)),
        requestData: JSON.parse(JSON.stringify(reqs)),
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

  const result = await prisma.$transaction(async (tx) => {
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
    const result = await prisma.$transaction(async (tx) => {
      const pos = await tx.purchaseOrder.findMany({ where: { warehouse: wh.name }, include: { items: true } });
      const reqs = await tx.warehouseRequest.findMany({ where: { warehouse: wh.name }, include: { items: true } });
      if (pos.length === 0 && reqs.length === 0) return null;

      await tx.warehouseArchive.create({
        data: {
          warehouseName: wh.name,
          reason: 'reset',
          poCount: pos.length,
          requestCount: reqs.length,
          poData: JSON.parse(JSON.stringify(pos)),
          requestData: JSON.parse(JSON.stringify(reqs)),
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
    await prisma.$transaction(async (tx) => {
      await tx.warehouseArchive.create({
        data: {
          warehouseName: '(Unassigned records)',
          reason: 'reset',
          poCount: orphanPos.length,
          requestCount: orphanReqs.length,
          poData: JSON.parse(JSON.stringify(orphanPos)),
          requestData: JSON.parse(JSON.stringify(orphanReqs)),
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
