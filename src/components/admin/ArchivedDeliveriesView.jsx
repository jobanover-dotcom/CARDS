'use client';
import React, { useState, useEffect, useCallback } from 'react';
import StatusBadge from '../ui/StatusBadge';
import SearchInput from '../ui/SearchInput';
import EmptyState from '../ui/EmptyState';
import TableSkeleton from '../ui/TableSkeleton';
import {
  stripeAt,
  tableEl,
  tableScroller,
  tableShell,
  tdEl,
  tdNum,
  tdPrimary,
  thEl,
  thNumEl,
  theadEl,
  trEl,
  trHover,
} from '../ui/tableTheme';
import { getArchivedDeliveries } from '../../../actions/deliveries';
import { deliveryStatusLabel } from '../../lib/deliveryStatus';

// Read-only archive of historical Delivery (DEL-xxxx) records.
//
// The active workflow does not create delivery records: the supplier is
// external to CARDS and delivers on its own schedule, and the warehouse
// records receiving directly against the purchase order. These rows are
// preserved for historical record and are visible to purchasers and
// superadmins only — nothing here can be created, edited or advanced.
//
// Reachable by URL only. It is deliberately absent from the Purchaser/Admin
// sidebar, because these rows describe a step CARDS no longer records.
const COLUMNS = ['Delivery No.', 'PO No.', 'Supplier', 'Delivery Date', 'Status', 'Items', 'Delivered', 'Received'];
const COL_SPAN = COLUMNS.length;
const NUMERIC_COLUMNS = ['Delivered', 'Received'];

function ArchivedDeliveriesView() {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getArchivedDeliveries({ search: search || undefined, limit: 50 });
      setRows(res.rows);
      setTotal(res.total);
      setError(null);
    } catch (e) {
      setError(e?.message || 'Failed to load archived deliveries');
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <div className="bg-white rounded-lg p-6">
        <div className="mb-6">
          <h1 className="m-0 text-3xl max-md:text-2xl text-[#333] font-bold">Archived Deliveries</h1>
        </div>
        <TableSkeleton columns={COLUMNS} rows={4} />
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg p-6">
      <div className="mb-6">
        <h1 className="m-0 text-3xl max-md:text-2xl text-[#333] font-bold">Archived Deliveries</h1>
        <p className="mt-2 mx-0 mb-0 text-sm text-[#666]">
          Historical delivery records, preserved read-only. CARDS no longer creates delivery records &mdash;
          supplier delivery happens outside the system.
        </p>
      </div>

      <SearchInput
        placeholder="Search delivery no., PO no. or supplier..."
        value={searchInput}
        onChange={(e) => setSearchInput(e.target.value)}
      />

      {error && <p className="mt-4 text-[13px] text-[#c62828]">{error}</p>}

      <div className={`mt-4 ${tableShell}`}>
        {loading ? (
          <TableSkeleton columns={COLUMNS} rows={4} />
        ) : (
          <div className={tableScroller}>
            <table className={`${tableEl} min-w-[900px]`}>
              <thead className={theadEl}>
                <tr>
                  {COLUMNS.map((h) => (
                    <th key={h} className={NUMERIC_COLUMNS.includes(h) ? thNumEl : thEl}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.length > 0 ? (
                  <>
                    {rows.map((d, index) => {
                      const items = d.items || [];
                      const itemSummary = items.length
                        ? `${items[0].poItem?.itemDescription || '—'}${items.length > 1 ? ` +${items.length - 1} more` : ''}`
                        : '—';
                      const delivered = items.reduce((s, it) => s + (it.deliveredQty || 0), 0);
                      const received = items.reduce((s, it) => s + (it.receivedQty || 0), 0);
                      return (
                        <tr key={d.id} className={`${trEl} ${trHover} ${stripeAt(index)}`}>
                          <td className={`${tdPrimary} whitespace-nowrap`}>{d.deliveryNumber}</td>
                          <td className={`${tdEl} whitespace-nowrap`}>{d.poNumber}</td>
                          <td className={tdEl}>{d.supplier}</td>
                          <td className={`${tdEl} whitespace-nowrap`}>
                            {d.deliveryDate ? new Date(d.deliveryDate).toLocaleDateString() : <span className="text-[#bbb]">&mdash;</span>}
                          </td>
                          <td className="p-4 whitespace-nowrap">
                            <StatusBadge status={deliveryStatusLabel(d.status)} />
                          </td>
                          <td className={tdEl}>{itemSummary}</td>
                          <td className={tdNum}>{delivered}</td>
                          <td className={tdNum}>{received}</td>
                        </tr>
                      );
                    })}
                  </>
                ) : (
                  <EmptyState
                    colSpan={COL_SPAN}
                    message="No archived deliveries"
                    hint={search ? `Nothing matches "${search}". Clear the search to see every archived delivery.` : null}
                  />
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <p className="mt-2 text-right text-xs text-[#999]">
        {loading ? 'Loading archived deliveries\u2026' : `Loaded ${rows.length} of ${total} archived deliveries`}
      </p>
    </div>
  );
}

export default ArchivedDeliveriesView;
