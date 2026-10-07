// Central workflow contract for CARDS.
//
//   PO LIFECYCLE:  AWAITING_PURCHASE -> IN_PROGRESS -> COMPLETED
//   QUANTITY FLOW: APPROVED -> PURCHASED -> RECEIVED
//
// The supplier is external to CARDS: there is no system-controlled delivery
// workflow, so "ready for delivery", "on delivery" and "partially received"
// are NOT workflow states. What remains outstanding is expressed purely by
// item quantities (see deliveryQuantities.ts), never by a status.
//
// `status` is canonical and is always the source of truth. `statusLabel` is a
// stored display string that can drift; render poStatusLabel(poLifecycle(status))
// instead of reading the stored label. `poType` is a legacy category only.

export interface StatusEntry {
  value: string
  label: string
}

function entries<T extends Record<string, StatusEntry>>(map: T): T {
  return map
}

/** The only PO statuses the current workflow writes. */
export const PO_STATUS = entries({
  AWAITING_PURCHASE: { value: 'awaiting_purchase', label: 'Awaiting Purchase' },
  IN_PROGRESS: { value: 'in_progress', label: 'In Progress' },
  COMPLETED: { value: 'completed', label: 'Completed' },
  CANCELLED: { value: 'cancelled', label: 'Cancelled' },
} as const)

/**
 * Retired statuses that may still exist on historical rows. These are read
 * only: no new transition writes them, and they never appear in the new
 * workflow. They are classified into the canonical lifecycle by poLifecycle()
 * so that legacy POs still surface on a lifecycle card instead of vanishing.
 */
export const LEGACY_PO_STATUS = entries({
  INCOMPLETE: { value: 'incomplete', label: 'In Progress' },
  PURCHASE_CONFIRMED: { value: 'purchase_confirmed', label: 'In Progress' },
  READY_FOR_DELIVERY: { value: 'ready_for_delivery', label: 'In Progress' },
  ON_DELIVERY: { value: 'on_delivery', label: 'In Progress' },
} as const)

/**
 * Historical shipment statuses. The live workflow never writes these — the
 * Delivery tables are a read-only archive. Retained so archived rows still
 * render with a correct label.
 */
export const DELIVERY_STATUS = entries({
  FOR_DELIVERY: { value: 'for_delivery', label: 'For Delivery' },
  IN_TRANSIT: { value: 'in_transit', label: 'In Transit' },
  RECEIVED: { value: 'received', label: 'Received' },
  PARTIALLY_RECEIVED: { value: 'partially_received', label: 'Partially Received' },
  DISCREPANCY: { value: 'discrepancy', label: 'Discrepancy' },
  COMPLETED: { value: 'completed', label: 'Completed' },
} as const)

export type POStatusValue = (typeof PO_STATUS)[keyof typeof PO_STATUS]['value']
export type LegacyPOStatusValue = (typeof LEGACY_PO_STATUS)[keyof typeof LEGACY_PO_STATUS]['value']
export type DeliveryStatusValue = (typeof DELIVERY_STATUS)[keyof typeof DELIVERY_STATUS]['value']
export type POLifecycle = POStatusValue

const poLabelByValue = new Map<string, string>([
  ...Object.values(PO_STATUS).map((s) => [s.value, s.label] as const),
  ...Object.values(LEGACY_PO_STATUS).map((s) => [s.value, s.label] as const),
])
const deliveryLabelByValue = new Map<string, string>(
  Object.values(DELIVERY_STATUS).map((s) => [s.value, s.label]),
)

/**
 * The single definition mapping a stored `PurchaseOrder.status` onto the
 * canonical lifecycle. Every card, filter, table and action uses this, so a
 * legacy row can never end up counted in a different bucket than the one it
 * is displayed under.
 *
 * - awaiting_purchase -> awaiting_purchase
 * - in_progress        -> in_progress
 * - completed          -> completed
 * - cancelled          -> cancelled
 * - incomplete / purchase_confirmed / ready_for_delivery / on_delivery
 *                      -> in_progress (legacy compatibility only)
 */
