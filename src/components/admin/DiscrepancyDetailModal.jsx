'use client';

import { useCallback, useEffect, useState } from 'react';

import { getPOTracker, getPODiscrepancies } from '../../../actions/procurement';
import { useAdminData } from '../../context/AdminDataContext';
import StatusBadge from '../ui/StatusBadge';
import { actionPrimary, actionSecondary } from '../ui/tableTheme';

/**
 * Investigate and resolve the receiving discrepancies on one purchase order.
 *
 * The counterpart to the warehouse's Report Discrepancy: they raised the flag,
 * this is where somebody finds out what became of it. It is reached from the
 * existing Discrepancies section on the Purchase Orders page rather than from a
 * navigation item of its own, because the section already answers "which POs need
 * attention" and a second entry point for the same question is how two lists
 * start disagreeing.
 *
 * Resolving records status/resolvedBy/resolvedAt/resolution and NOTHING else. In
 * particular it does not touch the quantities: fifty purchased and forty-nine
 * received stays fifty and forty-nine, because that is what was bought and what
 * was counted, and rewriting either here would destroy the evidence the
 * investigation just used. If the supplier will not deliver the last unit, the
 * follow-up purchase flow is the answer, not a quiet edit.
 *
 * Resolved rows stay on screen, permanently, under their resolution. They are
 * never removed: a discrepancy that vanished on resolution would leave a history
 * claiming nothing was ever wrong.
 */
