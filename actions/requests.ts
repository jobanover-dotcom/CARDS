'use server';

import { prisma, runTx } from '@/lib/prisma';
import type { Prisma } from '@prisma/client';
import { getCurrentUser } from './auth';
import { buildPOChains } from './procurement';
import { isV1WorkflowPO } from '@/src/lib/poMigration';
import { approvalOutstandingQty } from '@/src/lib/deliveryQuantities';
import {
  BLOCKS_FOLLOW_UP_STATUSES,
  REQUEST_STATUS,
  requestApprovalState,
} from '@/src/lib/requestApproval';
import { followUpApprovalSchema, rejectRemainingSchema } from '@/src/lib/validations/request';

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
  if (!user) return { total: 0, pending: 0, rejected: 0, approved: 0, partiallyApproved: 0, approvalClosed: 0 };
  const base = user.role === 'Warehouse' ? { warehouse: user.warehouse } : {};
  const [total, pending, rejected, approved, partiallyApproved, approvalClosed] = await prisma.$transaction([
    prisma.warehouseRequest.count({ where: base }), prisma.warehouseRequest.count({ where: { ...base, status: REQUEST_STATUS.PENDING.value } }),
    prisma.warehouseRequest.count({ where: { ...base, status: REQUEST_STATUS.REJECTED.value } }), prisma.warehouseRequest.count({ where: { ...base, status: REQUEST_STATUS.APPROVED.value } }),
    prisma.warehouseRequest.count({ where: { ...base, status: REQUEST_STATUS.PARTIALLY_APPROVED.value } }),
    prisma.warehouseRequest.count({ where: { ...base, status: REQUEST_STATUS.APPROVAL_CLOSED.value } }),
  ]);
  return { total, pending, rejected, approved, partiallyApproved, approvalClosed };
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
        // Rejected quantity is NOT re-requestable: rejecting the remainder closed
        // that decision permanently, so it must not re-enter the balance here.
        const remaining = approvalOutstandingQty(sourceItem.qty, sourceItem.approvedQty, sourceItem.rejectedQty);
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
      // Approval Closed blocks too: its remainder was rejected outright, so there
      // is nothing left for the warehouse to ask for.
      const existing = await tx.warehouseRequest.findFirst({ where: { [field]: sourceNumber, status: { in: BLOCKS_FOLLOW_UP_STATUSES } }, select: { mrsNo: true, status: true } });
      if (existing) throw new Error(`A follow-up (${existing.mrsNo}, ${existing.status}) already exists for this. Only a rejected follow-up can be refiled.`);
    }

    return tx.warehouseRequest.create({ data: { ...rest, warehouse: user.warehouse || null, status: REQUEST_STATUS.PENDING.value, remarks: null, items: { create: items.map((i) => ({ itemDescription: i.itemDescription.trim(), qty: i.qty, unit: i.unit })) } }, include: { items: true } });
  });
}

/**
 * Authorization for every request decision. Returns the caller so the audit log
 * records who decided, rather than forcing a second getCurrentUser() per action.
 */
async function assertElevatedActor() {
  const user = await getCurrentUser();
  if (!user || (user.role !== 'Admin' && user.role !== 'Superadmin')) throw new Error('Unauthorized: only purchasers and superadmins can decide requests');
  return user;
}

async function assertElevated() {
  await assertElevatedActor();
}

/**
 * Serialize approval writes on one request so two purchasers cannot both read the
 * same outstanding balance and each act on it. Without this, two +30 submissions
 * against a 40 remainder would settle at 60 approved and 20 outstanding, and
 * approvedQty could exceed qty outright.
 *
 * Same pattern as lockPO / lockMRS in actions/procurement.ts; createRequest
 * already inlined an identical lock for its own follow-up check.
 */
async function lockRequest(tx: Tx, reqNumber: string) {
  await tx.$queryRaw`SELECT "reqNumber" FROM "WarehouseRequest" WHERE "reqNumber" = ${reqNumber} FOR UPDATE`;
}

