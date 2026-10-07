'use client';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getRequestApprovalState, getRequestApprovalLog } from '../../../actions/requests';
import { useAdminData } from '../../context/AdminDataContext';
import { actionDestructive, actionPrimary, actionSecondary } from '../ui/tableTheme';

// Follow-up Approval — the Request section's own workflow.
//
// It settles one balance only: `requested - approved - rejected`. It is NOT
// Follow-up Purchase, which settles `approved - purchased` in the PO section, and
// the two never appear in the same dialog or run the same code.
//
// Two things make this hard to get wrong:
//
//   1. The inputs are INCREMENTS. A purchaser types "approve 20 more of the 40
//      still outstanding", never "the new total is 20". The resulting approved
//      quantity is shown live under each row so the arithmetic is visible.
//   2. The balances shown here are a seed, not the truth. approveRemaining and
//      rejectRemaining both re-read the rows under a row lock and enforce the cap
//      server-side, so a stale form cannot approve 41 of a 40 remainder.
//
// It creates nothing: no request, no MRS, no purchase order. The original request
// stays the parent, and any PO raised afterwards reads the raised approved
// quantity through the existing MRS allowance logic.

const HISTORY_LABELS = {
  additional_approved: 'Additional approved',
  remaining_rejected: 'Remaining rejected',
};

function formatQty(value) {
  return Number(value ?? 0).toLocaleString();
}

