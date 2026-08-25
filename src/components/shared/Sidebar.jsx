'use client';
import React from 'react';
import { useAuth } from '../../context/AuthContext';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const logoutIcon = (
  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <polyline points="16 17 21 12 16 7" />
    <line x1="21" y1="12" x2="9" y2="12" />
  </svg>
);

function Sidebar({ menuItems, logo }) {
  const { user, logout } = useAuth();
  const pathname = usePathname();

  const userBadge = user?.role === 'Superadmin'
    ? 'Admin'
    : user?.role === 'Admin'
      ? 'Purchaser'
      : user?.warehouse || 'Warehouse';

  return (
    <div className="w-[240px] max-md:w-full bg-[#e8eef2] p-6 max-md:p-4 flex flex-col max-md:flex-row max-md:items-center border-r border-[#ddd] max-md:border-r-0 max-md:border-b overflow-y-auto">
      <div className="flex items-center gap-3 mb-8 max-md:mb-0 pb-4 max-md:pb-0 border-b border-[#d0d8e0] max-md:border-b-0">
        {logo}
        <div className="flex-1">
          <h3 className="m-0 text-sm font-semibold text-[#333]">Carwill Construction Inc.</h3>
          <span className="inline-block bg-[#7ec8e3] text-white px-2 py-1 rounded text-[11px] font-semibold mt-1">{userBadge}</span>
        </div>
      </div>

      <nav className="flex-1 flex flex-col max-md:flex-row gap-2 max-md:gap-0 mb-8 max-md:mb-0 max-md:ml-8">
        {menuItems.map(item => {
          const isRootExact = item.href === '/admin' || item.href === '/warehouse' || item.href === '/purchaser';
          const isActive = pathname === item.href || (!isRootExact && pathname.startsWith(item.href + '/'));

          return (
            <Link
              key={item.id}
              href={item.href}
              className={`flex items-center justify-start max-md:justify-center gap-3 py-3 px-4 max-md:py-2 max-md:px-3 border-none rounded-md cursor-pointer text-sm font-medium transition-all duration-300 max-md:flex-1 no-underline ${
                isActive
                  ? 'bg-[#1e3c72] text-white'
                  : 'bg-transparent text-[#555] hover:bg-[#7ec8e3]/20 hover:text-[#333]'
              }`}
            >
              <span className="text-base">{item.icon}</span>
              <span className="flex-1 text-left max-md:hidden">{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <button onClick={logout} className="flex items-center gap-3 py-3 px-4 bg-transparent border-none rounded-md cursor-pointer text-[#d32f2f] text-sm font-semibold transition-all duration-300 hover:bg-[#d32f2f]/10 max-md:ml-auto w-full justify-start">
        <span className="text-base flex items-center justify-center">{logoutIcon}</span>
        Log out
      </button>
    </div>
  );
}

export default Sidebar;
