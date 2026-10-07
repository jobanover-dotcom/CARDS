// Request approval contract.
//
//   REQUEST SECTION:    REQUESTED -> APPROVED | REJECTED
//                      (what is requested and still undecided is Follow-up Approval)
//
//   PURCHASE ORDER:    APPROVED -> PURCHASED -> RECEIVED
//                      (what is approved and unpurchased is Follow-up Purchase)
//
// These are two independent balances over the same requirement. A rejected unit
// belongs to neither: it can never be approved and can never be purchased, so it
// falls out of the procurement allowance without ever being subtracted from
// approvedQty.
//
// This file is the single source of truth for request statuses, the same way
// deliveryStatus.ts is for purchase orders. Status is ALWAYS derived from item
// quantities — never hand-written — because the derivation is the only thing
// that keeps "Approved 60 + Rejected 40" distinct from "Approved 100".

import { approvalOutstandingQty } from './deliveryQuantities'

export interface RequestStatusEntry {
  value: string
  label: string
  /** True while a decision is still owed on at least one line. */
  awaitingDecision: boolean
}

/** The only statuses the current workflow writes. */
export const REQUEST_STATUS = {
  PENDING: { value: 'Pending', label: 'Pending', awaitingDecision: true },
  APPROVED: { value: 'Approved', label: 'Approved', awaitingDecision: false },
  PARTIALLY_APPROVED: {
    value: 'Partially Approved',
    label: 'Partially Approved',
    awaitingDecision: true,
  },
  /** Some quantity approved, the remainder explicitly rejected, nothing owed. */
  APPROVAL_CLOSED: {
    value: 'Approval Closed',
    label: 'Approval Closed',
    awaitingDecision: false,
  },
  REJECTED: { value: 'Rejected', label: 'Rejected', awaitingDecision: false },
} as const satisfies Record<string, RequestStatusEntry>

export type RequestStatusValue = (typeof REQUEST_STATUS)[keyof typeof REQUEST_STATUS]['value']

/**
 * Statuses that still owe an approval decision. A request only leaves this set
 * once every line is either fully approved or explicitly rejected.
 */
export const AWAITING_DECISION_STATUSES: string[] = [
  REQUEST_STATUS.PENDING.value,
  REQUEST_STATUS.PARTIALLY_APPROVED.value,
]

/**
 * Statuses that block the warehouse from filing a follow-up against the request.
 * Approval Closed belongs here: its remainder was rejected outright, so there is
 * nothing left to re-request.
 */
export const BLOCKS_FOLLOW_UP_STATUSES: string[] = [
  REQUEST_STATUS.PENDING.value,
  REQUEST_STATUS.APPROVED.value,
  REQUEST_STATUS.PARTIALLY_APPROVED.value,
  REQUEST_STATUS.APPROVAL_CLOSED.value,
]

export interface ApprovalLineInput {
  qty: number
  approvedQty?: number | null
  rejectedQty?: number | null
}

export interface RequestApprovalState {
  status: RequestStatusValue
  requested: number
  approved: number
  rejected: number
  /** Units still awaiting a decision. Zero closes the approval stage. */
  outstanding: number
  /** True while Follow-up Approval is available. Never status-driven. */
  followUpAvailable: boolean
}

function tally(lines: readonly ApprovalLineInput[]) {
  const requested = lines.reduce((s, l) => s + Math.max(0, l.qty ?? 0), 0)
  const approved = lines.reduce((s, l) => s + Math.max(0, l.approvedQty ?? 0), 0)
  const rejected = lines.reduce((s, l) => s + Math.max(0, l.rejectedQty ?? 0), 0)
  const outstanding = lines.reduce(
    (s, l) => s + approvalOutstandingQty(l.qty, l.approvedQty, l.rejectedQty),
    0,
  )
  return { requested, approved, rejected, outstanding }
}

/**
 * The status a set of lines implies. This is the ONLY thing that may set
 * WarehouseRequest.status, so the badge, the counts and the action gates can
 * never disagree with the quantities behind them.
 *
 * Note the deliberate split between Approval Closed and Rejected: "60 of 100
 * approved, 40 rejected" is a different business outcome from "nothing was
 * approved", and collapsing them would lose that.
 */
export function deriveRequestApprovalStatus(
  lines: readonly ApprovalLineInput[],
  currentStatus?: string | null,
): RequestStatusValue {
  const { requested, approved, rejected, outstanding } = tally(lines)

  if (outstanding > 0) {
    // A decision is still owed. Partially Approved once any decision has been
    // recorded on any line; otherwise the request has never been reviewed.
    const decided = approved > 0 || rejected > 0
    if (!decided && currentStatus === REQUEST_STATUS.REJECTED.value) {
      return REQUEST_STATUS.REJECTED.value
    }
    return decided ? REQUEST_STATUS.PARTIALLY_APPROVED.value : REQUEST_STATUS.PENDING.value
  }

  // Nothing outstanding: every line is approved or rejected.
  if (rejected === 0) return REQUEST_STATUS.APPROVED.value
  if (approved === 0 && requested > 0) return REQUEST_STATUS.REJECTED.value
  if (approved === 0 && requested === 0) return REQUEST_STATUS.PENDING.value
  return REQUEST_STATUS.APPROVAL_CLOSED.value
}

/** Totals plus the derived status for one request's lines. */
export function requestApprovalState(lines: readonly ApprovalLineInput[], currentStatus?: string | null): RequestApprovalState {
  const totals = tally(lines)
  return {
    status: deriveRequestApprovalStatus(lines, currentStatus),
    ...totals,
    followUpAvailable: totals.outstanding > 0,
  }
}

/**
 * The approval balance of a request as the LIST views see it.
 *
 * This is the gate for the Follow-up Approval button, and it deliberately reads
 * quantities rather than `status`: the button must disappear once every line is
 * approved or rejected, whatever the stored status happens to say.
 */
export function requestApprovalOutstanding(
  items: readonly (ApprovalLineInput & { rejectedQty?: number | null })[] | null | undefined,
): number {
  if (!Array.isArray(items) || !items.length) return 0;
  return items.reduce(
    (s, l) => s + approvalOutstandingQty(l.qty, l.approvedQty, l.rejectedQty),
    0,
  );
}

/** True while a request still owes an approval decision on any line. */
export function isAwaitingDecision(lines: readonly ApprovalLineInput[], currentStatus?: string | null): boolean {
  return deriveRequestApprovalStatus(lines, currentStatus) === REQUEST_STATUS.PARTIALLY_APPROVED.value
}

/** Display label for a stored request status. Falls back to the raw value. */
export function requestStatusLabel(value: string | null | undefined): string {
  const match = Object.values(REQUEST_STATUS).find((s) => s.value === value)
  return match?.label ?? value ?? ''
}