'use client';
import React from 'react';
import StatusBadge from '../ui/StatusBadge';
import POQuantityTracker from '../shared/POQuantityTracker';
import {
  actionPrimary,
  actionPurchase,
  actionSecondary,
  metaLabel,
  metaSub,
  metaValue,
  nestedPanel,
  tdEl,
  tdStrong,
  trEl,
  trHover,
  trNested,
  trSelected,
} from '../ui/tableTheme';
import {
  PO_STATUS,
  poDisplayLabel,
  poLifecycle,
} from '../../lib/deliveryStatus';
import { PO_PROGRESS_LABEL } from '../../lib/deliveryQuantities';

// The purchase-order table has six columns. Both views render that same width —
// the MRS view groups POs under a material request without introducing a seventh
// column — so the expanded detail spans exactly what the header declares.
export const PO_COL_SPAN = 6;

// ONE purchase-order row, shared by both views on the Purchase Orders page:
//
//   POs view:  PO -> its items
//   MRS view:  MRS -> PO -> its items
//
// The MRS view is a presentation grouping of the same purchase orders, so the PO
// itself is not reimplemented here — it is this component, rendered once more
// under its material request. There is therefore exactly one place where a PO
// decides its own label, its cancellability, whether a purchase may still be
// recorded against it, and what its detail panel contains.
//
// Both <tr> elements are returned as a fragment so they stay DIRECT children of
// whatever <tbody> the calling view renders.

function MetaField({ label, value }) {
  if (!value) return null;
  return (
    <div>
      <div className={metaLabel}>{label}</div>
      <div className={metaValue}>{value}</div>
    </div>
  );
}

// Three ways to label a PO, matching the precedence its section was chosen by.
// Cancelled is administrative, not a quantity. A discrepancy is an exception, so
// it outranks the quantity stage and reads the same as the section it is listed
// under. Otherwise the label is the quantity-derived stage itself.
export function poRowStatusLabel(order) {
  if (poLifecycle(order.status) === PO_STATUS.CANCELLED.value) return poDisplayLabel(order.status);
  if (order.hasDiscrepancy) return 'Discrepancy';
  return PO_PROGRESS_LABEL[order.progressStage];
}

/**
 * @param order           a POBucketPageRow, exactly as the POs view renders
 * @param expanded        whether this PO's detail panel is open
 * @param nested          rendered indented beneath an MRS row
 * @param striped         zebra position within its sibling group
 * @param onToggle        expand / collapse
 * @param onPurchase      open Save Purchase (first purchase on this PO)
 * @param onFollowUp      open Follow-up Purchase (raises a NEW PO on the MRS)
 * @param onOpenReceipt   open the material request receipt
 * @param onOpenSupplierReceipts  open the supplier delivery receipts, when any
 */
