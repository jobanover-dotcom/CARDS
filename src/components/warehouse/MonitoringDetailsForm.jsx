'use client';
import React, { useMemo, useState } from 'react';
import { useWarehouseData } from '../../context/WarehouseDataContext';
import CreateRequestModal from './CreateRequestModal';

function MonitoringDetailsForm({ po, onClose }) {
  const { updatePOMonitoring } = useWarehouseData();
  const poItems = po.items || [];
  const existing = useMemo(() => Object.fromEntries(poItems.map((item) => {
    const row = (item.monitoringItems || []).find((m) => m.poItemId === item.id);
    return [item.id, String(row?.qtyReceived ?? 0)];
  })), [poItems]);
  const [received, setReceived] = useState(existing);
  const [deliveredBy, setDeliveredBy] = useState(po.monDeliveredBy || '');
  const [plateNumber, setPlateNumber] = useState(po.monPlateNumber || '');
  const [dateDelivered, setDateDelivered] = useState(po.monDateDelivered || '');
  const [referenceNo, setReferenceNo] = useState(po.monReferenceNo || '');
  const [drDate, setDrDate] = useState(po.monDrDate || '');
  const [remarks, setRemarks] = useState(po.monRemarks || '');
  const [markAsDiscrepancy, setMarkAsDiscrepancy] = useState(po.poType === 'discrepancy');
  const [showSuccess, setShowSuccess] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [showFollowUpModal, setShowFollowUpModal] = useState(false);
  const [followUpPo, setFollowUpPo] = useState(null);

  const totals = poItems.reduce((acc, item) => {
    const qty = Number(received[item.id] || 0);
    acc.ordered += item.qty;
    acc.received += qty;
    acc.balance += Math.max(0, item.qty - qty);
    return acc;
  }, { ordered: 0, received: 0, balance: 0 });

  const handleQtyChange = (item, value) => {
    const raw = value.replace(/[^0-9]/g, '');
    const qty = raw === '' ? '' : Math.min(Number(raw), item.qty);
    setReceived((prev) => ({ ...prev, [item.id]: String(qty) }));
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaveError(null);
    if (!deliveredBy.trim() || !plateNumber.trim() || !dateDelivered || !referenceNo.trim() || !drDate) {
      setSaveError('Please fill in Delivered By, Plate Number, Date Delivered, Reference No., and DR Date.');
      return;
    }
    for (const item of poItems) {
      const qty = Number(received[item.id]);
      if (!Number.isInteger(qty) || qty < 0) {
        setSaveError(`Received quantity for "${item.itemDescription}" must be a whole number of 0 or more.`); return;
      }
      if (qty > item.qty) {
        setSaveError(`Received quantity for "${item.itemDescription}" cannot exceed ${item.qty} ${item.unit}.`); return;
      }
    }
    if (markAsDiscrepancy && !remarks.trim()) {
      setSaveError('Discrepancy remarks are required before saving this PO.'); return;
    }
    if (saving) return;

    setSaving(true);
    try {
      const result = await updatePOMonitoring(po.poNumber, {
        items: poItems.map((item) => ({ poItemId: item.id, qtyReceived: Number(received[item.id]) })),
        deliveredBy: deliveredBy.trim(), plateNumber: plateNumber.trim(),
        dateDelivered, referenceNo: referenceNo.trim(), drDate,
        remarks: remarks.trim(), markAsDiscrepancy,
      });
      setShowSuccess(true);
      if (result.anyShortfall) {
        setFollowUpPo(result.po);
        setTimeout(() => setShowFollowUpModal(true), 800);
      } else {
        setTimeout(() => { setShowSuccess(false); onClose(); }, 1500);
      }
    } catch (err) {
      setSaveError(err?.message || 'Failed to save monitoring details. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const inputClass = 'py-2 px-3 border border-[#ccc] rounded-md text-[13px] text-[#333] focus:outline-none focus:border-[#006680] w-full box-border';

  return <>
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-[1000] overflow-y-auto py-6 px-4">
      <div className="bg-white rounded-xl w-full max-w-[620px] max-h-[90vh] overflow-y-auto shadow-[0_10px_30px_rgba(0,0,0,0.15)] p-6 text-left">
        <div className="flex justify-between items-center border-b border-[#eee] pb-3 mb-5"><h2 className="m-0 text-lg font-bold text-[#333]">Monitoring Details</h2><button className="text-2xl text-[#888]" onClick={onClose}>X</button></div>
        {showSuccess && <div className="mb-4 p-3 bg-[#e8f5e9] text-[#2e7d32] border border-[#a5d6a7] rounded-md text-xs font-bold">✓ Monitoring details saved successfully.</div>}
        {saveError && <div className="mb-4 p-3 bg-[#ffebee] text-[#c62828] border border-[#ef9a9a] rounded-md text-xs font-semibold">{saveError}</div>}

        <form onSubmit={handleSave} className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-4"><div><label className="text-[11px] font-bold text-[#444]">PO NUMBER</label><input value={po.poNumber || ''} disabled className={`${inputClass} bg-gray-50`} /></div><div><label className="text-[11px] font-bold text-[#444]">PO DATE</label><input value={po.date || ''} disabled className={`${inputClass} bg-gray-50`} /></div></div>

          <div className="border border-[#eee] rounded-lg p-3">
            <div className="flex justify-between items-center mb-3"><h3 className="m-0 text-xs font-bold text-[#555] uppercase tracking-wide">ITEM RECEIPT DETAILS</h3><span className="text-[10px] text-[#777]">Maximum = ordered quantity</span></div>
            <div className="flex flex-col gap-3">
              {poItems.map((item) => {
                const qty = Number(received[item.id] || 0);
                const balance = Math.max(0, item.qty - qty);
                return <div key={item.id} className="grid grid-cols-[1.8fr_.7fr_.9fr_.9fr] gap-2 items-end border-b border-[#f1f1f1] pb-3 last:border-b-0 last:pb-0">
                  <div><label className="text-[10px] font-bold text-[#999]">MATERIAL</label><div className="text-[13px] font-medium text-[#333]">{item.itemDescription} <span className="text-[10px] text-[#888]">({item.unit})</span></div></div>
                  <div><label className="text-[10px] font-bold text-[#999]">ORDERED</label><div className="text-[13px] font-semibold">{item.qty}</div></div>
                  <div><label className="text-[10px] font-bold text-[#444]">QTY RECEIVED</label><input type="number" min="0" max={item.qty} step="1" value={received[item.id] ?? ''} onChange={(e) => handleQtyChange(item, e.target.value)} className={`${inputClass} ${qty >= item.qty ? 'bg-[#f5f5f5]' : ''}`} /></div>
                  <div><label className="text-[10px] font-bold text-[#999]">BALANCE</label><div className={`text-[13px] font-bold ${balance ? 'text-[#e65100]' : 'text-[#2e7d32]'}`}>{balance}</div></div>
                </div>;
              })}
            </div>
            <div className="mt-3 pt-3 border-t border-[#eee] flex justify-between text-[11px] font-bold text-[#555]"><span>Total ordered: {totals.ordered}</span><span>Total received: {totals.received}</span><span>Total balance: {totals.balance}</span></div>
          </div>

          <div className="grid grid-cols-2 gap-4"><div><label className="text-[11px] font-bold text-[#444]">DELIVERED BY *</label><input value={deliveredBy} onChange={(e) => setDeliveredBy(e.target.value)} placeholder="Enter name" required className={inputClass} /></div><div><label className="text-[11px] font-bold text-[#444]">PLATE NUMBER *</label><input value={plateNumber} onChange={(e) => setPlateNumber(e.target.value)} placeholder="Enter plate number" required className={inputClass} /></div></div>
          <div className="grid grid-cols-2 gap-4"><div><label className="text-[11px] font-bold text-[#444]">DATE DELIVERED *</label><input type="date" value={dateDelivered} onChange={(e) => setDateDelivered(e.target.value)} required className={inputClass} /></div><div><label className="text-[11px] font-bold text-[#444]">REFERENCE NO. *</label><input value={referenceNo} onChange={(e) => setReferenceNo(e.target.value)} required className={inputClass} /></div></div>
          <div className="grid grid-cols-2 gap-4"><div><label className="text-[11px] font-bold text-[#444]">DR DATE *</label><input type="date" value={drDate} onChange={(e) => setDrDate(e.target.value)} required className={inputClass} /></div><div><label className="text-[11px] font-bold text-[#444]">REMARKS</label><input value={remarks} onChange={(e) => setRemarks(e.target.value)} className={inputClass} /></div></div>

          <div className="flex items-center gap-2"><input id="mark-discrepancy" type="checkbox" checked={markAsDiscrepancy} onChange={(e) => setMarkAsDiscrepancy(e.target.checked)} /><label htmlFor="mark-discrepancy" className="text-[11px] font-bold text-[#444]">Mark as discrepancy</label></div>
          {markAsDiscrepancy && <div className="px-3 py-2 rounded-md border border-[#ef9a9a] bg-[#ffebee] text-[#c62828] text-[11px] font-semibold">Add a remark explaining the discrepancy before saving.</div>}
          <div className="flex justify-end gap-3 mt-2 pt-4 border-t border-[#eee]"><button type="button" onClick={onClose} className="py-2.5 px-6 bg-white text-[#d32f2f] border border-[#d32f2f] rounded-md">Cancel</button><button type="submit" disabled={saving} className="py-2.5 px-6 bg-[#006680] text-white rounded-md disabled:opacity-60">{saving ? 'Saving…' : 'Save'}</button></div>
        </form>
      </div>
    </div>
    {showFollowUpModal && followUpPo && <CreateRequestModal followUpPo={followUpPo} onClose={() => { setShowFollowUpModal(false); setShowSuccess(false); onClose(); }} />}
  </>;
}

export default MonitoringDetailsForm;
