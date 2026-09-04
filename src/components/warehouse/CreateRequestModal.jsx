'use client';
import React, { useState } from 'react';
import { useWarehouseData } from '../../context/WarehouseDataContext';
import { useAuth } from '../../context/AuthContext';

function makeEmptyItem() { return { itemDescription: '', qty: '', unit: 'pcs' }; }

function getPOBalanceItems(po) {
  return (po?.items || []).map((item) => {
    const monitoring = (item.monitoringItems || []).find((m) => m.poItemId === item.id);
    const received = monitoring?.qtyReceived ?? 0;
    return { ...item, balance: Math.max(0, item.qty - received), maxQty: Math.max(0, item.qty - received) };
  }).filter((item) => item.balance > 0);
}

function CreateRequestModal({ onClose, followUp = null, followUpPo = null }) {
  const { createRequest } = useWarehouseData();
  const { user } = useAuth();
  const isFollowUp = !!(followUp || followUpPo);

  const calculateFollowUpItems = () => {
    if (followUp) return (followUp.items || []).map((it) => ({ ...it, balance: Math.max(0, it.qty - (it.approvedQty ?? 0)), maxQty: Math.max(0, it.qty - (it.approvedQty ?? 0)) })).filter((it) => it.balance > 0);
    if (followUpPo) return getPOBalanceItems(followUpPo);
    return [];
  };

  const followUpItems = calculateFollowUpItems();
  const [reqDate, setReqDate] = useState('');
  const [items, setItems] = useState(isFollowUp ? followUpItems.map((it) => ({ itemDescription: it.itemDescription, qty: String(it.balance), unit: it.unit, maxQty: it.maxQty })) : [makeEmptyItem()]);
  const [reqMrsNo, setReqMrsNo] = useState(followUp?.mrsNo || '');
  const [reqApprovedBy, setReqApprovedBy] = useState(followUp?.requestedBy || '');
  const [submitError, setSubmitError] = useState(null);

  const updateItem = (idx, field, value) => setItems((prev) => prev.map((it, i) => i === idx ? { ...it, [field]: value } : it));
  const addItem = () => setItems((prev) => [...prev, makeEmptyItem()]);
  const removeItem = (idx) => setItems((prev) => prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitError(null);
    if (!reqDate || !reqMrsNo || !reqApprovedBy) { setSubmitError('Please fill in all required fields.'); return; }
    if (!items.length) { setSubmitError('Add at least one item.'); return; }
    for (const it of items) {
      const qty = Number(it.qty);
      if (!it.itemDescription.trim() || !Number.isInteger(qty) || qty < 1) { setSubmitError('Every item must have a positive whole-number quantity.'); return; }
      if (it.maxQty != null && qty > it.maxQty) { setSubmitError(`Follow-up qty for "${it.itemDescription}" cannot exceed the remaining balance of ${it.maxQty} ${it.unit}.`); return; }
    }
    const newReq = {
      date: reqDate, reqNumber: `REQ-${Math.floor(10000 + Math.random() * 90000)}`,
      items: items.map((it) => ({ itemDescription: it.itemDescription.trim(), qty: Number(it.qty), unit: it.unit })),
      mrsNo: reqMrsNo.trim(), requestedBy: reqApprovedBy.trim(), requisitioner: user?.warehouse || 'Warehouse Site',
      ...(followUp ? { followUpOfReqNumber: followUp.reqNumber } : {}),
      ...(followUpPo ? { followUpOfPoNumber: followUpPo.poNumber } : {}),
    };
    try { await createRequest(newReq); onClose(); }
    catch (err) { setSubmitError(err?.message || 'Failed to create request. Please try again.'); }
  };

  const inputClass = 'py-2.5 px-3 border border-[#ccc] rounded-md text-[13px] text-[#333] w-full box-border';
  const labelClass = 'text-[11px] font-bold text-[#666] uppercase';

  return <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-[1000] overflow-y-auto py-6 px-4">
    <div className="bg-white rounded-xl w-full max-w-[560px] max-h-[90vh] overflow-y-auto shadow-[0_10px_30px_rgba(0,0,0,0.15)] p-6 text-left">
      <div className="flex justify-between items-center border-b border-[#eee] pb-3 mb-5"><h2 className="m-0 text-lg font-bold text-[#333]">{isFollowUp ? 'File Follow-Up Request' : 'Create Material Request'}</h2><button className="text-2xl text-[#888]" onClick={onClose}>&times;</button></div>
      {followUp && <div className="mb-5 p-3 bg-[#fff8e1] border border-[#ffcc80] rounded-md text-xs text-[#8d6e00]">Follow-up of <b>{followUp.reqNumber}</b> — only outstanding approved-request balances are available.</div>}
      {followUpPo && <div className="mb-5 p-3 bg-[#fef5f5] border border-[#ffcdd2] rounded-md text-xs text-[#c62828]">Follow-up of <b>{followUpPo.poNumber}</b> — only undelivered material balances are available.</div>}
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {submitError && <div className="px-3 py-2 rounded-md text-xs font-medium bg-[#ffebee] text-[#c62828] border border-[#ef9a9a]">{submitError}</div>}
        <div className="flex gap-4"><div className="flex flex-col gap-1.5 flex-1"><label className={labelClass}>Date *</label><input type="date" value={reqDate} onChange={(e) => setReqDate(e.target.value)} required className={inputClass} /></div><div className="flex flex-col gap-1.5 flex-1"><label className={labelClass}>MRS No. *</label><input type="text" value={reqMrsNo} onChange={(e) => setReqMrsNo(e.target.value)} required className={inputClass} /></div></div>
        <div className="flex flex-col gap-3"><div className="flex justify-between"><label className={labelClass}>Items *</label>{!isFollowUp && <button type="button" onClick={addItem} className="text-xs font-semibold text-[#1e3c72]">+ Add item</button>}</div>
          {items.map((it, idx) => <div key={idx} className="flex gap-2 items-start border border-[#eee] rounded-md p-3"><div className="flex-[2]"><input type="text" value={it.itemDescription} onChange={(e) => updateItem(idx, 'itemDescription', e.target.value)} disabled={isFollowUp} required className={`${inputClass} ${isFollowUp ? 'bg-gray-100' : ''}`} /></div><div className="flex-1"><input type="number" value={it.qty} onChange={(e) => updateItem(idx, 'qty', e.target.value)} min="1" max={it.maxQty ?? undefined} required className={inputClass} />{it.maxQty != null && <span className="text-[10px] text-[#777]">balance: {it.maxQty} {it.unit}</span>}</div><div className="flex-1"><select value={it.unit} onChange={(e) => updateItem(idx, 'unit', e.target.value)} disabled={isFollowUp} className={`${inputClass} ${isFollowUp ? 'bg-gray-100' : ''}`}><option value="pcs">pcs</option><option value="bags">bags</option><option value="rolls">rolls</option><option value="sets">sets</option><option value="boxes">boxes</option></select></div>{!isFollowUp && items.length > 1 && <button type="button" onClick={() => removeItem(idx)} className="text-[#d32f2f] text-lg">&times;</button>}</div>)}
        </div>
        <div><label className={labelClass}>Approved By (Site Engineer) *</label><input type="text" value={reqApprovedBy} onChange={(e) => setReqApprovedBy(e.target.value)} required className={inputClass} /></div>
        <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-[#eee]"><button type="button" onClick={onClose} className="py-2.5 px-6 rounded-md bg-white text-[#555] border border-gray-300">Cancel</button><button type="submit" className="py-2.5 px-6 rounded-md bg-[#1e3c72] text-white">{isFollowUp ? 'Submit Follow-Up' : 'Submit Request'}</button></div>
      </form>
    </div>
  </div>;
}
export default CreateRequestModal;
