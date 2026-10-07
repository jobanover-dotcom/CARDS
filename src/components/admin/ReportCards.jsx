'use client';
import React, { useState } from 'react';
import ExcelJS from 'exceljs';
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
        {r.hasDiscrepancy ? (
          <span className="ml-1"><QtyDiscrepancy value={r.qtyDiscrepancy} flagged /></span>
        ) : null}
      </>
    ),
  },
];

const argb = (rgb) => `FF${rgb}`;
const thinSide = (rgb) => ({ style: 'thin', color: { argb: argb(rgb) } });
const thinBorder = (rgb) => {
  const side = thinSide(rgb);
  return { top: side, left: side, bottom: side, right: side };
};

async function downloadWorkbook(wb, filename) {
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function isoOrBlank(value) {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

function ReportCard({ report, warehouse, expanded, onToggle, onExportCsv, rows, loading, rowCount }) {
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
              {rowCount > preview.length && (
                <p className="p-3 m-0 text-[11px] text-[#999] text-center">
                  Showing {preview.length} of {rowCount} rows &mdash; the export contains all {rowCount}.
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default function ReportCards({ warehouse }) {
  const [expanded, setExpanded] = useState(null);
  const [data, setData] = useState({});
  const [loading, setLoading] = useState(null);
  const [exporting, setExporting] = useState(null);
  const [workbookBusy, setWorkbookBusy] = useState(false);
  const [error, setError] = useState(null);

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
    try {
      const res = await getReportRows({ report, warehouse: warehouse || undefined });
      const def = reportDefinition(report);
      downloadCsv(toCsv(def.columns, res.rows), reportFilename(report));
    } catch (e) {
      setError(e?.message || 'Failed to export report');
    } finally {
      setExporting(null);
    }
  };

  // One workbook, four sheets. Every sheet is built from the same report rows the
  // CSV uses, so the two exports can never disagree.
  const exportWorkbook = async () => {
    setWorkbookBusy(true);
    setError(null);
    try {
      const wb = new ExcelJS.Workbook();
      wb.creator = 'CARDS';
      const headerStyle = {
        font: { bold: true, color: { argb: 'FFFFFFFF' } },
        fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3C72' } },
        border: thinBorder('999999'),
      };
      const cellStyle = { border: thinBorder('DDDDDD') };

      for (const report of REPORT_ORDER) {
        const res = await getReportRows({ report, warehouse: warehouse || undefined });
        const def = reportDefinition(report);
        const ws = wb.addWorksheet(def.name.slice(0, 31));
        ws.addRow([def.name]);
        ws.addRow([def.description]);
        if (warehouse) ws.addRow([`Warehouse: ${warehouse}`]);
        ws.addRow([]);
        ws.addRow(def.columns.map((c) => c.label));
        const headerRow = ws.rowCount;
        for (const r of res.rows) {
          ws.addRow(
            def.columns.map((c) => {
              const key = c.key;
              if (key === 'discrepancyFlag') return r.hasDiscrepancy === true ? 'Yes' : 'No';
              if (key === 'purchaseDate' || key === 'receivedDate') return isoOrBlank(r[key]);
              const v = r[key];
              if (v === null || v === undefined || v === '') return '';
              return v;
            }),
          );
        }
        ws.getRow(headerRow).eachCell({ includeEmpty: false }, (cell) => Object.assign(cell, headerStyle));
        for (let i = headerRow + 1; i <= ws.rowCount; i++) {
          ws.getRow(i).eachCell({ includeEmpty: false }, (cell) => Object.assign(cell, cellStyle));
        }
        def.columns.forEach((c, i) => {
          ws.getColumn(i + 1).width = c.numeric ? 14 : Math.min(Math.max(c.label.length + 6, 12), 34);
        });
      }

      const stamp = new Date().toISOString().slice(0, 10);
      await downloadWorkbook(wb, `CARDS_Reports_${stamp}.xlsx`);
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
            loading={loading === report || exporting === report}
          />
        ))}
      </div>
    </div>
  );
}

export { PREVIEW_COLUMNS };
