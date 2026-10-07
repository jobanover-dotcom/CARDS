'use client';
import React, { useState, useEffect } from 'react';
import StatusBadge from '../ui/StatusBadge';
import EmptyState from '../ui/EmptyState';
import CreateRequestModal from './CreateRequestModal';
import TableSkeleton from '../ui/TableSkeleton';
import TableScrollSentinel from '../ui/TableScrollSentinel';
import {
  actionDisabled,
  actionPurchase,
  stripeAt,
  tableEl,
  tableScroller,
  tableShell,
  tdEl,
  tdNum,
  tdNumOutstanding,
  tdPrimary,
  tdStrong,
  thEl,
  thNumEl,
  theadEl,
  trEl,
  trHover,
} from '../ui/tableTheme';
import { useWarehouseData } from '../../context/WarehouseDataContext';
import { getRequests, getFollowUpMap } from '../../../actions/requests';
import { getMRSProgress } from '../../../actions/procurement';
import { requestApprovalOutstanding, REQUEST_STATUS } from '../../lib/requestApproval';
import { useInfiniteRows } from '../../hooks/useInfiniteRows';

const COLUMNS = ['Date', 'MRS No.', 'Items', 'Qty', 'Requested By', 'Approved', 'Balance', 'Status', 'MRS Progress', 'Action'];
const COL_SPAN = COLUMNS.length;
// The three quantity columns align to their own edge, header included.
const NUMERIC_COLUMNS = ['Qty', 'Approved', 'Balance'];

function RequestsView() {
  const { requestVersion } = useWarehouseData();
  const [newRequestModal, setNewRequestModal] = useState(false);
  const [followUpReq, setFollowUpReq] = useState(null);
  const [followUpMap, setFollowUpMap] = useState({});
  // Has the requirement behind each request actually been bought and received?
  // One material request can carry several purchase orders, so the request row on
  // its own can no longer say whether the work it asked for is finished. Receiving
  // itself still happens per purchase order; this is only the request-level answer.
  const [mrsProgress, setMrsProgress] = useState({});

  const { rows: requestsList, total, initialLoading, loadingMore, hasMore, loadMore } =
    useInfiniteRows(getRequests, {}, requestVersion);

  useEffect(() => {
    if (requestsList.length === 0) return;
    let cancelled = false;
    getFollowUpMap(requestsList.map((r) => r.reqNumber), 'req')
      .then((map) => { if (!cancelled) setFollowUpMap(map); })
      .catch(() => {});
    getMRSProgress(requestsList.map((r) => r.mrsNo))
      .then((res) => { if (!cancelled) setMrsProgress(res?.byMrsNo ?? {}); })
      .catch(() => { if (!cancelled) setMrsProgress({}); });
    return () => { cancelled = true; };
  }, [requestsList, requestVersion]);

  return (
    <div className="bg-white rounded-lg p-6 text-left">
      <div className="flex justify-between items-center mb-8 max-md:flex-col max-md:gap-4">
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

      <div className={tableShell}>
        {initialLoading ? (
          <TableSkeleton columns={COLUMNS} />
        ) : (
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
                {requestsList.length > 0 ? (
                  <>
                    {requestsList.map((req, index) => {
                      const items = req.items || [];
                      const totalQty = items.reduce((s, it) => s + it.qty, 0);
                      const hasApprovals = items.some((it) => it.approvedQty != null);
                      const totalApproved = hasApprovals ? items.reduce((s, it) => s + (it.approvedQty ?? 0), 0) : null;
                      const totalRejected = items.reduce((s, it) => s + (it.rejectedQty ?? 0), 0);
                      // Requested minus BOTH decided quantities. Counting only the
                      // approved side would leave a rejected remainder reading as
                      // outstanding, and would keep offering a follow-up for
                      // quantity the purchaser has already refused.
                      const balance = totalApproved != null ? requestApprovalOutstanding(items) : null;
                      const itemSummary = items.length ? `${items[0].itemDescription}${items.length > 1 ? ` +${items.length - 1} more` : ''}` : '—';
                      const followUps = followUpMap[req.reqNumber] || [];
                      const blocking = followUps.find((f) => f.status !== 'Rejected') || null;
                      const lastRejected = !blocking && followUps.length > 0 ? followUps[0] : null;
                      // Gated on the outstanding balance, not the status string. A closed request
                      // (remainder rejected) reports zero balance here, so the button
                      // disappears without needing to know about "Approval Closed".
                      const canFileFollowUp = req.status === REQUEST_STATUS.PARTIALLY_APPROVED.value && balance > 0 && !blocking;
                      // Procurement progress for THIS request's requirement, summed
                      // across every purchase order raised against it.
                      const progress = mrsProgress[req.mrsNo] ?? null;
                      return (
                        <tr key={req.reqNumber ?? index} className={`${trEl} ${trHover} ${stripeAt(index)}`}>
                          <td className={`${tdEl} whitespace-nowrap`}>{req.date}</td>
                          <td className={`${tdPrimary} whitespace-nowrap`}>
                            {req.mrsNo}
                            {/* Requirement progress, so one MRS with several POs
                                still reads as one requirement. */}
                            {progress && (
                              <div className="text-[10px] text-[#888]">
                                {progress.poCount} PO{progress.poCount === 1 ? '' : 's'} &middot; purchased{' '}
                                {progress.purchased} &middot; received {progress.received}
                              </div>
                            )}
                          </td>
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
                          <td className={tdNum}>{totalQty}</td>
                          <td className={tdStrong}>{req.requestedBy}</td>
                          <td className={tdNum}>{totalApproved ?? '\u2014'}</td>
                          <td className={totalRejected > 0 ? tdNum : balance > 0 ? tdNumOutstanding : tdNum}>
                            {/* When nothing was rejected this reads as the outstanding
                                balance exactly as before; when something was, the
                                rejected figure takes its place so the warehouse can see
                                why the balance closed. */}
                            {totalRejected > 0 ? `${totalRejected} rejected` : (balance ?? '\u2014')}
                          </td>
                          <td className="p-4 whitespace-nowrap"><StatusBadge status={req.status} /></td>
                          <td className="p-4 whitespace-nowrap">
                            {progress ? (
                              <div className="flex flex-col gap-1 items-start">
                                <StatusBadge status={progress.statusLabel} />
                                <span className="text-[10px] text-[#888]">
                                  {progress.receivingOutstanding > 0
                                    ? `${progress.receivingOutstanding} to receive`
                                    : progress.procurementOutstanding > 0
                                      ? `${progress.procurementOutstanding} to purchase`
                                      : 'Complete'}
                                </span>
                              </div>
                            ) : (
                              <span className="text-[#bbb]">&mdash;</span>
                            )}
                          </td>
                          <td className="p-4 whitespace-nowrap">
                            {canFileFollowUp && (
                              <button
                                onClick={() => setFollowUpReq(req)}
                                className={actionPurchase}
                              >
                                File Follow-Up
                              </button>
                            )}
                            {/* A follow-up that already exists is shown disabled
                                rather than hidden, so a missing button never
                                reads as a missing capability. */}
                            {blocking && (
                              <span
                                className={actionDisabled}
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
                    <TableScrollSentinel colSpan={COL_SPAN} onLoadMore={loadMore} isLoadingMore={loadingMore} disabled={!hasMore} />
                  </>
                ) : (
                  <EmptyState colSpan={COL_SPAN} message="No requests found" hint="Requests raised by this warehouse will appear here." />
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <p className="mt-2 text-right text-xs text-[#999]">
        {initialLoading ? 'Loading requests\u2026' : `Loaded ${requestsList.length} of ${total} requests`}
      </p>

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
