'use client';
import React, { useState } from 'react';
import StatCard from '../ui/StatCard';
import SearchInput from '../ui/SearchInput';
import EmptyState from '../ui/EmptyState';
import MaterialRequestReceipt from '../shared/MaterialRequestReceipt';
import MonitoringDetailsForm from './MonitoringDetailsForm';
import { useWarehouseData } from '../../context/WarehouseDataContext';

function PurchaseOrdersView() {
  const { purchaseOrders, completedCount, activeCount } = useWarehouseData();
  const [selectedPoType, setSelectedPoType] = useState('completed');
  const [poSearchQuery, setPoSearchQuery] = useState('');
  const [selectedReceiptPo, setSelectedReceiptPo] = useState(null);
  const [showReceiptModal, setShowReceiptModal] = useState(false);
  const [showMonitoringModal, setShowMonitoringModal] = useState(false);
  const [selectedMonitoringPo, setSelectedMonitoringPo] = useState(null);

  const handleOpenReceipt = (po) => {
    setSelectedReceiptPo(po);
    setShowReceiptModal(true);
  };

  const handleOpenMonitoring = (po) => {
    setSelectedMonitoringPo(po);
    setShowMonitoringModal(true);
  };

  const filteredPOs = purchaseOrders.filter(order => {
    const matchesType = selectedPoType === 'completed'
      ? order.status === 'completed'
      : (order.status === 'incomplete' && order.poType === 'active-delivery');
    const matchesSearch = poSearchQuery === '' || order.poNumber.includes(poSearchQuery);
    return matchesType && matchesSearch;
  });

  return (
    <div className="bg-white rounded-lg p-6 text-left">
      <div className="mb-8">
        <h1 className="m-0 text-3xl max-md:text-2xl text-[#333] font-bold">Purchase Orders</h1>
        <p className="mt-2 mx-0 mb-0 text-sm text-[#666]">Manage and track material requisitions</p>
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(250px,1fr))] max-md:grid-cols-1 gap-5 mb-8">
        <div
          className={`border-2 rounded-xl p-8 text-center cursor-pointer transition-all duration-300 transform ${
            selectedPoType === 'completed'
              ? 'bg-gradient-to-br from-[#e3f2fd] to-[#bbdefb] border-2 border-[#1e3c72] shadow-[0_4px_16px_rgba(30,60,114,0.15)] scale-[1.02] -translate-y-1'
              : 'bg-white border-2 border-[#e0e0e0] shadow-[0_2px_8px_rgba(0,0,0,0.06)] hover:border-[#1e3c72]'
          }`}
          onClick={() => setSelectedPoType('completed')}
        >
          <h3 className="m-0 text-sm text-[#666] font-semibold mb-3">Completed</h3>
          <div className="text-5xl font-bold text-[#1e3c72]">{completedCount}</div>
        </div>
        <div
          className={`border-2 rounded-xl p-8 text-center cursor-pointer transition-all duration-300 transform ${
            selectedPoType === 'active-delivery'
              ? 'bg-gradient-to-br from-[#e8f5e9] to-[#c8e6c9] border-2 border-[#2e7d32] shadow-[0_4px_16px_rgba(46,125,50,0.15)] scale-[1.02] -translate-y-1'
              : 'bg-white border-2 border-[#e0e0e0] shadow-[0_2px_8px_rgba(0,0,0,0.06)] hover:border-[#2e7d32]'
          }`}
          onClick={() => setSelectedPoType('active-delivery')}
        >
          <h3 className="m-0 text-sm text-[#666] font-semibold mb-3">Active Delivery</h3>
          <div className="text-5xl font-bold text-[#2e7d32]">{activeCount}</div>
        </div>
      </div>

      <div className="mt-8">
        <div className="mb-4">
          <h2 className="m-0 text-lg text-[#333] font-bold">
            {selectedPoType === 'completed' ? 'Completed' : 'Active Delivery'}
          </h2>
          <p className="mt-1 mx-0 mb-0 text-[13px] text-[#999]">
            {selectedPoType === 'completed' ? 'Successful Deliveries' : 'Deliveries in process'}
          </p>
        </div>

        <SearchInput
          placeholder="Search PO number..."
          value={poSearchQuery}
          onChange={(e) => setPoSearchQuery(e.target.value)}
        />

        <div className="mt-4 border border-[#e0e0e0] rounded-lg overflow-hidden">
          <div className="overflow-x-auto max-h-[500px]">
            <table className="w-full border-collapse text-[13px]">
              <thead className="bg-[#e3f2fd] sticky top-0 z-10">
                <tr>
                  {['PO date', 'PO number', 'Item Description', 'Qty', 'Unit', 'Supplier Name', 'MRS No.', 'PO rvd date', 'Pick-up by'].map((h, i) => (
                    <th key={i} className="p-4 text-left font-bold text-[#1e3c72] border-b border-[#1e3c72]/20 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredPOs.length > 0 ? (
                  filteredPOs.map((order, index) => (
                    <tr key={index}
                      onClick={() => {
                        if (order.status === 'incomplete' && order.poType === 'active-delivery') {
                          handleOpenMonitoring(order);
                        } else {
                          handleOpenReceipt(order);
                        }
                      }}
                      className={`border-b border-gray-200 transition-colors duration-150 cursor-pointer hover:bg-[#f0f8fc]/50 ${index % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}`}>
                      <td className="p-4 text-[#333] font-medium whitespace-nowrap">{order.date}</td>
                      <td className="p-4 text-[#333] font-medium whitespace-nowrap">{order.poNumber}</td>
                      <td className="p-4 text-[#333] font-medium">{order.itemDescription}</td>
                      <td className="p-4 text-[#333] font-medium whitespace-nowrap">{order.qty}</td>
                      <td className="p-4 text-[#333] font-medium whitespace-nowrap">{order.unit}</td>
                      <td className="p-4 text-[#333] font-medium">{order.supplier}</td>
                      <td className="p-4 text-[#333] font-medium whitespace-nowrap">{order.mrsNo}</td>
                      <td className="p-4 text-[#333] font-medium whitespace-nowrap">{order.poExpDate}</td>
                      <td className="p-4 text-[#333] font-medium whitespace-nowrap">{order.pickupBy}</td>
                    </tr>
                  ))
                ) : (
                  <EmptyState colSpan={9} message="No purchase orders found" />
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {showReceiptModal && selectedReceiptPo && (
        <MaterialRequestReceipt po={selectedReceiptPo} onClose={() => { setShowReceiptModal(false); setSelectedReceiptPo(null); }} />
      )}

      {showMonitoringModal && selectedMonitoringPo && (
        <MonitoringDetailsForm
          po={selectedMonitoringPo}
          onClose={() => { setShowMonitoringModal(false); setSelectedMonitoringPo(null); }}
        />
      )}
    </div>
  );
}

export default PurchaseOrdersView;
