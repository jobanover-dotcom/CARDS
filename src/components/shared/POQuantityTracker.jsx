'use client';
import React from 'react';
import StatusBadge from '../ui/StatusBadge';

// Shared presentational tracker. Props = server-computed tracker JSON only.
// Never calculates quantities — renders buildPOChains()/getPOQuantityTracker()
// output verbatim. Used by both Warehouse and Purchaser with different
// action slots.
function FlowStep({ label, value, last }) {
  return (
    <div className="flex flex-col items-center">
      <div className="text-[10px] font-bold tracking-wide text-[#888]">{label}</div>
      <div className="text-2xl font-bold text-[#333]">{value}</div>
      {!last && <div className="text-[#bbb] text-lg leading-none my-0.5">↓</div>}
    </div>
  );
}

function POQuantityTracker({ tracker, variant = 'warehouse', actionSlot = null }) {
  if (!tracker) return <p className="text-[13px] text-[#666]">Loading tracker…</p>;
  const items = tracker.items || [];
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 text-[12px]">
        <div><span className="font-bold text-[#666]">PO </span><span className="font-semibold">{tracker.poNumber}</span></div>
        <div><span className="font-bold text-[#666]">SUPPLIER </span><span className="font-semibold">{tracker.supplier || '—'}</span></div>
        <div><span className="font-bold text-[#666]">MRS </span><span className="font-semibold">{tracker.mrsNo || '—'}</span></div>
        {tracker.sourceReqNumber && <div><span className="font-bold text-[#666]">SOURCE REQ </span><span className="font-semibold">{tracker.sourceReqNumber}</span></div>}
      </div>

      {items.map((it) => (
        <div key={it.poItemId} className="border border-[#e0e0e0] rounded-lg p-4">
          <div className="flex justify-between items-center mb-3">
            <div className="text-[14px] font-bold text-[#333]">{it.itemDescription} <span className="text-[11px] font-normal text-[#888]">({it.unit})</span></div>
            <StatusBadge status={it.statusReason || it.status} />
          </div>

          <div className="flex justify-between max-sm:flex-col max-sm:gap-1 bg-[#fafafa] rounded-md px-3 py-3">
            <FlowStep label="REQUESTED" value={it.requestedQty} />
            <FlowStep label="APPROVED" value={it.approvedQty} />
            <FlowStep label="PURCHASED" value={it.purchasedQty} />
            <FlowStep label="DELIVERED" value={it.deliveredQty} />
            <FlowStep label="RECEIVED" value={it.receivedQty} last />
          </div>

          <div className="mt-3 text-[12px] font-semibold text-[#333]">
            Outstanding: {it.requestOutstanding}
          </div>
          <div className="mt-1 text-[12px] text-[#555] flex flex-col gap-0.5">
            <span>{it.procurementShortfall} Not Purchased</span>
            <span>{it.deliveryRemaining} Awaiting Delivery</span>
            <span>{it.receivingRemaining} Awaiting Receiving</span>
          </div>
          {it.approvalShortfall > 0 && (
            <div className="mt-1 text-[11px] text-[#8d6e00]">{it.approvalShortfall} never approved — not eligible for procurement follow-up.</div>
          )}

          <div className="mt-3">
            <div className="text-[11px] font-bold text-[#666] uppercase mb-1">Delivery History</div>
            {(it.deliveries || []).length === 0 ? (
              <div className="text-[12px] text-[#888]">
                {it.deliveryRemaining > 0 ? `— ${it.deliveryRemaining} not yet delivered` : 'No deliveries yet'}
              </div>
            ) : (
              <table className="w-full border-collapse text-[12px]">
                <thead><tr className="text-left text-[#999]">
                  <th className="py-1 pr-2">Delivery</th><th className="py-1 pr-2">Delivered</th><th className="py-1 pr-2">Received</th><th className="py-1 pr-2">Remaining</th><th className="py-1 pr-2">Status</th>
                </tr></thead>
                <tbody>
                  {it.deliveries.map((d) => (
                    <tr key={d.deliveryId} className="border-t border-[#f1f1f1]">
                      <td className="py-1.5 pr-2 font-semibold text-[#006680]">{d.deliveryNumber}</td>
                      <td className="py-1.5 pr-2">{d.deliveredQty}</td>
                      <td className="py-1.5 pr-2">{d.receivedQty}</td>
                      <td className="py-1.5 pr-2">{d.remainingToReceive}</td>
                      <td className="py-1.5 pr-2"><StatusBadge status={d.statusLabel || d.status} /></td>
                    </tr>
                  ))}
                  {it.deliveryRemaining > 0 && (
                    <tr className="border-t border-[#f1f1f1] text-[#888]">
                      <td className="py-1.5 pr-2">—</td><td className="py-1.5 pr-2">{it.deliveryRemaining}</td><td className="py-1.5 pr-2">—</td><td className="py-1.5 pr-2">{it.deliveryRemaining}</td><td className="py-1.5 pr-2">Not yet delivered</td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
          </div>
        </div>
      ))}

      {tracker.totals && (
        <div className="text-[12px] text-[#555] border-t border-[#eee] pt-2">
          Totals — Requested {tracker.totals.requested} · Approved {tracker.totals.approved} · Purchased {tracker.totals.purchased} · Delivered {tracker.totals.delivered} · Received {tracker.totals.received} · Outstanding {tracker.totals.outstanding}
          {variant === 'purchaser' && (
            <span> · {tracker.totals.remainingToDeliver} remaining to deliver</span>
          )}
        </div>
      )}

      {actionSlot}
    </div>
  );
}

export default POQuantityTracker;
