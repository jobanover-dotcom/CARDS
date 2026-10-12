'use server';

import { prisma, runTx } from '@/lib/prisma';
import type { Prisma } from '@prisma/client';
import { getCurrentUser } from './auth';
import { buildPOChains } from './procurement';
import { lockMRS, lockMRSAdvisory } from '@/src/lib/poChain';
import { reconcileMRSCompletion } from '@/src/lib/poStatusReconcile';
import { isV1WorkflowPO } from '@/src/lib/poMigration';
import { approvalOutstandingQty } from '@/src/lib/deliveryQuantities';
import { aggregateItemQuantities } from '@/src/lib/mrsAggregates';
import {
  BLOCKS_FOLLOW_UP_STATUSES,
  REQUEST_STATUS,
  requestApprovalState,
} from '@/src/lib/requestApproval';
import {
  createRequestSchema,
  followUpApprovalSchema,
  rejectRemainingSchema,
} from '@/src/lib/validations/request';

type Tx = Prisma.TransactionClient;

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

/**
 * Authorization for creating a Warehouse Request.
 *
 * A Warehouse Request is raised BY a warehouse, for its own site. The role
 * allow-list is deliberate: `getCurrentUser()` alone would admit any profile
 * row, including a role string no guard recognises, and would let an Admin or
 * Superadmin file a request that `user.warehouse || null` files under NO
 * warehouse — invisible to every site's request list, since buildRequestWhere
 * scopes Warehouse users to their own warehouse.
 *
 * Purchaser and Superadmin create purchase orders and DECIDE requests; they do
 * not author them.
 */
function assertCanCreateRequest(user: { role: string; warehouse: string | null }) {
  if (user.role !== 'Warehouse')
    throw new Error('Unauthorized: only warehouse users can create material requests');
  if (!user.warehouse)
    throw new Error('Unauthorized: your account is not assigned to a warehouse');
  return user;
}

/**
 * Allocates an unused request number.
 *
 * The number used to be generated in the browser as `REQ-` plus a random five
 * digit number, so a persistent primary business identifier was chosen by the
 * caller from a 90,000-value space with no retry — a collision surfaced to the
 * user as a bare failure. It is now the server's to allocate.
 *
 * The FORMAT is unchanged (existing REQ-##### rows stay recognisable), the
 * bound is what is new: at most MAX_REQ_NUMBER_ATTEMPTS probes, then a clear
 * error. Never overwrites — it only ever creates.
 */
const MAX_REQ_NUMBER_ATTEMPTS = 5;

function candidateReqNumber(): string {
  return `REQ-${Math.floor(10000 + Math.random() * 90000)}`;
}

async function allocateReqNumber(tx: Prisma.TransactionClient): Promise<string> {
  for (let attempt = 1; attempt <= MAX_REQ_NUMBER_ATTEMPTS; attempt++) {
    const candidate = candidateReqNumber();
    const taken = await tx.warehouseRequest.findUnique({ where: { reqNumber: candidate }, select: { reqNumber: true } });
    if (!taken) return candidate;
  }
  throw new Error(
    `Could not allocate an unused request number after ${MAX_REQ_NUMBER_ATTEMPTS} attempts. Please try again.`,
  );
}

