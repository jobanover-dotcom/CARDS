'use client';
import React, { useEffect, useState } from 'react';
import StatusBadge from '../ui/StatusBadge';
import { useAdminData } from '../../context/AdminDataContext';
import { getPOTracker, getPOAuditLog } from '../../../actions/procurement';

// Purchase quantity module — the FIRST purchase against a PO.
//
//   PURCHASE QUANTITIES
//     Item | Approved | Purchased | Remaining Procurement
//
//   SUPPLIER INFORMATION   (bottom — the supplier belongs to the procurement
//                          act, not to the PO being raised)
//
//   [ Save Purchase ]
//
// This records the one purchasing transaction a PO can hold, and gives it its one
// supplier. Once a purchase exists the PO is closed to further purchasing: buying
// more is a Follow-up Purchase, which opens the PO creation form and raises a NEW
// PO on the same material request. It never accumulates here, and never re-opens
// this PO to change its supplier.
//
// There is deliberately no "Mark for Delivery" and no "Proceed to Delivery": the
// supplier is external to CARDS and delivers on its own schedule.

const inputClass = 'py-2 px-3 border border-[#ccc] rounded-md text-[13px] text-[#333] focus:outline-none focus:border-[#006680] w-full box-border';
const sectionTitle = 'm-0 text-xs font-bold text-[#555] uppercase tracking-wide';
const labelClass = 'text-[11px] font-bold text-[#444]';

// Human labels for the workflow audit log.
const HISTORY_LABELS = {
  purchase_saved: 'Purchase saved',
  follow_up_raised: 'Follow-up PO raised',
  receiving_edited: 'Receiving corrected',
  po_reopened: 'PO reopened',
  supplier_set: 'Supplier set',
  supplier_changed: 'Supplier changed',
  receiving_recorded: 'Receiving recorded',
  receiving_remarks: 'Receiving remarks',
  po_completed: 'PO completed',
  purchase_confirmed: 'Purchase confirmed',
  receiving_confirmed: 'Receiving confirmed',
  ready_for_delivery: 'Marked ready for delivery',
  on_delivery: 'Marked on delivery',
  delivery_created: 'Delivery created',
  delivery_in_transit: 'Delivery in transit',
  dr_uploaded: 'DR uploaded',
};

