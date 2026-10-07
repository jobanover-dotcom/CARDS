'use client';
import React from 'react';

// Quantity emphasis for monitoring rows and report previews.
//
// Priority is deliberate: a flagged discrepancy is shown in red even when the
// row also has an outstanding balance, because an exception outranks ordinary
// work. Otherwise green means nothing outstanding, amber means receiving is
// outstanding, and blue means purchasing is outstanding.
//
// Colour is never the only signal — the number is always rendered, alongside an
// accessible label naming what the number means.
const TONES = {
  discrepancy: 'text-[#c62828]',
  receiving: 'text-[#f57f17]',
  purchasing: 'text-[#1e3c72]',
  complete: 'text-[#2e7d32]',
};

function resolveTone({ hasDiscrepancy, receivingOutstanding, procurementOutstanding }) {
  // Discrepancy wins: it needs action before the outstanding balance does.
  if (hasDiscrepancy) return 'discrepancy';
  if (receivingOutstanding > 0) return 'receiving';
  if (procurementOutstanding > 0) return 'purchasing';
  return 'complete';
}

function QuantityValue({ value, tone, title }) {
  if (!value) return <span className="text-[#bbb]">&mdash;</span>;
  return (
    <span className={`font-bold ${TONES[tone]}`} title={title}>
      {value}
    </span>
  );
}

/** Purchase Outstanding — blue, because purchasing has not started. */
export function PurchaseOutstanding({ value }) {
  return (
    <QuantityValue
      value={value}
      tone={value > 0 ? 'purchasing' : 'complete'}
      title={value > 0 ? 'Approved units not yet purchased' : 'Nothing left to purchase'}
    />
  );
}

/**
 * Receiving Outstanding — amber when units are still expected. This is
 * legitimate work awaiting the warehouse, NOT a discrepancy; that distinction is
 * why it never renders red on its own.
 */
export function ReceivingOutstanding({ value }) {
  return (
    <QuantityValue
      value={value}
      tone={value > 0 ? 'receiving' : 'complete'}
      title={value > 0 ? 'Purchased units not yet received' : 'Nothing left to receive'}
    />
  );
}

/**
 * Qty Discrepancy — red, and populated ONLY when the existing discrepancy rule
 * flagged the purchase order. A plain receiving gap leaves this empty, so an
 * in-flight PO can never be shown as an exception.
 */
export function QtyDiscrepancy({ value, flagged }) {
  if (!flagged) {
    return (
      <span className="text-[#bbb]" title="No receiving discrepancy flagged on this purchase order">
        &mdash;
      </span>
    );
  }
  return <QuantityValue value={value} tone="discrepancy" title="Receiving discrepancy on a flagged purchase order" />;
}

export default function QuantityIndicator({ item }) {
  const tone = resolveTone(item);
  const label = {
    discrepancy: 'Discrepancy flagged',
    receiving: 'Receiving outstanding',
    purchasing: 'Purchase outstanding',
    complete: 'Nothing outstanding',
  }[tone];
  return (
    <span className="inline-flex items-center gap-2 text-[12px] font-semibold text-[#666]">
      <span className={TONES[tone]}>{label}</span>
    </span>
  );
}
