'use server';

import { prisma } from '@/lib/prisma';
import type { Prisma } from '@prisma/client';
import { getCurrentUser } from './auth';
import { PO_STATUS, DELIVERY_STATUS, poStatusLabel } from '@/src/lib/deliveryStatus';
import { isV1WorkflowPO } from '@/src/lib/poMigration';

export interface POQuery { offset?: number; limit?: number; status?: string; statusIn?: string[]; poType?: string; poTypeIn?: string[]; search?: string; warehouse?: string; inProcess?: boolean; hasReceivingDiscrepancy?: boolean; }

function buildPOWhere(user: { role: string; warehouse: string } | null, params: POQuery = {}) {
  const scoped = user?.role === 'Warehouse'; const where: Record<string, unknown> = {};
  if (scoped) where.warehouse = user.warehouse; else if (params.warehouse) where.warehouse = params.warehouse;
  if (params.status) where.status = params.status; if (params.statusIn) where.status = { in: params.statusIn }; if (params.poType) where.poType = params.poType; if (params.poTypeIn) where.poType = { in: params.poTypeIn };
  // Unified receiving-discrepancy filter: legacy-flagged POs OR POs with a
  // discrepancy delivery. Takes precedence over the poType clause above so
  // filtered rows always match the unifiedDiscrepancyCount.
  const orClauses: Record<string, unknown>[] = [];
  if (params.hasReceivingDiscrepancy) orClauses.push({ OR: [{ poType: 'discrepancy' }, { deliveries: { some: { status: DELIVERY_STATUS.DISCREPANCY.value } } }] });
  if (params.search) orClauses.push({ OR: [{ poNumber: { contains: params.search, mode: 'insensitive' } }, { items: { some: { itemDescription: { contains: params.search, mode: 'insensitive' } } } }] });
  if (orClauses.length === 1) where.OR = (orClauses[0] as { OR: unknown }).OR;
  else if (orClauses.length > 1) where.AND = [...((where.AND as unknown[]) ?? []), ...orClauses];
  if (params.inProcess) where.AND = [...((where.AND as unknown[]) ?? []), { status: 'incomplete' }, { poType: 'active-delivery' }];
  return where;
}
const poInclude = { items: { include: { monitoringItems: true } }, monitoringItems: true } as const;

export async function getPOs(params: POQuery = {}) {
  const user = await getCurrentUser(); if (!user) return { rows: [], total: 0 }; const where = buildPOWhere(user, params);
  const [rows, total] = await prisma.$transaction([prisma.purchaseOrder.findMany({ where, include: poInclude, orderBy: { createdAt: 'desc' }, skip: params.offset ?? 0, take: params.limit ?? 10 }), prisma.purchaseOrder.count({ where })]);
  return { rows, total };
}
export async function getReportData(params: POQuery = {}) { const user = await getCurrentUser(); if (!user) throw new Error('Unauthorized'); return prisma.purchaseOrder.findMany({ where: buildPOWhere(user, params), include: poInclude, orderBy: { createdAt: 'desc' } }); }
export async function getPOByNumber(poNumber: string) { const user = await getCurrentUser(); if (!user) throw new Error('Unauthorized'); const po = await prisma.purchaseOrder.findUnique({ where: { poNumber }, include: poInclude }); if (!po) return null; if (user.role === 'Warehouse' && po.warehouse !== user.warehouse) throw new Error('Unauthorized'); return po; }

