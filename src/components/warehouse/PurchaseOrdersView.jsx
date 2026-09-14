'use client';
import React, { useState, useEffect, useMemo } from 'react';
import StatCard from '../ui/StatCard';
import SearchInput from '../ui/SearchInput';
import EmptyState from '../ui/EmptyState';
import MaterialRequestReceipt from '../shared/MaterialRequestReceipt';
import POQuantityTracker from '../shared/POQuantityTracker';
import MonitoringDetailsForm from './MonitoringDetailsForm';
import ReceiveDeliveryForm from './ReceiveDeliveryForm';
import CreateRequestModal from './CreateRequestModal';
import StatusBadge from '../ui/StatusBadge';
import PageSkeleton from '../ui/PageSkeleton';
import TableScrollSentinel from '../ui/TableScrollSentinel';
import { useWarehouseData } from '../../context/WarehouseDataContext';
import { getPOs } from '../../../actions/pos';
import { getDeliveries } from '../../../actions/deliveries';
import { getFollowUpMap } from '../../../actions/requests';
import { useInfiniteRows } from '../../hooks/useInfiniteRows';

const OPEN_DELIVERY_STATUSES = ['for_delivery', 'in_transit', 'partially_received'];

// Legacy single-shot receiving applies only to old records that never entered
// the V1 procurement workflow. New procurement states are read-only here;
// warehouse acts on deliveries instead.
function isLegacyReceivable(order) {
  return order.status === 'incomplete' && order.poType === 'active-delivery';
}

