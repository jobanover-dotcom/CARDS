// Pure server-side quantity math for CARDS.
//
//   APPROVED -> PURCHASED -> RECEIVED
//
// This is the ONLY place the quantity chain is defined. Server actions
// recompute it from the database inside their transaction; dashboards, tables
// and forms all render these numbers and never compute their own.
//
// Two balances answer two different workflow questions and are never mixed:
//
//   procurementOutstanding = max(0, approved - purchased)
//       Purchaser/Admin may still BUY against the requirement. One MRS can have
//       several POs, because one PO is one purchasing transaction with one
//       supplier; buying more raises a NEW PO on the same MRS rather than
//       amending the one already bought from. The approved quantity belongs to
//       the MRS and is read once from the requirement — it is never summed
//       across the POs raised against it (see mrsAggregates.ts).
//
//   receivingOutstanding = max(0, purchased - received)
//       Warehouse may still record a receiving event. Not a procurement action
//       and never a new request.
//
// The two are strictly independent. Units already bought but not yet arrived are
// receiving work: they must never produce a procurement follow-up, or the same
// quantity would be bought twice.
//
// The "Delivered" layer belonged to the retired system-controlled delivery
// workflow. The helpers below that read Delivery rows are preserved for
// historical DEL-* archive data only.

// ---------------------------------------------------------------------------
// Canonical chain
// ---------------------------------------------------------------------------

export interface POItemChainInput {
  requestedQty: number | null | undefined
  approvedQty: number | null | undefined
  purchasedQty: number | null | undefined
  receivedQty: number | null | undefined
}

export interface POItemChain {
  requestedQty: number
  approvedQty: number
  purchasedQty: number
  receivedQty: number
  /** max(0, approved - purchased) — the only purchase allowance */
  procurementOutstanding: number
  /** max(0, purchased - received) — the only warehouse receiving allowance */
  receivingOutstanding: number
  /** true once this line satisfies purchased >= approved and received >= purchased */
  complete: boolean
  /** true while the purchaser still has approved units left to buy */
  followUpRequired: boolean
}

/** Follow-up belongs to the purchaser: what is approved but not yet purchased. */
export function procurementOutstandingQty(
  approvedQty: number | null | undefined,
  purchasedQty: number | null | undefined,
): number {
  return Math.max(0, (approvedQty ?? 0) - (purchasedQty ?? 0))
}

/** Receiving shortfall belongs to the warehouse: what is purchased but not received. */
export function receivingOutstandingQty(
  purchasedQty: number | null | undefined,
  receivedQty: number | null | undefined,
): number {
  return Math.max(0, (purchasedQty ?? 0) - (receivedQty ?? 0))
}

export function buildPOItemChain(input: POItemChainInput): POItemChain {
  const requestedQty = Math.max(0, input.requestedQty ?? 0)
  const approvedQty = Math.max(0, input.approvedQty ?? 0)
  const purchasedQty = Math.max(0, input.purchasedQty ?? 0)
  const receivedQty = Math.max(0, input.receivedQty ?? 0)
  const procurementOutstanding = Math.max(0, approvedQty - purchasedQty)
  const receivingOutstanding = Math.max(0, purchasedQty - receivedQty)
  return {
    requestedQty,
    approvedQty,
    purchasedQty,
    receivedQty,
    procurementOutstanding,
    receivingOutstanding,
    complete: purchasedQty >= approvedQty && receivedQty >= purchasedQty,
    followUpRequired: procurementOutstanding > 0,
  }
}

// ---------------------------------------------------------------------------
// PO completion. EVERY line must be fully purchased AND fully received.
// A single aggregate must never be able to hide one incomplete line.
// ---------------------------------------------------------------------------

export interface POCompletionInput {
  chains: { approvedQty: number; purchasedQty: number; receivedQty: number }[]
}

export interface POCompletion {
  /** every line fully purchased */
  procurementComplete: boolean
  /** every line fully received against what was purchased */
  receivingComplete: boolean
  /** sum of the two outstanding balances, for display only */
  procurementOutstanding: number
  receivingOutstanding: number
  /** the only condition under which a PO may become COMPLETED */
  canComplete: boolean
}