function PurchaseWorkflowModal({ poNumber, onClose, onChanged }) {
  const { savePurchase } = useAdminData();
  const [tracker, setTracker] = useState(null);
  const [purchased, setPurchased] = useState({});
  const [supplier, setSupplier] = useState('');
  const [supplierAddress, setSupplierAddress] = useState('');
  const [remarks, setRemarks] = useState('');
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  // Purchase / receiving history. A quantity bought across several procurement
  // actions stays visible as several events on this one PO.
  const [history, setHistory] = useState([]);

  const loadHistory = async () => {
    try {
      setHistory(await getPOAuditLog(poNumber, 25));
    } catch {
      setHistory([]);
    }
  };

  const reload = async () => {
    // Always the canonical chain. Refreshing from the raw purchase order used to
    // blank every quantity column and collide the row keys the moment a purchase
    // was saved, because only the chain carries poItemId and approvedQty.
    setTracker(await getPOTracker(poNumber));
    await loadHistory();
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Seed the inputs from the SERVER's canonical chain, never from the raw
        // item row, so the approved quantity shown matches what the server will
        // enforce against the live source request. The tracker, the supplier and
        // the line keys therefore all come from this one read. A missing PO makes
        // getPOTracker throw, which surfaces below as the same not-found message.
        const t = await getPOTracker(poNumber);
        if (cancelled) return;
        setTracker(t);
        const seed = {};
        for (const item of t.items) seed[item.poItemId] = String(item.purchasedQty);
        setPurchased(seed);
        setSupplier(t.supplier || '');
        setSupplierAddress(t.supplierAddress || '');
        getPOAuditLog(poNumber, 25).then((h) => { if (!cancelled) setHistory(h); }).catch(() => {});
      } catch (e) {
        if (!cancelled) setError(e?.message || 'Failed to load purchase order.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [poNumber]);

  const items = tracker?.items ?? [];
  // This PO already holds a purchase, so the purchasing action has moved to the
  // Follow-up Purchase form. Offering Save Purchase again would be a dead end —
  // and the server rejects it regardless.
  const alreadyPurchased = tracker?.totals?.purchased > 0;
  const canSave =
    tracker?.lifecycle !== 'completed' && tracker?.lifecycle !== 'cancelled' && !alreadyPurchased;

  const clamp = (item, value) => {
    const raw = value.replace(/[^0-9]/g, '');
    // Input mask only. The server re-caps against the live approved quantity
    // and rejects over-claims, so the UI can never authorise one.
    const qty = raw === '' ? '' : String(Math.min(Number(raw), item.approvedQty));
    setPurchased((prev) => ({ ...prev, [item.poItemId]: qty }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    if (busy) return;
    if (!supplier.trim()) {
      setError('Supplier is required when saving purchase.');
      return;
    }
    const payload = items.map((item) => ({
      poItemId: item.poItemId,
      purchasedQty: Number(purchased[item.poItemId] ?? 0),
    }));
    if (!payload.length) {
      setError('This purchase order has no items to purchase.');
      return;
    }
    setBusy(true);
    try {
      const result = await savePurchase({
        poNumber,
        items: payload,
        supplier: supplier.trim(),
        supplierAddress: supplierAddress.trim() || undefined,
        remarks: remarks.trim() || undefined,
      });
      const remaining = result?.tracker?.totals?.procurementOutstanding ?? 0;
      setSuccess(
        remaining > 0
          ? `Purchase saved on ${poNumber}. ${remaining} unit(s) still outstanding — buy the rest with a Follow-up Purchase, which raises a new PO on ${tracker.mrsNo}.`
          : `Purchase saved on ${poNumber}. Nothing left to purchase; the warehouse receives as the supplier delivers.`,
      );
      setRemarks('');
      await reload();
      onChanged?.();
    } catch (err) {
      setError(err?.message || 'Failed to save purchase.');
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-[1000]">
        <div className="bg-white rounded-xl p-6 text-[13px] text-[#666]">Loading…</div>
      </div>
    );
  }

  if (!tracker) {
    return (
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-[1000]">
        <div className="bg-white rounded-xl p-6 text-[13px] text-[#c62828]">{error || 'Purchase order not found.'}</div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-[1000] overflow-y-auto py-6 px-4">
      <div className="bg-white rounded-xl w-full max-w-[760px] max-h-[90vh] overflow-y-auto shadow-[0_10px_30px_rgba(0,0,0,0.15)] p-6 text-left">
        <div className="flex justify-between items-center border-b border-[#eee] pb-3 mb-5">
          <div>
            <h2 className="m-0 text-lg font-bold text-[#333]">Save Purchase</h2>
            <p className="m-0 mt-0.5 text-[12px] text-[#888]">
              Record what was actually bought for {poNumber}. This is the one purchase this PO holds; buying
              more later raises a new PO on the same material request.
            </p>
          </div>
          <button type="button" className="text-2xl text-[#888]" onClick={onClose} aria-label="Close">&times;</button>
        </div>

        {success && <div className="mb-4 p-3 bg-[#e8f5e9] text-[#2e7d32] border border-[#a5d6a7] rounded-md text-xs font-bold">&#10003; {success}</div>}
        {error && <div className="mb-4 p-3 bg-[#ffebee] text-[#c62828] border border-[#ef9a9a] rounded-md text-xs font-semibold">{error}</div>}

        <div className="grid grid-cols-2 gap-4 mb-5">
          <div>
            <label className={labelClass}>PO NUMBER</label>
            <input value={tracker.poNumber} readOnly className={`${inputClass} bg-gray-50`} />
          </div>
          <div>
            <label className={labelClass}>STATUS</label>
            <div className="py-2"><StatusBadge status={tracker.statusLabel} /></div>
          </div>
          <div>
            <label className={labelClass}>MRS NO.</label>
            <input value={tracker.mrsNo} readOnly className={`${inputClass} bg-gray-50`} />
          </div>
          <div>
            <label className={labelClass}>WAREHOUSE</label>
            <input value={tracker.warehouse} readOnly className={`${inputClass} bg-gray-50`} />
          </div>
        </div>

        {/* Context for the ENTIRE PO, including lines that are already done. */}
        <div className="border border-[#e0e0e0] rounded-lg p-3 mb-4 bg-[#fafafa]">
          <h3 className={sectionTitle}>This purchase order</h3>
          <table className="w-full border-collapse text-[13px] mt-2">
            <thead>
              <tr className="text-left text-[10px] text-[#999]">
                <th className="py-1 pr-2">ITEM</th>
                <th className="py-1 pr-2">APPROVED</th>
                <th className="py-1 pr-2">PURCHASED</th>
                <th className="py-1 pr-2">RECEIVED</th>
                <th className="py-1 pr-2">TO PURCHASE</th>
                <th className="py-1 pr-2">TO RECEIVE</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.poItemId} className="border-t border-[#f1f1f1]">
                  <td className="py-2 pr-2 font-medium">{item.itemDescription}</td>
                  <td className="py-2 pr-2">{item.approvedQty}</td>
                  <td className="py-2 pr-2">{item.purchasedQty}</td>
                  <td className="py-2 pr-2">{item.receivedQty}</td>
                  <td className={`py-2 pr-2 font-bold ${item.procurementOutstanding ? 'text-[#e65100]' : 'text-[#2e7d32]'}`}>
                    {item.procurementOutstanding}
                  </td>
                  <td className={`py-2 pr-2 font-bold ${item.receivingOutstanding ? 'text-[#006680]' : 'text-[#2e7d32]'}`}>
                    {item.receivingOutstanding}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {canSave ? (
          <form onSubmit={handleSubmit} className="border border-[#eee] rounded-lg p-3 mb-4">
            {/* PURCHASE QUANTITIES */}
            <h3 className={sectionTitle}>Purchase quantities</h3>
            <div className="flex flex-col gap-3 mt-3">
              {items.map((item) => {
                const remaining = item.procurementOutstanding;
                return (
                  <div
                    key={item.poItemId}
                    className="grid grid-cols-[1.7fr_.7fr_.9fr_.9fr] gap-2 items-end border-b border-[#f1f1f1] pb-3 last:border-b-0 last:pb-0"
                  >
                    <div>
                      <label className="text-[10px] font-bold text-[#999]">ITEM</label>
                      <div className="text-[13px] font-medium text-[#333]">
                        {item.itemDescription} <span className="text-[10px] text-[#888]">({item.unit})</span>
                      </div>
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-[#999]">APPROVED</label>
                      <div className="text-[13px] font-semibold">{item.approvedQty}</div>
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-[#444]">PURCHASED</label>
                      <input
                        type="number"
                        min="0"
                        max={item.approvedQty}
                        step="1"
                        value={purchased[item.poItemId] ?? ''}
                        onChange={(e) => clamp(item, e.target.value)}
                        className={inputClass}
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-[#999]">REMAINING</label>
                      <div className={`text-[13px] font-bold ${remaining ? 'text-[#e65100]' : 'text-[#2e7d32]'}`}>
                        {Math.max(0, item.approvedQty - Number(purchased[item.poItemId] || 0))}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="mt-2 mb-0 text-[11px] text-[#888]">
              Enter what was bought for each item on this purchase. Leave an item at 0 to buy it later —
              that remainder becomes a Follow-up Purchase, a new PO on the same material request.
            </p>

            <div className="mt-3">
              <label className={labelClass}>REMARKS (OPTIONAL)</label>
              <input value={remarks} onChange={(e) => setRemarks(e.target.value)} className={inputClass} />
            </div>

            {/* SUPPLIER INFORMATION — recorded at the point of procurement. */}
            <h3 className={`${sectionTitle} mt-4`}>Supplier information</h3>
            <div className="flex gap-4 mt-2">
              <div className="flex flex-col gap-1.5 flex-1">
                <label className={labelClass}>SUPPLIER *</label>
                <input
                  type="text"
                  value={supplier}
                  onChange={(e) => setSupplier(e.target.value)}
                  required
                  className={inputClass}
                  placeholder="Select the supplier for this purchase"
                />
              </div>
              <div className="flex flex-col gap-1.5 flex-1">
                <label className={labelClass}>SUPPLIER ADDRESS</label>
                <input
                  type="text"
                  value={supplierAddress}
                  onChange={(e) => setSupplierAddress(e.target.value)}
                  className={inputClass}
                />
              </div>
            </div>

            <div className="flex justify-end mt-4">
              <button type="submit" disabled={busy} className="py-2.5 px-6 bg-[#006680] text-white rounded-md disabled:opacity-60">
                {busy ? 'Saving…' : 'Save Purchase'}
              </button>
            </div>
          </form>
        ) : (
          <div className="p-3 bg-[#f5f5f5] border border-[#e0e0e0] rounded-md text-xs font-semibold text-[#555]">
            {alreadyPurchased
              ? `This purchase order already holds its purchase from ${tracker.supplier || 'a supplier'}. A PO is one transaction with one supplier — buy the rest with a Follow-up Purchase, which raises a new PO on ${tracker.mrsNo}.`
              : `This purchase order is ${tracker.statusLabel?.toLowerCase()} — no further purchasing is available.`}
          </div>
        )}

        {tracker?.followUpRequired && alreadyPurchased && (
          <p className="mt-0 mb-4 text-[12px] font-semibold text-[#e65100]">
            {tracker.totals.procurementOutstanding} unit(s) on this material request are still unpurchased.
            Close this and use Follow-up Purchase, which raises a new PO on {tracker.mrsNo} rather than
            changing this one.
          </p>
        )}

        {history.length > 0 && (
          <div className="border border-[#e0e0e0] rounded-lg p-3 mb-4 bg-[#fafafa]">
            <h3 className={sectionTitle}>Purchase &amp; receiving history</h3>
            <p className="mt-1 mb-2 text-[11px] text-[#888]">
              Every procurement and receiving action recorded against this PO. This PO holds a single
              purchase; further buying appears as a new purchase order on {tracker?.mrsNo || 'the same material request'}.
            </p>
            <ul className="m-0 p-0 list-none flex flex-col gap-1.5">
              {history.map((entry) => (
                <li key={entry.id} className="text-[12px] text-[#555] border-b border-[#f1f1f1] pb-1.5 last:border-b-0 last:pb-0">
                  <span className="font-bold text-[#1e3c72]">{HISTORY_LABELS[entry.action] || entry.action}</span>
                  {entry.detail && <span> &mdash; {entry.detail}</span>}
                  <span className="text-[#999]"> · {new Date(entry.createdAt).toLocaleString()}{entry.actor ? ` · ${entry.actor}` : ''}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex justify-end gap-3 mt-2 pt-4 border-t border-[#eee]">
          <button type="button" onClick={onClose} className="py-2.5 px-6 bg-white text-[#333] border border-[#ccc] rounded-md">Close</button>
        </div>
      </div>
    </div>
  );
}

export default PurchaseWorkflowModal;
