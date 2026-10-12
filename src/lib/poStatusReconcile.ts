import type { Prisma } from '@prisma/client';

import { PO_STATUS, poLifecycle, poStatusLabel } from './deliveryStatus';
import { evaluatePOCompletion } from './deliveryQuantities';
import { normalizeItemDescription } from './mrsAggregates';
import { readMRSData } from './mrsRequirement';
import { chainFromPO } from './poChain';

/**
 * Settling a material request's purchase orders against each other.
 *
 * WHY A WRITE ON ONE PO HAS TO SETTLE ANOTHER
 *
 * `approvedQty` is a PO's ALLOCATED SHARE of the requirement, not its own line
 * qty, and it is recomputed from every PO on the same MRS (`allocateForMRS`, in
 * src/lib/mrsRequirement.ts). Pass 1 reserves what each PO has actually bought;
 * pass 2 hands the leftover to the newest PO. So adding units on ONE purchase
 * order — buying on it, or merely RAISING it, which reserves its line quantity —
 * shrinks a SIBLING's share. A sibling whose share falls to exactly what it
 * already bought and received is COMPLETE, without any of its own rows changing.
 *
 * `PurchaseOrder.status` is a stored column, written by whichever action touched a
 * PO. Left alone, such a sibling kept a status its own quantities had already
 * disproved and sat in the warehouse's In Progress section indefinitely. Every
 * action that can move a share must therefore re-evaluate the whole requirement,
 * not just the PO it was called with.
 *
 * THE DOORS, and which way each one moves a share
 *
 *   shrinks (forward — complete only): savePurchase, createFollowUpPO, createPO,
 *       createPOWithApproval, createPOFromApprovedRequest
 *   grows (both directions):            approveRequest, approveRequestPartial,
 *                                       approveRemaining, deletePO, restoreArchive
 *
 * `direction` says which of those a given call site is entitled to do. The default
 * is forward, and that default is the point: from a purchase or a raise the
 * leftover pool can only shrink, so a PO settled here can only become MORE
 * complete, and completing is the only conclusion those call sites can justify.
 *
 * The growing doors need `both`, because a share that grows leaves a recorded
 * `completed` purchase order owing units it never owed before — and a PO that is
 * complete while owing units is worse than one that is stuck, because it has
 * silently left the queue that would surface it. That reopen rule is not new: it
 * is the same one `editLatestReceiving` already applies, for the same reason.
 *
 * NOT a door, despite looking like one: `rejectRemaining`. The allocation pool is
 * seeded from `approvedQty` alone (src/lib/mrsRequirement.ts), and that action
 * writes only `rejectedQty` — explicitly, so units already approved stay approved
 * and stay purchasable. Rejecting therefore moves no share, in either direction.
 * `approveRequestPartial` IS a door, and in both directions, because it writes
 * `approvedQty` to whatever the caller sends.
 */

type Tx = Prisma.TransactionClient;

export type ReconcileDirection = 'forward' | 'both';

export interface MRSCompletionResult {
  /** purchase orders this call moved to completed */
  completed: string[];
  /** purchase orders this call reopened; always empty unless direction is 'both' */
  reopened: string[];
}

/**
 * Re-evaluate completion for EVERY purchase order on one material request.
 *
 * Read inside the caller's transaction, so it prices the requirement as it stands
 * after that transaction's own writes — which is the point: the write that settled
 * a sibling is one this call has to see.
 *
 * No-ops when nothing is stranded, which is the common case: no audit row is
 * written and no status is touched unless one actually disagrees with the
 * requirement.
 */
export async function reconcileMRSCompletion(
  tx: Tx,
  mrsNo: string,
  actor: string,
  direction: ReconcileDirection = 'forward',
): Promise<MRSCompletionResult> {
  const empty: MRSCompletionResult = { completed: [], reopened: [] };
  if (!mrsNo) return empty;

  // One batched read of the requirement's allocations, so every candidate is
  // priced against the SAME view. Reading per PO would re-scan the whole
  // requirement each time.
  const { allocations, pos } = await readMRSData(tx, [mrsNo]);
  if (!pos.length) return empty;

  // Cancelled POs keep the requirement's units reserved — the allocation walk reads
  // no status — so they are never judged in either direction. A completed PO is
  // only a candidate at all when this call is entitled to reopen.
  const candidates = pos.filter((po) => {
    const lifecycle = poLifecycle(po.status);
    if (lifecycle === PO_STATUS.CANCELLED.value) return false;
    if (lifecycle === PO_STATUS.COMPLETED.value) return direction === 'both';
    return lifecycle !== null;
  });
  if (!candidates.length) return empty;

  // `pos` from readMRSData projects item rows down to the quantity fields, with
  // no ids, so the chain's own ids are read here for the candidates alone.
  const detailed = await tx.purchaseOrder.findMany({
    where: { poNumber: { in: candidates.map((p) => p.poNumber) } },
    include: { items: true },
  });

  const completed: string[] = [];
  const reopened: string[] = [];
  for (const po of detailed) {
    const lines = allocations.get(mrsNo)?.get(po.poNumber);
    const allocation = lines
      ? new Map(
          lines.map((l) => [normalizeItemDescription(l.itemDescription), l.allocatedApproved]),
        )
      : undefined;
    const { chains } = await chainFromPO(tx, po, undefined, allocation);
    const canComplete = evaluatePOCompletion({ chains }).canComplete;
    const wasCompleted = poLifecycle(po.status) === PO_STATUS.COMPLETED.value;
    if (canComplete === wasCompleted) continue;

    if (canComplete) {
      await tx.purchaseOrder.update({
        where: { poNumber: po.poNumber },
        data: {
          status: PO_STATUS.COMPLETED.value,
          statusLabel: poStatusLabel(PO_STATUS.COMPLETED.value),
        },
      });
      await writePOAudit(tx, {
        poNumber: po.poNumber,
        action: 'po_completed',
        detail:
          'Every PO item is fully purchased and fully received — its share of ' +
          `${mrsNo} was settled by a purchase recorded on another purchase order`,
        actor,
      });
      completed.push(po.poNumber);
    } else {
      // Reopening. A PO only ever reopens with its purchases intact, so it returns
      // to in_progress — the same conclusion recordReceiving reaches when it finds
      // work still outstanding.
      await tx.purchaseOrder.update({
        where: { poNumber: po.poNumber },
        data: {
          status: PO_STATUS.IN_PROGRESS.value,
          statusLabel: poStatusLabel(PO_STATUS.IN_PROGRESS.value),
        },
      });
      await writePOAudit(tx, {
        poNumber: po.poNumber,
        action: 'po_reopened',
        detail:
          'The requirement no longer supports completion — this purchase order is ' +
          `responsible for more of ${mrsNo} than it has bought and received`,
        actor,
      });
      reopened.push(po.poNumber);
    }
  }
  return { completed, reopened };
}

/**
 * Reuses DeliveryAuditLog (poNumber required, deliveryId nullable) so purchase and
 * receiving history share one log. deliveryId stays null: the active workflow has
 * no delivery records.
 */
async function writePOAudit(
  tx: Tx,
  entry: { poNumber: string; action: string; detail: string; actor: string },
) {
  await tx.deliveryAuditLog.create({
    data: {
      deliveryId: null,
      poNumber: entry.poNumber,
      action: entry.action,
      detail: entry.detail,
      actor: entry.actor,
    },
  });
}