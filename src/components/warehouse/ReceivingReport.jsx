'use client';

import { useEffect, useState } from 'react';

import { useWarehouseData } from '../../context/WarehouseDataContext';
import { actionSecondary } from '../ui/tableTheme';

function fmtDateTime(value) {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleString();
}

/**
 * Printable Receiving Report for one COMPLETED purchase order.
 *
 * A read-only snapshot: PO header (including the supplier's RR/DR number), the
 * per-item purchased/received totals, every receiving event newest-first with
 * its per-line from→to deltas, all discrepancies (open and resolved), and the
 * receiving remarks. Rendered from getReceivingReport() — the same history and
 * discrepancy rows the PO screen shows — and it performs no write of any kind.
 *
 * Printing uses window.print() with the `@media print` rules in
 * src/styles/globals.css: only the `.receiving-report` document prints, and
 * everything marked `.no-print` (this bar, the Close button) is hidden.
 */
export default function ReceivingReport({ poNumber, onClose }) {
  const { getReceivingReport } = useWarehouseData();
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await getReceivingReport(poNumber);
        if (!cancelled) setReport(data);
      } catch (e) {
        if (!cancelled) setError(e?.message || 'Failed to load the receiving report.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [poNumber, getReceivingReport]);

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-[1000] overflow-y-auto py-6 px-4">
      <div className="bg-white rounded-xl w-full max-w-[760px] max-h-[90vh] overflow-y-auto shadow-[0_10px_30px_rgba(0,0,0,0.15)] p-6 text-left">
        <div className="no-print flex justify-between items-center border-b border-[#eee] pb-3 mb-4">
          <h2 className="m-0 text-lg font-bold text-[#333]">Receiving Report &mdash; {poNumber}</h2>
          <button className="text-2xl text-[#888]" onClick={onClose} aria-label="Close">&times;</button>
        </div>

        {loading ? (
          <p className="text-[13px] text-[#666]">Loading…</p>
        ) : error ? (
          <p className="text-[13px] font-semibold text-[#c62828]">{error}</p>
        ) : report ? (
          <div className="receiving-report text-[#333]">
            <div className="text-center border-b-2 border-[#333] pb-3 mb-4">
              <h1 className="m-0 text-xl font-bold">RECEIVING REPORT</h1>
              <p className="m-0 mt-1 text-[13px]">
                PO <strong>{report.po.poNumber}</strong>
                {' '}· Supplier RR/DR <strong>{report.po.supplierRrDrNo || '— not recorded'}</strong>
              </p>
            </div>

            <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-[12px] mb-4">
              <div><strong>PO date:</strong> {report.po.date || '—'}</div>
              <div><strong>MRS No.:</strong> {report.po.mrsNo || '—'}</div>
              <div><strong>Supplier:</strong> {report.po.supplier || '—'}</div>
              <div><strong>Supplier address:</strong> {report.po.supplierAddress || '—'}</div>
              <div><strong>Warehouse:</strong> {report.po.warehouse || '—'}</div>
              <div><strong>Requisitioner:</strong> {report.po.requisitioner || '—'}</div>
              <div><strong>Approved by:</strong> {report.po.approvedBy || '—'}</div>
              <div><strong>Status:</strong> {report.po.statusLabel || '—'}</div>
            </div>

            <h3 className="text-[13px] font-bold mb-2">Items received</h3>
            <table className="w-full border-collapse text-[12px] mb-4">
              <thead>
                <tr className="text-left border-b border-[#333]">
                  <th className="py-1.5 pr-3">ITEM</th>
                  <th className="py-1.5 pr-3">UNIT</th>
                  <th className="py-1.5 pr-3 text-right">PURCHASED</th>
                  <th className="py-1.5 text-right">RECEIVED</th>
                </tr>
              </thead>
              <tbody>
                {report.items.map((it, i) => (
                  <tr key={i} className="border-b border-[#eee]">
                    <td className="py-1.5 pr-3">{it.itemDescription}</td>
                    <td className="py-1.5 pr-3">{it.unit}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{it.purchasedQty}</td>
                    <td className="py-1.5 text-right tabular-nums">{it.receivedQty}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <h3 className="text-[13px] font-bold mb-2">Receiving events (newest first)</h3>
            {report.receivingEvents.length === 0 ? (
              <p className="text-[12px] text-[#666]">No receiving events recorded.</p>
            ) : (
              report.receivingEvents.map((ev) => (
                <div key={ev.eventId} className="mb-3 text-[12px]">
                  <p className="m-0 mb-1 font-semibold">
                    {fmtDateTime(ev.createdAt)}{ev.actor ? ` — ${ev.actor}` : ''}
                  </p>
                  <table className="w-full border-collapse">
                    <tbody>
                      {ev.lines.map((l, i) => (
                        <tr key={i} className="border-b border-[#f1f1f1]">
                          <td className="py-1 pr-3">{l.itemDescription} <span className="text-[#888]">({l.unit})</span></td>
                          <td className="py-1 text-right tabular-nums whitespace-nowrap">
                            {l.fromQty} → <strong>{l.toQty}</strong> (+{l.delta})
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))
            )}

            {report.discrepancies.length > 0 && (
              <>
                <h3 className="text-[13px] font-bold mt-4 mb-2">Discrepancies</h3>
                {report.discrepancies.map((d, i) => (
                  <div key={i} className="mb-2 text-[12px]">
                    <p className="m-0">
                      <strong>{d.itemDescription}</strong> ({d.unit}) — {d.discrepancyType} [{d.status}]
                    </p>
                    {d.remarks && <p className="m-0 text-[#555]">Reported: {d.remarks} — {d.reportedBy}, {fmtDateTime(d.reportedAt)}</p>}
                    {d.status === 'resolved' && (
                      <p className="m-0 text-[#555]">Resolved: {d.resolution || '—'} — {d.resolvedBy || '—'}, {fmtDateTime(d.resolvedAt)}</p>
                    )}
                  </div>
                ))}
              </>
            )}

            {report.receivingRemarks.length > 0 && (
              <>
                <h3 className="text-[13px] font-bold mt-4 mb-2">Receiving remarks</h3>
                {report.receivingRemarks.map((r, i) => (
                  <p key={i} className="m-0 mb-1 text-[12px]">
                    {r.detail} <span className="text-[#888]">— {r.actor || '—'}, {fmtDateTime(r.createdAt)}</span>
                  </p>
                ))}
              </>
            )}

            <p className="mt-4 pt-2 border-t border-[#333] text-[11px] text-[#666]">
              Printed {new Date().toLocaleString()} from the CARDS receiving record. Read-only: viewing or
              printing this report changes nothing on the purchase order.
            </p>
          </div>
        ) : null}

        <div className="no-print flex justify-end gap-3 mt-4 pt-4 border-t border-[#eee]">
          <button onClick={onClose} className={`${actionSecondary} py-2.5 px-6`}>Close</button>
          <button
            onClick={() => window.print()}
            disabled={loading || !report}
            className="py-2.5 px-6 bg-[#006680] text-white rounded-md text-xs font-semibold cursor-pointer transition-all duration-200 hover:bg-[#00536b] disabled:opacity-60"
          >
            Print
          </button>
        </div>
      </div>
    </div>
  );
}
