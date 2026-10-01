'use client';
import { useEffect, useState } from 'react';
import { useWarehouseData } from '../../context/WarehouseDataContext';

// Simplified receiving form: records actual received quantity per PO item
// against purchased (NOT delivery tracking). No photos, no transport fields.
export default function ReceivePOForm({ poNumber, onClose }) {
  const { getSimplifiedTracker, confirmReceivingV2 } = useWarehouseData();
  const [tracker, setTracker] = useState(null);
  const [received, setReceived] = useState({});
  const [remarks, setRemarks] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const t = await getSimplifiedTracker(poNumber);
        if (!cancelled) {
          setTracker(t);
          const init = {};
          for (const item of t.items) init[item.poItemId] = item.purchasedQty;
          setReceived(init);
        }
      } catch (e) {
        if (!cancelled) setError(e?.message || 'Failed to load PO');
      }
    })();
    return () => { cancelled = true; };
  }, [poNumber, getSimplifiedTracker]);

  const submit = async () => {
    setError('');
    setSaving(true);
    try {
      await confirmReceivingV2({
        poNumber,
        items: Object.entries(received).map(([poItemId, receivedQty]) => ({ poItemId, receivedQty: Number(receivedQty) })),
        remarks: remarks.trim() || undefined,
      });
      onClose?.();
    } catch (e) {
      setError(e?.message || 'Failed to save receiving');
    } finally {
      setSaving(false);
    }
  };

  if (error && !tracker) return <div className="p-4 text-red-600">{error}</div>;
  if (!tracker) return <div className="p-4">Loading…</div>;

  return (
    <div className="p-4 space-y-3">
      <h3 className="font-bold">Receive {poNumber}</h3>
      <p className="text-xs text-gray-500">Confirm what actually arrived. Received cannot exceed purchased.</p>
      {tracker.items.map((item) => (
        <div key={item.poItemId} className="flex items-center gap-2 border-b pb-2">
          <div className="flex-1">
            <div className="font-medium">{item.itemDescription}</div>
            <div className="text-xs text-gray-500">Purchased {item.purchasedQty} {item.unit} · Already received {item.receivedQty}</div>
          </div>
          <input
            type="number"
            min={0}
            max={item.purchasedQty}
            className="border rounded px-2 py-1 w-24"
            value={received[item.poItemId] ?? 0}
            onChange={(e) => setReceived((p) => ({ ...p, [item.poItemId]: Number(e.target.value) }))}
          />
        </div>
      ))}
      <textarea className="w-full border rounded px-2 py-1" rows={2} placeholder="Remarks (optional)" value={remarks} onChange={(e) => setRemarks(e.target.value)} />
      {error && <div className="text-red-600 text-sm">{error}</div>}
      <div className="flex gap-2">
        <button type="button" className="px-3 py-1 border rounded" onClick={onClose}>Cancel</button>
        <button type="button" disabled={saving} className="px-3 py-1 rounded bg-[#006680] text-white" onClick={submit}>{saving ? 'Saving…' : 'Confirm Receiving'}</button>
      </div>
    </div>
  );
}
