'use client';
import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAdminData } from '../../context/AdminDataContext';

function RequestDetailsModal({ request, onClose }) {
  const router = useRouter();
  const { approveRequest, declineRequest } = useAdminData();
  const [isDeclineMode, setIsDeclineMode] = useState(false);
  const [declineRemarks, setDeclineRemarks] = useState('');

  const handleDeclineClick = () => setIsDeclineMode(true);

  const handleSubmitDecline = () => {
    if (!declineRemarks.trim()) { alert('Please enter remarks for declining this request'); return; }
    declineRequest(request.reqNumber, declineRemarks);
    onClose();
  };

  const handleProceedPO = () => {
    onClose();
    const params = new URLSearchParams({
      openPOModal: 'true',
      itemDescription: request.itemDescription,
      qty: request.qty.toString(),
      unit: request.unit,
      requisitioner: request.requisitioner,
      mrsNo: request.mrsNo,
      approvedBy: request.requestedBy,
      approvalDate: request.date,
    });
    router.push(`/admin/purchase-orders?${params.toString()}`);
  };

  const inputClass = 'py-2.5 px-3 border border-[#ccc] rounded-md text-[13px] text-[#333] bg-[#f5f5f5] transition-all duration-200 w-full box-border';

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-[1000] animate-fade-in">
      <div className="bg-white rounded-xl w-full max-w-[500px] shadow-[0_10px_30px_rgba(0,0,0,0.15)] animate-slide-in p-6">
        <div className="flex justify-between items-center border-b border-[#eee] pb-3 mb-5">
          <h2 className="m-0 text-lg font-bold text-[#333] tracking-wide">Request Details: {request.requisitioner}</h2>
          <button className="bg-none border-none text-2xl cursor-pointer text-[#888] hover:text-[#333] transition-colors duration-200 p-1 leading-none" onClick={onClose}>&times;</button>
        </div>

        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-3 gap-4">
            <div className="flex flex-col gap-1.5 text-left col-span-2">
              <label className="text-[11px] font-bold text-[#666]">ITEM DESCRIPTION</label>
              <input type="text" value={request.itemDescription} disabled className={inputClass} />
            </div>
            <div className="flex flex-col gap-1.5 text-left">
              <label className="text-[11px] font-bold text-[#666]">QTY</label>
              <input type="text" value={request.qty} disabled className={inputClass} />
            </div>
          </div>

          <div className="flex gap-4">
            <div className="flex flex-col gap-1.5 text-left flex-1">
              <label className="text-[11px] font-bold text-[#666]">UNIT</label>
              <input type="text" value={request.unit} disabled className={inputClass} />
            </div>
          </div>

          <div className="flex gap-4">
            <div className="flex flex-col gap-1.5 text-left flex-1">
              <label className="text-[11px] font-bold text-[#666]">APPROVED BY(WAREHOUSE)</label>
              <input type="text" value={request.requestedBy} disabled className={inputClass} />
            </div>
            <div className="flex flex-col gap-1.5 text-left flex-1">
              <label className="text-[11px] font-bold text-[#666]">DATE</label>
              <input type="date" value={request.date} disabled className={inputClass} />
            </div>
          </div>

          <div className="flex flex-col gap-1.5 text-left">
            <label className="text-[11px] font-bold text-[#666]">REQUISITIONER (OPTIONAL)</label>
            <input type="text" value={request.requisitioner} disabled className={inputClass} />
          </div>

          {isDeclineMode && (
            <div className="flex flex-col gap-1.5 text-left">
              <label className="text-[11px] font-bold text-[#444]">REMARKS <span className="text-[#d32f2f] ml-0.5">*</span></label>
              <textarea value={declineRemarks} onChange={(e) => setDeclineRemarks(e.target.value)}
                placeholder="Enter reason for declining this request"
                className="py-2.5 px-3 border border-[#ccc] rounded-md text-[13px] text-[#333] bg-white transition-all duration-200 w-full box-border focus:outline-none focus:border-[#0288d1] focus:ring-2 focus:ring-[#0288d1]/10 placeholder:text-[#bbb] resize-none h-[100px]" />
            </div>
          )}

          <div className="flex justify-center gap-4 mt-6 pt-4 border-t border-[#eee]">
            {!isDeclineMode ? (
              <>
                <button type="button" className="py-2.5 px-6 rounded-md text-sm font-semibold cursor-pointer transition-all duration-200 min-w-[120px] bg-white text-[#d32f2f] border border-[#d32f2f] hover:bg-[#fff5f5]" onClick={handleDeclineClick}>Decline</button>
                <button type="button" className="py-2.5 px-6 rounded-md text-sm font-semibold cursor-pointer transition-all duration-200 min-w-[120px] bg-[#006680] text-white border-none hover:bg-[#004d60]" onClick={handleProceedPO}>Proceed PO</button>
              </>
            ) : (
              <>
                <button type="button" className="py-2.5 px-6 rounded-md text-sm font-semibold cursor-pointer transition-all duration-200 min-w-[120px] bg-white text-[#333] border border-[#ccc] hover:bg-[#f5f5f5]" onClick={() => { setIsDeclineMode(false); setDeclineRemarks(''); }}>Back</button>
                <button type="button" className="py-2.5 px-6 rounded-md text-sm font-semibold cursor-pointer transition-all duration-200 min-w-[120px] bg-[#d32f2f] text-white border-none hover:bg-[#b71c1c]" onClick={handleSubmitDecline}>Submit</button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default RequestDetailsModal;
