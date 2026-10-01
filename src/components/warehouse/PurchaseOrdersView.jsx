'use client';
import React, { useState, useEffect, useMemo } from 'react';
import StatCard from '../ui/StatCard';
import SearchInput from '../ui/SearchInput';
import EmptyState from '../ui/EmptyState';
import ReceivePOForm from './ReceivePOForm';
import StatusBadge from '../ui/StatusBadge';
import PageSkeleton from '../ui/PageSkeleton';
import TableScrollSentinel from '../ui/TableScrollSentinel';
import { useWarehouseData } from '../../context/WarehouseDataContext';
import { getPOs } from '../../../actions/pos';
import { useInfiniteRows } from '../../hooks/useInfiniteRows';
import { PO_STATUS, IN_PROGRESS_STATUSES } from '../../lib/deliveryStatus';

// Warehouse focus: Requests, Receiving Due (purchased > received), Completed.
// Purchasing Follow-Up is a Purchaser responsibility — never shown here as an action.
function PurchaseOrdersView() {
  const { receivingDueCount, poVersion, receivingDue, getSimplifiedTracker } = useWarehouseData();
  const [selectedTab, setSelectedTab] = useState('receiving');
  const [poSearchInput, setPoSearchInput] = useState('');
  const [poSearchQuery, setPoSearchQuery] = useState('');
  const [receivePoNumber, setReceivePoNumber] = useState(null);
  const [trackerPoNumber, setTrackerPoNumber] = useState(null);
  const [trackerData, setTrackerData] = useState(null);

  useEffect(() => {
    const t = setTimeout(() => setPoSearchQuery(poSearchInput), 300);
    return () => clearTimeout(t);
  }, [poSearchInput]);

  const queryParams = useMemo(() => ({
    ...(selectedTab === 'receiving' ? { status: PO_STATUS.ON_DELIVERY.value } : selectedTab === 'completed' ? { status: 'completed' } : { statusIn: IN_PROGRESS_STATUSES }),
    search: poSearchQuery || undefined,
  }), [selectedTab, poSearchQuery]);

  const { rows: purchaseOrders, total, initialLoading, loadingMore, hasMore, loadMore } =
    useInfiniteRows(getPOs, queryParams, poVersion);

  const openTracker = async (poNumber) => {
    setTrackerPoNumber(poNumber);
    try {
      setTrackerData(await getSimplifiedTracker(poNumber));
    } catch { setTrackerData(null); }
  };

  if (initialLoading) return <div className="bg-white rounded-lg p-6"><PageSkeleton /></div>;

  return (
    <div className="bg-white rounded-lg p-6">
      <h1 className="m-0 text-3xl text-[#333] font-bold">Purchase Orders</h1>
      <p className="mt-2 text-sm text-[#666]">Confirm what arrived. Receiving records quantity + remarks only.</p>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-5 my-6">
        <StatCard label="Receiving Due" count={receivingDueCount} color="yellow" isActive={selectedTab === 'receiving'} onClick={() => setSelectedTab('receiving')} />
        <StatCard label="In Progress" count={purchaseOrders.length} color="blue" isActive={selectedTab === 'progress'} onClick={() => setSelectedTab('progress')} />
        <StatCard label="Completed" count={total} color="green" isActive={selectedTab === 'completed'} onClick={() => setSelectedTab('completed')} />
      </div>
      {receivingDue.length > 0 && selectedTab === 'receiving' && (
        <div className="mb-4 p-3 bg-[#fff8e1] border border-[#ffcc80] rounded text-xs">
          {receivingDue.length} PO(s) with purchased items awaiting receiving: {receivingDue.map((t) => t.poNumber).join(', ')}
        </div>
      )}
      <SearchInput placeholder="Search PO number..." value={poSearchInput} onChange={(e) => setPoSearchInput(e.target.value)} />
      <div className="mt-4 border rounded overflow-hidden">
        <table className="w-full text-[13px]">
          <thead><tr className="text-left text-[#666]">
            {['PO date', 'PO number', 'Supplier', 'MRS No.', 'Status', 'Action'].map((h) => <th key={h} className="p-3">{h}</th>)}
          </tr></thead>
          <tbody>
            {purchaseOrders.length > 0 ? purchaseOrders.map((order) => (
              <tr key={order.poNumber} className="border-t">
                <td className="p-3">{order.date}</td>
                <td className="p-3 font-medium">{order.poNumber}</td>
                <td className="p-3">{order.supplier}</td>
                <td className="p-3">{order.mrsNo}</td>
                <td className="p-3"><StatusBadge status={order.statusLabel || order.status} /></td>
                <td className="p-3 flex gap-2">
                  <button className="text-[#006680] font-semibold" onClick={() => openTracker(order.poNumber)}>View</button>
                  {(order.status === PO_STATUS.ON_DELIVERY.value || order.status === PO_STATUS.PURCHASE_CONFIRMED.value) && (
                    <button className="text-[#006680] font-semibold" onClick={() => setReceivePoNumber(order.poNumber)}>Receive</button>
                  )}
                </td>
              </tr>
            )) : <EmptyState colSpan={6} message="No purchase orders found" />}
            <TableScrollSentinel colSpan={6} onLoadMore={loadMore} isLoadingMore={loadingMore} disabled={!hasMore} />
          </tbody>
        </table>
      </div>
      {trackerPoNumber && trackerData && (
        <div className="mt-4 border rounded p-4">
          <h3 className="font-bold text-sm">Expected vs arrived — {trackerPoNumber}</h3>
          <table className="w-full text-[13px] mt-2">
            <thead><tr className="text-left text-gray-500">{['Item', 'Purchased', 'Received', 'Outstanding'].map((h) => <th key={h} className="py-1">{h}</th>)}</tr></thead>
            <tbody>
              {trackerData.items.map((i) => (
                <tr key={i.poItemId} className="border-t"><td className="py-1">{i.itemDescription}</td><td className="py-1">{i.purchasedQty}</td><td className="py-1">{i.receivedQty}</td><td className="py-1">{i.outstanding}</td></tr>
              ))}
            </tbody>
          </table>
          <button className="mt-2 text-sm" onClick={() => { setTrackerPoNumber(null); setTrackerData(null); }}>Close</button>
        </div>
      )}
      {receivePoNumber && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[1000] p-4">
          <div className="bg-white rounded-xl max-w-[560px] w-full max-h-[90vh] overflow-auto">
            <ReceivePOForm poNumber={receivePoNumber} onClose={() => setReceivePoNumber(null)} />
          </div>
        </div>
      )}
    </div>
  );
}

export default PurchaseOrdersView;
