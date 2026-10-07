'use client';
import React, { useState, useEffect, useCallback } from 'react';
import { useWarehouseData } from '../../context/WarehouseDataContext';
import {
  getReceivingHistory,
  editLatestReceiving,
} from '../../../actions/procurement';
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
// WHAT THE WAREHOUSE TYPES is the quantity that arrived NOW, not the running
// total. A line with 30 received and 10 outstanding is seeded with 10; the
// warehouse confirms 10 and the running total becomes 40. The 30 already on
// record is shown read-only beside the input and is never retyped, so a partial
// delivery can be recorded without restating — or accidentally corrupting — what
// arrived earlier. The server still receives a CUMULATIVE total, so its existing
// caps and monotonicity rules are unchanged.
//
// Bytes go straight to Storage through a signed URL rather than through this form.
// next.config.js sets no server-action body limit, so a base64 photo would be
// rejected well below its own size.
//
// The history below the form is read from ReceivingRecord, which holds the
// per-line numbers behind each arrival. The latest event carries an Edit control:
// a miscount can be corrected there, and the row keeps the figure it was
// originally given so the change is visible rather than silent.
function ReceivePOForm({ poNumber, onClose, onSaved }) {
  const { recordReceiving, getPOTracker, editLatestReceiving: correctReceiving } = useWarehouseData();
  const [tracker, setTracker] = useState(null);
  const [arrived, setArrived] = useState({});
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
  // Receiving history, newest first. The newest event is the only editable one.
  const [history, setHistory] = useState([]);
  const [historyError, setHistoryError] = useState('');
  const [editingEvent, setEditingEvent] = useState(null);
  const [editValues, setEditValues] = useState({});
  const [editError, setEditError] = useState('');
  const [editing, setEditing] = useState(false);

  /**
   * Seed the ARRIVAL inputs with each line's outstanding quantity, and refresh
   * the history.
   *
   * Seeding with `receivingOutstanding` rather than the running total is the
   * whole point: the warehouse states what has newly arrived, and what was
   * already recorded stays out of the input entirely.
   */
  const seedArrivals = useCallback((t) => {
    const seed = {};
    for (const item of t.items) {
      const outstanding = Math.max(0, (item.purchasedQty ?? 0) - item.receivedQty);
      seed[item.poItemId] = outstanding > 0 ? String(outstanding) : '';
    }
    setArrived(seed);
  }, []);

  const loadHistory = useCallback(async () => {
    try {
      setHistory(await getReceivingHistory(poNumber));
      setHistoryError('');
    } catch (e) {
      // The history is supporting detail: quantities still save without it.
      setHistory([]);
      setHistoryError(e?.message || 'Could not load receiving history');
    }
  }, [poNumber]);

  const load = useCallback(async () => {
    const t = await getPOTracker(poNumber);
    setTracker(t);
    seedArrivals(t);
  }, [poNumber, getPOTracker, seedArrivals]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const t = await getPOTracker(poNumber);
        if (cancelled) return;
        setTracker(t);
        seedArrivals(t);
      } catch (e) {
        if (!cancelled) setError(e?.message || 'Failed to load purchase order');
      }
    })();
    return () => { cancelled = true; };
  }, [poNumber, getPOTracker, seedArrivals]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

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

  const outstandingOf = (item) =>
    Math.max(0, (item.purchasedQty ?? 0) - item.receivedQty);

  // The edit input's ceiling is the PURCHASED quantity, not the outstanding one:
  // a correction can raise a total above what is still expected, and only the
  // purchased figure is a real limit. It also cannot go below fromQty, which is
  // the minimum the server accepts.
  const purchasedOf = (poItemId) => {
    const line = tracker?.items.find((i) => i.poItemId === poItemId);
    return line?.purchasedQty ?? 0;
  };

  /**
   * The ARRIVAL quantity for one line, capped at what is still outstanding.
   *
   * Masked to digits so a negative can never be typed, and capped to the
   * outstanding balance because nothing beyond it can have arrived. The server
   * re-derives the cumulative total and re-caps it at the purchased quantity, so
   * this is an input aid rather than the rule.
   */
  const clampArrival = (item, value) => {
    const raw = value.replace(/[^0-9]/g, '');
    const qty = raw === '' ? '' : String(Math.min(Number(raw), outstandingOf(item)));
    setArrived((prev) => ({ ...prev, [item.poItemId]: qty }));
  };

  const startEdit = (event) => {
    setEditingEvent(event);
    setEditValues(Object.fromEntries(event.lines.map((l) => [l.poItemId, String(l.toQty)])));
    setEditError('');
  };

  const cancelEdit = () => {
    setEditingEvent(null);
    setEditValues({});
    setEditError('');
  };

  /**
   * Apply a correction to the latest receiving event.
   *
   * `toQty` is the corrected CUMULATIVE total for the line, which is what the
   * history shows and what the server expects. The floor the server enforces is
   * each line's `fromQty`, so an edit cannot silently undo an earlier delivery.
   */
  const submitEdit = async (e) => {
    e?.preventDefault();
    if (editing || !editingEvent) return;
    setEditing(true);
    setEditError('');
    try {
      await correctReceiving({
        poNumber,
        items: editingEvent.lines.map((l) => ({
          poItemId: l.poItemId,
          toQty: Number(editValues[l.poItemId] ?? 0),
        })),
      });
      cancelEdit();
      await Promise.all([load(), loadHistory()]);
      onSaved?.();
    } catch (err) {
      setEditError(err?.message || 'Could not correct the receiving record');
    } finally {
      setEditing(false);
    }
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
      //
      // Each ARRIVAL is added to what is already recorded, producing the
      // cumulative total the server validates. Lines the warehouse left blank are
      // submitted unchanged, so a partial form cannot zero out a delivery that was
      // already saved.
      const result = await recordReceiving({
        poNumber,
        items: tracker.items.map((item) => ({
          poItemId: item.poItemId,
          receivedQty: item.receivedQty + Number(arrived[item.poItemId] ?? 0),
        })),
        remarks: remarks.trim() || undefined,
      });
      setSaved(true);
      await Promise.all([load(), loadHistory()]);

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
    <>
    <form onSubmit={submit} className="p-6 text-left">
      <div className="flex justify-between items-start border-b border-[#eee] pb-3 mb-4">
        <div>
          <h2 className="m-0 text-lg font-bold text-[#333]">Record Receiving</h2>
          <p className="m-0 mt-0.5 text-[12px] text-[#888]">{poNumber} &middot; {tracker.supplier || 'supplier not set'}</p>
        </div>
        <button type="button" className="text-2xl text-[#888]" onClick={onClose} aria-label="Close">&times;</button>
      </div>

      <p className="text-[13px] text-[#666] mt-0">
        Enter what has arrived <strong>since the last time you recorded it</strong>. The received column
        already shows what is on record, so there is nothing to retype — whatever is still outstanding can
        be recorded again when the supplier delivers the rest.
      </p>

      {receivable.length === 0 ? (
        <p className="text-[13px] text-[#e65100] font-semibold">
          Nothing to receive yet — no items on this purchase order have a purchased quantity.
        </p>
      ) : (
        <div className="flex flex-col gap-3 mt-3">
          {receivable.map((item) => {
            const outstanding = outstandingOf(item);
            const entered = Number(arrived[item.poItemId] || 0);
            return (
            <div key={item.poItemId} className="grid grid-cols-[1.6fr_.8fr_.8fr_.9fr_.9fr] gap-2 items-end border-b border-[#f1f1f1] pb-3 last:border-b-0 last:pb-0">
              <div>
                <label className="text-[10px] font-bold text-[#999]">ITEM</label>
                <div className="text-[13px] font-medium text-[#333]">
                  {item.itemDescription} <span className="text-[10px] text-[#888]">({item.unit})</span>
                </div>
                <div className="text-[10px] text-[#006680] font-semibold">
                  {item.receivedQty} received &middot; {outstanding} outstanding
                </div>
              </div>
              <div>
                <label className="text-[10px] font-bold text-[#999]">PURCHASED</label>
                <div className="text-[13px] font-semibold">{item.purchasedQty}</div>
              </div>
              {/* Read-only, and deliberately not an input: the running total belongs
                  to the record, not to this delivery. */}
              <div>
                <label className="text-[10px] font-bold text-[#999]">RECEIVED</label>
                <div className="py-2 px-3 border border-[#e8e8e8] rounded-md text-[13px] w-full box-border bg-[#f7f7f7] text-[#555]">
                  {item.receivedQty}
                </div>
              </div>
              <div>
                <label className="text-[10px] font-bold text-[#999]">ARRIVED NOW</label>
                <input
                  type="number"
                  min="0"
                  max={outstanding}
                  step="1"
                  disabled={outstanding === 0}
                  aria-label={`Quantity arrived now for ${item.itemDescription}`}
                  value={arrived[item.poItemId] ?? ''}
                  onChange={(e) => clampArrival(item, e.target.value)}
                  className="py-2 px-3 border border-[#ccc] rounded-md text-[13px] w-full box-border disabled:bg-[#f7f7f7] disabled:text-[#bbb]"
                />
                {outstanding > 0 && (
                  <div className="mt-0.5 text-[10px] text-[#888]">
                    of {outstanding} outstanding
                  </div>
                )}
              </div>
              <div>
                <label className="text-[10px] font-bold text-[#999]">OUTSTANDING</label>
                <div className={`text-[13px] font-bold ${outstanding - entered > 0 ? 'text-[#006680]' : 'text-[#2e7d32]'}`}>
                  {Math.max(0, outstanding - entered)}
                </div>
              </div>
            </div>
            );
          })}
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

    <div className="px-6 pb-6 text-left">
      {/* Receiving history. Read from the recorded per-line numbers rather than
          the summary log, so each entry can be read and — for the latest one —
          corrected. */}
      <div className="mt-4 pt-4 border-t border-[#eee]">
        <div className="flex items-baseline justify-between">
          <h3 className="m-0 text-[11px] font-bold text-[#666] tracking-wide uppercase">
            Receiving History
          </h3>
          {history.length > 0 && (
            <span className="text-[10px] text-[#999]">
              {history.length} event{history.length === 1 ? '' : 's'}
            </span>
          )}
        </div>

        {historyError && (
          <p className="mt-2 mb-0 text-[11px] text-[#c62828]">{historyError}</p>
        )}

        {history.length === 0 && !historyError && (
          <p className="mt-2 mb-0 text-[11px] text-[#999]">
            Nothing recorded against this purchase order yet.
          </p>
        )}

        <ul className="mt-2 mb-0 p-0 list-none flex flex-col gap-2">
          {history.map((event) => {
            const isEditing = editingEvent?.eventId === event.eventId;
            return (
              <li
                key={event.eventId}
                className="border border-[#ececec] rounded-md p-2.5 bg-[#fafafa]"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[12px] text-[#333] font-semibold">
                    {new Date(event.createdAt).toLocaleString()}
                    {event.actor ? <span className="font-normal text-[#888]"> &middot; {event.actor}</span> : null}
                  </span>
                  {/* Only the newest event is correctable: an earlier one has later
                      deliveries resting on the totals it established. */}
                  {event.editable && !isEditing && (
                    <button
                      type="button"
                      onClick={() => startEdit(event)}
                      className="bg-none border-none p-0 text-[11px] font-semibold text-[#006680] underline cursor-pointer hover:text-[#004d60]"
                    >
                      Edit
                    </button>
                  )}
                </div>

                {isEditing ? (
                  <form onSubmit={submitEdit} className="mt-2">
                    {event.lines.map((line) => (
                      <div key={line.poItemId} className="flex items-center gap-2 mt-1.5">
                        <span className="text-[11px] text-[#555] flex-1">
                          {line.itemDescription}{' '}
                          <span className="text-[#999]">({line.unit})</span>
                        </span>
                        <input
                          type="number"
                          min={line.fromQty}
                          max={purchasedOf(line.poItemId)}
                          step="1"
                          aria-label={`Corrected received total for ${line.itemDescription}`}
                          value={editValues[line.poItemId] ?? ''}
                          onChange={(e) =>
                            setEditValues((prev) => ({
                              ...prev,
                              [line.poItemId]: e.target.value.replace(/[^0-9]/g, ''),
                            }))
                          }
                          className="py-1 px-2 border border-[#ccc] rounded text-[12px] w-20 box-border"
                        />
                        <span className="text-[10px] text-[#999] w-24 text-right">
                          was {line.previousToQty ?? line.toQty}
                        </span>
                      </div>
                    ))}
                    <p className="mt-2 mb-0 text-[10px] text-[#888]">
                      Enter the corrected total received. It cannot fall below what was already received
                      before this delivery.
                    </p>
                    {editError && (
                      <p className="mt-2 mb-0 text-[11px] text-[#c62828] font-semibold">{editError}</p>
                    )}
                    <div className="flex justify-end gap-2 mt-2">
                      <button
                        type="button"
                        aria-label="Cancel correction"
                        onClick={cancelEdit}
                        disabled={editing}
                        className="py-1 px-3 bg-white text-[#333] border border-[#ccc] rounded text-[11px] font-semibold cursor-pointer disabled:opacity-60"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={editing}
                        className="py-1 px-3 bg-[#006680] text-white rounded text-[11px] font-semibold cursor-pointer disabled:opacity-60"
                      >
                        {editing ? 'Saving…' : 'Save Correction'}
                      </button>
                    </div>
                  </form>
                ) : (
                  <ul className="mt-1.5 mb-0 p-0 list-none flex flex-col gap-0.5">
                    {event.lines.map((line) => (
                      <li key={line.poItemId} className="text-[11px] text-[#555]">
                        {line.itemDescription}: +{line.delta} = {line.toQty} {line.unit}
                        {/* A correction keeps the figure it was first given, so the
                            change is visible rather than silent. */}
                        {line.edited && (
                          <span className="ml-1 text-[10px] text-[#78909c]">
                            (edited
                            {line.previousToQty != null ? ` from ${line.previousToQty}` : ''}
                            {line.editedBy ? ` by ${line.editedBy}` : ''})
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
    </>
  );
}

export default ReceivePOForm;
