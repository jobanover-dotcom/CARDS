'use client';
import React, { useState, useEffect, useMemo } from 'react';
import StatusBadge from '../ui/StatusBadge';
import EmptyState from '../ui/EmptyState';
import SearchInput from '../ui/SearchInput';
import MaterialRequestReceipt from '../shared/MaterialRequestReceipt';
import TableSkeleton from '../ui/TableSkeleton';
import TableScrollSentinel from '../ui/TableScrollSentinel';
import {
  selectEl,
  stripeAt,
  tableEl,
  tableScroller,
  tdEl,
  tdNum,
  tdPrimary,
  tdStrong,
  thEl,
  thNumEl,
  theadEl,
  trEl,
  trHover,
} from '../ui/tableTheme';
import { useAdminData } from '../../context/AdminDataContext';
import { getPOs } from '../../../actions/pos';
import { getRequests } from '../../../actions/requests';
import { useInfiniteRows } from '../../hooks/useInfiniteRows';
import {
  AWAITING_PURCHASE_LIFECYCLE_STATUSES,
  CANCELLED_STATUSES,
  COMPLETED_STATUSES,
  IN_PROGRESS_LIFECYCLE_STATUSES,
  poDisplayLabel,
} from '../../lib/deliveryStatus';

// History is READ-ONLY, and it is two separate records of two separate things.
//
//   Purchase Orders     one row per PURCHASING TRANSACTION. One MRS may now have
//                       several POs — PO-001 from Supplier A, PO-002 from Supplier
//                       B, both against MRS-001 — and all of them stay separate
//                       rows. They are separate transactions with separate
//                       suppliers, quantities and receipts, so collapsing them
//                       into one MRS row would destroy the record History exists
//                       to keep. The MRS No. column is the link back.
//
//   Warehouse Requests  one row per MATERIAL REQUEST: the originating side of
//                       the same work, approval state and all.
//
// Neither section is a view of the other, which is why this is a pair of sections
// and not a "POs / MRS" toggle. A toggle would present the two as alternatives
// when they are complements, and would force one of them to be re-presented as
// the other.
//
// Nothing here is actionable: no purchasing, no receiving, no cancellation, no
// supplier delivery. A historical PO is a fact about the past, and every action
// that used to sit on these rows would be an edit to that fact. Cancelled POs
// stay listed — a cancellation is part of the audit trail, not a reason to hide
// the record.

const PO_COLUMNS = [
  'PO date',
  'PO number',
  'Item Description',
  'Qty',
  'Unit',
  'Supplier Name',
  'Requisitioner',
  'MRS No.',
  'PO rvd date',
  'Pick-up by',
  'Status',
];
const PO_SPAN = PO_COLUMNS.length;

// `MRS #` used to sit beside `MRS No.` in this table, both bound to the same
// field. The one that names the request is kept; the duplicate is not.
const REQUEST_COLUMNS = [
  'Request Date',
  'MRS No.',
  'Item Description',
  'Qty',
  'Unit',
  'Requested By',
  'Requisitioner',
  'Approved / Balance',
  'Status',
];
const REQUEST_SPAN = REQUEST_COLUMNS.length;

const TAB_COPY = {
  'purchase-orders': {
    title: 'Purchase Orders',
    sub: 'Every purchasing transaction ever raised, one row per purchase order',
    search: 'Search PO number, MRS # or item...',
    noun: 'purchase orders',
  },
  'warehouse-requests': {
    title: 'Warehouse Requests',
    sub: 'Every material request ever raised by a warehouse, one row per request',
    search: 'Search MRS #, request or item...',
    noun: 'requests',
  },
};

/** One item line, summarised; the receipt opened from the row has the full list. */
function itemSummary(items) {
  if (!items.length) return '\u2014';
  return `${items[0].itemDescription}${items.length > 1 ? ` +${items.length - 1} more` : ''}`;
}

function unitSummary(items) {
  if (!items.length) return '\u2014';
  return items.length === 1 ? items[0].unit : 'various';
}

