'use client';
import React, { useState } from 'react';
import { useWarehouseData } from '../../context/WarehouseDataContext';
import { useAuth } from '../../context/AuthContext';

function makeEmptyItem() {
  return { itemDescription: '', qty: '', unit: 'pcs' };
}

function CreateRequestModal({ onClose, followUp = null, followUpPo = null }) {
  const { createRequest } = useWarehouseData();
  const { user } = useAuth();
  const isFollowUp = !!(followUp || followUpPo);

  const calculateFollowUpItems = () => {
    if (followUp) {
      return (followUp.items || [])
        .map((it) => ({ ...it, balance: Math.max(0, it.qty - (it.approvedQty ?? 0)) }))
        .filter((it) => it.balance > 0);
    }
    if (followUpPo) {
      const totalOrdered = (followUpPo.items || []).reduce((s, it) => s + it.qty, 0);
      const received = parseInt(followUpPo.monQtyRvd) || 0;
      if (received >= totalOrdered) return []; // No shortfall
      const shortfallRatio = (totalOrdered - received) / totalOrdered;
      return (followUpPo.items || [])
        .map((it) => {
          const shortfallQty = Math.ceil(it.qty * shortfallRatio);
          return { ...it, balance: shortfallQty, maxQty: shortfallQty };
        })
        .filter((it) => it.balance > 0);
    }
    return [];
  };

  const followUpItems = calculateFollowUpItems();

  const [reqDate, setReqDate] = useState('');
  const [items, setItems] = useState(
    isFollowUp
      ? followUpItems.map((it) => ({
          itemDescription: it.itemDescription,
          qty: String(it.balance),
          unit: it.unit,
          maxQty: it.balance,
        }))
      : [makeEmptyItem()]
  );
  const [reqMrsNo, setReqMrsNo] = useState(followUp?.mrsNo || '');
  const [reqApprovedBy, setReqApprovedBy] = useState(followUp?.requestedBy || '');

  const updateItem = (idx, field, value) => {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, [field]: value } : it)));
  };
  const addItem = () => setItems((prev) => [...prev, makeEmptyItem()]);
  const removeItem = (idx) => setItems((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev));

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!reqDate || !reqMrsNo || !reqApprovedBy) {
      alert('Please fill in all required fields');
      return;
    }
    if (items.length === 0) {
      alert('Add at least one item');
      return;
    }
    for (const it of items) {
      if (!it.itemDescription.trim() || !it.qty) {
        alert('Please fill in the description and quantity for every item');
        return;
      }
      const parsedQty = parseInt(it.qty) || 0;
      if (parsedQty < 1) {
        alert('Quantity must be a positive number for every item');
        return;
      }
      if (followUp && it.maxQty != null && parsedQty > it.maxQty) {
        alert(`Follow-up qty for "${it.itemDescription}" cannot exceed the remaining balance of ${it.maxQty} ${it.unit}`);
        return;
      }
      if (followUpPo && it.maxQty != null && parsedQty > it.maxQty) {
        alert(`Follow-up qty for "${it.itemDescription}" cannot exceed the shortfall of ${it.maxQty} ${it.unit}`);
        return;
      }
    }

    const newReq = {
      date: reqDate,
      reqNumber: `REQ-${Math.floor(10000 + Math.random() * 90000)}`,
      items: items.map((it) => ({ itemDescription: it.itemDescription, qty: parseInt(it.qty) || 0, unit: it.unit })),
      mrsNo: reqMrsNo,
      requestedBy: reqApprovedBy,
      requisitioner: user?.warehouse || 'Warehouse Site',
      ...(followUp ? { followUpOfReqNumber: followUp.reqNumber } : {}),
      ...(followUpPo ? { followUpOfPoNumber: followUpPo.poNumber } : {}),
    };
    createRequest(newReq);
    onClose();
  };

  const inputClass = "py-2.5 px-3 border border-[#ccc] rounded-md text-[13px] text-[#333] w-full box-border";
  const labelClass = "text-[11px] font-bold text-[#666] uppercase";

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-[1000] animate-fade-in overflow-y-auto py-6 px-4">
      <div className="bg-white rounded-xl w-full max-w-[560px] max-h-[90vh] overflow-y-auto shadow-[0_10px_30px_rgba(0,0,0,0.15)] animate-slide-in p-6 text-left">
        <div className="flex justify-between items-center border-b border-[#eee] pb-3 mb-5">
          <h2 className="m-0 text-lg font-bold text-[#333] tracking-wide">
            {followUp || followUpPo ? 'File Follow-Up Request' : 'Create Material Request'}
          </h2>
          <button className="bg-none border-none text-2xl cursor-pointer text-[#888] hover:text-[#333] transition-colors duration-200 p-1 leading-none" onClick={onClose}>&times;</button>
        </div>

        {followUp && (
          <div className="mb-5 p-3 bg-[#fff8e1] border border-[#ffcc80] rounded-md">
            <p className="m-0 text-xs text-[#8d6e00] leading-relaxed">
              Follow-up of <span className="font-bold">{followUp.reqNumber}</span> — the item(s) below still have an outstanding balance from that request.
            </p>
          </div>
        )}

        {followUpPo && (
          <div className="mb-5 p-3 bg-[#fef5f5] border border-[#ffcdd2] rounded-md">
            <p className="m-0 text-xs text-[#c62828] leading-relaxed">
              Follow-up of <span className="font-bold">{followUpPo.poNumber}</span> — delivery shortfall.
              <br />
              Ordered: {(followUpPo.items || []).reduce((s, it) => s + it.qty, 0)} | Received: {followUpPo.monQtyRvd || '—'} items
            </p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex gap-4">
            <div className="flex flex-col gap-1.5 flex-1">
              <label className={labelClass}>Date *</label>
              <input type="date" value={reqDate} onChange={(e) => setReqDate(e.target.value)} required className={inputClass} />
            </div>
            <div className="flex flex-col gap-1.5 flex-1">
              <label className={labelClass}>MRS No. *</label>
              <input type="text" value={reqMrsNo} onChange={(e) => setReqMrsNo(e.target.value)} placeholder="e.g. MRS-107" required className={inputClass} />
            </div>
          </div>
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <label className={labelClass}>Items *</label>
              {!isFollowUp && (
                <button type="button" onClick={addItem} className="text-xs font-semibold text-[#1e3c72] hover:text-[#2a5298] cursor-pointer bg-none border-none">
                  + Add item
                </button>
              )}
            </div>
            {items.map((it, idx) => (
              <div key={idx} className="flex gap-2 items-start border border-[#eee] rounded-md p-3">
                <div className="flex flex-col gap-1.5 flex-[2]">
                  <input
                    type="text"
                    value={it.itemDescription}
                    onChange={(e) => updateItem(idx, 'itemDescription', e.target.value)}
                    placeholder="e.g. Steel Rebar 12mm"
                    required
                    disabled={!!isFollowUp}
                    className={`${inputClass} ${isFollowUp ? 'bg-gray-100 text-[#666]' : ''}`}
                  />
                </div>
                <div className="flex flex-col gap-1 flex-1">
                  <input
                    type="number"
                    value={it.qty}
                    onChange={(e) => updateItem(idx, 'qty', e.target.value)}
                    placeholder="Qty"
                    required
                    min="1"
                    max={it.maxQty ?? undefined}
                    className={inputClass}
                  />
                  {isFollowUp && it.maxQty != null && <span className="text-[10px] text-[#999]">balance: {it.maxQty}</span>}
                </div>
                <div className="flex flex-col gap-1.5 flex-1">
                  <select value={it.unit} onChange={(e) => updateItem(idx, 'unit', e.target.value)} disabled={!!isFollowUp} className={`${inputClass} bg-white ${isFollowUp ? 'bg-gray-100 text-[#666]' : ''}`}>
                    <option value="pcs">pcs</option>
                    <option value="bags">bags</option>
                    <option value="rolls">rolls</option>
                    <option value="boxes">boxes</option>
                  </select>
                </div>
                {!isFollowUp && items.length > 1 && (
                  <button type="button" onClick={() => removeItem(idx)} className="text-[#d32f2f] text-lg leading-none px-1 pt-2 cursor-pointer bg-none border-none" title="Remove item">
                    &times;
                  </button>
                )}
              </div>
            ))}
          </div>
          <div className="flex flex-col gap-1.5">
            <label className={labelClass}>Approved By (Site Engineer) *</label>
            <input type="text" value={reqApprovedBy} onChange={(e) => setReqApprovedBy(e.target.value)} placeholder="Enter name of approving engineer" required className={inputClass} />
          </div>
          <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-[#eee]">
            <button type="button" className="py-2.5 px-6 rounded-md text-sm font-semibold cursor-pointer transition-all duration-200 bg-white text-[#555] border border-gray-300 hover:bg-gray-50" onClick={onClose}>Cancel</button>
            <button type="submit" className="py-2.5 px-6 rounded-md text-sm font-semibold cursor-pointer transition-all duration-200 bg-[#1e3c72] text-white border-none hover:bg-[#2a5298]">
              {followUp || followUpPo ? 'Submit Follow-Up' : 'Submit Request'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default CreateRequestModal;
