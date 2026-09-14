// Pure server-side quantity math for the V1 quantity chain:
// POItem.qty (ordered) → POItem.purchasedQty → SUM(deliveredQty) → SUM(receivedQty).
// UI may display these numbers but must never be trusted; actions recompute
// from the database inside the transaction and reject over-claims.

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
