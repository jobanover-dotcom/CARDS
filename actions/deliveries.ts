'use server';

import { prisma } from '@/lib/prisma';
import type { Prisma } from '@prisma/client';
import { getCurrentUser } from './auth';
import { DELIVERY_STATUS, PO_STATUS, deliveryStatusLabel, poStatusLabel } from '@/src/lib/deliveryStatus';
import {
  assertValidDeliveredQty,
  assertValidPurchasedQty,
  assertValidReceivedQty,
  assertValidReceivedQtyV2,
  buildItemChain,
  buildSimplifiedChain,
  deriveChainStatus,
  evaluatePOCompletion,
  receivingOutstanding,
  remainingToDeliver,
  unpurchasedQty,
  type ItemChain,
} from '@/src/lib/deliveryQuantities';
import {
  confirmPurchaseSchema,
  confirmReceivingSchema,
  confirmReceivingV2Schema,
  markOnDeliverySchema,
  markReadyForDeliverySchema,
  proceedToDeliverySchema,
  updateDeliveryTransitSchema,
} from '@/src/lib/validations/delivery';

// ---------------------------------------------------------------------------
// V1 procurement → delivery → receiving.
// PO = procurement record; Delivery = physical shipment; DeliveryReceipt =
// supplier DR evidence (Storage path only); Receiving = warehouse actuals.
// updatePOMonitoring() in pos.ts stays as legacy compat for old records only.
// ---------------------------------------------------------------------------

const deliveryInclude = {
  items: { include: { poItem: true } },
  receipts: true,
  auditLogs: { orderBy: { createdAt: 'desc' as const } },
} as const;

type Tx = Prisma.TransactionClient;

async function assertCanManagePOs() {
  const user = await getCurrentUser();
  if (!user || (user.role !== 'Admin' && user.role !== 'Superadmin'))
    throw new Error('Unauthorized: only purchasers and superadmins can manage procurement');
  return user;
}

async function assertWarehouseOwns(poWarehouse: string | null) {
  const user = await getCurrentUser();
  if (!user || user.role !== 'Warehouse') throw new Error('Unauthorized: only warehouse users can receive deliveries');
  if (poWarehouse && poWarehouse !== user.warehouse) throw new Error('Unauthorized: delivery belongs to another warehouse');
  return user;
}

async function audit(tx: Tx, entry: { deliveryId?: string | null; poNumber: string; action: string; detail?: string | null; actor?: string | null }) {
  await tx.deliveryAuditLog.create({
    data: {
      deliveryId: entry.deliveryId ?? null,
      poNumber: entry.poNumber,
      action: entry.action,
      detail: entry.detail ?? null,
      actor: entry.actor ?? null,
    },
  });
}

// Serialize per-PO delivery creation so concurrent callers cannot claim the
// same remaining quantity. Must run inside the surrounding transaction.
async function lockPO(tx: Tx, poNumber: string) {
  await tx.$queryRaw`SELECT "poNumber" FROM "PurchaseOrder" WHERE "poNumber" = ${poNumber} FOR UPDATE`;
}

