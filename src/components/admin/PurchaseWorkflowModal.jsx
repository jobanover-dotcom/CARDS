'use client';
import React, { useEffect, useMemo, useState } from 'react';
import StatusBadge from '../ui/StatusBadge';
import POQuantityTracker from '../shared/POQuantityTracker';
import { useAdminData } from '../../context/AdminDataContext';
import { getPOByNumber } from '../../../actions/pos';
import { getDeliveries, getRemainingDeliverable } from '../../../actions/deliveries';
import { PO_STATUS } from '../../lib/deliveryStatus';

const inputClass = 'py-2 px-3 border border-[#ccc] rounded-md text-[13px] text-[#333] focus:outline-none focus:border-[#006680] w-full box-border';
const sectionTitle = 'm-0 text-xs font-bold text-[#555] uppercase tracking-wide';

function today() {
  return new Date().toISOString().slice(0, 10);
}

function PurchaseWorkflowModal({ poNumber, onClose, onChanged }) {
  const { confirmPurchase, markReadyForDelivery, proceedToDelivery, getPOQuantityTracker } = useAdminData();
  const [po, setPo] = useState(null);
  const [remaining, setRemaining] = useState(null);
  const [tracker, setTracker] = useState(null);
  const [trackerError, setTrackerError] = useState(null);
  const [deliveries, setDeliveries] = useState([]);
  const [purchased, setPurchased] = useState({});
  const [deliverQty, setDeliverQty] = useState({});
  const [deliveredBy, setDeliveredBy] = useState('');
  const [plateNumber, setPlateNumber] = useState('');
  const [deliveryDate, setDeliveryDate] = useState(today());
  const [remarks, setRemarks] = useState('');
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const reload = async () => {
    const fresh = await getPOByNumber(poNumber);
    setPo(fresh);
    try {
      const t = await getPOQuantityTracker(poNumber);
      setTracker(t);
      setTrackerError(null);
    } catch (e) { setTrackerError(e?.message || 'Tracker unavailable'); }
    if (fresh && (fresh.status === PO_STATUS.READY_FOR_DELIVERY.value || fresh.status === 'completed')) {
      try {
        const [rem, dels] = await Promise.all([
          getRemainingDeliverable(poNumber),
          getDeliveries({ poNumber, limit: 50 }),
        ]);
        setRemaining(rem);
        setDeliveries(dels.rows);
      } catch { /* scoped read may fail; workflow still usable */ }
    }
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
            const t = await getPOQuantityTracker(poNumber);
            if (!cancelled) { setTracker(t); setTrackerError(null); }
          } catch (e) {
            if (!cancelled) setTrackerError(e?.message || 'Tracker unavailable');
          }
          if (fresh.status === PO_STATUS.READY_FOR_DELIVERY.value || fresh.status === 'completed') {
            const [rem, dels] = await Promise.all([
              getRemainingDeliverable(poNumber),
              getDeliveries({ poNumber, limit: 50 }),
            ]);
            if (!cancelled) { setRemaining(rem); setDeliveries(dels.rows); }
          }
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
  const canConfirm = status === PO_STATUS.AWAITING_PURCHASE.value || status === 'incomplete';
  const canMarkReady = status === PO_STATUS.PURCHASE_CONFIRMED.value;
  const canDeliver = status === PO_STATUS.READY_FOR_DELIVERY.value;

  const remainingByItem = useMemo(() => {
    const map = {};
    for (const row of remaining?.rows || []) map[row.poItemId] = row;
    return map;
  }, [remaining]);

  const handleConfirm = async (e) => {
    e.preventDefault();
    setError(null); setSuccess(null);
    if (busy) return;
    setBusy(true);
    try {
      const items = (po.items || []).map((item) => ({ poItemId: item.id, purchasedQty: Number(purchased[item.id]) }));
      for (const item of po.items || []) {
        const q = Number(purchased[item.id]);
        if (!Number.isInteger(q) || q < 1) throw new Error(`Purchased quantity for "${item.itemDescription}" must be a positive whole number`);
        if (q > item.qty) throw new Error(`Purchased quantity for "${item.itemDescription}" cannot exceed the approved quantity of ${item.qty}`);
      }
      await confirmPurchase({ poNumber, items, remarks: remarks.trim() || undefined });
      setSuccess('Purchase confirmed.');
      setRemarks('');
      await reload();
      onChanged?.();
    } catch (e) {
      setError(e?.message || 'Failed to confirm purchase.');
    } finally {
      setBusy(false);
    }
  };

  const handleMarkReady = async () => {
    setError(null); setSuccess(null);
    if (busy) return;
    setBusy(true);
    try {
      await markReadyForDelivery(poNumber); // server verifies completeness; UI never assumes success
      setSuccess('Marked ready for delivery.');
      await reload();
      onChanged?.();
    } catch (e) {
      setError(e?.message || 'Failed to mark ready for delivery.');
    } finally {
      setBusy(false);
    }
  };

  const handleProceed = async (e) => {
    e.preventDefault();
    setError(null); setSuccess(null);
    if (busy) return;
    setBusy(true);
    try {
      const items = Object.entries(deliverQty)
        .map(([poItemId, v]) => ({ poItemId, deliveredQty: Number(v) }))
        .filter((i) => Number.isInteger(i.deliveredQty) && i.deliveredQty > 0);
      const delivery = await proceedToDelivery({
        poNumber,
        deliveredBy: deliveredBy.trim() || undefined,
        plateNumber: plateNumber.trim() || undefined,
        deliveryDate,
        items,
        remarks: remarks.trim() || undefined,
      });
      setSuccess(`Delivery ${delivery.deliveryNumber} created.`);
      setDeliverQty({}); setDeliveredBy(''); setPlateNumber(''); setRemarks('');
      await reload();
      onChanged?.();
    } catch (e) {
      setError(e?.message || 'Failed to create delivery.');
    } finally {
      setBusy(false);
    }
  };

  const clampPurchased = (item, value) => {
    const raw = value.replace(/[^0-9]/g, '');
    // Client-side input mask only — the server caps against live approved
    // quantities and rejects over-claims. Tracker approved is preferred.
    const tracked = (tracker?.items || []).find((t) => t.poItemId === item.id);
    const max = tracked ? tracked.approvedQty : item.qty;
    const qty = raw === '' ? '' : Math.min(Number(raw), max);
    setPurchased((prev) => ({ ...prev, [item.id]: String(qty) }));
  };

  const clampDeliver = (row, value) => {
    const raw = value.replace(/[^0-9]/g, '');
    const qty = raw === '' ? '' : Math.min(Number(raw), row.remainingToDeliver);
    setDeliverQty((prev) => ({ ...prev, [row.poItemId]: String(qty) }));
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

          <div className="border border-[#e0e0e0] rounded-lg p-3 mb-4 bg-[#fafafa]">
            <h3 className={sectionTitle}>Procurement &amp; Delivery Tracker — same quantities as Warehouse</h3>
            {trackerError && <p className="text-[12px] text-[#c62828] mt-2">{trackerError}</p>}
            {!trackerError && <div className="mt-2"><POQuantityTracker tracker={tracker} variant="purchaser" /></div>}
          </div>

          {tracker && tracker.totals.remainingToReceive > 0 && tracker.totals.remainingToDeliver === 0 && (
            <div className="mb-4 p-3 bg-[#fff8e1] text-[#8d6e00] border border-[#ffcc80] rounded-md text-xs font-semibold">
              Receiving discrepancy — {tracker.totals.remainingToReceive} unit(s) delivered but not yet received. This belongs to the receiving/discrepancy workflow: do not create another purchase or delivery for it.
            </div>
          )}

          {canConfirm && (
            <form onSubmit={handleConfirm} className="border border-[#eee] rounded-lg p-3 mb-4">
              <h3 className={sectionTitle}>Confirm Purchase — actual purchased quantities</h3>
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
              <div className="flex justify-end mt-3"><button type="submit" disabled={busy} className="py-2.5 px-6 bg-[#006680] text-white rounded-md disabled:opacity-60">{busy ? 'Confirming…' : 'Confirm Purchase'}</button></div>
            </form>
          )}

          {canMarkReady && (
            <div className="border border-[#eee] rounded-lg p-3 mb-4">
              <h3 className={sectionTitle}>Ready for Delivery gate</h3>
              <p className="text-[13px] text-[#666]">Purchase is confirmed. The server verifies all purchasing information before the PO becomes deliverable.</p>
              <div className="flex justify-end"><button onClick={handleMarkReady} disabled={busy} className="py-2.5 px-6 bg-[#006680] text-white rounded-md disabled:opacity-60">{busy ? 'Checking…' : 'Mark Ready for Delivery'}</button></div>
            </div>
          )}

          {(canDeliver || status === 'completed') && (
            <div className="border border-[#eee] rounded-lg p-3 mb-4">
              <h3 className={sectionTitle}>Deliveries — remaining is server-calculated</h3>
              {remaining && (
                <table className="w-full border-collapse text-[13px] mt-3">
                  <thead><tr className="text-left text-[10px] text-[#999]">
                    <th className="py-1 pr-2">ITEM</th><th className="py-1 pr-2">PURCHASED</th><th className="py-1 pr-2">DELIVERED</th><th className="py-1 pr-2">REMAINING</th>
                  </tr></thead>
                  <tbody>
                    {remaining.rows.map((row) => (
                      <tr key={row.poItemId} className="border-t border-[#f1f1f1]">
                        <td className="py-2 pr-2 font-medium text-[#333]">{row.itemDescription}</td>
                        <td className="py-2 pr-2">{row.purchasedQty ?? '—'}</td>
                        <td className="py-2 pr-2">{row.deliveredQty}</td>
                        <td className={`py-2 pr-2 font-bold ${row.remainingToDeliver ? 'text-[#e65100]' : 'text-[#2e7d32]'}`}>{row.remainingToDeliver}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {deliveries.length > 0 && (
                <div className="mt-3 text-[12px] text-[#555]">
                  {deliveries.map((d) => (
                    <div key={d.id} className="flex justify-between items-center border-t border-[#f1f1f1] py-1.5">
                      <a
                        href={`${typeof window !== 'undefined' && window.location.pathname.startsWith('/purchaser') ? '/purchaser' : '/admin'}/deliveries/${d.deliveryNumber}`}
                        className="font-semibold text-[#006680]"
                      >
                        {d.deliveryNumber}
                      </a>
                      <StatusBadge status={d.statusLabel || d.status} />
                    </div>
                  ))}
                </div>
              )}
              {canDeliver && remaining?.canCreateDelivery && (
                <form onSubmit={handleProceed} className="mt-4 pt-3 border-t border-[#eee] flex flex-col gap-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div><label className="text-[11px] font-bold text-[#444]">DELIVERED BY</label><input value={deliveredBy} onChange={(e) => setDeliveredBy(e.target.value)} placeholder="Enter name" className={inputClass} /></div>
                    <div><label className="text-[11px] font-bold text-[#444]">PLATE NUMBER</label><input value={plateNumber} onChange={(e) => setPlateNumber(e.target.value)} placeholder="Enter plate number" className={inputClass} /></div>
                  </div>
                  <div><label className="text-[11px] font-bold text-[#444]">DELIVERY DATE *</label><input type="date" value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} required className={inputClass} /></div>
                  {(remaining?.rows || []).filter((r) => r.remainingToDeliver > 0).map((row) => (
                    <div key={row.poItemId} className="grid grid-cols-[1.8fr_.6fr_.9fr] gap-2 items-end">
                      <div><label className="text-[10px] font-bold text-[#999]">MATERIAL</label><div className="text-[13px] font-medium text-[#333]">{row.itemDescription}</div></div>
                      <div><label className="text-[10px] font-bold text-[#999]">REMAINING</label><div className="text-[13px] font-semibold">{row.remainingToDeliver}</div></div>
                      <div><label className="text-[10px] font-bold text-[#444]">DELIVER</label><input type="number" min="0" max={row.remainingToDeliver} step="1" value={deliverQty[row.poItemId] ?? ''} onChange={(e) => clampDeliver(row, e.target.value)} className={inputClass} /></div>
                    </div>
                  ))}
                  <div><label className="text-[11px] font-bold text-[#444]">REMARKS (OPTIONAL)</label><input value={remarks} onChange={(e) => setRemarks(e.target.value)} className={inputClass} /></div>
                  <div className="flex justify-end"><button type="submit" disabled={busy} className="py-2.5 px-6 bg-[#006680] text-white rounded-md disabled:opacity-60">{busy ? 'Creating…' : 'Proceed to Delivery'}</button></div>
                </form>
              )}
              {canDeliver && remaining && !remaining.canCreateDelivery && (
                <p className="mt-3 text-[12px] font-semibold text-[#2e7d32]">All quantities delivered — no further delivery can be created.</p>
              )}
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
