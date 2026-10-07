'use server';

import { prisma, runTx } from '@/lib/prisma';
import type { Prisma } from '@prisma/client';
import { getCurrentUser } from './auth';
import {
  COMPLETED_STATUSES,
  DELIVERY_STATUS,
  IN_PROGRESS_LIFECYCLE_STATUSES,
  PO_STATUS,
  poLifecycle,
  poStatusLabel,
} from '@/src/lib/deliveryStatus';
import { isV1WorkflowPO } from '@/src/lib/poMigration';
import { mrsItemAllowanceOf, readMRSAggregates } from '@/src/lib/mrsRequirement';
import { deriveRequestApprovalStatus } from '@/src/lib/requestApproval';
import { createPOFromApprovedRequestSchema } from '@/src/lib/validations/request';

export interface POQuery { offset?: number; limit?: number; status?: string; statusIn?: string[]; poType?: string; poTypeIn?: string[]; search?: string; warehouse?: string; hasReceivingDiscrepancy?: boolean; }

function buildPOWhere(user: { role: string; warehouse: string } | null, params: POQuery = {}) {
  const scoped = user?.role === 'Warehouse'; const where: Record<string, unknown> = {};
  if (scoped) where.warehouse = user.warehouse; else if (params.warehouse) where.warehouse = params.warehouse;
  if (params.status) where.status = params.status; if (params.statusIn) where.status = { in: params.statusIn }; if (params.poType) where.poType = params.poType; if (params.poTypeIn) where.poType = { in: params.poTypeIn };
  // Historical receiving-discrepancy filter (archive only). Takes precedence
  // over the poType clause so filtered rows always match the reported count.
  const orClauses: Record<string, unknown>[] = [];
  if (params.hasReceivingDiscrepancy) orClauses.push({ OR: [{ poType: 'discrepancy' }, { deliveries: { some: { status: DELIVERY_STATUS.DISCREPANCY.value } } }] });
  if (params.search) orClauses.push({ OR: [{ poNumber: { contains: params.search, mode: 'insensitive' } }, { mrsNo: { contains: params.search, mode: 'insensitive' } }, { items: { some: { itemDescription: { contains: params.search, mode: 'insensitive' } } } }] });
  if (orClauses.length === 1) where.OR = (orClauses[0] as { OR: unknown }).OR;
  else if (orClauses.length > 1) where.AND = [...((where.AND as unknown[]) ?? []), ...orClauses];
  return where;
}
const poInclude = { items: { include: { monitoringItems: true } }, monitoringItems: true } as const;

/** Shape returned to the PO table so the UI never derives quantities itself. */
export interface PORow {
  poNumber: string;
  date: string;
  mrsNo: string;
  requisitioner: string;
  warehouse: string;
  supplier: string | null;
  status: string;
  statusLabel: string;
  poType: string;
  items: { id: string; itemDescription: string; qty: number; unit: string; purchasedQty: number | null; receivedQty: number }[];
}

export async function getPOs(params: POQuery = {}) {
  const user = await getCurrentUser(); if (!user) return { rows: [] as PORow[], total: 0 }; const where = buildPOWhere(user, params);
  // `total` counts PARENT PurchaseOrder records, and rows are parent records
  // too — joining items must never inflate either number.
  const [rows, total] = await prisma.$transaction([prisma.purchaseOrder.findMany({ where, include: poInclude, orderBy: { createdAt: 'desc' }, skip: params.offset ?? 0, take: params.limit ?? 10 }), prisma.purchaseOrder.count({ where })]);
  return { rows, total };
}
export async function getReportData(params: POQuery = {}) { const user = await getCurrentUser(); if (!user) throw new Error('Unauthorized'); return prisma.purchaseOrder.findMany({ where: buildPOWhere(user, params), include: poInclude, orderBy: { createdAt: 'desc' } }); }
export async function getPOByNumber(poNumber: string) { const user = await getCurrentUser(); if (!user) throw new Error('Unauthorized'); const po = await prisma.purchaseOrder.findUnique({ where: { poNumber }, include: poInclude }); if (!po) return null; if (user.role === 'Warehouse' && po.warehouse !== user.warehouse) throw new Error('Unauthorized'); return po; }