interface DecisionLine {
  id: string
  itemDescription: string
  unit: string
  qty: number
  approvedQty: number | null
  rejectedQty: number
}

interface ApprovalDecision {
  action: string
  reqItemId?: string | null
  itemDescription?: string | null
  qty: number
  reason?: string | null
}

/**
 * Derives the request status and records the decisions.
 *
 * Every approval path calls this AFTER writing its line quantities, so the status
 * is derived from the state the transaction actually produced rather than from a
 * snapshot read beforehand. Callers own the quantity arithmetic; this owns the
 * invariant that status and quantities can never disagree.
 */
async function finalizeApproval(
  tx: Tx,
  reqNumber: string,
  decisions: ApprovalDecision[],
  actor: string | null,
) {
  const lines = await tx.warehouseRequestItem.findMany({ where: { reqNumber }, orderBy: { itemDescription: 'asc' } });
  const state = requestApprovalState(lines, null);

  const request = await tx.warehouseRequest.update({
    where: { reqNumber },
    data: { status: state.status },
    include: { items: true },
  });

  // A decision that changed nothing is not a decision. Skipping it keeps the log
  // a record of what actually happened rather than of what was clicked.
  for (const decision of decisions) {
    if (decision.qty <= 0) continue;
    await tx.requestApprovalLog.create({
      data: {
        reqNumber,
        reqItemId: decision.reqItemId ?? null,
        itemDescription: decision.itemDescription ?? null,
        action: decision.action,
        qty: decision.qty,
        reason: decision.reason ?? null,
        actor,
      },
    });
  }

  return request;
}

/** Load the request's lines inside the caller's transaction. */
async function loadDecisionLines(tx: Tx, reqNumber: string): Promise<DecisionLine[]> {
  const items = await tx.warehouseRequestItem.findMany({ where: { reqNumber } });
  if (!items.length) throw new Error(`Request ${reqNumber} has no item lines`);
  return items.map((it) => ({
    id: it.id,
    itemDescription: it.itemDescription,
    unit: it.unit,
    qty: it.qty,
    approvedQty: it.approvedQty,
    rejectedQty: it.rejectedQty ?? 0,
  }));
}

/**
 * Approves every line in full. Kept as a distinct action because the caller means
 * "no partial decision here" — a line that was already rejected must not have its
 * rejection silently overwritten, so a fully-approved request with a rejection on
 * record resolves to Approval Closed rather than Approved.
 */
export async function approveRequest(reqNumber: string) {
  const user = await assertElevatedActor();
  return runTx(async (tx) => {
    await lockRequest(tx, reqNumber);
    const lines = await loadDecisionLines(tx, reqNumber);
    const decisions: ApprovalDecision[] = [];
    for (const line of lines) {
      if ((line.approvedQty ?? 0) === line.qty && line.rejectedQty === 0) continue;
      await tx.warehouseRequestItem.update({
        where: { id: line.id },
        data: { approvedQty: line.qty, rejectedQty: 0 },
      });
      decisions.push({
        action: 'additional_approved',
        reqItemId: line.id,
        itemDescription: line.itemDescription,
        qty: line.qty - (line.approvedQty ?? 0),
      });
    }
    return finalizeApproval(tx, reqNumber, decisions, user.username);
  });
}