export async function getPOStats(warehouse?: string) {
  const user = await getCurrentUser(); if (!user) return { totalPOs: 0, completedPOs: 0, incompletePOs: 0, activeDeliveryCount: 0, discrepancyCount: 0, activeDeliveryIncompleteCount: 0, partiallyReceivedCount: 0, inProgressCount: 0, unifiedDiscrepancyCount: 0 };
  const base: Record<string, unknown> = {}; if (user.role === 'Warehouse') base.warehouse = user.warehouse; else if (warehouse) base.warehouse = warehouse;
  // inProgressCount is the canonical procurement-workload stat: every PO not
  // in a terminal state, regardless of legacy or unified workflow. It never
  // uses poType as workflow state.
  const inProgressWhere = { ...base, status: { notIn: [PO_STATUS.COMPLETED.value, PO_STATUS.CANCELLED.value] } };
  const [totalPOs, completedPOs, incompletePOs, activeDeliveryCount, discrepancyCount, activeDeliveryIncompleteCount, partiallyReceivedCount, inProgressCount] = await prisma.$transaction([
    prisma.purchaseOrder.count({ where: base }), prisma.purchaseOrder.count({ where: { ...base, status: 'completed' } }), prisma.purchaseOrder.count({ where: { ...base, status: 'incomplete' } }), prisma.purchaseOrder.count({ where: { ...base, poType: 'active-delivery' } }), prisma.purchaseOrder.count({ where: { ...base, poType: 'discrepancy' } }), prisma.purchaseOrder.count({ where: { ...base, status: 'incomplete', poType: 'active-delivery' } }), prisma.purchaseOrder.count({ where: { ...base, status: 'incomplete', poType: 'partially-received' } }), prisma.purchaseOrder.count({ where: inProgressWhere }),
  ]);
  // unifiedDiscrepancyCount is the canonical receiving-discrepancy stat: the
  // union of legacy-flagged POs and POs with a discrepancy delivery.
  // Approval/procurement shortfalls and plain outstanding balances are NOT
  // discrepancies and are excluded by construction. Unioned by poNumber so a
  // PO satisfying both arms is counted once.
  const [legacyFlagged, deliveryFlagged] = await prisma.$transaction([
    prisma.purchaseOrder.findMany({ where: { ...base, poType: 'discrepancy' }, select: { poNumber: true } }),
    prisma.delivery.findMany({ where: { ...(user.role === 'Warehouse' ? { po: { warehouse: user.warehouse } } : (warehouse ? { po: { warehouse } } : {})), status: DELIVERY_STATUS.DISCREPANCY.value }, select: { poNumber: true } }),
  ]);
  const unifiedDiscrepancyCount = new Set([...legacyFlagged.map((p) => p.poNumber), ...deliveryFlagged.map((d) => d.poNumber)]).size;
  return { totalPOs, completedPOs, incompletePOs, activeDeliveryCount, discrepancyCount, activeDeliveryIncompleteCount, partiallyReceivedCount, inProgressCount, unifiedDiscrepancyCount };
}
export async function getMyPOCount() { const user = await getCurrentUser(); if (!user) return 0; return prisma.purchaseOrder.count({ where: { profileId: user.id } }); }

export interface POItemInput { itemDescription: string; qty: number; unit: string; }
type CreatePOData = { date: string; poNumber: string; items: POItemInput[]; supplier: string; supplierAddress?: string; requisitioner: string; mrsNo: string; poExpDate?: string; poRvdDate?: string; pickupBy?: string; plateNumber?: string; approvedBy?: string; listedBy?: string; notes?: string; warehouse: string; profileId?: string; };
function withPoDefaults(data: CreatePOData) { const { items, ...rest } = data; return { ...rest, status: PO_STATUS.AWAITING_PURCHASE.value, poType: 'active-delivery', statusLabel: poStatusLabel(PO_STATUS.AWAITING_PURCHASE.value) }; }
async function assertCanManagePOs() { const user = await getCurrentUser(); if (!user || (user.role !== 'Admin' && user.role !== 'Superadmin')) throw new Error('Unauthorized: only purchasers and superadmins can create purchase orders'); return user; }
function validateItems(items: POItemInput[]) { if (!Array.isArray(items) || !items.length) throw new Error('At least one item is required'); for (const item of items) { if (!item.itemDescription?.trim()) throw new Error('Every item needs a description'); if (!Number.isInteger(item.qty) || item.qty < 1) throw new Error('Every item quantity must be a positive whole number'); } }
function validateApprovedPOItems(requestItems: { itemDescription: string; qty: number; approvedQty: number | null; unit: string }[], poItems: POItemInput[]) { const requested = new Map(requestItems.map((i) => [i.itemDescription.trim().toLowerCase(), i])); for (const item of poItems) { const source = requested.get(item.itemDescription.trim().toLowerCase()); if (!source) throw new Error(`PO item "${item.itemDescription}" is not part of the source request`); const max = source.approvedQty ?? source.qty; if (item.qty > max) throw new Error(`PO quantity for "${item.itemDescription}" cannot exceed the approved quantity of ${max} ${source.unit}`); } }
async function ensureMonitoringRows(tx: Prisma.TransactionClient, poNumber: string, items: { id: string }[]) { for (const item of items) await tx.purchaseOrderMonitoringItem.upsert({ where: { poItemId: item.id }, create: { poNumber, poItemId: item.id, qtyReceived: 0 }, update: {} }); }

