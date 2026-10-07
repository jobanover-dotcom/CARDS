'use client';
import React, { useState, useEffect, useCallback } from 'react';
import { useWarehouseData } from '../../context/WarehouseDataContext';
import {
  getPurchaseOrderReceiptUploadUrl,
  recordPurchaseOrderReceipt,
  getPurchaseOrderReceipts,
  getPurchaseOrderReceiptUrl,
} from '../../../actions/poReceipts';
import { createClient } from '../../../lib/supabase-client';

// Receiving form. The supplier delivers physically and outside CARDS; this
// records what ACTUALLY arrived, against the purchase order.
//
// `receivedQty` submitted here is the NEW CUMULATIVE total for the line, so
// receiving can be recorded in several events (8 now, 2 later) against the same
// PO. The server re-caps at purchasedQty and logs every event.
//
// The supplier's signed delivery receipt is attached here too, as the evidence
// for what was really purchased. It is OPTIONAL: quantities are saved first and
// the image is uploaded afterwards, so a failed upload can never lose receiving
// data — and because quantities are cumulative, submitting again only retries the
// upload.
//
// Bytes go straight to Storage through a signed URL rather than through this form.
// next.config.js sets no server-action body limit, so a base64 photo would be
// rejected well below its own size.

// Receiving form. The supplier delivers physically and outside CARDS; this
// records what ACTUALLY arrived, against the purchase order.
//
// `receivedQty` submitted here is the NEW CUMULATIVE total for the line, so
// receiving can be recorded in several events (8 now, 2 later) against the same
// PO. The server re-caps at purchasedQty and logs every event.
function ReceivePOForm({ poNumber, onClose, onSaved }) {
  const { recordReceiving, getPOTracker } = useWarehouseData();
  const [tracker, setTracker] = useState(null);
  const [received, setReceived] = useState({});
  const [remarks, setRemarks] = useState('');
  const [error, setError] = useState('');
  // Set once quantities are saved, so a later upload failure reports itself as a
  // partial success instead of implying the receiving was lost.
  const [saved, setSaved] = useState(false);
  const [warning, setWarning] = useState('');
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [receipts, setReceipts] = useState([]);
  const [receiptFile, setReceiptFile] = useState(null);
  const [receiptError, setReceiptError] = useState('');

  const load = useCallback(async () => {
    const t = await getPOTracker(poNumber);
    setTracker(t);
    const seed = {};
    for (const item of t.items) seed[item.poItemId] = String(item.receivedQty);
    setReceived(seed);
  }, [poNumber, getPOTracker]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const t = await getPOTracker(poNumber);
        if (cancelled) return;
        setTracker(t);
        const seed = {};
        for (const item of t.items) seed[item.poItemId] = String(item.receivedQty);
        setReceived(seed);
      } catch (e) {
        if (!cancelled) setError(e?.message || 'Failed to load purchase order');
      }
    })();
    return () => { cancelled = true; };
  }, [poNumber, getPOTracker]);

  const loadReceipts = useCallback(async () => {
    try {
      setReceipts(await getPurchaseOrderReceipts(poNumber));
    } catch {
      setReceipts([]);
    }
  }, [poNumber]);

  useEffect(() => {
    loadReceipts();
  }, [loadReceipts]);

  /**
   * Attach the chosen image as evidence for this PO.
   *
   * Two steps by necessity: the server mints a signed upload URL, then the browser
   * puts the bytes into Storage itself, then the row is recorded. Returns a message
   * on failure rather than throwing, because by this point the quantities are
   * already saved and must not be presented as lost.
   */
  const uploadReceipt = async (file) => {
    setUploading(true);
    setReceiptError('');
    try {
      const ticket = await getPurchaseOrderReceiptUploadUrl({
        poNumber,
        fileName: file.name,
        contentType: file.type,
      });
      const supabase = createClient();
      const { error: uploadError } = await supabase.storage
        .from(ticket.bucket)
        .uploadToSignedUrl(ticket.storagePath, ticket.token, file);
      if (uploadError) throw new Error(uploadError.message);
      await recordPurchaseOrderReceipt({ poNumber, storagePath: ticket.storagePath });
      setReceiptFile(null);
      await loadReceipts();
      return null;
    } catch (e) {
      return e?.message || 'The receipt could not be uploaded';
    } finally {
      setUploading(false);
    }
  };

  const openReceipt = async (storagePath) => {
    try {
      const { signedUrl } = await getPurchaseOrderReceiptUrl(storagePath, poNumber);
      window.open(signedUrl, '_blank', 'noopener,noreferrer');
    } catch (e) {
      setReceiptError(e?.message || 'The receipt could not be opened');
    }
  };

  const fileNameOf = (storagePath) => storagePath.split('/').pop()?.replace(/^[0-9a-f-]{36}-/, '') || storagePath;

  const clamp = (item, value) => {
    const raw = value.replace(/[^0-9]/g, '');
    // Input mask only; the server enforces received <= purchased.
    const qty = raw === '' ? '' : String(Math.min(Number(raw), item.purchasedQty));
    setReceived((prev) => ({ ...prev, [item.poItemId]: qty }));
  };

  const submit = async (e) => {
    e?.preventDefault();
    if (saving || !tracker) return;
    setError('');
    setWarning('');
    setSaving(true);
    try {
      // Quantities FIRST. They are the record of truth for what arrived; the image
      // is evidence of it and must never be able to hold them up.
      const result = await recordReceiving({
        poNumber,
        items: tracker.items.map((item) => ({
          poItemId: item.poItemId,
          receivedQty: Number(received[item.poItemId] ?? 0),
        })),
        remarks: remarks.trim() || undefined,
      });
      setSaved(true);
      await load();

      let uploadFailed = null;
      if (receiptFile) uploadFailed = await uploadReceipt(receiptFile);

      if (uploadFailed) {
        // Quantities are committed, so this is a partial success, not a failure.
        // The form stays open and re-submitting is safe: receivedQty is
        // cumulative, so identical values produce no quantity deltas.
        setWarning(
          `Receiving saved. The receipt image could not be uploaded: ${uploadFailed}. ` +
            `You can attach it by choosing the file and saving again.`,
        );
        return;
      }
      onSaved?.(result);
      onClose?.();
    } catch (err) {
      setError(err?.message || 'Failed to save receiving');
    } finally {
      setSaving(false);
    }
  };

  if (!tracker) {
    return (
      <div className="p-6 text-left">
        <p className="text-[13px] text-[#666]">{error || 'Loading…'}</p>
      </div>
    );
  }

  const receivable = tracker.items.filter((i) => i.purchasedQty > 0);

  return (
    <form onSubmit={submit} className="p-6 text-left">
      <div className="flex justify-between items-start border-b border-[#eee] pb-3 mb-4">
        <div>
          <h2 className="m-0 text-lg font-bold text-[#333]">Record Receiving</h2>
          <p className="m-0 mt-0.5 text-[12px] text-[#888]">{poNumber} &middot; {tracker.supplier || 'supplier not set'}</p>
        </div>
        <button type="button" className="text-2xl text-[#888]" onClick={onClose} aria-label="Close">&times;</button>
      </div>

      <p className="text-[13px] text-[#666] mt-0">
        Enter what has arrived so far in total. Anything still outstanding can be recorded again when the
        supplier delivers the rest.
      </p>

      {receivable.length === 0 ? (
        <p className="text-[13px] text-[#e65100] font-semibold">
          Nothing to receive yet — no items on this purchase order have a purchased quantity.
        </p>
      ) : (
        <div className="flex flex-col gap-3 mt-3">
          {receivable.map((item) => (
            <div key={item.poItemId} className="grid grid-cols-[1.6fr_.8fr_.9fr_.9fr] gap-2 items-end border-b border-[#f1f1f1] pb-3 last:border-b-0 last:pb-0">
              <div>
                <label className="text-[10px] font-bold text-[#999]">ITEM</label>
                <div className="text-[13px] font-medium text-[#333]">
                  {item.itemDescription} <span className="text-[10px] text-[#888]">({item.unit})</span>
                </div>
                <div className="text-[10px] text-[#006680] font-semibold">
                  {item.receivedQty} received &middot; {item.receivingOutstanding} outstanding
                </div>
              </div>
              <div>
                <label className="text-[10px] font-bold text-[#999]">PURCHASED</label>
                <div className="text-[13px] font-semibold">{item.purchasedQty}</div>
              </div>
              <div>
                <label className="text-[10px] font-bold text-[#999]">RECEIVED</label>
                <input
                  type="number"
                  min="0"
                  max={item.purchasedQty}
                  step="1"
                  value={received[item.poItemId] ?? ''}
                  onChange={(e) => clamp(item, e.target.value)}
                  className="py-2 px-3 border border-[#ccc] rounded-md text-[13px] w-full box-border"
                />
              </div>
              <div>
                <label className="text-[10px] font-bold text-[#999]">OUTSTANDING</label>
                <div className={`text-[13px] font-bold ${item.receivingOutstanding ? 'text-[#006680]' : 'text-[#2e7d32]'}`}>
                  {Math.max(0, item.purchasedQty - Number(received[item.poItemId] || 0))}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-3">
        <label className="text-[11px] font-bold text-[#444]">REMARKS (OPTIONAL)</label>
        <input
          type="text"
          value={remarks}
          onChange={(e) => setRemarks(e.target.value)}
          className="py-2 px-3 border border-[#ccc] rounded-md text-[13px] w-full box-border"
        />
      </div>

      {/* The supplier's signed delivery receipt: the evidence that this purchase
          was really made. Optional, and never able to hold up the quantities. */}
      <div className="mt-3 border border-[#e0e0e0] rounded-md p-3 bg-[#fafafa]">
        <label className="block text-[11px] font-bold text-[#444]">
          SUPPLIER DELIVERY RECEIPT (OPTIONAL)
        </label>
        <p className="mt-0 mb-2 text-[11px] text-[#888]">
          Attach a photo of the signed receipt from the supplier. It is the only evidence of how many units
          were really purchased, and is kept with this purchase order. Receiving does not require it.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            aria-label="Supplier delivery receipt image"
            onChange={(e) => { setReceiptFile(e.target.files?.[0] ?? null); setReceiptError(''); }}
            className="text-[12px] text-[#555]"
          />
          {receiptFile && (
            <span className="text-[11px] text-[#888]">
              {receiptFile.name}
              {receiptFile.size ? ` · ${Math.round(receiptFile.size / 1024)} KB` : ''}
            </span>
          )}
        </div>
        {receiptFile && (
          <button
            type="button"
            disabled={uploading}
            onClick={async () => {
              const failed = await uploadReceipt(receiptFile);
              if (failed) setReceiptError(failed);
            }}
            className="mt-2 py-1.5 px-3 bg-white text-[#006680] border border-[#80c0d0] rounded-md text-xs font-semibold cursor-pointer transition-all duration-200 hover:bg-[#e8f4f6] hover:border-[#006680] disabled:opacity-60"
          >
            {uploading ? 'Uploading…' : saved ? 'Retry upload' : 'Attach receipt now'}
          </button>
        )}
        {receipts.length > 0 && (
          <ul className="mt-2 mb-0 p-0 list-none flex flex-col gap-1">
            {receipts.map((r) => (
              <li key={r.id} className="flex items-center gap-2 text-[11px] text-[#555]">
                <button
                  type="button"
                  onClick={() => openReceipt(r.storagePath)}
                  className="py-0.5 px-2 bg-white text-[#006680] border border-[#80c0d0] rounded text-[11px] font-semibold cursor-pointer hover:bg-[#e8f4f6]"
                >
                  View
                </button>
                <span>{fileNameOf(r.storagePath)}</span>
                <span className="text-[#999]">
                  &middot; {new Date(r.uploadedAt).toLocaleString()}
                  {r.uploadedBy ? ` · ${r.uploadedBy}` : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
        {receipts.length === 0 && (
          <p className="mt-2 mb-0 text-[11px] text-[#999]">No supplier receipt attached to this purchase order yet.</p>
        )}
        {receiptError && <p className="mt-2 mb-0 text-[11px] text-[#c62828] font-semibold">{receiptError}</p>}
      </div>

      {error && <div className="mt-3 p-2.5 bg-[#ffebee] text-[#c62828] border border-[#ef9a9a] rounded-md text-xs font-semibold">{error}</div>}
      {warning && <div className="mt-3 p-2.5 bg-[#fff8e1] text-[#ef6c00] border border-[#ffcc80] rounded-md text-xs font-semibold">{warning}</div>}

      <div className="flex justify-end gap-3 mt-4 pt-4 border-t border-[#eee]">
        <button type="button" onClick={onClose} className="py-2.5 px-6 bg-white text-[#333] border border-[#ccc] rounded-md">Cancel</button>
        <button type="submit" disabled={saving || receivable.length === 0} className="py-2.5 px-6 bg-[#006680] text-white rounded-md disabled:opacity-60">
          {saving ? 'Saving…' : 'Confirm Receiving'}
        </button>
      </div>
    </form>
  );
}

export default ReceivePOForm;
