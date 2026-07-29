'use client';
import React from 'react';

function WarehouseFilter({ warehouses, selected, onChange }) {
  return (
    <select
      value={selected}
      onChange={(e) => onChange(e.target.value)}
      className="py-2.5 px-4 border border-[#ccc] rounded-md text-sm text-[#333] bg-white focus:outline-none focus:border-[#1e3c72] focus:ring-2 focus:ring-[#1e3c72]/10 transition-all duration-200 cursor-pointer min-w-[180px]"
    >
      <option value="">All Warehouses</option>
      {warehouses.map((w) => (
        <option key={w} value={w}>{w}</option>
      ))}
    </select>
  );
}

export default WarehouseFilter;
