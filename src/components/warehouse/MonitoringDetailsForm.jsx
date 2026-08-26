'use client';
import React, { useState } from 'react';
import { useWarehouseData } from '../../context/WarehouseDataContext';

function MonitoringDetailsForm({ po, onClose }) {
  const { updatePO } = useWarehouseData();
  const [monPoNumber] = useState(po.poNumber || '');
  const [monPickupDate] = useState(() => {
    const value = po.date || '';
    if (!value) return '';
    const parts = value.split('-');
    if (parts.length !== 3) return '';
    let [month, day, year] = parts;
    if (year.length === 2) year = `20${year}`;
    month = month.padStart(2, '0');
    day = day.padStart(2, '0');
    return `${year}-${month}-${day}`;
  });
  const [monDescription] = useState(po.itemDescription || '');
  const [monQtyRvd, setMonQtyRvd] = useState('');
  const [monUnit] = useState(po.unit || '');
  const [monDeliveredBy, setMonDeliveredBy] = useState('');
  const [monDateDelivered, setMonDateDelivered] = useState('');
  const [monReferenceNo, setMonReferenceNo] = useState('');
  const [monDrDate, setMonDrDate] = useState('');
  const [monPickupBy, setMonPickupBy] = useState(po.pickupBy || '');
  const [monRemarks, setMonRemarks] = useState('');
  const [showMonSuccess, setShowMonSuccess] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [saving, setSaving] = useState(false);

  const handleSave = async (e) => {
    e.preventDefault();
    if (!monQtyRvd || !monDeliveredBy || !monDateDelivered || !monReferenceNo || !monDrDate) {
      alert('Please fill in all required fields');
      return;
    }
    if (saving) return;

    const qtyReceived = parseInt(monQtyRvd) || 0;
    const originalQty = parseInt(po.qty) || 0;
    if (qtyReceived < 1) {
      setSaveError('Qty received must be a positive number.');
      return;
    }
    const isCoincided = qtyReceived === originalQty;
    const finalStatus = isCoincided ? 'completed' : 'incomplete';
    const finalPoType = isCoincided ? 'completed' : 'discrepancy';
    const finalStatusLabel = isCoincided ? 'Completed' : 'Open';

    setSaving(true);
    setSaveError(null);
    try {
      await updatePO(po.poNumber, {
        status: finalStatus,
        poType: finalPoType,
        statusLabel: finalStatusLabel,
        qty: qtyReceived,
        pickupBy: monPickupBy,
        poExpDate: monDateDelivered,
        supplierAddress: po.supplierAddress || 'Davao City',
        notes: monRemarks || po.notes,
        monQtyRvd,
        monDeliveredBy,
        monDateDelivered,
        monReferenceNo,
        monDrDate,
        monRemarks,
      });
      setShowMonSuccess(true);
      setTimeout(() => {
        setShowMonSuccess(false);
        onClose();
      }, 2000);
    } catch (err) {
      setSaveError(err?.message || 'Failed to save monitoring details. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-[1000] animate-fade-in overflow-y-auto py-6 px-4">
      <div className="bg-white rounded-xl w-full max-w-[500px] shadow-[0_10px_30px_rgba(0,0,0,0.15)] animate-slide-in p-6 relative font-sans text-left">
        <button
          className="absolute top-4 right-4 bg-none border-none text-2xl cursor-pointer text-[#888] hover:text-[#333] transition-colors duration-200 p-1 leading-none"
          onClick={onClose}
        >
          X
        </button>

        <h2 className="m-0 text-lg font-bold text-[#333] mb-5 tracking-wide">Monitoring Details</h2>

        {showMonSuccess && (
          <div className="mb-4 p-3 bg-[#e8f5e9] text-[#2e7d32] border border-[#a5d6a7] rounded-md text-xs font-bold flex items-center justify-center gap-1.5 animate-pulse">
            <span>&#10003; Saved successfully!</span>
          </div>
        )}

        <form onSubmit={handleSave} className="flex flex-col gap-4">
          <div className="flex gap-4">
            <div className="flex flex-col gap-1.5 flex-1 text-[11px] font-bold text-[#444]">
              <label>PO number:</label>
              <input type="text" value={monPoNumber} disabled className="py-2 px-3 border border-[#ccc] rounded-md text-[13px] text-[#555] bg-gray-50 w-full box-border" />
            </div>
            <div className="flex flex-col gap-1.5 flex-1 text-[11px] font-bold text-[#444]">
              <label>Pick-up date:</label>
              <input type="date" value={monPickupDate} disabled className="py-2 px-3 border border-[#ccc] rounded-md text-[13px] text-[#555] bg-gray-50 w-full box-border" />
            </div>
          </div>

          <div className="flex gap-4 items-end">
            <div className="flex flex-col gap-1.5 flex-[3] text-[11px] font-bold text-[#444]">
              <label>Item Description:</label>
              <input type="text" value={monDescription} disabled className="py-2 px-3 border border-[#ccc] rounded-md text-[13px] text-[#555] bg-gray-50 w-full box-border" />
            </div>
            <div className="flex flex-col gap-1.5 flex-1 text-[11px] font-bold text-[#444]">
              <label>Qty. rvd.:</label>
              <input type="number" value={monQtyRvd} onChange={(e) => setMonQtyRvd(e.target.value)} placeholder="0" required className="py-2 px-3 border border-[#ccc] rounded-md text-[13px] text-[#333] focus:outline-none focus:border-[#006680] w-full box-border" />
            </div>
            <div className="flex flex-col gap-1.5 flex-1 text-[11px] font-bold text-[#444]">
              <label>Unit:</label>
              <input type="text" value={monUnit} disabled className="py-2 px-3 border border-[#ccc] rounded-md text-[13px] text-[#555] bg-gray-50 w-full box-border" />
            </div>
          </div>

          <div className="flex gap-4">
            <div className="flex flex-col gap-1.5 flex-1 text-[11px] font-bold text-[#444]">
              <label>Delivered By:</label>
              <input type="text" value={monDeliveredBy} onChange={(e) => setMonDeliveredBy(e.target.value)} placeholder="Enter name" required className="py-2 px-3 border border-[#ccc] rounded-md text-[13px] text-[#333] focus:outline-none focus:border-[#006680] w-full box-border" />
            </div>
            <div className="flex flex-col gap-1.5 flex-1 text-[11px] font-bold text-[#444]">
              <label>Date delivered:</label>
              <input type="date" value={monDateDelivered} onChange={(e) => setMonDateDelivered(e.target.value)} required className="py-2 px-3 border border-[#ccc] rounded-md text-[13px] text-[#333] focus:outline-none focus:border-[#006680] w-full box-border" />
            </div>
          </div>

          <div className="flex gap-4 items-end">
            <div className="flex flex-col gap-1.5 flex-1 text-[11px] font-bold text-[#444]">
              <label>Reference No.</label>
              <input type="text" value={monReferenceNo} onChange={(e) => setMonReferenceNo(e.target.value)} placeholder="00000" required className="py-2 px-3 border border-[#ccc] rounded-md text-[13px] text-[#333] focus:outline-none focus:border-[#006680] w-full box-border" />
            </div>
            <div className="flex flex-col gap-1.5 flex-[0.8] text-[11px] font-bold text-[#444]">
              <label>DR date:</label>
              <input type="date" value={monDrDate} onChange={(e) => setMonDrDate(e.target.value)} required className="py-2 px-3 border border-[#ccc] rounded-md text-[13px] text-[#333] focus:outline-none focus:border-[#006680] w-full box-border" />
            </div>
            <div className="flex flex-col gap-1.5 flex-[1.2] text-[11px] font-bold text-[#444]">
              <label>Pick-up By:</label>
              <input type="text" value={monPickupBy} onChange={(e) => setMonPickupBy(e.target.value)} placeholder="Enter name" required className="py-2 px-3 border border-[#ccc] rounded-md text-[13px] text-[#333] focus:outline-none focus:border-[#006680] w-full box-border" />
            </div>
          </div>

          {saveError && (
            <div className="mb-4 px-3 py-2 rounded-md text-xs font-medium bg-[#ffebee] text-[#c62828] border border-[#ef9a9a]">
              {saveError}
            </div>
          )}

          <div className="flex gap-4 items-end">
            <div className="flex flex-col gap-1.5 flex-1 text-[11px] font-bold text-[#444]">
              <label>Remarks:</label>
              <textarea value={monRemarks} onChange={(e) => setMonRemarks(e.target.value)} placeholder="Enter remarks.." className="py-2 px-3 border border-[#ccc] rounded-md text-[13px] text-[#333] focus:outline-none focus:border-[#006680] w-full box-border resize-none h-[80px]" />
            </div>
            <div className="flex flex-col gap-2.5">
              <button type="submit" disabled={saving} className="py-2.5 px-8 bg-[#006680] text-white border-none rounded-md text-sm font-semibold cursor-pointer transition-all duration-200 hover:bg-[#004d60] w-[120px] disabled:opacity-60 disabled:cursor-not-allowed">{saving ? 'Saving…' : 'Save'}</button>
              <button type="button" onClick={onClose} className="py-2.5 px-8 bg-white text-[#d32f2f] border border-[#d32f2f] rounded-md text-sm font-semibold cursor-pointer transition-all duration-200 hover:bg-[#fff5f5] w-[120px]">Cancel</button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

export default MonitoringDetailsForm;
