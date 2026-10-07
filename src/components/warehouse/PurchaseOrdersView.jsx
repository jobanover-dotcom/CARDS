'use client';
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import StatCard from '../ui/StatCard';
import SearchInput from '../ui/SearchInput';
import EmptyState from '../ui/EmptyState';
import StatusBadge from '../ui/StatusBadge';
import TableSkeleton from '../ui/TableSkeleton';
import MaterialRequestReceipt from '../shared/MaterialRequestReceipt';
import POQuantityTracker from '../shared/POQuantityTracker';
import ReceivePOForm from './ReceivePOForm';
import {
  actionPrimary,
  actionSecondary,
  metaLabel,
  metaSub,
  nestedPanel,
  stripeAt,
  tableEl,
  tableScroller,
  tableShell,
  tdEl,
  tdPrimary,
  thEl,
  thNumEl,
  theadEl,
  trEl,
  trHover,
  trSelected,
} from '../ui/tableTheme';
import { useWarehouseData } from '../../context/WarehouseDataContext';
import { getPOWorkload } from '../../../actions/procurement';

// Warehouse view. The warehouse owns RECEIVING only.
//
// The cards and the tables are fed from ONE server call (getPOWorkload), which
// classifies every parent PO through the same canonical quantity chain the
// rows display. That is deliberate: the old screen counted a card from one
// source and filtered its table from another, so a card could read "4
// partially received" above an empty table.
//
// There is no "Partially Received" card and no "Ready for Delivery" tab: what
// remains is a quantity (receiving outstanding), not a state. There is also no
// procurement Follow-Up button — chasing a purchase shortfall belongs to the
// Admin, who performs a Follow-up Purchase on the same PO.
const TABS = {
  receiving: { label: 'Receiving Due', sub: 'Purchased items not yet fully received — click Receive to record what arrived' },
  'in-progress': { label: 'In Progress', sub: 'Purchase orders still being purchased or received' },
  completed: { label: 'Completed', sub: 'Every item fully purchased and fully received' },
};

const COLUMNS = ['PO date', 'PO number', 'MRS No.', 'Approved', 'Purchased', 'Received', 'To Receive', 'Supplier', 'Status', 'Action'];
const COL_SPAN = COLUMNS.length;
const NUMERIC_COLUMNS = ['Approved', 'Purchased', 'Received', 'To Receive'];

