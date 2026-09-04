'use client';
import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAdminData } from '../../context/AdminDataContext';
import { getPOByNumber } from '../../../actions/pos';

function RequestDetailsModal({ request, onClose }) {
  const router = useRouter();
  const { declineRequest } = useAdminData();
  const [isDeclineMode, setIsDeclineMode] = useState(false);
  const [declineRemarks, setDeclineRemarks] = useState('');
  const [originalPO, setOriginalPO] = useState(null);
  const [poLoading, setPoLoading] = useState(false);
  const [poMissing, setPoMissing] = useState(false);
  const reqItems = request.items || [];
  const [approvedQtys, setApprovedQtys] = useState(
    () => Object.fromEntries(reqItems.map((it) => [it.id, String(it.qty)]))
  );

  const parsedApproved = (item) => {
    const v = parseInt(approvedQtys[item.id]);
    return Number.isFinite(v) ? Math.max(0, Math.min(v, item.qty)) : 0;
  };
  const totalRequested = reqItems.reduce((s, it) => s + it.qty, 0);
  const totalApproved = reqItems.reduce((s, it) => s + parsedApproved(it), 0);
  const isPartial = reqItems.some((it) => parsedApproved(it) < it.qty);

  useEffect(() => {
    if (!request.followUpOfPoNumber) return;
    let cancelled = false;
    setPoLoading(true);
    setPoMissing(false);
    getPOByNumber(request.followUpOfPoNumber)
      .then((po) => {
        if (cancelled) return;
        if (po) setOriginalPO(po);
        else setPoMissing(true);
      })
      .catch(() => {
        if (!cancelled) setPoMissing(true);
      })
      .finally(() => {
        if (!cancelled) setPoLoading(false);
      });
    return () => { cancelled = true; };
  }, [request.followUpOfPoNumber]);

  const poOrdered = (originalPO?.items || []).reduce((s, it) => s + it.qty, 0);
  const poReceivedRaw = originalPO ? parseInt(originalPO.monQtyRvd) : NaN;
  const poReceived = Number.isFinite(poReceivedRaw) ? poReceivedRaw : null;
  const poShortfall = poReceived != null ? Math.max(0, poOrdered - poReceived) : null;

  const handleDeclineClick = () => setIsDeclineMode(true);

  const handleSubmitDecline = async () => {
    if (!declineRemarks.trim()) { alert('Please enter remarks for declining this request'); return; }
    try {
      await declineRequest(request.reqNumber, declineRemarks);
      onClose();
    } catch (e) {
      alert('Failed to decline request: ' + (e.message || 'Please try again.'));
    }
  };

  const handleProceedPO = () => {
    const poItems = [];
    const itemApprovals = [];
    for (const it of reqItems) {
      const approved = parsedApproved(it);
      itemApprovals.push({ id: it.id, approvedQty: approved });
      if (approved > 0) {
        poItems.push({ id: it.id, itemDescription: it.itemDescription, qty: approved, unit: it.unit });
      }
    }
    if (poItems.length === 0) {
      alert('Approve at least one item before proceeding to PO');
      return;
    }
    onClose();
    const params = new URLSearchParams({
      openPOModal: 'true',
      reqNumber: request.reqNumber,
      requestWarehouse: (request.warehouse || '').toString(),
      requisitioner: request.requisitioner,
      mrsNo: request.mrsNo,
      approvedBy: request.requestedBy,
      approvalDate: request.date,
      items: JSON.stringify(poItems),
      itemApprovals: JSON.stringify(itemApprovals),
    });
    router.push(`/admin/purchase-orders?${params.toString()}`);
  };

  const inputClass = 'py-2 px-3 border border-[#ccc] rounded-md text-[13px] text-[#333] bg-white transition-all duration-200 w-full box-border';

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-[1000] animate-fade-in overflow-y-auto py-6 px-4">
      <div className="bg-white rounded-xl w-full max-w-[560px] max-h-[90vh] overflow-y-auto shadow-[0_10px_30px_rgba(0,0,0,0.15)] animate-slide-in p-6">
        <div className="flex justify-between items-center border-b border-[#eee] pb-3 mb-5">
          <h2 className="m-0 text-lg font-bold text-[#333] tracking-wide">Request Details: {request.requisitioner}</h2>
          <button className="bg-none border-none text-2xl cursor-pointer text-[#888] hover:text-[#333] transition-colors duration-200 p-1 leading-none" onClick={onClose}>&times;</button>
        </div>

        {request.followUpOfPoNumber && (
          <div className="p-3 bg-[#fef5f5] border border-[#ffcdd2] rounded-md flex flex-col gap-2 text-left">
            <p className="m-0 text-[11px] font-bold text-[#c62828] tracking-wide">
              FOLLOW-UP OF {request.followUpOfPoNumber}
              {originalPO && (
                <span className="font-normal text-[#888]"> · {originalPO.mrsNo}{originalPO.warehouse ? ` · ${originalPO.warehouse}` : ''}</span>
              )}
            </p>
            {poLoading && (
              <p className="m-0 text-[12px] text-[#999]">Loading delivery reference…</p>
            )}
            {!poLoading && poMissing && (
              <p className="m-0 text-[12px] text-[#888]">
                Original PO not available (may have been archived). Use the reference number below to request the receipt from the warehouse.
              </p>
            )}
            {!poLoading && originalPO && (
              <>
                <div className="grid grid-cols-2 gap-2 text-[12px] text-[#333]">
                  <div><span className="text-[#888] font-bold">Reference No.: </span>{originalPO.monReferenceNo || '—'}</div>
                  <div><span className="text-[#888] font-bold">DR Date: </span>{originalPO.monDrDate || '—'}</div>
                  <div><span className="text-[#888] font-bold">Delivered By: </span>{originalPO.monDeliveredBy || '—'}</div>
                  <div><span className="text-[#888] font-bold">Date Delivered: </span>{originalPO.monDateDelivered || '—'}</div>
                </div>
                {originalPO.monRemarks && (
                  <div className="text-[12px] text-[#333]"><span className="text-[#888] font-bold">Remarks: </span>{originalPO.monRemarks}</div>
                )}
                <div className="grid grid-cols-3 gap-2 text-[12px] text-[#333] pt-2 border-t border-[#ffcdd2]">
                  <div><span className="text-[#888] font-bold block">Ordered</span>{poOrdered}</div>
                  <div><span className="text-[#888] font-bold block">Received</span>{poReceived ?? '—'}</div>
                  <div><span className="text-[#888] font-bold block">Shortfall</span>{poShortfall ?? '—'}</div>
                </div>
              </>
            )}
          </div>
        )}

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-3">
            <label className="text-[11px] font-bold text-[#666]">ITEMS</label>
            {reqItems.map((it) => {
              const approved = parsedApproved(it);
              const balance = Math.max(0, it.qty - approved);
              return (
                <div key={it.id} className="grid grid-cols-3 gap-3 items-end border border-[#eee] rounded-md p-3 text-left">
                  <div className="col-span-3 md:col-span-1 flex flex-col gap-1">
                    <span className="text-[10px] font-bold text-[#999] uppercase">Description</span>
                    <span className="text-[13px] text-[#333] font-medium">{it.itemDescription} <span className="text-[11px] text-[#999]">({it.unit})</span></span>
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] font-bold text-[#999] uppercase">Requested</span>
                    <span className="text-[13px] text-[#333] font-medium">{it.qty}</span>
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] font-bold text-[#444] uppercase">Approved (max {it.qty})</span>
                    <input
                      type="number"
                      min="0"
                      max={it.qty}
                      value={approvedQtys[it.id]}
                      onChange={(e) => setApprovedQtys((prev) => ({ ...prev, [it.id]: e.target.value }))}
                      className={inputClass}
                    />
                    {balance > 0 && <span className="text-[10px] text-[#f57c00] font-semibold">balance {balance}</span>}
                  </div>
                </div>
              );
            })}
            {isPartial && (
              <p className="m-0 text-xs text-[#f57c00] font-semibold">
                Partial approval — {totalApproved} of {totalRequested} total units approved. The remaining balance stays on this request for the warehouse to file a follow-up.
              </p>
            )}
          </div>

          <div className="flex gap-4">
            <div className="flex flex-col gap-1.5 text-left flex-1">
              <label className="text-[11px] font-bold text-[#666]">APPROVED BY(WAREHOUSE)</label>
              <input type="text" value={request.requestedBy} disabled className={`${inputClass} bg-[#f5f5f5]`} />
            </div>
            <div className="flex flex-col gap-1.5 text-left flex-1">
              <label className="text-[11px] font-bold text-[#666]">DATE</label>
              <input type="date" value={request.date} disabled className={`${inputClass} bg-[#f5f5f5]`} />
            </div>
          </div>

          <div className="flex flex-col gap-1.5 text-left">
            <label className="text-[11px] font-bold text-[#666]">REQUISITIONER (OPTIONAL)</label>
            <input type="text" value={request.requisitioner} disabled className={`${inputClass} bg-[#f5f5f5]`} />
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
                <button type="button" className="py-2.5 px-6 rounded-md text-sm font-semibold cursor-pointer transition-all duration-200 min-w-[120px] bg-[#006680] text-white border-none hover:bg-[#004d60]" onClick={handleProceedPO}>
                  {isPartial ? 'Proceed PO (Partial)' : 'Proceed PO'}
                </button>
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
