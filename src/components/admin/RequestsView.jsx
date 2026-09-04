'use client';
import React, { useState, useEffect, useMemo } from 'react';
import StatCard from '../ui/StatCard';
import SearchInput from '../ui/SearchInput';
import StatusBadge from '../ui/StatusBadge';
import EmptyState from '../ui/EmptyState';
import RequestDetailsModal from './RequestDetailsModal';
import PageSkeleton from '../ui/PageSkeleton';
import TableScrollSentinel from '../ui/TableScrollSentinel';
import { useAdminData } from '../../context/AdminDataContext';
import { getRequests } from '../../../actions/requests';
import { useInfiniteRows } from '../../hooks/useInfiniteRows';

function RequestsView() {
  const { requestCounts, requestVersion } = useAdminData();
  const [requestsSearchInput, setRequestsSearchInput] = useState('');
  const [requestsSearchQuery, setRequestsSearchQuery] = useState('');
  const [selectedRequestStatus, setSelectedRequestStatus] = useState('total');
  const [selectedRequest, setSelectedRequest] = useState(null);
  const [showRequestDetailsModal, setShowRequestDetailsModal] = useState(false);
  const [showRemarksModal, setShowRemarksModal] = useState(false);
  const [remarksToDisplay, setRemarksToDisplay] = useState('');
  const totalRequestsCount = requestCounts.total;

  useEffect(() => {
    const t = setTimeout(() => setRequestsSearchQuery(requestsSearchInput), 300);
    return () => clearTimeout(t);
  }, [requestsSearchInput]);

  const queryParams = useMemo(() => ({
    status: selectedRequestStatus !== 'total' ? selectedRequestStatus : undefined,
    search: requestsSearchQuery || undefined,
  }), [selectedRequestStatus, requestsSearchQuery]);

  const { rows: filteredRequests, total, initialLoading, loadingMore, hasMore, loadMore } =
    useInfiniteRows(getRequests, queryParams, requestVersion);

  const handleViewRejectedRemarks = (req) => {
    setRemarksToDisplay(req.remarks);
    setShowRemarksModal(true);
  };

  const handleOpenRequestDetails = (request) => {
    setSelectedRequest(request);
    setShowRequestDetailsModal(true);
  };

  if (initialLoading) {
    return (
      <div className="bg-white rounded-lg p-6">
        <PageSkeleton />
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg p-6">
      <div className="mb-8">
        <h1 className="m-0 text-3xl max-md:text-2xl text-[#333] font-bold">Requests</h1>
        <p className="mt-2 mx-0 mb-0 text-sm text-[#666]">Pending Requests from Warehouses</p>
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] max-md:grid-cols-2 gap-5 mb-8">
        <StatCard
          label="Total Requests"
          count={totalRequestsCount.toLocaleString()}
          color="blue"
          isActive={selectedRequestStatus === 'total'}
          onClick={() => setSelectedRequestStatus('total')}
        />
        <StatCard
          label="Pending"
          count={requestCounts.pending.toLocaleString()}
          color="yellow"
          isActive={selectedRequestStatus === 'Pending'}
          onClick={() => setSelectedRequestStatus(selectedRequestStatus === 'Pending' ? 'total' : 'Pending')}
        />
        <StatCard
          label="Rejected"
          count={requestCounts.rejected.toLocaleString()}
          color="red"
          isActive={selectedRequestStatus === 'Rejected'}
          onClick={() => setSelectedRequestStatus(selectedRequestStatus === 'Rejected' ? 'total' : 'Rejected')}
        />
        <StatCard
          label="Partially Approved"
          count={requestCounts.partiallyApproved.toLocaleString()}
          color="green"
          isActive={selectedRequestStatus === 'Partially Approved'}
          onClick={() => setSelectedRequestStatus(selectedRequestStatus === 'Partially Approved' ? 'total' : 'Partially Approved')}
        />
      </div>

      <div className="mt-8">
        <div className="mb-4">
          <h2 className="m-0 text-lg text-[#333] font-bold">
            {selectedRequestStatus === 'Pending' ? 'Pending Requests' : selectedRequestStatus === 'Rejected' ? 'Rejected Requests' : selectedRequestStatus === 'Partially Approved' ? 'Partially Approved Requests' : 'Total Requests'}
          </h2>
          <p className="mt-1 mx-0 mb-0 text-[13px] text-[#999]">
            {selectedRequestStatus === 'Pending' ? 'Warehouse requests awaiting approval' : selectedRequestStatus === 'Rejected' ? 'Rejected warehouse requests' : selectedRequestStatus === 'Partially Approved' ? 'Requests with an outstanding balance for follow-up' : 'All warehouse requests'}
          </p>
        </div>
        <SearchInput
          placeholder="Search MRS #..."
          value={requestsSearchInput}
          onChange={(e) => setRequestsSearchInput(e.target.value)}
        />
        <div className="mt-4 overflow-x-auto overflow-y-auto max-h-[500px] border border-[#e0e0e0] rounded-lg">
          <table className="w-full min-w-[900px] border-collapse text-[13px]">
            <thead>
              <tr>
                {['R date', 'MRS #', 'Items', 'Qty', 'Approved by', 'Requisitioner', 'Approved / Balance', 'Status'].map((h, i) => (
                  <th key={i} className="bg-gradient-to-r from-[#fff8e1] to-[#ffe0b2] p-4 text-left font-bold text-[#f57f17] border-b-2 border-[#f57f17]/30 sticky top-0 z-10">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredRequests.length > 0 ? (
                <>
                  {filteredRequests.map((req, index) => {
                    const items = req.items || [];
                    const totalQty = items.reduce((s, it) => s + it.qty, 0);
                    const hasApprovals = items.some((it) => it.approvedQty != null);
                    const totalApproved = hasApprovals ? items.reduce((s, it) => s + (it.approvedQty ?? 0), 0) : null;
                    const balance = totalApproved != null ? Math.max(0, totalQty - totalApproved) : null;
                    const itemSummary = items.length ? `${items[0].itemDescription}${items.length > 1 ? ` +${items.length - 1} more` : ''}` : '—';
                    return (
                      <tr key={index}
                        className={`border-b border-gray-200 transition-colors duration-150 cursor-pointer ${
                          req.status === 'Approved' ? 'bg-[#e8f5e9]' : req.status === 'Partially Approved' ? 'bg-[#fff8e1]' : req.status === 'Pending' ? 'bg-[#fff9e6]' : 'bg-[#ffebee]'
                        } hover:bg-[#f0f8fc]/50`}
                        onClick={() => {
                          if (req.status === 'Rejected') handleViewRejectedRemarks(req);
                          else if (req.status === 'Pending') handleOpenRequestDetails(req);
                        }}>
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
                        <td className="p-4 text-[#333] font-medium">{req.requisitioner}</td>
                        <td className={`p-4 font-medium whitespace-nowrap ${balance > 0 ? 'text-[#ef6c00] font-bold' : 'text-[#333]'}`}>
                          {totalApproved == null ? '—' : `${totalApproved} / ${totalQty}${balance > 0 ? ` · bal ${balance}` : ''}`}
                        </td>
                        <td className="p-4"><StatusBadge status={req.status} /></td>
                      </tr>
                    );
                  })}
                  <TableScrollSentinel colSpan={8} onLoadMore={loadMore} isLoadingMore={loadingMore} disabled={!hasMore} />
                </>
              ) : (
                <EmptyState colSpan={8} message="No requests found" />
              )}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-right text-xs text-[#999]">Loaded {filteredRequests.length} of {total} requests</p>
      </div>

      {showRequestDetailsModal && selectedRequest && (
        <RequestDetailsModal
          request={selectedRequest}
          onClose={() => { setShowRequestDetailsModal(false); setSelectedRequest(null); }}
        />
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

export default RequestsView;