export async function approveRequestPartial(reqNumber: string, itemApprovals?: { id: string; approvedQty: number }[]) {
  const user = await assertElevatedActor();
  const approvalMap = new Map((itemApprovals || []).map((a) => [a.id, a.approvedQty]));
  return runTx(async (tx) => {
    // Lock and re-read inside the transaction: this used to read the request
    // BEFORE opening one, so two concurrent partial approvals could both settle
    // against the same stale balance.
    await lockRequest(tx, reqNumber);
    const lines = await loadDecisionLines(tx, reqNumber);
    const decisions: ApprovalDecision[] = [];
    for (const line of lines) {
      const raw = approvalMap.has(line.id) ? approvalMap.get(line.id)! : line.qty;
      if (!Number.isInteger(raw) || raw < 0) throw new Error(`Approved quantity for "${line.itemDescription}" must be a whole number of 0 or more`);
      const approvedQty = Math.min(raw, line.qty);
      // Rejected quantity stays rejected, except where a LARGER approval has
      // absorbed it — approved and rejected can never both hold the same unit.
      const rejectedQty = Math.min(line.rejectedQty, Math.max(0, line.qty - approvedQty));
      if (approvedQty !== line.approvedQty || rejectedQty !== line.rejectedQty) {
        await tx.warehouseRequestItem.update({ where: { id: line.id }, data: { approvedQty, rejectedQty } });
        decisions.push({
          action: 'additional_approved',
          reqItemId: line.id,
          itemDescription: line.itemDescription,
          qty: approvedQty - (line.approvedQty ?? 0),
        });
      }
    }
    return finalizeApproval(tx, reqNumber, decisions, user.username);
  });
}

// ---------------------------------------------------------------------------
// Follow-up Approval — the Request section's own workflow.
//
// It settles `requested - approved - rejected`, and is deliberately NOT
// Follow-up Purchase, which settles `approved - purchased` in the PO section.
// Nothing here creates a request, an MRS or a purchase order: the original
// request stays the parent and any PO created afterwards reads the raised
// approved quantity through the existing MRS allowance logic.
// ---------------------------------------------------------------------------

/** Read-only seed for the Follow-up Approval form. */
export async function getRequestApprovalState(reqNumber: string) {
  const user = await getCurrentUser();
  if (!user) throw new Error('Unauthorized');
  const request = await prisma.warehouseRequest.findUnique({ where: { reqNumber }, include: { items: { orderBy: { itemDescription: 'asc' } } } });
  if (!request) throw new Error('Request not found');
  const lines = request.items.map((it) => ({
    id: it.id,
    itemDescription: it.itemDescription,
    unit: it.unit,
    qty: it.qty,
    approvedQty: it.approvedQty,
    rejectedQty: it.rejectedQty ?? 0,
    outstanding: approvalOutstandingQty(it.qty, it.approvedQty, it.rejectedQty ?? 0),
  }));
  const state = requestApprovalState(request.items, request.status);
  return {
    reqNumber: request.reqNumber,
    mrsNo: request.mrsNo,
    status: request.status,
    items: lines,
    // The request's own header fields, so the PO handoff seeds from the request
    // rather than from anything the browser typed.
    requisitioner: request.requisitioner,
    requestedBy: request.requestedBy,
    warehouse: request.warehouse,
    date: request.date,
    ...state,
    followUpAvailable: state.followUpAvailable,
  };
}

/**
 * Approve some or all of the remaining unapproved quantity.
 *
 * The submitted numbers are INCREMENTS over what is already approved. The cap is
 * recomputed from the rows read inside this transaction, never from what the
 * browser displayed, so two purchasers acting at once cannot both settle against
 * the same balance and drive approvedQty past qty.
 */
export async function approveRemaining(input: unknown) {
  const user = await assertElevatedActor();
  const parsed = followUpApprovalSchema.parse(input);

  return runTx(async (tx) => {
    await lockRequest(tx, parsed.reqNumber);
    const lines = await loadDecisionLines(tx, parsed.reqNumber);
    const byId = new Map(lines.map((l) => [l.id, l]));

    const decisions: ApprovalDecision[] = [];
    for (const entry of parsed.items) {
      const line = byId.get(entry.id);
      if (!line) throw new Error('A submitted item does not belong to this request');
      if (entry.additionalApproval === 0) continue;
      const outstanding = approvalOutstandingQty(line.qty, line.approvedQty, line.rejectedQty);
      // Reject rather than clamp: silently truncating a purchaser's decision
      // would leave approved and rejected summing to less than requested, with
      // no record of why.
      if (entry.additionalApproval > outstanding) {
        throw new Error(
          `Additional approval for "${line.itemDescription}" cannot exceed the ${outstanding} ${line.unit} still awaiting approval (requested ${line.qty}, approved ${line.approvedQty ?? 0}, rejected ${line.rejectedQty})`,
        );
      }
      // approved + rejected must never exceed requested. Checked explicitly as
      // well as via the outstanding cap, so the database-level CHECK can never be
      // the first thing to notice.
      const approvedQty = (line.approvedQty ?? 0) + entry.additionalApproval;
      if (approvedQty + line.rejectedQty > line.qty) {
        throw new Error(`Approved and rejected quantity for "${line.itemDescription}" cannot exceed the requested ${line.qty} ${line.unit}`);
      }
      await tx.warehouseRequestItem.update({
        where: { id: line.id },
        data: { approvedQty, rejectedQty: line.rejectedQty },
      });
      decisions.push({
        action: 'additional_approved',
        reqItemId: line.id,
        itemDescription: line.itemDescription,
        qty: entry.additionalApproval,
      });
    }

    if (!decisions.length) throw new Error('Enter an additional approval quantity for at least one item');
    return finalizeApproval(tx, parsed.reqNumber, decisions, user.username);
  });
}

