'use server';

import { prisma } from '@/lib/prisma';
import type { Prisma } from '@prisma/client';
import { getCurrentUser } from './auth';
import { DELIVERY_STATUS, PO_STATUS, deliveryStatusLabel, poStatusLabel } from '@/src/lib/deliveryStatus';
import {
  assertValidDeliveredQty,
  assertValidReceivedQty,
  remainingToDeliver,
} from '@/src/lib/deliveryQuantities';
import {
  confirmPurchaseSchema,
  confirmReceivingSchema,
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

async function nextDeliveryNumber(tx: Tx, year: number) {
  const prefix = `DEL-${year}-`;
  const latest = await tx.delivery.findFirst({
    where: { deliveryNumber: { startsWith: prefix } },
    orderBy: { deliveryNumber: 'desc' },
    select: { deliveryNumber: true },
  });
  const next = latest ? parseInt(latest.deliveryNumber.slice(prefix.length), 10) + 1 : 1;
  return `${prefix}${String(next).padStart(4, '0')}`;
}

// Best-effort request gate: POs carry mrsNo but no FK to WarehouseRequest.
async function assertSourceRequestApprovable(tx: Tx, mrsNo: string) {
  const req = await tx.warehouseRequest.findFirst({ where: { mrsNo }, select: { status: true, mrsNo: true } });
  if (!req) return;
  if (req.status === 'Rejected' || req.status === 'Pending')
    throw new Error(`Source request ${mrsNo} is ${req.status}; only approved requests can proceed to delivery`);
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

// awaiting_purchase → purchase_confirmed. purchasedQty lives only on items.
export async function confirmPurchase(input: { poNumber: string; items: { poItemId: string; purchasedQty: number }[]; remarks?: string }) {
  const user = await assertCanManagePOs();
  const parsed = confirmPurchaseSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    const po = await tx.purchaseOrder.findUnique({ where: { poNumber: parsed.poNumber }, include: { items: true } });
    if (!po) throw new Error('Purchase order not found');
    if (po.status !== PO_STATUS.AWAITING_PURCHASE.value && po.status !== 'incomplete')
      throw new Error(`Only purchase orders awaiting purchase can be confirmed (current: ${po.status})`);

    const inputMap = new Map(parsed.items.map((i) => [i.poItemId, i.purchasedQty]));
    if (inputMap.size !== po.items.length) throw new Error('Every PO item must have a purchased quantity');
    for (const item of po.items) {
      const qty = inputMap.get(item.id);
      if (qty === undefined) throw new Error(`Missing purchased quantity for "${item.itemDescription}"`);
      if (!Number.isInteger(qty) || qty < 0)
        throw new Error(`Purchased quantity for "${item.itemDescription}" must be a whole number of 0 or more`);
      if (qty > item.qty)
        throw new Error(`Purchased quantity for "${item.itemDescription}" cannot exceed the ordered quantity of ${item.qty} ${item.unit}`);
      await tx.purchaseOrderItem.update({ where: { id: item.id }, data: { purchasedQty: qty } });
    }
    const updated = await tx.purchaseOrder.update({
      where: { poNumber: parsed.poNumber },
      data: {
        status: PO_STATUS.PURCHASE_CONFIRMED.value,
        statusLabel: poStatusLabel(PO_STATUS.PURCHASE_CONFIRMED.value),
        purchaseConfirmedAt: new Date(),
        purchaseConfirmedBy: user.username,
        notes: parsed.remarks?.trim() ? parsed.remarks.trim() : po.notes,
      },
    });
    await audit(tx, { poNumber: parsed.poNumber, action: 'purchase_confirmed', detail: parsed.remarks?.trim() ?? null, actor: user.username });
    return updated;
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

// [PROCEED TO DELIVERY] — creates the Delivery record. Recalculates remaining
// quantities from the database inside the transaction (row lock on the PO).
export async function proceedToDelivery(input: {
  poNumber: string;
  deliveredBy?: string;
  plateNumber?: string;
  deliveryDate: string;
  items: { poItemId: string; deliveredQty: number }[];
  remarks?: string;
}) {
  const user = await assertCanManagePOs();
  const parsed = proceedToDeliverySchema.parse(input);
  return prisma.$transaction(async (tx) => {
    await lockPO(tx, parsed.poNumber);
    const po = await tx.purchaseOrder.findUnique({
      where: { poNumber: parsed.poNumber },
      include: { items: { include: { deliveryItems: true } } },
    });
    if (!po) throw new Error('Purchase order not found');
    if (po.status !== PO_STATUS.READY_FOR_DELIVERY.value)
      throw new Error(`Only orders ready for delivery can proceed (current: ${po.status})`);
    if (po.mrsNo) await assertSourceRequestApprovable(tx, po.mrsNo);

    const inputMap = new Map(parsed.items.map((i) => [i.poItemId, i.deliveredQty]));
    const deliveryRows: { poItemId: string; purchasedQty: number; deliveredQty: number }[] = [];
    for (const item of po.items) {
      if (item.purchasedQty == null) throw new Error(`Item "${item.itemDescription}" has no confirmed purchased quantity`);
      const remaining = remainingToDeliver({ purchasedQty: item.purchasedQty, deliveries: item.deliveryItems });
      const claimed = inputMap.get(item.id) ?? 0;
      if (claimed === 0) continue;
      assertValidDeliveredQty(claimed, remaining, item.itemDescription);
      deliveryRows.push({ poItemId: item.id, purchasedQty: item.purchasedQty, deliveredQty: claimed });
    }
    if (!deliveryRows.length) throw new Error('There is nothing eligible for delivery: all quantities are fully delivered');

    const deliveryDate = new Date(parsed.deliveryDate);
    if (Number.isNaN(deliveryDate.getTime())) throw new Error('Invalid delivery date');
    const deliveryNumber = await nextDeliveryNumber(tx, deliveryDate.getFullYear());
    const hasTransport = !!(parsed.deliveredBy?.trim() && parsed.plateNumber?.trim());
    const delivery = await tx.delivery.create({
      data: {
        deliveryNumber,
        poNumber: po.poNumber,
        supplier: po.supplier,
        status: hasTransport ? DELIVERY_STATUS.IN_TRANSIT.value : DELIVERY_STATUS.FOR_DELIVERY.value,
        statusLabel: deliveryStatusLabel(hasTransport ? DELIVERY_STATUS.IN_TRANSIT.value : DELIVERY_STATUS.FOR_DELIVERY.value),
        deliveredBy: parsed.deliveredBy?.trim() || null,
        plateNumber: parsed.plateNumber?.trim() || null,
        deliveryDate,
        remarks: parsed.remarks?.trim() || null,
        createdBy: user.username,
        items: { create: deliveryRows },
      },
      include: deliveryInclude,
    });
    await audit(tx, {
      deliveryId: delivery.id,
      poNumber: po.poNumber,
      action: 'delivery_created',
      detail: `${deliveryNumber} (${deliveryRows.length} item line(s))`,
      actor: user.username,
    });
    return delivery;
  });
}

export async function updateDeliveryTransit(input: { deliveryNumber: string; deliveredBy: string; plateNumber: string; deliveryDate: string }) {
  const user = await getCurrentUser();
  if (!user || (user.role !== 'Admin' && user.role !== 'Superadmin' && user.role !== 'Warehouse'))
    throw new Error('Unauthorized');
  const parsed = updateDeliveryTransitSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    const delivery = await tx.delivery.findUnique({ where: { deliveryNumber: parsed.deliveryNumber }, include: { po: true } });
    if (!delivery) throw new Error('Delivery not found');
    if (user.role === 'Warehouse' && delivery.po.warehouse !== user.warehouse) throw new Error('Unauthorized');
    if (delivery.status !== DELIVERY_STATUS.FOR_DELIVERY.value) throw new Error('Only for-delivery shipments can be dispatched');
    const deliveryDate = new Date(parsed.deliveryDate);
    if (Number.isNaN(deliveryDate.getTime())) throw new Error('Invalid delivery date');
    const updated = await tx.delivery.update({
      where: { deliveryNumber: parsed.deliveryNumber },
      data: {
        deliveredBy: parsed.deliveredBy.trim(),
        plateNumber: parsed.plateNumber.trim(),
        deliveryDate,
        status: DELIVERY_STATUS.IN_TRANSIT.value,
        statusLabel: deliveryStatusLabel(DELIVERY_STATUS.IN_TRANSIT.value),
      },
      include: deliveryInclude,
    });
    await audit(tx, { deliveryId: delivery.id, poNumber: delivery.poNumber, action: 'delivery_in_transit', detail: `${parsed.deliveredBy.trim()} / ${parsed.plateNumber.trim()}`, actor: user.username });
    return updated;
  });
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

    // PO completes only when every purchased unit is received with no open
    // discrepancy on this PO's deliveries.
    const fresh = await tx.purchaseOrder.findUnique({
      where: { poNumber: delivery.poNumber },
      include: { items: { include: { deliveryItems: true } }, deliveries: { select: { status: true } } },
    });
    if (fresh) {
      const allReceived = fresh.items.every(
        (i) => (i.purchasedQty ?? 0) > 0 && i.deliveryItems.reduce((s, d) => s + d.receivedQty, 0) >= (i.purchasedQty ?? 0),
      );
      const hasOpenDiscrepancy = fresh.deliveries.some((d) => d.status === DELIVERY_STATUS.DISCREPANCY.value);
      if (allReceived && !hasOpenDiscrepancy && fresh.status !== PO_STATUS.COMPLETED.value) {
        await tx.purchaseOrder.update({
          where: { poNumber: fresh.poNumber },
          data: { status: PO_STATUS.COMPLETED.value, statusLabel: poStatusLabel(PO_STATUS.COMPLETED.value) },
        });
        await audit(tx, { poNumber: fresh.poNumber, action: 'po_completed', detail: 'All purchased quantities received', actor: user.username });
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
