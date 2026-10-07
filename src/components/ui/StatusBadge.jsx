'use client';
import React from 'react';

// One semantic vocabulary for the whole app, so a badge means the same thing on
// the Dashboard, on the Purchase Orders page and in the Warehouse list.
//
//   blue   = pending / approved, purchasing not started   (informational)
//   amber  = active work or outstanding quantity          (needs attention)
//   red    = exception requiring action
//   green  = finished, nothing outstanding
//   slate  = neutral / cancelled
//
// Colour is never the only signal: every badge renders its label as text, so the
// three amber stages stay distinguishable without relying on hue.
const statusStyles = {
  // Quantity-derived progress (derivePOProgressStatus).
  'Awaiting Purchase': 'bg-[#e3f2fd] text-[#1e3c72] border-[#90caf9]',
  'In Progress': 'bg-[#fff8e1] text-[#f9a825] border-[#f9a825]',
  'Awaiting Receiving': 'bg-[#fffde7] text-[#f57f17] border-[#fdd835]',
  'Mixed Progress': 'bg-[#fff3e0] text-[#e65100] border-[#ffcc80]',
  Completed: 'bg-[#e8f5e9] text-[#2e7d32] border-[#a5d6a7]',
  Cancelled: 'bg-gray-100 text-gray-500 border-gray-300',
  Discrepancy: 'bg-red-50 text-red-700 border-red-300',
  // Warehouse requests
  Approved: 'bg-[#e8f5e9] text-[#2e7d32] border-[#a5d6a7]',
  'Partially Approved': 'bg-[#fff3e0] text-[#ef6c00] border-[#ffcc80]',
  // Some quantity approved, the remainder explicitly rejected, nothing owed.
  // Slate, not amber: amber means a decision is still outstanding, and this one
  // has none.
  'Approval Closed': 'bg-gray-100 text-[#455a64] border-[#b0bec5]',
  Pending: 'bg-[#e3f2fd] text-[#1e3c72] border-[#90caf9]',
  Rejected: 'bg-red-50 text-red-700 border-red-300',
  Open: 'bg-[#e8f5e9] text-[#2e7d32] border-[#a5d6a7]',
  // Historical delivery archive (read-only; drives no card or transition)
  'For Delivery': 'bg-[#e3f2fd] text-[#1e3c72] border-[#90caf9]',
  'In Transit': 'bg-[#fff8e1] text-[#f9a825] border-[#f9a825]',
  Received: 'bg-gray-100 text-gray-700 border-gray-300',
  'Partially Received': 'bg-[#fffde7] text-[#f57f17] border-[#fdd835]',
  // Archive ledger events. These are audit labels rather than workflow states,
  // but they used to be hand-rolled pills in the Archive view, which put a fifth
  // badge implementation in the app. Same component, same vocabulary.
  Deleted: 'bg-red-50 text-red-700 border-red-300',
  Cleared: 'bg-[#fff3e0] text-[#ef6c00] border-[#ffcc80]',
  archived: 'bg-[#fff3e0] text-[#ef6c00] border-[#ffcc80]',
  restored: 'bg-[#e8f5e9] text-[#2e7d32] border-[#a5d6a7]',
  downloaded: 'bg-[#e3f2fd] text-[#1e3c72] border-[#90caf9]',
};

/**
 * Renders a display label. `status` is the already-resolved human label
 * (prefer poDisplayLabel(statusValue) for purchase orders so the label always
 * reflects the canonical lifecycle rather than a possibly-stale stored
 * statusLabel).
 */
function StatusBadge({ status, className = '' }) {
  const style = statusStyles[status] || 'bg-gray-100 text-gray-600 border-gray-300';
  return (
    <span className={`px-3 py-1 rounded-full text-[11px] font-bold border transition-colors duration-200 ${style} ${className}`}>
      {status}
    </span>
  );
}

export default StatusBadge;