function HistoryView() {
  const { stats, requestCounts, poVersion, requestVersion, deletePO } = useAdminData();
  const [historyTab, setHistoryTab] = useState('purchase-orders');
  const [historySearchInput, setHistorySearchInput] = useState('');
  const [historySearchQuery, setHistorySearchQuery] = useState('');
  const [selectedStatus, setSelectedStatus] = useState('');
  const [appliedFilters, setAppliedFilters] = useState({
    awaitingPurchase: false, inProgress: false, completed: false, cancelled: false,
    approved: false, pending: false, rejected: false,
  });
  const [selectedReceiptPo, setSelectedReceiptPo] = useState(null);
  const [showReceiptModal, setShowReceiptModal] = useState(false);
  const [showRemarksModal, setShowRemarksModal] = useState(false);
  const [remarksToDisplay, setRemarksToDisplay] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setHistorySearchQuery(historySearchInput), 300);
    return () => clearTimeout(t);
  }, [historySearchInput]);

  const isPOsTab = historyTab === 'purchase-orders';

  // Lifecycle filters only. The retired delivery gates are not selectable:
  // they are not states in the current workflow.
  const poQueryParams = useMemo(() => ({
    statusIn: appliedFilters.awaitingPurchase
      ? AWAITING_PURCHASE_LIFECYCLE_STATUSES
      : appliedFilters.inProgress
        ? IN_PROGRESS_LIFECYCLE_STATUSES
        : appliedFilters.completed
          ? COMPLETED_STATUSES
          : appliedFilters.cancelled
            ? CANCELLED_STATUSES
            : undefined,
    search: historySearchQuery || undefined,
  }), [appliedFilters, historySearchQuery]);

  const reqQueryParams = useMemo(() => ({
    status: appliedFilters.pending ? 'Pending' : appliedFilters.approved ? 'Approved' : appliedFilters.rejected ? 'Rejected' : undefined,
    search: historySearchQuery || undefined,
  }), [appliedFilters, historySearchQuery]);

  const poList = useInfiniteRows(getPOs, poQueryParams, poVersion);
  const reqList = useInfiniteRows(getRequests, reqQueryParams, requestVersion);

  const activeList = isPOsTab ? poList : reqList;
  const { rows: loadedRows, total, initialLoading, loadingMore, hasMore, loadMore } = activeList;

  // A search term or a status filter is the difference between "there is nothing
  // here" and "nothing here matches", so the empty state has to say which.
  const filtering = Boolean(historySearchQuery || selectedStatus);
  const emptyHint = historySearchQuery
    ? `Nothing matches "${historySearchQuery}". Clear the search to see every record.`
    : 'Clear the status filter to see every record.';

  const handleOpenReceipt = (po) => {
    setSelectedReceiptPo(po);
    setShowReceiptModal(true);
  };

  const handleViewRejectedRemarks = (req) => {
    setRemarksToDisplay(req.remarks);
    setShowRemarksModal(true);
  };

  const selectTab = (tab) => {
    setHistoryTab(tab);
    setHistorySearchInput('');
    setHistorySearchQuery('');
    setSelectedStatus('');
    setAppliedFilters({
      awaitingPurchase: false, inProgress: false, completed: false, cancelled: false,
      approved: false, pending: false, rejected: false,
    });
  };

  const copy = TAB_COPY[historyTab];
  const columns = isPOsTab ? PO_COLUMNS : REQUEST_COLUMNS;
  const colSpan = isPOsTab ? PO_SPAN : REQUEST_SPAN;

  return (
    <div className="flex flex-col gap-6 w-full text-slate-800">
      <div className="mb-2 text-left">
        <h1 className="m-0 text-3xl max-md:text-2xl text-[#333] font-bold">HISTORY</h1>
        <p className="mt-2 mx-0 mb-0 text-sm text-[#666]">
          Records and monitors all past purchase orders and warehouse requests
        </p>
      </div>

      {/* Two sections, not a view toggle: these are two different records, and
          neither is an alternative presentation of the other. */}
      <div className="grid grid-cols-2 max-md:grid-cols-1 gap-6 mb-6 text-left">
        <div
          className={`rounded-xl p-8 cursor-pointer transition-all duration-300 transform ${
            historyTab === 'purchase-orders'
              ? 'bg-gradient-to-br from-[#e3f2fd] to-[#bbdefb] border-2 border-[#1e3c72] shadow-[0_4px_16px_rgba(30,60,114,0.15)] scale-[1.02] -translate-y-1'
              : 'bg-white border-2 border-[#e0e0e0] shadow-[0_2px_8px_rgba(0,0,0,0.06)] hover:border-[#1e3c72] hover:shadow-[0_4px_12px_rgba(30,60,114,0.12)]'
          }`}
          onClick={() => selectTab('purchase-orders')}
        >
          <div className="text-base font-semibold text-slate-700 mb-2">Purchase Orders</div>
          <div className="text-5xl font-extrabold text-[#1e3c72]">{stats.totalPOs}</div>
          <div className="text-xs text-slate-500 mt-4">One row per purchasing transaction</div>
        </div>

        <div
          className={`rounded-xl p-8 cursor-pointer transition-all duration-300 transform ${
            historyTab === 'warehouse-requests'
              ? 'bg-gradient-to-br from-[#e8f5e9] to-[#c8e6c9] border-2 border-[#2e7d32] shadow-[0_4px_16px_rgba(46,125,50,0.15)] scale-[1.02] -translate-y-1'
              : 'bg-white border-2 border-[#e0e0e0] shadow-[0_2px_8px_rgba(0,0,0,0.06)] hover:border-[#2e7d32] hover:shadow-[0_4px_12px_rgba(46,125,50,0.12)]'
          }`}
          onClick={() => selectTab('warehouse-requests')}
        >
          <div className="text-base font-semibold text-slate-700 mb-2">Warehouse Requests</div>
          <div className="text-5xl font-extrabold text-[#2e7d32]">{requestCounts.total}</div>
          <div className="text-xs text-slate-500 mt-4">One row per material request</div>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-[0_2px_12px_rgba(0,0,0,0.08)] border border-gray-200 overflow-hidden">
        {/* One neutral header band for both sections. It used to change colour
            with the tab, which made the same page read as two applications. */}
        <div className="px-6 py-4 border-b border-[#eee] bg-gray-50/60">
          <div className="flex flex-wrap justify-between items-end gap-4 text-left">
            <div>
              <h2 className="m-0 text-xl font-bold text-[#333] mb-1">{copy.title}</h2>
              <p className="mt-0 mx-0 mb-0 text-[13px] text-[#999]">{copy.sub}</p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <SearchInput
                placeholder={copy.search}
                value={historySearchInput}
                onChange={(e) => setHistorySearchInput(e.target.value)}
              />
              <select
                value={selectedStatus}
                aria-label={`Filter ${copy.title.toLowerCase()} by status`}
                onChange={(e) => {
                  const val = e.target.value;
                  setSelectedStatus(val);
                  const reset = { awaitingPurchase: false, inProgress: false, completed: false, cancelled: false, approved: false, pending: false, rejected: false };
                  if (val) reset[val] = true;
                  setAppliedFilters(reset);
                }}
                className={selectEl}
              >
                <option value="">All</option>
                {historyTab === 'purchase-orders' && (
                  <>
                    <option value="awaitingPurchase">Awaiting Purchase</option>
                    <option value="inProgress">In Progress</option>
                    <option value="completed">Completed</option>
                    <option value="cancelled">Cancelled</option>
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

        {/* Contextual skeleton: the heading, section switch and filters stay put
            and only the rows are replaced, so the page does not jump when the
            other section is opened. */}
        {initialLoading ? (
          <TableSkeleton columns={columns} />
        ) : (
          <div className={tableScroller}>
            <table className={`${tableEl} min-w-[1100px]`}>
              <thead className={theadEl}>
                <tr>
                  {columns.map((h) => (
                    <th key={h} className={['Qty'].includes(h) ? thNumEl : thEl}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {isPOsTab ? (
                  poList.rows.length > 0 ? (
                    <>
                      {poList.rows.map((order, index) => {
                        const items = order.items || [];
                        const totalQty = items.reduce((s, it) => s + it.qty, 0);
                        return (
                          <tr
                            key={order.poNumber}
                            onClick={() => handleOpenReceipt(order)}
                            title="Open the material request receipt for this purchase order"
                            className={`${trEl} ${trHover} cursor-pointer ${stripeAt(index)}`}
                          >
                            <td className={`${tdEl} whitespace-nowrap`}>{order.date}</td>
                            <td className={`${tdPrimary} whitespace-nowrap`}>{order.poNumber}</td>
                            <td className={tdEl}>{itemSummary(items)}</td>
                            <td className={tdNum}>{totalQty}</td>
                            <td className={`${tdEl} whitespace-nowrap`}>{unitSummary(items)}</td>
                            <td className={tdEl}>{order.supplier || <span className="text-[#bbb]">&mdash;</span>}</td>
                            <td className={tdStrong}>{order.requisitioner}</td>
                            {/* The link back to the request this PO was raised
                                from. Several POs share one MRS number and each
                                stays its own row. */}
                            <td className={`${tdEl} whitespace-nowrap`}>{order.mrsNo || <span className="text-[#bbb]">&mdash;</span>}</td>
                            <td className={`${tdEl} whitespace-nowrap`}>{order.poExpDate || <span className="text-[#bbb]">&mdash;</span>}</td>
                            <td className={`${tdEl} whitespace-nowrap`}>{order.pickupBy || <span className="text-[#bbb]">&mdash;</span>}</td>
                            <td className="p-4 whitespace-nowrap">
                              <StatusBadge status={poDisplayLabel(order.status)} />
                            </td>
                          </tr>
                        );
                      })}
                      <TableScrollSentinel colSpan={PO_SPAN} onLoadMore={loadMore} isLoadingMore={loadingMore} disabled={!hasMore} />
                    </>
                  ) : (
                    <EmptyState
                      colSpan={PO_SPAN}
                      message="No purchase orders found"
                      hint={filtering ? emptyHint : 'Purchase orders raised from Requests will appear here.'}
                    />
                  )
                ) : reqList.rows.length > 0 ? (
                  <>
                    {reqList.rows.map((req, index) => {
                      const items = req.items || [];
                      const totalQty = items.reduce((s, it) => s + it.qty, 0);
                      const hasApprovals = items.some((it) => it.approvedQty != null);
                      const totalApproved = hasApprovals ? items.reduce((s, it) => s + (it.approvedQty ?? 0), 0) : null;
                      const balance = totalApproved != null ? Math.max(0, totalQty - totalApproved) : null;
                      const rejected = req.status === 'Rejected';
                      return (
                        <tr
                          key={req.reqNumber ?? index}
                          onClick={() => { if (rejected) handleViewRejectedRemarks(req); }}
                          title={rejected ? 'View the rejection remarks' : undefined}
                          className={`${trEl} ${trHover} ${stripeAt(index)} ${rejected ? 'cursor-pointer' : ''}`}
                        >
                          <td className={`${tdEl} whitespace-nowrap`}>{req.date}</td>
                          <td className={`${tdPrimary} whitespace-nowrap`}>{req.mrsNo}</td>
                          <td className={tdEl}>{itemSummary(items)}</td>
                          <td className={tdNum}>{totalQty}</td>
                          <td className={`${tdEl} whitespace-nowrap`}>{unitSummary(items)}</td>
                          <td className={tdStrong}>{req.requestedBy}</td>
                          <td className={tdEl}>{req.requisitioner}</td>
                          <td className={`p-4 font-medium whitespace-nowrap text-right tabular-nums ${balance > 0 ? 'text-[#ef6c00] font-bold' : 'text-[#333]'}`}>
                            {totalApproved == null ? '\u2014' : `${totalApproved} / ${totalQty}${balance > 0 ? ` · bal ${balance}` : ''}`}
                          </td>
                          <td className="p-4 whitespace-nowrap"><StatusBadge status={req.status} /></td>
                        </tr>
                      );
                    })}
                    <TableScrollSentinel colSpan={REQUEST_SPAN} onLoadMore={loadMore} isLoadingMore={loadingMore} disabled={!hasMore} />
                  </>
                ) : (
                  <EmptyState
                    colSpan={REQUEST_SPAN}
                    message="No warehouse requests found"
                    hint={filtering ? emptyHint : 'Requests raised by a warehouse will appear here.'}
                  />
                )}
              </tbody>
            </table>
          </div>
        )}
        <div className="px-4 py-2 border-t border-gray-100">
          <p className="m-0 text-right text-xs text-[#999]">
            {initialLoading ? `Loading ${copy.noun}\u2026` : `Loaded ${loadedRows.length} of ${total} ${copy.noun}`}
          </p>
        </div>
      </div>

      {showReceiptModal && selectedReceiptPo && (
        <MaterialRequestReceipt po={selectedReceiptPo} onDelete={deletePO} onClose={() => { setShowReceiptModal(false); setSelectedReceiptPo(null); }} />
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