// Globally serializes delivery-number allocation. lockPO() only locks one PO
// row, so two concurrent proceedToDelivery calls on DIFFERENT POs could
// otherwise read the same max and collide on the unique deliveryNumber.
async function lockDeliveryNumbering(tx: Tx) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('cards_delivery_numbering'))`;
}

async function nextDeliveryNumber(tx: Tx, year: number) {
  await lockDeliveryNumbering(tx);
  const prefix = `DEL-${year}-`;
  const latest = await tx.delivery.findFirst({
    where: { deliveryNumber: { startsWith: prefix } },
    orderBy: { deliveryNumber: 'desc' },
    select: { deliveryNumber: true },
  });
  const next = latest ? parseInt(latest.deliveryNumber.slice(prefix.length), 10) + 1 : 1;
  if (!Number.isInteger(next) || next < 1) throw new Error('Failed to allocate delivery number');
  return `${prefix}${String(next).padStart(4, '0')}`;
}

// Best-effort request gate: POs carry mrsNo but no FK to WarehouseRequest.
async function assertSourceRequestApprovable(tx: Tx, mrsNo: string) {
  const req = await tx.warehouseRequest.findFirst({ where: { mrsNo }, select: { status: true, mrsNo: true } });
  if (!req) return;
  if (req.status === 'Rejected' || req.status === 'Pending')
    throw new Error(`Source request ${mrsNo} is ${req.status}; only approved requests can proceed to delivery`);
}

export interface TrackerDeliveryRow {
  deliveryId: string
  deliveryNumber: string
  deliveredQty: number
  receivedQty: number
  remainingToReceive: number
  status: string
  statusLabel: string | null
}

export interface FollowUpChainRow extends ItemChain {
  poItemId: string
  itemDescription: string
  unit: string
  /** where the outstanding balance originates: approval | procurement | receiving | none */
  shortfallSource: 'approval' | 'procurement' | 'receiving' | 'none'
  /** true when a follow-up request may be filed for this line */
  followUpEligible: boolean
  /** unified tracker status — derived from individual balances, never outstanding alone */
  status: string
  statusReason: string
  /** every physical shipment touching this PO item */
  deliveries: TrackerDeliveryRow[]
}

function matchRequestItem(reqItems: { itemDescription: string; qty: number; approvedQty: number | null }[], description: string) {
  const key = description.trim().toLowerCase();
  return reqItems.find((r) => r.itemDescription.trim().toLowerCase() === key) ?? null;
}

// Resolve the source request for request-level balances: explicit
// sourceReqNumber first, then earliest mrsNo match. Returns null for
// legacy/manual POs, in which case PO quantities stand in for requested.
async function loadSourceRequest(
  tx: Tx,
  po: { sourceReqNumber: string | null; mrsNo: string },
) {
  if (po.sourceReqNumber) {
    const direct = await tx.warehouseRequest.findUnique({
      where: { reqNumber: po.sourceReqNumber },
      include: { items: true },
    });
    if (direct) return direct;
  }
  return tx.warehouseRequest.findFirst({
    where: { mrsNo: po.mrsNo },
    orderBy: { createdAt: 'asc' },
    include: { items: true },
  });
}

// Authoritative per-item chain, computed from the database inside the
// caller's transaction. Single source of truth for completion, follow-up
// balances, and warehouse outstanding displays — never duplicated elsewhere.
//
// HARD RULE: requestOutstanding is REPORTING ONLY. Procurement, delivery,
// and receiving actions must use procurementShortfall / deliveryRemaining /
// receivingRemaining respectively. A purchased-but-undelivered unit must
// never become procurement follow-up eligible merely because it is unreceived.
export async function buildPOChains(tx: Tx, poNumber: string): Promise<{
  chains: FollowUpChainRow[]
  sourceReqNumber: string | null
}> {
  const po = await tx.purchaseOrder.findUnique({
    where: { poNumber },
    include: {
      items: {
        include: {
          deliveryItems: { include: { delivery: { select: { id: true, deliveryNumber: true, status: true, statusLabel: true } } } },
        },
      },
    },
  });
  if (!po) throw new Error('Purchase order not found');
  const source = await loadSourceRequest(tx, po);
  const chains: FollowUpChainRow[] = po.items.map((item) => {
    const matched = source ? matchRequestItem(source.items, item.itemDescription) : null;
    const chain = buildItemChain({
      requestedQty: matched ? matched.qty : item.qty,
      approvedQty: matched ? (matched.approvedQty ?? matched.qty) : item.qty,
      purchasedQty: item.purchasedQty,
      deliveries: item.deliveryItems,
    });
    const shortfallSource =
      chain.requestOutstanding === 0
        ? 'none'
        : chain.approvalShortfall > 0
          ? 'approval'
          : chain.procurementShortfall > 0
            ? 'procurement'
            : 'receiving';
    const { status, statusReason } = deriveChainStatus(chain);
    const deliveries: TrackerDeliveryRow[] = item.deliveryItems.map((d) => ({
      deliveryId: d.deliveryId,
      deliveryNumber: d.delivery?.deliveryNumber ?? '—',
      deliveredQty: d.deliveredQty,
      receivedQty: d.receivedQty,
      remainingToReceive: Math.max(0, d.deliveredQty - d.receivedQty),
      status: d.delivery?.status ?? 'unknown',
      statusLabel: d.delivery?.statusLabel ?? null,
    }));
    return {
      ...chain,
      poItemId: item.id,
      itemDescription: item.itemDescription,
      unit: item.unit,
      shortfallSource,
      // Procurement follow-up eligibility is procurementShortfall ONLY —
      // never the full outstanding. See createRequest hard-block.
      followUpEligible: chain.procurementShortfall > 0,
      status,
      statusReason,
      deliveries,
    };
  });
  return { chains, sourceReqNumber: source ? source.reqNumber : null };
}

export interface POFollowUpBalance {
  poNumber: string
  sourceReqNumber: string | null
  items: FollowUpChainRow[]
  totals: {
    requested: number
    approved: number
    purchased: number
    delivered: number
    received: number
    outstanding: number
    approvalShortfall: number
    procurementShortfall: number
    remainingToDeliver: number
    remainingToReceive: number
  }
  canComplete: boolean
}

export interface POQuantityTracker extends POFollowUpBalance {
  supplier: string
  mrsNo: string
  status: string
  statusLabel: string
  warehouse: string
}

function sumTotals(chains: FollowUpChainRow[]) {
  const sum = (f: (c: FollowUpChainRow) => number) => chains.reduce((s, c) => s + f(c), 0);
  return {
    requested: sum((c) => c.requestedQty),
    approved: sum((c) => c.approvedQty),
    purchased: sum((c) => c.purchasedQty),
    delivered: sum((c) => c.deliveredQty),
    received: sum((c) => c.receivedQty),
    outstanding: sum((c) => c.requestOutstanding),
    approvalShortfall: sum((c) => c.approvalShortfall),
    procurementShortfall: sum((c) => c.procurementShortfall),
    remainingToDeliver: sum((c) => c.deliveryRemaining),
    remainingToReceive: sum((c) => c.receivingRemaining),
  };
}

// Server-side V1 follow-up balance. Feeds the warehouse follow-up UI and
// validates follow-up quantities — the UI never computes its own balances.
export async function getPOFollowUpBalance(poNumber: string): Promise<POFollowUpBalance> {
  const user = await getCurrentUser();
  if (!user) throw new Error('Unauthorized');
  return prisma.$transaction(async (tx) => {
    const po = await tx.purchaseOrder.findUnique({ where: { poNumber } });
    if (!po) throw new Error('Purchase order not found');
    if (user.role === 'Warehouse' && po.warehouse !== user.warehouse) throw new Error('Unauthorized');
    const { chains, sourceReqNumber } = await buildPOChains(tx, poNumber);
    const fresh = await tx.purchaseOrder.findUnique({
      where: { poNumber },
      select: { status: true, deliveries: { select: { status: true } } },
    });
    const hasOpenDiscrepancy =
      fresh?.deliveries.some((d) => d.status === DELIVERY_STATUS.DISCREPANCY.value) ?? false;
    const completion = evaluatePOCompletion({ chains, hasOpenDiscrepancy });
    return {
      poNumber,
      sourceReqNumber,
      items: chains,
      totals: sumTotals(chains),
      canComplete: completion.canComplete,
    };
  });
}

// Unified tracker: the SAME server response feeds the warehouse summary,
// the warehouse tracker, and the purchaser procurement & delivery tracker.
// Frontend renders only — all math happens in buildPOChains.
export async function getPOQuantityTracker(poNumber: string): Promise<POQuantityTracker> {
  const user = await getCurrentUser();
  if (!user) throw new Error('Unauthorized');
  return prisma.$transaction(async (tx) => {
    const po = await tx.purchaseOrder.findUnique({ where: { poNumber } });
    if (!po) throw new Error('Purchase order not found');
    if (user.role === 'Warehouse' && po.warehouse !== user.warehouse) throw new Error('Unauthorized');
    const { chains, sourceReqNumber } = await buildPOChains(tx, poNumber);
    const fresh = await tx.purchaseOrder.findUnique({
      where: { poNumber },
      select: { status: true, deliveries: { select: { status: true } } },
    });
    const hasOpenDiscrepancy =
      fresh?.deliveries.some((d) => d.status === DELIVERY_STATUS.DISCREPANCY.value) ?? false;
    const completion = evaluatePOCompletion({ chains, hasOpenDiscrepancy });
    return {
      poNumber,
      sourceReqNumber,
      items: chains,
      totals: sumTotals(chains),
      canComplete: completion.canComplete,
      supplier: po.supplier,
      mrsNo: po.mrsNo,
      status: po.status,
      statusLabel: po.statusLabel,
      warehouse: po.warehouse,
    };
  });
}

// Warehouse V1 partials: V1 POs with requestOutstanding > 0, each with its
// full item chain. Legacy POs keep their own monitoring-based list.
export async function getWarehouseV1Partials() {
  const user = await getCurrentUser();
  if (!user) throw new Error('Unauthorized');
  const scope = user.role === 'Warehouse' ? { warehouse: user.warehouse } : {};
  const pos = await prisma.purchaseOrder.findMany({
    where: {
      ...scope,
      status: {
        in: [PO_STATUS.READY_FOR_DELIVERY.value, PO_STATUS.PURCHASE_CONFIRMED.value, PO_STATUS.COMPLETED.value],
      },
    },
    select: { poNumber: true, supplier: true, mrsNo: true, status: true, statusLabel: true, warehouse: true },
    orderBy: { updatedAt: 'desc' },
    take: 100,
  });
  const result: (POFollowUpBalance & { supplier: string; mrsNo: string; status: string; statusLabel: string; warehouse: string })[] = [];
  for (const po of pos) {
    const hasV1 = await prisma.purchaseOrderItem.count({
      where: { poNumber: po.poNumber, NOT: { purchasedQty: null } },
    });
    const deliveryCount = await prisma.delivery.count({ where: { poNumber: po.poNumber } });
    if (hasV1 === 0 && deliveryCount === 0) continue;
    const balance = await getPOFollowUpBalance(po.poNumber);
    if (balance.totals.outstanding > 0) {
      result.push({ ...balance, supplier: po.supplier, mrsNo: po.mrsNo, status: po.status, statusLabel: po.statusLabel, warehouse: po.warehouse });
    }
  }
  return result;
}

// V1 warehouse statistics derived from Delivery/DeliveryItem aggregates —
// never from poType. outstandingPOCount reuses getWarehouseV1Partials so the
// Follow-Up Required card always matches the rows in the follow-up table.
export async function getV1WarehouseStats() {
  const user = await getCurrentUser();
  if (!user) return { openDeliveryCount: 0, discrepancyDeliveryCount: 0, partialPOCount: 0, readyPOCount: 0, outstandingPOCount: 0 };
  const scope = user.role === 'Warehouse' ? { po: { warehouse: user.warehouse } } : {};
  const poScope = user.role === 'Warehouse' ? { warehouse: user.warehouse } : {};
  const [openDeliveryCount, discrepancyDeliveryCount, readyPOCount, partialDeliveries] = await prisma.$transaction([
    prisma.delivery.count({
      where: {
        ...scope,
        status: {
          in: [DELIVERY_STATUS.FOR_DELIVERY.value, DELIVERY_STATUS.IN_TRANSIT.value, DELIVERY_STATUS.PARTIALLY_RECEIVED.value],
        },
      },
    }),
    prisma.delivery.count({ where: { ...scope, status: DELIVERY_STATUS.DISCREPANCY.value } }),
    prisma.purchaseOrder.count({
      where: {
        ...poScope,
        status: { in: [PO_STATUS.AWAITING_PURCHASE.value, PO_STATUS.PURCHASE_CONFIRMED.value, PO_STATUS.READY_FOR_DELIVERY.value] },
      },
    }),
    prisma.delivery.findMany({
      where: {
        ...scope,
        status: { in: [DELIVERY_STATUS.PARTIALLY_RECEIVED.value, DELIVERY_STATUS.DISCREPANCY.value] },
      },
      select: { poNumber: true },
    }),
  ]);
  return {
    openDeliveryCount,
    discrepancyDeliveryCount,
    partialPOCount: new Set(partialDeliveries.map((d) => d.poNumber)).size,
    readyPOCount,
    outstandingPOCount: (await getWarehouseV1Partials()).length,
  };
}

export interface RemainingRow {
  poItemId: string;
  itemDescription: string;
  unit: string;
  orderedQty: number;
  purchasedQty: number | null;
  deliveredQty: number;
  receivedQty: number;
  remainingToDeliver: number;
  remainingToReceive: number;
}

export async function getRemainingDeliverable(poNumber: string): Promise<{ rows: RemainingRow[]; canCreateDelivery: boolean }> {
  const user = await getCurrentUser();
  if (!user) throw new Error('Unauthorized');
  const po = await prisma.purchaseOrder.findUnique({
    where: { poNumber },
    include: { items: { include: { deliveryItems: true } } },
  });
  if (!po) throw new Error('Purchase order not found');
  if (user.role === 'Warehouse' && po.warehouse !== user.warehouse) throw new Error('Unauthorized');

  const rows: RemainingRow[] = po.items.map((item) => {
    const delivered = item.deliveryItems.reduce((s, d) => s + d.deliveredQty, 0);
    const received = item.deliveryItems.reduce((s, d) => s + d.receivedQty, 0);
    return {
      poItemId: item.id,
      itemDescription: item.itemDescription,
      unit: item.unit,
      orderedQty: item.qty,
      purchasedQty: item.purchasedQty,
      deliveredQty: delivered,
      receivedQty: received,
      remainingToDeliver: remainingToDeliver({ purchasedQty: item.purchasedQty, deliveries: item.deliveryItems }),
      remainingToReceive: Math.max(0, delivered - received),
    };
  });
  return { rows, canCreateDelivery: rows.some((r) => r.remainingToDeliver > 0) };
}

// awaiting_purchase → purchase_confirmed (incremental allowed for partial
// purchase). Each call sets purchasedQty per line; cumulative total per line
// never exceeds approved. Follow-up (approved - purchased) stays on the SAME
// PO — no second PO is ever created here.
export async function confirmPurchase(input: { poNumber: string; items: { poItemId: string; purchasedQty: number }[]; remarks?: string }) {
  const user = await assertCanManagePOs();
  const parsed = confirmPurchaseSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    const po = await tx.purchaseOrder.findUnique({ where: { poNumber: parsed.poNumber }, include: { items: true } });
    if (!po) throw new Error('Purchase order not found');
    const allowed = new Set([PO_STATUS.AWAITING_PURCHASE.value, PO_STATUS.PURCHASE_CONFIRMED.value, 'incomplete', PO_STATUS.ON_DELIVERY.value]);
    if (!allowed.has(po.status))
      throw new Error(`Only purchase orders awaiting/confirming purchase can be confirmed (current: ${po.status})`);

    const inputMap = new Map(parsed.items.map((i) => [i.poItemId, i.purchasedQty]));
    // Cap against live approved quantities from the source request — never
    // against the PO snapshot alone, which may predate an approval amendment.
    const source = await loadSourceRequest(tx, po);
    for (const item of po.items) {
      if (!inputMap.has(item.id)) continue; // partial update: untouched lines keep prior values
      const qty = inputMap.get(item.id)!;
      const matched = source ? matchRequestItem(source.items, item.itemDescription) : null;
      const maxQty = matched ? (matched.approvedQty ?? matched.qty) : item.qty;
      const prior = item.purchasedQty ?? 0;
      // Incremental semantics: caller sends the NEW TOTAL per line. It must
      // not decrease below what was already confirmed and never exceed approved.
      if (qty < prior) throw new Error(`Purchased quantity for "${item.itemDescription}" cannot be reduced below the confirmed ${prior}`);
      assertValidPurchasedQty(qty, maxQty, item.itemDescription);
      await tx.purchaseOrderItem.update({ where: { id: item.id }, data: { purchasedQty: qty } });
    }
    const stillMissing = await tx.purchaseOrderItem.count({ where: { poNumber: parsed.poNumber, purchasedQty: null } });
    const updated = await tx.purchaseOrder.update({
      where: { poNumber: parsed.poNumber },
      data: {
        ...(stillMissing === 0 && po.status !== PO_STATUS.ON_DELIVERY.value
          ? { status: PO_STATUS.PURCHASE_CONFIRMED.value, statusLabel: poStatusLabel(PO_STATUS.PURCHASE_CONFIRMED.value) }
          : {}),
        purchaseConfirmedAt: po.purchaseConfirmedAt ?? new Date(),
        purchaseConfirmedBy: po.purchaseConfirmedBy ?? user.username,
        notes: parsed.remarks?.trim() ? parsed.remarks.trim() : po.notes,
      },
    });
    await audit(tx, { poNumber: parsed.poNumber, action: 'purchase_confirmed', detail: parsed.remarks?.trim() ?? null, actor: user.username });
    return updated;
  });
}

// Purchaser checkpoint: purchased items dispatched by the supplier.
// purchase_confirmed → on_delivery. Allowed even when partially purchased:
// the purchased lines proceed while the remainder stays as follow-up on the
// SAME PO. Distinct from ready_for_delivery (ready to be sent).
export async function markOnDelivery(input: { poNumber: string }) {
  const user = await assertCanManagePOs();
  const parsed = markOnDeliverySchema.parse(input);
  return prisma.$transaction(async (tx) => {
    const po = await tx.purchaseOrder.findUnique({ where: { poNumber: parsed.poNumber }, include: { items: true } });
    if (!po) throw new Error('Purchase order not found');
    if (po.status !== PO_STATUS.PURCHASE_CONFIRMED.value && po.status !== PO_STATUS.READY_FOR_DELIVERY.value)
      throw new Error(`Only purchase-confirmed orders can be marked on delivery (current: ${po.status})`);
    const purchased = po.items.filter((i) => (i.purchasedQty ?? 0) > 0);
    if (!purchased.length) throw new Error('At least one item must have a confirmed purchased quantity before marking on delivery');
    if (!po.supplier?.trim()) throw new Error('Supplier is required before a PO is on delivery');
    const updated = await tx.purchaseOrder.update({
      where: { poNumber: parsed.poNumber },
      data: {
        status: PO_STATUS.ON_DELIVERY.value,
        statusLabel: poStatusLabel(PO_STATUS.ON_DELIVERY.value),
        onDeliveryAt: new Date(),
        onDeliveryBy: user.username,
      },
    });
    await audit(tx, { poNumber: parsed.poNumber, action: 'on_delivery', actor: user.username });
    return updated;
  });
}

// Remap helper: ready_for_delivery → on_delivery where unambiguous (no DEL-*
// rows, fully purchased, readiness timestamp present). Ambiguous history is
// left untouched (returns remapped: false).
export async function remapReadyForDelivery(poNumber: string) {
  const user = await assertCanManagePOs();
  return prisma.$transaction(async (tx) => {
    const po = await tx.purchaseOrder.findUnique({
      where: { poNumber },
      include: { items: true, _count: { select: { deliveries: true } } },
    });
    if (!po) throw new Error('Purchase order not found');
    if (po.status !== PO_STATUS.READY_FOR_DELIVERY.value) return { remapped: false, reason: `status is ${po.status}` };
    if (po._count.deliveries > 0) return { remapped: false, reason: 'has delivery history — preserved' };
    if (!po.readyForDeliveryAt) return { remapped: false, reason: 'no readiness timestamp — preserved' };
    if (po.items.some((i) => i.purchasedQty == null)) return { remapped: false, reason: 'incomplete purchasing — preserved' };
    const updated = await tx.purchaseOrder.update({
      where: { poNumber },
      data: {
        status: PO_STATUS.ON_DELIVERY.value,
        statusLabel: poStatusLabel(PO_STATUS.ON_DELIVERY.value),
        onDeliveryAt: po.readyForDeliveryAt,
        onDeliveryBy: user.username,
      },
    });
    await audit(tx, { poNumber, action: 'on_delivery_remapped', detail: 'ready_for_delivery → on_delivery (unambiguous)', actor: user.username });
    return { remapped: true, po: updated };
  });
}

// purchase_confirmed → ready_for_delivery. Separate gate: all items must carry
// complete purchasing info before the PO becomes deliverable.
export async function markReadyForDelivery(input: { poNumber: string }) {
  const user = await assertCanManagePOs();
  const parsed = markReadyForDeliverySchema.parse(input);
  return prisma.$transaction(async (tx) => {
    const po = await tx.purchaseOrder.findUnique({ where: { poNumber: parsed.poNumber }, include: { items: true } });
    if (!po) throw new Error('Purchase order not found');
    if (po.status !== PO_STATUS.PURCHASE_CONFIRMED.value) throw new Error('Only purchase-confirmed orders can be marked ready for delivery');
    const incomplete = po.items.filter((i) => i.purchasedQty == null);
    if (incomplete.length) throw new Error(`${incomplete.length} item(s) are missing purchased quantities`);
    if (!po.supplier?.trim()) throw new Error('Supplier is required before a PO is ready for delivery');
    const updated = await tx.purchaseOrder.update({
      where: { poNumber: parsed.poNumber },
      data: {
        status: PO_STATUS.READY_FOR_DELIVERY.value,
        statusLabel: poStatusLabel(PO_STATUS.READY_FOR_DELIVERY.value),
        readyForDeliveryAt: new Date(),
      },
    });
    await audit(tx, { poNumber: parsed.poNumber, action: 'ready_for_delivery', actor: user.username });
    return updated;
  });
}

// [DEPRECATED — active workflow no longer creates Delivery records.]
// Preserved for historical reads only. New procurement uses markOnDelivery +
// confirmReceivingV2. Throws for new workflow callers.
export async function proceedToDelivery(input: {
  poNumber: string;
  deliveredBy?: string;
  plateNumber?: string;
  deliveryDate: string;
  items: { poItemId: string; deliveredQty: number }[];
  remarks?: string;
}) {
  await assertCanManagePOs();
  throw new Error('Delivery tracking is retired. Use markOnDelivery for the purchaser checkpoint and confirmReceivingV2 for warehouse receiving.');
}

export async function updateDeliveryTransit(input: { deliveryNumber: string; deliveredBy: string; plateNumber: string; deliveryDate: string }) {
  throw new Error('Delivery tracking is retired. In-transit logistics are handled by the supplier outside CARDS.');
}

// Warehouse receiving: 0 ≤ received ≤ delivered; discrepancy is a calculated
// result recorded with remarks. May complete the parent PO when totals match.
export async function confirmReceiving(input: {
  deliveryNumber: string;
  supplierDrNumber: string;
  items: { deliveryItemId: string; receivedQty: number }[];
  remarks?: string;
  markAsDiscrepancy?: boolean;
}) {
  const parsed = confirmReceivingSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    const delivery = await tx.delivery.findUnique({
      where: { deliveryNumber: parsed.deliveryNumber },
      include: { items: { include: { poItem: true } }, po: { include: { items: { include: { deliveryItems: true } } } } },
    });
    if (!delivery) throw new Error('Delivery not found');
    const user = await assertWarehouseOwns(delivery.po.warehouse);
    const receivable: string[] = [DELIVERY_STATUS.FOR_DELIVERY.value, DELIVERY_STATUS.IN_TRANSIT.value, DELIVERY_STATUS.PARTIALLY_RECEIVED.value];
    if (!receivable.includes(delivery.status))
      throw new Error(`Delivery ${parsed.deliveryNumber} is already ${delivery.status} and cannot be received again`);
    if (parsed.items.length !== delivery.items.length) throw new Error('Every delivery item must have a received quantity');

    const inputMap = new Map(parsed.items.map((i) => [i.deliveryItemId, i.receivedQty]));
    let anyShortfall = false;
    for (const item of delivery.items) {
      const qty = inputMap.get(item.id);
      if (qty === undefined) throw new Error(`Missing received quantity for "${item.poItem.itemDescription}"`);
      assertValidReceivedQty(qty, item.deliveredQty, item.poItem.itemDescription);
      if (qty < item.deliveredQty) anyShortfall = true;
      await tx.deliveryItem.update({ where: { id: item.id }, data: { receivedQty: qty } });
    }

    const discrepancy = !!parsed.markAsDiscrepancy;
    const nextStatus = discrepancy
      ? DELIVERY_STATUS.DISCREPANCY.value
      : anyShortfall
        ? DELIVERY_STATUS.PARTIALLY_RECEIVED.value
        : DELIVERY_STATUS.RECEIVED.value;
    const updated = await tx.delivery.update({
      where: { deliveryNumber: parsed.deliveryNumber },
      data: {
        supplierDrNumber: parsed.supplierDrNumber.trim(),
        remarks: parsed.remarks?.trim() || null,
        receivedBy: user.username,
        receivedAt: new Date(),
        status: nextStatus,
        statusLabel: deliveryStatusLabel(nextStatus),
      },
      include: deliveryInclude,
    });
    await audit(tx, {
      deliveryId: delivery.id,
      poNumber: delivery.poNumber,
      action: 'receiving_confirmed',
      detail: `${parsed.supplierDrNumber.trim()} → ${nextStatus}${parsed.remarks?.trim() ? `: ${parsed.remarks.trim()}` : ''}`,
      actor: user.username,
    });

    // PO completes ONLY when every purchased unit is received, no delivery
    // is in open discrepancy, AND the original request has zero outstanding
    // balance. A PO is never completed merely because the latest delivery
    // matched its purchased quantity while the request still needs follow-up.
    const { chains } = await buildPOChains(tx, delivery.poNumber);
    const fresh = await tx.purchaseOrder.findUnique({
      where: { poNumber: delivery.poNumber },
      select: { status: true, deliveries: { select: { status: true } } },
    });
    if (fresh) {
      const hasOpenDiscrepancy = fresh.deliveries.some((d) => d.status === DELIVERY_STATUS.DISCREPANCY.value);
      const completion = evaluatePOCompletion({ chains, hasOpenDiscrepancy });
      if (completion.canComplete && fresh.status !== PO_STATUS.COMPLETED.value) {
        await tx.purchaseOrder.update({
          where: { poNumber: delivery.poNumber },
          data: { status: PO_STATUS.COMPLETED.value, statusLabel: poStatusLabel(PO_STATUS.COMPLETED.value) },
        });
        await audit(tx, { poNumber: delivery.poNumber, action: 'po_completed', detail: 'All purchased quantities received with zero request outstanding', actor: user.username });
      }
    }
    return updated;
  });
}

export async function getDeliveries(params: { poNumber?: string; status?: string; statusIn?: string[]; offset?: number; limit?: number } = {}) {
  const user = await getCurrentUser();
  if (!user) return { rows: [], total: 0 };
  const where: Record<string, unknown> = {};
  if (params.poNumber) where.poNumber = params.poNumber;
  if (params.status) where.status = params.status;
  if (params.statusIn) where.status = { in: params.statusIn };
  if (user.role === 'Warehouse') {
    if (!user.warehouse) throw new Error('Unauthorized: warehouse user has no warehouse assigned');
    const warehouse = user.warehouse;
    const scoped = await prisma.purchaseOrder.findMany({ where: { warehouse }, select: { poNumber: true } });
    const numbers = new Set(scoped.map((p) => p.poNumber));
    if (params.poNumber) {
      if (!numbers.has(params.poNumber)) throw new Error('Unauthorized');
    } else {
      where.poNumber = { in: [...numbers] };
    }
  }
  const [rows, total] = await prisma.$transaction([
    prisma.delivery.findMany({ where, include: deliveryInclude, orderBy: { createdAt: 'desc' }, skip: params.offset ?? 0, take: params.limit ?? 10 }),
    prisma.delivery.count({ where }),
  ]);
  return { rows, total };
}

export async function getDeliveryByNumber(deliveryNumber: string) {
  const user = await getCurrentUser();
  if (!user) throw new Error('Unauthorized');
  const delivery = await prisma.delivery.findUnique({ where: { deliveryNumber }, include: { ...deliveryInclude, po: true } });
  if (!delivery) return null;
  if (user.role === 'Warehouse' && delivery.po.warehouse !== user.warehouse) throw new Error('Unauthorized');
  return delivery;
}

// Full delivery listing for reports/exports. Same scoping as getDeliveries,
// plus an optional warehouse filter for purchaser/admin reporting.
export async function getDeliveryReportData(params: { warehouse?: string; statusIn?: string[] } = {}) {
  const user = await getCurrentUser();
  if (!user) throw new Error('Unauthorized');
  const where: Record<string, unknown> = {};
  if (params.statusIn) where.status = params.statusIn;
  if (user.role === 'Warehouse') {
    if (!user.warehouse) throw new Error('Unauthorized: warehouse user has no warehouse assigned');
    where.po = { warehouse: user.warehouse };
  } else if (params.warehouse) {
    where.po = { warehouse: params.warehouse };
  }
  return prisma.delivery.findMany({
    where,
    include: { items: { include: { poItem: true } }, receipts: false, auditLogs: false },
    orderBy: [{ poNumber: 'asc' }, { createdAt: 'asc' }],
  });
}

// ---------------------------------------------------------------------------
// SIMPLIFIED PROCUREMENT WORKFLOW (canonical)
// PO → Purchased → On Delivery → Receiving → Completed
// Follow-Up = max(0, approved - purchased), stays on SAME PO.
// ---------------------------------------------------------------------------

export interface SimplifiedItemRow {
  poItemId: string
  itemDescription: string
  unit: string
  requestedQty: number
  approvedQty: number
  purchasedQty: number
  receivedQty: number
  unpurchased: number
  outstanding: number
  followUpRequired: boolean
}

export interface SimplifiedTracker {
  poNumber: string
  sourceReqNumber: string | null
  supplier: string
  mrsNo: string
  status: string
  statusLabel: string
  warehouse: string
  items: SimplifiedItemRow[]
  totals: { requested: number; approved: number; purchased: number; received: number; unpurchased: number; outstanding: number }
  followUpRequired: boolean
  canComplete: boolean
}

async function buildSimplifiedTrackerTx(tx: Tx, poNumber: string): Promise<SimplifiedTracker> {
  const po = await tx.purchaseOrder.findUnique({ where: { poNumber }, include: { items: true } });
  if (!po) throw new Error('Purchase order not found');
  const source = await loadSourceRequest(tx, po);
  const items: SimplifiedItemRow[] = po.items.map((item) => {
    const matched = source ? matchRequestItem(source.items, item.itemDescription) : null;
    const chain = buildSimplifiedChain({
      requestedQty: matched ? matched.qty : item.qty,
      approvedQty: matched ? (matched.approvedQty ?? matched.qty) : item.qty,
      purchasedQty: item.purchasedQty,
      receivedQty: (item as { receivedQty?: number | null }).receivedQty ?? 0,
    });
    return {
      poItemId: item.id,
      itemDescription: item.itemDescription,
      unit: item.unit,
      requestedQty: chain.requestedQty,
      approvedQty: chain.approvedQty,
      purchasedQty: chain.purchasedQty,
      receivedQty: chain.receivedQty,
      unpurchased: chain.unpurchased,
      outstanding: chain.outstanding,
      followUpRequired: chain.followUpRequired,
    };
  });
  const totals = {
    requested: items.reduce((s, i) => s + i.requestedQty, 0),
    approved: items.reduce((s, i) => s + i.approvedQty, 0),
    purchased: items.reduce((s, i) => s + i.purchasedQty, 0),
    received: items.reduce((s, i) => s + i.receivedQty, 0),
    unpurchased: items.reduce((s, i) => s + i.unpurchased, 0),
    outstanding: items.reduce((s, i) => s + i.outstanding, 0),
  };
  const followUpRequired = totals.unpurchased > 0;
  const canComplete = totals.unpurchased === 0 && totals.outstanding === 0 && totals.purchased > 0;
  return {
    poNumber, sourceReqNumber: source ? source.reqNumber : null,
    supplier: po.supplier, mrsNo: po.mrsNo, status: po.status,
    statusLabel: po.statusLabel, warehouse: po.warehouse,
    items, totals, followUpRequired, canComplete,
  };
}

export async function getSimplifiedTracker(poNumber: string): Promise<SimplifiedTracker> {
  const user = await getCurrentUser();
  if (!user) throw new Error('Unauthorized');
  return prisma.$transaction(async (tx) => {
    const po = await tx.purchaseOrder.findUnique({ where: { poNumber } });
    if (!po) throw new Error('Purchase order not found');
    if (user.role === 'Warehouse' && po.warehouse !== user.warehouse) throw new Error('Unauthorized');
    return buildSimplifiedTrackerTx(tx, poNumber);
  });
}

// Purchaser Follow-Up list: every PO with approvedQty > purchasedQty.
// One entry per PO line; same parent PO is updated in place — never a new PO.
export async function getPurchaserFollowUps(params: { warehouse?: string } = {}) {
  const user = await getCurrentUser();
  if (!user || (user.role !== 'Admin' && user.role !== 'Superadmin'))
    throw new Error('Unauthorized: only purchasers and superadmins can view follow-ups');
  const where: Record<string, unknown> = {
    status: { notIn: [PO_STATUS.COMPLETED.value, PO_STATUS.CANCELLED.value] },
  };
  if (params.warehouse) where.warehouse = params.warehouse;
  const pos = await prisma.purchaseOrder.findMany({
    where, include: { items: true }, orderBy: { updatedAt: 'desc' }, take: 200,
  });
  const out: SimplifiedTracker[] = [];
  await prisma.$transaction(async (tx) => {
    for (const po of pos) {
      const t = await buildSimplifiedTrackerTx(tx, po.poNumber);
      if (t.followUpRequired) out.push(t);
    }
  });
  return out;
}

// Canonical purchaser workload stats — single source for dashboard + reports.
export async function getPurchaserWorkload(params: { warehouse?: string } = {}) {
  const user = await getCurrentUser();
  if (!user || (user.role !== 'Admin' && user.role !== 'Superadmin'))
    throw new Error('Unauthorized');
  const base: Record<string, unknown> = {};
  if (params.warehouse) base.warehouse = params.warehouse;
  const [totalPOs, completedPOs, onDeliveryPOs] = await prisma.$transaction([
    prisma.purchaseOrder.count({ where: base }),
    prisma.purchaseOrder.count({ where: { ...base, status: PO_STATUS.COMPLETED.value } }),
    prisma.purchaseOrder.count({ where: { ...base, status: PO_STATUS.ON_DELIVERY.value } }),
  ]);
  const followUps = await getPurchaserFollowUps(params);
  const followUpCount = followUps.length;
  const followUpUnits = followUps.reduce((s, t) => s + t.totals.unpurchased, 0);
  const inProgress = await prisma.purchaseOrder.count({
    where: { ...base, status: { notIn: [PO_STATUS.COMPLETED.value, PO_STATUS.CANCELLED.value] } },
  });
  return { totalPOs, completedPOs, onDeliveryPOs, followUpCount, followUpUnits, inProgress };
}

// Warehouse receiving workload: POs with purchased > received.
export async function getWarehouseReceivingDue() {
  const user = await getCurrentUser();
  if (!user) throw new Error('Unauthorized');
  const scope = user.role === 'Warehouse' ? { warehouse: user.warehouse } : {};
  const pos = await prisma.purchaseOrder.findMany({
    where: { ...scope, status: { notIn: [PO_STATUS.COMPLETED.value, PO_STATUS.CANCELLED.value] } },
    include: { items: true }, orderBy: { updatedAt: 'desc' }, take: 200,
  });
  const out: SimplifiedTracker[] = [];
  await prisma.$transaction(async (tx) => {
    for (const po of pos) {
      const t = await buildSimplifiedTrackerTx(tx, po.poNumber);
      if (t.totals.outstanding > 0) out.push(t);
    }
  });
  return out;
}

// Simplified warehouse receiving against PO items (NOT delivery tracking).
// 0 <= received <= purchased per line; remarks recorded on PO notes.
export async function confirmReceivingV2(input: { poNumber: string; items: { poItemId: string; receivedQty: number }[]; remarks?: string }) {
  const parsed = confirmReceivingV2Schema.parse(input);
  return prisma.$transaction(async (tx) => {
    const po = await tx.purchaseOrder.findUnique({ where: { poNumber: parsed.poNumber }, include: { items: true } });
    if (!po) throw new Error('Purchase order not found');
    const user = await getCurrentUser();
    if (!user || user.role !== 'Warehouse') throw new Error('Unauthorized: only warehouse users can confirm receiving');
    if (po.warehouse !== user.warehouse) throw new Error('Unauthorized: PO belongs to another warehouse');
    if (po.status !== PO_STATUS.ON_DELIVERY.value && po.status !== PO_STATUS.PURCHASE_CONFIRMED.value && po.status !== PO_STATUS.READY_FOR_DELIVERY.value)
      throw new Error(`Only POs on delivery can be received (current: ${po.status})`);
    const inputMap = new Map(parsed.items.map((i) => [i.poItemId, i.receivedQty]));
    if (inputMap.size !== po.items.length) throw new Error('Every PO item must have a received quantity');
    for (const item of po.items) {
      const qty = inputMap.get(item.id);
      if (qty === undefined) throw new Error(`Missing received quantity for "${item.itemDescription}"`);
      const purchased = item.purchasedQty ?? 0;
      if (purchased <= 0) throw new Error(`Item "${item.itemDescription}" has no purchased quantity to receive against`);
      assertValidReceivedQtyV2(qty, purchased, item.itemDescription);
      await tx.purchaseOrderItem.update({ where: { id: item.id }, data: { receivedQty: qty } });
    }
    const tracker = await buildSimplifiedTrackerTx(tx, parsed.poNumber);
    let updated = po;
    if (tracker.canComplete) {
      updated = await tx.purchaseOrder.update({
        where: { poNumber: parsed.poNumber },
        data: {
          status: PO_STATUS.COMPLETED.value, statusLabel: poStatusLabel(PO_STATUS.COMPLETED.value),
          notes: parsed.remarks?.trim() ? parsed.remarks.trim() : po.notes,
        },
      });
      await audit(tx, { poNumber: parsed.poNumber, action: 'po_completed', detail: 'All purchased quantities received', actor: user.username });
    } else if (parsed.remarks?.trim()) {
      updated = await tx.purchaseOrder.update({ where: { poNumber: parsed.poNumber }, data: { notes: parsed.remarks.trim() } });
      await audit(tx, { poNumber: parsed.poNumber, action: 'receiving_confirmed', detail: parsed.remarks.trim(), actor: user.username });
    } else {
      await audit(tx, { poNumber: parsed.poNumber, action: 'receiving_confirmed', actor: user.username });
    }
    return { po: updated, tracker: await buildSimplifiedTrackerTx(tx, parsed.poNumber) };
  });
}

async function assertCanViewArchive() {
  const user = await getCurrentUser();
  if (!user || (user.role !== 'Admin' && user.role !== 'Superadmin'))
    throw new Error('Unauthorized: archived deliveries are available to purchasers and superadmins only');
  return user;
}

// Read-only historical DEL-* access. No create/edit paths. Warehouse denied.
export async function getArchivedDeliveries(params: { poNumber?: string; search?: string; offset?: number; limit?: number } = {}) {
  await assertCanViewArchive();
  const where: Record<string, unknown> = {};
  if (params.poNumber) where.poNumber = params.poNumber;
  if (params.search?.trim()) {
    const q = params.search.trim();
    where.OR = [{ deliveryNumber: { contains: q, mode: 'insensitive' } }, { poNumber: { contains: q, mode: 'insensitive' } }, { supplier: { contains: q, mode: 'insensitive' } }];
  }
  const [rows, total] = await prisma.$transaction([
    prisma.delivery.findMany({ where, include: { items: { include: { poItem: true } }, auditLogs: { orderBy: { createdAt: 'desc' } } }, orderBy: { createdAt: 'desc' }, skip: params.offset ?? 0, take: params.limit ?? 20 }),
    prisma.delivery.count({ where }),
  ]);
  return { rows, total };
}

export async function getArchivedDeliveryByNumber(deliveryNumber: string) {
  await assertCanViewArchive();
  return prisma.delivery.findUnique({
    where: { deliveryNumber },
    include: { items: { include: { poItem: true } }, receipts: true, auditLogs: { orderBy: { createdAt: 'asc' } }, po: true },
  });
}

// Procurement report source: simplified trackers for POs matching a warehouse/search scope.
export async function getSimplifiedReport(params: { warehouse?: string; search?: string; status?: string; statusIn?: string[] } = {}) {
  const user = await getCurrentUser();
  if (!user) throw new Error('Unauthorized');
  const where: Record<string, unknown> = {};
  if (user.role === 'Warehouse') {
    if (!user.warehouse) throw new Error('Unauthorized');
    (where as Record<string, unknown>).warehouse = user.warehouse;
  } else if (params.warehouse) where.warehouse = params.warehouse;
  if (params.status) where.status = params.status;
  if (params.statusIn) where.status = { in: params.statusIn };
  if (params.search?.trim()) {
    const q = params.search.trim();
    (where as Record<string, unknown>).OR = [
      { poNumber: { contains: q, mode: 'insensitive' } },
      { items: { some: { itemDescription: { contains: q, mode: 'insensitive' } } } },
    ];
  }
  const pos = await prisma.purchaseOrder.findMany({ where, select: { poNumber: true }, orderBy: { createdAt: 'desc' }, take: 500 });
  const out: SimplifiedTracker[] = [];
  await prisma.$transaction(async (tx) => {
    for (const po of pos) out.push(await buildSimplifiedTrackerTx(tx, po.poNumber));
  });
  return out;
}
