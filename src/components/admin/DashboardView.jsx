'use client';
import React, { useState } from 'react';
import StatCard from '../ui/StatCard';
import StackedStatCard from '../ui/StackedStatCard';
import SearchInput from '../ui/SearchInput';
import EmptyState from '../ui/EmptyState';
import MaterialRequestReceipt from '../shared/MaterialRequestReceipt';
import GenerateReportButton from './GenerateReportButton';
import WarehouseFilter from './WarehouseFilter';
import { useAdminData } from '../../context/AdminDataContext';

function DashboardView() {
  const { purchaseOrders, warehouses } = useAdminData();
  const [selectedStat, setSelectedStat] = useState(null);
  const [dashboardSearchQuery, setDashboardSearchQuery] = useState('');
  const [selectedWarehouse, setSelectedWarehouse] = useState('');
  const [selectedReceiptPo, setSelectedReceiptPo] = useState(null);
  const [showReceiptModal, setShowReceiptModal] = useState(false);

  const handleOpenReceipt = (po) => {
    setSelectedReceiptPo(po);
    setShowReceiptModal(true);
  };

  const warehouseFilteredPOs = selectedWarehouse
    ? purchaseOrders.filter(o => o.warehouse === selectedWarehouse)
    : purchaseOrders;

  const whTotalPOs = warehouseFilteredPOs.length;
  const whCompletedPOs = warehouseFilteredPOs.filter(o => o.status === 'completed').length;
  const whDiscrepancyPOs = warehouseFilteredPOs.filter(o => o.poType === 'discrepancy').length;
  const whActiveDeliveryPOs = warehouseFilteredPOs.filter(o => o.poType === 'active-delivery').length;
  const whIncompletePOs = whTotalPOs - whCompletedPOs;

  const filteredOrders = warehouseFilteredPOs.filter(order => {
    if (selectedStat === 'completed' && order.status !== 'completed') return false;
    if (selectedStat === 'discrepancy' && order.poType !== 'discrepancy') return false;
    if (selectedStat === 'active-delivery' && order.poType !== 'active-delivery') return false;
    if (dashboardSearchQuery && !order.poNumber.includes(dashboardSearchQuery)) return false;
    return true;
  });

  return (
    <div className="bg-white rounded-lg p-6">
      <div className="flex items-start justify-between mb-8 max-md:flex-col max-md:gap-4">
        <div>
          <h1 className="m-0 text-3xl max-md:text-2xl text-[#333] font-bold">Dashboard</h1>
          <p className="mt-2 mx-0 mb-0 text-sm text-[#666]">Overview of complete vs incomplete purchase order fulfillment</p>
        </div>
        <WarehouseFilter warehouses={warehouses} selected={selectedWarehouse} onChange={setSelectedWarehouse} />
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(250px,1fr))] max-md:grid-cols-1 gap-5 mb-8">
        <StatCard
          label="Total PO's"
          count={whTotalPOs}
          color="blue"
          isActive={selectedStat === 'total'}
          onClick={() => setSelectedStat(selectedStat === 'total' ? null : 'total')}
        />
        <StatCard
          label="Completed"
          count={whCompletedPOs}
          color="green"
          isActive={selectedStat === 'completed'}
          onClick={() => setSelectedStat(selectedStat === 'completed' ? null : 'completed')}
        />
        <StackedStatCard
          topLabel="Incomplete"
          topCount={whDiscrepancyPOs}
          topColor="red"
          topIsActive={selectedStat === 'discrepancy'}
          topOnClick={() => setSelectedStat(selectedStat === 'discrepancy' ? null : 'discrepancy')}
          bottomLabel="Active Delivery"
          bottomCount={whActiveDeliveryPOs}
          bottomColor="yellow"
          bottomIsActive={selectedStat === 'active-delivery'}
          bottomOnClick={() => setSelectedStat(selectedStat === 'active-delivery' ? null : 'active-delivery')}
        />
      </div>

      <div className="mt-8">
        <div className="mb-4">
          <h2 className="m-0 text-lg text-[#333] font-bold">
            {selectedStat === 'completed' ? 'Completed Purchase Orders' : selectedStat === 'discrepancy' ? 'Incomplete Purchase Orders (Discrepancy)' : selectedStat === 'active-delivery' ? 'Active Delivery Purchase Orders' : 'Total Purchase Orders'}
          </h2>
          <p className="mt-1 mx-0 mb-0 text-[13px] text-[#999]">
            {selectedStat === 'completed' ? 'Successfully completed purchase orders' : selectedStat === 'discrepancy' ? 'Purchase orders with quantity discrepancies' : selectedStat === 'active-delivery' ? 'Purchase orders currently in delivery' : 'All made purchase orders'}
          </p>
        </div>
        <div className="flex items-center justify-between gap-4 mb-4">
          <SearchInput
            placeholder="Search PO number..."
            value={dashboardSearchQuery}
            onChange={(e) => setDashboardSearchQuery(e.target.value)}
          />
          <GenerateReportButton filteredOrders={filteredOrders} totalPOs={whTotalPOs} completedPOs={whCompletedPOs} incompletePOs={whIncompletePOs} showActiveDeliveryOption={selectedStat === null || selectedStat === 'total'} />
        </div>
        <div className="border border-[#e0e0e0] rounded-lg overflow-hidden">
          <div className="overflow-x-auto max-h-[500px]">
            <table className="w-full border-collapse text-[13px]">
              <thead className="sticky top-0 z-10">
                <tr>
                  <th colSpan={10} className="bg-gradient-to-r from-[#e3f2fd] to-[#bbdefb] p-2 text-center font-bold text-[#1e3c72] text-xs border-b-2 border-[#1e3c72]/30">PURCHASE ORDER</th>
                  <th colSpan={10} className="bg-gradient-to-r from-[#e8f5e9] to-[#c8e6c9] p-2 text-center font-bold text-[#2e7d32] text-xs border-b-2 border-[#2e7d32]/30">WAREHOUSE MONITORING</th>
                </tr>
                <tr>
                  <th className="bg-gradient-to-r from-[#e3f2fd] to-[#bbdefb] p-4 text-left font-bold text-[#1e3c72] border-b-2 border-[#1e3c72]/30 whitespace-nowrap">PO date</th>
                  <th className="bg-gradient-to-r from-[#e3f2fd] to-[#bbdefb] p-4 text-left font-bold text-[#1e3c72] border-b-2 border-[#1e3c72]/30 whitespace-nowrap">PO number</th>
                  <th className="bg-gradient-to-r from-[#e3f2fd] to-[#bbdefb] p-4 text-left font-bold text-[#1e3c72] border-b-2 border-[#1e3c72]/30 whitespace-nowrap">Item Description</th>
                  <th className="bg-gradient-to-r from-[#e3f2fd] to-[#bbdefb] p-4 text-left font-bold text-[#1e3c72] border-b-2 border-[#1e3c72]/30 whitespace-nowrap">Qty</th>
                  <th className="bg-gradient-to-r from-[#e3f2fd] to-[#bbdefb] p-4 text-left font-bold text-[#1e3c72] border-b-2 border-[#1e3c72]/30 whitespace-nowrap">Unit</th>
                  <th className="bg-gradient-to-r from-[#e3f2fd] to-[#bbdefb] p-4 text-left font-bold text-[#1e3c72] border-b-2 border-[#1e3c72]/30 whitespace-nowrap">Supplier Name</th>
                  <th className="bg-gradient-to-r from-[#e3f2fd] to-[#bbdefb] p-4 text-left font-bold text-[#1e3c72] border-b-2 border-[#1e3c72]/30 whitespace-nowrap">Requisitioner</th>
                  <th className="bg-gradient-to-r from-[#e3f2fd] to-[#bbdefb] p-4 text-left font-bold text-[#1e3c72] border-b-2 border-[#1e3c72]/30 whitespace-nowrap">MRS No.</th>
                  <th className="bg-gradient-to-r from-[#e3f2fd] to-[#bbdefb] p-4 text-left font-bold text-[#1e3c72] border-b-2 border-[#1e3c72]/30 whitespace-nowrap">PO red date</th>
                  <th className="bg-gradient-to-r from-[#e3f2fd] to-[#bbdefb] p-4 text-left font-bold text-[#1e3c72] border-b-2 border-[#1e3c72]/30 whitespace-nowrap">Pick-up by</th>
                  <th className="bg-gradient-to-r from-[#e8f5e9] to-[#c8e6c9] p-4 text-left font-bold text-[#2e7d32] border-b-2 border-[#2e7d32]/30 whitespace-nowrap">PO number</th>
                  <th className="bg-gradient-to-r from-[#e8f5e9] to-[#c8e6c9] p-4 text-left font-bold text-[#2e7d32] border-b-2 border-[#2e7d32]/30 whitespace-nowrap">Pick-up date</th>
                  <th className="bg-gradient-to-r from-[#e8f5e9] to-[#c8e6c9] p-4 text-left font-bold text-[#2e7d32] border-b-2 border-[#2e7d32]/30 whitespace-nowrap">Item Description</th>
                  <th className="bg-gradient-to-r from-[#e8f5e9] to-[#c8e6c9] p-4 text-left font-bold text-[#2e7d32] border-b-2 border-[#2e7d32]/30 whitespace-nowrap">Qty. rvd</th>
                  <th className="bg-gradient-to-r from-[#e8f5e9] to-[#c8e6c9] p-4 text-left font-bold text-[#2e7d32] border-b-2 border-[#2e7d32]/30 whitespace-nowrap">Unit</th>
                  <th className="bg-gradient-to-r from-[#e8f5e9] to-[#c8e6c9] p-4 text-left font-bold text-[#2e7d32] border-b-2 border-[#2e7d32]/30 whitespace-nowrap">Delivered By</th>
                  <th className="bg-gradient-to-r from-[#e8f5e9] to-[#c8e6c9] p-4 text-left font-bold text-[#2e7d32] border-b-2 border-[#2e7d32]/30 whitespace-nowrap">Date delivered</th>
                  <th className="bg-gradient-to-r from-[#e8f5e9] to-[#c8e6c9] p-4 text-left font-bold text-[#2e7d32] border-b-2 border-[#2e7d32]/30 whitespace-nowrap">Reference No.</th>
                  <th className="bg-gradient-to-r from-[#e8f5e9] to-[#c8e6c9] p-4 text-left font-bold text-[#2e7d32] border-b-2 border-[#2e7d32]/30 whitespace-nowrap">DR date</th>
                  <th className="bg-gradient-to-r from-[#e8f5e9] to-[#c8e6c9] p-4 text-left font-bold text-[#2e7d32] border-b-2 border-[#2e7d32]/30 whitespace-nowrap">Pick-up By</th>
                </tr>
              </thead>
              <tbody>
                {filteredOrders.length > 0 ? (
                  filteredOrders.map((order, index) => {
                    const isCompletedOrActive = order.status === 'completed' || order.poType === 'active-delivery';
                    const hasMonitoring = order.monQtyRvd && order.monQtyRvd !== '';
                    const isDiscrepancy = hasMonitoring && parseInt(order.monQtyRvd) !== order.qty;
                    const rowBg = isDiscrepancy ? 'bg-[#fef5f5]' : isCompletedOrActive ? 'bg-[#e8f5e9]' : order.status === 'incomplete' ? 'bg-[#fef5f5]' : (index % 2 === 0 ? 'bg-white' : 'bg-gray-50/50');
                    return (
                      <tr key={index} onClick={() => handleOpenReceipt(order)} className={`border-b border-gray-200 transition-colors duration-150 cursor-pointer ${rowBg} hover:bg-[#f0f8fc]/50`}>
                        <td className="p-4 text-[#333] font-medium whitespace-nowrap">{order.date}</td>
                        <td className="p-4 text-[#333] font-medium whitespace-nowrap">{order.poNumber}</td>
                        <td className="p-4 text-[#333] font-medium">{order.itemDescription}</td>
                        <td className="p-4 text-[#333] font-medium whitespace-nowrap">{order.qty}</td>
                        <td className="p-4 text-[#333] font-medium whitespace-nowrap">{order.unit}</td>
                        <td className="p-4 text-[#333] font-medium">{order.supplier}</td>
                        <td className="p-4 text-[#333] font-medium">{order.requisitioner}</td>
                        <td className="p-4 text-[#333] font-medium whitespace-nowrap">{order.mrsNo}</td>
                        <td className="p-4 text-[#333] font-medium whitespace-nowrap">{order.poExpDate}</td>
                        <td className="p-4 text-[#333] font-medium whitespace-nowrap">{order.pickupBy}</td>
                        <td className={`p-4 font-medium whitespace-nowrap ${isDiscrepancy ? 'text-[#d32f2f] font-bold' : 'text-[#333]'}`}>{order.poNumber}</td>
                        <td className={`p-4 font-medium whitespace-nowrap ${isDiscrepancy ? 'text-[#d32f2f] font-bold' : 'text-[#333]'}`}>{order.date}</td>
                        <td className={`p-4 font-medium ${isDiscrepancy ? 'text-[#d32f2f] font-bold' : 'text-[#333]'}`}>{order.itemDescription}</td>
                        <td className={`p-4 font-medium whitespace-nowrap ${isDiscrepancy ? 'text-[#d32f2f] font-bold bg-red-50' : 'text-[#333]'}`}>{order.monQtyRvd || '-'}</td>
                        <td className={`p-4 font-medium whitespace-nowrap ${isDiscrepancy ? 'text-[#d32f2f] font-bold' : 'text-[#333]'}`}>{order.unit}</td>
                        <td className={`p-4 font-medium ${isDiscrepancy ? 'text-[#d32f2f] font-bold' : 'text-[#333]'}`}>{order.monDeliveredBy || '-'}</td>
                        <td className={`p-4 font-medium whitespace-nowrap ${isDiscrepancy ? 'text-[#d32f2f] font-bold' : 'text-[#333]'}`}>{order.monDateDelivered || '-'}</td>
                        <td className={`p-4 font-medium whitespace-nowrap ${isDiscrepancy ? 'text-[#d32f2f] font-bold' : 'text-[#333]'}`}>{order.monReferenceNo || '-'}</td>
                        <td className={`p-4 font-medium whitespace-nowrap ${isDiscrepancy ? 'text-[#d32f2f] font-bold' : 'text-[#333]'}`}>{order.monDrDate || '-'}</td>
                        <td className={`p-4 font-medium whitespace-nowrap ${isDiscrepancy ? 'text-[#d32f2f] font-bold' : 'text-[#333]'}`}>{order.pickupBy}</td>
                      </tr>
                    );
                  })
                ) : (
                  <EmptyState colSpan={20} message="No purchase orders found" />
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {showReceiptModal && selectedReceiptPo && (
        <MaterialRequestReceipt po={selectedReceiptPo} onClose={() => { setShowReceiptModal(false); setSelectedReceiptPo(null); }} />
      )}
    </div>
  );
}

export default DashboardView;