/**
 * Lifecycle counts over PARENT PurchaseOrder records.
 *
 * In Progress is defined by poLifecycle() semantics (canonical in_progress plus
 * the retired values still present on historical rows), so a card, its table
 * and the stored status can never disagree. Discrepancy counts are historical
 * archive reporting only and drive no card in the current workflow.
 */
export async function getPOStats(warehouse?: string) {
  const user = await getCurrentUser();
  const empty = { totalPOs: 0, completedPOs: 0, awaitingPurchaseCount: 0, inProgressCount: 0, unifiedDiscrepancyCount: 0 };
  if (!user) return empty;
  const base: Record<string, unknown> = {}; if (user.role === 'Warehouse') base.warehouse = user.warehouse; else if (warehouse) base.warehouse = warehouse;
  const [totalPOs, completedPOs, awaitingPurchaseCount, inProgressCount, legacyFlagged, deliveryFlagged] = await prisma.$transaction([
    prisma.purchaseOrder.count({ where: base }),
    prisma.purchaseOrder.count({ where: { ...base, status: { in: COMPLETED_STATUSES } } }),
    prisma.purchaseOrder.count({ where: { ...base, status: { in: ['awaiting_purchase'] } } }),
    prisma.purchaseOrder.count({ where: { ...base, status: { in: IN_PROGRESS_LIFECYCLE_STATUSES } } }),
    prisma.purchaseOrder.findMany({ where: { ...base, poType: 'discrepancy' }, select: { poNumber: true } }),
    prisma.delivery.findMany({ where: { ...(user.role === 'Warehouse' ? { po: { warehouse: user.warehouse } } : (warehouse ? { po: { warehouse } } : {})), status: DELIVERY_STATUS.DISCREPANCY.value }, select: { poNumber: true } }),
  ]);
  // Unioned by poNumber so a PO satisfying both arms is counted once.
  const unifiedDiscrepancyCount = new Set([...legacyFlagged.map((p) => p.poNumber), ...deliveryFlagged.map((d) => d.poNumber)]).size;
  return { totalPOs, completedPOs, awaitingPurchaseCount, inProgressCount, unifiedDiscrepancyCount };
}
export async function getMyPOCount() { const user = await getCurrentUser(); if (!user) return 0; return prisma.purchaseOrder.count({ where: { profileId: user.id } }); }

export interface POItemInput { itemDescription: string; qty: number; unit: string; }
// A PO is raised for an approved requirement. There is deliberately NO
// supplier here: the supplier belongs to the procurement act and is recorded
// when the purchaser saves purchase quantities (actions/procurement.ts).
type CreatePOData = { date: string; poNumber: string; items: POItemInput[]; requisitioner: string; mrsNo: string; poExpDate?: string; poRvdDate?: string; pickupBy?: string; plateNumber?: string; approvedBy?: string; listedBy?: string; notes?: string; warehouse: string; profileId?: string; };
function withPoDefaults(data: CreatePOData) { const { items, ...rest } = data; return { ...rest, status: PO_STATUS.AWAITING_PURCHASE.value, poType: 'active-delivery', statusLabel: poStatusLabel(PO_STATUS.AWAITING_PURCHASE.value) }; }
async function assertCanManagePOs() { const user = await getCurrentUser(); if (!user || (user.role !== 'Admin' && user.role !== 'Superadmin')) throw new Error('Unauthorized: only purchasers and superadmins can create purchase orders'); return user; }
function validateItems(items: POItemInput[]) { if (!Array.isArray(items) || !items.length) throw new Error('At least one item is required'); for (const item of items) { if (!item.itemDescription?.trim()) throw new Error('Every item needs a description'); if (!Number.isInteger(item.qty) || item.qty < 1) throw new Error('Every item quantity must be a positive whole number'); } }
function validateApprovedPOItems(requestItems: { itemDescription: string; qty: number; approvedQty: number | null; unit: string }[], poItems: POItemInput[]) { const requested = new Map(requestItems.map((i) => [i.itemDescription.trim().toLowerCase(), i])); for (const item of poItems) { const source = requested.get(item.itemDescription.trim().toLowerCase()); if (!source) throw new Error(`PO item "${item.itemDescription}" is not part of the source request`); const max = source.approvedQty ?? source.qty; if (item.qty > max) throw new Error(`PO quantity for "${item.itemDescription}" cannot exceed the approved quantity of ${max} ${source.unit}`); } }
async function ensureMonitoringRows(tx: Prisma.TransactionClient, poNumber: string, items: { id: string }[]) { for (const item of items) await tx.purchaseOrderMonitoringItem.upsert({ where: { poItemId: item.id }, create: { poNumber, poItemId: item.id, qtyReceived: 0 }, update: {} }); }