function PurchaseOrdersView() {
  const { poVersion, getPOTracker } = useWarehouseData();
  const [tab, setTab] = useState('receiving');
  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [workload, setWorkload] = useState(null);
  const [workloadError, setWorkloadError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [receivePoNumber, setReceivePoNumber] = useState(null);
  const [trackerPoNumber, setTrackerPoNumber] = useState(null);
  const [trackerData, setTrackerData] = useState(null);
  const [receiptPo, setReceiptPo] = useState(null);
  // One purchase order expanded at a time. The rows are per PO because that is
  // the unit a purchase order IS: receiving is recorded against the PO, so one PO
  // gets one Receive action no matter how many of its items are outstanding.
  const [expandedPoNumber, setExpandedPoNumber] = useState(null);

  useEffect(() => {
    const t = setTimeout(() => setSearchQuery(searchInput), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const loadWorkload = useCallback(async (params) => {
    try {
      setWorkload(await getPOWorkload(params));
      setWorkloadError(null);
    } catch (e) {
      setWorkloadError(e?.message || 'Failed to load purchase orders');
    } finally {
      setLoading(false);
    }
  }, [getPOWorkload]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (cancelled) return;
      await loadWorkload({ search: searchQuery || undefined });
    })();
    return () => { cancelled = true; };
  }, [loadWorkload, searchQuery, poVersion]);

  // Rows come from the SAME workload object the cards count. One PO = one entry
  // regardless of how many items it has.
  const rows = useMemo(() => {
    if (!workload) return [];
    if (tab === 'receiving') return workload.receivingDue;
    if (tab === 'completed') return workload.completed;
    return workload.inProgress;
  }, [workload, tab]);

  const toggleExpanded = (poNumber) =>
    setExpandedPoNumber((current) => (current === poNumber ? null : poNumber));

  // Switching section collapses, so an open PO is never inherited by a tab that
  // may not even list it.
  const selectTab = (next) => {
    setTab(next);
    setExpandedPoNumber(null);
  };

  const openTracker = async (poNumber) => {
    setTrackerPoNumber(poNumber);
    setTrackerData(null);
    try {
      setTrackerData(await getPOTracker(poNumber));
    } catch (e) {
      setTrackerData(null);
    }
  };

  if (loading) {
    return (
      <div className="bg-white rounded-lg p-6">
        <div className="mb-8">
          <h1 className="m-0 text-3xl max-md:text-2xl text-[#333] font-bold">Purchase Orders</h1>
        </div>
        <TableSkeleton columns={COLUMNS} />
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg p-6">
      <div className="mb-8">
        <h1 className="m-0 text-3xl max-md:text-2xl text-[#333] font-bold">Purchase Orders</h1>
        <p className="mt-2 mx-0 mb-0 text-sm text-[#666]">
          Confirm what physically arrived. Receiving records quantity only &mdash; the supplier delivers
          outside CARDS.
        </p>
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] max-md:grid-cols-1 gap-5 mb-6">
        <StatCard label={TABS.receiving.label} count={workload?.receivingDuePOs ?? 0} description="POs with units still to receive" color="tabBlue" isActive={tab === 'receiving'} onClick={() => selectTab('receiving')} />
        <StatCard label={TABS['in-progress'].label} count={workload?.inProgressCount ?? 0} description="Open purchase orders" color="tabGreen" isActive={tab === 'in-progress'} onClick={() => selectTab('in-progress')} />
        <StatCard label={TABS.completed.label} count={workload?.completedCount ?? 0} description="Fully purchased and received" color="tabGreen" isActive={tab === 'completed'} onClick={() => selectTab('completed')} />
      </div>

      <div className="mb-4">
        <h2 className="m-0 text-lg text-[#333] font-bold">{TABS[tab].label}</h2>
        <p className="mt-1 mx-0 mb-0 text-[13px] text-[#999]">{TABS[tab].sub}</p>
      </div>

      {workloadError && <p className="text-[13px] text-[#c62828]">{workloadError}</p>}

      <SearchInput placeholder="Search PO number, item or supplier..." value={searchInput} onChange={(e) => setSearchInput(e.target.value)} />

      <div className={`mt-4 ${tableShell}`}>
        <div className={tableScroller}>
          <table className={`${tableEl} min-w-[1100px]`}>
            <thead className={theadEl}>
              <tr>
                {COLUMNS.map((h) => (
                  <th key={h} className={NUMERIC_COLUMNS.includes(h) ? thNumEl : thEl}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length > 0 ? (
                <>
                  {rows.map((po, index) => {
                    const expanded = expandedPoNumber === po.poNumber;
                    const t = po.totals ?? {};
                    return (
                      <React.Fragment key={po.poNumber}>
                        <tr
                          onClick={() => toggleExpanded(po.poNumber)}
                          aria-expanded={expanded}
                          title={expanded ? 'Collapse purchase order' : 'Expand to see its items'}
                          className={`${trEl} ${trHover} cursor-pointer ${expanded ? trSelected : stripeAt(index)}`}
                        >
                          <td className="p-4 whitespace-nowrap">
                            <div className="flex items-center gap-2">
                              <span className="text-[#bbb] text-[10px] leading-none" aria-hidden="true">{expanded ? '\u25be' : '\u25b8'}</span>
                              <span className={metaSub}>{po.date}</span>
                            </div>
                          </td>
                          <td className={`${tdPrimary} whitespace-nowrap`}>{po.poNumber}</td>
                          <td className={`${tdEl} whitespace-nowrap`}>{po.mrsNo}</td>
                          <td className="p-4 text-[#333] text-right tabular-nums">{t.approved}</td>
                          <td className="p-4 text-[#333] text-right tabular-nums">{t.purchased}</td>
                          <td className="p-4 text-[#333] text-right tabular-nums">{t.received}</td>
                          <td className={`p-4 text-right tabular-nums font-bold ${t.receivingOutstanding ? 'text-[#006680]' : 'text-[#2e7d32]'}`}>
                            {t.receivingOutstanding}
                          </td>
                          <td className={tdEl}>{po.supplier || <span className="text-[#bbb]">&mdash;</span>}</td>
                          <td className="p-4 whitespace-nowrap"><StatusBadge status={po.statusLabel} /></td>
                          <td className="p-4 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                            {po.receivingDue ? (
                              <button onClick={() => setReceivePoNumber(po.poNumber)} className={actionPrimary}>
                                Receive
                              </button>
                            ) : (
                              <button onClick={() => setTrackerPoNumber(po.poNumber)} className={actionPrimary}>
                                View
                              </button>
                            )}
                            <button onClick={() => openTracker(po.poNumber)} className={`${actionSecondary} ml-2`}>
                              Track
                            </button>
                          </td>
                        </tr>

                        {expanded && (
                          <tr className={`${trEl} ${nestedPanel}`}>
                            <td colSpan={COL_SPAN} className="p-0">
                              <div className="px-5 py-4">
                                <h3 className={`m-0 mb-1 ${metaLabel}`}>THIS PURCHASE ORDER</h3>
                                <p className="mt-0 mb-3 text-[11px] text-[#888]">
                                  Receiving is recorded against this purchase order, capped at what was bought
                                  for it. A purchase order can carry several items.
                                </p>
                                {/* The shared item tracker, in its warehouse shape. This
                                    table used to be written out here, and a second time
                                    in the tracker modal below. */}
                                <POQuantityTracker
                                  variant="receiving"
                                  tracker={{ poNumber: po.poNumber, items: po.itemLines ?? [], totals: po.totals }}
                                />
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </>
              ) : (
                <EmptyState
                  colSpan={COL_SPAN}
                  message={tab === 'receiving' ? 'Nothing is waiting to be received' : 'No purchase orders found'}
                  hint={searchQuery ? `Nothing matches "${searchQuery}". Clear the search to see every purchase order.` : null}
                />
              )}
            </tbody>
          </table>
        </div>
      </div>
      <p className="mt-2 text-right text-xs text-[#999]">
        {tab === 'receiving'
          ? `${workload?.receivingDuePOs ?? 0} purchase order(s) awaiting receiving`
          : `${rows.length} purchase order(s)`}
      </p>

      {receivePoNumber && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-[1000] overflow-y-auto py-6 px-4">
          <div className="bg-white rounded-xl w-full max-w-[640px] max-h-[90vh] overflow-y-auto shadow-[0_10px_30px_rgba(0,0,0,0.15)]">
            <ReceivePOForm poNumber={receivePoNumber} onClose={() => setReceivePoNumber(null)} />
          </div>
        </div>
      )}

      {trackerPoNumber && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-[1000] overflow-y-auto py-6 px-4">
          <div className="bg-white rounded-xl w-full max-w-[640px] max-h-[90vh] overflow-y-auto shadow-[0_10px_30px_rgba(0,0,0,0.15)] p-6 text-left">
            <div className="flex justify-between items-center border-b border-[#eee] pb-3 mb-4">
              <h2 className="m-0 text-lg font-bold text-[#333]">Quantity Tracker &mdash; {trackerPoNumber}</h2>
              <button className="text-2xl text-[#888]" onClick={() => { setTrackerPoNumber(null); setTrackerData(null); }}>&times;</button>
            </div>
            {trackerData ? (
              <>
                {/* Read straight off the tracker payload; nothing is derived here. */}
                <p className="m-0 mb-3 text-[12px] text-[#666]">
                  <span className="font-bold">PO </span>{trackerData.poNumber}
                  {' '}&middot; <span className="font-bold">Supplier </span>{trackerData.supplier || '—'}
                  {' '}&middot; <span className="font-bold">Status </span>{trackerData.statusLabel}
                </p>
                <POQuantityTracker variant="receiving" tracker={trackerData} />
              </>
            ) : (
              <p className="text-[13px] text-[#666]">Loading…</p>
            )}
            <div className="flex justify-end gap-3 mt-4 pt-4 border-t border-[#eee]">
              <button onClick={() => { setTrackerPoNumber(null); setTrackerData(null); }} className={`${actionSecondary} py-2.5 px-6`}>Close</button>
              <button
                onClick={() => { const n = trackerPoNumber; setTrackerPoNumber(null); setTrackerData(null); setReceivePoNumber(n); }}
                className="py-2.5 px-6 bg-[#006680] text-white rounded-md text-xs font-semibold cursor-pointer transition-all duration-200 hover:bg-[#00536b]"
              >
                Record Receiving
              </button>
            </div>
          </div>
        </div>
      )}

      {receiptPo && (
        <MaterialRequestReceipt po={receiptPo} onClose={() => setReceiptPo(null)} />
      )}
    </div>
  );
}

export default PurchaseOrdersView;
