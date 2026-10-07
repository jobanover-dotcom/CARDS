'use server';

import { prisma, runTx } from '@/lib/prisma';
import type { Prisma } from '@prisma/client';
import { getCurrentUser } from './auth';
import { buildPOChains } from './procurement';
import { isV1WorkflowPO } from '@/src/lib/poMigration';

type Tx = Prisma.TransactionClient;

export interface RequestItemInput { itemDescription: string; qty: number; unit: string; }
export interface RequestQuery { offset?: number; limit?: number; status?: string; search?: string; }

function buildRequestWhere(user: { role: string; warehouse: string } | null, params: RequestQuery = {}) {
  const scoped = user?.role === 'Warehouse';
  const where: Record<string, unknown> = {};
  if (scoped) where.warehouse = user.warehouse;
  if (params.status) where.status = params.status;
  if (params.search) where.OR = [{ mrsNo: { contains: params.search, mode: 'insensitive' } }, { items: { some: { itemDescription: { contains: params.search, mode: 'insensitive' } } } }];
  return where;
}

export async function getRequests(params: RequestQuery = {}) {
  const user = await getCurrentUser();
  if (!user) return { rows: [], total: 0 };
  const where = buildRequestWhere(user, params);
  const [rows, total] = await prisma.$transaction([
    prisma.warehouseRequest.findMany({ where, include: { items: true }, orderBy: { createdAt: 'desc' }, skip: params.offset ?? 0, take: params.limit ?? 10 }),
    prisma.warehouseRequest.count({ where }),
  ]);
  return { rows, total };
}

export async function getRequestCounts() {
  const user = await getCurrentUser();
  if (!user) return { total: 0, pending: 0, rejected: 0, approved: 0, partiallyApproved: 0 };
  const base = user.role === 'Warehouse' ? { warehouse: user.warehouse } : {};
  const [total, pending, rejected, approved, partiallyApproved] = await prisma.$transaction([
    prisma.warehouseRequest.count({ where: base }), prisma.warehouseRequest.count({ where: { ...base, status: 'Pending' } }),
    prisma.warehouseRequest.count({ where: { ...base, status: 'Rejected' } }), prisma.warehouseRequest.count({ where: { ...base, status: 'Approved' } }),
    prisma.warehouseRequest.count({ where: { ...base, status: 'Partially Approved' } }),
  ]);
  return { total, pending, rejected, approved, partiallyApproved };
}

function validateRequestItems(items: RequestItemInput[]) {
  if (!Array.isArray(items) || !items.length) throw new Error('At least one item is required');
  for (const item of items) {
    if (!item.itemDescription?.trim()) throw new Error('Every item needs a description');
    if (!Number.isInteger(item.qty) || item.qty < 1) throw new Error('Every item quantity must be a positive whole number');
  }
}

