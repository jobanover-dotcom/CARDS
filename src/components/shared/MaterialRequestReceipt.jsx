import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';

function getStatusDisplay(po) {
  if (po.statusLabel) {
    return po.statusLabel;
  }
  if (po.status === 'completed') {
    return 'Completed';
  }
  if (po.poType === 'active-delivery') {
    return 'Active Delivery';
  }
  if (po.poType === 'discrepancy') {
    return 'Discrepancy';
  }
  return 'Open';
}

function getStatusColor(po) {
  if (po.status === 'completed') {
    return { bg: 'bg-[#e8f5e9]', text: 'text-[#2e7d32]', border: 'border-[#a5d6a7]' };
  }
  if (po.poType === 'active-delivery') {
    return { bg: 'bg-[#e3f2fd]', text: 'text-[#1e3c72]', border: 'border-[#90caf9]' };
  }
  if (po.poType === 'discrepancy') {
    return { bg: 'bg-[#fef5f5]', text: 'text-[#c62828]', border: 'border-[#f44336]' };
  }
  return { bg: 'bg-[#fff9e6]', text: 'text-[#f57f17]', border: 'border-[#ffb74d]' };
}

function parsePoDate(dateStr) {
  if (!dateStr) return null;
  const parts = dateStr.split('-');
  if (parts.length !== 3) return null;
  const month = parseInt(parts[0], 10) - 1;
  const day = parseInt(parts[1], 10);
  const year = parseInt(parts[2], 10) + 2000;
  return new Date(year, month, day);
}

function isWithin3Days(dateStr) {
  const poDate = parsePoDate(dateStr);
  if (!poDate) return false;
  const now = new Date();
  const diffTime = now - poDate;
  const diffDays = diffTime / (1000 * 60 * 60 * 24);
  return diffDays <= 3;
}

function isViewed(poNumber) {
  if (typeof window === 'undefined') return false;
  const viewed = localStorage.getItem('viewedPOs');
  if (!viewed) return false;
  try {
    const viewedList = JSON.parse(viewed);
    return viewedList.includes(poNumber);
  } catch {
    return false;
  }
}

function markAsViewed(poNumber) {
  if (typeof window === 'undefined') return;
  const viewed = localStorage.getItem('viewedPOs');
  let viewedList = [];
  if (viewed) {
    try {
      viewedList = JSON.parse(viewed);
    } catch {
      viewedList = [];
    }
  }
  if (!viewedList.includes(poNumber)) {
    viewedList.push(poNumber);
    localStorage.setItem('viewedPOs', JSON.stringify(viewedList));
  }
}

