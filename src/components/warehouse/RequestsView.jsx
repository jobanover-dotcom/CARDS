'use client';
import React, { useState } from 'react';
import StatusBadge from '../ui/StatusBadge';
import EmptyState from '../ui/EmptyState';
import CreateRequestModal from './CreateRequestModal';
import { useWarehouseData } from '../../context/WarehouseDataContext';

function RequestsView() {
  const { requestsList } = useWarehouseData();
  const [newRequestModal, setNewRequestModal] = useState(false);

  return (
    <div className="bg-white rounded-lg p-6 text-left">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="m-0 text-3xl max-md:text-2xl text-[#333] font-bold">Requests</h1>
          <p className="mt-2 mx-0 mb-0 text-sm text-[#666]">Pending and active warehouse requests</p>
        </div>
        <button
          onClick={() => setNewRequestModal(true)}
          className="bg-[#1e3c72] text-white py-2 px-5 rounded-md text-sm font-semibold cursor-pointer border-none transition-all duration-300 hover:bg-[#2a5298] hover:shadow-[0_2px_8px_rgba(30,60,114,0.3)]"
        >
          Create Request
        </button>
      </div>

      <div className="border border-[#e0e0e0] rounded-lg overflow-hidden">
        <div className="overflow-x-auto max-h-[500px]">
          <table className="w-full border-collapse text-[13px]">
            <thead className="bg-[#f0f4f8] sticky top-0 z-10">
              <tr>
                {['Date', 'MRS No.', 'Item Description', 'Qty', 'Unit', 'Requested By', 'Status'].map((h, i) => (
                  <th key={i} className="p-4 text-left font-bold text-[#555] border-b border-gray-200">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {requestsList.length > 0 ? (
                requestsList.map((req, index) => (
                  <tr key={index} className={`border-b border-gray-200 ${index % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}`}>
                    <td className="p-4 text-[#333] font-medium">{req.date}</td>
                    <td className="p-4 text-[#333] font-medium">{req.mrsNo}</td>
                    <td className="p-4 text-[#333] font-medium">{req.itemDescription}</td>
                    <td className="p-4 text-[#333] font-medium">{req.qty}</td>
                    <td className="p-4 text-[#333] font-medium">{req.unit}</td>
                    <td className="p-4 text-[#333] font-medium">{req.requestedBy}</td>
                    <td className="p-4"><StatusBadge status={req.status} /></td>
                  </tr>
                ))
              ) : (
                <EmptyState colSpan={7} message="No requests found" />
              )}
            </tbody>
          </table>
        </div>
      </div>

      {newRequestModal && (
        <CreateRequestModal onClose={() => setNewRequestModal(false)} />
      )}
    </div>
  );
}

export default RequestsView;
