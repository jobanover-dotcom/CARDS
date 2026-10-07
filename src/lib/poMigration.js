// Pure legacy → procurement PO mapping for the backfill script.
// Rule: only POs with NO receiving activity move to the new workflow.
// Anything with monitoring rows, monDeliveredBy, or a terminal state stays
// untouched on the legacy updatePOMonitoring() compat path — no blind moves,
// no overwritten quantities. purchasedQty is never backfilled (the purchaser
// records it via savePurchase()).

export const V1_AWAITING_PURCHASE = {
  status: 'awaiting_purchase',
  statusLabel: 'Awaiting Purchase',
};

// Statuses owned by the current procurement workflow. The legacy single-shot
// receiving path (updatePOMonitoring) refuses to touch any of these, so the
// two paths can never fight over the same row.
export const V1_PO_STATUSES = ['awaiting_purchase', 'in_progress', 'completed'];

// True when a PO is owned by the current procurement workflow. Shared by the
// backfill mapper and the legacy-path guards in actions/pos.ts so both use
// one definition of "owned by the new workflow".
export function isV1WorkflowPO(po) {
  if (!po) return false;
  if (V1_PO_STATUSES.includes(po.status)) return true;
  for (const item of po.items || []) {
    if (item.purchasedQty != null) return true;
  }
  const deliveryCount = po.deliveryCount ?? po._count?.deliveries ?? (po.deliveries ? po.deliveries.length : 0);
  return deliveryCount > 0;
}

function hasReceivingActivity(po) {
  const items = po.items || [];
  for (const item of items) {
    for (const row of item.monitoringItems || []) {
      if ((row.qtyReceived ?? 0) > 0) return true;
    }
  }
  if (po.monDeliveredBy || po.monDateDelivered || po.monReferenceNo || po.monQtyRvd) return true;
  return false;
}

function isTerminal(po) {
  return po.status === 'completed' || po.status === 'cancelled';
}

// Returns { status, statusLabel } when the PO should move, or null to leave it.
export function mapLegacyPOToV1(po) {
  if (!po || isTerminal(po)) return null;
  if (hasReceivingActivity(po)) return null;
  if (po.status === 'awaiting_purchase') return null; // already V1
  return { ...V1_AWAITING_PURCHASE };
}
