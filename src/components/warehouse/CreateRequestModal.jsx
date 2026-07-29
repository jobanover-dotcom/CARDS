'use client';
import React, { useState } from 'react';
import { useWarehouseData } from '../../context/WarehouseDataContext';

function CreateRequestModal({ onClose }) {
  const { createRequest } = useWarehouseData();
  const [reqDate, setReqDate] = useState('');
  const [reqItemDescription, setReqItemDescription] = useState('');
  const [reqQty, setReqQty] = useState('');
  const [reqUnit, setReqUnit] = useState('pcs');
  const [reqMrsNo, setReqMrsNo] = useState('');
  const [reqApprovedBy, setReqApprovedBy] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!reqDate || !reqItemDescription || !reqQty || !reqMrsNo || !reqApprovedBy) {
      alert('Please fill in all required fields');
      return;
    }
    const newReq = {
      date: reqDate,
      reqNumber: `REQ-${Math.floor(10000 + Math.random() * 90000)}`,
      itemDescription: reqItemDescription,
      qty: parseInt(reqQty) || 0,
      unit: reqUnit,
      mrsNo: reqMrsNo,
      requestedBy: reqApprovedBy,
      requisitioner: 'Warehouse Site',
      status: 'Pending',
      remarks: ''
    };
    createRequest(newReq);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-[1000] animate-fade-in">
      <div className="bg-white rounded-xl w-full max-w-[450px] shadow-[0_10px_30px_rgba(0,0,0,0.15)] animate-slide-in p-6 text-left">
        <div className="flex justify-between items-center border-b border-[#eee] pb-3 mb-5">
          <h2 className="m-0 text-lg font-bold text-[#333] tracking-wide">Create Material Request</h2>
          <button className="bg-none border-none text-2xl cursor-pointer text-[#888] hover:text-[#333] transition-colors duration-200 p-1 leading-none" onClick={onClose}>&times;</button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex gap-4">
            <div className="flex flex-col gap-1.5 flex-1">
              <label className="text-[11px] font-bold text-[#666] uppercase">Date *</label>
              <input type="date" value={reqDate} onChange={(e) => setReqDate(e.target.value)} required className="py-2.5 px-3 border border-[#ccc] rounded-md text-[13px] text-[#333]" />
            </div>
            <div className="flex flex-col gap-1.5 flex-1">
              <label className="text-[11px] font-bold text-[#666] uppercase">MRS No. *</label>
              <input type="text" value={reqMrsNo} onChange={(e) => setReqMrsNo(e.target.value)} placeholder="e.g. MRS-107" required className="py-2.5 px-3 border border-[#ccc] rounded-md text-[13px] text-[#333]" />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] font-bold text-[#666] uppercase">Item Description *</label>
            <input type="text" value={reqItemDescription} onChange={(e) => setReqItemDescription(e.target.value)} placeholder="e.g. Steel Rebar 12mm" required className="py-2.5 px-3 border border-[#ccc] rounded-md text-[13px] text-[#333]" />
          </div>
          <div className="flex gap-4">
            <div className="flex flex-col gap-1.5 flex-1">
              <label className="text-[11px] font-bold text-[#666] uppercase">Qty *</label>
              <input type="number" value={reqQty} onChange={(e) => setReqQty(e.target.value)} placeholder="0" required className="py-2.5 px-3 border border-[#ccc] rounded-md text-[13px] text-[#333]" />
            </div>
            <div className="flex flex-col gap-1.5 flex-1">
              <label className="text-[11px] font-bold text-[#666] uppercase">Unit</label>
              <select value={reqUnit} onChange={(e) => setReqUnit(e.target.value)} className="py-2.5 px-3 border border-[#ccc] rounded-md text-[13px] bg-white text-[#333]">
                <option value="pcs">pcs</option>
                <option value="bags">bags</option>
                <option value="rolls">rolls</option>
                <option value="boxes">boxes</option>
              </select>
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] font-bold text-[#666] uppercase">Approved By (Site Engineer) *</label>
            <input type="text" value={reqApprovedBy} onChange={(e) => setReqApprovedBy(e.target.value)} placeholder="Enter name of approving engineer" required className="py-2.5 px-3 border border-[#ccc] rounded-md text-[13px] text-[#333]" />
          </div>
          <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-[#eee]">
            <button type="button" className="py-2.5 px-6 rounded-md text-sm font-semibold cursor-pointer transition-all duration-200 bg-white text-[#555] border border-gray-300 hover:bg-gray-50" onClick={onClose}>Cancel</button>
            <button type="submit" className="py-2.5 px-6 rounded-md text-sm font-semibold cursor-pointer transition-all duration-200 bg-[#1e3c72] text-white border-none hover:bg-[#2a5298]">Submit Request</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default CreateRequestModal;