export async function createRequest(data: {
  date: string; reqNumber: string; items: RequestItemInput[]; mrsNo: string; requestedBy: string;
  requisitioner: string; followUpOfReqNumber?: string | null; followUpOfPoNumber?: string | null;
}) {
  const user = await getCurrentUser();
  if (!user) throw new Error('Unauthorized');
  validateRequestItems(data.items);
  const { items, ...rest } = data;

  if (rest.followUpOfReqNumber && rest.followUpOfPoNumber) throw new Error('A follow-up request cannot reference both a request and a purchase order');

  // Follow-up validation and creation run inside one transaction with row
  // locks on the source, so two simultaneous submissions cannot both pass
  // the duplicate/outstanding checks and create duplicate follow-ups.
  return runTx(async (tx) => {
    if (rest.followUpOfReqNumber) {
      await tx.$queryRaw`SELECT "reqNumber" FROM "WarehouseRequest" WHERE "reqNumber" = ${rest.followUpOfReqNumber} FOR UPDATE`;
      const source = await tx.warehouseRequest.findUnique({ where: { reqNumber: rest.followUpOfReqNumber }, include: { items: true } });
      if (!source) throw new Error(`Source request ${rest.followUpOfReqNumber} not found`);
      if (user.role === 'Warehouse' && source.warehouse !== user.warehouse) throw new Error('Unauthorized');
      const requestedByDescription = new Map(items.map((i) => [i.itemDescription.trim().toLowerCase(), i.qty]));
      for (const sourceItem of source.items) {
        const approved = sourceItem.approvedQty ?? 0;
        const remaining = Math.max(0, sourceItem.qty - approved);
        const requested = requestedByDescription.get(sourceItem.itemDescription.trim().toLowerCase()) ?? 0;
        if (requested > remaining) throw new Error(`Follow-up qty for "${sourceItem.itemDescription}" cannot exceed the remaining balance of ${remaining} ${sourceItem.unit}`);
      }
    }

    if (rest.followUpOfPoNumber) {
      // AUTHORIZATION: chasing a procurement shortfall is a purchaser action.
      // The Admin performs "Follow-up Purchase" against the SAME PO; Warehouse
      // must not be able to use this path as a procurement follow-up
      // mechanism. The branch itself is retained for historical compatibility
      // with follow-up requests that already exist against a PO.
      if (user.role !== 'Admin' && user.role !== 'Superadmin')
        throw new Error(
          'Unauthorized: a procurement follow-up against a purchase order is handled by the purchaser via Follow-up Purchase on the same PO',
        );
      await tx.$queryRaw`SELECT "poNumber" FROM "PurchaseOrder" WHERE "poNumber" = ${rest.followUpOfPoNumber} FOR UPDATE`;
      const source = await tx.purchaseOrder.findUnique({ where: { poNumber: rest.followUpOfPoNumber }, include: { items: { include: { monitoringItems: true } } } });
      if (!source) throw new Error(`Source purchase order ${rest.followUpOfPoNumber} not found`);
      const requestedByDescription = new Map(items.map((i) => [i.itemDescription.trim().toLowerCase(), i.qty]));
      const isV1 = isV1WorkflowPO(source);
      if (isV1) {
        // HARD-BLOCK: a procurement follow-up request may claim at most the
        // procurement outstanding balance (approved - purchased) per line. The
        // reporting-only outstanding total must never authorize procurement,
        // and a purchased-but-unreceived unit belongs to receiving, not to a
        // new procurement.
        const { chains } = await buildPOChains(tx, rest.followUpOfPoNumber);
        const claimed = (desc: string) => requestedByDescription.get(desc.trim().toLowerCase()) ?? 0;
        for (const chain of chains) {
          if (claimed(chain.itemDescription) > chain.procurementOutstanding)
            throw new Error(`Follow-up qty for "${chain.itemDescription}" cannot exceed the procurement outstanding balance of ${chain.procurementOutstanding} ${chain.unit} (approved ${chain.approvedQty}, purchased ${chain.purchasedQty}). ${chain.receivingOutstanding} unit(s) are already purchased and awaiting warehouse receiving — they must not be re-procured.`);
        }
        if (!chains.some((c) => claimed(c.itemDescription) > 0 && claimed(c.itemDescription) <= c.procurementOutstanding))
          throw new Error('No requested item has a procurement outstanding balance available for follow-up');
      } else {
        for (const sourceItem of source.items) {
          const received = sourceItem.monitoringItems[0]?.qtyReceived ?? 0;
          const remaining = Math.max(0, sourceItem.qty - received);
          const requested = requestedByDescription.get(sourceItem.itemDescription.trim().toLowerCase()) ?? 0;
          if (requested > remaining) throw new Error(`Follow-up qty for "${sourceItem.itemDescription}" cannot exceed the remaining balance of ${remaining} ${sourceItem.unit}`);
        }
        if (!items.some((i) => {
          const sourceItem = source.items.find((s) => s.itemDescription.trim().toLowerCase() === i.itemDescription.trim().toLowerCase());
          return sourceItem && i.qty <= Math.max(0, sourceItem.qty - (sourceItem.monitoringItems[0]?.qtyReceived ?? 0));
        })) throw new Error('No requested item has an outstanding delivery balance');
      }
    }

    const sourceNumber = rest.followUpOfReqNumber ?? rest.followUpOfPoNumber;
    if (sourceNumber) {
      const field = rest.followUpOfReqNumber ? 'followUpOfReqNumber' : 'followUpOfPoNumber';
      const existing = await tx.warehouseRequest.findFirst({ where: { [field]: sourceNumber, status: { in: ['Pending', 'Approved', 'Partially Approved'] } }, select: { mrsNo: true, status: true } });
      if (existing) throw new Error(`A follow-up (${existing.mrsNo}, ${existing.status}) already exists for this. Only a rejected follow-up can be refiled.`);
    }

    return tx.warehouseRequest.create({ data: { ...rest, warehouse: user.warehouse || null, status: 'Pending', remarks: null, items: { create: items.map((i) => ({ itemDescription: i.itemDescription.trim(), qty: i.qty, unit: i.unit })) } }, include: { items: true } });
  });
}

async function assertElevated() {
  const user = await getCurrentUser();
  if (!user || (user.role !== 'Admin' && user.role !== 'Superadmin')) throw new Error('Unauthorized: only purchasers and superadmins can decide requests');
}

