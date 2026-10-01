'use client';
import React from 'react';

const statusStyles = {
  Approved: 'bg-[#e8f5e9] text-[#2e7d32] border-[#a5d6a7]',
  'Partially Approved': 'bg-[#fff3e0] text-[#ef6c00] border-[#ffcc80]',
  Completed: 'bg-gray-100 text-gray-700 border-gray-300',
  Open: 'bg-[#e8f5e9] text-[#2e7d32] border-[#a5d6a7]',
  Pending: 'bg-yellow-50 text-yellow-700 border-yellow-300',
  Rejected: 'bg-red-50 text-red-700 border-red-300',
  // V1 procurement → delivery → receiving (labels derived from src/lib/deliveryStatus)
  'Awaiting Purchase': 'bg-yellow-50 text-yellow-700 border-yellow-300',
  'Purchase Confirmed': 'bg-[#e3f2fd] text-[#1e3c72] border-[#90caf9]',
  'Ready for Delivery': 'bg-[#e8f5e9] text-[#2e7d32] border-[#a5d6a7]',
  'For Delivery': 'bg-[#e3f2fd] text-[#1e3c72] border-[#90caf9]',
  'In Transit': 'bg-[#e8f5e9] text-[#2e7d32] border-[#a5d6a7]',
  Received: 'bg-gray-100 text-gray-700 border-gray-300',
  'Partially Received': 'bg-[#fff3e0] text-[#ef6c00] border-[#ffcc80]',
  Discrepancy: 'bg-red-50 text-red-700 border-red-300',
};

function StatusBadge({ status, className = '' }) {
  const style = statusStyles[status] || 'bg-gray-100 text-gray-600 border-gray-300';
  return (
    <span className={`px-3 py-1 rounded-full text-[11px] font-bold border transition-colors duration-200 ${style} ${className}`}>
      {status}
    </span>
  );
}

export default StatusBadge;
