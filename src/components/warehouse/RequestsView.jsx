'use client';
import React, { useState, useEffect } from 'react';
import StatusBadge from '../ui/StatusBadge';
import EmptyState from '../ui/EmptyState';
import CreateRequestModal from './CreateRequestModal';
import PageSkeleton from '../ui/PageSkeleton';
import TableScrollSentinel from '../ui/TableScrollSentinel';
import { useWarehouseData } from '../../context/WarehouseDataContext';
import { getRequests, getFollowUpMap } from '../../../actions/requests';
import { useInfiniteRows } from '../../hooks/useInfiniteRows';

function RequestsView() {
  const { requestVersion } = useWarehouseData();
  const [newRequestModal, setNewRequestModal] = useState(false);
  const [followUpReq, setFollowUpReq] = useState(null);
  const [followUpMap, setFollowUpMap] = useState({});

  const { rows: requestsList, total, initialLoading, loadingMore, hasMore, loadMore } =
    useInfiniteRows(getRequests, {}, requestVersion);

  useEffect(() => {
    if (requestsList.length === 0) return;
    let cancelled = false;
    getFollowUpMap(requestsList.map((r) => r.reqNumber), 'req')
      .then((map) => { if (!cancelled) setFollowUpMap(map); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [requestsList, requestVersion]);

  if (initialLoading) {
    return (
      <div className="bg-white rounded-lg p-6 text-left">
        <PageSkeleton statCards={0} />
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg p-6 text-left">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="m-0 text-3xl max-md:text-2xl text-[#333] font-bold">Requests</h1>
          <p className="mt-2 mx-0 mb-0 text-sm text-[#666]">Pending and active warehouse requests</p>
        </div>
        <button
          onClick={() => setNewRequestModal(true)}
          className="bg-[#1e3c72] text-white py-2 px-5 rounded-md text-sm font-semibold cursor-pointer border-none transition-all duration-300 hover:bg-[#2a5298] hover:shadow-[0_2px_8px_rgba(30,60,114,0.3)]"
        >
          Create Request
        </button>
      </div>

      <div className="border border-[#e0e0e0] rounded-lg overflow-hidden">
        <div className="overflow-x-auto max-h-[500px]">
          <table className="w-full min-w-[900px] border-collapse text-[13px]">
            <thead className="bg-[#f0f4f8] sticky top-0 z-10">
              <tr>
                {['Date', 'MRS No.', 'Items', 'Qty', 'Requested By', 'Approved', 'Balance', 'Status', 'Action'].map((h, i) => (
                  <th key={i} className="p-4 text-left font-bold text-[#555] border-b border-gray-200 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {requestsList.length > 0 ? (
                <>
                  {requestsList.map((req, index) => {
                    const items = req.items || [];
                    const totalQty = items.reduce((s, it) => s + it.qty, 0);
                    const hasApprovals = items.some((it) => it.approvedQty != null);
                    const totalApproved = hasApprovals ? items.reduce((s, it) => s + (it.approvedQty ?? 0), 0) : null;
                    const balance = totalApproved != null ? Math.max(0, totalQty - totalApproved) : null;
                    const itemSummary = items.length ? `${items[0].itemDescription}${items.length > 1 ? ` +${items.length - 1} more` : ''}` : '—';
                    const followUps = followUpMap[req.reqNumber] || [];
                    const blocking = followUps.find((f) => f.status !== 'Rejected') || null;
                    const lastRejected = !blocking && followUps.length > 0 ? followUps[0] : null;
                    const canFileFollowUp = req.status === 'Partially Approved' && balance > 0 && !blocking;
                    return (
                      <tr key={index} className={`border-b border-gray-200 ${balance > 0 ? 'bg-[#fff8e1]/60' : index % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}`}>
                        <td className="p-4 text-[#333] font-medium">{req.date}</td>
                        <td className="p-4 text-[#333] font-medium">{req.mrsNo}</td>
                        <td className="p-4 text-[#333] font-medium">
                          {itemSummary}
                          {req.followUpOfReqNumber && (
                            <span className="ml-2 px-2 py-0.5 rounded-full bg-[#ede7f6] text-[#5e35b1] text-[10px] font-bold align-middle" title={`Follow-up of request ${req.followUpOfReqNumber}`}>
                              Follow-up (Req)
                            </span>
                          )}
                          {req.followUpOfPoNumber && (
                            <span className="ml-2 px-2 py-0.5 rounded-full bg-[#fef5f5] text-[#c62828] text-[10px] font-bold align-middle border border-[#ffcdd2]" title={`Follow-up of PO ${req.followUpOfPoNumber} (short delivery)`}>
                              Follow-up (PO)
                            </span>
                          )}
                        </td>
                        <td className="p-4 text-[#333] font-medium">{totalQty}</td>
                        <td className="p-4 text-[#333] font-medium">{req.requestedBy}</td>
                        <td className="p-4 text-[#333] font-medium">{totalApproved ?? '—'}</td>
                        <td className={`p-4 font-bold ${balance > 0 ? 'text-[#ef6c00]' : 'text-[#333] font-medium'}`}>{balance ?? '—'}</td>
                        <td className="p-4"><StatusBadge status={req.status} /></td>
                        <td className="p-4">
                          {canFileFollowUp && (
                            <button
                              onClick={() => setFollowUpReq(req)}
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
                      </tr>
                    );
                  })}
                  <TableScrollSentinel colSpan={9} onLoadMore={loadMore} isLoadingMore={loadingMore} disabled={!hasMore} />
                </>
              ) : (
                <EmptyState colSpan={9} message="No requests found" />
              )}
            </tbody>
          </table>
        </div>
      </div>
      <p className="mt-2 text-right text-xs text-[#999]">Loaded {requestsList.length} of {total} requests</p>

      {newRequestModal && (
        <CreateRequestModal onClose={() => setNewRequestModal(false)} />
      )}

      {followUpReq && (
        <CreateRequestModal followUp={followUpReq} onClose={() => setFollowUpReq(null)} />
      )}
    </div>
  );
}

export default RequestsView;
