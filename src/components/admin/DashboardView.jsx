'use client';
import React, { useCallback, useEffect, useState } from 'react';
import StatCard from '../ui/StatCard';
import StatusBadge from '../ui/StatusBadge';
import DataTable from '../ui/DataTable';
import TableSkeleton from '../ui/TableSkeleton';
import Skeleton from '../ui/Skeleton';
import { PurchaseOutstanding, ReceivingOutstanding } from '../ui/QuantityIndicator';
import WarehouseFilter from './WarehouseFilter';
import ReportCards from './ReportCards';
import { useAdminData } from '../../context/AdminDataContext';
import { getDashboardOverview } from '../../../actions/procurement';

// Dashboard = OVERVIEW AND REPORTING CENTRE, not a second Purchase Orders page.
//
// What changed and why:
//
//   * The old 13-column PO table is gone. It duplicated the Purchase Orders page
//     and made the Dashboard a spreadsheet. Detailed PO management, expansion and
//     workflow actions live on Purchase Orders; nothing here performs a
//     purchase.
//   * The cards are the quantity-driven sections used by Purchase Orders, read
//     from the same server-side scan, so a card can never disagree with the PO
//     page. There is no "Incomplete" label and no legacy status filtering.
//   * The sections below are ITEM level, because "what needs attention" is a
//     question about quantities, not about parent POs.
//   * Reports export the complete filtered dataset; the in-page preview is
//     capped and always says how many rows it is hiding.
//
// Supplier delivery is out of scope. Nothing here tracks, confirms or chases a
// supplier shipment, and no column or control implies that CARDS does.

const SECTIONS = [
  { bucket: 'all', label: 'Total POs', color: 'slate', description: 'Every purchase order' },
  { bucket: 'pending_purchase', label: 'Pending Purchase', color: 'blue', description: 'Nothing bought yet' },
  { bucket: 'in_progress', label: 'In Progress', color: 'amber', description: 'Started, not finished' },
  { bucket: 'discrepancy', label: 'Discrepancies', color: 'red', description: 'Receiving discrepancy flagged' },
  { bucket: 'completed', label: 'Completed', color: 'green', description: 'All quantities received' },
];

// Workload sections. Each is an item-level answer to "what needs attention".
const WORKLOAD = [
  {
    key: 'receivingAttention',
    title: 'Receiving Attention',
    accent: 'amber',
    subtitle: 'Purchased units the warehouse still has to receive. Legitimate work, not a discrepancy.',
  },
  {
    key: 'pendingPurchase',
    title: 'Pending Purchase',
    accent: 'blue',
    subtitle: 'Approved units that still need to be bought.',
  },
  {
    key: 'discrepancies',
    title: 'Discrepancies',
    accent: 'red',
    subtitle: 'Items on a purchase order the existing receiving-discrepancy rule has flagged.',
  },
  {
    key: 'completed',
    title: 'Completed',
    accent: 'green',
    subtitle: 'Items fully purchased and fully received.',
  },
];

const ACCENT_CHIP = {
  amber: 'bg-[#fff8e1] text-[#f57f17] border-[#fdd835]',
  blue: 'bg-[#e3f2fd] text-[#1e3c72] border-[#90caf9]',
  red: 'bg-[#fef5f5] text-[#c62828] border-[#ef9a9a]',
  green: 'bg-[#e8f5e9] text-[#2e7d32] border-[#a5d6a7]',
};

// One definition per column, read by DataTable for BOTH the header and the
// cells. Alignment therefore lives next to the content it aligns with instead
// of being repeated in the <thead> and the <tbody>, where the two were free to
// disagree.
const ITEM_COLUMNS = [
  {
    key: 'poItem',
    label: 'PO / Item',
    cell: (r) => (
      <>
        <div className="font-semibold text-[#333] whitespace-nowrap">{r.poNumber}</div>
        <div className="text-[11px] text-[#777]">
          {r.itemDescription} <span className="text-[#999]">({r.unit})</span>
        </div>
      </>
    ),
  },
  { key: 'approvedQty', label: 'Approved', align: 'right', cell: (r) => r.approvedQty },
  { key: 'purchasedQty', label: 'Purchased', align: 'right', cell: (r) => r.purchasedQty },
  { key: 'receivedQty', label: 'Received', align: 'right', cell: (r) => r.receivedQty },
  {
    key: 'procurementOutstanding',
    label: 'To Purchase',
    align: 'right',
    cell: (r) => <PurchaseOutstanding value={r.procurementOutstanding} />,
  },
  {
    key: 'receivingOutstanding',
    label: 'To Receive',
    align: 'right',
    cell: (r) => <ReceivingOutstanding value={r.receivingOutstanding} />,
  },
  {
    key: 'itemStatusLabel',
    label: 'Status',
    nowrap: true,
    cell: (r) => <StatusBadge status={r.itemStatusLabel} />,
  },
];

