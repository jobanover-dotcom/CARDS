'use client';
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import EmptyState from '../ui/EmptyState';
import PageSkeleton from '../ui/PageSkeleton';
import { getArchiveEntries, getArchiveSnapshot, restoreArchive } from '../../../actions/archive';
import * as XLSX from 'xlsx';

function ArchiveView() {
  const [entries, setEntries] = useState([]);
  const [initialLoading, setInitialLoading] = useState(true);
  const [error, setError] = useState(null);

  const [typeFilter, setTypeFilter] = useState('all');
  const [yearFilter, setYearFilter] = useState('');
  const [monthFilter, setMonthFilter] = useState('');

  const [selectedEntry, setSelectedEntry] = useState(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);

  const loadEntries = useCallback(async () => {
    try {
      const list = await getArchiveEntries();
      setEntries(list);
      setError(null);
    } catch (e) {
      setError(e.message || 'Failed to load archive');
    } finally {
      setInitialLoading(false);
    }
  }, []);

  useEffect(() => { loadEntries(); }, [loadEntries]);

  const years = useMemo(
    () => [...new Set(entries.map(e => new Date(e.clearedAt).getFullYear()))].sort((a, b) => b - a),
    [entries]
  );

  useEffect(() => {
    if (yearFilter && !years.includes(Number(yearFilter))) {
      setYearFilter('');
      setMonthFilter('');
    }
  }, [years, yearFilter]);

  const filteredEntries = entries.filter(e => {
    if (typeFilter !== 'all' && e.reason !== typeFilter) return false;
    if (yearFilter) {
      const d = new Date(e.clearedAt);
      if (d.getFullYear() !== Number(yearFilter)) return false;
      if (monthFilter && d.getMonth() + 1 !== Number(monthFilter)) return false;
    }
    return true;
  });

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  const handleDownload = async () => {
    setBusy(true);
    try {
      const snap = await getArchiveSnapshot(selectedEntry.id);
      const wb = XLSX.utils.book_new();

      const poHeaders = ['PO date', 'PO number', 'Item Description', 'Qty', 'Unit', 'Supplier Name', 'Requisitioner', 'MRS No.', 'Pick-up by', 'Status'];
      const poRows = (snap.poData || []).map(o => [
        o.date, o.poNumber, o.itemDescription, o.qty, o.unit,
        o.supplier, o.requisitioner, o.mrsNo, o.pickupBy, o.statusLabel || o.status,
      ]);
      const wsPO = XLSX.utils.aoa_to_sheet([poHeaders, ...poRows]);
      wsPO['!cols'] = [{ wch: 12 }, { wch: 16 }, { wch: 28 }, { wch: 8 }, { wch: 8 }, { wch: 20 }, { wch: 20 }, { wch: 14 }, { wch: 18 }, { wch: 14 }];
      XLSX.utils.book_append_sheet(wb, wsPO, 'Purchase Orders');

      const reqHeaders = ['Request Date', 'REQ No.', 'MRS No.', 'Item Description', 'Qty', 'Unit', 'Requested By', 'Requisitioner', 'Approved Qty', 'Status'];
      const reqRows = (snap.requestData || []).map(r => [
        r.date, r.reqNumber, r.mrsNo, r.itemDescription, r.qty, r.unit,
        r.requestedBy, r.requisitioner, r.approvedQty ?? '', r.status,
      ]);
      const wsReq = XLSX.utils.aoa_to_sheet([reqHeaders, ...reqRows]);
      wsReq['!cols'] = [{ wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 28 }, { wch: 8 }, { wch: 8 }, { wch: 18 }, { wch: 20 }, { wch: 12 }, { wch: 18 }];
      XLSX.utils.book_append_sheet(wb, wsReq, 'Requests');

      const d = new Date(snap.clearedAt);
      const ts = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      XLSX.writeFile(wb, `${snap.warehouseName.replace(/\s+/g, '_')}_${ts}_Archive.xlsx`);
      setSelectedEntry(null);
    } catch (e) {
      alert('Failed to download archive: ' + e.message);
    } finally {
      setBusy(false);
    }
  };

  const handleRestore = async () => {
    setBusy(true);
    try {
      const result = await restoreArchive(selectedEntry.id);
      setNotice(`Restored ${result.restoredPOs} purchase order(s) and ${result.restoredRequests} request(s)` +
        ((result.skippedPOs + result.skippedReqs) > 0
          ? ` — skipped ${result.skippedPOs} PO(s) and ${result.skippedReqs} request(s) already existing.`
          : '.'));
      setSelectedEntry(null);
    } catch (e) {
      alert('Failed to restore archive: ' + e.message);
    } finally {
      setBusy(false);
    }
  };

  if (initialLoading) {
    return (
      <div className="bg-white rounded-lg p-6 text-left">
        <PageSkeleton statCards={0} />
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg p-6 text-left">
      <div className="mb-8">
        <h1 className="m-0 text-3xl max-md:text-2xl text-[#333] font-bold">Archive</h1>
        <p className="mt-2 mx-0 mb-0 text-sm text-[#666]">Cleared and deleted warehouse records — restore or download anytime</p>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="p-2 border border-gray-300 rounded-md bg-white text-[13px]">
          <option value="all">All Types</option>
          <option value="deleted">Deleted Warehouse</option>
          <option value="reset">Cleared (Reset)</option>
        </select>
        <select
          value={yearFilter}
          onChange={(e) => { setYearFilter(e.target.value); setMonthFilter(''); }}
          className="p-2 border border-gray-300 rounded-md bg-white text-[13px]"
        >
          <option value="">All Years</option>
          {years.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <select
          value={monthFilter}
          onChange={(e) => setMonthFilter(e.target.value)}
          disabled={!yearFilter}
          className={`p-2 border border-gray-300 rounded-md bg-white text-[13px] ${!yearFilter ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
          <option value="">Whole Year</option>
          {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
        </select>
        <span className="ml-auto text-xs text-[#999]">{filteredEntries.length} entr{filteredEntries.length === 1 ? 'y' : 'ies'}</span>
      </div>

      {notice && (
        <div className="mb-4 p-3 bg-[#e8f5e9] text-[#2e7d32] border border-[#a5d6a7] rounded-md text-[13px] font-semibold">
          {notice}
        </div>
      )}

      {error && (
        <div className="mb-4 p-3 bg-[#ffebee] text-[#c62828] border border-[#ef9a9a] rounded-md text-[13px]">{error}</div>
      )}

      <div className="border border-[#e0e0e0] rounded-lg overflow-hidden">
        <table className="w-full min-w-[700px] border-collapse text-[13px]">
          <thead>
            <tr>
              {['Warehouse Name', 'Date of Clearing', 'Type', '# Purchase Orders', '# Requests'].map((h, i) => (
                <th key={i} className="bg-gradient-to-r from-[#ede7f6] to-[#d1c4e9] p-4 text-left font-bold text-[#4527a0] border-b-2 border-[#4527a0]/30 sticky top-0 z-10 whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredEntries.length > 0 ? filteredEntries.map((e, index) => (
              <tr
                key={e.id}
                onClick={() => setSelectedEntry(e)}
                className={`border-b border-gray-200 transition-colors duration-150 cursor-pointer ${index % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'} hover:bg-[#f5f0fa]/60`}
              >
                <td className="p-4">
                  <span className="text-[#333] font-semibold">{e.warehouseName}</span>
                </td>
                <td className="p-4 text-[#333]">
                  {new Date(e.clearedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
                </td>
                <td className="p-4">
                  <span className={`px-3 py-1 rounded-full text-[11px] font-bold border ${e.reason === 'deleted' ? 'bg-red-50 text-red-700 border-red-300' : 'bg-[#fff3e0] text-[#ef6c00] border-[#ffcc80]'}`}>
                    {e.reason === 'deleted' ? 'Deleted' : 'Cleared'}
                  </span>
                </td>
                <td className="p-4 text-[#333]">{e.poCount}</td>
                <td className="p-4 text-[#333]">{e.requestCount}</td>
              </tr>
            )) : (
              <EmptyState colSpan={5} message="No archived entries yet" />
            )}
          </tbody>
        </table>
      </div>

      {selectedEntry && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-[1000] animate-fade-in">
          <div className="bg-white rounded-xl w-full max-w-[420px] shadow-[0_10px_30px_rgba(0,0,0,0.15)] animate-slide-in p-6 text-left">
            <h2 className="m-0 text-lg font-bold text-[#333] mb-1">{selectedEntry.warehouseName}</h2>
            <p className="mt-0 mx-0 mb-4 text-xs text-[#999]">
              {selectedEntry.reason === 'deleted' ? 'Deleted warehouse' : 'Cleared by system reset'} · {new Date(selectedEntry.clearedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })} · {selectedEntry.poCount} POs · {selectedEntry.requestCount} requests
            </p>
            <p className="mt-0 mx-0 mb-5 text-[13px] text-[#555]">What would you like to do with this data?</p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setSelectedEntry(null)}
                disabled={busy}
                className="py-2.5 px-5 rounded-md text-sm font-semibold cursor-pointer bg-white text-[#555] border border-[#ccc] hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleDownload}
                disabled={busy}
                className="py-2.5 px-5 rounded-md text-sm font-semibold cursor-pointer bg-[#1e3c72] text-white border-none hover:bg-[#2a5298] disabled:opacity-60"
              >
                Download Excel
              </button>
              <button
                onClick={handleRestore}
                disabled={busy}
                className="py-2.5 px-5 rounded-md text-sm font-semibold cursor-pointer bg-[#2e7d32] text-white border-none hover:bg-[#1b5e20] disabled:opacity-60"
              >
                Restore
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default ArchiveView;
