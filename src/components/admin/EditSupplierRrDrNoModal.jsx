'use client';

import { useEffect, useState } from 'react';

import { getPOTracker } from '../../../actions/procurement';
import { useAdminData } from '../../context/AdminDataContext';
import { actionSecondary } from '../ui/tableTheme';

/**
 * Narrow editor for a purchase order's Supplier RR/DR No.
 *
 * Writes ONLY the supplier's own Receiving Report / Delivery Receipt number —
 * the reference printed on the supplier's paperwork, not the CARDS PO number.
 * It never touches the supplier, quantities, items, or status, so it is safe to
 * use on a purchased or even completed PO whose paperwork arrived late.
 *
 * Purchaser/admin-only: the function is not exposed to the warehouse context,
 * and the server action re-checks the role.
 */
export default function EditSupplierRrDrNoModal({ poNumber, onClose, onChanged }) {
  const { updateSupplierRrDrNo } = useAdminData();
  const [current, setCurrent] = useState(null);
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const t = await getPOTracker(poNumber);
        if (cancelled) return;
        setCurrent(t.supplierRrDrNo ?? null);
        setValue(t.supplierRrDrNo ?? '');
      } catch (e) {
        if (!cancelled) setError(e?.message || 'Failed to load purchase order.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [poNumber]);

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setError('');
    setBusy(true);
    try {
      // An empty value clears the reference; whitespace is trimmed server-side
      // and the value is kept as text so leading zeros survive.
      await updateSupplierRrDrNo({ poNumber, supplierRrDrNo: value.trim() || undefined });
      onChanged?.();
      onClose();
    } catch (err) {
      setError(err?.message || 'Failed to update the supplier RR/DR number.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-[1000] overflow-y-auto py-6 px-4">
      <div className="bg-white rounded-xl w-full max-w-[480px] shadow-[0_10px_30px_rgba(0,0,0,0.15)] p-6 text-left">
        <div className="flex justify-between items-center border-b border-[#eee] pb-3 mb-4">
          <h2 className="m-0 text-lg font-bold text-[#333]">Supplier RR/DR No. &mdash; {poNumber}</h2>
          <button className="text-2xl text-[#888]" onClick={onClose} aria-label="Close">&times;</button>
        </div>
        {loading ? (
          <p className="text-[13px] text-[#666]">Loading…</p>
        ) : (
          <form onSubmit={submit}>
            <p className="mt-0 mb-3 text-[12px] text-[#666]">
              The supplier&apos;s own Receiving Report / Delivery Receipt number, as printed on
              their document — not the CARDS PO number.
              {current ? (
                <> Currently recorded as <strong>{current}</strong>.</>
              ) : (
                <> None recorded yet.</>
              )}
            </p>
            <label className="block text-[11px] font-bold text-[#666] tracking-wide mb-1.5">
              SUPPLIER RR/DR NO.
            </label>
            <input
              type="text"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              maxLength={100}
              placeholder="Supplier's RR/DR number from their document"
              className="w-full py-2 px-3 border border-[#ccc] rounded-md text-[13px] text-[#333]"
            />
            {error && <p className="mt-2 mb-0 text-[12px] font-semibold text-[#c62828]">{error}</p>}
            <div className="flex justify-end gap-3 mt-4 pt-4 border-t border-[#eee]">
              <button type="button" onClick={onClose} className={`${actionSecondary} py-2.5 px-6`}>Cancel</button>
              <button
                type="submit"
                disabled={busy}
                className="py-2.5 px-6 bg-[#006680] text-white rounded-md text-xs font-semibold cursor-pointer transition-all duration-200 hover:bg-[#00536b] disabled:opacity-60"
              >
                {busy ? 'Saving…' : 'Save'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