function PurchaseOrdersView() {
  const { completedCount, partiallyReceivedCount, openDeliveryCount: v1OpenCount, poVersion, getWarehouseV1Partials, getPOQuantityTracker } = useWarehouseData();
  const [selectedPoType, setSelectedPoType] = useState('deliveries');
  const [poSearchInput, setPoSearchInput] = useState('');
  const [poSearchQuery, setPoSearchQuery] = useState('');
  const [selectedReceiptPo, setSelectedReceiptPo] = useState(null);
  const [showReceiptModal, setShowReceiptModal] = useState(false);
  const [showMonitoringModal, setShowMonitoringModal] = useState(false);
  const [selectedMonitoringPo, setSelectedMonitoringPo] = useState(null);
  const [receiveDeliveryNumber, setReceiveDeliveryNumber] = useState(null);
  const [openDeliveryCount, setOpenDeliveryCount] = useState(0);
  const [v1Partials, setV1Partials] = useState([]);
  const [v1PartialsError, setV1PartialsError] = useState(null);
  const [trackerPoNumber, setTrackerPoNumber] = useState(null);
  const [trackerData, setTrackerData] = useState(null);
  const [trackerError, setTrackerError] = useState(null);

  const isDeliveries = selectedPoType === 'deliveries';
  const [followUpPoModal, setFollowUpPoModal] = useState(false);
  const [poForFollowUp, setPoForFollowUp] = useState(null);
  const [followUpBalance, setFollowUpBalance] = useState(null);
  const [followUpMap, setFollowUpMap] = useState({});

  useEffect(() => {
    const t = setTimeout(() => setPoSearchQuery(poSearchInput), 300);
    return () => clearTimeout(t);
  }, [poSearchInput]);

  const queryParams = useMemo(() => {
    if (isDeliveries) return { statusIn: OPEN_DELIVERY_STATUSES };
    // No 'active-delivery' tab: Open Deliveries is the single delivery-workload
    // view. Legacy exception records (partially-received + discrepancy poType)
    // stay visible together under Partially Received.
    return {
      ...(selectedPoType === 'completed'
        ? { status: 'completed' }
        : { status: 'incomplete', poTypeIn: ['partially-received', 'discrepancy'] }),
      search: poSearchQuery || undefined,
    };
  }, [selectedPoType, poSearchQuery, isDeliveries]);

  const fetcher = useMemo(() => (isDeliveries ? getDeliveries : getPOs), [isDeliveries]);

  const { rows, total, initialLoading, loadingMore, hasMore, loadMore } =
    useInfiniteRows(fetcher, queryParams, poVersion);
  const purchaseOrders = isDeliveries ? [] : rows;
  const deliveries = isDeliveries ? rows : [];

  useEffect(() => {
    let cancelled = false;
    getDeliveries({ statusIn: OPEN_DELIVERY_STATUSES, limit: 1 })
      .then((res) => { if (!cancelled) setOpenDeliveryCount(res.total); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [poVersion]);

  const displayOpenCount = v1OpenCount || openDeliveryCount;

  const openTracker = (poNumber) => {
    setTrackerPoNumber(poNumber);
    setTrackerData(null);
    setTrackerError(null);
    getPOQuantityTracker(poNumber)
      .then((t) => setTrackerData(t))
      .catch((e) => setTrackerError(e?.message || 'Failed to load tracker'));
  };

  useEffect(() => {
    if (selectedPoType !== 'partially-received') return;
    let cancelled = false;
    // Server-computed V1 balances only — the UI never derives these itself.
    getWarehouseV1Partials()
      .then((rows) => { if (!cancelled) { setV1Partials(rows); setV1PartialsError(null); } })
      .catch((e) => { if (!cancelled) setV1PartialsError(e?.message || 'Failed to load delivery shortfalls'); });
    return () => { cancelled = true; };
  }, [selectedPoType, poVersion, getWarehouseV1Partials]);

  useEffect(() => {
    const numbers = [...purchaseOrders.map((o) => o.poNumber), ...v1Partials.map((p) => p.poNumber)];
    if (numbers.length === 0) return;
    let cancelled = false;
    getFollowUpMap(numbers, 'po')
      .then((map) => { if (!cancelled) setFollowUpMap(map); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [purchaseOrders, v1Partials, poVersion]);

  const handleOpenReceipt = (po) => {
    setSelectedReceiptPo(po);
    setShowReceiptModal(true);
  };

  const handleOpenMonitoring = (po) => {
    setSelectedMonitoringPo(po);
    setShowMonitoringModal(true);
  };

  const handleFileFollowUpFromPo = (po) => {
    const totalOrdered = (po.items || []).reduce((s, it) => s + it.qty, 0);
    const received = parseInt(po.monQtyRvd) || 0;
    const shortfall = Math.max(0, totalOrdered - received);
    if (shortfall > 0) {
      setPoForFollowUp(po);
      setFollowUpPoModal(true);
    }
  };

  if (initialLoading) {
    return (
      <div className="bg-white rounded-lg p-6 text-left">
        <PageSkeleton statCards={3} />
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg p-6 text-left">
      <div className="mb-8">
        <h1 className="m-0 text-3xl max-md:text-2xl text-[#333] font-bold">Purchase Orders</h1>
        <p className="mt-2 mx-0 mb-0 text-sm text-[#666]">Manage and track material requisitions</p>
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(250px,1fr))] max-md:grid-cols-1 gap-5 mb-8">
        <div
          className={`border-2 rounded-xl p-8 text-center cursor-pointer transition-all duration-300 transform ${
            selectedPoType === 'deliveries'
              ? 'bg-gradient-to-br from-[#e0f2f1] to-[#b2dfdb] border-2 border-[#006680] shadow-[0_4px_16px_rgba(0,102,128,0.15)] scale-[1.02] -translate-y-1'
              : 'bg-white border-2 border-[#e0e0e0] shadow-[0_2px_8px_rgba(0,0,0,0.06)] hover:border-[#006680]'
          }`}
          onClick={() => setSelectedPoType('deliveries')}
        >
          <h3 className="m-0 text-sm text-[#666] font-semibold mb-3">Open Deliveries</h3>
          <div className="text-5xl font-bold text-[#006680]">{displayOpenCount}</div>
        </div>
        <div
          className={`border-2 rounded-xl p-8 text-center cursor-pointer transition-all duration-300 transform ${
            selectedPoType === 'partially-received'
              ? 'bg-gradient-to-br from-[#fff3e0] to-[#ffe0b2] border-2 border-[#ef6c00] shadow-[0_4px_16px_rgba(239,108,0,0.15)] scale-[1.02] -translate-y-1'
              : 'bg-white border-2 border-[#e0e0e0] shadow-[0_2px_8px_rgba(0,0,0,0.06)] hover:border-[#ef6c00]'
          }`}
          onClick={() => setSelectedPoType('partially-received')}
        >
          <h3 className="m-0 text-sm text-[#666] font-semibold mb-3">Partially Received</h3>
          <div className="text-5xl font-bold text-[#ef6c00]">{partiallyReceivedCount}</div>
        </div>
        <div
          className={`border-2 rounded-xl p-8 text-center cursor-pointer transition-all duration-300 transform ${
            selectedPoType === 'completed'
              ? 'bg-gradient-to-br from-[#e3f2fd] to-[#bbdefb] border-2 border-[#1e3c72] shadow-[0_4px_16px_rgba(30,60,114,0.15)] scale-[1.02] -translate-y-1'
              : 'bg-white border-2 border-[#e0e0e0] shadow-[0_2px_8px_rgba(0,0,0,0.06)] hover:border-[#1e3c72]'
          }`}
          onClick={() => setSelectedPoType('completed')}
        >
          <h3 className="m-0 text-sm text-[#666] font-semibold mb-3">Completed</h3>
          <div className="text-5xl font-bold text-[#1e3c72]">{completedCount}</div>
        </div>
      </div>

      <div className="mt-8">
        <div className="mb-4">
          <h2 className="m-0 text-lg text-[#333] font-bold">
            {selectedPoType === 'completed' ? 'Completed' : selectedPoType === 'partially-received' ? 'Partially Received' : 'Open Deliveries'}
          </h2>
          <p className="mt-1 mx-0 mb-0 text-[13px] text-[#999]">
            {selectedPoType === 'completed' ? 'Successful Deliveries' : selectedPoType === 'partially-received' ? 'Short deliveries ready for follow-up' : 'Shipments awaiting warehouse receiving — click a row to receive'}
          </p>
        </div>

        <SearchInput
          placeholder={isDeliveries ? 'Deliveries are listed newest first' : 'Search PO number...'}
          value={poSearchInput}
          onChange={(e) => setPoSearchInput(e.target.value)}
          disabled={isDeliveries}
        />

        {isDeliveries ? (
        <div className="mt-4 border border-[#e0e0e0] rounded-lg overflow-hidden">
          <div className="overflow-x-auto max-h-[500px]">
            <table className="w-full border-collapse text-[13px]">
              <thead className="bg-[#e0f2f1] sticky top-0 z-10">
                <tr>
                  {['Delivery No.', 'PO No.', 'Supplier', 'Supplier DR', 'Status', 'Items', 'Delivered', 'Received'].map((h, i) => (
                    <th key={i} className="p-4 text-left font-bold text-[#006680] border-b border-[#006680]/20 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {deliveries.length > 0 ? (
                  <>
                    {deliveries.map((d, index) => {
                      const items = d.items || [];
                      const itemSummary = items.length ? `${items[0].poItem?.itemDescription || '—'}${items.length > 1 ? ` +${items.length - 1} more` : ''}` : '—';
                      const delivered = items.reduce((s, it) => s + it.deliveredQty, 0);
                      const received = items.reduce((s, it) => s + it.receivedQty, 0);
                      return (
                      <tr key={d.id || index}
                        onClick={() => setReceiveDeliveryNumber(d.deliveryNumber)}
                        className={`border-b border-gray-200 transition-colors duration-150 cursor-pointer hover:bg-[#e0f2f1]/50 ${index % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}`}>
                        <td className="p-4 text-[#333] font-medium whitespace-nowrap">
                          <a
                            href={`/warehouse/deliveries/${d.deliveryNumber}`}
                            onClick={(e) => e.stopPropagation()}
                            className="text-[#006680] font-semibold"
                          >
                            {d.deliveryNumber}
                          </a>
                        </td>
                        <td className="p-4 text-[#333] font-medium whitespace-nowrap">{d.poNumber}</td>
                        <td className="p-4 text-[#333] font-medium">{d.supplier}</td>
                        <td className="p-4 text-[#333] font-medium whitespace-nowrap">{d.supplierDrNumber || '—'}</td>
                        <td className="p-4 whitespace-nowrap"><StatusBadge status={d.statusLabel || d.status} /></td>
                        <td className="p-4 text-[#333] font-medium">{itemSummary}</td>
                        <td className="p-4 text-[#333] font-medium whitespace-nowrap">{delivered}</td>
                        <td className="p-4 text-[#333] font-medium whitespace-nowrap">{received}</td>
                      </tr>
                      );
                    })}
                    <TableScrollSentinel colSpan={8} onLoadMore={loadMore} isLoadingMore={loadingMore} disabled={!hasMore} />
                  </>
                ) : (
                  <EmptyState colSpan={8} message="No open deliveries" />
                )}
              </tbody>
            </table>
          </div>
        </div>
        ) : (
        <>
        {selectedPoType === 'partially-received' && (
        <div className="mt-4 border border-[#ffcc80] rounded-lg overflow-hidden mb-4">
          <div className="bg-[#fff8e1] px-4 py-2 text-[12px] font-bold text-[#8d6e00]">Delivery shortfalls — quantities from delivery records (Requested → Approved → Purchased → Delivered → Received)</div>
          <div className="overflow-x-auto max-h-[500px]">
            <table className="w-full border-collapse text-[13px]">
              <thead className="bg-[#fff3e0] sticky top-0 z-10">
                <tr>
                  {['PO number', 'Item', 'Requested', 'Approved', 'Purchased', 'Delivered', 'Received', 'Outstanding', 'Action'].map((h, i) => (
                    <th key={i} className="p-4 text-left font-bold text-[#ef6c00] border-b border-[#ef6c00]/20 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {v1PartialsError ? (
                  <tr><td colSpan={9} className="p-4 text-[#c62828] text-xs font-semibold">{v1PartialsError}</td></tr>
                ) : v1Partials.length === 0 ? (
                  <EmptyState colSpan={9} message="No V1 delivery shortfalls" />
                ) : (
                  v1Partials.map((p) => {
                    const followUps = followUpMap[p.poNumber] || [];
                    const blocking = followUps.find((f) => f.status !== 'Rejected') || null;
                    const rows = p.items.filter((it) => it.requestOutstanding > 0);
                    return rows.map((it, idx) => (
                      <tr key={`${p.poNumber}-${it.poItemId}`} onClick={() => openTracker(p.poNumber)} className={`border-b border-gray-200 cursor-pointer hover:bg-[#fff8e1]/60 ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}`}>
                        {idx === 0 && (
                          <td rowSpan={rows.length} className="p-4 text-[#333] font-bold whitespace-nowrap align-top">{p.poNumber}<div className="text-[10px] font-normal text-[#999]">{p.supplier}</div></td>
                        )}
                        <td className="p-4 text-[#333] font-medium">{it.itemDescription}<div className="text-[10px] text-[#999]">{it.statusReason || `shortfall: ${it.shortfallSource}`}</div></td>
                        <td className="p-4 text-[#333] font-medium whitespace-nowrap">{it.requestedQty}</td>
                        <td className="p-4 text-[#333] font-medium whitespace-nowrap">{it.approvedQty}</td>
                        <td className="p-4 text-[#333] font-medium whitespace-nowrap">{it.purchasedQty}</td>
                        <td className="p-4 text-[#333] font-medium whitespace-nowrap">{it.deliveredQty}</td>
                        <td className="p-4 text-[#333] font-medium whitespace-nowrap">{it.receivedQty}</td>
                        <td className="p-4 font-bold text-[#e65100] whitespace-nowrap">{it.requestOutstanding}</td>
                        {idx === 0 && (
                          <td rowSpan={rows.length} className="p-4 align-top">
                            {!blocking ? (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setPoForFollowUp({ poNumber: p.poNumber });
                                  setFollowUpBalance({ poNumber: p.poNumber, items: rows.filter((r) => r.procurementShortfall > 0).map((r) => ({ itemDescription: r.itemDescription, unit: r.unit, maxQty: r.procurementShortfall })) });
                                  setFollowUpPoModal(true);
                                }}
                                disabled={!rows.some((r) => r.procurementShortfall > 0)}
                                title={rows.some((r) => r.procurementShortfall > 0) ? 'Procurement follow-up capped at approved-minus-purchased' : 'No procurement shortfall — remaining units are already purchased'}
                                className="bg-white text-[#ef6c00] border border-[#ffcc80] px-3 py-1.5 rounded-md text-xs font-semibold cursor-pointer transition-all duration-200 hover:bg-[#fff3e0] hover:border-[#ef6c00] disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                File Follow-Up
                              </button>
                            ) : (
                              <span className="inline-block px-3 py-1.5 rounded-md text-xs font-semibold bg-gray-100 text-[#888] border border-gray-200 cursor-not-allowed">
                                Follow-up {blocking.status === 'Pending' ? 'pending' : 'approved'}: {blocking.mrsNo}
                              </span>
                            )}
                          </td>
                        )}
                      </tr>
                    ));
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
        )}
        {selectedPoType !== 'partially-received' && (
        <div className="mt-4 border border-[#e0e0e0] rounded-lg overflow-hidden">
          <div className="overflow-x-auto max-h-[500px]">
            <table className="w-full border-collapse text-[13px]">
              <thead className="bg-[#e3f2fd] sticky top-0 z-10">
                <tr>
                  {['PO date', 'PO number', 'Item Description', 'Qty', 'Unit', 'Supplier Name', 'MRS No.', 'PO rvd date', 'Pick-up by', ...(selectedPoType === 'partially-received' ? ['Action'] : [])].map((h, i) => (
                    <th key={i} className="p-4 text-left font-bold text-[#1e3c72] border-b border-[#1e3c72]/20 whitespace-nowrap">{h}</th>
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
                      const followUps = followUpMap[order.poNumber] || [];
                      const blocking = followUps.find((f) => f.status !== 'Rejected') || null;
                      const lastRejected = !blocking && followUps.length > 0 ? followUps[0] : null;
                      return (
                      <tr key={index}
                        onClick={() => {
                          // Phase 14: legacy receiving only for old records outside the V1 workflow.
                          if (isLegacyReceivable(order)) {
                            handleOpenMonitoring(order);
                          } else {
                            handleOpenReceipt(order);
                          }
                        }}
                        className={`border-b border-gray-200 transition-colors duration-150 cursor-pointer hover:bg-[#f0f8fc]/50 ${index % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}`}>
                        <td className="p-4 text-[#333] font-medium whitespace-nowrap">{order.date}</td>
                        <td className="p-4 text-[#333] font-medium whitespace-nowrap">{order.poNumber}</td>
                        <td className="p-4 text-[#333] font-medium">{itemSummary}</td>
                        <td className="p-4 text-[#333] font-medium whitespace-nowrap">{totalQty}</td>
                        <td className="p-4 text-[#333] font-medium whitespace-nowrap">{unitSummary}</td>
                        <td className="p-4 text-[#333] font-medium">{order.supplier}</td>
                        <td className="p-4 text-[#333] font-medium whitespace-nowrap">{order.mrsNo}</td>
                        <td className="p-4 text-[#333] font-medium whitespace-nowrap">{order.poExpDate}</td>
                        <td className="p-4 text-[#333] font-medium whitespace-nowrap">{order.pickupBy}</td>
                        {selectedPoType === 'partially-received' && (
                        <td className="p-4">
                          {order.status === 'incomplete' && order.poType === 'partially-received' && !blocking && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleFileFollowUpFromPo(order);
                              }}
                              className="bg-white text-[#ef6c00] border border-[#ffcc80] px-3 py-1.5 rounded-md text-xs font-semibold cursor-pointer transition-all duration-200 hover:bg-[#fff3e0] hover:border-[#ef6c00]"
                            >
                              File Follow-Up
                            </button>
                          )}
                          {blocking && (
                            <span
                              className="inline-block px-3 py-1.5 rounded-md text-xs font-semibold bg-gray-100 text-[#888] border border-gray-200 cursor-not-allowed"
                              title={blocking.status === 'Pending' ? 'Awaiting purchaser decision — refiling is blocked until decided' : 'Shortfall already covered by this follow-up'}
                            >
                              Follow-up {blocking.status === 'Pending' ? 'pending' : 'approved'}: {blocking.mrsNo}
                            </span>
                          )}
                          {lastRejected && (
                            <div className="mt-1 text-[10px] text-[#999]">Last follow-up {lastRejected.mrsNo} rejected — you may refile</div>
                          )}
                        </td>
                        )}
                      </tr>
                    );
                    })}
                    <TableScrollSentinel colSpan={selectedPoType === 'partially-received' ? 10 : 9} onLoadMore={loadMore} isLoadingMore={loadingMore} disabled={!hasMore} />
                  </>
                ) : (
                  <EmptyState colSpan={selectedPoType === 'partially-received' ? 10 : 9} message="No purchase orders found" />
                )}
              </tbody>
            </table>
          </div>
        </div>
        )}
        </>
        )}
        <p className="mt-2 text-right text-xs text-[#999]">Loaded {isDeliveries ? deliveries.length : purchaseOrders.length} of {total} {isDeliveries ? 'deliveries' : 'purchase orders'}</p>
      </div>

      {receiveDeliveryNumber && (
        <ReceiveDeliveryForm
          deliveryNumber={receiveDeliveryNumber}
          onClose={() => setReceiveDeliveryNumber(null)}
        />
      )}

      {showReceiptModal && selectedReceiptPo && (
        <MaterialRequestReceipt po={selectedReceiptPo} onClose={() => { setShowReceiptModal(false); setSelectedReceiptPo(null); }} />
      )}

      {showMonitoringModal && selectedMonitoringPo && (
        <MonitoringDetailsForm
          po={selectedMonitoringPo}
          onClose={() => { setShowMonitoringModal(false); setSelectedMonitoringPo(null); }}
        />
      )}

      {followUpPoModal && poForFollowUp && (
        <CreateRequestModal
          followUpPo={poForFollowUp}
          followUpBalance={followUpBalance}
          onClose={() => {
            setFollowUpPoModal(false);
            setPoForFollowUp(null);
            setFollowUpBalance(null);
          }}
        />
      )}

      {trackerPoNumber && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-[1000] overflow-y-auto py-6 px-4">
          <div className="bg-white rounded-xl w-full max-w-[720px] max-h-[90vh] overflow-y-auto shadow-[0_10px_30px_rgba(0,0,0,0.15)] p-6 text-left">
            <div className="flex justify-between items-center border-b border-[#eee] pb-3 mb-5">
              <h2 className="m-0 text-lg font-bold text-[#333]">Quantity Tracker — {trackerPoNumber}</h2>
              <button className="text-2xl text-[#888]" onClick={() => { setTrackerPoNumber(null); setTrackerData(null); }}>&times;</button>
            </div>
            {trackerError && <p className="text-[13px] text-[#c62828]">{trackerError}</p>}
            {!trackerError && <POQuantityTracker tracker={trackerData} variant="warehouse" />}
            <div className="flex justify-end mt-4 pt-4 border-t border-[#eee]">
              <button onClick={() => { setTrackerPoNumber(null); setTrackerData(null); }} className="py-2.5 px-6 bg-white text-[#333] border border-[#ccc] rounded-md">Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default PurchaseOrdersView;
