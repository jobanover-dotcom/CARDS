'use client';
import React, { useState } from 'react';
import StatusBadge from '../ui/StatusBadge';
import EmptyState from '../ui/EmptyState';
import MaterialRequestReceipt from '../shared/MaterialRequestReceipt';
import { useAdminData } from '../../context/AdminDataContext';

function HistoryView() {
  const { purchaseOrders, warehouseRequests } = useAdminData();
  const [historyTab, setHistoryTab] = useState('purchase-orders');
  const [historySearchQuery, setHistorySearchQuery] = useState('');
  const [selectedStatus, setSelectedStatus] = useState('');
  const [appliedFilters, setAppliedFilters] = useState({
    completed: false, incomplete: false, activeDelivery: false, inProcess: false,
    approved: false, pending: false, rejected: false,
  });
  const [selectedReceiptPo, setSelectedReceiptPo] = useState(null);
  const [showReceiptModal, setShowReceiptModal] = useState(false);
  const [showRemarksModal, setShowRemarksModal] = useState(false);
  const [remarksToDisplay, setRemarksToDisplay] = useState('');

  const handleOpenReceipt = (po) => {
    setSelectedReceiptPo(po);
    setShowReceiptModal(true);
  };

  const handleViewRejectedRemarks = (req) => {
    setRemarksToDisplay(req.remarks);
    setShowRemarksModal(true);
  };

  let filteredHistoryPOs = purchaseOrders.filter(order => {
    if (historySearchQuery && !order.poNumber.includes(historySearchQuery) && !order.itemDescription.toLowerCase().includes(historySearchQuery.toLowerCase())) return false;
    const poFilters = ['completed', 'incomplete', 'activeDelivery', 'inProcess'];
    const activeCount = poFilters.filter(k => appliedFilters[k]).length;
    if (activeCount > 0) {
      let match = false;
      if (appliedFilters.activeDelivery && order.poType === 'active-delivery') match = true;
      if (appliedFilters.inProcess && order.status === 'incomplete' && order.poType === 'active-delivery') match = true;
      if (appliedFilters.incomplete && order.status === 'incomplete') match = true;
      if (appliedFilters.completed && order.status === 'completed') match = true;
      if (!match) return false;
    }
    return true;
  });

  let filteredHistoryReqs = warehouseRequests.filter(req => {
    if (historySearchQuery && !req.mrsNo.includes(historySearchQuery) && !req.itemDescription.toLowerCase().includes(historySearchQuery.toLowerCase())) return false;
    const reqFilters = ['approved', 'pending', 'rejected'];
    const activeCount = reqFilters.filter(k => appliedFilters[k]).length;
    if (activeCount > 0) {
      let match = false;
      if (appliedFilters.pending && req.status === 'Pending') match = true;
      if (appliedFilters.approved && req.status === 'Approved') match = true;
      if (appliedFilters.rejected && req.status === 'Rejected') match = true;
      if (!match) return false;
    }
    return true;
  });

  return (
    <div className="flex flex-col gap-6 w-full text-slate-800">
      <div className="mb-2 text-left">
        <h1 className="m-0 text-3xl max-md:text-2xl text-[#333] font-bold">HISTORY</h1>
        <p className="mt-2 mx-0 mb-0 text-sm text-[#666]">Records and monitors all past purchase orders</p>
      </div>

      <div className="grid grid-cols-3 max-md:grid-cols-1 gap-6 mb-6 text-left">
        <div
          className={`rounded-xl p-8 cursor-pointer transition-all duration-300 transform ${
            historyTab === 'purchase-orders'
              ? 'bg-gradient-to-br from-[#e3f2fd] to-[#bbdefb] border-2 border-[#1e3c72] shadow-[0_4px_16px_rgba(30,60,114,0.15)] scale-[1.02] -translate-y-1'
              : 'bg-white border-2 border-[#e0e0e0] shadow-[0_2px_8px_rgba(0,0,0,0.06)] hover:border-[#1e3c72] hover:shadow-[0_4px_12px_rgba(30,60,114,0.12)]'
          }`}
          onClick={() => { setHistoryTab('purchase-orders'); setHistorySearchQuery(''); }}
        >
          <div className="text-base font-semibold text-slate-700 mb-2">Purchase Orders</div>
          <div className="text-5xl font-extrabold text-[#1e3c72]">{purchaseOrders.length}</div>
          <div className="text-xs text-slate-500 mt-4">All purchase orders</div>
        </div>

        <div
          className={`rounded-xl p-8 cursor-pointer transition-all duration-300 transform ${
            historyTab === 'warehouse-requests'
              ? 'bg-gradient-to-br from-[#e8f5e9] to-[#c8e6c9] border-2 border-[#2e7d32] shadow-[0_4px_16px_rgba(46,125,50,0.15)] scale-[1.02] -translate-y-1'
              : 'bg-white border-2 border-[#e0e0e0] shadow-[0_2px_8px_rgba(0,0,0,0.06)] hover:border-[#2e7d32] hover:shadow-[0_4px_12px_rgba(46,125,50,0.12)]'
          }`}
          onClick={() => { setHistoryTab('warehouse-requests'); setHistorySearchQuery(''); }}
        >
          <div className="text-base font-semibold text-slate-700 mb-2">Warehouse Requests</div>
          <div className="text-5xl font-extrabold text-[#2e7d32]">{warehouseRequests.length}</div>
          <div className="text-xs text-slate-500 mt-4">All warehouse requests</div>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-[0_2px_12px_rgba(0,0,0,0.08)] border border-gray-200 overflow-visible">
        <div className={`p-8 border-b border-gray-100 ${historyTab === 'purchase-orders' ? 'bg-gradient-to-r from-[#e8f5e9] to-[#c8e6c9]' : 'bg-gradient-to-r from-[#e3f2fd] to-[#bbdefb]'}`}>
          <div className="flex justify-between items-center max-md:flex-col max-md:align-stretch gap-4 text-left">
            <div>
              <h2 className="m-0 text-2xl font-bold text-[#333] mb-1">
                {historyTab === 'purchase-orders' ? 'Purchase Orders' : 'Warehouse Requests'}
              </h2>
              <p className="mt-0 mx-0 mb-0 text-sm text-[#999]">General History</p>
            </div>

            <div className="flex items-center gap-3 max-md:w-full">
              <div className="relative flex-1">
                <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-gray-400">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                </span>
                <input
                  type="text"
                  placeholder="Search MRS #..."
                  className="w-full pl-9 pr-4 py-2.5 border border-gray-300 rounded-lg text-[13px] placeholder:text-[#999] focus:outline-none focus:border-[#7ec8e3] focus:ring-2 focus:ring-[#7ec8e3]/10 transition-all duration-200"
                  value={historySearchQuery}
                  onChange={(e) => setHistorySearchQuery(e.target.value)}
                />
              </div>

              <select
                value={selectedStatus}
                onChange={(e) => {
                  const val = e.target.value;
                  setSelectedStatus(val);
                  const reset = { completed: false, incomplete: false, activeDelivery: false, inProcess: false, approved: false, pending: false, rejected: false };
                  if (val) reset[val] = true;
                  setAppliedFilters(reset);
                }}
                className="p-2 border rounded bg-white"
              >
                <option value="">All</option>
                {historyTab === 'purchase-orders' && (
                  <>
                    <option value="completed">Completed</option>
                    <option value="incomplete">Incomplete</option>
                    <option value="activeDelivery">Active Delivery</option>
                    <option value="inProcess">In Process</option>
                  </>
                )}
                {historyTab === 'warehouse-requests' && (
                  <>
                    <option value="approved">Approved</option>
                    <option value="pending">Pending</option>
                    <option value="rejected">Rejected</option>
                  </>
                )}
              </select>
            </div>
          </div>
        </div>

        {historyTab === 'purchase-orders' ? (
          <div className="overflow-x-auto max-h-[500px] border-t border-gray-100">
            <table className="w-full border-collapse text-[13px]">
              <thead className="bg-gradient-to-r from-[#e3f2fd] to-[#bbdefb] sticky top-0 z-20">
                <tr>
                  {['PO date', 'PO number', 'Item Description', 'Qty', 'Unit', 'Supplier Name', 'Requisitioner', 'MRS No.', 'PO rvd date', 'Pick-up by', 'Status'].map((h, i) => (
                    <th key={i} className="p-4 text-left font-bold text-[#1e3c72] border-b-2 border-[#1e3c72]/30 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredHistoryPOs.length > 0 ? (
                  filteredHistoryPOs.map((order, index) => (
                    <tr key={index} onClick={() => handleOpenReceipt(order)}
                      className={`border-b border-gray-200 transition-colors duration-150 cursor-pointer ${index % 2 === 0 ? 'bg-[#e8f5e9]' : 'bg-[#c8e6c9]'} hover:bg-[#f0f8fc]/50`}>
                      <td className="p-4 text-[#333] font-medium">{order.date}</td>
                      <td className="p-4 text-[#333] font-medium">{order.poNumber}</td>
                      <td className="p-4 text-[#333] font-medium">{order.itemDescription}</td>
                      <td className="p-4 text-[#333] font-medium">{order.qty}</td>
                      <td className="p-4 text-[#333] font-medium">{order.unit}</td>
                      <td className="p-4 text-[#333] font-medium">{order.supplier}</td>
                      <td className="p-4 text-[#333] font-medium">{order.requisitioner}</td>
                      <td className="p-4 text-[#333] font-medium">{order.mrsNo || '676767'}</td>
                      <td className="p-4 text-[#333] font-medium">{order.poExpDate || '12'}</td>
                      <td className="p-4 text-[#333] font-medium">{order.pickupBy || 'John Doe'}</td>
                      <td className="p-4">
                        <StatusBadge status={order.status === 'completed' ? 'Completed' : 'Open'} />
                      </td>
                    </tr>
                  ))
                ) : (
                  <EmptyState colSpan={11} message="No purchase orders found" />
                )}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="overflow-x-auto max-h-[500px] border-t border-gray-100">
            <table className="w-full min-w-[900px] border-collapse text-[13px]">
              <thead className="bg-gradient-to-r from-[#e8f5e9] to-[#c8e6c9] sticky top-0 z-20">
                <tr>
                  {['Request Date', 'MRS #', 'Item Description', 'Qty', 'Unit', 'MRS No.', 'Requested By', 'Requisitioner', 'Status'].map((h, i) => (
                    <th key={i} className="p-4 text-left font-bold text-[#2e7d32] border-b-2 border-[#2e7d32]/30">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredHistoryReqs.length > 0 ? (
                  filteredHistoryReqs.map((req, index) => (
                    <tr key={index}
                      className={`border-b border-gray-200 transition-colors duration-150 ${index % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'} hover:bg-[#f4fbf7]/50 ${req.status === 'Rejected' ? 'cursor-pointer' : ''}`}
                      onClick={() => { if (req.status === 'Rejected') handleViewRejectedRemarks(req); }}>
                      <td className="p-4 text-[#333] font-medium">{req.date}</td>
                      <td className="p-4 text-[#333] font-medium">{req.mrsNo}</td>
                      <td className="p-4 text-[#333] font-medium">{req.itemDescription}</td>
                      <td className="p-4 text-[#333] font-medium">{req.qty}</td>
                      <td className="p-4 text-[#333] font-medium">{req.unit}</td>
                      <td className="p-4 text-[#333] font-medium">{req.mrsNo}</td>
                      <td className="p-4 text-[#333] font-medium">{req.requestedBy}</td>
                      <td className="p-4 text-[#333] font-medium">{req.requisitioner}</td>
                      <td className="p-4"><StatusBadge status={req.status} /></td>
                    </tr>
                  ))
                ) : (
                  <EmptyState colSpan={9} message="No requests found" />
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showReceiptModal && selectedReceiptPo && (
        <MaterialRequestReceipt po={selectedReceiptPo} onClose={() => { setShowReceiptModal(false); setSelectedReceiptPo(null); }} />
      )}

      {showRemarksModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-[1000] animate-fade-in">
          <div className="bg-white rounded-xl w-full max-w-[400px] shadow-[0_10px_30px_rgba(0,0,0,0.15)] animate-slide-in p-6">
            <div className="flex justify-between items-center border-b border-[#eee] pb-3 mb-5">
              <h2 className="m-0 text-lg font-bold text-[#333] tracking-wide">Rejection Remarks</h2>
              <button className="bg-none border-none text-2xl cursor-pointer text-[#888] hover:text-[#333] transition-colors duration-200 p-1 leading-none" onClick={() => setShowRemarksModal(false)}>&times;</button>
            </div>
            <div className="flex flex-col gap-4">
              <div className="bg-[#fef5f5] border border-[#ffcdd2] rounded-lg p-4">
                <p className="m-0 text-[13px] text-[#333] leading-relaxed whitespace-pre-wrap">{remarksToDisplay}</p>
              </div>
              <button type="button" className="py-2.5 px-6 rounded-md text-sm font-semibold cursor-pointer transition-all duration-200 bg-[#d32f2f] text-white border-none hover:bg-[#b71c1c] hover:shadow-[0_2px_8px_rgba(211,47,47,0.3)]" onClick={() => setShowRemarksModal(false)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default HistoryView;