export default function DiscrepancyDetailModal({ poNumber, onClose, onChanged }) {
  const { resolveDiscrepancy } = useAdminData();
  const [tracker, setTracker] = useState(null);
  const [rows, setRows] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  // id of the open row whose resolution form is showing, plus its note.
  const [resolvingId, setResolvingId] = useState(null);
  const [resolution, setResolution] = useState('');
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState('');

  const load = useCallback(async () => {
    try {
      const [t, d] = await Promise.all([getPOTracker(poNumber), getPODiscrepancies(poNumber)]);
      setTracker(t);
      setRows(d);
      setError('');
    } catch (e) {
      setError(e?.message || 'Failed to load discrepancies');
    } finally {
      setLoading(false);
    }
  }, [poNumber]);

  useEffect(() => {
    load();
  }, [load]);

  const submit = async (id) => {
    if (busy || !resolution.trim()) return;
    setBusy(true);
    setError('');
    try {
      await resolveDiscrepancy({ id, poNumber, resolution: resolution.trim() });
      setResolvingId(null);
      setResolution('');
      setSuccess('Discrepancy resolved. The report and your note stay on this PO as history.');
      await load();
      onChanged?.();
    } catch (e) {
      setError(e?.message || 'Failed to resolve the discrepancy');
    } finally {
      setBusy(false);
    }
  };

  const itemFor = (poItemId) => (tracker?.items ?? []).find((i) => i.poItemId === poItemId);

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-[1000] overflow-y-auto py-6 px-4">
      <div className="bg-white rounded-xl w-full max-w-[760px] max-h-[90vh] overflow-y-auto shadow-[0_10px_30px_rgba(0,0,0,0.15)] p-6 text-left">
        <div className="flex justify-between items-start border-b border-[#eee] pb-3 mb-5">
          <div>
            <h2 className="m-0 text-lg font-bold text-[#333]">Discrepancies</h2>
            <p className="m-0 mt-0.5 text-[12px] text-[#888]">
              {poNumber}
              {tracker?.mrsNo ? <span> &middot; MRS {tracker.mrsNo}</span> : null}
              {tracker?.supplier ? <span> &middot; {tracker.supplier}</span> : null}
            </p>
          </div>
          <button type="button" className="text-2xl text-[#888]" onClick={onClose} aria-label="Close">
            &times;
          </button>
        </div>

        {success && (
          <div className="mb-4 p-3 bg-[#e8f5e9] text-[#2e7d32] border border-[#a5d6a7] rounded-md text-xs font-bold">
            &#10003; {success}
          </div>
        )}
        {error && (
          <div className="mb-4 p-3 bg-[#ffebee] text-[#c62828] border border-[#ef9a9a] rounded-md text-xs font-semibold">
            {error}
          </div>
        )}
        {loading && <p className="text-[13px] text-[#666]">Loading…</p>}

        {!loading && rows.length === 0 && (
          <p className="text-[13px] text-[#666]">
            No discrepancy has ever been reported on this purchase order.
          </p>
        )}

        {rows.map((d) => {
          const item = itemFor(d.poItemId);
          const isOpen = d.status === 'open';
          const isResolvingThis = resolvingId === d.id;
          return (
            <div
              key={d.id}
              className="border border-[#e0e0e0] rounded-lg p-3 mb-3 bg-[#fafafa]"
              data-testid={`discrepancy-${d.id}`}
            >
              <div className="flex justify-between items-start gap-3">
                <div>
                  <div className="text-[13px] font-semibold text-[#333]">
                    {d.itemDescription} <span className="text-[11px] text-[#888]">({d.unit})</span>
                  </div>
                  <div className="text-[12px] text-[#c62828] font-bold mt-0.5">{d.discrepancyType}</div>
                </div>
                <StatusBadge status={d.statusLabel} />
              </div>

              {/* The live quantity chain, so the report can be judged against
                  what was bought and what was counted. Never adjusted by
                  resolving. */}
              {item && (
                <div className="grid grid-cols-4 gap-2 mt-2 text-[12px]">
                  <div>
                    <div className="text-[10px] font-bold text-[#999]">APPROVED</div>
                    <div className="text-[13px] font-semibold">{item.approvedQty}</div>
                  </div>
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
              )}

              {d.remarks && <p className="text-[12px] text-[#555] mt-2 mb-0">{d.remarks}</p>}

              <p className="text-[11px] text-[#888] mt-2 mb-0">
                Reported by {d.reportedBy} on {new Date(d.reportedAt).toLocaleString()}
              </p>

              {isOpen && !isResolvingThis && (
                <button
                  onClick={() => {
                    setResolvingId(d.id);
                    setResolution('');
                  }}
                  className={`${actionPrimary} py-2 px-4 mt-3`}
                >
                  Resolve Discrepancy
                </button>
              )}

              {isResolvingThis && (
                <div className="mt-3 pt-3 border-t border-[#eee]">
                  <label className="text-[11px] font-bold text-[#444]" htmlFor={`resolution-${d.id}`}>
                    Resolution Notes
                  </label>
                  <textarea
                    id={`resolution-${d.id}`}
                    rows={3}
                    value={resolution}
                    onChange={(e) => setResolution(e.target.value)}
                    placeholder="What did the investigation find? e.g. Supplier confirmed the last box ships Thursday."
                    className="py-2 px-3 border border-[#ccc] rounded-md text-[13px] w-full box-border mt-0.5 resize-y"
                  />
                  <p className="text-[11px] text-[#888] mt-1 mb-2">
                    Resolving closes this exception and keeps the report. It does not change any quantity and
                    does not delete anything.
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        setResolvingId(null);
                        setResolution('');
                      }}
                      className={`${actionSecondary} py-2 px-4`}
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => submit(d.id)}
                      disabled={busy || !resolution.trim()}
                      className={`${actionPrimary} py-2 px-4 ${busy || !resolution.trim() ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                      {busy ? 'Resolving…' : 'Resolve Discrepancy'}
                    </button>
                  </div>
                </div>
              )}

              {!isOpen && (
                // The header badge above already says Resolved; repeating it here
                // would put the same word on screen twice per row.
                <div className="mt-2 pt-2 border-t border-[#eee] text-[12px] text-[#888]">
                  Resolved by {d.resolvedBy} on{' '}
                  {d.resolvedAt ? new Date(d.resolvedAt).toLocaleString() : ''}
                  {d.resolution && <p className="text-[#555] mt-1 mb-0">{d.resolution}</p>}
                </div>
              )}
            </div>
          );
        })}

        <div className="flex justify-end pt-4 mt-2 border-t border-[#eee]">
          <button type="button" onClick={onClose} className={`${actionSecondary} py-2 px-6`}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