/**
 * A purchase order may only claim what its MATERIAL REQUEST still allows.
 *
 * validateApprovedPOItems() below caps a line against the approved quantity on
 * the request, which is the right ceiling for a single PO but says nothing about
 * the requirement's OTHER purchase orders. With MRS-001 approved 100 and a PO
 * already holding 60, raising another PO for 100 would buy 160 against a
 * requirement of 100. So the ceiling is the aggregate remainder across every PO on
 * the MRS — the same read the Follow-up Purchase action is guarded by, so the two
 * paths cannot disagree.
 *
 * No MRS number, or no approval behind it (a legacy manual PO), means there is no
 * requirement to cap against and the existing per-line check stands alone.
 */
async function assertWithinMRSAllowance(
  tx: Prisma.TransactionClient,
  mrsNo: string | undefined,
  items: { itemDescription: string; qty: number }[],
) {
  if (!mrsNo?.trim()) return;
  const aggregate = (await readMRSAggregates(tx, [mrsNo])).get(mrsNo);
  if (!aggregate || !aggregate.lines.length) return;
  const allowance = mrsItemAllowanceOf(aggregate);
  for (const item of items) {
    const line = allowance.get(item.itemDescription.trim().toLowerCase());
    // Unknown item: validateApprovedPOItems already rejects it when a request
    // exists. Here it simply does not constrain.
    if (!line) continue;
    if (item.qty > line.remaining)
      throw new Error(
        `Quantity for "${item.itemDescription}" cannot exceed the ${line.remaining} ${line.unit || 'unit(s)'} ` +
          `still outstanding on ${mrsNo} across its existing purchase orders`,
      );
  }
}

export async function createPO(data: CreatePOData) { await assertCanManagePOs(); validateItems(data.items); return runTx(async (tx) => { await assertWithinMRSAllowance(tx, data.mrsNo, data.items); const po = await tx.purchaseOrder.create({ data: { ...withPoDefaults(data), items: { create: data.items.map((i) => ({ itemDescription: i.itemDescription, qty: i.qty, unit: i.unit })) } }, include: { items: true } }); await ensureMonitoringRows(tx, po.poNumber, po.items); return po; }); }

export async function createPOWithApproval(data: CreatePOData, source: { reqNumber: string; itemApprovals?: { id: string; approvedQty: number }[] }) {
  await assertCanManagePOs(); validateItems(data.items);
  return runTx(async (tx) => {
    const req = await tx.warehouseRequest.findUnique({ where: { reqNumber: source.reqNumber }, include: { items: true } }); if (!req) throw new Error(`Source request ${source.reqNumber} not found`);
    const approvalMap = new Map((source.itemApprovals || []).map((a) => [a.id, a.approvedQty]));
    const effective = req.items.map((item) => ({ ...item, approvedQty: Math.max(0, Math.min(approvalMap.has(item.id) ? approvalMap.get(item.id)! : (item.approvedQty ?? item.qty), item.qty)) }));
    validateApprovedPOItems(effective, data.items);
    await assertWithinMRSAllowance(tx, data.mrsNo, data.items);
    const po = await tx.purchaseOrder.create({ data: { ...withPoDefaults(data), sourceReqNumber: source.reqNumber, items: { create: data.items.map((i) => ({ itemDescription: i.itemDescription, qty: i.qty, unit: i.unit })) } }, include: { items: true } });
    await ensureMonitoringRows(tx, po.poNumber, po.items);
    // Serialize approval writes on this request, so a concurrent Follow-up
    // Approval in the Request section cannot settle against the same stale
    // balance. Same lock the request actions take.
    await tx.$queryRaw`SELECT "reqNumber" FROM "WarehouseRequest" WHERE "reqNumber" = ${source.reqNumber} FOR UPDATE`;
    for (const item of req.items) {
      const raw = approvalMap.has(item.id) ? approvalMap.get(item.id)! : (item.approvedQty ?? item.qty);
      if (!Number.isInteger(raw) || raw < 0) throw new Error(`Approved quantity for "${item.itemDescription}" must be a whole number of 0 or more`);
      const approvedQty = Math.min(raw, item.qty);
      // Rejected quantity survives a PO being raised: a rejected line may still have
      // approved units to buy, and those units must not become rejected. Only a
      // LARGER approval absorbs the rejection, since both cannot hold the same unit.
      const rejectedQty = Math.min(item.rejectedQty ?? 0, Math.max(0, item.qty - approvedQty));
      await tx.warehouseRequestItem.update({ where: { id: item.id }, data: { approvedQty, rejectedQty } });
    }
    // Derived from the lines this transaction actually wrote, so a request with
    // rejected quantity cannot be flipped back to "Partially Approved" here.
    const settled = await tx.warehouseRequestItem.findMany({ where: { reqNumber: source.reqNumber } });
    await tx.warehouseRequest.update({ where: { reqNumber: source.reqNumber }, data: { status: deriveRequestApprovalStatus(settled, req.status) } }); return po;
  });
}