export async function createPO(data: CreatePOData) { await assertCanManagePOs(); validateItems(data.items); return prisma.$transaction(async (tx) => { const po = await tx.purchaseOrder.create({ data: { ...withPoDefaults(data), items: { create: data.items.map((i) => ({ itemDescription: i.itemDescription, qty: i.qty, unit: i.unit })) } }, include: { items: true } }); await ensureMonitoringRows(tx, po.poNumber, po.items); return po; }); }

export async function createPOWithApproval(data: CreatePOData, source: { reqNumber: string; itemApprovals?: { id: string; approvedQty: number }[] }) {
  await assertCanManagePOs(); validateItems(data.items);
  return prisma.$transaction(async (tx) => {
    const req = await tx.warehouseRequest.findUnique({ where: { reqNumber: source.reqNumber }, include: { items: true } }); if (!req) throw new Error(`Source request ${source.reqNumber} not found`);
    const approvalMap = new Map((source.itemApprovals || []).map((a) => [a.id, a.approvedQty]));
    const effective = req.items.map((item) => ({ ...item, approvedQty: Math.max(0, Math.min(approvalMap.has(item.id) ? approvalMap.get(item.id)! : (item.approvedQty ?? item.qty), item.qty)) }));
    validateApprovedPOItems(effective, data.items);
    const po = await tx.purchaseOrder.create({ data: { ...withPoDefaults(data), sourceReqNumber: source.reqNumber, items: { create: data.items.map((i) => ({ itemDescription: i.itemDescription, qty: i.qty, unit: i.unit })) } }, include: { items: true } });
    await ensureMonitoringRows(tx, po.poNumber, po.items);
    let allFull = true; for (const item of req.items) { const raw = approvalMap.has(item.id) ? approvalMap.get(item.id)! : (item.approvedQty ?? item.qty); if (!Number.isInteger(raw) || raw < 0) throw new Error(`Approved quantity for "${item.itemDescription}" must be a whole number of 0 or more`); const approvedQty = Math.min(raw, item.qty); if (approvedQty < item.qty) allFull = false; await tx.warehouseRequestItem.update({ where: { id: item.id }, data: { approvedQty } }); }
    await tx.warehouseRequest.update({ where: { reqNumber: source.reqNumber }, data: { status: allFull ? 'Approved' : 'Partially Approved' } }); return po;
  });
}

export interface MonitoringUpdate { items: { poItemId: string; qtyReceived: number }[]; deliveredBy: string; plateNumber: string; dateDelivered: string; referenceNo: string; drDate: string; remarks?: string; markAsDiscrepancy?: boolean; }
// V1 guard: the legacy single-shot paths must never touch a PO that entered
// the procurement → delivery → receiving workflow. Such POs are owned by
// actions/deliveries.ts; legacy writes would bypass quantities, statuses,
// and delivery history.
function assertLegacyPO(po: { status: string; items: { purchasedQty: number | null }[] } & { _count?: { deliveries: number } }) {
  if (isV1WorkflowPO(po)) throw new Error('This purchase order uses the delivery workflow and cannot be updated through the legacy path');
}
/** @deprecated Legacy single-shot receiving for pre-V1 records only. New workflow: actions/deliveries.ts (confirmPurchase → markReadyForDelivery → proceedToDelivery → confirmReceiving). */
export async function updatePOMonitoring(poNumber: string, monitoring: MonitoringUpdate) {
  const user = await getCurrentUser(); if (!user || user.role !== 'Warehouse') throw new Error('Unauthorized: only warehouse users can record delivery monitoring');
  if (!monitoring.deliveredBy?.trim()) throw new Error('Delivered By is required'); if (!monitoring.plateNumber?.trim()) throw new Error('Plate Number is required'); if (!monitoring.dateDelivered) throw new Error('Date delivered is required'); if (!monitoring.referenceNo?.trim()) throw new Error('Reference No. is required'); if (!monitoring.drDate) throw new Error('DR date is required');
  return prisma.$transaction(async (tx) => {
    const po = await tx.purchaseOrder.findUnique({ where: { poNumber }, include: { items: true, _count: { select: { deliveries: true } } } }); if (!po) throw new Error('Purchase order not found'); if (po.warehouse !== user.warehouse) throw new Error('Unauthorized');
    assertLegacyPO(po);
    if (!Array.isArray(monitoring.items) || monitoring.items.length !== po.items.length) throw new Error('Every PO item must have a received quantity');
    const inputMap = new Map(monitoring.items.map((i) => [i.poItemId, i.qtyReceived])); let totalOrdered = 0; let totalReceived = 0; let anyShortfall = false;
    for (const item of po.items) { const raw = inputMap.get(item.id); if (!Number.isInteger(raw) || raw < 0) throw new Error(`Received quantity for "${item.itemDescription}" must be a whole number of 0 or more`); if (raw > item.qty) throw new Error(`Received quantity for "${item.itemDescription}" cannot exceed ${item.qty} ${item.unit}`); totalOrdered += item.qty; totalReceived += raw; if (raw < item.qty) anyShortfall = true; await tx.purchaseOrderMonitoringItem.upsert({ where: { poItemId: item.id }, create: { poNumber, poItemId: item.id, qtyReceived: raw }, update: { qtyReceived: raw } }); }
    const discrepancy = !!monitoring.markAsDiscrepancy; if (discrepancy && !monitoring.remarks?.trim()) throw new Error('Discrepancy remarks are required before saving this PO'); const incomplete = discrepancy || anyShortfall;
    const updated = await tx.purchaseOrder.update({ where: { poNumber }, data: { status: incomplete ? 'incomplete' : 'completed', poType: discrepancy ? 'discrepancy' : (anyShortfall ? 'partially-received' : 'completed'), statusLabel: discrepancy ? 'Discrepancy' : (anyShortfall ? `Partially Received (${totalReceived}/${totalOrdered})` : 'Completed'), poExpDate: monitoring.dateDelivered, monDeliveredBy: monitoring.deliveredBy.trim(), monPlateNumber: monitoring.plateNumber.trim(), monDateDelivered: monitoring.dateDelivered, monReferenceNo: monitoring.referenceNo.trim(), monDrDate: monitoring.drDate, monRemarks: monitoring.remarks?.trim() || null, notes: monitoring.remarks?.trim() || po.notes }, include: poInclude });
    return { po: updated, totalOrdered, totalReceived, anyShortfall };
  });
}

