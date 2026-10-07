'use client';
import React, { useState, useEffect, useMemo } from 'react';
import StatCard from '../ui/StatCard';
import SearchInput from '../ui/SearchInput';
import StatusBadge from '../ui/StatusBadge';
import EmptyState from '../ui/EmptyState';
import RequestDetailsModal from './RequestDetailsModal';
import TableSkeleton from '../ui/TableSkeleton';
import TableScrollSentinel from '../ui/TableScrollSentinel';
import {
  actionDestructive,
  actionPrimary,
  actionSecondary,
  stripeAt,
  tableEl,
  tableScroller,
  tableShell,
  tdEl,
  tdPrimary,
  tdStrong,
  thEl,
  thNumEl,
  theadEl,
  trEl,
  trHover,
} from '../ui/tableTheme';
import { useAdminData } from '../../context/AdminDataContext';
import { useAuth } from '../../context/AuthContext';
import { getRequests } from '../../../actions/requests';
import { useInfiniteRows } from '../../hooks/useInfiniteRows';

const COLUMNS = ['R date', 'MRS #', 'Items', 'Qty', 'Approved by', 'Requisitioner', 'Approved / Balance', 'Status', 'Action'];
const COL_SPAN = COLUMNS.length;

function RequestsView() {
  const { requestCounts, requestVersion, deleteRequest } = useAdminData();
  const { user } = useAuth();
  // This component is shared by /admin and /purchaser, and the dashboard layout
  // checks only that someone is logged in, so this hides the control rather than
  // protecting it. The real boundary is the role check inside the server action.
  const isSuperadmin = user?.role === 'Superadmin';
  const [requestsSearchInput, setRequestsSearchInput] = useState('');
  const [requestsSearchQuery, setRequestsSearchQuery] = useState('');
  const [selectedRequestStatus, setSelectedRequestStatus] = useState('total');
  const [selectedRequest, setSelectedRequest] = useState(null);
  const [showRequestDetailsModal, setShowRequestDetailsModal] = useState(false);
  const [showRemarksModal, setShowRemarksModal] = useState(false);
  const [remarksToDisplay, setRemarksToDisplay] = useState('');
  const [deletingReqNumber, setDeletingReqNumber] = useState(null);
  const [deleteError, setDeleteError] = useState('');
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

  // What a row can be opened for. This mirrors the existing permissions exactly:
  // a pending request can be reviewed (approve / decline / raise a PO) and a
  // rejected one can show the remarks it was turned down with. An already
  // approved request has nothing to do here, so it gets no button rather than one
  // that opens a dead end.
  // Deletion is available on every status, including approved ones: an approved
  // request that was never turned into a PO is a legitimate thing for a
  // superadmin to clear. The server refuses when purchase orders still depend on
  // the request, and that message is surfaced rather than swallowed.
  const handleDeleteRequest = async (req) => {
    if (deletingReqNumber) return;
    const confirmed = window.confirm(
      `Are you sure you want to permanently delete request ${req.mrsNo} (${req.reqNumber}) and its ${req.items?.length ?? 0} item line(s)? This action cannot be undone.`,
    );
    if (!confirmed) return;

    setDeletingReqNumber(req.reqNumber);
    setDeleteError('');
    try {
      await deleteRequest(req.reqNumber);
    } catch (e) {
      setDeleteError(e?.message || 'Failed to delete request');
    } finally {
      setDeletingReqNumber(null);
    }
  };

  const rowAction = (req) => {
    if (req.status === 'Rejected') return { label: 'Remarks', run: handleViewRejectedRemarks, className: actionSecondary };
    if (req.status === 'Pending') return { label: 'Review', run: handleOpenRequestDetails, className: actionPrimary };
    return null;
  };

  const filtering = Boolean(requestsSearchQuery || selectedRequestStatus !== 'total');

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
          placeholder="Search MRS #, request or item..."
          value={requestsSearchInput}
          onChange={(e) => setRequestsSearchInput(e.target.value)}
        />
        {initialLoading ? (
          <TableSkeleton columns={COLUMNS} />
        ) : (
          <div className={`mt-4 ${tableShell}`}>
            <div className={tableScroller}>
              <table className={`${tableEl} min-w-[1000px]`}>
                <thead className={theadEl}>
                  <tr>
                    {COLUMNS.map((h) => (
                      <th key={h} className={['Qty', 'Approved / Balance'].includes(h) ? thNumEl : thEl}>{h}</th>
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
                        const itemSummary = items.length ? `${items[0].itemDescription}${items.length > 1 ? ` +${items.length - 1} more` : ''}` : '\u2014';
                        const action = rowAction(req);
                        return (
                          <tr
                            key={req.reqNumber ?? index}
                            className={`${trEl} ${trHover} ${stripeAt(index)} ${action ? 'cursor-pointer' : ''}`}
                            onClick={() => action?.run(req)}
                          >
                            <td className={`${tdEl} whitespace-nowrap`}>{req.date}</td>
                            <td className={`${tdPrimary} whitespace-nowrap`}>{req.mrsNo}</td>
                            <td className={tdEl}>
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
                            <td className="p-4 text-[#333] text-right tabular-nums">{totalQty}</td>
                            <td className={tdStrong}>{req.requestedBy}</td>
                            <td className={tdEl}>{req.requisitioner}</td>
                            <td className={`p-4 font-medium whitespace-nowrap text-right tabular-nums ${balance > 0 ? 'text-[#ef6c00] font-bold' : 'text-[#333]'}`}>
                              {totalApproved == null ? '\u2014' : `${totalApproved} / ${totalQty}${balance > 0 ? ` · bal ${balance}` : ''}`}
                            </td>
                            <td className="p-4 whitespace-nowrap"><StatusBadge status={req.status} /></td>
                            <td className="p-4 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                              <div className="flex items-center gap-2">
                                {action && (
                                  <button onClick={() => action.run(req)} className={action.className}>
                                    {action.label}
                                  </button>
                                )}
                                {isSuperadmin && (
                                  <button
                                    onClick={() => handleDeleteRequest(req)}
                                    disabled={deletingReqNumber === req.reqNumber}
                                    className={actionDestructive}
                                  >
                                    {deletingReqNumber === req.reqNumber ? 'Deleting…' : 'Delete'}
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                      <TableScrollSentinel colSpan={COL_SPAN} onLoadMore={loadMore} isLoadingMore={loadingMore} disabled={!hasMore} />
                    </>
                  ) : (
                    <EmptyState
                      colSpan={COL_SPAN}
                      message="No requests found"
                      hint={
                        requestsSearchQuery
                          ? `Nothing matches "${requestsSearchQuery}". Clear the search to see every request.`
                          : filtering
                            ? 'Choose "Total Requests" above to see every status.'
                            : 'Requests raised by a warehouse will appear here.'
                      }
                    />
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
        {deleteError && (
          <div className="mt-3 rounded-lg border border-[#ffcdd2] bg-[#fef5f5] px-4 py-3 text-[13px] text-[#c62828]">
            {deleteError}
          </div>
        )}
        <p className="mt-2 text-right text-xs text-[#999]">
          {initialLoading ? 'Loading requests\u2026' : `Loaded ${filteredRequests.length} of ${total} requests`}
        </p>
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