export async function createRequest(data: unknown) {
  const user = await getCurrentUser();
  if (!user) throw new Error('Unauthorized');

  // Validated at the boundary, before any authorization branch is chosen. Shape
  // only: this inspects the caller's own payload, reads nothing, and enforces the
  // mutual exclusion of the two follow-up sources — which is why it precedes the
  // role gates below (it did before this change too).
  const parsed = createRequestSchema.parse(data);

  const isPoFollowUp = !!parsed.followUpOfPoNumber;

  if (isPoFollowUp) {
    /**
     * The one deliberate exception to Warehouse-only creation, and it predates
     * it: a procurement follow-up against a purchase order is a PURCHASER
     * action, historically retained for follow-up requests that already exist
     * against a PO. It is not a reopening of general request creation for
     * Admin/Superadmin — no UI creates one, and CreateRequestModal never sends
     * this field (it directs the purchaser to Follow-up Purchase on the same PO
     * instead). The role check below is the pre-existing one, unchanged.
     *
     * Checked before the general gate so the refusal names the reason that
     * actually applies rather than the generic "only warehouse users" message.
     */
    if (user.role !== 'Admin' && user.role !== 'Superadmin')
      throw new Error(
        'Unauthorized: a procurement follow-up against a purchase order is handled by the purchaser via Follow-up Purchase on the same PO',
      );
  } else {
    assertCanCreateRequest(user);
  }

  const { items } = parsed;

  // Follow-up validation and creation run inside one transaction with row
  // locks on the source, so two simultaneous submissions cannot both pass
  // the duplicate/outstanding checks and create duplicate follow-ups.
  return runTx(async (tx) => {
    /**
     * The MRS a follow-up belongs to comes from its source, never from the
     * payload: a caller could otherwise file a follow-up onto an unrelated
     * material request and the two would never aggregate. Resolved from the
     * authoritative source below and defaulted here for a plain request, which
     * legitimately names its own MRS (there is no MRS catalogue to validate it
     * against).
     */
    let mrsNo = parsed.mrsNo;

      if (parsed.followUpOfReqNumber) {
        /**
         * Request-level follow-up is RETIRED. No role may create one.
         *
         * This branch used to admit a Warehouse caller: it locked the parent,
         * derived the MRS from it, and created a SECOND request for the
         * undecided balance. That produced a parallel approval chain — the new
         * request's approval never settled the parent's, so the parent stayed
         * `Partially Approved` with an outstanding balance forever — while buying
         * nothing, because the follow-up still waited on the same purchaser to
         * approve it.
         *
         * The remainder is now the PURCHASER's to settle on this same request,
         * via Follow-up Approval (approveRemaining / rejectRemaining), which adds
         * to the existing decision and lets the request actually close.
         *
         * Refused here rather than merely hidden in the UI, so removing the
         * warehouse button cannot be worked around by posting the field
         * directly. This closes the door for every role: a purchaser was already
         * stopped above by assertCanCreateRequest (only a warehouse may create a
         * material request at all), and the warehouse is stopped here.
         *
         * The creation logic is REMOVED rather than left unreachable behind the
         * throw: dead code after an unconditional throw is invisible to readers
         * and trips the action-layer type check. Rows created before the
         * retirement are unaffected — they only ever needed the READ paths
         * (getFollowUpMap, the lineage badges, restoreArchive), none of which
         * come through here.
         */
        throw new Error(
          'Request-level follow-up is no longer available. The remaining balance on a partially approved ' +
            'request is settled by the purchaser via Follow-up Approval on this same request.',
        );
      }

    if (parsed.followUpOfPoNumber) {
      // AUTHORIZATION: enforced above, before any write — this is the
      // pre-existing purchaser-only gate for the compatibility branch, unchanged.
      // Re-asserted inside the transaction so the role in force at write time is
      // the one authorized, not a value captured earlier.
      if (user.role !== 'Admin' && user.role !== 'Superadmin')
        throw new Error(
          'Unauthorized: a procurement follow-up against a purchase order is handled by the purchaser via Follow-up Purchase on the same PO',
        );
      await tx.$queryRaw`SELECT "poNumber" FROM "PurchaseOrder" WHERE "poNumber" = ${parsed.followUpOfPoNumber} FOR UPDATE`;
      const source = await tx.purchaseOrder.findUnique({ where: { poNumber: parsed.followUpOfPoNumber }, include: { items: { include: { monitoringItems: true } } } });
      if (!source) throw new Error(`Source purchase order ${parsed.followUpOfPoNumber} not found`);
      // The MRS comes from the PO being chased, never from the payload, so a
      // follow-up cannot be attached to an unrelated material request.
      mrsNo = source.mrsNo;
      const requestedByDescription = aggregateItemQuantities(items);
      const isV1 = isV1WorkflowPO(source);
      if (isV1) {
        // HARD-BLOCK: a procurement follow-up request may claim at most the
        // procurement outstanding balance (approved - purchased) per line. The
        // reporting-only outstanding total must never authorize procurement,
        // and a purchased-but-unreceived unit belongs to receiving, not to a
        // new procurement.
        const { chains } = await buildPOChains(tx, parsed.followUpOfPoNumber);
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
      /* c8 ignore stop */

    const sourceNumber = parsed.followUpOfReqNumber ?? parsed.followUpOfPoNumber;
    if (sourceNumber) {
      const field = parsed.followUpOfReqNumber ? 'followUpOfReqNumber' : 'followUpOfPoNumber';
      // One follow-up at a time per source: a SECOND follow-up is refused while an
      // existing one is still in a status that owes a decision (Pending, Approved,
      // Partially Approved, Approval Closed). The status filter reads the EXISTING
      // FOLLOW-UP's status, not the source's — a Rejected follow-up falls outside
      // BLOCKS_FOLLOW_UP_STATUSES precisely so it can be refiled.
      //
      // A source whose own status is Approval Closed is NOT blocked here. It is
      // refused earlier, by the outstanding-balance check, because Approval Closed
      // implies nothing is left undecided.
      const existing = await tx.warehouseRequest.findFirst({ where: { [field]: sourceNumber, status: { in: BLOCKS_FOLLOW_UP_STATUSES } }, select: { mrsNo: true, status: true } });
      if (existing) throw new Error(`A follow-up (${existing.mrsNo}, ${existing.status}) already exists for this. Only a rejected follow-up can be refiled.`);
    }

    const reqNumber = await allocateReqNumber(tx);

    // Explicit allow-list: only the fields the request contract owns reach the
    // insert. Spreading the parsed payload used to pass a caller-supplied `id`,
    // `createdAt` and `updatedAt` straight into the create.
    return tx.warehouseRequest.create({
      data: {
        date: parsed.date,
        reqNumber,
        mrsNo,
        requestedBy: parsed.requestedBy,
        requisitioner: parsed.requisitioner,
        followUpOfReqNumber: parsed.followUpOfReqNumber ?? null,
        followUpOfPoNumber: parsed.followUpOfPoNumber ?? null,
        // Server-owned, never taken from the payload.
        warehouse: user.warehouse ?? null,
        status: REQUEST_STATUS.PENDING.value,
        remarks: null,
        items: {
          create: items.map((i) => ({
            itemDescription: i.itemDescription.trim(),
            qty: i.qty,
            unit: i.unit.trim(),
          })),
        },
      },
      include: { items: true },
    });
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

/**
 * LOCK ORDER. Take the MRS advisory lock BEFORE the request row lock.
 *
 * Every decision action ends in finalizeApproval(), which re-divides the MRS
 * allocation and therefore needs the MRS lock. Acquiring the request row lock
 * first inverted the order against `createPOWithApproval`, which takes the MRS
 * lock and then the request row: an ABBA pair that can deadlock. The MRS lock is
 * now always first.
 *
 * The preliminary read is UNLOCKED and only discovers WHICH MRS lock to take —
 * it is never authoritative state. The real read happens after `lockRequest`,
 * and `assertMrsUnchanged` refuses to proceed if the association moved in between.
 *
 * Evidence that the association is in fact immutable in this application: there
 * is no `updateRequest` action, `updatePO`'s field type omits `mrsNo`, and no
 * code path writes `mrsNo` on either model after creation. The check below is
 * therefore defence in depth, not a routine branch.
 */
async function lockMRSFirst(tx: Tx, reqNumber: string): Promise<string | null> {
  const peek = await tx.warehouseRequest.findUnique({
    where: { reqNumber },
    select: { mrsNo: true },
  });
  if (peek?.mrsNo) await lockMRSAdvisory(tx, peek.mrsNo);
  await lockRequest(tx, reqNumber);
  return peek?.mrsNo ?? null;
}

/** Refuse to decide under a lock that was chosen from a stale MRS association. */
async function assertMrsUnchanged(tx: Tx, reqNumber: string, expected: string | null | undefined) {
  const now = await tx.warehouseRequest.findUnique({
    where: { reqNumber },
    select: { mrsNo: true },
  });
  if (!now) throw new Error(`Request ${reqNumber} not found`);
  if ((now.mrsNo ?? null) !== (expected ?? null)) {
    // Throwing rolls the transaction back, which releases both locks. Continuing
    // here would reconcile a requirement this transaction never locked.
    throw new Error(
      `Request ${reqNumber} changed its material request while this decision was being locked. ` +
        'No decision was applied. Retry the request.',
    );
  }
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

  // An approval amendment re-divides the requirement: `approvedQty` is what seeds
  // the allocation pool, so raising it can leave a recorded `completed` purchase
  // order responsible for more of the requirement than it has bought and received.
  // Settle the whole requirement in both directions — a PO that is complete while
  // owing units has silently left the queue that would surface it.
  //
  // Reached by every approval decision, including rejectRemaining, where it
  // harmlessly finds nothing: rejecting writes only `rejectedQty`, which is not
  // part of the pool. See src/lib/poStatusReconcile.ts.
  if (request.mrsNo) await lockMRS(tx, request.mrsNo);
  await reconcileMRSCompletion(tx, request.mrsNo, actor ?? 'system', 'both');

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
 * "no partial decision here" — no item carries its own quantity, so each line is
 * approved at its full requested quantity.
 *
 * A previously recorded rejection REFUSES the whole operation. This door used to
 * write `rejectedQty: 0` over such a line and settle the request as Approved,
 * quietly erasing a decision someone had already made (DEF-1). There is no honest
 * way to honour both at once: the quantity CHECK caps
 * `COALESCE(approvedQty,0) + rejectedQty <= qty`, so "approve the full 100 and
 * keep the 40 rejected" cannot be stored. Rather than pick a winner silently, the
 * request is refused and the caller decides the items individually instead.
 *
 * The check runs inside the transaction, after the MRS/request locks and after
 * authorization, so a refusal leaves every line, the request status and the audit
 * trail untouched — and an unauthorized caller cannot use the error to learn
 * whether a rejection is on record.
 */
export async function approveRequest(reqNumber: string) {
  const user = await assertElevatedActor();
  return runTx(async (tx) => {
    // MRS lock first, then the request row — see lockMRSFirst.
    const mrsNo = await lockMRSFirst(tx, reqNumber);
    await assertMrsUnchanged(tx, reqNumber, mrsNo);
    const lines = await loadDecisionLines(tx, reqNumber);
    // Refuse BEFORE the write loop: no line may be approved and no audit row
    // written before a rejection is discovered. The throw rolls the transaction
    // back, so the refusal is atomic.
    if (lines.some((line) => line.rejectedQty > 0)) {
      throw new Error(
        'This request already has a recorded rejection. Approving every line in full would erase it; ' +
          'decide the remaining items individually instead.',
      );
    }
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

/**
 * Approves SPECIFIC quantities on SPECIFIC lines.
 *
 * Partial approval must say what it approves. This door used to fall back to
 * `line.qty` for any line missing from the submission, so an OMITTED or EMPTY
 * submission approved every line in full — making this action
 * indistinguishable from `approveRequest`, and letting a caller erase a
 * recorded rejection simply by passing no data (DEF-1).
 *
 * A line still absent from a NON-EMPTY submission keeps the approve-in-full
 * default; that is this door's documented behaviour and callers rely on it. Only
 * the no-decision-at-all case is refused, because "approve everything" must be
 * asked for explicitly, on the door that means it.
 *
 * Every submitted id must belong to this request. An unknown id is an error
 * rather than a no-op: dropping it silently would leave that line unlisted, and
 * an unlisted line falls back to approve-in-full (DEF-1). The check runs inside
 * the transaction, before any write, and after authorization, so a bad submission
 * changes nothing and cannot be used to probe another request's contents.
 *
 * `finalizeApproval` then derives the request status from what was actually
 * written, so an approval that still owes a rejection lands on Approval Closed
 * rather than Approved.
 */
export async function approveRequestPartial(
  reqNumber: string,
  itemApprovals: { id: string; approvedQty: number }[],
) {
  const user = await assertElevatedActor();
  if (!Array.isArray(itemApprovals) || itemApprovals.length === 0) {
    throw new Error(
      'Partial approval requires the quantity to approve for at least one item. ' +
        'To approve every line in full, use the full approval action instead.',
    );
  }
  const approvalMap = new Map(itemApprovals.map((a) => [a.id, a.approvedQty]));
  return runTx(async (tx) => {
    // Lock and re-read inside the transaction: this used to read the request
    // BEFORE opening one, so two concurrent partial approvals could both settle
    // against the same stale balance. MRS lock first — see lockMRSFirst.
    const mrsNo = await lockMRSFirst(tx, reqNumber);
    await assertMrsUnchanged(tx, reqNumber, mrsNo);
    const lines = await loadDecisionLines(tx, reqNumber);
    // Every submitted id must be a line of THIS request. An unknown id used to be
    // dropped silently, which left that line unlisted — and an unlisted line
    // falls back to approve-in-full, so a typo could approve more than the caller
    // asked for. Refuse before any write; same message and same placement as the
    // follow-up doors.
    const knownIds = new Set(lines.map((line) => line.id));
    if (itemApprovals.some((a) => !knownIds.has(a.id))) {
      throw new Error('A submitted item does not belong to this request');
    }
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

/**
 * Rejects a caller reaching a request that belongs to another warehouse.
 *
 * Uses the same rule the read paths already use (`buildRequestWhere`), applied
 * as an explicit post-read assertion so the error is uniform: a Warehouse user
 * cannot tell a request they may not see from one that does not exist.
 */
function assertRequestVisibleTo(user: { role: string; warehouse: string | null }, request: { warehouse: string | null }) {
  if (user.role !== 'Warehouse') return;
  if (request.warehouse && request.warehouse === user.warehouse) return;
  throw new Error('Unauthorized');
}

/** Read-only seed for the Follow-up Approval form. */
export async function getRequestApprovalState(reqNumber: string) {
  const user = await getCurrentUser();
  if (!user) throw new Error('Unauthorized');
  const request = await prisma.warehouseRequest.findUnique({ where: { reqNumber }, include: { items: { orderBy: { itemDescription: 'asc' } } } });
  if (!request) throw new Error('Request not found');
  assertRequestVisibleTo(user, request);
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
    // MRS lock first, then the request row — see lockMRSFirst.
    const mrsNo = await lockMRSFirst(tx, parsed.reqNumber);
    await assertMrsUnchanged(tx, parsed.reqNumber, mrsNo);
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
    // not the one the browser displayed. MRS lock first — see lockMRSFirst.
    const mrsNo = await lockMRSFirst(tx, parsed.reqNumber);
    await assertMrsUnchanged(tx, parsed.reqNumber, mrsNo);
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
  // The log is keyed only by reqNumber, so the request is resolved and checked
  // first — otherwise a Warehouse user could pass another site's reqNumber and
  // read that site's approval decisions, including the deciding actor.
  const request = await prisma.warehouseRequest.findUnique({ where: { reqNumber }, select: { warehouse: true } });
  if (!request) throw new Error('Request not found');
  assertRequestVisibleTo(user, request);
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
 * Declines the WHOLE request. Distinct from Reject Remaining, which refuses only
 * the quantity still undecided; this refuses the request itself.
 *
 * It is a REQUEST-level verdict and deliberately writes no item row. The
 * per-line decisions already taken stay exactly as recorded on the request's
 * items and in the approval log: declining must not retract them, because those
 * rows are the auditable record of what was decided, by whom, and why. That
 * record is the point of keeping them, so this action writes neither the line
 * quantities nor a new approval-log entry.
 *
 * The verdict is carried by `status`, and the reason by `remarks`, which the
 * request details view already reads.
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
