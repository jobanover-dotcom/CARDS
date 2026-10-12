'use client';

import { useMemo, useState } from 'react';

import { RECEIVING_DISCREPANCY_SUGGESTIONS } from '../../lib/deliveryStatus';
import { actionDestructive, actionSecondary } from '../ui/tableTheme';

/**
 * Report a receiving discrepancy for ONE purchase-order item.
 *
 * Opened from inside the receiving form, on the row for the line being checked,
 * so there is never any doubt which item a report is about. It does not submit:
 * it stages the type and remarks into the receiving form, and the existing
 * Confirm Receiving button writes the quantity and the report in one
 * transaction. A partial delivery is therefore never left sitting in the
 * database with the checker having no way to say what was wrong with it.
 *
 * The Discrepancy Type field is a free text input with suggestions, never a
 * select. The six suggestions are an affordance — an empty field offers all of
 * them, typing filters them, tapping one fills the field — and none of them
 * constrains what can be typed. "40mm bar instead of 50mm" is a perfectly good
 * report that no fixed list contains, and the whole point of asking a person
 * what they physically found is that the answer is not always in the list.
 * Picking a suggestion therefore only ever writes text into the input; the field
 * stays editable afterwards.
 *
 * `onStage` is called with { type, remarks }. The caller owns persistence.
 */
export default function ReportDiscrepancyModal({ poNumber, mrsNo, item, onStage, onClose }) {
  const [type, setType] = useState('');
  const [remarks, setRemarks] = useState('');
  const [focused, setFocused] = useState(false);

  // Empty shows every suggestion; typing narrows them. Never the other way
  // round — a checker who has typed something and still sees all six would not
  // know which one applies.
  const suggestions = useMemo(() => {
    const q = type.trim().toLowerCase();
    return q ? RECEIVING_DISCREPANCY_SUGGESTIONS.filter((s) => s.toLowerCase().includes(q)) : RECEIVING_DISCREPANCY_SUGGESTIONS;
  }, [type]);

  const showSuggestions = focused && suggestions.length > 0;
  const canStage = type.trim().length > 0;

  const pick = (suggestion) => {
    setType(suggestion);
    setFocused(false);
  };

  const stage = () => {
    if (!canStage) return;
    onStage({ type: type.trim(), remarks: remarks.trim() || undefined });
  };

  return (
    <div
      data-testid="discrepancy-modal"
      className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-[1002] overflow-y-auto py-6 px-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl w-full max-w-[560px] max-h-[90vh] overflow-y-auto shadow-[0_10px_30px_rgba(0,0,0,0.15)] p-6 text-left"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-start border-b border-[#eee] pb-3 mb-4">
          <div>
            <h2 className="m-0 text-lg font-bold text-[#333]">Report Discrepancy</h2>
            <p className="m-0 mt-0.5 text-[12px] text-[#888]">
              {/* mrsNo verbatim, as every other MRS field in the app renders it —
                  whether that is "30" or "MRS30" is the PO's own convention and
                  this form has no business second-guessing it. */}
              {[poNumber, mrsNo].filter(Boolean).join(' \u00b7 ')}
            </p>
          </div>
          <button type="button" className="text-2xl text-[#888]" onClick={onClose} aria-label="Close">
            &times;
          </button>
        </div>

        {/* What is being reported on, in the same quantities the form shows. */}
        <div className="border border-[#e8e8e8] rounded-lg bg-[#fafafa] p-3 mb-4">
          <div className="text-[13px] font-semibold text-[#333]">
            {item.itemDescription} <span className="text-[11px] text-[#888]">({item.unit})</span>
          </div>
          <div className="grid grid-cols-3 gap-2 mt-2 text-[12px]">
            <div>
              <div className="text-[10px] font-bold text-[#999]">PURCHASED</div>
              <div className="text-[13px] font-semibold">{item.purchasedQty}</div>
            </div>
            <div>
              <div className="text-[10px] font-bold text-[#999]">RECEIVED</div>
              <div className="text-[13px] font-semibold">{item.receivedQty}</div>
            </div>
            <div>
              <div className="text-[10px] font-bold text-[#999]">TO RECEIVE</div>
              <div className="text-[13px] font-semibold text-[#006680]">{item.receivingOutstanding}</div>
            </div>
          </div>
        </div>

        <p className="text-[12px] text-[#666] mt-0 mb-2">
          Record the quantity you can count as received above, then say what was wrong with the rest.
          A quantity you have not entered stays outstanding, so nothing has to be reported twice.
        </p>

        <div className="relative">
          <label className="text-[11px] font-bold text-[#444]" htmlFor="discrepancy-type">
            Discrepancy Type
          </label>
          <input
            id="discrepancy-type"
            type="text"
            value={type}
            onChange={(e) => {
              setType(e.target.value);
              setFocused(true);
            }}
            onFocus={() => setFocused(true)}
            // Blur hides the list, but the tap handler runs first, so clicking a
            // suggestion still fills the field.
            onBlur={() => window.setTimeout(() => setFocused(false), 120)}
            placeholder="e.g. Damaged Item"
            autoComplete="off"
            className="py-2 px-3 border border-[#ccc] rounded-md text-[13px] w-full box-border mt-0.5"
          />

          {showSuggestions && (
            <ul
              data-testid="suggestion-list"
              className="absolute z-10 left-0 right-0 mt-0.5 border border-[#ddd] rounded-md bg-white shadow-[0_6px_16px_rgba(0,0,0,0.12)] list-none p-0 m-0 max-h-48 overflow-y-auto"
            >
              {suggestions.map((s) => (
                <li key={s}>
                  <button
                    type="button"
                    // onMouseDown rather than onClick: the input's onBlur would
                    // otherwise unmount the list before the click landed.
                    onMouseDown={(e) => {
                      e.preventDefault();
                      pick(s);
                    }}
                    className="w-full text-left px-3 py-1.5 text-[13px] border-0 bg-white cursor-pointer hover:bg-[#f0f7f8]"
                  >
                    {s}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <p className="text-[11px] text-[#888] mt-1 mb-3">
          The suggestions above are a starting point — type anything you like if none of them fit.
        </p>

        <div className="mb-4">
          <label className="text-[11px] font-bold text-[#444]" htmlFor="discrepancy-remarks">
            Remarks
          </label>
          <textarea
            id="discrepancy-remarks"
            rows={3}
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            placeholder="What did you find? e.g. 1 cement bag was damaged upon delivery."
            className="py-2 px-3 border border-[#ccc] rounded-md text-[13px] w-full box-border mt-0.5 resize-y"
          />
        </div>

        <div className="flex justify-end gap-2 pt-4 border-t border-[#eee]">
          <button type="button" onClick={onClose} className={`${actionSecondary} py-2 px-4`}>
            Cancel
          </button>
          <button
            type="button"
            onClick={stage}
            disabled={!canStage}
            className={`${actionDestructive} py-2 px-4 ${canStage ? '' : 'opacity-50 cursor-not-allowed'}`}
          >
            Report Discrepancy
          </button>
        </div>
      </div>
    </div>
  );
}