// ---------------------------------------------------------------------------
// Create a PO from a Follow-up Approval decision.
//
// Follow-up Approval settles `requested - approved - rejected` in the REQUEST
// section. This action is the second half of it: it raises a NEW purchase order
// for the quantity that approval just released, and hands it to the ordinary
// purchasing workflow.
//
// It is deliberately NOT createPOWithApproval. That action WRITES the approval —
// it is how a purchaser approves while raising a PO. Here the approval is already
// recorded, so writing it again would be at best redundant and at worst
// destructive: the form seeds quantities from the approval DELTA, and a second
// write would replace the approved total with that delta. Same reasoning as
// createFollowUpPO: "raising a follow-up adds no approval".
//
// It is also NOT createFollowUpPO. That one settles `approved - purchased` for
// the purchaser; this settles the approval the request section just resolved.
// Raising the pre-existing approved-but-unpurchased balance here would mix the two
// balances — that work belongs to Follow-up Purchase.
//
// The new PO stays on the parent MRS and keeps the source request link, so it
// groups under its parent in the MRS view exactly as a Follow-up Purchase does.
// ---------------------------------------------------------------------------

export async function createPOFromApprovedRequest(input: unknown) {
  const user = await assertCanManagePOs();
  // Validated at the boundary, like every other purchase mutation here.
  const data = createPOFromApprovedRequestSchema.parse(input);
  const poNumber = data.poNumber.trim();

  return runTx(async (tx) => {
    const req = await tx.warehouseRequest.findUnique({
      where: { reqNumber: data.reqNumber },
      include: { items: true },
    });
    if (!req) throw new Error(`Source request ${data.reqNumber} not found`);

    // Serialize on the MRS AND the request, then re-read. Every figure below is
    // computed from state read inside this transaction, never from what the
    // browser displayed.
    await tx.$queryRaw`SELECT "poNumber" FROM "PurchaseOrder" WHERE "mrsNo" = ${req.mrsNo} FOR UPDATE`;
    await tx.$queryRaw`SELECT "reqNumber" FROM "WarehouseRequest" WHERE "reqNumber" = ${data.reqNumber} FOR UPDATE`;

    const clash = await tx.purchaseOrder.findUnique({ where: { poNumber }, select: { poNumber: true } });
    if (clash) throw new Error(`Purchase order ${poNumber} already exists`);

    // How much APPROVAL this request has granted, per line, and how much of it
    // already has a purchase order.
    //
    // The cap is deliberately the unconsumed approval, NOT `approved - raised`.
    // Those differ: an earlier partial approval of 60 with a PO for 50 leaves 10
    // approved-but-never-raised units, and letting this PO absorb them would mix
    // the two balances — the request section settling procurement work that
    // belongs to Follow-up Purchase.
    //
    // The source of truth for "how much was approved" is RequestApprovalLog, not
    // approvedQty: approvedQty cannot tell a PO-raised approval from an
    // un-raised one. The matching half is the set of POs this action itself
    // created, identified by their own audit entry.
    const grantedByItem = new Map<string, number>();
    for (const entry of await tx.requestApprovalLog.findMany({
      where: { reqNumber: data.reqNumber, action: 'additional_approved' },
    })) {
      if (!entry.reqItemId) continue;
      grantedByItem.set(entry.reqItemId, (grantedByItem.get(entry.reqItemId) ?? 0) + entry.qty);
    }

    const raisedByApprovalPo = new Map<string, number>();
    const approvalPOs = await tx.deliveryAuditLog.findMany({
      where: { action: 'follow_up_approval_po_raised' },
      select: { poNumber: true },
    });
    for (const { poNumber } of approvalPOs) {
      const po = await tx.purchaseOrder.findUnique({
        where: { poNumber },
        include: { items: true },
      });
      // A cancelled PO is no longer a claim on the approval, so it frees the
      // quantity to be raised again.
      if (!po || poLifecycle(po.status) === PO_STATUS.CANCELLED.value) continue;
      if (po.sourceReqNumber !== data.reqNumber) continue;
      for (const item of po.items) {
        const key = item.itemDescription.trim().toLowerCase();
        raisedByApprovalPo.set(key, (raisedByApprovalPo.get(key) ?? 0) + item.qty);
      }
    }

    const aggregate = (await readMRSAggregates(tx, [req.mrsNo])).get(req.mrsNo);
    const allowance = mrsItemAllowanceOf(aggregate);

    const lines: { itemDescription: string; unit: string; qty: number }[] = [];
    for (const entry of data.items) {
      if (!Number.isInteger(entry.qty) || entry.qty < 1) {
        throw new Error(`Quantity for "${entry.id}" must be a positive whole number`);
      }
      // Keyed by request ITEM ID, not description. A description can appear twice
      // on a request; an id cannot be ambiguous.
      const source = req.items.find((i) => i.id === entry.id);
      if (!source) throw new Error(`Item ${entry.id} is not part of request ${data.reqNumber}`);

      const approved = source.approvedQty ?? 0;
      if (entry.qty > approved) {
        throw new Error(
          `Quantity for "${source.itemDescription}" cannot exceed the approved ${approved} ${source.unit} on request ${data.reqNumber}`,
        );
      }

      const key = source.itemDescription.trim().toLowerCase();
      const granted = grantedByItem.get(source.id) ?? 0;
      const alreadyRaised = raisedByApprovalPo.get(key) ?? 0;
      const unconsumed = Math.max(0, granted - alreadyRaised);
      const purchasable = allowance.get(key)?.remaining ?? 0;
      // Two independent ceilings. The approval one keeps this action from buying
      // work it was not granted; the procurement one keeps it from claiming the
      // same units twice. Neither is implied by the other: granted-but-already-
      // bought is 0 unconsumed yet still has procurement room.
      const cap = Math.min(unconsumed, purchasable);
      if (entry.qty > cap) {
        throw new Error(
          unconsumed <= 0
            ? `The approval for "${source.itemDescription}" already has a purchase order covering it. Nothing further can be raised for it from request ${data.reqNumber}.`
            : `Quantity for "${source.itemDescription}" cannot exceed the ${cap} ${source.unit || 'unit(s)'} approved and not yet raised on ${req.mrsNo} — ${unconsumed} still unraised and ${purchasable} still unpurchased.`,
        );
      }

      raisedByApprovalPo.set(key, alreadyRaised + entry.qty);
      lines.push({ itemDescription: source.itemDescription, unit: source.unit, qty: entry.qty });
    }

    // The requirement, not the caller, decides the MRS and the warehouse. The
    // approval belongs to this request, so the PO it buys must sit on this MRS.
    const po = await tx.purchaseOrder.create({
      data: {
        ...withPoDefaults({
          date: data.date,
          poNumber,
          items: lines,
          requisitioner: req.requisitioner,
          mrsNo: req.mrsNo,
          poExpDate: data.poExpDate,
          poRvdDate: data.poRvdDate,
          pickupBy: data.pickupBy,
          plateNumber: data.plateNumber,
          approvedBy: req.requestedBy || data.approvedBy,
          listedBy: data.listedBy,
          notes: data.notes,
          // The request owns the warehouse; the caller cannot redirect an
          // approval to a different one.
          warehouse: req.warehouse ?? '',
          profileId: data.profileId,
        }),
        sourceReqNumber: data.reqNumber,
        items: { create: lines.map((l) => ({ itemDescription: l.itemDescription, qty: l.qty, unit: l.unit })) },
      },
      include: { items: true },
    });
    await ensureMonitoringRows(tx, po.poNumber, po.items);

    // Same log createFollowUpPO uses, so the new PO carries its own history entry
    // and the approval it fulfils is traceable from the PO as well as the request.
    await tx.deliveryAuditLog.create({
      data: {
        deliveryId: null,
        poNumber,
        action: 'follow_up_approval_po_raised',
        detail: `Raised for ${req.mrsNo} from approval on ${data.reqNumber}: ${lines
          .map((l) => `${l.itemDescription} ${l.qty} ${l.unit}`)
          .join('; ')}`,
        actor: user.username,
      },
    });

    return po;
  });
}

