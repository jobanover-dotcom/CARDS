'use client';
import React, { useState } from 'react';
import StatusBadge from '../ui/StatusBadge';
import DataTable from '../ui/DataTable';
import TableSkeleton from '../ui/TableSkeleton';
import { PurchaseOutstanding, ReceivingOutstanding, QtyDiscrepancy } from '../ui/QuantityIndicator';
import {
  downloadCsv,
  reportDefinition,
  reportFilename,
  toCsv,
  REPORT_ORDER,
} from '../../lib/reports';
import { getReportRows } from '../../../actions/procurement';
import { buildReportWorkbook, downloadWorkbook } from '../../lib/reportWorkbook';

// Dashboard reporting. Four reports, one card each.
//
// Each card states what the report contains and how many rows it holds, and
// expands into an item-level PREVIEW so an operator can see what they are about
// to export rather than trusting a button. The export itself always contains the
// complete filtered dataset — the preview is capped and says so.
//
// Cards are deliberately near-neutral with a single accent line, so a Reports
// block never reads as a row of status cards.

const ACCENTS = {
  slate: { border: 'border-l-[#546e7a]', chip: 'bg-[#eceff1] text-[#546e7a]' },
  blue: { border: 'border-l-[#1e3c72]', chip: 'bg-[#e3f2fd] text-[#1e3c72]' },
  amber: { border: 'border-l-[#f9a825]', chip: 'bg-[#fff8e1] text-[#f57f17]' },
  red: { border: 'border-l-[#c62828]', chip: 'bg-[#fef5f5] text-[#c62828]' },
  green: { border: 'border-l-[#2e7d32]', chip: 'bg-[#e8f5e9] text-[#2e7d32]' },
};

const PREVIEW_LIMIT = 25;
// DataTable reads `align` for both the header and the cells, so a quantity can
// never end up right-aligned under a left-aligned label.
const PREVIEW_COLUMNS = [
  {
    key: 'poNumber',
    label: 'PO / MRS',
    nowrap: true,
    cell: (r) => <span className="font-semibold text-[#333]">{r.poNumber ?? r.reqNumber}</span>,
  },
  { key: 'itemDescription', label: 'Item', cell: (r) => <span className="text-[#333]">{r.itemDescription}</span> },
  { key: 'approvedQty', label: 'Approved', align: 'right', cell: (r) => r.approvedQty ?? '—' },
  { key: 'purchasedQty', label: 'Purchased', align: 'right', cell: (r) => r.purchasedQty ?? '—' },
  { key: 'receivedQty', label: 'Received', align: 'right', cell: (r) => r.receivedQty ?? '—' },
  {
    key: 'procurementOutstanding',
    label: 'To Purchase',
    align: 'right',
    cell: (r) => <PurchaseOutstanding value={r.procurementOutstanding ?? 0} />,
  },
  {
    key: 'receivingOutstanding',
    label: 'To Receive',
    align: 'right',
    cell: (r) => <ReceivingOutstanding value={r.receivingOutstanding ?? 0} />,
  },
  {
    key: 'status',
    label: 'Status',
    nowrap: true,
    cell: (r) => (
      <>
        <StatusBadge status={r.itemStatusLabel ?? '—'} />
        {r.hasDiscrepancy || r.discrepancy ? (
          <span className="ml-1"><QtyDiscrepancy value={r.qtyDiscrepancy} flagged /></span>
        ) : null}
      </>
    ),
  },
  // The discrepancy columns below are empty on the Purchase Orders and
  // Monitoring reports, which is why they render as a dash rather than being
  // hidden: PREVIEW_COLUMNS is one definition shared by all four report cards,
  // and a card that showed a different set of columns per report would be
  // showing the purchaser something the export does not contain.
  {
    key: 'discrepancy',
    label: 'Discrepancy',
    cell: (r) =>
      r.discrepancy ? (
        <span className="text-[#c62828] font-semibold">{r.discrepancy.discrepancyType}</span>
      ) : (
        <span className="text-[#bbb]">&mdash;</span>
      ),
  },
  {
    key: 'discrepancyStatus',
    label: 'Flag Status',
    nowrap: true,
    cell: (r) =>
      r.discrepancy ? <StatusBadge status={r.discrepancy.statusLabel} /> : <span className="text-[#bbb]">&mdash;</span>,
  },
];