function FollowUpApprovalModal({ reqNumber, onClose }) {
  const { approveRemaining, rejectRemaining } = useAdminData();
  const router = useRouter();
  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [amounts, setAmounts] = useState({});
  const [applied, setApplied] = useState([]);
  const [history, setHistory] = useState([]);
  const [requestMeta, setRequestMeta] = useState(null);
  const [rejecting, setRejecting] = useState(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // `stale` guards against a response landing after the modal has closed, and
  // against the out-of-order pair of calls an unmount mid-flight produces.
  const stale = useRef(false);
  const load = useCallback(async () => {
    try {
      const [next, log] = await Promise.all([getRequestApprovalState(reqNumber), getRequestApprovalLog(reqNumber)]);
      if (stale.current) return;
      setState(next);
      setRequestMeta({
        requisitioner: next.requisitioner,
        requestedBy: next.requestedBy,
        warehouse: next.warehouse,
        date: next.date,
      });
      setHistory(log);
      setLoadError('');
    } catch (e) {
      if (!stale.current) setLoadError(e?.message || 'Could not load this request');
    } finally {
      if (!stale.current) setLoading(false);
    }
  }, [reqNumber]);

  useEffect(() => {
    stale.current = false;
    setLoading(true);
    load();
    return () => { stale.current = true; };
  }, [load]);

  const items = state?.items ?? [];
  const openItems = items.filter((it) => it.outstanding > 0);

  const enteredFor = (id) => {
    const raw = amounts[id];
    const parsed = parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  };

  // Clamped for display only. The server enforces the same cap against live data
  // and rejects rather than truncates, so an over-typed value never silently
  // becomes a smaller approval.
  const clampEntered = (item) => Math.min(Math.max(0, enteredFor(item.id)), item.outstanding);

  const totalEntered = openItems.reduce((s, it) => s + clampEntered(it), 0);
  const anyEntered = totalEntered > 0;

  const handleAmountChange = (item, value) => {
    // Digits only, so a negative can never be typed into an increment field.
    const digits = value.replace(/[^0-9]/g, '');
    setAmounts((prev) => ({ ...prev, [item.id]: digits }));
    setError('');
  };

  const handleApprove = async () => {
    if (!anyEntered || busy) return;
    setBusy(true);
    setError('');
    try {
      // Captured BEFORE the reload clears the inputs, so the approval the server
      // has just accepted can be offered as a purchase-order seed. These are
      // deltas over what was already approved, not totals.
      const applied = openItems
        .map((it) => ({
          id: it.id,
          qty: clampEntered(it),
          // Display only. The server resolves each line from the request by id, so
          // these labels can never redirect the PO to a different material.
          itemDescription: it.itemDescription,
          unit: it.unit,
        }))
        .filter((entry) => entry.qty > 0);
      await approveRemaining({ reqNumber, items: openItems.map((it) => ({ id: it.id, additionalApproval: clampEntered(it) })) });
      setApplied(applied);
      await load();
      setAmounts({});
    } catch (e) {
      setError(e?.message || 'Could not apply the approval');
    } finally {
      setBusy(false);
    }
  };

  // Hands the approval off to PO creation as a NEW purchase order on the parent
  // MRS. The seed is the delta this approval released — NOT the
  // approved-but-unpurchased balance, which is Follow-up Purchase's work and
  // stays where it is.
  const proceedToPOCreation = () => {
    if (!applied.length || !state) return;
    const params = new URLSearchParams({
      approvalPO: reqNumber,
      items: JSON.stringify(applied),
      mrsNo: state.mrsNo,
      requisitioner: requestMeta?.requisitioner || '',
      requestWarehouse: requestMeta?.warehouse || '',
      approvedBy: requestMeta?.requestedBy || '',
      approvalDate: requestMeta?.date || '',
    });
    router.push(`/admin/purchase-orders?${params.toString()}`);
  };

  const openReject = (item) => {
    setRejecting(item);
    setReason('');
    setError('');
  };

  const cancelReject = () => {
    setRejecting(null);
    setReason('');
  };

  const handleReject = async () => {
    if (!rejecting || busy) return;
    // The server trims and rejects an empty reason too; this only avoids a
    // pointless round trip.
    if (!reason.trim()) {
      setError('Enter a reason for rejecting the remaining quantity');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await rejectRemaining({ reqNumber, reason, items: [{ id: rejecting.id }] });
      await load();
      cancelReject();
    } catch (e) {
      setError(e?.message || 'Could not reject the remaining quantity');
    } finally {
      setBusy(false);
    }
  };

  const inputClass = 'py-2 px-3 border border-[#ccc] rounded-md text-[13px] text-[#333] bg-white transition-all duration-200 w-full box-border focus:outline-none focus:border-[#0288d1] focus:ring-2 focus:ring-[#0288d1]/10';

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-[1000] animate-fade-in overflow-y-auto py-6 px-4">
      <div className="bg-white rounded-xl w-full max-w-[720px] max-h-[90vh] overflow-y-auto shadow-[0_10px_30px_rgba(0,0,0,0.15)] animate-slide-in p-6">
        <div className="flex justify-between items-center border-b border-[#eee] pb-3 mb-5">
          <div>
            <h2 className="m-0 text-lg font-bold text-[#333] tracking-wide">Follow-up Approval</h2>
            {state && (
              <p className="mt-1 mb-0 text-[12px] text-[#888]">
                {state.mrsNo} &middot; {state.reqNumber}
              </p>
            )}
          </div>
          <button className="bg-none border-none text-2xl cursor-pointer text-[#888] hover:text-[#333] transition-colors duration-200 p-1 leading-none" onClick={onClose}>&times;</button>
        </div>

        {loading && <p className="m-0 text-[13px] text-[#999]">Loading request…</p>}

        {!loading && loadError && (
          <div className="rounded-lg border border-[#ffcdd2] bg-[#fef5f5] px-4 py-3 text-[13px] text-[#c62828]">{loadError}</div>
        )}

        {!loading && !loadError && state && (
          <>
            <p className="mt-0 mb-4 text-[13px] text-[#666] leading-relaxed">
              This decides the quantity still awaiting approval. Anything approved here becomes available
              for purchase order creation, and anything rejected will not be approved later.
            </p>

            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[13px]">
                <thead>
                  <tr className="border-b border-[#eee]">
                    {['Item', 'Requested', 'Approved', 'Rejected', 'Remaining', 'Additional Approval'].map((h) => (
                      <th
                        key={h}
                        className={`py-2 text-[10px] font-bold text-[#999] uppercase ${h === 'Item' ? 'text-left' : 'text-right'}`}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {items.map((it) => {
                    const entered = clampEntered(it);
                    const closed = it.outstanding === 0;
                    return (
                      <tr key={it.id} className="border-b border-[#f5f5f5] align-top">
                        <td className="py-2.5 pr-2 text-left text-[#333] font-medium">
                          {it.itemDescription}
                          <span className="ml-1 text-[11px] text-[#999]">({it.unit})</span>
                          {closed && (
                            <div className="mt-0.5 text-[10px] font-semibold text-[#78909c]">
                              {it.rejectedQty > 0 ? 'Closed — remainder rejected' : 'Fully approved'}
                            </div>
                          )}
                        </td>
                        <td className="py-2.5 px-1 text-right tabular-nums text-[#333]">{formatQty(it.qty)}</td>
                        <td className="py-2.5 px-1 text-right tabular-nums text-[#333]">{formatQty(it.approvedQty ?? 0)}</td>
                        <td className="py-2.5 px-1 text-right tabular-nums text-[#78909c]">{formatQty(it.rejectedQty)}</td>
                        <td className={`py-2.5 px-1 text-right tabular-nums font-bold ${closed ? 'text-[#b0bec5]' : 'text-[#ef6c00]'}`}>
                          {formatQty(it.outstanding)}
                        </td>
                        <td className="py-2.5 pl-2 text-right">
                          {closed ? (
                            <span className="text-[11px] text-[#b0bec5]">&mdash;</span>
                          ) : (
                            <div className="flex items-center justify-end gap-2">
                              <input
                                type="number"
                                min="0"
                                max={it.outstanding}
                                value={amounts[it.id] ?? ''}
                                placeholder="0"
                                onChange={(e) => handleAmountChange(it, e.target.value)}
                                className={`${inputClass} max-w-[90px] text-right`}
                              />
                              <button
                                type="button"
                                disabled={busy || it.outstanding === 0}
                                onClick={() => openReject(it)}
                                className="px-2 py-1 text-[11px] font-semibold rounded border border-[#ffcdd2] text-[#d32f2f] bg-white hover:bg-[#fef5f5] disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
                              >
                                Reject remaining
                              </button>
                            </div>
                          )}
                          {!closed && entered > 0 && (
                            <div className="mt-1 text-[10px] text-[#2e7d32] font-semibold">
                              New approved: {formatQty((it.approvedQty ?? 0) + entered)}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {openItems.length === 0 && (
              <p className="mt-4 rounded-lg border border-[#cfd8dc] bg-[#eceff1] px-4 py-3 text-[13px] text-[#455a64]">
                Nothing is awaiting approval on this request. Every line is either fully approved or explicitly
                rejected, so Follow-up Approval no longer applies.
              </p>
            )}

            {/* The rejection dialog renders its own error. Showing it here too
                would put the same message on screen twice while it is open. */}
            {error && !rejecting && (
              <div className="mt-4 rounded-lg border border-[#ffcdd2] bg-[#fef5f5] px-4 py-3 text-[13px] text-[#c62828]">
                {error}
              </div>
            )}

            <div className="flex justify-between items-center gap-4 mt-6 pt-4 border-t border-[#eee]">
              <span className="text-[12px] text-[#888]">
                {applied.length > 0
                  ? `${formatQty(applied.reduce((s, a) => s + a.qty, 0))} unit(s) approved and ready to be bought`
                  : openItems.length === 0
                    ? 'No approval outstanding'
                    : anyEntered
                      ? `${formatQty(totalEntered)} additional unit(s) to approve`
                      : 'Enter an additional quantity to approve'}
              </span>
              <div className="flex gap-3">
                <button type="button" className={actionSecondary} onClick={onClose}>Close</button>
                {/* The second half of Follow-up Approval: the approved quantity is
                    ready to be bought, and this opens PO creation seeded with the
                    delta just approved. It raises a NEW PO on the parent MRS in
                    Pending Purchase; the existing PO is never reopened. */}
                {applied.length > 0 && (
                  <button type="button" className={actionPrimary} onClick={proceedToPOCreation}>
                    Proceed to PO Creation
                  </button>
                )}
                {/* With nothing outstanding there is no approval to apply, so the
                    action is withdrawn rather than left disabled — a disabled
                    button invites the question of what went wrong. */}
                {openItems.length > 0 && (
                  <button
                    type="button"
                    className={actionPrimary}
                    disabled={!anyEntered || busy}
                    onClick={handleApprove}
                  >
                    {busy ? 'Applying…' : 'Apply Approval'}
                  </button>
                )}
              </div>
            </div>

            {applied.length > 0 && (
              <p className="mt-4 rounded-lg border border-[#cfd8dc] bg-[#eceff1] px-4 py-3 text-[13px] text-[#455a64]">
                {formatQty(applied.reduce((s, a) => s + a.qty, 0))} unit(s) are now approved.
                &lsquo;Proceed to PO Creation&rsquo; raises a purchase order for them on {state?.mrsNo} in Pending
                Purchase. Any quantity already approved but not yet purchased stays with
                Follow-up Purchase in the Purchase Orders section.
              </p>
            )}

            {history.length > 0 && (
              <div className="mt-6 pt-4 border-t border-[#eee]">
                <h3 className="m-0 mb-2 text-[11px] font-bold text-[#666] uppercase">Approval History</h3>
                <ul className="m-0 p-0 list-none flex flex-col gap-1.5">
                  {history.map((h) => (
                    <li key={h.id} className="text-[12px] text-[#555]">
                      <span className="font-semibold text-[#333]">{HISTORY_LABELS[h.action] ?? h.action}</span>
                      {h.itemDescription ? ` — ${h.itemDescription}` : ''}
                      {` · ${formatQty(h.qty)}`}
                      {h.actor ? ` · ${h.actor}` : ''}
                      {h.reason ? ` · “${h.reason}”` : ''}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}

        {rejecting && (
          <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-[1001] animate-fade-in">
            <div className="bg-white rounded-xl w-full max-w-[440px] shadow-[0_10px_30px_rgba(0,0,0,0.15)] animate-slide-in p-6">
              <h3 className="m-0 mb-3 text-base font-bold text-[#333]">Reject Remaining Approval</h3>
              <p className="mt-0 mb-4 text-[13px] text-[#666] leading-relaxed">
                {rejecting.itemDescription}: {formatQty(rejecting.outstanding)} {rejecting.unit} will be rejected.
                The {formatQty(rejecting.approvedQty ?? 0)} already approved stays approved and remains
                available for purchase order creation.
              </p>
              <label className="text-[11px] font-bold text-[#444]">
                REASON <span className="text-[#d32f2f] ml-0.5">*</span>
              </label>
              <textarea
                value={reason}
                onChange={(e) => { setReason(e.target.value); setError(''); }}
                placeholder="Why is the remaining quantity rejected?"
                className="py-2.5 px-3 mt-1 border border-[#ccc] rounded-md text-[13px] text-[#333] bg-white transition-all duration-200 w-full box-border focus:outline-none focus:border-[#0288d1] focus:ring-2 focus:ring-[#0288d1]/10 placeholder:text-[#bbb] resize-none h-[90px]"
              />
              {error && <p className="mt-2 mb-0 text-[12px] text-[#c62828]">{error}</p>}
              <div className="flex justify-end gap-3 mt-5 pt-4 border-t border-[#eee]">
                <button type="button" className={actionSecondary} onClick={cancelReject} disabled={busy}>Cancel</button>
                <button type="button" className={actionDestructive} onClick={handleReject} disabled={busy}>
                  {busy ? 'Rejecting…' : 'Reject Remaining'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default FollowUpApprovalModal;