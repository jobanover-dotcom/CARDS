'use client';
import { useEffect, useState } from 'react';
import { getArchivedDeliveries, getArchivedDeliveryByNumber } from '../../../actions/deliveries';

// Read-only historical DEL-* records. Purchaser/Superadmin only (server enforces).
// No create/edit/receive actions. Not part of the active procurement workflow.
export default function ArchivedDeliveriesView() {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState('');

  const load = async () => {
    setError('');
    try {
      const res = await getArchivedDeliveries({ search: search.trim() || undefined, limit: 50 });
      setRows(res.rows);
      setTotal(res.total);
    } catch (e) {
      setError(e?.message || 'Failed to load archived deliveries');
    }
  };

  useEffect(() => { load(); }, []);

  const open = async (deliveryNumber) => {
    setError('');
    try {
      setSelected(await getArchivedDeliveryByNumber(deliveryNumber));
    } catch (e) {
      setError(e?.message || 'Failed to open record');
    }
  };

  return (
    <div className="bg-white rounded-lg p-6">
      <h1 className="m-0 text-2xl font-bold">Archived Deliveries</h1>
      <p className="text-sm text-[#666]">Historical DEL-* records only — read-only, not part of the active workflow (PO → Purchased → On Delivery → Receiving → Completed).</p>
      <div className="flex gap-2 my-4">
        <input className="border rounded px-2 py-1 flex-1" placeholder="Search delivery / PO / supplier…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <button className="px-3 py-1 rounded bg-[#1e3c72] text-white" onClick={load}>Search</button>
      </div>
      {error && <div className="text-red-600 text-sm mb-2">{error}</div>}
      <p className="text-xs text-gray-500">{total} record(s). Users cannot create or edit deliveries from the archive.</p>
      <table className="w-full text-[13px] mt-2">
        <thead><tr className="text-left text-gray-500">{['Delivery', 'PO', 'Supplier', 'Status', 'Date'].map((h) => <th key={h} className="py-1">{h}</th>)}</tr></thead>
        <tbody>
          {rows.map((d) => (
            <tr key={d.id} className="border-t">
              <td className="py-1"><button className="text-[#006680] font-semibold" onClick={() => open(d.deliveryNumber)}>{d.deliveryNumber}</button></td>
              <td className="py-1">{d.poNumber}</td>
              <td className="py-1">{d.supplier}</td>
              <td className="py-1">{d.statusLabel || d.status}</td>
              <td className="py-1">{d.deliveryDate ? new Date(d.deliveryDate).toLocaleDateString() : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {selected && (
        <div className="mt-4 border rounded p-4 bg-gray-50">
          <h3 className="font-bold">{selected.deliveryNumber} — {selected.poNumber}</h3>
          <p className="text-xs text-gray-500">Historical record. Read-only.</p>
          <table className="w-full text-[13px] mt-2">
            <thead><tr className="text-left text-gray-500">{['Item', 'Purchased', 'Delivered', 'Received'].map((h) => <th key={h} className="py-1">{h}</th>)}</tr></thead>
            <tbody>
              {(selected.items || []).map((i) => (
                <tr key={i.id} className="border-t"><td className="py-1">{i.poItem?.itemDescription}</td><td className="py-1">{i.purchasedQty}</td><td className="py-1">{i.deliveredQty}</td><td className="py-1">{i.receivedQty}</td></tr>
              ))}
            </tbody>
          </table>
          <button className="mt-2 text-sm" onClick={() => setSelected(null)}>Close</button>
        </div>
      )}
    </div>
  );
}
