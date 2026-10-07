'use client';
import React from 'react';
import {
  PO_PROGRESS_LABEL,
  deriveItemProgressStatus,
} from '../../lib/deliveryQuantities';

// Shared presentational tracker. Renders the server-computed tracker JSON from
// getPOTracker() verbatim and NEVER calculates a quantity itself.
//
// The flow is APPROVED -> PURCHASED -> RECEIVED. There is no "Delivered" step:
// the supplier delivers physically and outside CARDS, so CARDS only ever knows
// what was purchased and what actually arrived.
//
// Per-item stage comes from deriveItemProgressStatus(), the single definition
// shared with derivePOProgressStatus() and the PO tables, so an item can never
// be labelled one way in the tracker and another way in the row above it.

function ItemStatusLabel({ chain }) {
  const stage = deriveItemProgressStatus(chain);
  return (
    <span className={`text-[11px] font-bold ${stage === 'completed' ? 'text-[#2e7d32]' : 'text-[#e65100]'}`}>
      {PO_PROGRESS_LABEL[stage]}
    </span>
  );
}

function FlowStep({ label, value, last, tone = 'default' }) {
  const color =
    tone === 'outstanding' ? 'text-[#e65100]' : tone === 'done' ? 'text-[#2e7d32]' : 'text-[#333]';
  return (
    <div className="flex flex-col items-center">
      <div className="text-[10px] font-bold tracking-wide text-[#888]">{label}</div>
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
      {!last && <div className="text-[#bbb] text-lg leading-none my-0.5">↓</div>}
    </div>
  );
}

/**
 * `variant="table"` renders the compact per-item grid used inside an expanded
 * purchase-order row. It deliberately omits the PO metadata block: the caller
 * owns that, and it has fields the tracker payload does not carry. Any other
 * variant renders the stacked per-item cards.
 *
 * `variant="receiving"` is the same grid with its last column swapped from the
 * purchaser's stage to the warehouse's outstanding quantity. Two columns, one
 * implementation: the warehouse view used to hand-roll this table twice — once
 * for its expanded row and once for its tracker modal — and the two copies had
 * already drifted apart.
 */
function ReceivingCell({ value }) {
  return (
    <span className={`font-bold ${value ? 'text-[#006680]' : 'text-[#2e7d32]'}`}>{value}</span>
  );
}

function TrackerTable({ tracker, actionSlot, lastColumn = 'status' }) {
  const t = tracker.totals;
  const receiving = lastColumn === 'receiving';
  return (
    <div className="flex flex-col gap-3">
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr className="text-left text-[10px] text-[#999] border-b border-[#eee]">
            <th className="py-1.5 pr-3">ITEM</th>
            <th className="py-1.5 pr-3 text-right">APPROVED</th>
            <th className="py-1.5 pr-3 text-right">PURCHASED</th>
            <th className="py-1.5 pr-3 text-right">RECEIVED</th>
            <th className="py-1.5 text-right">{receiving ? 'TO RECEIVE' : 'STATUS'}</th>
          </tr>
        </thead>
        <tbody>
          {(tracker.items || []).map((it) => (
            <tr key={it.poItemId} className="border-b border-[#f1f1f1] last:border-b-0">
              <td className="py-2 pr-3 font-medium text-[#333]">
                {it.itemDescription} <span className="text-[10px] font-normal text-[#888]">({it.unit})</span>
              </td>
              <td className="py-2 pr-3 text-right tabular-nums">{it.approvedQty}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{it.purchasedQty}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{it.receivedQty}</td>
              <td className="py-2 whitespace-nowrap text-right">
                {receiving ? (
                  <ReceivingCell value={it.receivingOutstanding} />
                ) : (
                  <ItemStatusLabel chain={it} />
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {t && (
        <div className="text-[12px] text-[#555] border-t border-[#eee] pt-2">
          Totals &mdash; Approved {t.approved} &middot; Purchased {t.purchased} &middot; Received {t.received}
          {/* Purchasing belongs to the purchaser. The warehouse variant omits it
              rather than quoting a balance nobody there can act on. */}
          {!receiving && (
            <>
              {' '}&middot; <span className="text-[#e65100] font-bold">To purchase {t.procurementOutstanding}</span>
            </>
          )}
          {' '}&middot; <span className="text-[#006680] font-bold">To receive {t.receivingOutstanding}</span>
        </div>
      )}

      {actionSlot}
    </div>
  );
}

function POQuantityTracker({ tracker, variant = 'warehouse', actionSlot = null }) {
  if (!tracker) return <p className="text-[13px] text-[#666]">Loading tracker…</p>;

  if (variant === 'table') return <TrackerTable tracker={tracker} actionSlot={actionSlot} />;
  if (variant === 'receiving') return <TrackerTable tracker={tracker} actionSlot={actionSlot} lastColumn="receiving" />;

  const items = tracker.items || [];
  const t = tracker.totals;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 text-[12px]">
        <div><span className="font-bold text-[#666]">PO </span><span className="font-semibold">{tracker.poNumber}</span></div>
        <div><span className="font-bold text-[#666]">SUPPLIER </span><span className="font-semibold">{tracker.supplier || '— not purchased yet'}</span></div>
        <div><span className="font-bold text-[#666]">MRS </span><span className="font-semibold">{tracker.mrsNo || '—'}</span></div>
        <div><span className="font-bold text-[#666]">STATUS </span><span className="font-semibold">{tracker.statusLabel}</span></div>
        {tracker.sourceReqNumber && <div><span className="font-bold text-[#666]">SOURCE REQ </span><span className="font-semibold">{tracker.sourceReqNumber}</span></div>}
      </div>

      {items.map((it) => (
        <div key={it.poItemId} className="border border-[#e0e0e0] rounded-lg p-4">
          <div className="flex justify-between items-center mb-3">
            <div className="text-[14px] font-bold text-[#333]">
              {it.itemDescription} <span className="text-[11px] font-normal text-[#888]">({it.unit})</span>
            </div>
            <ItemStatusLabel chain={it} />
          </div>

          <div className="flex justify-between max-sm:flex-col max-sm:gap-1 bg-[#fafafa] rounded-md px-3 py-3">
            <FlowStep label="APPROVED" value={it.approvedQty} />
            <FlowStep label="PURCHASED" value={it.purchasedQty} />
            <FlowStep
              label="RECEIVED"
              value={it.receivedQty}
              last
              tone={it.receivingOutstanding > 0 ? 'outstanding' : it.complete ? 'done' : 'default'}
            />
          </div>

          <div className="mt-3 text-[12px] text-[#555] flex flex-col gap-0.5">
            <span className={it.procurementOutstanding > 0 ? 'text-[#e65100] font-bold' : 'text-[#2e7d32]'}>
              {it.procurementOutstanding} still to purchase (Admin &mdash; Follow-up Purchase on this PO)
            </span>
            <span className={it.receivingOutstanding > 0 ? 'text-[#006680] font-bold' : 'text-[#2e7d32]'}>
              {it.receivingOutstanding} purchased but not yet received (Warehouse)
            </span>
          </div>
        </div>
      ))}

      {t && (
        <div className="text-[12px] text-[#555] border-t border-[#eee] pt-2">
          Totals &mdash; Approved {t.approved} &middot; Purchased {t.purchased} &middot; Received {t.received}
          {' '}&middot; <span className="text-[#e65100] font-bold">To purchase {t.procurementOutstanding}</span>
          {' '}&middot; <span className="text-[#006680] font-bold">To receive {t.receivingOutstanding}</span>
        </div>
      )}

      {actionSlot}
    </div>
  );
}

export default POQuantityTracker;
