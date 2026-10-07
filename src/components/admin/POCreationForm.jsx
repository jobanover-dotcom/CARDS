'use client';
import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useAdminData } from '../../context/AdminDataContext';

function makeEmptyItem() { return { itemDescription: '', qty: '', unit: 'pcs', maxQty: null }; }

// One PO creation form, two modes.
//
//   DEFAULT          raise a fresh purchase order against a requirement
//   follow-up mode   buy the remainder of an MRS that is already partly bought
//
// The follow-up mode reuses this form rather than introducing a second one, and
// mirrors what "raise a PO from an approved request" already does: the material
// lines and their warehouse are fixed, and each quantity is capped. What differs
// is where the cap comes from — the amount of the REQUIREMENT still unpurchased
// across every PO on that MRS, not the requirement itself — and that the MRS is
// locked so a follow-up can never be raised against a different one.
//
// Submitting a follow-up creates a NEW purchase order on the SAME MRS. The
// original PO is never opened, re-supplied or amended.
function POCreationForm({ onClose, onSuccess, initialData = null }) {
  const { user } = useAuth();
  const { createPO, createFollowUpPO, warehouses } = useAdminData();
  const followUp = initialData?.followUp ?? null;
  const fromRequest = !!(initialData?.sourceReqNumber && initialData?.sourceRequestWarehouse);
  const [formListedBy, setFormListedBy] = useState(user?.name || user?.username || '');
  const [formPoNumber, setFormPoNumber] = useState('');
  const [formPoDate, setFormPoDate] = useState(followUp?.date || '');
  // Follow-up lines arrive pre-seeded and capped from the server's MRS remainder.
  const [items, setItems] = useState(
    initialData?.items?.length
      ? initialData.items.map((it) => ({ ...it, qty: String(it.qty), maxQty: Number(it.maxQty ?? it.qty) }))
      : [makeEmptyItem()],
  );
  const [formNotes, setFormNotes] = useState('');
  const [formApprovedBy, setFormApprovedBy] = useState(initialData?.approvedBy || '');
  const [formApprovalDate, setFormApprovalDate] = useState(initialData?.approvalDate || '');
  const [formRequisitioner, setFormRequisitioner] = useState(initialData?.requisitioner || '');
  const [formMrsNo, setFormMrsNo] = useState(initialData?.mrsNo || '');
  const [formWarehouse, setFormWarehouse] = useState(initialData?.sourceRequestWarehouse || user?.warehouse || (warehouses.length ? warehouses[0] : ''));
  // A follow-up RAISES a purchase order against the remainder of a material
  // request; it does not buy anything, so it asks for no supplier — exactly like
  // raising a PO by hand. The supplier is chosen later, in Save Purchase on the
  // new PO, which is what keeps one supplier per purchasing transaction.
  const lockedLines = fromRequest || !!followUp;
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  const updateItem = (idx, field, value) => setItems((prev) => prev.map((it, i) => i === idx ? { ...it, [field]: value } : it));
  const addItem = () => setItems((prev) => [...prev, makeEmptyItem()]);
  const removeItem = (idx) => setItems((prev) => prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitError(null);
    if (followUp?.blocked) {
      setSubmitError(`Every approved unit on ${followUp.mrsNo} has already been purchased. There is nothing left to follow up.`);
      return;
    }
    if (!formPoNumber || !formPoDate || !formRequisitioner || !formMrsNo || !formWarehouse) {
      setSubmitError('Please fill in all required fields marked with *.'); return;
    }
    if (!items.length || items.some((it) => !it.itemDescription.trim() || !Number.isInteger(Number(it.qty)) || Number(it.qty) < 1)) {
      setSubmitError('Please enter a positive whole-number quantity for every item.'); return;
    }
    for (const it of items) {
      const qty = Number(it.qty);
      if (it.maxQty != null && qty > it.maxQty) {
        setSubmitError(`Quantity for "${it.itemDescription}" cannot exceed the approved amount of ${it.maxQty} ${it.unit}.`); return;
      }
    }
    if (submitting) return;
    setSubmitting(true);
    try {
      if (followUp) {
        // A follow-up never touches the original PO. It raises a new PO on the
        // same MRS; the server re-validates every figure against current data.
        await createFollowUpPO({
          originalPoNumber: followUp.originalPoNumber,
          poNumber: formPoNumber.trim(),
          date: formPoDate,
          remarks: formNotes.trim() || undefined,
          items: items.map((it) => ({ itemDescription: it.itemDescription.trim(), qty: Number(it.qty) })),
        });
      } else {
        const poItems = items.map((it) => ({ itemDescription: it.itemDescription.trim(), qty: Number(it.qty), unit: it.unit }));
        const newPO = {
          date: formPoDate, poNumber: formPoNumber.trim(), items: poItems,
          requisitioner: formRequisitioner.trim(), mrsNo: formMrsNo.trim(),
          poExpDate: formApprovalDate || formPoDate, approvedBy: formApprovedBy.trim(),
          listedBy: formListedBy.trim(), notes: formNotes.trim(), warehouse: formWarehouse,
          profileId: user?.id || null,
        };
        const source = initialData?.sourceReqNumber ? {
          reqNumber: initialData.sourceReqNumber,
          itemApprovals: (initialData.itemApprovals || []).map((a) => {
            const row = items.find((it) => it.id === a.id);
            return row ? { id: a.id, approvedQty: Number(row.qty) } : a;
          }),
        } : null;
        await createPO(newPO, source);
      }
      onClose();
      onSuccess();
    }
    catch (err) { setSubmitError(err?.message || 'Failed to create purchase order. Please try again.'); }
    finally { setSubmitting(false); }
  };

  const inputClass = 'py-2.5 px-3 border border-[#ccc] rounded-md text-[13px] text-[#333] bg-white transition-all duration-200 w-full box-border focus:outline-none focus:border-[#0288d1] focus:ring-2 focus:ring-[#0288d1]/10 placeholder:text-[#bbb]';
  const lockedClass = `${inputClass} bg-gray-100 text-[#666]`;
  const labelClass = 'text-[11px] font-bold text-[#444]';
  const lockNote = 'Locked: a follow-up purchase fulfils this same material request.';

  return <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-[1000] animate-fade-in">
    <div className="bg-white rounded-xl w-full max-w-[580px] max-h-[90vh] overflow-y-auto shadow-[0_10px_30px_rgba(0,0,0,0.15)] animate-slide-in p-6">
      <div className="flex justify-between items-center border-b border-[#eee] pb-3 mb-5">
        <h2 className="m-0 text-sm font-bold text-[#333] tracking-wide">{followUp ? 'FOLLOW-UP PURCHASE' : 'PURCHASE ORDER FORM'}</h2>
        <button type="button" className="text-2xl cursor-pointer text-[#888] p-1 leading-none" onClick={onClose}>&times;</button>
      </div>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {submitError && <div className="px-4 py-2.5 rounded-lg text-sm font-medium bg-[#ffebee] text-[#c62828] border border-[#ef9a9a]">{submitError}</div>}
        {followUp && !followUp.blocked && (
          <p className="m-0 text-[11px] text-[#888] bg-[#f7f9fa] border border-[#eef1f3] rounded-md p-2.5">
            This raises a <strong>new purchase order</strong> on {followUp.mrsNo} for the
            {` ${followUp.totalRemaining} `}unit(s) still approved but unpurchased. It opens in Pending
            Purchase; record the supplier and the purchase from it afterwards.
            {followUp.originalPoNumber} stays exactly as it is.
          </p>
        )}
        {followUp?.blocked && (
          <p className="m-0 text-[11px] font-semibold text-[#2e7d32] bg-[#e8f5e9] border border-[#a5d6a7] rounded-md p-2.5">
            Every approved unit on {followUp.mrsNo} has already been purchased. Nothing is left to buy;
            what remains is receiving.
          </p>
        )}
        <div className="flex flex-col gap-1.5 text-left"><label className={labelClass}>LISTED BY (PURCHASER) *</label><input type="text" value={formListedBy} onChange={(e) => setFormListedBy(e.target.value)} required className={inputClass} /></div>
        <div className="flex gap-4"><div className="flex flex-col gap-1.5 flex-1"><label className={labelClass}>PO NUMBER *</label><input type="text" value={formPoNumber} onChange={(e) => setFormPoNumber(e.target.value)} required className={inputClass} /></div><div className="flex flex-col gap-1.5 flex-1"><label className={labelClass}>DATE *</label><input type="date" value={formPoDate} onChange={(e) => setFormPoDate(e.target.value)} required className={inputClass} /></div></div>
        <div className="text-[11px] font-bold text-[#888] tracking-widest border-b border-[#f0f0f0] pb-1 flex justify-between"><span>ITEM DETAILS</span>{!lockedLines && <button type="button" onClick={addItem} className="text-[#0288d1] bg-none border-none">+ Add item</button>}</div>
        {items.map((it, idx) => <div key={idx} className="flex gap-3 items-start border border-[#f0f0f0] rounded-md p-3"><div className="flex flex-col gap-1.5 flex-[2]"><label className={labelClass}>{idx === 0 ? 'ITEM DESCRIPTION *' : ''}</label><input type="text" value={it.itemDescription} onChange={(e) => updateItem(idx, 'itemDescription', e.target.value)} required readOnly={lockedLines} className={lockedLines ? lockedClass : inputClass} /></div><div className="flex flex-col gap-1.5 flex-[0.8]"><label className={labelClass}>{idx === 0 ? 'QTY *' : ''}</label><input type="number" min="1" max={it.maxQty ?? undefined} value={it.qty} onChange={(e) => updateItem(idx, 'qty', e.target.value)} required disabled={followUp?.blocked} className={inputClass} />{it.maxQty != null && <span className="text-[10px] text-[#777]">{followUp ? `max: ${it.maxQty} left to buy` : `max: ${it.maxQty} ${it.unit}`}</span>}</div><div className="flex flex-col gap-1.5 flex-[1]"><label className={labelClass}>{idx === 0 ? 'UNIT *' : ''}</label><select value={it.unit} onChange={(e) => updateItem(idx, 'unit', e.target.value)} disabled={lockedLines} required className={lockedLines ? lockedClass : inputClass}><option value="pcs">pcs</option><option value="bags">bags</option><option value="rolls">rolls</option><option value="sets">sets</option><option value="boxes">boxes</option></select></div>{!lockedLines && items.length > 1 && <button type="button" onClick={() => removeItem(idx)} className="text-[#d32f2f] text-lg mt-6">&times;</button>}</div>)}
        <div className="flex flex-col gap-1.5"><label className={labelClass}>ITEM NOTES (optional)</label><input type="text" value={formNotes} onChange={(e) => setFormNotes(e.target.value)} className={inputClass} /></div>
        <div className="flex flex-col gap-1.5"><label className={labelClass}>{followUp ? 'WAREHOUSE' : fromRequest ? 'WAREHOUSE (REQUISITIONER)' : 'WAREHOUSE'} *</label>{lockedLines ? <input type="text" value={formWarehouse} readOnly className={lockedClass} /> : <select value={formWarehouse} onChange={(e) => setFormWarehouse(e.target.value)} required className={inputClass}><option value="" disabled>Select warehouse</option>{warehouses.map((w) => <option key={w} value={w}>{w}</option>)}</select>}</div>
        <div className="text-[11px] font-bold text-[#888] tracking-widest border-b border-[#f0f0f0] pb-1">APPROVAL</div>
        <div className="flex gap-4"><div className="flex flex-col gap-1.5 flex-1"><label className={labelClass}>APPROVED BY (WAREHOUSE) *</label><input type="text" value={formApprovedBy} onChange={(e) => setFormApprovedBy(e.target.value)} required className={inputClass} /></div><div className="flex flex-col gap-1.5 flex-1"><label className={labelClass}>DATE *</label><input type="date" value={formApprovalDate} onChange={(e) => setFormApprovalDate(e.target.value)} required className={inputClass} /></div></div>
        <div className="flex gap-4"><div className="flex flex-col gap-1.5 flex-1"><label className={labelClass}>REQUISITIONER *</label><input type="text" value={formRequisitioner} onChange={(e) => setFormRequisitioner(e.target.value)} required className={inputClass} /></div><div className="flex flex-col gap-1.5 flex-1"><label className={labelClass}>MRS # *</label><input type="text" value={formMrsNo} onChange={(e) => setFormMrsNo(e.target.value)} required readOnly={!!followUp} className={followUp ? lockedClass : inputClass} />{followUp && <span className="text-[10px] text-[#888]">{lockNote}</span>}</div></div>
        {!followUp && <p className="m-0 text-[11px] text-[#888] bg-[#f7f9fa] border border-[#eef1f3] rounded-md p-2.5">
          The supplier is not set here. A purchase order records the approved requirement; the supplier is
          chosen when purchase quantities are saved, in the Save Purchase step.
        </p>}
        <div className="flex justify-center gap-4 mt-6 pt-4 border-t border-[#eee]"><button type="button" onClick={onClose} className="py-2.5 px-6 rounded-md bg-white text-[#d32f2f] border border-[#d32f2f]">Cancel</button><button type="submit" disabled={submitting || followUp?.blocked} className="py-2.5 px-6 rounded-md bg-[#006680] text-white disabled:opacity-60">{submitting ? 'Saving…' : followUp ? 'Create Follow-up PO' : 'Save'}</button></div>
      </form>
    </div>
  </div>;
}
export default POCreationForm;
