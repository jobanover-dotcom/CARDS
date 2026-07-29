'use client';
import React, { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import StatCard from '../ui/StatCard';
import SearchInput from '../ui/SearchInput';
import EmptyState from '../ui/EmptyState';
import MaterialRequestReceipt from '../shared/MaterialRequestReceipt';
import POCreationForm from './POCreationForm';
import { useAdminData } from '../../context/AdminDataContext';

function PurchaseOrderContent() {
  const { purchaseOrders, setPurchaseOrders, activeDeliveryCount, discrepancyCount, warehouseRequests, setWarehouseRequests } = useAdminData();
  const searchParams = useSearchParams();
  const [selectedPoType, setSelectedPoType] = useState('all');
  const [poSearchQuery, setPoSearchQuery] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [selectedReceiptPo, setSelectedReceiptPo] = useState(null);
  const [showReceiptModal, setShowReceiptModal] = useState(false);

  const [initialFormData, setInitialFormData] = useState(null);

  useEffect(() => {
    if (searchParams.get('openPOModal') === 'true') {
      setInitialFormData({
        itemDescription: searchParams.get('itemDescription') || '',
        qty: searchParams.get('qty') || '',
        unit: searchParams.get('unit') || 'pcs',
        requisitioner: searchParams.get('requisitioner') || '',
        mrsNo: searchParams.get('mrsNo') || '',
        approvedBy: searchParams.get('approvedBy') || '',
        approvalDate: searchParams.get('approvalDate') || '',
      });
      setShowModal(true);
    }
  }, [searchParams]);

  const handleOpenReceipt = (po) => {
    setSelectedReceiptPo(po);
    setShowReceiptModal(true);
  };

  const filteredOrders = purchaseOrders.filter(order => {
    if (selectedPoType !== 'all' && order.poType !== selectedPoType) return false;
    if (poSearchQuery && !order.poNumber.includes(poSearchQuery)) return false;
    return true;
  });

  const handleSuccess = () => {
    setShowSuccessModal(true);
  };

  const handleModalClose = () => {
    setShowModal(false);
    setInitialFormData(null);
  };

  return (
    <div className="bg-white rounded-lg p-6">
      <div className="mb-8">
        <h1 className="m-0 text-3xl max-md:text-2xl text-[#333] font-bold">Purchase Orders</h1>
        <p className="mt-2 mx-0 mb-0 text-sm text-[#666]">Manage and track material requisitions</p>
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(250px,1fr))] max-md:grid-cols-1 gap-5 mb-8">
        <StatCard label="Total POs" count={purchaseOrders.length} description="All purchase orders" color="blue" isActive={selectedPoType === 'all'} onClick={() => setSelectedPoType('all')} />
        <StatCard label="Active Delivery" count={activeDeliveryCount} description="Orders currently in delivery" color="green" isActive={selectedPoType === 'active-delivery'} onClick={() => setSelectedPoType('active-delivery')} />
        <StatCard label="Discrepancies" count={discrepancyCount} description="Orders with issues" color="red" isActive={selectedPoType === 'discrepancy'} onClick={() => setSelectedPoType('discrepancy')} />
      </div>

      <div className="mb-6">
        <button className="bg-white text-[#0288d1] border-2 border-[#7ec8e3] py-2.5 px-5 rounded-md text-sm font-semibold cursor-pointer transition-all duration-300 inline-flex items-center gap-2 hover:bg-[#f0f8fc] hover:border-[#0288d1] hover:-translate-y-0.5 hover:shadow-[0_2px_8px_rgba(2,136,209,0.15)] active:translate-y-0" onClick={() => setShowModal(true)}>
          New purchase order
        </button>
      </div>

      <div className="mt-8">
        <div className="mb-4">
          <h2 className="m-0 text-lg text-[#333] font-bold">
            {selectedPoType === 'all' ? 'All Purchase Orders' : selectedPoType === 'active-delivery' ? 'Active Delivery' : 'Discrepancies'}
          </h2>
          <p className="mt-1 mx-0 mb-0 text-[13px] text-[#999]">
            {selectedPoType === 'all' ? 'All purchase orders' : selectedPoType === 'active-delivery' ? 'Purchase orders currently active and out for delivery' : 'Purchase orders with identified discrepancies'}
          </p>
        </div>
        <SearchInput placeholder="Search PO number..." value={poSearchQuery} onChange={(e) => setPoSearchQuery(e.target.value)} />
        <div className="mt-4 border border-[#e0e0e0] rounded-lg overflow-hidden">
          <div className="overflow-x-auto max-h-[500px]">
            <table className="w-full border-collapse text-[13px]">
              <thead className={`bg-gradient-to-r sticky top-0 z-10 ${selectedPoType === 'all' ? 'from-[#e3f2fd] to-[#bbdefb]' : selectedPoType === 'active-delivery' ? 'from-[#e8f5e9] to-[#c8e6c9]' : 'from-[#fef5f5] to-[#ffcdd2]'}`}>
                <tr>
                  {['PO date', 'PO number', 'Item Description', 'Qty', 'Unit', 'Supplier Name', 'Requisitioner', 'MRS No.', 'PO red date', 'Pick-up by'].map((h, i) => (
                    <th key={i} className={`p-4 text-left font-bold whitespace-nowrap ${selectedPoType === 'all' ? 'text-[#1e3c72] border-b-2 border-[#1e3c72]/30' : selectedPoType === 'active-delivery' ? 'text-[#2e7d32] border-b-2 border-[#2e7d32]/30' : 'text-[#c62828] border-b-2 border-[#c62828]/30'}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredOrders.length > 0 ? (
                  filteredOrders.map((order, index) => (
                    <tr key={index} onClick={() => handleOpenReceipt(order)}
                      className={`border-b border-gray-200 transition-colors duration-150 cursor-pointer ${index % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'} hover:bg-[#f4fbf7]/50`}>
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
                    </tr>
                  ))
                ) : (
                  <EmptyState colSpan={10} message="No purchase orders found" />
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {showModal && (
        <POCreationForm onClose={handleModalClose} onSuccess={handleSuccess} initialData={initialFormData} />
      )}

      {showSuccessModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-[1000] animate-fade-in">
          <div className="bg-white rounded-xl w-full max-w-[380px] text-center py-8 px-6 shadow-[0_10px_30px_rgba(0,0,0,0.15)] animate-slide-in">
            <div className="flex flex-col items-center gap-3">
              <div className="bg-[#e8f5e9] text-[#2e7d32] text-3xl w-16 h-16 rounded-full flex items-center justify-center mb-3 border-2 border-[#a5d6a7] font-bold">&#10003;</div>
              <h3 className="m-0 text-lg text-[#333] font-bold">Successfully Added</h3>
              <p className="m-0 text-[13px] text-[#666] leading-relaxed mb-4">The purchase order has been successfully added to Active Delivery.</p>
              <button className="bg-[#2e7d32] text-white border-none py-2.5 px-8 rounded-md text-sm font-semibold cursor-pointer transition-all duration-200 min-w-[100px] hover:bg-[#1b5e20] hover:shadow-[0_2px_8px_rgba(46,125,50,0.3)] hover:-translate-y-0.5" onClick={() => setShowSuccessModal(false)}>OK</button>
            </div>
          </div>
        </div>
      )}

      {showReceiptModal && selectedReceiptPo && (
        <MaterialRequestReceipt po={selectedReceiptPo} onClose={() => { setShowReceiptModal(false); setSelectedReceiptPo(null); }} />
      )}
    </div>
  );
}

function PurchaseOrderView() {
  return (
    <Suspense fallback={<div className="p-6 text-center text-[#999]">Loading...</div>}>
      <PurchaseOrderContent />
    </Suspense>
  );
}

export default PurchaseOrderView;
