'use client';
import React, { useState, useEffect, useMemo, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import StatCard from '../ui/StatCard';
import SegmentedControl from '../ui/SegmentedControl';
import SearchInput from '../ui/SearchInput';
import EmptyState from '../ui/EmptyState';
import MaterialRequestReceipt from '../shared/MaterialRequestReceipt';
import SupplierReceiptsModal from '../shared/SupplierReceiptsModal';
import POCreationForm from './POCreationForm';
import PORow, { PO_COL_SPAN } from './PORow';
import PurchaseWorkflowModal from './PurchaseWorkflowModal';
import MRSItemsModal from './MRSItemsModal';
import StatusBadge from '../ui/StatusBadge';
import PageSkeleton from '../ui/PageSkeleton';
import TableSkeleton from '../ui/TableSkeleton';
import TableScrollSentinel from '../ui/TableScrollSentinel';
import {
  metaSub,
  selectEl,
  tableEl,
  tableScroller,
  tableShell,
  tdMuted,
  tdStrong,
  thEl,
  theadEl,
  trEl,
  trHover,
} from '../ui/tableTheme';
import { useAdminData } from '../../context/AdminDataContext';
import { getPOBucketPage, getMRSGroupedPage, getMRSFollowUpContext } from '../../../actions/procurement';
import { useInfiniteRows } from '../../hooks/useInfiniteRows';
import {
  IN_PROGRESS_FILTER_KEYS,
  PO_PROGRESS_LABEL,
} from '../../lib/deliveryQuantities';

// Purchaser/Admin purchase-order view. The Admin IS the purchaser, so this is
// the procurement view.
//
// ONE PO = ONE SUPPLIER = ONE PURCHASING TRANSACTION. A follow-up purchase
// therefore never amends the PO it follows: it raises a NEW PO against the same
// material request, and the original PO keeps its own supplier, quantities and
// history. One MRS may therefore have several POs, and the MRS is what owns the
// approved quantity — it is read from the requirement once, never summed across
// the POs raised against it.
//
// Raising a follow-up does not buy anything: it creates a PO in Pending Purchase,
// and the supplier is chosen afterwards in Save Purchase on that new PO. Because
// the requirement is then divided across the POs (see src/lib/mrsRequirement.ts),
// the original PO's share of it drops to what it had already bought, so it derives
// Awaiting Receiving or Completed instead of sitting on In Progress forever.
//
// Pending Purchase and In Progress are deliberately different sections:
// Pending Purchase is untouched purchasing (nothing bought at all), while an
// In Progress PO has already had some units bought and still has more to buy.
//
// The one status that is not quantity-derived is Cancelled. Cancellation is an
// administrative fact no quantity can express, so it always wins, and a
// cancelled PO is listed under Total POs only — it must never read as work
// waiting to be bought.
//
// The two views below are PRESENTATION only. `pos` is the purchase-order list and
// is the default; `mrs` groups those same purchase orders under the material
// request they fulfil. Switching re-orders nothing, re-prices nothing and changes
// no status, and the five section counts above the toggle are identical in both.
//
// There is no supplier delivery action anywhere in this view. The supplier is
// external to CARDS, so "Purchased" is never treated as "Delivered" and a
// fully purchased PO reads Awaiting Receiving — the warehouse's to record.

// The five sections, in display order. Discrepancies sits immediately before
// Completed: it is an exception state, so it reads next to the finished bucket
// rather than among the ordinary stages.
const SECTIONS = [
  { bucket: 'all', label: 'Total POs', color: 'slate', description: 'Every purchase order', sub: 'Every purchase order, whatever state it is in' },
  { bucket: 'pending_purchase', label: 'Pending Purchase', color: 'blue', description: 'Nothing bought yet', sub: 'Approved and raised — no purchasing has started' },
  { bucket: 'in_progress', label: 'In Progress', color: 'amber', description: 'Purchasing and/or receiving outstanding', sub: 'Started but not finished — filter by what is outstanding' },
  { bucket: 'discrepancy', label: 'Discrepancies', color: 'red', description: 'Receiving discrepancy flagged', sub: 'Flagged as a receiving discrepancy — needs attention' },
  { bucket: 'completed', label: 'Completed', color: 'green', description: 'All quantities received', sub: 'Every approved unit fully purchased and fully received' },
];

// Sub-filter for the In Progress table only. Built from the SAME key list the
// server action accepts, so an option can never be offered that the action
// would silently reject, and the labels come from the stage helper that
// produces the values, so they cannot drift from what the rows show.
const IN_PROGRESS_OPTIONS = IN_PROGRESS_FILTER_KEYS.map((value) => ({
  value,
  label: value === 'all' ? 'All' : PO_PROGRESS_LABEL[value],
}));

const COLUMNS = ['PO', 'Requisitioner', 'Supplier', 'Items', 'Status', 'Actions'];

// The MRS view keeps the SAME six columns as the purchase-order view, so a PO
// nested under a material request renders from the identical PORow component
// with no second column set to keep in step. Only the top-level row changes.
//
// Column 3 is Supplier in BOTH views, so a PO reads the same under either header.
// The two lists differ only at index 0 (PO vs MRS) and 4 (Items vs POs); a test
// pins that, because a header drifting in one view only is what let a Warehouse
// column sit beside a Requisitioner column holding the same value.
const MRS_COLUMNS = ['MRS', 'Requisitioner', 'Supplier', 'POs', 'Status', 'Actions'];
const COL_SPAN = PO_COL_SPAN;

const inputClass = 'py-2 px-3 border border-[#ccc] rounded-md text-[13px] text-[#333] bg-gray-50';

// The two presentations of the same purchase orders. `pos` is the default and the
// primary experience; `mrs` only nests the identical PO rows under the material
// request they fulfil.
const VIEW_OPTIONS = [
  { value: 'pos', label: 'POs', title: 'One row per purchase order' },
  { value: 'mrs', label: 'MRS', title: 'Purchase orders grouped by material request' },
];

const MRS_HEADINGS = {
  pos: ['Purchase Orders', 'Every purchase order, one row per purchasing transaction'],
  mrs: ['Purchase Orders by Material Request', 'The same purchase orders, grouped by the material request they fulfil'],
};

/**
 * The top-level row of the MRS view: one material request, collapsed by default.
 *
 * This row is ONLY a grouping label. It deliberately renders no panel of its own:
 * expanding an MRS reveals its purchase orders (rendered by the caller right
 * after this row), and expanding one of those opens the same item table the POs
 * view uses. There is no flattened "all items across all POs" table, because the
 * item hierarchy is MRS -> POs -> items and flattening it here would invent a
 * second, contradictory item model.
 *
 * The quantities it does show are the requirement summary, where `approved` is
 * counted once for the MRS and purchased/received are summed across its purchase
 * orders. The nested PO rows show no approved figure of their own, so nothing
 * implies a PO owns an independent approval.
 *
 * It is styled as a GROUP row, not as another PO: a navy accent bar down its
 * leading edge and a cooler, deeper face than the POs nested beneath it. A parent
 * and its children sharing one row style made the hierarchy invisible — you
 * could not tell which PO belonged to which request without reading the numbers.
 */
function MRSTopRow({ group, expanded, striped, onToggle, onTrack }) {
  const statusLabel = group.hasDiscrepancy
    ? 'Discrepancy'
    : PO_PROGRESS_LABEL[group.progressStage];
  const t = group.totals;
  const rowClass = [
    trEl,
    trHover,
    'cursor-pointer border-l-2 border-l-[#1e3c72]',
    expanded ? 'bg-[#dfeaf7]' : striped ? 'bg-[#eef4fb]' : 'bg-[#e6effa]',
  ].join(' ');
  return (
    <tr
      onClick={onToggle}
      aria-expanded={expanded}
      title={expanded ? 'Collapse material request' : 'Expand to see its purchase orders'}
      className={rowClass}
    >
      <td className="p-4 whitespace-nowrap">
        <div className="flex items-center gap-2">
          <span className="text-[#7e9dc0] text-[10px] leading-none" aria-hidden="true">{expanded ? '\u25be' : '\u25b8'}</span>
          <span className="text-[#1e3c72] font-bold">{group.mrsNo || '\u2014'}</span>
        </div>
        {/* Requirement headline: approved counted once, the rest summed across POs. */}
        <div className={`${metaSub} pl-[18px]`}>
          Approved {t.approved} &middot; Purchased {t.purchased} &middot; Received {t.received}
        </div>
      </td>
      <td className={tdStrong}>{group.requisitioner}</td>
      {/* A material request has no supplier of its own: one requirement can be
          bought from several suppliers across its purchase orders, so any single
          name here would misstate it. The suppliers are on the PO rows nested
          underneath, which is where a purchasing transaction actually lives. */}
      <td className={tdMuted}>&mdash;</td>
      <td className={`${tdStrong} whitespace-nowrap`}>{group.poCount} PO{group.poCount === 1 ? '' : 's'}</td>
      <td className="p-4 whitespace-nowrap">
        {statusLabel ? <StatusBadge status={statusLabel} /> : <span className="text-[#bbb]">&mdash;</span>}
      </td>
      <td className="p-4 whitespace-nowrap text-[12px] text-[#555]">
        <div className="flex items-center gap-2">
          <span>
            {t.procurementOutstanding > 0
              ? `${t.procurementOutstanding} to purchase`
              : t.receivingOutstanding > 0
                ? `${t.receivingOutstanding} to receive`
                : 'Nothing outstanding'}
          </span>
          {/* The headline above is one general quantity for the whole requirement.
              This opens the per-item breakdown behind it. stopPropagation is
              required: the row itself toggles the expand, and without it one click
              would both drill in and collapse the purchase orders. */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onTrack(group.mrsNo);
            }}
            className="py-1 px-2 bg-white text-[#006680] border border-[#80c0d0] rounded text-[11px] font-semibold cursor-pointer transition-colors duration-200 hover:bg-[#e8f4f6] hover:border-[#006680]"
          >
            Track
          </button>
        </div>
      </td>
    </tr>
  );
}

