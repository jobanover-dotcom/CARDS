'use client';
import React, { useState, useEffect, useCallback } from 'react';
import {
  getPurchaseOrderReceipts,
  getPurchaseOrderReceiptUrl,
} from '../../../actions/poReceipts';

/**
 * The supplier's delivery receipts for one purchase order, newest first.
 *
 * These are the physical documents the supplier handed over — the only evidence of
 * how many units were really purchased for this PO. They are read-only here: a
 * purchaser can inspect the evidence but never add to it, because attaching it is
 * the warehouse's job at the moment of receiving.
 *
 * Objects are private in Storage, so each image is fetched through a short-lived
 * signed read URL rather than a public link.
 */
export default function SupplierReceiptsModal({ po, onClose }) {
  const poNumber = po?.poNumber;
  const [receipts, setReceipts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [opening, setOpening] = useState('');

  const load = useCallback(async () => {
    if (!poNumber) return;
    setLoading(true);
    setError('');
    try {
      setReceipts(await getPurchaseOrderReceipts(poNumber));
    } catch (e) {
      setError(e?.message || 'The receipts could not be loaded');
    } finally {
      setLoading(false);
    }
  }, [poNumber]);

  useEffect(() => {
    load();
  }, [load]);

  const open = async (storagePath) => {
    setOpening(storagePath);
    try {
      const { signedUrl } = await getPurchaseOrderReceiptUrl(storagePath, poNumber);
      window.open(signedUrl, '_blank', 'noopener,noreferrer');
    } catch (e) {
      setError(e?.message || 'The receipt could not be opened');
    } finally {
      setOpening('');
    }
  };

  /** Objects are named `<uuid>-<original name>`; the uuid is ours, not theirs. */
  const nameOf = (storagePath) =>
    storagePath.split('/').pop()?.replace(/^[0-9a-f]{8}-[0-9a-f-]{27}-/, '') || storagePath;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg bg-white rounded-lg shadow-2xl flex flex-col max-h-[80vh]">
        <div className="flex justify-between items-start gap-3 p-5 border-b border-[#eee]">
          <div>
            <h2 className="m-0 text-base font-bold text-[#1e3c72]">Supplier Delivery Receipts</h2>
            <p className="mt-1 mb-0 text-[11px] text-[#888]">
              {poNumber}
              {po?.supplier ? ` · ${po.supplier}` : ''} — the documents the supplier signed for this
              purchase.
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close supplier receipts"
            className="shrink-0 bg-white border border-[#ccc] rounded-md px-2 py-1 text-sm cursor-pointer hover:bg-[#f5f5f5]"
          >
            ×
          </button>
        </div>

        <div className="p-5 overflow-y-auto">
          {loading ? (
            <p className="m-0 text-[13px] text-[#888]">Loading receipts…</p>
          ) : receipts.length === 0 ? (
            <p className="m-0 text-[13px] text-[#888]">
              The warehouse has not attached a supplier receipt to this purchase order.
            </p>
          ) : (
            <ul className="m-0 p-0 list-none flex flex-col gap-2">
              {receipts.map((r) => (
                <li
                  key={r.id}
                  className="flex flex-wrap items-center gap-2 p-2.5 border border-[#eee] rounded-md bg-[#fafafa]"
                >
                  <button
                    onClick={() => open(r.storagePath)}
                    disabled={opening === r.storagePath}
                    className="py-1.5 px-3 bg-white text-[#006680] border border-[#80c0d0] rounded-md text-xs font-semibold cursor-pointer transition-all duration-200 hover:bg-[#e8f4f6] hover:border-[#006680] disabled:opacity-60"
                  >
                    {opening === r.storagePath ? 'Opening…' : 'View'}
                  </button>
                  <div className="min-w-0">
                    <div className="text-[12px] font-medium text-[#333] truncate">{nameOf(r.storagePath)}</div>
                    <div className="text-[11px] text-[#999]">
                      {new Date(r.uploadedAt).toLocaleString()}
                      {r.uploadedBy ? ` · uploaded by ${r.uploadedBy}` : ''}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {error && (
            <p className="mt-3 mb-0 p-2.5 bg-[#ffebee] text-[#c62828] border border-[#ef9a9a] rounded-md text-xs font-semibold">
              {error}
            </p>
          )}
        </div>

        <div className="flex justify-end p-4 border-t border-[#eee]">
          <button
            onClick={onClose}
            className="py-2 px-6 bg-white text-[#333] border border-[#ccc] rounded-md text-xs font-semibold cursor-pointer hover:bg-[#f5f5f5]"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