function ReportCard({ report, warehouse, expanded, onToggle, onExportCsv, rows, loading, rowCount, truncated }) {
  if (truncated === undefined) truncated = false;
  const def = reportDefinition(report);
  const accent = ACCENTS[def.accent] ?? ACCENTS.slate;
  const preview = (rows ?? []).slice(0, PREVIEW_LIMIT);

  return (
    <div className={`bg-white rounded-xl border border-[#e0e0e0] border-l-4 ${accent.border} overflow-hidden`}>
      <div className="p-5 flex flex-wrap justify-between gap-3 items-start">
        <div className="min-w-[220px]">
          <div className="flex items-center gap-2 mb-1">
            <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded ${accent.chip}`}>
              {report.replace(/_/g, ' ')}
            </span>
          </div>
          <h3 className="m-0 text-[15px] font-bold text-[#333]">{def.name}</h3>
          <p className="mt-1 mb-0 text-[12px] text-[#777] leading-relaxed max-w-[520px]">{def.description}</p>
          <p className="mt-2 mb-0 text-[11px] text-[#999]">
            {def.columns.length} columns &middot; one row per item
            {warehouse ? ` · scoped to ${warehouse}` : ' · all warehouses'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onExportCsv}
            disabled={loading}
            className="py-2 px-4 bg-[#1e3c72] text-white rounded-md text-xs font-semibold cursor-pointer transition-all duration-200 hover:bg-[#2a5298] disabled:opacity-60 disabled:cursor-not-allowed whitespace-nowrap"
          >
            {loading ? 'Preparing…' : 'Export CSV'}
          </button>
          <button
            onClick={onToggle}
            className="py-2 px-4 bg-white text-[#555] border border-[#ccc] rounded-md text-xs font-semibold cursor-pointer transition-all duration-200 hover:bg-[#f5f5f5] whitespace-nowrap"
          >
            {expanded ? 'Hide preview' : 'Preview'}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-[#eee]">
          {loading ? (
            <TableSkeleton columns={PREVIEW_COLUMNS.map((c) => c.label)} rows={5} />
          ) : (
            <>
              <DataTable
                variant="primary"
                columns={PREVIEW_COLUMNS}
                rows={preview}
                rowKey={(r, i) => `${r.poNumber ?? r.reqNumber}-${r.poItemId ?? r.itemId}-${i}`}
                minWidth="min-w-[900px]"
                empty={
                  <tr>
                    <td colSpan={PREVIEW_COLUMNS.length} className="p-6 text-center text-[#999]">
                      No rows for this report with the current filters.
                    </td>
                  </tr>
                }
              />
              {truncated ? (
                // The PO scan is bounded by WORKLOAD_SCAN_LIMIT. When the limit
                // was reached, `total` is itself an under-count, so neither the
                // preview note nor the export can truthfully claim completeness.
                <p className="p-3 m-0 text-[11px] text-[#e65100] font-semibold text-center">
                  The purchase-order scan limit was reached, so this preview and the export may be missing purchase orders.
                </p>
              ) : rowCount > preview.length ? (
                <p className="p-3 m-0 text-[11px] text-[#999] text-center">
                  Showing {preview.length} of {rowCount} rows &mdash; the export contains all {rowCount}.
                </p>
              ) : null}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Incomplete-export messaging (P6-01).
//
// The purchase-order scan is bounded by WORKLOAD_SCAN_LIMIT, so an export can
// legitimately cover only part of the matching data. The rule these messages
// follow: say what was actually downloaded, and never tell the user the complete
// dataset is available somewhere else — because it is not. The full set is only
// reachable by raising the scan limit in the server, which no button does.
// ---------------------------------------------------------------------------

/** The scan ceiling, restated for the user rather than hidden behind "may be incomplete". */
const SCAN_LIMIT_NOTE = 'The purchase-order scan limit was reached, so this dataset is incomplete.';

function confirmTruncatedCsv(report, rows) {
  return window.confirm(
    `${SCAN_LIMIT_NOTE}\n\n` +
      `The ${reportDefinition(report).name} CSV is about to download with ${rows} row(s) from the scanned ` +
      `subset only — purchase orders beyond the scan limit are not included.\n\n` +
      `Download it anyway?`,
  );
}

function truncatedCsvMessage(report, rows) {
  return `${SCAN_LIMIT_NOTE} The ${reportDefinition(report).name} CSV downloaded ${rows} row(s) from the ` +
    `scanned subset only.`;
}

function confirmTruncatedWorkbook(names, rows) {
  return window.confirm(
    `${SCAN_LIMIT_NOTE}\n\n` +
      `These sheets are incomplete: ${names.join(', ')}.\n` +
      `The workbook is about to download with ${rows} row(s) from the scanned subset only.\n\n` +
      `Download it anyway?`,
  );
}

function truncatedWorkbookMessage(names, rows) {
  return `${SCAN_LIMIT_NOTE} The workbook downloaded ${rows} row(s) from the scanned subset only; ` +
    `these sheets are incomplete: ${names.join(', ')}.`;
}

export default function ReportCards({ warehouse }) {
  const [expanded, setExpanded] = useState(null);
  const [data, setData] = useState({});
  const [loading, setLoading] = useState(null);
  const [exporting, setExporting] = useState(null);
  const [workbookBusy, setWorkbookBusy] = useState(false);
  const [error, setError] = useState(null);
  // A download that succeeded but is INCOMPLETE. Separate from `error` so an
  // incomplete export is never reported as a failure, and a real failure is never
  // dressed up as a warning.
  const [notice, setNotice] = useState(null);

  const toggle = async (report) => {
    if (expanded === report) {
      setExpanded(null);
      return;
    }
    setExpanded(report);
    setError(null);
    if (data[report]) return;
    setLoading(report);
    try {
      const res = await getReportRows({ report, warehouse: warehouse || undefined });
      setData((prev) => ({ ...prev, [report]: res }));
    } catch (e) {
      setError(e?.message || 'Failed to load report');
    } finally {
      setLoading(null);
    }
  };

  const exportCsv = async (report) => {
    setExporting(report);
    setError(null);
    setNotice(null);
    try {
      const res = await getReportRows({ report, warehouse: warehouse || undefined });
      // P6-01: `truncated` is a RELIABLE signal, not a guess from the row count.
      // The action fetches limit + 1 purchase orders and sets the flag when more
      // exist (collect(), WORKLOAD_SCAN_LIMIT), so `true` means the dataset is
      // genuinely partial and `false` means it is genuinely complete. It is
      // checked strictly === true so a complete export never shows a warning.
      if (res.truncated === true && !confirmTruncatedCsv(report, res.rows.length)) {
        setExporting(null);
        return;
      }
      const def = reportDefinition(report);
      downloadCsv(toCsv(def.columns, res.rows), reportFilename(report));
      if (res.truncated === true) {
        setNotice(truncatedCsvMessage(report, res.rows.length));
      }
    } catch (e) {
      setError(e?.message || 'Failed to export report');
    } finally {
      setExporting(null);
    }
  };

  // One workbook, four sheets. Every sheet is built by the shared builder in
  // src/lib/reportWorkbook.ts from the same report rows the CSV uses, so the two
  // exports can never disagree — and so the archive download (same builder, same
  // definitions) is column-for-column this workbook.
  const exportWorkbook = async () => {
    setWorkbookBusy(true);
    setError(null);
    setNotice(null);
    try {
      const sheets = [];
      // Each report is its own scan, so a workbook is complete only when EVERY
      // sheet is. One truncated sheet makes the whole file partial, and the user
      // is told which ones.
      const truncatedSheets = [];
      let truncatedRows = 0;
      for (const report of REPORT_ORDER) {
        const res = await getReportRows({ report, warehouse: warehouse || undefined });
        if (res.truncated === true) {
          truncatedSheets.push(reportDefinition(report).name);
          truncatedRows += res.rows.length;
        }
        sheets.push({ report, rows: res.rows });
      }
      if (truncatedSheets.length && !confirmTruncatedWorkbook(truncatedSheets, truncatedRows)) {
        setWorkbookBusy(false);
        return;
      }
      const blob = await buildReportWorkbook(sheets, {
        subtitle: warehouse ? `Warehouse: ${warehouse}` : null,
      });
      const stamp = new Date().toISOString().slice(0, 10);
      downloadWorkbook(blob, `CARDS_Reports_${stamp}.xlsx`);
      if (truncatedSheets.length) {
        setNotice(truncatedWorkbookMessage(truncatedSheets, truncatedRows));
      }
    } catch (e) {
      setError(e?.message || 'Failed to build workbook');
    } finally {
      setWorkbookBusy(false);
    }
  };

  return (
    <div>
      <div className="flex flex-wrap justify-between items-end gap-3 mb-4">
        <div>
          <h2 className="m-0 text-lg text-[#333] font-bold">Reports</h2>
          <p className="mt-1 mx-0 mb-0 text-[13px] text-[#999]">
            Item-level exports of the complete filtered dataset. Reporting only &mdash; purchase actions live on Purchase Orders.
          </p>
        </div>
        <button
          onClick={exportWorkbook}
          disabled={workbookBusy}
          className="py-2.5 px-5 bg-white text-[#1e3c72] border-2 border-[#90caf9] rounded-md text-xs font-semibold cursor-pointer transition-all duration-200 hover:bg-[#f0f8fc] disabled:opacity-60 disabled:cursor-not-allowed whitespace-nowrap"
        >
          {workbookBusy ? 'Building workbook…' : 'Export all (Excel)'}
        </button>
      </div>

      {error && <p className="mb-3 text-[13px] text-[#c62828] font-semibold">{error}</p>}
      {notice && (
        <p
          role="status"
          className="mb-3 text-[13px] text-[#e65100] font-semibold border-l-4 border-[#e65100] pl-2"
        >
          {notice}
        </p>
      )}

      <div className="flex flex-col gap-3">
        {REPORT_ORDER.map((report) => (
          <ReportCard
            key={report}
            report={report}
            warehouse={warehouse}
            expanded={expanded === report}
            onToggle={() => toggle(report)}
            onExportCsv={() => exportCsv(report)}
            rows={data[report]?.rows}
            rowCount={data[report]?.total ?? 0}
            truncated={data[report]?.truncated ?? false}
            loading={loading === report || exporting === report}
          />
        ))}
      </div>
    </div>
  );
}

export { PREVIEW_COLUMNS };