function CardGridSkeleton() {
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] max-md:grid-cols-1 gap-4 mb-8">
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="border-2 border-[#e0e0e0] rounded-xl p-8 bg-white">
          <Skeleton className="h-4 w-24 mb-4" />
          <Skeleton className="h-10 w-14" />
        </div>
      ))}
    </div>
  );
}

function SectionTable({ rows }) {
  return (
    <DataTable
      variant="primary"
      columns={ITEM_COLUMNS}
      rows={rows}
      rowKey={(r, i) => `${r.poNumber}-${r.poItemId}-${i}`}
    />
  );
}

function DashboardView() {
  const { warehouses, poVersion } = useAdminData();
  const [selectedWarehouse, setSelectedWarehouse] = useState('');
  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // One call feeds the cards and every workload section, so they are always
  // describing the same rows. Re-runs on a warehouse change and whenever PO
  // quantities change elsewhere in the app.
  const load = useCallback(async () => {
    try {
      setOverview(await getDashboardOverview({ warehouse: selectedWarehouse || undefined, preview: 8 }));
      setError(null);
    } catch (e) {
      setError(e?.message || 'Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  }, [selectedWarehouse]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      if (cancelled) return;
      await load();
    })();
    return () => { cancelled = true; };
  }, [load, poVersion]);

  return (
    <div className="bg-white rounded-lg p-6">
      <div className="flex items-start justify-between mb-8 max-md:flex-col max-md:gap-4">
        <div>
          <h1 className="m-0 text-3xl max-md:text-2xl text-[#333] font-bold">Dashboard</h1>
          <p className="mt-2 mx-0 mb-0 text-sm text-[#666]">
            Procurement overview and reports &mdash; what is outstanding, what is flagged, and what can be exported
          </p>
        </div>
        <WarehouseFilter warehouses={warehouses} selected={selectedWarehouse} onChange={setSelectedWarehouse} />
      </div>

      {error && <p className="mb-4 text-[13px] text-[#c62828] font-semibold">{error}</p>}

      {loading ? (
        <CardGridSkeleton />
      ) : (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] max-md:grid-cols-1 gap-4 mb-8">
          {SECTIONS.map((s) => (
            <StatCard
              key={s.bucket}
              label={s.label}
              count={overview?.counts?.[s.bucket] ?? 0}
              description={s.description}
              color={s.color}
            />
          ))}
        </div>
      )}

      {overview?.truncated && (
        <p className="mb-4 text-[12px] text-[#e65100] font-semibold">
          The purchase-order scan limit was reached, so these counts may under-report. Exports are unaffected in
          structure but cover the same scanned set.
        </p>
      )}

      <div className="flex flex-col gap-4 mb-8">
        {WORKLOAD.map((section) => {
          const data = overview?.[section.key];
          return (
            <div key={section.key} className="border border-[#e0e0e0] rounded-xl overflow-hidden">
              <div className="flex flex-wrap justify-between items-center gap-2 px-4 py-3 bg-gray-50/60 border-b border-[#eee]">
                <div>
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded border ${ACCENT_CHIP[section.accent]}`}>
                      {section.title}
                    </span>
                    {data ? (
                      <span className="text-[11px] text-[#999]">
                        {data.itemCount} item{data.itemCount === 1 ? '' : 's'} across {data.poCount} PO{data.poCount === 1 ? '' : 's'}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 mb-0 text-[12px] text-[#888]">{section.subtitle}</p>
                </div>
              </div>
              {loading ? (
                <TableSkeleton columns={ITEM_COLUMNS.map((c) => c.label)} rows={4} />
              ) : data && data.preview.length ? (
                <>
                  <SectionTable rows={data.preview} />
                  {data.itemCount > data.preview.length && (
                    <p className="p-3 m-0 text-[11px] text-[#999] text-center">
                      Showing {data.preview.length} of {data.itemCount} items &mdash; use the Reports section below for the full dataset.
                    </p>
                  )}
                </>
              ) : (
                // Deliberately not the shared EmptyState component: that one
                // renders a table row, and this branch sits in a plain div with
                // no table, so a row element here would be relocated by the DOM
                // parser and fail hydration.
                <p className="p-6 m-0 text-center text-[12px] text-[#999]">
                  Nothing in {section.title}
                </p>
              )}
            </div>
          );
        })}
      </div>

      <ReportCards warehouse={selectedWarehouse} />
    </div>
  );
}

export default DashboardView;
