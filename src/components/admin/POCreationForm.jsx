'use client';
import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useAdminData } from '../../context/AdminDataContext';

function makeEmptyItem() {
  return { itemDescription: '', qty: '', unit: 'pcs' };
}

function POCreationForm({ onClose, onSuccess, initialData = null }) {
  const { user } = useAuth();
  const { createPO, warehouses } = useAdminData();

  const [formListedBy, setFormListedBy] = useState(user?.name || user?.username || '');
  const [formPoNumber, setFormPoNumber] = useState('');
  const [formPoDate, setFormPoDate] = useState('');
  const [items, setItems] = useState(
    initialData?.items?.length ? initialData.items.map((it) => ({ ...it, qty: String(it.qty) })) : [makeEmptyItem()]
  );
  const [formNotes, setFormNotes] = useState('');
  const [formApprovedBy, setFormApprovedBy] = useState(initialData?.approvedBy || '');
  const [formApprovalDate, setFormApprovalDate] = useState(initialData?.approvalDate || '');
  const [formRequisitioner, setFormRequisitioner] = useState(initialData?.requisitioner || '');
  const [formMrsNo, setFormMrsNo] = useState(initialData?.mrsNo || '');
  const [formPickupBy, setFormPickupBy] = useState('');
  const [formPlateNumber, setFormPlateNumber] = useState('');
  const [formSupplierName, setFormSupplierName] = useState('');
  const [formSupplierAddress, setFormSupplierAddress] = useState('');
  const fromRequest = !!(initialData?.sourceReqNumber && initialData?.sourceRequestWarehouse);
  const [formWarehouse, setFormWarehouse] = useState(
    initialData?.sourceRequestWarehouse || user?.warehouse || (warehouses.length > 0 ? warehouses[0] : '')
  );
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  const updateItem = (idx, field, value) => setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, [field]: value } : it)));
  const addItem = () => setItems((prev) => [...prev, makeEmptyItem()]);
  const removeItem = (idx) => setItems((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitError(null);
    if (!formPoNumber || !formPoDate || !formRequisitioner || !formMrsNo || !formPickupBy || !formPlateNumber || !formSupplierName || !formWarehouse) {
      alert('Please fill in all required fields marked with *');
      return;
    }
    if (items.length === 0 || items.some((it) => !it.itemDescription.trim() || !it.qty || (parseInt(it.qty) || 0) < 1)) {
      alert('Please fill in a description and a positive quantity for every item');
      return;
    }
    if (submitting) return;

    const poItems = items.map((it) => ({ itemDescription: it.itemDescription, qty: parseInt(it.qty) || 0, unit: it.unit }));

    const newPO = {
      date: formPoDate,
      poNumber: formPoNumber,
      items: poItems,
      supplier: formSupplierName,
      supplierAddress: formSupplierAddress,
      requisitioner: formRequisitioner,
      mrsNo: formMrsNo,
      poExpDate: formApprovalDate || formPoDate,
      pickupBy: formPickupBy,
      plateNumber: formPlateNumber,
      approvedBy: formApprovedBy,
      listedBy: formListedBy,
      notes: formNotes,
      warehouse: formWarehouse,
      profileId: user?.id || null,
    };

    const source = initialData?.sourceReqNumber
      ? {
          reqNumber: initialData.sourceReqNumber,
          itemApprovals: (initialData.itemApprovals || []).map((a) => {
            const row = items.find((it) => it.id === a.id);
            return row ? { id: a.id, approvedQty: parseInt(row.qty) || 0 } : a;
          }),
        }
      : null;

    setSubmitting(true);
    try {
      await createPO(newPO, source);
      onClose();
      onSuccess();
    } catch (err) {
      setSubmitError(err?.message || 'Failed to create purchase order. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const inputClass = 'py-2.5 px-3 border border-[#ccc] rounded-md text-[13px] text-[#333] bg-white transition-all duration-200 w-full box-border focus:outline-none focus:border-[#0288d1] focus:ring-2 focus:ring-[#0288d1]/10 placeholder:text-[#bbb]';
  const labelClass = 'text-[11px] font-bold text-[#444]';

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-[1000] animate-fade-in">
      <div className="bg-white rounded-xl w-full max-w-[580px] max-h-[90vh] overflow-y-auto shadow-[0_10px_30px_rgba(0,0,0,0.15)] animate-slide-in p-6">
        <div className="flex justify-between items-center border-b border-[#eee] pb-3 mb-5">
          <h2 className="m-0 text-sm font-bold text-[#333] tracking-wide">PURCHASE ORDER FORM</h2>
          <button className="bg-none border-none text-2xl cursor-pointer text-[#888] hover:text-[#333] transition-colors duration-200 p-1 leading-none" onClick={onClose}>&times;</button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {submitError && (
            <div className="px-4 py-2.5 rounded-lg text-sm font-medium bg-[#ffebee] text-[#c62828] border border-[#ef9a9a]">
              {submitError}
            </div>
          )}
          <div className="flex flex-col gap-1.5 text-left w-full">
            <label className={labelClass}>LISTED BY (PURCHASER) <span className="text-[#d32f2f] ml-0.5">*</span></label>
            <input type="text" value={formListedBy} onChange={(e) => setFormListedBy(e.target.value)} placeholder="Enter purchaser name" required className={inputClass} />
          </div>

          <div className="flex gap-4 w-full">
            <div className="flex flex-col gap-1.5 text-left flex-1 w-1/2">
              <label className={labelClass}>PO NUMBER <span className="text-[#d32f2f] ml-0.5">*</span></label>
              <input type="text" value={formPoNumber} onChange={(e) => setFormPoNumber(e.target.value)} placeholder="Enter PO number" required className={inputClass} />
            </div>
            <div className="flex flex-col gap-1.5 text-left flex-1 w-1/2">
              <label className={labelClass}>DATE <span className="text-[#d32f2f] ml-0.5">*</span></label>
              <input type="date" value={formPoDate} onChange={(e) => setFormPoDate(e.target.value)} required className={inputClass} />
            </div>
          </div>

          <div className="text-[11px] font-bold text-[#888] tracking-widest mt-3 mb-1 border-b border-[#f0f0f0] pb-1 uppercase text-left flex items-center justify-between">
            <span>ITEM DETAILS</span>
            <button type="button" onClick={addItem} className="normal-case tracking-normal text-[#0288d1] hover:text-[#01579b] font-semibold cursor-pointer bg-none border-none text-[11px]">+ Add item</button>
          </div>

          {items.map((it, idx) => (
            <div key={idx} className="flex gap-3 w-full items-start border border-[#f0f0f0] rounded-md p-3">
              <div className="flex flex-col gap-1.5 text-left flex-[2]">
                {idx === 0 && <label className={labelClass}>ITEM DESCRIPTION <span className="text-[#d32f2f] ml-0.5">*</span></label>}
                <input type="text" value={it.itemDescription} onChange={(e) => updateItem(idx, 'itemDescription', e.target.value)} placeholder="Enter description" required className={inputClass} />
              </div>
              <div className="flex flex-col gap-1.5 text-left flex-[0.8]">
                {idx === 0 && <label className={labelClass}>QTY <span className="text-[#d32f2f] ml-0.5">*</span></label>}
                <input type="number" value={it.qty} onChange={(e) => updateItem(idx, 'qty', e.target.value)} placeholder="0" required className={inputClass} />
              </div>
              <div className="flex flex-col gap-1.5 text-left flex-[1]">
                {idx === 0 && <label className={labelClass}>UNIT <span className="text-[#d32f2f] ml-0.5">*</span></label>}
                <select value={it.unit} onChange={(e) => updateItem(idx, 'unit', e.target.value)} required className={inputClass}>
                  <option value="pcs">pcs</option>
                  <option value="bags">bags</option>
                  <option value="rolls">rolls</option>
                  <option value="sets">sets</option>
                  <option value="boxes">boxes</option>
                </select>
              </div>
              {items.length > 1 && (
                <button type="button" onClick={() => removeItem(idx)} className={`text-[#d32f2f] text-lg leading-none px-1 cursor-pointer bg-none border-none ${idx === 0 ? 'mt-6' : 'mt-2'}`} title="Remove item">
                  &times;
                </button>
              )}
            </div>
          ))}

          <div className="flex flex-col gap-1.5 text-left w-full">
            <label className={labelClass}>ITEM NOTES (optional)</label>
            <input type="text" value={formNotes} onChange={(e) => setFormNotes(e.target.value)} placeholder="Enter notes" className={inputClass} />
          </div>

          <div className="flex flex-col gap-1.5 text-left w-full">
            <label className={labelClass}>
              {fromRequest ? 'WAREHOUSE (REQUISITIONER)' : 'WAREHOUSE'} <span className="text-[#d32f2f] ml-0.5">*</span>
            </label>
            {fromRequest ? (
              <input
                type="text"
                value={formWarehouse}
                readOnly
                className={`${inputClass} bg-gray-100 text-[#666] cursor-not-allowed`}
              />
            ) : (
              <select value={formWarehouse} onChange={(e) => setFormWarehouse(e.target.value)} required className={inputClass}>
                <option value="" disabled>Select warehouse</option>
                {warehouses.map((w) => (
                  <option key={w} value={w}>{w}</option>
                ))}
              </select>
            )}
            {fromRequest && (
              <p className="m-0 text-[11px] text-[#999]">Auto-filled from the source warehouse request — no selection needed.</p>
            )}
          </div>

          <div className="text-[11px] font-bold text-[#888] tracking-widest mt-3 mb-1 border-b border-[#f0f0f0] pb-1 uppercase text-left">APPROVAL & PICK UP</div>

          <div className="flex gap-4 w-full">
            <div className="flex flex-col gap-1.5 text-left flex-1 w-1/2">
              <label className={labelClass}>APPROVED BY (WAREHOUSE) <span className="text-[#d32f2f] ml-0.5">*</span></label>
              <input type="text" value={formApprovedBy} onChange={(e) => setFormApprovedBy(e.target.value)} placeholder="Enter name" required className={inputClass} />
            </div>
            <div className="flex flex-col gap-1.5 text-left flex-1 w-1/2">
              <label className={labelClass}>DATE <span className="text-[#d32f2f] ml-0.5">*</span></label>
              <input type="date" value={formApprovalDate} onChange={(e) => setFormApprovalDate(e.target.value)} required className={inputClass} />
            </div>
          </div>

          <div className="flex gap-4 w-full">
            <div className="flex flex-col gap-1.5 text-left flex-1 w-1/2">
              <label className={labelClass}>REQUISITIONER <span className="text-[#d32f2f] ml-0.5">*</span></label>
              <input type="text" value={formRequisitioner} onChange={(e) => setFormRequisitioner(e.target.value)} placeholder="Enter name" required className={inputClass} />
            </div>
            <div className="flex flex-col gap-1.5 text-left flex-1 w-1/2">
              <label className={labelClass}>MRS # <span className="text-[#d32f2f] ml-0.5">*</span></label>
              <input type="text" value={formMrsNo} onChange={(e) => setFormMrsNo(e.target.value)} placeholder="00000" required className={inputClass} />
            </div>
          </div>

          <div className="flex gap-4 w-full">
            <div className="flex flex-col gap-1.5 text-left flex-1 w-1/2">
              <label className={labelClass}>PICK UP BY <span className="text-[#d32f2f] ml-0.5">*</span></label>
              <input type="text" value={formPickupBy} onChange={(e) => setFormPickupBy(e.target.value)} placeholder="Enter name" required className={inputClass} />
            </div>
            <div className="flex flex-col gap-1.5 text-left flex-1 w-1/2">
              <label className={labelClass}>PLATE NUMBER <span className="text-[#d32f2f] ml-0.5">*</span></label>
              <input type="text" value={formPlateNumber} onChange={(e) => setFormPlateNumber(e.target.value)} placeholder="Enter plate number" required className={inputClass} />
            </div>
          </div>

          <div className="text-[11px] font-bold text-[#888] tracking-widest mt-3 mb-1 border-b border-[#f0f0f0] pb-1 uppercase text-left">SUPPLIER INFO</div>

          <div className="flex gap-4 w-full">
            <div className="flex flex-col gap-1.5 text-left flex-1 w-1/2">
              <label className={labelClass}>SUPPLIER NAME <span className="text-[#d32f2f] ml-0.5">*</span></label>
              <input type="text" value={formSupplierName} onChange={(e) => setFormSupplierName(e.target.value)} placeholder="Enter name" required className={inputClass} />
            </div>
            <div className="flex flex-col gap-1.5 text-left flex-1 w-1/2">
              <label className={labelClass}>ADDRESS <span className="text-[#d32f2f] ml-0.5">*</span></label>
              <input type="text" value={formSupplierAddress} onChange={(e) => setFormSupplierAddress(e.target.value)} placeholder="Enter address" required className={inputClass} />
            </div>
          </div>

          <div className="flex justify-center gap-4 mt-6 pt-4 border-t border-[#eee]">
            <button type="button" className="py-2.5 px-6 rounded-md text-sm font-semibold cursor-pointer transition-all duration-200 min-w-[120px] bg-white text-[#d32f2f] border border-[#d32f2f] hover:bg-[#fff5f5] hover:shadow-[0_2px_6px_rgba(211,47,47,0.1)]" onClick={onClose}>Cancel</button>
            <button type="submit" disabled={submitting} className="py-2.5 px-6 rounded-md text-sm font-semibold cursor-pointer transition-all duration-200 min-w-[120px] bg-[#006680] text-white border-none hover:bg-[#004d60] hover:shadow-[0_2px_8px_rgba(0,102,128,0.2)] disabled:opacity-60 disabled:cursor-not-allowed">{submitting ? 'Saving…' : 'Save'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default POCreationForm;
