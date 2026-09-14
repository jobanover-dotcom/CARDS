// Central workflow contract — V1 procurement → delivery → receiving.
// status is canonical; poType is category only; statusLabel is display only.
// UI and Server Actions must import from here instead of hand-typing strings.

export interface StatusEntry {
  value: string
  label: string
}

function entries<T extends Record<string, StatusEntry>>(map: T): T {
  return map
}

export const PO_STATUS = entries({
  INCOMPLETE: { value: 'incomplete', label: 'Open' },
  AWAITING_PURCHASE: { value: 'awaiting_purchase', label: 'Awaiting Purchase' },
  PURCHASE_CONFIRMED: { value: 'purchase_confirmed', label: 'Purchase Confirmed' },
  READY_FOR_DELIVERY: { value: 'ready_for_delivery', label: 'Ready for Delivery' },
  COMPLETED: { value: 'completed', label: 'Completed' },
  CANCELLED: { value: 'cancelled', label: 'Cancelled' },
} as const)

export const DELIVERY_STATUS = entries({
  FOR_DELIVERY: { value: 'for_delivery', label: 'For Delivery' },
  IN_TRANSIT: { value: 'in_transit', label: 'In Transit' },
  RECEIVED: { value: 'received', label: 'Received' },
  PARTIALLY_RECEIVED: { value: 'partially_received', label: 'Partially Received' },
  DISCREPANCY: { value: 'discrepancy', label: 'Discrepancy' },
  COMPLETED: { value: 'completed', label: 'Completed' },
} as const)

export type POStatusValue = (typeof PO_STATUS)[keyof typeof PO_STATUS]['value']
export type DeliveryStatusValue =
  (typeof DELIVERY_STATUS)[keyof typeof DELIVERY_STATUS]['value']

const poLabelByValue = new Map<string, string>(
  Object.values(PO_STATUS).map((s) => [s.value, s.label]),
)
const deliveryLabelByValue = new Map<string, string>(
  Object.values(DELIVERY_STATUS).map((s) => [s.value, s.label]),
)

export function poStatusLabel(value: string, fallback = 'Open'): string {
  return poLabelByValue.get(value) ?? fallback
}

export function deliveryStatusLabel(value: string, fallback = 'For Delivery'): string {
  return deliveryLabelByValue.get(value) ?? fallback
}

// poType is category only — never a workflow/result state.
export const PO_TYPE_ACTIVE_DELIVERY = 'active-delivery'
