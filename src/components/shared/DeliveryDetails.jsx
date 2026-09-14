'use client';
import React, { useEffect, useState } from 'react';
import StatusBadge from '../ui/StatusBadge';
import PageSkeleton from '../ui/PageSkeleton';
import { getDeliveryByNumber } from '../../../actions/deliveries';
import { getReceiptViewUrl } from '../../../actions/receipts';

const inputClass = 'py-2 px-3 border border-[#ccc] rounded-md text-[13px] text-[#333] focus:outline-none focus:border-[#006680] w-full box-border bg-gray-50';
const sectionTitle = 'm-0 text-xs font-bold text-[#555] uppercase tracking-wide';

const ACTION_LABELS = {
  purchase_confirmed: 'Purchase confirmed',
  ready_for_delivery: 'Marked ready for delivery',
  delivery_created: 'Delivery created',
  delivery_in_transit: 'Delivery dispatched',
  dr_uploaded: 'Supplier DR uploaded',
  receiving_confirmed: 'Receiving confirmed',
  po_completed: 'PO completed',
};

function DeliveryDetails({ deliveryNumber, backHref }) {
  const [delivery, setDelivery] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [viewUrls, setViewUrls] = useState({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const d = await getDeliveryByNumber(deliveryNumber);
        if (!cancelled) setDelivery(d);
      } catch (e) {
        if (!cancelled) setError(e?.message || 'Failed to load delivery.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [deliveryNumber]);

  const handleViewReceipt = async (storagePath) => {
    try {
      const { signedUrl } = await getReceiptViewUrl(storagePath);
      setViewUrls((prev) => ({ ...prev, [storagePath]: signedUrl }));
    } catch (e) {
      setError(e?.message || 'Could not open receipt.');
    }
  };

  if (loading) {
    return (
      <div className="bg-white rounded-lg p-6">
        <PageSkeleton />
      </div>
    );
  }

  if (!delivery) {
    return (
      <div className="bg-white rounded-lg p-6">
        <p className="text-[13px] text-[#c62828]">{error || 'Delivery not found.'}</p>
        <a href={backHref} className="text-[13px] text-[#006680] font-semibold">← Back</a>
      </div>
    );
  }

  const items = delivery.items || [];
  const receipts = delivery.receipts || [];
  const logs = delivery.auditLogs || [];

  return (
    <div className="bg-white rounded-lg p-6 text-left">
      <div className="mb-8">
        <a href={backHref} className="text-[13px] text-[#006680] font-semibold">← Back</a>
        <h1 className="m-0 mt-2 text-3xl max-md:text-2xl text-[#333] font-bold">{delivery.deliveryNumber}</h1>
        <p className="mt-2 mx-0 mb-0 text-sm text-[#666]">Delivery record — physical shipment with supplier evidence and receiving</p>
      </div>

      {error && <div className="mb-4 p-3 bg-[#ffebee] text-[#c62828] border border-[#ef9a9a] rounded-md text-xs font-semibold">{error}</div>}

      <div className="border border-[#eee] rounded-lg p-4 mb-4">
        <h3 className={sectionTitle}>Delivery Information</h3>
        <div className="grid grid-cols-2 max-md:grid-cols-1 gap-4 mt-3">
          <div><label className="text-[11px] font-bold text-[#444]">DELIVERY NO.</label><input value={delivery.deliveryNumber || ''} disabled className={inputClass} /></div>
          <div><label className="text-[11px] font-bold text-[#444]">STATUS</label><div className="py-2"><StatusBadge status={delivery.statusLabel || delivery.status} /></div></div>
          <div><label className="text-[11px] font-bold text-[#444]">PO NO.</label><input value={delivery.poNumber || ''} disabled className={inputClass} /></div>
          <div><label className="text-[11px] font-bold text-[#444]">REQUEST NO.</label><input value={delivery.reqNumber || delivery.po?.mrsNo || '—'} disabled className={inputClass} /></div>
          <div><label className="text-[11px] font-bold text-[#444]">SUPPLIER</label><input value={delivery.supplier || ''} disabled className={inputClass} /></div>
          <div><label className="text-[11px] font-bold text-[#444]">DELIVERY DATE</label><input value={delivery.deliveryDate ? new Date(delivery.deliveryDate).toLocaleDateString() : '—'} disabled className={inputClass} /></div>
        </div>
      </div>

      <div className="border border-[#eee] rounded-lg p-4 mb-4">
        <h3 className={sectionTitle}>Transport</h3>
        <div className="grid grid-cols-2 max-md:grid-cols-1 gap-4 mt-3">
          <div><label className="text-[11px] font-bold text-[#444]">DELIVERED BY</label><input value={delivery.deliveredBy || '—'} disabled className={inputClass} /></div>
          <div><label className="text-[11px] font-bold text-[#444]">PLATE NUMBER</label><input value={delivery.plateNumber || '—'} disabled className={inputClass} /></div>
        </div>
      </div>

      <div className="border border-[#eee] rounded-lg p-4 mb-4">
        <h3 className={sectionTitle}>Supplier Receipt (evidence)</h3>
        <div className="grid grid-cols-2 max-md:grid-cols-1 gap-4 mt-3">
          <div><label className="text-[11px] font-bold text-[#444]">SUPPLIER DR NO.</label><input value={delivery.supplierDrNumber || '—'} disabled className={inputClass} /></div>
        </div>
        <div className="flex flex-wrap gap-2 mt-3">
          {receipts.length === 0 && <span className="text-[12px] text-[#999]">No receipt photos uploaded yet.</span>}
          {receipts.map((r) => (
            <div key={r.id} className="border border-[#e0e0e0] rounded-md px-3 py-2 text-[12px]">
              {viewUrls[r.storagePath] ? (
                <a href={viewUrls[r.storagePath]} target="_blank" rel="noreferrer" className="text-[#006680] font-semibold">View receipt</a>
              ) : (
                <button type="button" onClick={() => handleViewReceipt(r.storagePath)} className="text-[#006680] font-semibold">View receipt</button>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="border border-[#eee] rounded-lg p-4 mb-4">
        <h3 className={sectionTitle}>Items</h3>
        <div className="overflow-x-auto mt-3">
          <table className="w-full border-collapse text-[13px]">
            <thead><tr className="text-left text-[10px] text-[#999]">
              <th className="py-1 pr-2">ITEM</th><th className="py-1 pr-2">PURCHASED</th><th className="py-1 pr-2">DELIVERED</th><th className="py-1 pr-2">RECEIVED</th><th className="py-1 pr-2">DIFFERENCE</th>
            </tr></thead>
            <tbody>
              {items.map((item) => {
                const diff = item.receivedQty - item.deliveredQty;
                return (
                  <tr key={item.id} className="border-t border-[#f1f1f1]">
                    <td className="py-2 pr-2 font-medium text-[#333]">{item.poItem?.itemDescription || '—'}</td>
                    <td className="py-2 pr-2">{item.purchasedQty}</td>
                    <td className="py-2 pr-2">{item.deliveredQty}</td>
                    <td className="py-2 pr-2">{item.receivedQty}</td>
                    <td className={`py-2 pr-2 font-bold ${diff ? 'text-[#e65100]' : 'text-[#2e7d32]'}`}>{diff}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="border border-[#eee] rounded-lg p-4 mb-4">
        <h3 className={sectionTitle}>Receiving</h3>
        <div className="grid grid-cols-2 max-md:grid-cols-1 gap-4 mt-3">
          <div><label className="text-[11px] font-bold text-[#444]">RECEIVED BY</label><input value={delivery.receivedBy || '—'} disabled className={inputClass} /></div>
          <div><label className="text-[11px] font-bold text-[#444]">RECEIVED AT</label><input value={delivery.receivedAt ? new Date(delivery.receivedAt).toLocaleString() : '—'} disabled className={inputClass} /></div>
        </div>
        <div className="mt-3"><label className="text-[11px] font-bold text-[#444]">REMARKS</label><input value={delivery.remarks || '—'} disabled className={inputClass} /></div>
      </div>

      <div className="border border-[#eee] rounded-lg p-4">
        <h3 className={sectionTitle}>Audit Timeline</h3>
        <div className="mt-3 flex flex-col gap-2">
          {logs.length === 0 && <span className="text-[12px] text-[#999]">No audit entries yet.</span>}
          {logs.map((log) => (
            <div key={log.id} className="flex justify-between gap-3 border-t border-[#f1f1f1] py-1.5 text-[12px]">
              <span className="font-semibold text-[#333]">{ACTION_LABELS[log.action] || log.action}{log.detail ? ` — ${log.detail}` : ''}</span>
              <span className="text-[#888] whitespace-nowrap">{new Date(log.createdAt).toLocaleString()}{log.actor ? ` · ${log.actor}` : ''}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default DeliveryDetails;