export async function updatePO(poNumber: string, data: Partial<{ status: string; poType: string; statusLabel: string; items: POItemInput[]; pickupBy: string; poExpDate: string; supplierAddress: string; notes: string; monQtyRvd: string; monDeliveredBy: string; monPlateNumber: string; monDateDelivered: string; monReferenceNo: string; monDrDate: string; monRemarks: string; }>) {
  const user = await getCurrentUser(); if (!user) throw new Error('Unauthorized'); const { items, ...rest } = data;
  // Hardened generic patch: status/poType/statusLabel and item replacement
  // are legacy-only capabilities. On V1-workflow POs they would bypass the
  // procurement → delivery → receiving chain (and item replacement would
  // cascade-delete DeliveryItem history), so they are rejected here.
  const touchesWorkflow = data.status !== undefined || data.poType !== undefined || data.statusLabel !== undefined || items !== undefined;
  if (touchesWorkflow) {
    const po = await prisma.purchaseOrder.findUnique({ where: { poNumber }, include: { items: { select: { purchasedQty: true } }, _count: { select: { deliveries: true } } } });
    if (!po) throw new Error('Purchase order not found');
    if (user.role === 'Warehouse' && po.warehouse !== user.warehouse) throw new Error('Unauthorized');
    try {
      assertLegacyPO({ status: po.status, items: po.items, _count: po._count });
    } catch {
      throw new Error('This purchase order uses the delivery workflow; update it through confirmPurchase / proceedToDelivery / confirmReceiving instead');
    }
    if (items !== undefined && po._count.deliveries > 0) throw new Error('PO items cannot be replaced once deliveries exist');
  }
  if (items) return prisma.$transaction(async (tx) => { const existing = await tx.purchaseOrder.findUnique({ where: { poNumber }, include: { items: true } }); if (!existing) throw new Error('Purchase order not found'); await tx.purchaseOrderItem.deleteMany({ where: { poNumber } }); const newItems = await Promise.all(items.map((i) => { validateItems([i]); return tx.purchaseOrderItem.create({ data: { poNumber, itemDescription: i.itemDescription, qty: i.qty, unit: i.unit } }); })); await tx.purchaseOrder.update({ where: { poNumber }, data: rest }); await ensureMonitoringRows(tx, poNumber, newItems); return tx.purchaseOrder.findUnique({ where: { poNumber }, include: poInclude }); });
  return prisma.purchaseOrder.update({ where: { poNumber }, data: rest, include: poInclude });
}
async function assertCanDeletePOs() { const user = await getCurrentUser(); if (!user || user.role !== 'Superadmin') throw new Error('Unauthorized: only superadmin can delete purchase orders'); return user; }
export async function deletePO(poNumber: string) { await assertCanDeletePOs(); return prisma.purchaseOrder.delete({ where: { poNumber } }); }