export function evaluatePOCompletion(input: POCompletionInput): POCompletion {
  const chains = input.chains ?? []
  const procurementOutstanding = chains.reduce(
    (s, c) => s + Math.max(0, c.approvedQty - c.purchasedQty),
    0,
  )
  const receivingOutstanding = chains.reduce(
    (s, c) => s + Math.max(0, c.purchasedQty - c.receivedQty),
    0,
  )
  // An empty PO never completes: there is nothing to have completed.
  const procurementComplete =
    chains.length > 0 && chains.every((c) => c.purchasedQty >= c.approvedQty)
  const receivingComplete =
    chains.length > 0 && chains.every((c) => c.receivedQty >= c.purchasedQty)
  return {
    procurementComplete,
    receivingComplete,
    procurementOutstanding,
    receivingOutstanding,
    canComplete: procurementComplete && receivingComplete,
  }
}

// ---------------------------------------------------------------------------
// Display progress. A conclusion drawn ONLY from the canonical chain above, so
// a table can never show a stage the quantities disagree with.
//
// It is deliberately NOT the stored `PurchaseOrder.status`: a legacy status
// string records how a PO once got there, not what is still outstanding. This
// is what lets one PO report "Mixed Progress" instead of being forced into a
// single stage its items do not share.
//
// Supplier delivery is external to CARDS, so no stage here ever mentions it.
// "Purchased" is not "Received": a fully purchased PO is Awaiting Receiving.
// ---------------------------------------------------------------------------

export type POProgressStatus =
  | 'awaiting_purchase'
  | 'awaiting_receiving'
  | 'mixed'
  | 'completed'

/** Human label per progress stage. Rendered verbatim; never hand-typed. */
export const PO_PROGRESS_LABEL: Record<POProgressStatus, string> = {
  awaiting_purchase: 'Awaiting Purchase',
  awaiting_receiving: 'Awaiting Receiving',
  mixed: 'Mixed Progress',
  completed: 'Completed',
}

/**
 * The only fields a progress decision may read. Kept structural so a UI can pass
 * either a full POItemChain or a narrower row without casting.
 */
export interface POProgressChain {
  procurementOutstanding: number
  receivingOutstanding: number
  complete: boolean
}

/**
 * One line's stage. Procurement wins the tie: a line still short of its
 * approved quantity has to be bought before the rest of its units can even be
 * expected to arrive, so its remaining balance is a purchase, not a receipt.
 *
 * Total by construction: both balances at 0 implies purchased >= approved and
 * received >= purchased, which is exactly `complete`.
 */
export function deriveItemProgressStatus(chain: POProgressChain): POProgressStatus {
  if (chain.complete) return 'completed'
  if (chain.procurementOutstanding > 0) return 'awaiting_purchase'
  return 'awaiting_receiving'
}

/**
 * A PO's stage, from the stages of its lines.
 *
 * Completed only when EVERY line is complete. A PO whose unfinished lines all
 * share one stage reports that stage; lines at genuinely different stages report
 * Mixed Progress rather than the purchaser being shown a single misleading one.
 */
export function derivePOProgressStatus(chains: POProgressChain[]): POProgressStatus {
  const lines = chains ?? []
  // No lines means nothing was completed, and nothing needs buying either.
  // Mirrors evaluatePOCompletion, which also refuses to complete an empty PO.
  if (!lines.length) return 'awaiting_purchase'
  const open = lines.map(deriveItemProgressStatus).filter((s) => s !== 'completed')
  if (open.length === 0) return 'completed'
  if (open.every((s) => s === 'awaiting_purchase')) return 'awaiting_purchase'
  if (open.every((s) => s === 'awaiting_receiving')) return 'awaiting_receiving'
  return 'mixed'
}

