'use client';
import React from 'react';
import Sidebar from '../../../src/components/shared/Sidebar';
import { AdminDataProvider } from '../../../src/context/AdminDataContext';

const purchaserMenuItems = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    href: '/purchaser',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="inline-block align-middle">
        <rect x="3" y="3" width="7" height="9" rx="1" />
        <rect x="14" y="3" width="7" height="5" rx="1" />
        <rect x="14" y="12" width="7" height="9" rx="1" />
        <rect x="3" y="16" width="7" height="5" rx="1" />
      </svg>
    )
  },
  {
    id: 'purchase-order',
    label: 'Purchase Order',
    href: '/purchaser/purchase-orders',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="inline-block align-middle">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
        <polyline points="10 9 9 9 8 9" />
      </svg>
    )
  },
  {
    id: 'history',
    label: 'History',
    href: '/purchaser/history',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="inline-block align-middle">
        <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
        <polyline points="3 3 3 8 8 8" />
        <line x1="12" y1="7" x2="12" y2="12" />
        <line x1="12" y1="12" x2="16" y2="14" />
      </svg>
    )
  },
  {
    id: 'requests',
    label: 'Requests',
    href: '/purchaser/requests',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="inline-block align-middle">
        <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
        <polyline points="22,6 12,13 2,6" />
      </svg>
    )
  }
];

const purchaserLogo = (
  <img src="/clogo.jpg" alt="CARWILL Logo" className="w-12 h-12 rounded-full bg-[#ccc] object-cover" />
);

function PurchaserLayout({ children }) {
  return (
    <AdminDataProvider>
      <div className="flex h-screen bg-[#f5f5f5] w-full max-md:flex-col font-sans">
        <Sidebar menuItems={purchaserMenuItems} logo={purchaserLogo} badge="Purchaser" />
        <div className="flex-1 overflow-y-auto p-8 max-md:p-4">
          {children}
        </div>
      </div>
    </AdminDataProvider>
  );
}

export default PurchaserLayout;