export interface MonitoringUpdate { items: { poItemId: string; qtyReceived: number }[]; deliveredBy: string; plateNumber: string; dateDelivered: string; referenceNo: string; drDate: string; remarks?: string; markAsDiscrepancy?: boolean; }
// Guard: the legacy single-shot receiving path must never touch a PO owned by
// the current procurement workflow. Such POs are managed by
// actions/procurement.ts (savePurchase / recordReceiving); a legacy write
// would bypass quantities and the lifecycle entirely.
function assertLegacyPO(po: { status: string; items: { purchasedQty: number | null }[] } & { _count?: { deliveries: number } }) {
  if (isV1WorkflowPO(po)) throw new Error('This purchase order uses the procurement workflow and cannot be updated through the legacy path');
}
/**
 * @deprecated Legacy single-shot receiving, retained only for pre-procurement
 * records that never entered the current workflow. Current workflow:
 * actions/procurement.ts (savePurchase → recordReceiving).
 */
export async function updatePOMonitoring(poNumber: string, monitoring: MonitoringUpdate) {
  const user = await getCurrentUser(); if (!user || user.role !== 'Warehouse') throw new Error('Unauthorized: only warehouse users can record delivery monitoring');
  if (!monitoring.deliveredBy?.trim()) throw new Error('Delivered By is required'); if (!monitoring.plateNumber?.trim()) throw new Error('Plate Number is required'); if (!monitoring.dateDelivered) throw new Error('Date delivered is required'); if (!monitoring.referenceNo?.trim()) throw new Error('Reference No. is required'); if (!monitoring.drDate) throw new Error('DR date is required');
  return runTx(async (tx) => {
    const po = await tx.purchaseOrder.findUnique({ where: { poNumber }, include: { items: true, _count: { select: { deliveries: true } } } }); if (!po) throw new Error('Purchase order not found'); if (po.warehouse !== user.warehouse) throw new Error('Unauthorized');
    assertLegacyPO(po);
    if (!Array.isArray(monitoring.items) || monitoring.items.length !== po.items.length) throw new Error('Every PO item must have a received quantity');
    const inputMap = new Map(monitoring.items.map((i) => [i.poItemId, i.qtyReceived])); let totalOrdered = 0; let totalReceived = 0; let anyShortfall = false;
    for (const item of po.items) { const raw = inputMap.get(item.id); if (!Number.isInteger(raw) || raw < 0) throw new Error(`Received quantity for "${item.itemDescription}" must be a whole number of 0 or more`); if (raw > item.qty) throw new Error(`Received quantity for "${item.itemDescription}" cannot exceed ${item.qty} ${item.unit}`); totalOrdered += item.qty; totalReceived += raw; if (raw < item.qty) anyShortfall = true; await tx.purchaseOrderMonitoringItem.upsert({ where: { poItemId: item.id }, create: { poNumber, poItemId: item.id, qtyReceived: raw }, update: { qtyReceived: raw } }); }
    const discrepancy = !!monitoring.markAsDiscrepancy; if (discrepancy && !monitoring.remarks?.trim()) throw new Error('Discrepancy remarks are required before saving this PO'); const incomplete = discrepancy || anyShortfall;
    // Status follows the canonical lifecycle: this legacy path keeps
    // 'incomplete' for open records (read back through poLifecycle as In
    // Progress) and 'completed' once fully received.
    const updated = await tx.purchaseOrder.update({ where: { poNumber }, data: { status: incomplete ? 'incomplete' : PO_STATUS.COMPLETED.value, poType: discrepancy ? 'discrepancy' : (anyShortfall ? 'partially-received' : 'completed'), statusLabel: poStatusLabel(incomplete ? 'incomplete' : PO_STATUS.COMPLETED.value), poExpDate: monitoring.dateDelivered, monDeliveredBy: monitoring.deliveredBy.trim(), monPlateNumber: monitoring.plateNumber.trim(), monDateDelivered: monitoring.dateDelivered, monReferenceNo: monitoring.referenceNo.trim(), monDrDate: monitoring.drDate, monRemarks: monitoring.remarks?.trim() || null, notes: monitoring.remarks?.trim() || po.notes }, include: poInclude });
    return { po: updated, totalOrdered, totalReceived, anyShortfall };
  });
}