// ---------------------------------------------------------------------------
// PO bucket classification. Which of the Purchaser's five sections a PO
// belongs to, decided from QUANTITIES rather than the stored status string.
//
// A legacy `status` records how a PO once got where it is; it is not evidence
// of what is still outstanding. These helpers read the same totals the item
// rows display, so a section can never show a PO as "untouched purchasing" while
// its own numbers say otherwise.
//
// Precedence is fixed and total — every PO lands in exactly one bucket:
//
//   1. Discrepancy      an exception needing attention, whatever else is true
//   2. Completed        every required unit received, nothing outstanding
//   3. Pending Purchase approved work that no purchasing has started on
//   4. In Progress      started, not finished
//
// Discrepancy outranks Completed deliberately: a PO whose units all arrived but
// which is still flagged as a receiving discrepancy is NOT a clean completion,
// and it must stay discoverable instead of being hidden inside Completed.
//
// There is no delivery bucket and no delivery term anywhere below. Supplier
// delivery is external to CARDS; what is outstanding is a quantity.
// ---------------------------------------------------------------------------

export type POBucket = 'pending_purchase' | 'in_progress' | 'completed' | 'discrepancy'

/**
 * The purchaser's five section keys: the four buckets above plus `all`, the
 * neutral view that lists every PO whatever its state.
 *
 * These live here, not in actions/procurement.ts, because a "use server" module
 * may only export async functions — exporting a const array from one fails at
 * request time. Keeping them beside POBucket means the server action and the
 * table's dropdown read the same list.
 */
export const PO_BUCKET_KEYS = [
  'all',
  'pending_purchase',
  'in_progress',
  'discrepancy',
  'completed',
] as const
export type POBucketKey = (typeof PO_BUCKET_KEYS)[number]

/**
 * Sub-filter keys for the In Progress section. These are the only three stages a
 * PO inside `in_progress` can derive as, which is why they partition it exactly:
 * a PO whose lines all completed was already routed to `completed` by
 * precedence.
 */
export const IN_PROGRESS_FILTER_KEYS = [
  'all',
  'awaiting_purchase',
  'awaiting_receiving',
  'mixed',
] as const
export type POProgressFilter = (typeof IN_PROGRESS_FILTER_KEYS)[number]

export interface POBucketInput {
  /** total approved quantity across the PO's lines */
  approved: number
  /** total purchased quantity across the PO's lines */
  purchased: number
  /** total physically received quantity across the PO's lines */
  received: number
  /** from the existing hasReceivingDiscrepancy() rule, never re-derived here */
  hasDiscrepancy: boolean
}

export function classifyPOBucket(input: POBucketInput): POBucket {
  if (input.hasDiscrepancy) return 'discrepancy'
  const { approved, purchased, received } = input
  // A PO with nothing approved has nothing to complete or to buy, so it is not
  // a completion; it simply has no recorded progress yet.
  if (approved > 0 && purchased >= approved && received >= purchased) return 'completed'
  // Untouched purchasing: approved work with not one unit bought. This is the
  // distinction that keeps "Pending Purchase" separate from "In Progress ->
  // Awaiting Purchase", where some units HAVE already been bought.
  if (approved > 0 && purchased === 0 && received === 0) return 'pending_purchase'
  return 'in_progress'
}

// ---------------------------------------------------------------------------
// Purchase quantity guard. A purchase can never exceed the approved quantity.
// ---------------------------------------------------------------------------

export function assertValidPurchasedQty(purchasedQty: number, maxQty: number, label: string): void {
  if (!Number.isInteger(purchasedQty) || purchasedQty < 0)
    throw new Error(`Purchased quantity for "${label}" must be a whole number of 0 or more`)
  if (purchasedQty > maxQty)
    throw new Error(
      `Purchased quantity for "${label}" cannot exceed the approved quantity of ${maxQty}`,
    )
}

/** A purchase total may never be walked back — history must stay monotonic. */
export function assertPurchasedNotReduced(nextQty: number, priorQty: number, label: string): void {
  if (nextQty < priorQty)
    throw new Error(
      `Purchased quantity for "${label}" cannot be reduced below the already purchased ${priorQty}`,
    )
}

/**
 * Receiving can never exceed what was actually purchased — CARDS records what
 * physically arrived, it does not invent stock.
 */
