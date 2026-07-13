import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useFetchPOs } from '../hooks/useFetchPOs';

function PurchaseOrders() {
  const { user } = useAuth();
  const { purchaseOrders, getStats } = useFetchPOs();
  const stats = getStats();

  return (
    <div className="p-6">
      <h1 className="text-3xl font-bold text-[#333] mb-6">Purchase Orders</h1>
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-xl p-6 border-2 border-[#90caf9] shadow-sm">
          <h3 className="text-sm text-[#666] font-semibold">Total POs</h3>
          <div className="text-4xl font-bold text-[#1e3c72]">{stats.total}</div>
        </div>
        <div className="bg-white rounded-xl p-6 border-2 border-[#a5d6a7] shadow-sm">
          <h3 className="text-sm text-[#666] font-semibold">Completed</h3>
          <div className="text-4xl font-bold text-[#2e7d32]">{stats.completed}</div>
        </div>
        <div className="bg-white rounded-xl p-6 border-2 border-[#f44336] shadow-sm">
          <h3 className="text-sm text-[#666] font-semibold">Incomplete</h3>
          <div className="text-4xl font-bold text-[#c62828]">{stats.incomplete}</div>
        </div>
      </div>
    </div>
  );
}

export default PurchaseOrders;
