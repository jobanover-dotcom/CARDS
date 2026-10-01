// Pure server-side quantity math for the V1 quantity chain:
// Requested → Approved → Purchased → Delivered → Received → Outstanding.
// UI may display these numbers but must never be trusted; actions recompute
// from the database inside the transaction and reject over-claims.
// No stage is ever overwritten by a later stage; each balance below answers
// exactly one workflow question.

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

export function assertValidReceivedQty(receivedQty: number, deliveredQty: number, label: string): void {
  if (!Number.isInteger(receivedQty) || receivedQty < 0)
    throw new Error(`Received quantity for "${label}" must be a whole number of 0 or more`)
  if (receivedQty > deliveredQty)
    throw new Error(`Received quantity for "${label}" cannot exceed the delivered quantity of ${deliveredQty}`)
}

export function assertValidPurchasedQty(purchasedQty: number, maxQty: number, label: string): void {
  if (!Number.isInteger(purchasedQty) || purchasedQty < 1)
    throw new Error(`Purchased quantity for "${label}" must be a positive whole number`)
  if (purchasedQty > maxQty)
    throw new Error(
      `Purchased quantity for "${label}" cannot exceed the approved quantity of ${maxQty}`,
    )
}

// ---------------------------------------------------------------------------
// Full per-item quantity hierarchy. requestedQty comes from the source
// WarehouseRequestItem; every other stage comes from PO / Delivery records.
// ---------------------------------------------------------------------------

export interface ItemChainInput {
  requestedQty: number | null | undefined
  approvedQty: number | null | undefined
  purchasedQty: number | null | undefined
  deliveries: DeliveryQtyRow[]
}

export interface ItemChain {
  requestedQty: number
  approvedQty: number
  purchasedQty: number
  deliveredQty: number
  receivedQty: number
  /** requested - approved: still waiting on purchaser approval */
  procurementRemaining: number
  /** purchased - delivered: still deliverable through new deliveries */
  deliveryRemaining: number
  /** delivered - received: received short of what was shipped */
  receivingRemaining: number
  /** max(0, requested - received): REPORTING ONLY — never drives actions */
  requestOutstanding: number
  /** max(0, requested - approved): shortfall born at approval */
  approvalShortfall: number
  /** max(0, approved - purchased): the ONLY procurement follow-up allowance */
  procurementShortfall: number
  /** delivered - received: shortfall born at receiving */
  receivingShortfall: number
  /** aliases for the unified tracker contract */
  remainingToDeliver: number
  remainingToReceive: number
}

export type ChainStatus =
  | 'complete'
  | 'awaiting-purchase'
  | 'awaiting-delivery'
  | 'awaiting-receiving'
  | 'approval-shortfall'
  | 'no-activity'

export interface ChainStatusResult {
  status: ChainStatus
  /** human explanation rendered verbatim by the tracker UI */
  statusReason: string
}

/**
 * Single status derivation for the unified tracker. Priority:
 * complete > approval shortfall > awaiting purchase > awaiting delivery >
 * awaiting receiving > no activity. requestOutstanding is never used here.
 */
export function deriveChainStatus(c: {
  approvalShortfall: number
  procurementShortfall: number
  deliveryRemaining: number
  receivingRemaining: number
  requestOutstanding: number
  purchasedQty: number
}): ChainStatusResult {
  if (c.requestOutstanding === 0 && c.procurementShortfall === 0)
    return { status: 'complete', statusReason: 'All requested units received' }
  if (c.approvalShortfall > 0)
    return { status: 'approval-shortfall', statusReason: `${c.approvalShortfall} never approved — not eligible for procurement follow-up` }
  if (c.procurementShortfall > 0)
    return { status: 'awaiting-purchase', statusReason: `${c.procurementShortfall} approved but not purchased` }
  if (c.deliveryRemaining > 0)
    return { status: 'awaiting-delivery', statusReason: `${c.deliveryRemaining} purchased, awaiting delivery` }
  if (c.receivingRemaining > 0)
    return { status: 'awaiting-receiving', statusReason: `${c.receivingRemaining} delivered but not yet received` }
  if (c.purchasedQty === 0)
    return { status: 'no-activity', statusReason: 'No purchasing activity yet' }
  return { status: 'awaiting-receiving', statusReason: `${c.requestOutstanding} outstanding` }
}

export function buildItemChain(input: ItemChainInput): ItemChain {
  const requestedQty = Math.max(0, input.requestedQty ?? 0)
  const approvedQty = Math.max(0, input.approvedQty ?? 0)
  const purchasedQty = Math.max(0, input.purchasedQty ?? 0)
  const deliveredQty = totalDelivered(input.deliveries)
  const receivedQty = totalReceived(input.deliveries)
  const deliveryRemaining = Math.max(0, purchasedQty - deliveredQty)
  const receivingRemaining = Math.max(0, deliveredQty - receivedQty)
  return {
    requestedQty,
    approvedQty,
    purchasedQty,
    deliveredQty,
    receivedQty,
    procurementRemaining: Math.max(0, requestedQty - approvedQty),
    deliveryRemaining,
    receivingRemaining,
    requestOutstanding: Math.max(0, requestedQty - receivedQty),
    approvalShortfall: Math.max(0, requestedQty - approvedQty),
    procurementShortfall: Math.max(0, approvedQty - purchasedQty),
    receivingShortfall: Math.max(0, deliveredQty - receivedQty),
    remainingToDeliver: deliveryRemaining,
    remainingToReceive: receivingRemaining,
  }
}

export interface POCompletionInput {
  chains: ItemChain[]
  hasOpenDiscrepancy: boolean
}

export interface POCompletion {
  /** every purchased unit physically received */
  procurementComplete: boolean
  /** original request fully satisfied */
  requestOutstanding: number
  /** the ONLY condition under which a V1 PO may become completed */
  canComplete: boolean
}

export function evaluatePOCompletion(input: POCompletionInput): POCompletion {
  const procurementComplete =
    input.chains.length > 0 &&
    input.chains.every((c) => c.purchasedQty > 0 && c.receivedQty >= c.purchasedQty)
  const requestOutstanding = input.chains.reduce((s, c) => s + c.requestOutstanding, 0)
  return {
    procurementComplete,
    requestOutstanding,
    canComplete: procurementComplete && !input.hasOpenDiscrepancy && requestOutstanding === 0,
  }
}