export function assertValidReceivedQty(receivedQty: number, purchasedQty: number, label: string): void {
  if (!Number.isInteger(receivedQty) || receivedQty < 0)
    throw new Error(`Received quantity for "${label}" must be a whole number of 0 or more`)
  if (receivedQty > purchasedQty)
    throw new Error(
      `Received quantity for "${label}" cannot exceed the purchased quantity of ${purchasedQty}`,
    )
}

/** A receiving total may never be walked back either. */
export function assertReceivedNotReduced(nextQty: number, priorQty: number, label: string): void {
  if (nextQty < priorQty)
    throw new Error(
      `Received quantity for "${label}" cannot be reduced below the already received ${priorQty}`,
    )
}

// ---------------------------------------------------------------------------
// Retired delivery-layer helpers. Historical DEL-* archive reads only.
// ---------------------------------------------------------------------------

export interface DeliveryQtyRow {
  deliveredQty: number
  receivedQty: number
}

export interface RemainingInput {
  purchasedQty: number | null | undefined
  deliveries: DeliveryQtyRow[]
}

export function remainingToDeliver(input: RemainingInput): number {
  const purchased = input.purchasedQty ?? 0
  const delivered = input.deliveries.reduce((sum, d) => sum + d.deliveredQty, 0)
  return Math.max(0, purchased - delivered)
}

export function remainingToReceive(deliveries: DeliveryQtyRow[]): number {
  const delivered = deliveries.reduce((sum, d) => sum + d.deliveredQty, 0)
  const received = deliveries.reduce((sum, d) => sum + d.receivedQty, 0)
  return Math.max(0, delivered - received)
}

export function totalDelivered(deliveries: DeliveryQtyRow[]): number {
  return deliveries.reduce((sum, d) => sum + d.deliveredQty, 0)
}

export function totalReceived(deliveries: DeliveryQtyRow[]): number {
  return deliveries.reduce((sum, d) => sum + d.receivedQty, 0)
}

export function assertValidDeliveredQty(deliveredQty: number, remaining: number, label: string): void {
  if (!Number.isInteger(deliveredQty) || deliveredQty < 1)
    throw new Error(`Delivered quantity for "${label}" must be a positive whole number`)
  if (deliveredQty > remaining)
    throw new Error(
      `Delivered quantity for "${label}" cannot exceed the remaining deliverable quantity of ${remaining}`,
    )
}

/** Legacy per-item chain. Retained for archived-delivery reporting only. */
export interface ItemChain {
  requestedQty: number
  approvedQty: number
  purchasedQty: number
  deliveredQty: number
  receivedQty: number
  /** max(0, requested - approved): shortfall born at approval */
  approvalShortfall: number
  /** max(0, requested - received): reporting only */
  requestOutstanding: number
  /** max(0, approved - purchased) */
  procurementShortfall: number
  /** max(0, purchased - delivered) */
  deliveryRemaining: number
  /** max(0, delivered - received) */
  receivingRemaining: number
  remainingToDeliver: number
  remainingToReceive: number
}

export function buildItemChain(input: {
  requestedQty: number | null | undefined
  approvedQty: number | null | undefined
  purchasedQty: number | null | undefined
  deliveries: DeliveryQtyRow[]
}): ItemChain {
  const requestedQty = Math.max(0, input.requestedQty ?? 0)
  const approvedQty = Math.max(0, input.approvedQty ?? 0)
  const purchasedQty = Math.max(0, input.purchasedQty ?? 0)
  const deliveredQty = totalDelivered(input.deliveries)
  const receivedQty = totalReceived(input.deliveries)
  const deliveryRemaining = Math.max(0, purchasedQty - deliveredQty)
  return {
    requestedQty,
    approvedQty,
    purchasedQty,
    deliveredQty,
    receivedQty,
    approvalShortfall: Math.max(0, requestedQty - approvedQty),
    requestOutstanding: Math.max(0, requestedQty - receivedQty),
    procurementShortfall: Math.max(0, approvedQty - purchasedQty),
    deliveryRemaining,
    receivingRemaining: Math.max(0, deliveredQty - receivedQty),
    remainingToDeliver: deliveryRemaining,
    remainingToReceive: Math.max(0, deliveredQty - receivedQty),
  }
}