function PurchaseOrderContent() {
  const { poVersion, deletePO } = useAdminData();
  const searchParams = useSearchParams();
  const [bucket, setBucket] = useState('all');
  // Presentation only: 'pos' (default) lists purchase orders, 'mrs' groups those
  // same purchase orders under their material request. Never changes data.
  const [view, setView] = useState('pos');
  // Scopes the In Progress table only. Never sent for another section, so it
  // cannot move the five cards or filter any other table.
  const [progressFilter, setProgressFilter] = useState('all');
  const [poSearchInput, setPoSearchInput] = useState('');
  const [poSearchQuery, setPoSearchQuery] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [selectedReceiptPo, setSelectedReceiptPo] = useState(null);
  const [showReceiptModal, setShowReceiptModal] = useState(false);
  // The supplier's delivery receipts, which are per PO and only exist once the
  // warehouse has attached some, so they are tracked separately from the MRS
  // receipt above — that one is always available, this one never is at first.
  const [supplierReceiptPo, setSupplierReceiptPo] = useState(null);
  const [workflowPoNumber, setWorkflowPoNumber] = useState(null);
  // Follow-up Purchase reuses the PO creation form, seeded server-side with the
  // locked MRS and how much of its requirement is genuinely still unpurchased.
  const [followUp, setFollowUp] = useState(null);
  const [followUpLoading, setFollowUpLoading] = useState(false);
  const [followUpError, setFollowUpError] = useState(null);
  // A PO raised from a Follow-up Approval decision. Distinct from `followUp`
  // (Follow-up Purchase, seeded from the MRS) and from `initialFormData`
  // (a first PO raised while approving): this one must not write an approval.
  const [approvalPO, setApprovalPO] = useState(null);
  // One PO expanded at a time: the detail panel is the source of truth for one
  // PO, so opening a second would just hide the first. Kept separate from the
  // expanded MRS rows so nesting stays readable.
  const [expandedPoNumber, setExpandedPoNumber] = useState(null);
  const [expandedMrsNo, setExpandedMrsNo] = useState(null);
  // The material request whose per-item breakdown is open. Held as the MRS number
  // rather than the row object so the modal always reads the latest rows after a
  // purchase, a save or a receiving correction re-fetches the page.
  const [trackedMrsNo, setTrackedMrsNo] = useState(null);
  // Section counts come from the SAME call that prices the rows, so a card can
  // never disagree with the list beneath it.
  const [counts, setCounts] = useState(null);
  // Which view produced the rows currently held by the paging hook. The hook
  // keeps the previous page's rows while it refetches, so without this a switch
  // would briefly render one view's rows under the other's columns.
  const [loadedView, setLoadedView] = useState(null);

  const [initialFormData, setInitialFormData] = useState(null);

  useEffect(() => {
    const t = setTimeout(() => setPoSearchQuery(poSearchInput), 300);
    return () => clearTimeout(t);
  }, [poSearchInput]);

  // ONE fetcher branching on the view, never two. useInfiniteRows refetches on its
  // serialized params, so swapping the fetcher by identity would not re-fetch;
  // branching inside one function and carrying `view` in the params makes the
  // toggle a normal part of the request.
  //
  // Both branches return { rows, total } for the same hook, and both set the same
  // PO-level counts — the five cards are identical in either view.
  const fetchPage = useMemo(
    () => async (params) => {
      const res =
        params.view === 'mrs' ? await getMRSGroupedPage(params) : await getPOBucketPage(params);
      setCounts(res.counts);
      setLoadedView(params.view);
      return { rows: res.rows, total: res.total };
    },
    [],
  );

  const queryParams = useMemo(() => ({
    view,
    bucket,
    // Only the In Progress section has a sub-filter, so it is omitted
    // elsewhere rather than sent as a misleading no-op.
    ...(bucket === 'in_progress' ? { statusFilter: progressFilter } : {}),
    search: poSearchQuery || undefined,
  }), [view, bucket, progressFilter, poSearchQuery]);

  const { rows: pageRows, total, initialLoading, loadingMore, hasMore, loadMore, error } =
    useInfiniteRows(fetchPage, queryParams, poVersion);

  const purchaseOrders = view === 'mrs' ? [] : pageRows;
  const mrsGroups = view === 'mrs' ? pageRows : [];

  useEffect(() => {
    // Follow-up Approval handoff. Seeded with the APPROVAL DELTA just granted,
    // keyed by request item id. It must NOT reuse the openPOModal branch below:
    // that one sets sourceReqNumber, which makes POCreationForm treat the seeded
    // quantity as the approval and rewrite approvedQty with the delta.
    const approvalReqNumber = searchParams.get('approvalPO');
    if (approvalReqNumber) {
      let items = [];
      try { items = JSON.parse(searchParams.get('items') || '[]'); } catch { items = []; }
      setApprovalPO({
        reqNumber: approvalReqNumber,
        items: items.filter((i) => Number.isFinite(i?.qty) && i.qty > 0 && i?.id),
        requisitioner: searchParams.get('requisitioner') || '',
        mrsNo: searchParams.get('mrsNo') || '',
        warehouse: searchParams.get('requestWarehouse') || '',
        approvedBy: searchParams.get('approvedBy') || '',
        approvalDate: searchParams.get('approvalDate') || '',
      });
      setShowModal(true);
      return;
    }
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

  // A purchase may only be bought against a PO that has no purchase yet. Once a
  // PO holds a transaction it is closed: buying more raises a new PO on the MRS.
  const toggleExpanded = (poNumber) =>
    setExpandedPoNumber((current) => (current === poNumber ? null : poNumber));

  // Switching section resets the sub-filter, so a stale "Mixed Progress" can
  // never silently hide every row of the next section.
  const selectBucket = (next) => {
    setBucket(next);
    setProgressFilter('all');
    setExpandedPoNumber(null);
    setExpandedMrsNo(null);
  };

  // Switching view is presentation only: no query, no status change, no quantity
  // recomputation. Expansion state is cleared so a collapsed hierarchy is never
  // inherited across views.
  const selectView = (next) => {
    setView(next);
    setExpandedPoNumber(null);
    setExpandedMrsNo(null);
  };

  const toggleExpandedMrs = (mrsNo) =>
    setExpandedMrsNo((current) => (current === mrsNo ? null : mrsNo));

  const openReceipt = (order) => {
    setSelectedReceiptPo(order);
    setShowReceiptModal(true);
  };

  const openSupplierReceipts = (order) => setSupplierReceiptPo(order);

  // Follow-up Purchase: open the existing PO creation form, seeded by the server
  // with the locked MRS and the requirement-wide remainder.
  const openFollowUp = async (poNumber) => {
    setFollowUpLoading(true);
    setFollowUpError(null);
    try {
      const ctx = await getMRSFollowUpContext({ originalPoNumber: poNumber });
      setFollowUp({
        followUp: {
          originalPoNumber: ctx.originalPoNumber,
          mrsNo: ctx.mrsNo,
          blocked: ctx.blocked,
          totalRemaining: ctx.totalRemaining,
          date: new Date().toISOString().slice(0, 10),
        },
        // Lines carry the MRS requirement and the amount still purchasable across
        // every PO on it, which is what caps the quantity inputs. A line with
        // nothing left cannot be ordered again, so it is not offered.
        items: ctx.items
          .filter((i) => i.remaining > 0)
          .map((i) => ({ itemDescription: i.itemDescription, unit: i.unit, qty: i.remaining, maxQty: i.remaining })),
        mrsNo: ctx.mrsNo,
        requisitioner: ctx.requisitioner,
        sourceRequestWarehouse: ctx.warehouse,
        approvedBy: ctx.approvedBy || '',
        approvalDate: ctx.poExpDate || '',
      });
    } catch (e) {
      setFollowUpError(e?.message || 'Failed to open the follow-up purchase');
    } finally {
      setFollowUpLoading(false);
    }
  };

  const section = SECTIONS.find((s) => s.bucket === bucket) ?? SECTIONS[0];
  const heading = view === 'mrs' ? MRS_HEADINGS.mrs[0] : section.label;
  const subheading = view === 'mrs' ? MRS_HEADINGS.mrs[1] : section.sub;

  // The hook holds the previous page until the new one arrives, so while the
  // rows on hand belong to the other view there is nothing coherent to draw.
  // Showing the same contextual skeleton keeps the switch clean and stops one
  // view's rows from being read under the other's columns. An error is still
  // shown, because it is the only information available at that point.
  const awaitingCurrentView = initialLoading || (!error && loadedView !== view);

  // Read from the rows on screen rather than captured when the button was clicked,
  // so a purchase or a receiving correction made while the modal is open cannot
  // leave it showing figures the page has already moved on from.
  const trackedGroup = trackedMrsNo ? mrsGroups.find((g) => g.mrsNo === trackedMrsNo) : null;

  return (
    <div className="bg-white rounded-lg p-6">
      <div className="mb-8">
        <h1 className="m-0 text-3xl max-md:text-2xl text-[#333] font-bold">Purchase Orders</h1>
        <p className="mt-2 mx-0 mb-0 text-sm text-[#666]">
          Procurement dashboard &mdash; save purchase quantities, follow up on shortfalls, track receiving
        </p>
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] max-md:grid-cols-1 gap-4 mb-8">
        {SECTIONS.map((s) => (
          <StatCard
            key={s.bucket}
            label={s.label}
            count={counts?.[s.bucket] ?? 0}
            description={s.description}
            color={s.color}
            isActive={bucket === s.bucket}
            onClick={() => selectBucket(s.bucket)}
          />
        ))}
      </div>

      <div className="mb-6">
        <button className="bg-white text-[#0288d1] border-2 border-[#7ec8e3] py-2.5 px-5 rounded-md text-sm font-semibold cursor-pointer transition-all duration-300 inline-flex items-center gap-2 hover:bg-[#f0f8fc] hover:border-[#0288d1] hover:-translate-y-0.5 hover:shadow-[0_2px_8px_rgba(2,136,209,0.15)] active:translate-y-0" onClick={() => { setApprovalPO(null); setInitialFormData(null); setShowModal(true); }}>
          New purchase order
        </button>
      </div>

      <div className="mt-8">
        <div className="mb-4 flex flex-wrap justify-between items-end gap-3">
          <div>
            <h2 className="m-0 text-lg text-[#333] font-bold">{heading}</h2>
            <p className="mt-1 mb-0 text-[13px] text-[#999]">{subheading}</p>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            {/* Presentation toggle for the purchase orders already listed. It
                changes no data, no status and no quantity — only which row is the
                top level. The five cards above stay PO-level either way. */}
            <div className="flex items-center gap-2">
              <span className="text-[12px] font-semibold text-[#666]">View</span>
              <SegmentedControl label="Purchase order view" options={VIEW_OPTIONS} value={view} onChange={selectView} />
            </div>
            {/* Upper-right of the In Progress table, and only there: it filters
                these rows, never the five sections above. */}
            {bucket === 'in_progress' && (
              <label className="flex items-center gap-2">
                <span className="text-[12px] font-semibold text-[#666]">Status</span>
                <select
                  value={progressFilter}
                  onChange={(e) => setProgressFilter(e.target.value)}
                  className={selectEl}
                  aria-label="Filter In Progress purchase orders by status"
                >
                  {IN_PROGRESS_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </label>
            )}
          </div>
        </div>
        <SearchInput placeholder="Search PO number, item or supplier..." value={poSearchInput} onChange={(e) => setPoSearchInput(e.target.value)} />
        <div className={`mt-4 ${tableShell}`}>
          <div className={tableScroller}>
            {awaitingCurrentView ? (
              <TableSkeleton columns={view === 'mrs' ? MRS_COLUMNS : COLUMNS} />
            ) : (
              <table className={`${tableEl} min-w-[720px]`}>
                <thead className={theadEl}>
                  <tr>
                    {(view === 'mrs' ? MRS_COLUMNS : COLUMNS).map((h) => (
                      <th key={h} className={thEl}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {error ? (
                    <tr><td colSpan={COL_SPAN} className="p-4 text-[#c62828] font-semibold">{error}</td></tr>
                  ) : view === 'mrs' ? (
                    <>
                      {mrsGroups.map((group, index) => (
                        <React.Fragment key={group.mrsNo || index}>
                          <MRSTopRow
                            group={group}
                            expanded={expandedMrsNo === group.mrsNo}
                            striped={index % 2 === 0}
                            onToggle={() => toggleExpandedMrs(group.mrsNo)}
                            onTrack={(mrsNo) => setTrackedMrsNo(mrsNo)}
                          />
                          {expandedMrsNo === group.mrsNo && group.pos.map((order) => (
                            <PORow
                              key={order.poNumber}
                              order={order}
                              nested
                              expanded={expandedPoNumber === order.poNumber}
                              onToggle={toggleExpanded}
                              onPurchase={setWorkflowPoNumber}
                              onFollowUp={openFollowUp}
                              onOpenReceipt={openReceipt}
                              onOpenSupplierReceipts={openSupplierReceipts}
                            />
                          ))}
                        </React.Fragment>
                      ))}
                      <TableScrollSentinel colSpan={COL_SPAN} onLoadMore={loadMore} isLoadingMore={loadingMore} disabled={!hasMore} />
                    </>
                  ) : purchaseOrders.length > 0 ? (
                    <>
                      {purchaseOrders.map((order, index) => (
                        <PORow
                          key={order.poNumber}
                          order={order}
                          expanded={expandedPoNumber === order.poNumber}
                          onToggle={toggleExpanded}
                          onPurchase={setWorkflowPoNumber}
                          onFollowUp={openFollowUp}
                          onOpenReceipt={openReceipt}
                          onOpenSupplierReceipts={openSupplierReceipts}
                          striped={index % 2 === 0}
                        />
                      ))}
                      <TableScrollSentinel colSpan={COL_SPAN} onLoadMore={loadMore} isLoadingMore={loadingMore} disabled={!hasMore} />
                    </>
                  ) : (
                    <EmptyState
                      colSpan={COL_SPAN}
                      message="No purchase orders found"
                      hint={poSearchQuery ? `Nothing matches "${poSearchQuery}". Clear the search to see every purchase order.` : null}
                    />
                  )}
                </tbody>
              </table>
            )}
          </div>
        </div>
        <p className="mt-2 text-right text-xs text-[#999]">
          {view === 'mrs'
            ? `Loaded ${mrsGroups.length} of ${total} material requests`
            : `Loaded ${purchaseOrders.length} of ${total} purchase orders`}
        </p>
      </div>

      {followUpError && (
        <p className="mt-3 mb-0 text-[13px] text-[#c62828] font-semibold">{followUpError}</p>
      )}

      {showModal && !approvalPO && (
        <POCreationForm onClose={() => { setShowModal(false); setInitialFormData(null); }} onSuccess={() => setShowSuccessModal(true)} initialData={initialFormData} />
      )}

      {showModal && approvalPO && (
        <POCreationForm
          initialData={{ approvalPO }}
          onClose={() => { setShowModal(false); setApprovalPO(null); }}
          onSuccess={() => { setShowModal(false); setApprovalPO(null); setShowSuccessModal(true); }}
        />
      )}

      {/* Follow-up Purchase reuses the PO creation form, so there is no second
          purchasing modal and no second follow-up button. */}
      {followUp && (
        <POCreationForm initialData={followUp} onClose={() => setFollowUp(null)} onSuccess={() => setFollowUp(null)} />
      )}

      {/* The per-item breakdown behind an MRS row's general quantity. Resolved from
          the rows already on the page — no fetch — so it cannot show figures the
          row above disagrees with. */}
      {trackedGroup && <MRSItemsModal group={trackedGroup} onClose={() => setTrackedMrsNo(null)} />}

      {showSuccessModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-[1000] animate-fade-in">
          <div className="bg-white rounded-xl w-full max-w-[380px] text-center py-8 px-6 shadow-[0_10px_30px_rgba(0,0,0,0.15)] animate-slide-in">
            <div className="flex flex-col items-center gap-3">
              <div className="bg-[#e8f5e9] text-[#2e7d32] text-3xl w-16 h-16 rounded-full flex items-center justify-center mb-3 border-2 border-[#a5d6a7] font-bold">&#10003;</div>
              <h3 className="m-0 text-lg text-[#333] font-bold">Successfully Added</h3>
              <p className="m-0 text-[13px] text-[#666] leading-relaxed mb-4">The purchase order has been added as Awaiting Purchase. Record purchase quantities and select the supplier when you buy.</p>
              <button className="bg-[#2e7d32] text-white border-none py-2.5 px-8 rounded-md text-sm font-semibold cursor-pointer transition-all duration-200 min-w-[100px] hover:bg-[#1b5e20] hover:shadow-[0_2px_8px_rgba(46,125,50,0.3)] hover:-translate-y-0.5" onClick={() => setShowSuccessModal(false)}>OK</button>
            </div>
          </div>
        </div>
      )}

      {showReceiptModal && selectedReceiptPo && (
        <MaterialRequestReceipt po={selectedReceiptPo} onDelete={deletePO} onClose={() => { setShowReceiptModal(false); setSelectedReceiptPo(null); }} />
      )}

      {supplierReceiptPo && (
        <SupplierReceiptsModal po={supplierReceiptPo} onClose={() => setSupplierReceiptPo(null)} />
      )}

      {workflowPoNumber && (
        // Left expanded on save: poVersion bumps, the row reloads, and the
        // refreshed quantities are visible in place.
        <PurchaseWorkflowModal poNumber={workflowPoNumber} onClose={() => setWorkflowPoNumber(null)} />
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
