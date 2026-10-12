'use client';
import React, { useState } from 'react';
import { useWarehouseData } from '../../context/WarehouseDataContext';
import { useAuth } from '../../context/AuthContext';

function makeEmptyItem() { return { itemDescription: '', qty: '', unit: 'pcs' }; }

// Material requests only.
//
// This modal USED to double as the warehouse's request-level follow-up: a
// "File Follow-Up" button opened it against a PARTIALLY APPROVED parent and sent
// `followUpOfReqNumber`, creating a second request for the undecided remainder.
// That is gone. The remainder is now the PURCHASER's to settle, through
// Follow-up Approval on this same request — which adds to the existing decision
// instead of opening a parallel approval chain that never closed the parent.
// RequestsView shows "Awaiting purchaser decision" for the rows that are waiting.
//
// A procurement follow-up against a purchase order was never available here:
// chasing a purchase shortfall is the Admin's job, via a Follow-up Purchase on
// the same PO. The server enforces that distinction independently (see
// actions/requests.ts createRequest), which is why removing the request-level
// branch here needed no server-side deletion — only the refusal in createRequest
// that a Warehouse caller may not send `followUpOfReqNumber`.
function CreateRequestModal({ onClose }) {
  const { createRequest } = useWarehouseData();
  const { user } = useAuth();

  const [reqDate, setReqDate] = useState('');
  const [items, setItems] = useState([makeEmptyItem()]);
  const [reqMrsNo, setReqMrsNo] = useState('');
  const [reqApprovedBy, setReqApprovedBy] = useState('');
  // The server-generated number, held only long enough to confirm it on success.
  const [createdNumber, setCreatedNumber] = useState(null);
  const [submitError, setSubmitError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const updateItem = (idx, field, value) => setItems((prev) => prev.map((it, i) => i === idx ? { ...it, [field]: value } : it));
  const addItem = () => setItems((prev) => [...prev, makeEmptyItem()]);
  const removeItem = (idx) => setItems((prev) => prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitError(null);
    if (submitting) return;
    if (!reqDate || !reqMrsNo || !reqApprovedBy) { setSubmitError('Please fill in all required fields.'); return; }
    if (!items.length) { setSubmitError('Add at least one item.'); return; }
    for (const it of items) {
      const qty = Number(it.qty);
      if (!it.itemDescription.trim() || !Number.isInteger(qty) || qty < 1) { setSubmitError('Every item must have a positive whole-number quantity.'); return; }
    }
    // No reqNumber: the request number is a persistent identifier and the server
    // allocates it (actions/requests.ts allocateReqNumber). A preview below is
    // labelled provisional; the authoritative one comes back on the created row.
    const newReq = {
      date: reqDate,
      items: items.map((it) => ({ itemDescription: it.itemDescription.trim(), qty: Number(it.qty), unit: it.unit })),
      // MRS No. is a free-typed identifier; the server takes it as given.
      mrsNo: reqMrsNo.trim(), requestedBy: reqApprovedBy.trim(), requisitioner: user?.warehouse || 'Warehouse Site',
    };
    setSubmitting(true);
    try {
      const created = await createRequest(newReq);
      setCreatedNumber(created?.reqNumber || null);
      onClose();
    }
    catch (err) { setSubmitError(err?.message || 'Failed to create request. Please try again.'); }
    finally { setSubmitting(false); }
  };

  const inputClass = 'py-2.5 px-3 border border-[#ccc] rounded-md text-[13px] text-[#333] w-full box-border';
  const labelClass = 'text-[11px] font-bold text-[#666] uppercase';

  return <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-[1000] overflow-y-auto py-6 px-4">
    <div className="bg-white rounded-xl w-full max-w-[560px] max-h-[90vh] overflow-y-auto shadow-[0_10px_30px_rgba(0,0,0,0.15)] p-6 text-left">
      <div className="flex justify-between items-center border-b border-[#eee] pb-3 mb-5"><h2 className="m-0 text-lg font-bold text-[#333]">Create Material Request</h2><button className="text-2xl text-[#888]" onClick={onClose}>&times;</button></div>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {submitError && <div className="px-3 py-2 rounded-md text-xs font-medium bg-[#ffebee] text-[#c62828] border border-[#ef9a9a]">{submitError}</div>}
        <div className="flex gap-4"><div className="flex flex-col gap-1.5 flex-1"><label className={labelClass}>Date *</label><input type="date" value={reqDate} onChange={(e) => setReqDate(e.target.value)} required className={inputClass} /></div><div className="flex flex-col gap-1.5 flex-1"><label className={labelClass}>MRS No. *</label><input type="text" value={reqMrsNo} onChange={(e) => setReqMrsNo(e.target.value)} required className={inputClass} /></div></div>
        {/* Provisional only. The persisted number is allocated by the server and
            returned on the created row; this is a courtesy hint, not an
            identifier anything is keyed to. */}
        <p className="m-0 text-[11px] text-[#888]">Request number is assigned automatically on submit (format REQ-#####).</p>
        {createdNumber && <p className="m-0 text-[11px] text-[#2e7d32]" role="status">Created as {createdNumber}.</p>}
        <div className="flex flex-col gap-3"><div className="flex justify-between"><label className={labelClass}>Items *</label><button type="button" onClick={addItem} className="text-xs font-semibold text-[#1e3c72]">+ Add item</button></div>
          {items.map((it, idx) => <div key={idx} className="flex gap-2 items-start border border-[#eee] rounded-md p-3"><div className="flex-[2]"><input type="text" value={it.itemDescription} onChange={(e) => updateItem(idx, 'itemDescription', e.target.value)} required className={inputClass} /></div><div className="flex-1"><input type="number" value={it.qty} onChange={(e) => updateItem(idx, 'qty', e.target.value)} min="1" required className={inputClass} /></div><div className="flex-1"><select value={it.unit} onChange={(e) => updateItem(idx, 'unit', e.target.value)} className={inputClass}><option value="pcs">pcs</option><option value="bags">bags</option><option value="rolls">rolls</option><option value="sets">sets</option><option value="boxes">boxes</option></select></div>{items.length > 1 && <button type="button" onClick={() => removeItem(idx)} className="text-[#d32f2f] text-lg">&times;</button>}</div>)}
        </div>
        <div><label className={labelClass}>Approved By (Site Engineer) *</label><input type="text" value={reqApprovedBy} onChange={(e) => setReqApprovedBy(e.target.value)} required className={inputClass} /></div>
        <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-[#eee]"><button type="button" onClick={onClose} className="py-2.5 px-6 rounded-md bg-white text-[#555] border border-gray-300">Cancel</button><button type="submit" disabled={submitting} className="py-2.5 px-6 rounded-md bg-[#1e3c72] text-white disabled:opacity-60">{submitting ? 'Submitting…' : 'Submit Request'}</button></div>
      </form>
    </div>
  </div>;
}
export default CreateRequestModal;