const LEGACY_TO_LIFECYCLE = new Map<string, POLifecycle>(
  Object.values(LEGACY_PO_STATUS).map((s) => [s.value, PO_STATUS.IN_PROGRESS.value] as const),
)

export function poLifecycle(value: string | null | undefined): POLifecycle | null {
  if (!value) return null
  if ((Object.values(PO_STATUS) as StatusEntry[]).some((s) => s.value === value))
    return value as POLifecycle
  return LEGACY_TO_LIFECYCLE.get(value) ?? null
}

/** True when the stored status belongs to the current (non-legacy) lifecycle. */
export function isCurrentLifecycleStatus(value: string | null | undefined): boolean {
  return (Object.values(PO_STATUS) as StatusEntry[]).some((s) => s.value === value)
}

export function poStatusLabel(value: string, fallback = 'In Progress'): string {
  return poLabelByValue.get(value) ?? fallback
}

export function deliveryStatusLabel(value: string, fallback = 'For Delivery'): string {
  return deliveryLabelByValue.get(value) ?? fallback
}

/**
 * Display label for a stored status, normalised through the lifecycle so a
 * legacy row shows the lifecycle state it actually represents. This is what
 * every UI badge should render.
 */
export function poDisplayLabel(value: string | null | undefined, fallback = 'In Progress'): string {
  const lifecycle = poLifecycle(value)
  return lifecycle ? poStatusLabel(lifecycle, fallback) : poStatusLabel(value ?? '', fallback)
}

// ---------------------------------------------------------------------------
// Lifecycle status sets. Dashboard cards, list filters and action gates must
// import from here — never hand-type a status string.
// ---------------------------------------------------------------------------

export const AWAITING_PURCHASE_STATUSES: string[] = [PO_STATUS.AWAITING_PURCHASE.value]
export const IN_PROGRESS_STATUSES: string[] = [PO_STATUS.IN_PROGRESS.value]
export const COMPLETED_STATUSES: string[] = [PO_STATUS.COMPLETED.value]
export const CANCELLED_STATUSES: string[] = [PO_STATUS.CANCELLED.value]

/** Every stored status that resolves to IN_PROGRESS, canonical plus legacy. */
export const IN_PROGRESS_LIFECYCLE_STATUSES: string[] = [
  PO_STATUS.IN_PROGRESS.value,
  ...Object.values(LEGACY_PO_STATUS).map((s) => s.value),
]

/** Every stored status that resolves to AWAITING_PURCHASE. */
export const AWAITING_PURCHASE_LIFECYCLE_STATUSES: string[] = [PO_STATUS.AWAITING_PURCHASE.value]

/** Not completed and not cancelled — the superset behind "still active". */
export const ACTIVE_LIFECYCLE_STATUSES: string[] = [
  ...IN_PROGRESS_LIFECYCLE_STATUSES,
  ...AWAITING_PURCHASE_LIFECYCLE_STATUSES,
]

// ---------------------------------------------------------------------------
// Historical archive helpers. These describe retired workflow concepts and
// exist only to read/label archived Delivery rows. They drive no card, no
// filter and no transition in the current workflow.
// ---------------------------------------------------------------------------

/**
 * A PO carries a historical receiving discrepancy iff it was explicitly
 * flagged by the legacy receiving path (poType) or an archived delivery was
 * explicitly marked as a discrepancy. Unflagged shortfalls are NOT
 * discrepancies — that distinction is what the old "Partially Received" card
 * got wrong.
 */
export interface DiscrepancyCheckPO {
  poType?: string | null
  deliveries?: { status?: string | null }[] | null
}

export function hasReceivingDiscrepancy(po: DiscrepancyCheckPO | null | undefined): boolean {
  if (!po) return false
  if (po.poType === 'discrepancy') return true
  return (po.deliveries ?? []).some((d) => d?.status === DELIVERY_STATUS.DISCREPANCY.value)
}

// poType is a legacy category only — never a workflow or result state.
export const PO_TYPE_ACTIVE_DELIVERY = 'active-delivery'
