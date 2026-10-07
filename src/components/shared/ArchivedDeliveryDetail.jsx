'use client';
import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { getDeliveryByNumber } from '../../../actions/deliveries';
import { deliveryStatusLabel } from '../../lib/deliveryStatus';
import StatusBadge from '../ui/StatusBadge';
import TableSkeleton from '../ui/TableSkeleton';
import {
  stripeAt,
  tableEl,
  tableScroller,
  tableShell,
  tdEl,
  tdNumSettled,
  tdNumStrong,
  tdNumDue,
  tdPrimary,
  thEl,
  thNumEl,
  theadEl,
  trEl,
} from '../ui/tableTheme';

// Read-only historical delivery record.
//
// The active workflow has no delivery step: the supplier is external to CARDS
// and the warehouse records receiving against the purchase order. This page
// exists so preserved DEL-xxxx records stay inspectable. Nothing here can be
// created, edited or advanced. Reachable by URL only; it is not in any sidebar.
const COLUMNS = ['Item', 'Purchased', 'Delivered', 'Received', 'Difference'];
const COL_SPAN = COLUMNS.length;
const NUMERIC_COLUMNS = ['Purchased', 'Delivered', 'Received', 'Difference'];
function ArchivedDeliveryDetail({ backHref }) {
  const params = useParams();
  const deliveryNumber = params?.deliveryNumber;
  const [delivery, setDelivery] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const d = await getDeliveryByNumber(deliveryNumber);
        if (cancelled) return;
        setDelivery(d);
        setError(d ? null : 'Delivery not found.');
      } catch (e) {
        if (!cancelled) setError(e?.message || 'Failed to load delivery.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [deliveryNumber]);

  return (
    <div className="bg-white rounded-lg p-6">
      <h1 className="m-0 text-2xl text-[#333] font-bold">Archived Delivery</h1>
      <p className="mt-2 mb-0 text-sm text-[#666]">
        Read-only archive. CARDS no longer creates delivery records &mdash; supplier delivery happens outside
        the system and the warehouse records receiving against the purchase order.
      </p>

      {loading && <div className="mt-4"><TableSkeleton columns={COLUMNS} rows={4} /></div>}
      {error && <p className="mt-4 text-[13px] text-[#c62828]">{error}</p>}

      {delivery && (
        <div className="mt-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-[13px]">
            <div>
              <div className="text-[10px] font-bold text-[#888] uppercase">Delivery No.</div>
              <div className="font-semibold">{delivery.deliveryNumber}</div>
            </div>
            <div>
              <div className="text-[10px] font-bold text-[#888] uppercase">PO No.</div>
              <div className="font-semibold">{delivery.poNumber}</div>
            </div>
            <div>
              <div className="text-[10px] font-bold text-[#888] uppercase">Supplier</div>
              <div className="font-semibold">{delivery.supplier}</div>
            </div>
            <div>
              <div className="text-[10px] font-bold text-[#888] uppercase">Status</div>
              <div><StatusBadge status={deliveryStatusLabel(delivery.status)} /></div>
            </div>
          </div>

          <div className={`mt-4 ${tableShell}`}>
            <div className={tableScroller}>
              <table className={`${tableEl} min-w-[640px]`}>
                <thead className={theadEl}>
                  <tr>
                    {COLUMNS.map((h) => (
                      <th key={h} className={NUMERIC_COLUMNS.includes(h) ? thNumEl : thEl}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(delivery.items || []).map((item, index) => (
                    <tr key={item.id} className={`${trEl} ${stripeAt(index)}`}>
                      <td className={`${tdPrimary}`}>{item.poItem?.itemDescription || <span className="text-[#bbb]">&mdash;</span>}</td>
                      <td className={tdNumStrong}>{item.purchasedQty}</td>
                      <td className={tdNumStrong}>{item.deliveredQty}</td>
                      <td className={tdNumStrong}>{item.receivedQty}</td>
                      {/* Short means more was delivered than arrived; it is
                          outstanding work, not a complete row. */}
                      <td className={item.receivedQty - item.deliveredQty < 0 ? tdNumDue : tdNumSettled}>
                        {item.receivedQty - item.deliveredQty}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <p className="mt-4 text-[13px]">
            <Link className="text-[#006680] font-semibold" href={backHref}>&larr; Back</Link>
          </p>
        </div>
      )}
    </div>
  );
}

export default ArchivedDeliveryDetail;