export async function approveRequest(reqNumber: string) {
  await assertElevated();
  const req = await prisma.warehouseRequest.findUnique({ where: { reqNumber }, include: { items: true } });
  if (!req) throw new Error('Request not found');
  return runTx(async (tx) => {
    await Promise.all(req.items.map((it) => tx.warehouseRequestItem.update({ where: { id: it.id }, data: { approvedQty: it.qty } })));
    return tx.warehouseRequest.update({ where: { reqNumber }, data: { status: 'Approved' } });
  });
}

export async function approveRequestPartial(reqNumber: string, itemApprovals?: { id: string; approvedQty: number }[]) {
  await assertElevated();
  const req = await prisma.warehouseRequest.findUnique({ where: { reqNumber }, include: { items: true } });
  if (!req) throw new Error('Request not found');
  const approvalMap = new Map((itemApprovals || []).map((a) => [a.id, a.approvedQty]));
  return runTx(async (tx) => {
    let allFull = true;
    for (const item of req.items) {
      const raw = approvalMap.has(item.id) ? approvalMap.get(item.id)! : item.qty;
      if (!Number.isInteger(raw) || raw < 0) throw new Error(`Approved quantity for "${item.itemDescription}" must be a whole number of 0 or more`);
      const approvedQty = Math.min(raw, item.qty);
      if (approvedQty < item.qty) allFull = false;
      await tx.warehouseRequestItem.update({ where: { id: item.id }, data: { approvedQty } });
    }
    return tx.warehouseRequest.update({ where: { reqNumber }, data: { status: allFull ? 'Approved' : 'Partially Approved' } });
  });
}

export async function declineRequest(reqNumber: string, remarks: string) {
  await assertElevated();
  if (!remarks?.trim()) throw new Error('Remarks are required when declining a request');
  return prisma.warehouseRequest.update({ where: { reqNumber }, data: { status: 'Rejected', remarks: remarks.trim() } });
}

// Deleting a request is a cleanup action, not a decision about one. Deciding
// belongs to purchasers and superadmins alike (see assertElevated); erasing is
// reserved for the superadmin, matching the other permanent deletes in the app.
async function assertCanDeleteRequests() {
  const user = await getCurrentUser();
  if (!user || user.role !== 'Superadmin') throw new Error('Unauthorized: only superadmin can delete requests');
}

export async function deleteRequest(reqNumber: string) {
  await assertCanDeleteRequests();
  const request = await prisma.warehouseRequest.findUnique({ where: { reqNumber } });
  if (!request) throw new Error('Request not found');

  // PurchaseOrder.sourceReqNumber is a plain string with no foreign key, so the
  // database will happily let a purchase order outlive the request it was raised
  // against. That is not harmless: `loadSourceRequest` resolves a PO's approved
  // quantity by reqNumber first and then falls back to the earliest request
  // sharing the same mrsNo, so an orphaned link silently re-resolves against a
  // different request's approvedQty and corrupts every outstanding balance for
  // that MRS. Refuse, and name the POs so the superadmin knows what to remove.
  const linkedPOs = await prisma.purchaseOrder.findMany({ where: { sourceReqNumber: reqNumber }, select: { poNumber: true } });
  if (linkedPOs.length) {
    throw new Error(`Cannot delete request ${request.mrsNo} (${reqNumber}): purchase order(s) ${linkedPOs.map((p) => p.poNumber).join(', ')} were raised against it. Delete those purchase orders first.`);
  }

  // Line items cascade at the database level — WarehouseRequestItem.request is
  // onDelete: Cascade on reqNumber — so nothing is left orphaned here.
  return prisma.warehouseRequest.delete({ where: { reqNumber } });
}

export interface FollowUpInfo { reqNumber: string; mrsNo: string; status: string; }

export async function getFollowUpMap(sourceNumbers: string[], type: 'req' | 'po'): Promise<Record<string, FollowUpInfo[]>> {
  const user = await getCurrentUser();
  if (!user) throw new Error('Unauthorized');
  if (!Array.isArray(sourceNumbers) || !sourceNumbers.length) return {};
  const field = type === 'req' ? 'followUpOfReqNumber' : 'followUpOfPoNumber';
  const rows = await prisma.warehouseRequest.findMany({ where: { [field]: { in: sourceNumbers }, ...(user.role === 'Warehouse' ? { warehouse: user.warehouse } : {}) }, select: { reqNumber: true, mrsNo: true, status: true, [field]: true }, orderBy: { createdAt: 'desc' } });
  const map: Record<string, FollowUpInfo[]> = {};
  for (const r of rows) { const key = (r as Record<string, unknown>)[field] as string; if (key) (map[key] ??= []).push({ reqNumber: r.reqNumber, mrsNo: r.mrsNo, status: r.status }); }
  return map;
}
