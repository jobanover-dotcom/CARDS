'use client';
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext';
import EmptyState from '../ui/EmptyState';
import PageSkeleton from '../ui/PageSkeleton';
import { getArchiveEntries, recordArchiveDownload, restoreArchive, getArchiveActivity, deleteArchiveEntry } from '../../../actions/archive';
import * as XLSX from 'xlsx';

const ACTION_BADGES = {
  archived: 'bg-red-50 text-red-700 border-red-300',
  restored: 'bg-[#e8f5e9] text-[#2e7d32] border-[#a5d6a7]',
  downloaded: 'bg-[#e3f2fd] text-[#1e3c72] border-[#90caf9]',
};

function ArchiveView() {
  const { user } = useAuth();
  const isSuperadmin = user?.role === 'Superadmin';
  const [entries, setEntries] = useState([]);
  const [activity, setActivity] = useState([]);
  const [initialLoading, setInitialLoading] = useState(true);
  const [error, setError] = useState(null);

  const [typeFilter, setTypeFilter] = useState('all');
  const [yearFilter, setYearFilter] = useState('');
  const [monthFilter, setMonthFilter] = useState('');

  const [selectedEntry, setSelectedEntry] = useState(null);
  const [showActivityLog, setShowActivityLog] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');

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

  const loadActivity = useCallback(async () => {
    try {
      setActivity(await getArchiveActivity());
    } catch {
      /* activity list is non-critical */
    }
  }, []);

  useEffect(() => { loadEntries(); loadActivity(); }, [loadEntries, loadActivity]);

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
      const snap = await recordArchiveDownload(selectedEntry.id);
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
      loadActivity();
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
          ? ` — skipped ${result.skippedPOs} duplicate PO(s) and ${result.skippedReqs} duplicate request(s).`
          : '.'));
      setSelectedEntry(null);
      loadEntries();
      loadActivity();
    } catch (e) {
      alert('Failed to restore archive: ' + e.message);
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    setBusy(true);
    try {
      const result = await deleteArchiveEntry(selectedEntry.id);
      setNotice(`Permanently deleted archive for ${result.deletedWarehouse} and all its activity logs.`);
      setSelectedEntry(null);
      setShowDeleteConfirm(false);
      setDeleteConfirmText('');
      loadEntries();
      loadActivity();
    } catch (e) {
      alert('Failed to delete archive: ' + e.message);
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
      <div className="flex items-start justify-between mb-8 max-md:flex-col max-md:gap-4">
        <div>
          <h1 className="m-0 text-3xl max-md:text-2xl text-[#333] font-bold">Archive</h1>
          <p className="mt-2 mx-0 mb-0 text-sm text-[#666]">Cleared and deleted warehouse records — restore or download anytime</p>
        </div>
        <button
          onClick={() => setShowActivityLog(true)}
          className="bg-[#1e3c72] text-white border-none py-2.5 px-5 rounded-md text-sm font-semibold cursor-pointer transition-all duration-200 hover:bg-[#2a5298] hover:shadow-[0_2px_8px_rgba(30,60,114,0.3)] whitespace-nowrap"
        >
          Activity Log
        </button>
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

      {showActivityLog && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-[1000] animate-fade-in p-4">
          <div className="bg-white rounded-xl w-full max-w-[860px] shadow-[0_10px_30px_rgba(0,0,0,0.15)] animate-slide-in p-6 text-left">
            <div className="flex justify-between items-center border-b border-[#eee] pb-3 mb-3">
              <h2 className="m-0 text-lg font-bold text-[#333] tracking-wide">Activity Log</h2>
              <button className="bg-none border-none text-2xl cursor-pointer text-[#888] hover:text-[#333] transition-colors duration-200 p-1 leading-none" onClick={() => setShowActivityLog(false)}>&times;</button>
            </div>
            <p className="mt-0 mx-0 mb-4 text-xs text-[#999]">Permanent record — kept even after system resets</p>
            <div className="border border-[#e0e0e0] rounded-lg overflow-hidden">
              <div className="overflow-x-auto overflow-y-auto max-h-[60vh]">
                <table className="w-full min-w-[700px] border-collapse text-[13px]">
                  <thead>
                    <tr>
                      {['Date & Time', 'Warehouse', 'Action', 'Details', 'By'].map((h, i) => (
                        <th key={i} className="bg-gradient-to-r from-[#f0f4f8] to-[#dce6f0] p-4 text-left font-bold text-[#1e3c72] border-b-2 border-[#1e3c72]/30 sticky top-0 z-10 whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {activity.length > 0 ? activity.map((a, index) => (
                      <tr key={a.id} className={`border-b border-gray-200 ${index % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}`}>
                        <td className="p-4 text-[#333] whitespace-nowrap">
                          {new Date(a.createdAt).toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </td>
                        <td className="p-4 text-[#333] font-semibold">{a.warehouseName}</td>
                        <td className="p-4">
                          <span className={`px-3 py-1 rounded-full text-[11px] font-bold border ${ACTION_BADGES[a.action] || 'bg-gray-100 text-gray-600 border-gray-300'}`}>
                            {a.action}
                          </span>
                        </td>
                        <td className="p-4 text-[#555]">{a.detail || '—'}</td>
                        <td className="p-4 text-[#333]">{a.actor || '—'}</td>
                      </tr>
                    )) : (
                      <EmptyState colSpan={5} message="No archive activity yet" />
                    )}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="flex justify-end mt-5">
              <button
                onClick={() => setShowActivityLog(false)}
                className="py-2.5 px-6 rounded-md text-sm font-semibold cursor-pointer transition-all duration-200 bg-white text-[#555] border border-[#ccc] hover:bg-gray-50"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedEntry && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-[1000] animate-fade-in">
          <div className="bg-white rounded-xl w-full max-w-[420px] shadow-[0_10px_30px_rgba(0,0,0,0.15)] animate-slide-in p-6 text-left relative">
            <button
              className="absolute top-4 right-4 bg-none border-none text-2xl cursor-pointer text-[#888] hover:text-[#333] transition-colors duration-200 p-1 leading-none"
              onClick={() => setSelectedEntry(null)}
            >
              &times;
            </button>
            <h2 className="m-0 text-lg font-bold text-[#333] mb-1">{selectedEntry.warehouseName}</h2>
            <p className="mt-0 mx-0 mb-4 text-xs text-[#999]">
              {selectedEntry.reason === 'deleted' ? 'Deleted warehouse' : 'Cleared by system reset'} · {new Date(selectedEntry.clearedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })} · {selectedEntry.poCount} POs · {selectedEntry.requestCount} requests
            </p>
            <p className="mt-0 mx-0 mb-5 text-[13px] text-[#555]">What would you like to do with this data?</p>
            <div className="flex flex-wrap justify-end gap-3">
              <button
                onClick={handleDownload}
                disabled={busy}
                className="py-2.5 px-5 rounded-md text-sm font-semibold cursor-pointer bg-[#1e3c72] text-white border-none hover:bg-[#2a5298] disabled:opacity-60"
              >
                Download
              </button>
              <button
                onClick={handleRestore}
                disabled={busy}
                className="py-2.5 px-5 rounded-md text-sm font-semibold cursor-pointer bg-[#2e7d32] text-white border-none hover:bg-[#1b5e20] disabled:opacity-60"
              >
                Restore
              </button>
              {isSuperadmin && (
                <button
                  onClick={() => setShowDeleteConfirm(true)}
                  disabled={busy}
                  className="py-2.5 px-5 rounded-md text-sm font-semibold cursor-pointer bg-[#d32f2f] text-white border-none hover:bg-[#b71c1c] disabled:opacity-60"
                >
                  Delete
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {showDeleteConfirm && selectedEntry && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-[1010] animate-fade-in">
          <div className="bg-white rounded-xl w-full max-w-[420px] shadow-[0_10px_30px_rgba(0,0,0,0.15)] animate-slide-in p-6 text-left">
            <h2 className="m-0 text-lg font-bold text-[#c62828] mb-3">Confirm Permanent Deletion</h2>
            <p className="mt-0 mx-0 mb-4 text-[13px] text-[#555] leading-relaxed">
              This will <strong>permanently delete</strong> the archive entry for <strong>{selectedEntry.warehouseName}</strong> 
              and <strong>all associated activity logs</strong>. This action cannot be undone.
            </p>
            <p className="mt-0 mx-0 mb-2 text-xs text-[#888]">Type <strong>DELETE</strong> to confirm:</p>
            <input
              type="text"
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              placeholder="DELETE"
              className="w-full py-2.5 px-3 border border-gray-300 rounded-md text-sm mb-5"
              disabled={busy}
            />
            <div className="flex justify-end gap-3">
              <button
                onClick={() => { setShowDeleteConfirm(false); setDeleteConfirmText(''); }}
                disabled={busy}
                className="py-2.5 px-5 rounded-md text-sm font-semibold cursor-pointer bg-white text-[#555] border border-[#ccc] hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={busy || deleteConfirmText !== 'DELETE'}
                className="py-2.5 px-5 rounded-md text-sm font-semibold cursor-pointer bg-[#d32f2f] text-white border-none hover:bg-[#b71c1c] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {busy ? 'Deleting…' : 'Yes, Delete Permanently'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default ArchiveView;