function PORow({
  order,
  expanded,
  nested = false,
  striped = false,
  onToggle,
  onPurchase,
  onFollowUp,
  onOpenReceipt,
  onOpenSupplierReceipts,
}) {
  const isCancelled = poLifecycle(order.status) === PO_STATUS.CANCELLED.value;
  const statusLabel = poRowStatusLabel(order);

  // A PO is one purchasing transaction with one supplier, so the contextual action
  // depends on whether this PO already holds one:
  //
  //   nothing bought yet -> Save Purchase, recorded against THIS PO
  //   already bought     -> Follow-up Purchase, which raises a NEW PO on the MRS
  //
  // Eligibility is an MRS property, read from the requirement totals the server
  // attaches to every row: `approved - purchased across ALL the POs on that MRS`.
  // It must NOT come from this PO's own `totals` — with two POs on one MRS each
  // PO's per-PO shortfall is wrong by whatever its sibling already bought, which is
  // how a fully-purchased MRS kept offering a Follow-up Purchase on both of them.
  //
  // The balance is always the PROCUREMENT shortfall. Units bought but not yet
  // received are the warehouse's work and never justify buying more, so a fully
  // purchased MRS offers no purchasing action at all.
  const mrsOutstanding = order.mrsTotals?.procurementOutstanding ?? 0;
  const hasPurchase = order.totals.purchased > 0;
  const canPurchase = !isCancelled && mrsOutstanding > 0;
  const actionLabel = canPurchase ? (hasPurchase ? 'Follow-up Purchase' : 'Save Purchase') : null;
  const allowanceHint = `${mrsOutstanding} unit(s) of ${order.mrsNo || 'this material request'} are approved but not yet purchased`;

  // A nested row sits on the flat nested face so it reads as a child of the row
  // above it; a top-level row is striped like any other sibling list. Neither
  // colour encodes status — the badge in the row already does that, and a
  // status-washed background drowned out the hover entirely.
  const indent = nested ? 'pl-6' : '';
  const rowClass = [
    trEl,
    trHover,
    'cursor-pointer',
    expanded ? trSelected : nested ? trNested : striped ? 'bg-white' : 'bg-gray-50/50',
  ].join(' ');

  return (
    <React.Fragment>
      <tr
        onClick={() => onToggle(order.poNumber)}
        aria-expanded={expanded}
        title={expanded ? 'Collapse purchase order' : 'Expand to see items and actions'}
        className={`${rowClass} ${indent}`}
      >
        <td className="p-4 whitespace-nowrap">
          <div className="flex items-center gap-2">
            <span className="text-[#bbb] text-[10px] leading-none" aria-hidden="true">{expanded ? '▾' : '▸'}</span>
            <span className="text-[#333] font-semibold">{order.poNumber}</span>
          </div>
          {/* Date is context for the number, not its own column. */}
          <div className={`${metaSub} pl-[18px]`}>{order.date}</div>
        </td>
        <td className={tdStrong}>{order.requisitioner}</td>
        <td className={tdEl}>{order.supplier || <span className="text-[#bbb]">&mdash;</span>}</td>
        <td className={`${tdEl} whitespace-nowrap`}>
          {order.itemLines.length} item{order.itemLines.length === 1 ? '' : 's'}
        </td>
        <td className="p-4 whitespace-nowrap">
          {statusLabel ? <StatusBadge status={statusLabel} /> : <span className="text-[#bbb]">&mdash;</span>}
        </td>
        <td className="p-4 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
          {actionLabel === 'Follow-up Purchase' ? (
            <button onClick={() => onFollowUp(order.poNumber)} title={allowanceHint} className={actionPurchase}>
              Follow-up Purchase
            </button>
          ) : actionLabel === 'Save Purchase' ? (
            <button onClick={() => onPurchase(order.poNumber)} title={allowanceHint} className={actionPurchase}>
              Save Purchase
            </button>
          ) : (
            <button onClick={() => onToggle(order.poNumber)} className={actionPrimary}>
              {expanded ? 'Close' : 'View'}
            </button>
          )}
        </td>
      </tr>

      {expanded && (
        <tr className={`${trEl} ${nestedPanel}`}>
          <td colSpan={PO_COL_SPAN} className="p-0">
            <div className="px-5 py-4">
              <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] max-md:grid-cols-2 gap-x-4 gap-y-3 pb-4 mb-4 border-b border-[#eee]">
                <MetaField label="REQUISITIONER" value={order.requisitioner} />
                <MetaField label="SUPPLIER" value={order.supplier} />
                <MetaField label="SUPPLIER ADDRESS" value={order.supplierAddress} />
                <MetaField label="MRS NO." value={order.mrsNo} />
                <MetaField label="PO DATE" value={order.date} />
                <MetaField label="WAREHOUSE" value={order.warehouse} />
                <MetaField label="SOURCE REQUEST" value={order.sourceReqNumber} />
                <MetaField label="PICK-UP BY" value={order.pickupBy} />
                <MetaField label="APPROVED BY" value={order.approvedBy} />
                <MetaField label="LISTED BY" value={order.listedBy} />
                <MetaField label="APPROVAL / EXP DATE" value={order.poExpDate} />
              </div>

              <POQuantityTracker
                tracker={{
                  poNumber: order.poNumber,
                  items: order.itemLines,
                  totals: order.totals,
                }}
                variant="table"
                actionSlot={
                  <div className="flex flex-wrap gap-2 mt-4 pt-4 border-t border-[#eee]">
                    {/* The receipt is the source document this PO was raised from;
                        it is always available, whatever the quantities. */}
                    <button onClick={() => onOpenReceipt(order)} className={`${actionSecondary} py-2 px-4`}>
                      Material Request Receipt
                    </button>
                    {/* The supplier's own signed delivery receipt. Unlike the
                        MRS receipt above, this is not always there: it is attached
                        by the warehouse while receiving, so the button appears only
                        once there is something to open rather than leading to an
                        empty view. */}
                    {order.receiptCount > 0 && (
                      <button
                        onClick={() => onOpenSupplierReceipts(order)}
                        className={`${actionSecondary} py-2 px-4`}
                      >
                        Supplier Receipts ({order.receiptCount})
                      </button>
                    )}
                    {/* Purchasing is offered only while units remain to buy, and
                        then either against this PO for the first time, or as a
                        new PO on the same MRS. */}
                    {canPurchase && (
                      <button
                        onClick={() => (hasPurchase ? onFollowUp(order.poNumber) : onPurchase(order.poNumber))}
                        className="py-2 px-4 bg-[#006680] text-white rounded-md text-xs font-semibold cursor-pointer transition-all duration-200 hover:bg-[#00536b]"
                      >
                        {hasPurchase ? 'Follow-up Purchase' : 'Save Purchase'}
                      </button>
                    )}
                  </div>
                }
              />
            </div>
          </td>
        </tr>
      )}
    </React.Fragment>
  );
}

export default PORow;