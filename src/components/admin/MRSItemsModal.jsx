'use client';
import React from 'react';
import { tableEl, tdStrong, thEl, theadEl, trEl } from '../ui/tableTheme';

// Per-item figures for one material request.
//
// The MRS row can only carry a general quantity — "Approved 60 · Purchased 50 ·
// Received 30" — because one requirement is bought across several purchase
// orders. This is where the breakdown behind that headline lives.
//
// It renders the MRS aggregate's `lines` VERBATIM and calculates nothing. The same
// aggregate already produced the row's totals in the same query, so this cannot
// disagree with the row above it — which is the whole reason it takes the data by
// prop instead of fetching its own.
//
// Requested and Rejected are shown alongside Approved because that is how an
// approval gap is read: 100 requested / 60 approved / 40 rejected says the rest
// was formally refused, whereas 100 requested / 60 approved alone looks like an
// oversight still to be decided.
function MRSItemsModal({ group, onClose }) {
  const lines = group?.lines ?? [];
  const t = group?.totals;

  const cells = [
    { key: 'requestedQty', label: 'REQUESTED', total: t?.requested },
    { key: 'approvedQty', label: 'APPROVED', total: t?.approved },
    { key: 'rejectedQty', label: 'REJECTED', total: t?.rejected },
    { key: 'purchasedQty', label: 'PURCHASED', total: t?.purchased },
    { key: 'receivedQty', label: 'RECEIVED', total: t?.received },
  ];
  // thEl is left-aligned with generous padding; quantity columns need the
  // opposite, and re-declaring it here keeps every numeric column identical.
  const numTh = 'py-2.5 px-3 text-[10px] font-bold text-[#999] uppercase text-right border-b-2 border-[#1e3c72]/30';
  const numTd = 'p-3 text-right text-[13px] tabular-nums text-[#333]';

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-[1000] animate-fade-in px-4">
      <div className="bg-white rounded-xl w-full max-w-[720px] max-h-[90vh] overflow-y-auto shadow-[0_10px_30px_rgba(0,0,0,0.15)] animate-slide-in p-6">
        <div className="flex justify-between items-start border-b border-[#eee] pb-3 mb-4">
          <div>
            <h2 className="m-0 text-base font-bold text-[#333] tracking-wide">
              Items on {group?.mrsNo || 'this material request'}
            </h2>
            <p className="m-0 mt-1 mb-0 text-[12px] text-[#888]">
              {group?.requisitioner}
              {group?.poCount != null ? ` · ${group.poCount} purchase order${group.poCount === 1 ? '' : 's'}` : ''}
            </p>
          </div>
          <button
            type="button"
            className="bg-none border-none text-2xl cursor-pointer text-[#888] hover:text-[#333] transition-colors duration-200 p-1 leading-none"
            onClick={onClose}
            aria-label="Close"
          >
            &times;
          </button>
        </div>

        {lines.length === 0 ? (
          <p className="m-0 text-[13px] text-[#999]">
            This material request has no items to show.
          </p>
        ) : (
          <table className={`${tableEl} min-w-[560px]`}>
            <thead className={theadEl}>
              <tr>
                <th className={thEl}>ITEM</th>
                {cells.map((c) => (
                  <th key={c.key} className={numTh}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.itemDescription} className={trEl}>
                  <td className={tdStrong}>
                    {line.itemDescription}
                    {line.unit ? <span className="ml-1 text-[10px] font-normal text-[#888]">({line.unit})</span> : null}
                  </td>
                  {/* Always a number, never a dash: 0 and "nothing outstanding"
                      are different facts, and a dash would hide which one this is. */}
                  {cells.map((c) => (
                    <td key={c.key} className={numTd}>
                      {line[c.key]}
                    </td>
                  ))}
                </tr>
              ))}
              {t && (
                <tr className={`${trEl} border-t-2 border-[#1e3c72] bg-[#eef4fb]`}>
                  <td className={tdStrong}>TOTAL</td>
                  {cells.map((c) => (
                    <td key={c.key} className="p-3 text-right text-[13px] font-bold tabular-nums text-[#1e3c72]">
                      {c.total}
                    </td>
                  ))}
                </tr>
              )}
            </tbody>
          </table>
        )}

        <p className="mt-4 mb-0 text-[11px] text-[#888]">
          Requested, approved and rejected belong to the material request and are counted once.
          Purchased and received are summed across its purchase orders.
        </p>
      </div>
    </div>
  );
}

export default MRSItemsModal;