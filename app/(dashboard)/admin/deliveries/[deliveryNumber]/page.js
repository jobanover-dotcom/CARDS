'use client';
import React from 'react';
import Link from 'next/link';

// Active Delivery Tracking is retired. Historical DEL-* records live under
// Archived Deliveries (Purchaser/Superadmin, read-only). Warehouse has no access.
export default function RetiredDeliveryPage() {
  return (
    <div className="bg-white rounded-lg p-6">
      <h1 className="text-xl font-bold">Delivery Tracking retired</h1>
      <p className="text-sm text-[#666]">Active delivery tracking is no longer part of the workflow. The purchaser uses the On Delivery checkpoint; the warehouse confirms receiving.</p>
      <p className="text-sm mt-2"><Link className="text-[#006680] font-semibold" href="/purchaser/archived-deliveries">Open Archived Deliveries (Purchaser/Superadmin, read-only)</Link></p>
    </div>
  );
}
