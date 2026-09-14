'use client';
import React, { useEffect, useRef, useState } from 'react';
import StatusBadge from '../ui/StatusBadge';
import { useWarehouseData } from '../../context/WarehouseDataContext';
import { getDeliveryByNumber } from '../../../actions/deliveries';
import { getReceiptUploadUrl, recordReceipt, getReceiptViewUrl } from '../../../actions/receipts';

const inputClass = 'py-2 px-3 border border-[#ccc] rounded-md text-[13px] text-[#333] focus:outline-none focus:border-[#006680] w-full box-border';

function ReceiveDeliveryForm({ deliveryNumber, onClose }) {
  const { confirmReceiving } = useWarehouseData();
  const [delivery, setDelivery] = useState(null);
  const [received, setReceived] = useState({});
  const [supplierDrNumber, setSupplierDrNumber] = useState('');
  const [receipts, setReceipts] = useState([]);
  const [viewUrls, setViewUrls] = useState({});
  const [remarks, setRemarks] = useState('');
  const [markAsDiscrepancy, setMarkAsDiscrepancy] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(true);
  const fileRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const d = await getDeliveryByNumber(deliveryNumber);
        if (cancelled) return;
        setDelivery(d);
        if (d) {
          const init = {};
          for (const item of d.items || []) init[item.id] = String(item.deliveredQty);
          setReceived(init);
          setSupplierDrNumber(d.supplierDrNumber || '');
          setRemarks(d.remarks || '');
          setReceipts(d.receipts || []);
        }
      } catch (e) {
        if (!cancelled) setError(e?.message || 'Failed to load delivery.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [deliveryNumber]);

  const handleQtyChange = (item, value) => {
    const raw = value.replace(/[^0-9]/g, '');
    const qty = raw === '' ? '' : Math.min(Number(raw), item.deliveredQty);
    setReceived((prev) => ({ ...prev, [item.id]: String(qty) }));
  };

  const handleFiles = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setError(null);
    setUploading(true);
    try {
      for (const file of files) {
        // Server authorizes + signs; browser uploads straight to private Storage.
        const { storagePath, signedUrl, token } = await getReceiptUploadUrl(deliveryNumber, file.name, file.type);
        const res = await fetch(signedUrl, {
          method: 'PUT',
          headers: { 'Content-Type': file.type },
          body: file,
        });
        if (!res.ok) throw new Error(`Upload failed for ${file.name}`);
        void token;
        const receipt = await recordReceipt(deliveryNumber, storagePath);
        setReceipts((prev) => [...prev, receipt]);
      }
    } catch (err) {
      setError(err?.message || 'Failed to upload receipt photo.');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const handleViewReceipt = async (storagePath) => {
    try {
      const { signedUrl } = await getReceiptViewUrl(storagePath);
      setViewUrls((prev) => ({ ...prev, [storagePath]: signedUrl }));
    } catch (e) {
      setError(e?.message || 'Could not open receipt.');
    }
  };

  const handleConfirm = async (e) => {
    e.preventDefault();
    setError(null);
    if (!supplierDrNumber.trim()) { setError('Supplier DR No. is required.'); return; }
    for (const item of delivery.items || []) {
      const qty = Number(received[item.id]);
      if (!Number.isInteger(qty) || qty < 0) { setError(`Received quantity for "${item.poItem.itemDescription}" must be a whole number of 0 or more.`); return; }
      if (qty > item.deliveredQty) { setError(`Received quantity for "${item.poItem.itemDescription}" cannot exceed the delivered quantity of ${item.deliveredQty}.`); return; }
    }
    if (markAsDiscrepancy && !remarks.trim()) { setError('Discrepancy remarks are required before confirming this delivery.'); return; }
    if (saving) return;
    setSaving(true);
    try {
      await confirmReceiving({
        deliveryNumber,
        supplierDrNumber: supplierDrNumber.trim(),
        items: (delivery.items || []).map((item) => ({ deliveryItemId: item.id, receivedQty: Number(received[item.id]) })),
        remarks: remarks.trim() || undefined,
        markAsDiscrepancy,
      });
      setSuccess(true);
      setTimeout(onClose, 1500);
    } catch (err) {
      setError(err?.message || 'Failed to confirm receiving.');
    } finally {
      setSaving(false);
    }
  };

  const totals = (delivery?.items || []).reduce((acc, item) => {
    const qty = Number(received[item.id] || 0);
    acc.delivered += item.deliveredQty;
    acc.received += qty;
    return acc;
  }, { delivered: 0, received: 0 });
  const difference = totals.received - totals.delivered;

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-[1000] overflow-y-auto py-6 px-4">
      <div className="bg-white rounded-xl w-full max-w-[620px] max-h-[90vh] overflow-y-auto shadow-[0_10px_30px_rgba(0,0,0,0.15)] p-6 text-left">
        <div className="flex justify-between items-center border-b border-[#eee] pb-3 mb-5"><h2 className="m-0 text-lg font-bold text-[#333]">Receive Delivery</h2><button className="text-2xl text-[#888]" onClick={onClose}>X</button></div>
        {loading && <p className="text-[13px] text-[#666]">Loading…</p>}
        {!loading && !delivery && <p className="text-[13px] text-[#c62828]">{error || 'Delivery not found.'}</p>}
        {!loading && delivery && <>
          {success && <div className="mb-4 p-3 bg-[#e8f5e9] text-[#2e7d32] border border-[#a5d6a7] rounded-md text-xs font-bold">✓ Receiving confirmed.</div>}
          {error && <div className="mb-4 p-3 bg-[#ffebee] text-[#c62828] border border-[#ef9a9a] rounded-md text-xs font-semibold">{error}</div>}

          <div className="grid grid-cols-2 gap-4 mb-4">
            <div><label className="text-[11px] font-bold text-[#444]">DELIVERY NO.</label><input value={delivery.deliveryNumber || ''} disabled className={`${inputClass} bg-gray-50`} /></div>
            <div><label className="text-[11px] font-bold text-[#444]">STATUS</label><div className="py-2"><StatusBadge status={delivery.statusLabel || delivery.status} /></div></div>
            <div><label className="text-[11px] font-bold text-[#444]">PO NO.</label><input value={delivery.poNumber || ''} disabled className={`${inputClass} bg-gray-50`} /></div>
            <div><label className="text-[11px] font-bold text-[#444]">SUPPLIER</label><input value={delivery.supplier || ''} disabled className={`${inputClass} bg-gray-50`} /></div>
          </div>

          <form onSubmit={handleConfirm} className="flex flex-col gap-4">
            <div><label className="text-[11px] font-bold text-[#444]">SUPPLIER DR NO. *</label><input value={supplierDrNumber} onChange={(e) => setSupplierDrNumber(e.target.value)} placeholder="e.g. DR-78451" required className={inputClass} /></div>

            <div className="border border-[#eee] rounded-lg p-3">
              <div className="flex justify-between items-center mb-3"><h3 className="m-0 text-xs font-bold text-[#555] uppercase tracking-wide">Supplier Delivery Receipt</h3><span className="text-[10px] text-[#777]">Photo evidence — not generated by CARDS</span></div>
              <div className="flex flex-wrap gap-2">
                {receipts.map((r) => (
                  <div key={r.id} className="border border-[#e0e0e0] rounded-md px-3 py-2 text-[12px]">
                    {viewUrls[r.storagePath] ? (
                      <a href={viewUrls[r.storagePath]} target="_blank" rel="noreferrer" className="text-[#006680] font-semibold">View receipt</a>
                    ) : (
                      <button type="button" onClick={() => handleViewReceipt(r.storagePath)} className="text-[#006680] font-semibold">View receipt</button>
                    )}
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={uploading}
                  className="border border-dashed border-[#7ec8e3] text-[#0288d1] px-3 py-2 rounded-md text-xs font-semibold disabled:opacity-60"
                >
                  {uploading ? 'Uploading…' : '+ Add Receipt Photo'}
                </button>
                <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" multiple className="hidden" onChange={handleFiles} />
              </div>
            </div>

            <div className="border border-[#eee] rounded-lg p-3">
              <div className="flex justify-between items-center mb-3"><h3 className="m-0 text-xs font-bold text-[#555] uppercase tracking-wide">Items</h3><span className="text-[10px] text-[#777]">Maximum = delivered quantity</span></div>
              <div className="flex flex-col gap-3">
                {(delivery.items || []).map((item) => {
                  const qty = Number(received[item.id] || 0);
                  const diff = qty - item.deliveredQty;
                  return <div key={item.id} className="grid grid-cols-[1.8fr_.7fr_.9fr_.9fr] gap-2 items-end border-b border-[#f1f1f1] pb-3 last:border-b-0 last:pb-0">
                    <div><label className="text-[10px] font-bold text-[#999]">MATERIAL</label><div className="text-[13px] font-medium text-[#333]">{item.poItem.itemDescription} <span className="text-[10px] text-[#888]">({item.poItem.unit})</span></div></div>
                    <div><label className="text-[10px] font-bold text-[#999]">DELIVERED</label><div className="text-[13px] font-semibold">{item.deliveredQty}</div></div>
                    <div><label className="text-[10px] font-bold text-[#444]">RECEIVED</label><input type="number" min="0" max={item.deliveredQty} step="1" value={received[item.id] ?? ''} onChange={(e) => handleQtyChange(item, e.target.value)} className={inputClass} /></div>
                    <div><label className="text-[10px] font-bold text-[#999]">DIFF</label><div className={`text-[13px] font-bold ${diff ? 'text-[#e65100]' : 'text-[#2e7d32]'}`}>{diff}</div></div>
                  </div>;
                })}
              </div>
              <div className="mt-3 pt-3 border-t border-[#eee] flex justify-between text-[11px] font-bold text-[#555]"><span>Delivered: {totals.delivered}</span><span>Received: {totals.received}</span><span>Difference: {difference}</span></div>
            </div>

            <div className="flex items-center gap-2"><input id="recv-discrepancy" type="checkbox" checked={markAsDiscrepancy} onChange={(e) => setMarkAsDiscrepancy(e.target.checked)} /><label htmlFor="recv-discrepancy" className="text-[11px] font-bold text-[#444]">Mark as discrepancy</label></div>
            <div><label className="text-[11px] font-bold text-[#444]">REMARKS{markAsDiscrepancy ? ' *' : ''}</label><input value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder={markAsDiscrepancy ? 'Explain the discrepancy' : 'Optional'} className={inputClass} /></div>

            <div className="flex justify-end gap-3 mt-2 pt-4 border-t border-[#eee]"><button type="button" onClick={onClose} className="py-2.5 px-6 bg-white text-[#d32f2f] border border-[#d32f2f] rounded-md">Cancel</button><button type="submit" disabled={saving} className="py-2.5 px-6 bg-[#006680] text-white rounded-md disabled:opacity-60">{saving ? 'Confirming…' : 'Confirm Receiving'}</button></div>
          </form>
        </>}
      </div>
    </div>
  );
}

export default ReceiveDeliveryForm;
