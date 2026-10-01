'use client';
import React, { useEffect, useState } from 'react';
import StatusBadge from '../ui/StatusBadge';
import { useAdminData } from '../../context/AdminDataContext';
import { getPOByNumber } from '../../../actions/pos';
import { PO_STATUS } from '../../lib/deliveryStatus';

const inputClass = 'py-2 px-3 border border-[#ccc] rounded-md text-[13px] text-[#333] focus:outline-none focus:border-[#006680] w-full box-border';
const sectionTitle = 'm-0 text-xs font-bold text-[#555] uppercase tracking-wide';

// Simplified procurement workflow:
// Confirm Purchase (partial allowed, same PO) → Mark On Delivery → Receiving → Completed.
// No delivery tracking, no transport fields, no DR photos.
function PurchaseWorkflowModal({ poNumber, onClose, onChanged }) {
  const { confirmPurchase, markOnDelivery, getSimplifiedTracker } = useAdminData();
  const [po, setPo] = useState(null);
  const [tracker, setTracker] = useState(null);
  const [purchased, setPurchased] = useState({});
  const [remarks, setRemarks] = useState('');
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const reload = async () => {
    const fresh = await getPOByNumber(poNumber);
    setPo(fresh);
    try {
      setTracker(await getSimplifiedTracker(poNumber));
    } catch { /* tracker optional */ }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const fresh = await getPOByNumber(poNumber);
        if (cancelled) return;
        setPo(fresh);
        if (fresh) {
          const init = {};
          for (const item of fresh.items || []) init[item.id] = String(item.purchasedQty ?? item.qty);
          setPurchased(init);
          try {
            const t = await getSimplifiedTracker(poNumber);
            if (!cancelled) setTracker(t);
          } catch { /* ignore */ }
        }
      } catch (e) {
        if (!cancelled) setError(e?.message || 'Failed to load purchase order.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [poNumber]);

  const status = po?.status || '';
  const canConfirm = status === PO_STATUS.AWAITING_PURCHASE.value || status === PO_STATUS.PURCHASE_CONFIRMED.value || status === 'incomplete';
  const canMarkOnDelivery = status === PO_STATUS.PURCHASE_CONFIRMED.value || status === PO_STATUS.READY_FOR_DELIVERY.value;

  const handleConfirm = async (e) => {
    e.preventDefault();
    setError(null); setSuccess(null);
    if (busy) return;
    setBusy(true);
    try {
      // Incremental: only send lines the purchaser touched; server keeps the rest.
      const items = (po.items || [])
        .map((item) => ({ poItemId: item.id, purchasedQty: Number(purchased[item.id]) }))
        .filter((i) => Number.isInteger(i.purchasedQty) && i.purchasedQty > 0);
      if (!items.length) throw new Error('Enter at least one purchased quantity');
      await confirmPurchase({ poNumber, items, remarks: remarks.trim() || undefined });
      setSuccess('Purchase saved. Remaining quantities stay on this PO as Follow-Up.');
      setRemarks('');
      await reload();
      onChanged?.();
    } catch (e) {
      setError(e?.message || 'Failed to confirm purchase.');
    } finally {
      setBusy(false);
    }
  };

  const handleOnDelivery = async () => {
    setError(null); setSuccess(null);
    if (busy) return;
    setBusy(true);
    try {
      await markOnDelivery(poNumber);
      setSuccess('Marked On Delivery — supplier has dispatched the purchased items.');
      await reload();
      onChanged?.();
    } catch (e) {
      setError(e?.message || 'Failed to mark on delivery.');
    } finally {
      setBusy(false);
    }
  };

  const clampPurchased = (item, value) => {
    const raw = value.replace(/[^0-9]/g, '');
    const tracked = (tracker?.items || []).find((t) => t.poItemId === item.id);
    const max = tracked ? tracked.approvedQty : item.qty;
    const qty = raw === '' ? '' : Math.min(Number(raw), max);
    setPurchased((prev) => ({ ...prev, [item.id]: String(qty) }));
  };

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-[1000] overflow-y-auto py-6 px-4">
      <div className="bg-white rounded-xl w-full max-w-[680px] max-h-[90vh] overflow-y-auto shadow-[0_10px_30px_rgba(0,0,0,0.15)] p-6 text-left">
        <div className="flex justify-between items-center border-b border-[#eee] pb-3 mb-5">
          <h2 className="m-0 text-lg font-bold text-[#333]">Procurement Workflow</h2>
          <button className="text-2xl text-[#888]" onClick={onClose}>X</button>
        </div>
        {loading && <p className="text-[13px] text-[#666]">Loading…</p>}
        {!loading && !po && <p className="text-[13px] text-[#c62828]">{error || 'Purchase order not found.'}</p>}
        {!loading && po && <>
          {success && <div className="mb-4 p-3 bg-[#e8f5e9] text-[#2e7d32] border border-[#a5d6a7] rounded-md text-xs font-bold">✓ {success}</div>}
          {error && <div className="mb-4 p-3 bg-[#ffebee] text-[#c62828] border border-[#ef9a9a] rounded-md text-xs font-semibold">{error}</div>}

          <div className="grid grid-cols-2 gap-4 mb-5">
            <div><label className="text-[11px] font-bold text-[#444]">PO NUMBER</label><input value={po.poNumber || ''} disabled className={`${inputClass} bg-gray-50`} /></div>
            <div><label className="text-[11px] font-bold text-[#444]">STATUS</label><div className="py-2"><StatusBadge status={po.statusLabel || po.status} /></div></div>
            <div><label className="text-[11px] font-bold text-[#444]">SUPPLIER</label><input value={po.supplier || ''} disabled className={`${inputClass} bg-gray-50`} /></div>
            <div><label className="text-[11px] font-bold text-[#444]">MRS NO.</label><input value={po.mrsNo || ''} disabled className={`${inputClass} bg-gray-50`} /></div>
          </div>

          {tracker && (
            <div className="border border-[#e0e0e0] rounded-lg p-3 mb-4 bg-[#fafafa]">
              <h3 className={sectionTitle}>Requested → Approved → Purchased → Received</h3>
              <table className="w-full border-collapse text-[13px] mt-3">
                <thead><tr className="text-left text-[10px] text-[#999]">
                  <th className="py-1 pr-2">ITEM</th><th className="py-1 pr-2">APPR</th><th className="py-1 pr-2">PURCH</th><th className="py-1 pr-2">UNPURCH</th><th className="py-1 pr-2">RCVD</th><th className="py-1 pr-2">OUTST</th>
                </tr></thead>
                <tbody>
                  {tracker.items.map((row) => (
                    <tr key={row.poItemId} className="border-t border-[#f1f1f1]">
                      <td className="py-2 pr-2 font-medium">{row.itemDescription}</td>
                      <td className="py-2 pr-2">{row.approvedQty}</td>
                      <td className="py-2 pr-2">{row.purchasedQty}</td>
                      <td className={`py-2 pr-2 font-bold ${row.unpurchased ? 'text-[#e65100]' : 'text-[#2e7d32]'}`}>{row.unpurchased}</td>
                      <td className="py-2 pr-2">{row.receivedQty}</td>
                      <td className="py-2 pr-2">{row.outstanding}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {tracker.followUpRequired && (
                <p className="mt-2 text-[12px] font-semibold text-[#e65100]">Follow-Up Required: {tracker.totals.unpurchased} unit(s) remain on this PO.</p>
              )}
            </div>
          )}

          {canConfirm && (
            <form onSubmit={handleConfirm} className="border border-[#eee] rounded-lg p-3 mb-4">
              <h3 className={sectionTitle}>Confirm Purchase — partial allowed, same PO</h3>
              <div className="flex flex-col gap-3 mt-3">
                {(po.items || []).map((item) => (
                  <div key={item.id} className="grid grid-cols-[1.8fr_.6fr_.9fr] gap-2 items-end border-b border-[#f1f1f1] pb-3 last:border-b-0 last:pb-0">
                    <div><label className="text-[10px] font-bold text-[#999]">MATERIAL</label><div className="text-[13px] font-medium text-[#333]">{item.itemDescription} <span className="text-[10px] text-[#888]">({item.unit})</span></div></div>
                    <div><label className="text-[10px] font-bold text-[#999]">APPROVED</label><div className="text-[13px] font-semibold">{item.qty}</div></div>
                    <div><label className="text-[10px] font-bold text-[#444]">PURCHASED</label><input type="number" min="1" max={item.qty} step="1" value={purchased[item.id] ?? ''} onChange={(e) => clampPurchased(item, e.target.value)} className={inputClass} /></div>
                  </div>
                ))}
              </div>
              <div className="mt-3"><label className="text-[11px] font-bold text-[#444]">REMARKS (OPTIONAL)</label><input value={remarks} onChange={(e) => setRemarks(e.target.value)} className={inputClass} /></div>
              <div className="flex justify-end mt-3"><button type="submit" disabled={busy} className="py-2.5 px-6 bg-[#006680] text-white rounded-md disabled:opacity-60">{busy ? 'Saving…' : 'Save Purchase'}</button></div>
            </form>
          )}

          {canMarkOnDelivery && (
            <div className="border border-[#eee] rounded-lg p-3 mb-4">
              <h3 className={sectionTitle}>On Delivery checkpoint</h3>
              <p className="text-[13px] text-[#666]">Purchased items have been dispatched by the supplier. Allowed even when partially purchased — the remainder stays as Follow-Up on this PO.</p>
              <div className="flex justify-end"><button onClick={handleOnDelivery} disabled={busy} className="py-2.5 px-6 bg-[#006680] text-white rounded-md disabled:opacity-60">{busy ? 'Marking…' : 'Mark On Delivery'}</button></div>
            </div>
          )}

          <div className="flex justify-end gap-3 mt-2 pt-4 border-t border-[#eee]">
            <button type="button" onClick={onClose} className="py-2.5 px-6 bg-white text-[#333] border border-[#ccc] rounded-md">Close</button>
          </div>
        </>}
      </div>
    </div>
  );
}

export default PurchaseWorkflowModal;
