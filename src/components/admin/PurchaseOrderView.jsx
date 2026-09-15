'use client';
import React, { useState, useEffect, useMemo, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import StatCard from '../ui/StatCard';
import SearchInput from '../ui/SearchInput';
import EmptyState from '../ui/EmptyState';
import MaterialRequestReceipt from '../shared/MaterialRequestReceipt';
import POQuantityTracker from '../shared/POQuantityTracker';
import POCreationForm from './POCreationForm';
import PurchaseWorkflowModal from './PurchaseWorkflowModal';
import StatusBadge from '../ui/StatusBadge';
import PageSkeleton from '../ui/PageSkeleton';
import TableScrollSentinel from '../ui/TableScrollSentinel';
import { useAdminData } from '../../context/AdminDataContext';
import { getPOs } from '../../../actions/pos';
import { useInfiniteRows } from '../../hooks/useInfiniteRows';
import { IN_PROGRESS_STATUSES } from '../../lib/deliveryStatus';

function PurchaseOrderContent() {
  const { stats, poVersion, deletePO, getPOQuantityTracker } = useAdminData();
  const searchParams = useSearchParams();
  const [selectedPoType, setSelectedPoType] = useState('all');
  const [poSearchInput, setPoSearchInput] = useState('');
  const [poSearchQuery, setPoSearchQuery] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [selectedReceiptPo, setSelectedReceiptPo] = useState(null);
  const [showReceiptModal, setShowReceiptModal] = useState(false);
  const [workflowPoNumber, setWorkflowPoNumber] = useState(null);
  const [trackerPoNumber, setTrackerPoNumber] = useState(null);
  const [trackerData, setTrackerData] = useState(null);
  const [trackerError, setTrackerError] = useState(null);

  const openTracker = (poNumber) => {
    setTrackerPoNumber(poNumber);
    setTrackerData(null);
    setTrackerError(null);
    getPOQuantityTracker(poNumber)
      .then((t) => setTrackerData(t))
      .catch((e) => setTrackerError(e?.message || 'Failed to load tracker'));
  };

  const [initialFormData, setInitialFormData] = useState(null);

  useEffect(() => {
    const t = setTimeout(() => setPoSearchQuery(poSearchInput), 300);
    return () => clearTimeout(t);
  }, [poSearchInput]);

  const queryParams = useMemo(() => ({
    ...(selectedPoType === 'all'
      ? {}
      : selectedPoType === 'in-progress'
        ? { statusIn: IN_PROGRESS_STATUSES }
        : selectedPoType === 'discrepancy'
          ? { hasReceivingDiscrepancy: true }
          : { poType: selectedPoType }),
    search: poSearchQuery || undefined,
  }), [selectedPoType, poSearchQuery]);

  const { rows: purchaseOrders, total, initialLoading, loadingMore, hasMore, loadMore } =
    useInfiniteRows(getPOs, queryParams, poVersion);

  useEffect(() => {
    if (searchParams.get('openPOModal') === 'true') {
      let items = [];
      let itemApprovals = [];
      try { items = JSON.parse(searchParams.get('items') || '[]'); } catch { items = []; }
      try { itemApprovals = JSON.parse(searchParams.get('itemApprovals') || '[]'); } catch { itemApprovals = []; }
      setInitialFormData({
        items,
        itemApprovals,
        requisitioner: searchParams.get('requisitioner') || '',
        mrsNo: searchParams.get('mrsNo') || '',
        sourceReqNumber: searchParams.get('reqNumber') || null,
        sourceRequestWarehouse: searchParams.get('requestWarehouse') || '',
        approvedBy: searchParams.get('approvedBy') || '',
        approvalDate: searchParams.get('approvalDate') || '',
      });
      setShowModal(true);
    }
  }, [searchParams]);

  const handleOpenReceipt = (po) => {
    setSelectedReceiptPo(po);
    setShowReceiptModal(true);
  };

  const handleSuccess = () => {
    setShowSuccessModal(true);
  };

  const handleModalClose = () => {
    setShowModal(false);
    setInitialFormData(null);
  };

  if (initialLoading) {
    return (
      <div className="bg-white rounded-lg p-6">
        <PageSkeleton />
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg p-6">
      <div className="mb-8">
        <h1 className="m-0 text-3xl max-md:text-2xl text-[#333] font-bold">Purchase Orders</h1>
        <p className="mt-2 mx-0 mb-0 text-sm text-[#666]">Manage and track material requisitions</p>
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(250px,1fr))] max-md:grid-cols-1 gap-5 mb-8">
        <StatCard label="Total POs" count={stats.totalPOs} description="All purchase orders" color="blue" isActive={selectedPoType === 'all'} onClick={() => setSelectedPoType('all')} />
        <StatCard label="In Progress" count={stats.inProgressCount} description="Orders moving through procurement" color="green" isActive={selectedPoType === 'in-progress'} onClick={() => setSelectedPoType('in-progress')} />
        <StatCard label="Discrepancies" count={stats.unifiedDiscrepancyCount || 0} description="Orders with receiving discrepancies" color="red" isActive={selectedPoType === 'discrepancy'} onClick={() => setSelectedPoType('discrepancy')} />
      </div>

      <div className="mb-6">
        <button className="bg-white text-[#0288d1] border-2 border-[#7ec8e3] py-2.5 px-5 rounded-md text-sm font-semibold cursor-pointer transition-all duration-300 inline-flex items-center gap-2 hover:bg-[#f0f8fc] hover:border-[#0288d1] hover:-translate-y-0.5 hover:shadow-[0_2px_8px_rgba(2,136,209,0.15)] active:translate-y-0" onClick={() => setShowModal(true)}>
          New purchase order
        </button>
      </div>

      <div className="mt-8">
        <div className="mb-4">
          <h2 className="m-0 text-lg text-[#333] font-bold">
            {selectedPoType === 'all' ? 'All Purchase Orders' : selectedPoType === 'in-progress' ? 'In Progress' : 'Discrepancies'}
          </h2>
          <p className="mt-1 mx-0 mb-0 text-[13px] text-[#999]">
            {selectedPoType === 'all' ? 'All purchase orders' : selectedPoType === 'in-progress' ? 'Purchase orders still moving through procurement' : 'Purchase orders with identified discrepancies'}
          </p>
        </div>
        <SearchInput placeholder="Search PO number..." value={poSearchInput} onChange={(e) => setPoSearchInput(e.target.value)} />
        <div className="mt-4 border border-[#e0e0e0] rounded-lg overflow-hidden">
          <div className="overflow-x-auto max-h-[500px]">
            <table className="w-full border-collapse text-[13px]">
              <thead className={`bg-gradient-to-r sticky top-0 z-10 ${selectedPoType === 'all' ? 'from-[#e3f2fd] to-[#bbdefb]' : selectedPoType === 'in-progress' ? 'from-[#e8f5e9] to-[#c8e6c9]' : 'from-[#fef5f5] to-[#ffcdd2]'}`}>
                <tr>
                  {['PO date', 'PO number', 'Item Description', 'Qty', 'Unit', 'Supplier Name', 'Requisitioner', 'MRS No.', 'PO red date', 'Pick-up by', 'Status', 'Action'].map((h, i) => (
                    <th key={i} className={`p-4 text-left font-bold whitespace-nowrap ${selectedPoType === 'all' ? 'text-[#1e3c72] border-b-2 border-[#1e3c72]/30' : selectedPoType === 'in-progress' ? 'text-[#2e7d32] border-b-2 border-[#2e7d32]/30' : 'text-[#c62828] border-b-2 border-[#c62828]/30'}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {purchaseOrders.length > 0 ? (
                  <>
                    {purchaseOrders.map((order, index) => {
                      const items = order.items || [];
                      const itemSummary = items.length ? `${items[0].itemDescription}${items.length > 1 ? ` +${items.length - 1} more` : ''}` : '—';
                      const totalQty = items.reduce((s, it) => s + it.qty, 0);
                      const unitSummary = items.length === 1 ? items[0].unit : (items.length ? 'various' : '—');
                      return (
                      <tr key={index} onClick={() => handleOpenReceipt(order)}
                        className={`border-b border-gray-200 transition-colors duration-150 cursor-pointer ${index % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'} hover:bg-[#f4fbf7]/50`}>
                        <td className="p-4 text-[#333] font-medium whitespace-nowrap">{order.date}</td>
                        <td className="p-4 text-[#333] font-medium whitespace-nowrap">{order.poNumber}</td>
                        <td className="p-4 text-[#333] font-medium">{itemSummary}</td>
                        <td className="p-4 text-[#333] font-medium whitespace-nowrap">{totalQty}</td>
                        <td className="p-4 text-[#333] font-medium whitespace-nowrap">{unitSummary}</td>
                        <td className="p-4 text-[#333] font-medium">{order.supplier}</td>
                        <td className="p-4 text-[#333] font-medium">{order.requisitioner}</td>
                        <td className="p-4 text-[#333] font-medium whitespace-nowrap">{order.mrsNo}</td>
                        <td className="p-4 text-[#333] font-medium whitespace-nowrap">{order.poExpDate}</td>
                        <td className="p-4 text-[#333] font-medium whitespace-nowrap">{order.pickupBy}</td>
                        <td className="p-4 whitespace-nowrap"><StatusBadge status={order.statusLabel || order.status} /></td>
                        <td className="p-4 whitespace-nowrap">
                          <button
                            onClick={(e) => { e.stopPropagation(); setWorkflowPoNumber(order.poNumber); }}
                            className="bg-white text-[#006680] border border-[#80c0d0] px-3 py-1.5 rounded-md text-xs font-semibold cursor-pointer transition-all duration-200 hover:bg-[#e8f4f6] hover:border-[#006680]"
                          >
                            Manage
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); openTracker(order.poNumber); }}
                            className="ml-2 bg-white text-[#555] border border-[#ccc] px-3 py-1.5 rounded-md text-xs font-semibold cursor-pointer transition-all duration-200 hover:bg-[#f5f5f5]"
                          >
                            Tracker
                          </button>
                        </td>
                      </tr>
                      );
                    })}
                    <TableScrollSentinel colSpan={12} onLoadMore={loadMore} isLoadingMore={loadingMore} disabled={!hasMore} />
                  </>
                ) : (
                  <EmptyState colSpan={12} message="No purchase orders found" />
                )}
              </tbody>
            </table>
          </div>
        </div>
        <p className="mt-2 text-right text-xs text-[#999]">Loaded {purchaseOrders.length} of {total} purchase orders</p>
      </div>

      {showModal && (
        <POCreationForm onClose={handleModalClose} onSuccess={handleSuccess} initialData={initialFormData} />
      )}

      {showSuccessModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-[1000] animate-fade-in">
          <div className="bg-white rounded-xl w-full max-w-[380px] text-center py-8 px-6 shadow-[0_10px_30px_rgba(0,0,0,0.15)] animate-slide-in">
            <div className="flex flex-col items-center gap-3">
              <div className="bg-[#e8f5e9] text-[#2e7d32] text-3xl w-16 h-16 rounded-full flex items-center justify-center mb-3 border-2 border-[#a5d6a7] font-bold">&#10003;</div>
              <h3 className="m-0 text-lg text-[#333] font-bold">Successfully Added</h3>
              <p className="m-0 text-[13px] text-[#666] leading-relaxed mb-4">The purchase order has been successfully added as Awaiting Purchase.</p>
              <button className="bg-[#2e7d32] text-white border-none py-2.5 px-8 rounded-md text-sm font-semibold cursor-pointer transition-all duration-200 min-w-[100px] hover:bg-[#1b5e20] hover:shadow-[0_2px_8px_rgba(46,125,50,0.3)] hover:-translate-y-0.5" onClick={() => setShowSuccessModal(false)}>OK</button>
            </div>
          </div>
        </div>
      )}

      {showReceiptModal && selectedReceiptPo && (
        <MaterialRequestReceipt po={selectedReceiptPo} onDelete={deletePO} onClose={() => { setShowReceiptModal(false); setSelectedReceiptPo(null); }} />
      )}

      {workflowPoNumber && (
        <PurchaseWorkflowModal poNumber={workflowPoNumber} onClose={() => setWorkflowPoNumber(null)} />
      )}

      {trackerPoNumber && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-[1000] overflow-y-auto py-6 px-4">
          <div className="bg-white rounded-xl w-full max-w-[720px] max-h-[90vh] overflow-y-auto shadow-[0_10px_30px_rgba(0,0,0,0.15)] p-6 text-left">
            <div className="flex justify-between items-center border-b border-[#eee] pb-3 mb-5">
              <h2 className="m-0 text-lg font-bold text-[#333]">Quantity Tracker — {trackerPoNumber}</h2>
              <button className="text-2xl text-[#888]" onClick={() => { setTrackerPoNumber(null); setTrackerData(null); }}>&times;</button>
            </div>
            {trackerError && <p className="text-[13px] text-[#c62828]">{trackerError}</p>}
            {!trackerError && <POQuantityTracker tracker={trackerData} variant="purchaser" />}
            <div className="flex justify-end gap-3 mt-4 pt-4 border-t border-[#eee]">
              <button onClick={() => { setTrackerPoNumber(null); setTrackerData(null); }} className="py-2.5 px-6 bg-white text-[#333] border border-[#ccc] rounded-md">Close</button>
              <button onClick={() => { setTrackerPoNumber(null); setTrackerData(null); setWorkflowPoNumber(trackerPoNumber); }} className="py-2.5 px-6 bg-[#006680] text-white rounded-md">Open Workflow</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PurchaseOrderView() {
  return (
    <Suspense fallback={<div className="p-6"><PageSkeleton /></div>}>
      <PurchaseOrderContent />
    </Suspense>
  );
}

export default PurchaseOrderView;