/**
 * Reject the remaining unapproved quantity of the named lines.
 *
 * Only the OUTSTANDING quantity is rejected. Units already approved stay
 * approved and remain available for ordinary PO processing — this action never
 * writes approvedQty.
 */
export async function rejectRemaining(input: unknown) {
  const user = await assertElevatedActor();
  const parsed = rejectRemainingSchema.parse(input);

  return runTx(async (tx) => {
    // Re-read inside the transaction, under the request lock: the outstanding
    // balance a rejection is measured against must be the one that exists now,
    // not the one the browser displayed.
    await lockRequest(tx, parsed.reqNumber);
    const lines = await loadDecisionLines(tx, parsed.reqNumber);
    const byId = new Map(lines.map((l) => [l.id, l]));

    const decisions: ApprovalDecision[] = [];
    for (const entry of parsed.items) {
      const line = byId.get(entry.id);
      if (!line) throw new Error('A submitted item does not belong to this request');
      const outstanding = approvalOutstandingQty(line.qty, line.approvedQty, line.rejectedQty);
      if (outstanding === 0) continue;
      // Rejected is set to the whole remainder rather than incremented, so
      // rejecting twice is a no-op. approvedQty is never written here: the units
      // already approved stay approved and stay purchasable.
      const rejectedQty = line.qty - (line.approvedQty ?? 0);
      await tx.warehouseRequestItem.update({
        where: { id: line.id },
        data: { rejectedQty },
      });
      decisions.push({
        action: 'remaining_rejected',
        reqItemId: line.id,
        itemDescription: line.itemDescription,
        qty: outstanding,
        reason: parsed.reason,
      });
    }

    if (!decisions.length) throw new Error('There is no remaining quantity left to reject on this request');
    return finalizeApproval(tx, parsed.reqNumber, decisions, user.username);
  });
}

/** Approval history for a request, newest first. */
export async function getRequestApprovalLog(reqNumber: string) {
  const user = await getCurrentUser();
  if (!user) throw new Error('Unauthorized');
  const rows = await prisma.requestApprovalLog.findMany({ where: { reqNumber }, orderBy: { createdAt: 'desc' } });
  return rows.map((r) => ({
    id: r.id,
    reqNumber: r.reqNumber,
    reqItemId: r.reqItemId,
    itemDescription: r.itemDescription,
    action: r.action,
    qty: r.qty,
    reason: r.reason,
    actor: r.actor,
    createdAt: r.createdAt,
  }));
}

/**
 * Declines the WHOLE request. Distinct from Reject Remaining: this refuses
 * everything, so it does reset every line rather than only the unapproved
 * remainder, and it keeps writing the reason to `remarks` where the request
 * details view already reads it.
 */
export async function declineRequest(reqNumber: string, remarks: string) {
  await assertElevated();
  if (!remarks?.trim()) throw new Error('Remarks are required when declining a request');
  return prisma.warehouseRequest.update({ where: { reqNumber }, data: { status: REQUEST_STATUS.REJECTED.value, remarks: remarks.trim() } });
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