function MaterialRequestReceipt({ po, onClose, onDelete }) {
  const [showNewRequest, setShowNewRequest] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState(null);
  const { user } = useAuth();
  const isSuperadmin = user?.role === 'Superadmin' && typeof onDelete === 'function';

  const handleDeletePO = async () => {
    if (!window.confirm(`Are you sure you want to permanently delete PO ${po.poNumber}? This action cannot be undone.`)) return;
    setDeleting(true);
    setError(null);
    try {
      await onDelete(po.poNumber);
      onClose();
    } catch (e) {
      setError(e.message || 'Failed to delete purchase order');
    } finally {
      setDeleting(false);
    }
  };

  useEffect(() => {
    const viewed = isViewed(po.poNumber);
    const within3Days = isWithin3Days(po.date);
    const shouldShow = !viewed && within3Days;
    setShowNewRequest(shouldShow);

    if (!viewed) {
      markAsViewed(po.poNumber);
    }
  }, [po.poNumber, po.date]);

  const statusDisplay = getStatusDisplay(po);
  const statusColor = getStatusColor(po);

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[1050] animate-fade-in overflow-y-auto py-10 px-4">
      <div className="bg-white rounded-xl w-full max-w-[500px] shadow-[0_10px_40px_rgba(0,0,0,0.2)] animate-slide-in p-8 text-[#333] border border-gray-200 font-sans relative">

        <button
          className="absolute top-4 right-4 bg-none border-none text-2xl cursor-pointer text-[#888] hover:text-[#333] transition-colors duration-200 p-1 leading-none no-print"
          onClick={onClose}
        >
          &times;
        </button>

        <div className="text-center mb-5">
          <h2 className="m-0 text-lg font-extrabold tracking-wider text-[#1e2d3b] uppercase">CARWILL CONSTRUCTION INC.</h2>
          <p className="m-0 text-[11px] text-[#777] mt-1 font-medium">123 Business Street, Davao City | Tel: (082) 000-0000</p>
        </div>

        <div className="bg-[#1e2d3b] text-white text-center py-2 px-4 font-bold text-[12px] tracking-widest uppercase mb-4 rounded-sm">
          MATERIAL REQUEST RECEIPT
        </div>

        <div className="flex justify-between items-center text-xs font-bold border-b border-gray-200 pb-2 mb-4">
          <span className="font-mono text-[#444]">{po.poNumber || 'PO-REQ-001'}</span>
          <div className="flex items-center gap-2">
            <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${statusColor.bg} ${statusColor.text} ${statusColor.border}`}>
              <span className="w-1.5 h-1.5 rounded-full bg-current inline-block"></span>
              {statusDisplay}
            </span>
            {showNewRequest && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#fff3e0] text-[#e65100] border border-[#ffb74d] animate-pulse">
                <span className="w-1.5 h-1.5 rounded-full bg-[#ff9800] inline-block animate-bounce"></span>
                New Request
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-4 text-[12px]">

          <div className="flex flex-col gap-1.5">
            <h3 className="m-0 text-[10px] font-bold text-[#999] tracking-widest uppercase text-left border-b border-dashed border-gray-200 pb-0.5">REQUEST INFO</h3>
            <div className="flex justify-between">
              <span className="text-[#777]">MRS no.</span>
              <span className="font-mono font-semibold bg-gray-100 px-1.5 py-0.5 rounded text-[11px]">{po.mrsNo || 'MRS-001-2026'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#777]">Request date</span>
              <span className="font-semibold">{po.date}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#777]">Submitted</span>
              <span className="font-semibold text-gray-600">{po.date} at 8:16 AM</span>
            </div>
            {po.listedBy && (
              <div className="flex justify-between">
                <span className="text-[#777]">Listed by (Purchaser)</span>
                <span className="font-semibold">{po.listedBy}</span>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <h3 className="m-0 text-[10px] font-bold text-[#999] tracking-widest uppercase text-left border-b border-dashed border-gray-200 pb-0.5">SUPPLIER</h3>
            <div className="flex justify-between">
              <span className="text-[#777]">Name</span>
              <span className="font-semibold">{po.supplier || 'N/A'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#777]">Address</span>
              <span className="font-semibold">{po.supplierAddress || 'Davao City'}</span>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <h3 className="m-0 text-[10px] font-bold text-[#999] tracking-widest uppercase text-left border-b border-dashed border-gray-200 pb-0.5">REQUESTED BY & TRANSPORT</h3>
            <div className="flex justify-between">
              <span className="text-[#777]">Requisitioner</span>
              <span className="font-semibold">{po.requisitioner || 'N/A'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#777]">Approved by (Site Engineer)</span>
              <span className="font-semibold">{po.approvedBy || 'Approved by Warehouse'}</span>
            </div>
            {po.poExpDate && (
              <div className="flex justify-between">
                <span className="text-[#777]">Approval/Exp Date</span>
                <span className="font-semibold">{po.poExpDate}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-[#777]">Picked up by</span>
              <span className="font-semibold">{po.pickupBy || 'N/A'}</span>
            </div>
            {po.plateNumber && (
              <div className="flex justify-between">
                <span className="text-[#777]">Plate Number</span>
                <span className="font-semibold uppercase">{po.plateNumber}</span>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-2 mt-1">
            <h3 className="m-0 text-[10px] font-bold text-[#999] tracking-widest uppercase text-left border-b border-dashed border-gray-200 pb-0.5">ITEMS</h3>
            <div className="flex justify-between font-bold text-[10px] text-gray-500 uppercase">
              <span># DESCRIPTION</span>
              <span>QTY</span>
            </div>
            <div className="flex justify-between items-start pt-1">
              <div className="text-left">
                <div className="font-bold text-[#333]">1 {po.itemDescription}</div>
                <div className="text-[10px] text-gray-400 font-medium">Construction Materials</div>
                {po.notes && (
                  <div className="text-[10px] text-gray-400 italic">Note: {po.notes}</div>
                )}
              </div>
              <div className="text-right">
                <span className="font-bold text-[#333] block">{po.qty} {po.unit}</span>
                <span className={`inline-block px-2.5 py-0.5 rounded-md text-[9px] font-bold mt-1.5 uppercase ${statusColor.bg} ${statusColor.text}`}>
                  {statusDisplay}
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-8 mt-8 pt-6 border-t border-gray-200 text-center">
          <div>
            <div className="border-b border-gray-400 pb-1 font-semibold text-[13px] text-[#333] font-mono min-h-[20px]">
              {po.pickupBy || 'N/A'}
            </div>
            <div className="text-[10px] font-extrabold text-[#777] tracking-wider uppercase mt-1">PICKED UP BY</div>
          </div>
          <div>
            <div className="border-b border-gray-400 pb-1 font-semibold text-[13px] text-[#333] font-mono min-h-[20px]">
              {po.approvedBy || 'Approved by Warehouse'}
            </div>
            <div className="text-[10px] font-extrabold text-[#777] tracking-wider uppercase mt-1">APPROVED BY</div>
          </div>
        </div>

        {po.status === 'completed' && (
          <div className="mt-6 pt-6 border-t border-dashed border-gray-300">
            <h3 className="m-0 text-[10px] font-extrabold text-[#777] tracking-widest uppercase mb-3 text-left">MONITORING DETAILS</h3>
            <div className="grid grid-cols-2 gap-x-4 gap-y-3.5 text-left bg-gray-50 border border-gray-200 rounded-lg p-4 text-[11px] leading-tight">
              <div className="flex flex-col gap-0.5">
                <span className="text-[#888] font-bold text-[9px] uppercase">PO number:</span>
                <span className="text-[#333] font-semibold">{po.poNumber}</span>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-[#888] font-bold text-[9px] uppercase">Pick-up date:</span>
                <span className="text-[#333] font-semibold">{po.date}</span>
              </div>
              <div className="col-span-2 flex flex-col gap-0.5">
                <span className="text-[#888] font-bold text-[9px] uppercase">Item Description:</span>
                <span className="text-[#333] font-semibold">{po.itemDescription}</span>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-[#888] font-bold text-[9px] uppercase">Qty. rvd:</span>
                <span className="text-[#333] font-semibold">{po.qty}</span>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-[#888] font-bold text-[9px] uppercase">Unit:</span>
                <span className="text-[#333] font-semibold">{po.unit}</span>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-[#888] font-bold text-[9px] uppercase">Delivered By:</span>
                <span className="text-[#333] font-semibold">{po.pickupBy || 'Warehouse Staff'}</span>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-[#888] font-bold text-[9px] uppercase">Date delivered:</span>
                <span className="text-[#333] font-semibold">{po.poExpDate || po.date}</span>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-[#888] font-bold text-[9px] uppercase">Reference No.</span>
                <span className="text-[#333] font-semibold">DR-{po.poNumber}</span>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-[#888] font-bold text-[9px] uppercase">DR date:</span>
                <span className="text-[#333] font-semibold">{po.date}</span>
              </div>
              <div className="col-span-2 flex flex-col gap-0.5 border-t border-gray-200/60 pt-2 mt-1">
                <span className="text-[#888] font-bold text-[9px] uppercase">Pick-up By:</span>
                <span className="text-[#333] font-semibold">{po.pickupBy}</span>
              </div>
            </div>
          </div>
        )}

        <div className="text-center mt-6 text-[10px] text-gray-400 font-bold uppercase tracking-wider">
          CARWILL CONSTRUCTION INC. &bull; {po.mrsNo || 'MRS-001'} &bull; {po.poNumber || 'PO-001'}
        </div>

        {error && (
          <div className="mb-4 px-4 py-2.5 rounded-lg text-xs font-medium bg-[#ffebee] text-[#c62828] border border-[#ef9a9a]">
            {error}
          </div>
        )}

        <div className="flex justify-center gap-3 mt-6 pt-4 border-t border-gray-100 no-print">
          {isSuperadmin && (
            <button
              type="button"
              className="py-2.5 px-6 rounded-md text-xs font-bold cursor-pointer transition-all duration-200 bg-[#d32f2f] text-white border-none hover:bg-[#b71c1c] flex-1 disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={handleDeletePO}
              disabled={deleting}
            >
              {deleting ? 'Deleting…' : 'Delete PO'}
            </button>
          )}
          <button
            type="button"
            className="py-2.5 px-6 rounded-md text-xs font-bold cursor-pointer transition-all duration-200 bg-white text-[#555] border border-gray-300 hover:bg-gray-50 flex-1"
            onClick={onClose}
          >
            Close
          </button>
          <button
            type="button"
            className="py-2.5 px-6 rounded-md text-xs font-bold cursor-pointer transition-all duration-200 bg-[#1e2d3b] text-white border-none hover:bg-[#2c3e50] flex-1 flex items-center justify-center gap-1.5"
            onClick={() => window.print()}
          >
            Print Receipt
          </button>
        </div>

      </div>
    </div>
  );
}

export default MaterialRequestReceipt;