export async function updatePO(poNumber: string, data: Partial<{ status: string; poType: string; statusLabel: string; items: POItemInput[]; pickupBy: string; poExpDate: string; supplierAddress: string; notes: string; monQtyRvd: string; monDeliveredBy: string; monPlateNumber: string; monDateDelivered: string; monReferenceNo: string; monDrDate: string; monRemarks: string; }>) {
  const user = await getCurrentUser(); if (!user) throw new Error('Unauthorized'); const { items, ...rest } = data;
  // Hardened generic patch: status/poType/statusLabel and item replacement are
  // legacy-only capabilities. On procurement-workflow POs they would bypass the
  // savePurchase / recordReceiving chain (and item replacement would
  // cascade-delete DeliveryItem archive history), so they are rejected here.
  const touchesWorkflow = data.status !== undefined || data.poType !== undefined || data.statusLabel !== undefined || items !== undefined;
  if (touchesWorkflow) {
    const po = await prisma.purchaseOrder.findUnique({ where: { poNumber }, include: { items: { select: { purchasedQty: true } }, _count: { select: { deliveries: true } } } });
    if (!po) throw new Error('Purchase order not found');
    if (user.role === 'Warehouse' && po.warehouse !== user.warehouse) throw new Error('Unauthorized');
    try {
      assertLegacyPO({ status: po.status, items: po.items, _count: po._count });
    } catch {
      throw new Error('This purchase order uses the procurement workflow; update it through savePurchase / recordReceiving instead');
    }
    if (items !== undefined && po._count.deliveries > 0) throw new Error('PO items cannot be replaced once deliveries exist');
  }
  if (items) return runTx(async (tx) => { const existing = await tx.purchaseOrder.findUnique({ where: { poNumber }, include: { items: true } }); if (!existing) throw new Error('Purchase order not found'); await tx.purchaseOrderItem.deleteMany({ where: { poNumber } }); const newItems = await Promise.all(items.map((i) => { validateItems([i]); return tx.purchaseOrderItem.create({ data: { poNumber, itemDescription: i.itemDescription, qty: i.qty, unit: i.unit } }); })); await tx.purchaseOrder.update({ where: { poNumber }, data: rest }); await ensureMonitoringRows(tx, poNumber, newItems); return tx.purchaseOrder.findUnique({ where: { poNumber }, include: poInclude }); });
  return prisma.purchaseOrder.update({ where: { poNumber }, data: rest, include: poInclude });
}
async function assertCanDeletePOs() { const user = await getCurrentUser(); if (!user || user.role !== 'Superadmin') throw new Error('Unauthorized: only superadmin can delete purchase orders'); return user; }
export async function deletePO(poNumber: string) {
  await assertCanDeletePOs();
  // DeliveryAuditLog references a PO by poNumber with no foreign key, so a bare
  // delete would orphan the purchase and receiving history. Remove it in the
  // same transaction so a deleted PO leaves no dangling audit rows.
  return runTx(async (tx) => {
    await tx.deliveryAuditLog.deleteMany({ where: { poNumber } });
    return tx.purchaseOrder.delete({ where: { poNumber } });
  });
}
