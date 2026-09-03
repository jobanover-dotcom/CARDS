import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useInfiniteRows } from '../../hooks/useInfiniteRows';
import { getPOs } from '../../../actions/pos';
import { getRequests } from '../../../actions/requests';
import { createRequest } from '../../../actions/requests';
import { updatePO } from '../../../actions/pos';
import MaterialRequestReceipt from '../shared/MaterialRequestReceipt';

function WarehouseDashboard() {
  const { logout, user } = useAuth();
  const [activeMenu, setActiveMenu] = useState('purchase-orders');
  const [selectedPoType, setSelectedPoType] = useState('completed');
  const [poSearchQuery, setPoSearchQuery] = useState('');

  const { rows: purchaseOrders, initialLoading: posLoading, loadMore: loadMorePOs, hasMore: hasMorePOs } = useInfiniteRows(getPOs, {});
  const { rows: requestsList, initialLoading: reqLoading, loadMore: loadMoreRequests, hasMore: hasMoreRequests } = useInfiniteRows(getRequests, {});

  const [newRequestModal, setNewRequestModal] = useState(false);
  const [reqItemDescription, setReqItemDescription] = useState('');
  const [reqQty, setReqQty] = useState('');
  const [reqUnit, setReqUnit] = useState('pcs');
  const [reqMrsNo, setReqMrsNo] = useState('');
  const [reqApprovedBy, setReqApprovedBy] = useState('');
  const [reqBusy, setReqBusy] = useState(false);

  const [selectedReceiptPo, setSelectedReceiptPo] = useState(null);
  const [showReceiptModal, setShowReceiptModal] = useState(false);

  const [showMonitoringModal, setShowMonitoringModal] = useState(false);
  const [selectedMonitoringPo, setSelectedMonitoringPo] = useState(null);
  const [monPoNumber, setMonPoNumber] = useState('');
  const [monPickupDate, setMonPickupDate] = useState('');
  const [monDescription, setMonDescription] = useState('');
  const [monQtyRvd, setMonQtyRvd] = useState('');
  const [monUnit, setMonUnit] = useState('');
  const [monDeliveredBy, setMonDeliveredBy] = useState('');
  const [monDateDelivered, setMonDateDelivered] = useState('');
  const [monReferenceNo, setMonReferenceNo] = useState('');
  const [monDrDate, setMonDrDate] = useState('');
  const [monPickupBy, setMonPickupBy] = useState('');
  const [monRemarks, setMonRemarks] = useState('');
  const [showMonSuccess, setShowMonSuccess] = useState(false);
  const [monBusy, setMonBusy] = useState(false);

  const handleOpenReceipt = (po) => {
    setSelectedReceiptPo(po);
    setShowReceiptModal(true);
  };

  const handleCloseReceiptModal = () => {
    setSelectedReceiptPo(null);
    setShowReceiptModal(false);
  };

  const handleOpenMonitoring = (po) => {
    setSelectedMonitoringPo(po);
    setMonPoNumber(po.poNumber || '');
    setMonPickupDate(po.date || '');
    setMonDescription(po.itemDescription || '');
    setMonQtyRvd(po.qty || '');
    setMonUnit(po.unit || '');
    setMonDeliveredBy('');
    setMonDateDelivered('');
    setMonReferenceNo('');
    setMonDrDate('');
    setMonPickupBy(po.pickupBy || '');
    setMonRemarks('');
    setShowMonitoringModal(true);
  };

  const handleSaveMonitoring = async (e) => {
    e.preventDefault();
    if (!monQtyRvd || !monDeliveredBy || !monDateDelivered || !monReferenceNo || !monDrDate) {
      alert('Please fill in all required fields');
      return;
    }
    if (!selectedMonitoringPo) return;
    setMonBusy(true);
    try {
      const qtyReceived = parseInt(monQtyRvd) || 0;
      const originalQty = parseInt(selectedMonitoringPo.qty) || 0;
      const isCoincided = qtyReceived === originalQty;
      const finalStatus = isCoincided ? 'completed' : 'incomplete';
      const finalPoType = isCoincided ? 'completed' : 'discrepancy';
      const finalStatusLabel = isCoincided ? 'Completed' : 'Open';
      await updatePO(selectedMonitoringPo.poNumber, {
        status: finalStatus,
        poType: finalPoType,
        statusLabel: finalStatusLabel,
        qty: qtyReceived,
        pickupBy: monPickupBy,
        poExpDate: monDateDelivered,
        supplierAddress: selectedMonitoringPo.supplierAddress || 'Davao City',
        notes: monRemarks || selectedMonitoringPo.notes,
      });
      setShowMonSuccess(true);
      setTimeout(() => {
        setShowMonSuccess(false);
        setShowMonitoringModal(false);
        setSelectedMonitoringPo(null);
      }, 2000);
    } catch (e) {
      alert('Failed to save monitoring: ' + e.message);
    } finally {
      setMonBusy(false);
    }
  };

  const handleCreateRequest = async (e) => {
    e.preventDefault();
    if (!reqItemDescription || !reqQty || !reqMrsNo || !reqApprovedBy) {
      alert('Please fill in all required fields');
      return;
    }
    setReqBusy(true);
    try {
      await createRequest({
        date: new Date().toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: '2-digit' }).replace(/\//g, '-'),
        reqNumber: `REQ-${Math.floor(10000 + Math.random() * 90000)}`,
        itemDescription: reqItemDescription,
        qty: parseInt(reqQty) || 0,
        unit: reqUnit,
        mrsNo: reqMrsNo,
        requestedBy: reqApprovedBy,
        requisitioner: 'Warehouse Site',
      });
      setNewRequestModal(false);
      setReqItemDescription('');
      setReqQty('');
      setReqUnit('pcs');
      setReqMrsNo('');
      setReqApprovedBy('');
      await loadMoreRequests();
    } catch (e) {
      alert('Failed to create request: ' + e.message);
    } finally {
      setReqBusy(false);
    }
  };

  const completedCount = purchaseOrders.filter(o => o.status === 'completed').length;
  const activeCount = purchaseOrders.filter(o => o.status === 'incomplete' && o.poType === 'active-delivery').length;

  const filteredPOs = purchaseOrders.filter(order => {
    const matchesType = selectedPoType === 'completed'
      ? order.status === 'completed'
      : (order.status === 'incomplete' && order.poType === 'active-delivery');
    const matchesSearch = poSearchQuery === '' || order.poNumber.includes(poSearchQuery);
    return matchesType && matchesSearch;
  });

  const menuItems = [
    { id: 'purchase-orders', label: 'Purchase Orders', icon: <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="inline-block align-middle"><rect x="3" y="3" width="7" height="9" rx="1" /><rect x="14" y="3" width="7" height="5" rx="1" /><rect x="14" y="12" width="7" height="9" rx="1" /><rect x="3" y="16" width="7" height="5" rx="1" /></svg> },
    { id: 'requests', label: 'Requests', icon: <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="inline-block align-middle"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" /><polyline points="22,6 12,13 2,6" /></svg> },
    { id: 'settings', label: 'Settings', icon: <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="inline-block align-middle"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82V9a1.65 1.65 0 0 0 1.51-1H21a2 2 0 0 1 0-4h-.09a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 .33-1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg> },
  ];

  return (
    <div className="flex h-screen bg-[#f5f5f5] w-full max-md:flex-col font-sans">
      <div className="w-[240px] max-md:w-full bg-[#e8eef2] p-6 max-md:p-4 flex flex-col max-md:flex-row max-md:items-center border-r border-[#ddd] max-md:border-r-0 max-md:border-b overflow-y-auto">
        <div className="flex items-center gap-3 mb-8 max-md:mb-0 pb-4 max-md:pb-0 border-b border-[#d0d8e0] max-md:border-b-0">
          <img src="/clogo.jpg" alt="CARWILL Logo" className="w-12 h-12 rounded-full bg-[#ccc] object-cover" />
          <div className="flex-1">
            <h3 className="m-0 text-sm font-semibold text-[#333]">Carwill Construction Inc.</h3>
            <span className="inline-block bg-[#7ec8e3] text-white px-2 py-1 rounded text-[11px] font-semibold mt-1">Warehouse</span>
          </div>
        </div>
        <nav className="flex-1 flex flex-col max-md:flex-row gap-2 max-md:gap-0 mb-8 max-md:mb-0 max-md:ml-8 w-full">
          {menuItems.map(item => (
            <button key={item.id} className={`flex items-center justify-start max-md:justify-center gap-3 py-3 px-4 max-md:py-2 max-md:px-3 border-none rounded-md cursor-pointer text-sm font-medium transition-all duration-300 max-md:flex-1 ${activeMenu === item.id ? 'bg-[#1e3c72] text-white' : 'bg-transparent text-[#555] hover:bg-[#7ec8e3]/20 hover:text-[#333]'}`} onClick={() => setActiveMenu(item.id)}>
              <span className="text-base">{item.icon}</span>
              <span className="flex-1 text-left max-md:hidden">{item.label}</span>
            </button>
          ))}
        </nav>
        <button onClick={logout} className="flex items-center gap-3 py-3 px-4 bg-transparent border-none rounded-md cursor-pointer text-[#d32f2f] text-sm font-semibold transition-all duration-300 hover:bg-[#d32f2f]/10 max-md:ml-auto w-full justify-start"><span className="text-base flex items-center justify-center"><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg></span>Log out</button>
      </div>
      <div className="flex-1 overflow-y-auto p-8 max-md:p-4">
        {activeMenu === 'purchase-orders' && (
          <div className="bg-white rounded-lg p-6 text-left">
            <div className="mb-8">
              <h1 className="m-0 text-3xl max-md:text-2xl text-[#333] font-bold">Purchase Orders</h1>
              <p className="mt-2 mx-0 mb-0 text-sm text-[#666]">Manage and track material requisitions</p>
            </div>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(250px,1fr))] max-md:grid-cols-1 gap-5 mb-8">
              <div className={`border-2 rounded-xl p-8 text-center cursor-pointer transition-all duration-300 transform ${selectedPoType === 'completed' ? 'bg-gradient-to-br from-[#e3f2fd] to-[#bbdefb] border-2 border-[#1e3c72] shadow-[0_4px_16px_rgba(30,60,114,0.15)] scale-[1.02] -translate-y-1' : 'bg-white border-2 border-[#e0e0e0] shadow-[0_2px_8px_rgba(0,0,0,0.06)] hover:border-[#1e3c72]'}`} onClick={() => setSelectedPoType('completed')}>
                <h3 className="m-0 text-sm text-[#666] font-semibold mb-3">Completed</h3>
                <div className="text-5xl font-bold text-[#1e3c72]">{completedCount}</div>
              </div>
              <div className={`border-2 rounded-xl p-8 text-center cursor-pointer transition-all duration-300 transform ${selectedPoType === 'active-delivery' ? 'bg-gradient-to-br from-[#e8f5e9] to-[#c8e6c9] border-2 border-[#2e7d32] shadow-[0_4px_16px_rgba(46,125,50,0.15)] scale-[1.02] -translate-y-1' : 'bg-white border-2 border-[#e0e0e0] shadow-[0_2px_8px_rgba(0,0,0,0.06)] hover:border-[#2e7d32]'}`} onClick={() => setSelectedPoType('active-delivery')}>
                <h3 className="m-0 text-sm text-[#666] font-semibold mb-3">Active Delivery</h3>
                <div className="text-5xl font-bold text-[#2e7d32]">{activeCount}</div>
              </div>
            </div>
            <div className="mt-8">
              <div className="mb-4">
                <h2 className="m-0 text-lg text-[#333] font-bold">{selectedPoType === 'completed' ? 'Completed' : 'Active Delivery'}</h2>
                <p className="mt-1 mx-0 mb-0 text-[13px] text-[#999]">{selectedPoType === 'completed' ? 'Successful Deliveries' : 'Deliveries in process'}</p>
              </div>
              <input type="text" placeholder="Search PO number..." className="w-full max-w-[300px] py-2.5 px-4 border border-[#e0e0e0] rounded-md text-[13px] mb-4 placeholder:text-[#999] focus:outline-none focus:border-[#7ec8e3]" value={poSearchQuery} onChange={(e) => setPoSearchQuery(e.target.value)} />
              <div className="border border-[#e0e0e0] rounded-lg overflow-hidden">
                <div className="overflow-x-auto max-h-[500px]">
                  <table className="w-full border-collapse text-[13px]">
                    <thead className="bg-[#e3f2fd] sticky top-0 z-10">
                      <tr>
                        <th className="p-4 text-left font-bold text-[#1e3c72] border-b border-[#1e3c72]/20 whitespace-nowrap">PO date</th>
                        <th className="p-4 text-left font-bold text-[#1e3c72] border-b border-[#1e3c72]/20 whitespace-nowrap">PO number</th>
                        <th className="p-4 text-left font-bold text-[#1e3c72] border-b border-[#1e3c72]/20 whitespace-nowrap">Item Description</th>
                        <th className="p-4 text-left font-bold text-[#1e3c72] border-b border-[#1e3c72]/20 whitespace-nowrap">Qty</th>
                        <th className="p-4 text-left font-bold text-[#1e3c72] border-b border-[#1e3c72]/20 whitespace-nowrap">Unit</th>
                        <th className="p-4 text-left font-bold text-[#1e3c72] border-b border-[#1e3c72]/20 whitespace-nowrap">Supplier Name</th>
                        <th className="p-4 text-left font-bold text-[#1e3c72] border-b border-[#1e3c72]/20 whitespace-nowrap">MRS No.</th>
                        <th className="p-4 text-left font-bold text-[#1e3c72] border-b border-[#1e3c72]/20 whitespace-nowrap">PO rvd date</th>
                        <th className="p-4 text-left font-bold text-[#1e3c72] border-b border-[#1e3c72]/20 whitespace-nowrap">Pick-up by</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredPOs.length > 0 ? (
                        filteredPOs.map((order, index) => (
                          <tr key={order.poNumber || index} onClick={() => { if (order.status === 'incomplete' && order.poType === 'active-delivery') { handleOpenMonitoring(order); } else { handleOpenReceipt(order); } }} className={`border-b border-gray-200 transition-colors duration-150 cursor-pointer hover:bg-[#f0f8fc]/50 ${index % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}`}>
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
                        <tr><td colSpan="9" className="p-8 text-center text-[#999]">{posLoading ? 'Loading...' : 'No purchase orders found'}</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
                {hasMorePOs && <div className="p-4 text-center"><button className="py-2 px-4 bg-[#1e3c72] text-white border-none rounded-md text-sm font-semibold cursor-pointer hover:bg-[#2a5298]" onClick={loadMorePOs} disabled={posLoading}>Load More</button></div>}
              </div>
            </div>
          </div>
        )}

        {activeMenu === 'requests' && (
          <div className="bg-white rounded-lg p-6 text-left">
            <div className="flex justify-between items-center mb-8">
              <div><h1 className="m-0 text-3xl max-md:text-2xl text-[#333] font-bold">Requests</h1><p className="mt-2 mx-0 mb-0 text-sm text-[#666]">Pending and active warehouse requests</p></div>
              <button onClick={() => setNewRequestModal(true)} className="bg-[#1e3c72] text-white py-2 px-5 rounded-md text-sm font-semibold cursor-pointer border-none transition-all duration-300 hover:bg-[#2a5298] hover:shadow-[0_2px_8px_rgba(30,60,114,0.3)]">Create Request</button>
            </div>
            <div className="border border-[#e0e0e0] rounded-lg overflow-hidden">
              <div className="overflow-x-auto max-h-[500px]">
                <table className="w-full border-collapse text-[13px]">
                  <thead className="bg-[#f0f4f8] sticky top-0 z-10">
                    <tr><th className="p-4 text-left font-bold text-[#555] border-b border-gray-200">Date</th><th className="p-4 text-left font-bold text-[#555] border-b border-gray-200">MRS No.</th><th className="p-4 text-left font-bold text-[#555] border-b border-gray-200">Item Description</th><th className="p-4 text-left font-bold text-[#555] border-b border-gray-200">Qty</th><th className="p-4 text-left font-bold text-[#555] border-b border-gray-200">Unit</th><th className="p-4 text-left font-bold text-[#555] border-b border-gray-200">Requested By</th><th className="p-4 text-left font-bold text-[#555] border-b border-gray-200">Status</th></tr>
                  </thead>
                  <tbody>
                    {requestsList.length > 0 ? (
                      requestsList.map((req, index) => (
                        <tr key={req.reqNumber || index} className={`border-b border-gray-200 ${index % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}`}>
                          <td className="p-4 text-[#333] font-medium">{req.date}</td>
                          <td className="p-4 text-[#333] font-medium">{req.mrsNo}</td>
                          <td className="p-4 text-[#333] font-medium">{req.itemDescription}</td>
                          <td className="p-4 text-[#333] font-medium">{req.qty}</td>
                          <td className="p-4 text-[#333] font-medium">{req.unit}</td>
                          <td className="p-4 text-[#333] font-medium">{req.requestedBy}</td>
                          <td className="p-4"><span className={`px-3 py-1 rounded-full text-[11px] font-bold border transition-colors duration-200 ${req.status === 'Approved' ? 'bg-[#e8f5e9] text-[#2e7d32] border-[#a5d6a7]' : req.status === 'Pending' ? 'bg-[#fff9e6] text-[#f57f17] border-[#ffb74d]' : 'bg-[#ffebee] text-[#c62828] border-[#ef5350]'}`}>{req.status}</span></td>
                        </tr>
                      ))
                    ) : (
                      <tr><td colSpan="7" className="p-8 text-center text-[#999]">{reqLoading ? 'Loading...' : 'No requests found'}</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
              {hasMoreRequests && <div className="p-4 text-center"><button className="py-2 px-4 bg-[#1e3c72] text-white border-none rounded-md text-sm font-semibold cursor-pointer hover:bg-[#2a5298]" onClick={loadMoreRequests} disabled={reqLoading}>Load More</button></div>}
            </div>
          </div>
        )}

        {activeMenu === 'settings' && (
          <div className="bg-white rounded-lg p-8 text-left"><h2 className="m-0 text-3xl text-[#333] mb-4 font-bold">Settings</h2><p className="text-[#999] text-sm">Warehouse profile and configuration settings are coming soon...</p></div>
        )}
      </div>

      {/* New Request Modal */}
      {newRequestModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-[1000] animate-fade-in">
          <div className="bg-white rounded-xl w-full max-w-[450px] shadow-[0_10px_30px_rgba(0,0,0,0.15)] animate-slide-in p-6 text-left">
            <div className="flex justify-between items-center border-b border-[#eee] pb-3 mb-5">
              <h2 className="m-0 text-lg font-bold text-[#333] tracking-wide">Create Material Request</h2>
              <button className="bg-none border-none text-2xl cursor-pointer text-[#888] hover:text-[#333] transition-colors duration-200 p-1 leading-none" onClick={() => setNewRequestModal(false)}>&times;</button>
            </div>
            <form onSubmit={handleCreateRequest} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5"><label className="text-[11px] font-bold text-[#666] uppercase">MRS No. *</label><input type="text" value={reqMrsNo} onChange={(e) => setReqMrsNo(e.target.value)} placeholder="e.g. MRS-107" required className="py-2.5 px-3 border border-[#ccc] rounded-md text-[13px] text-[#333]" /></div>
              <div className="flex flex-col gap-1.5"><label className="text-[11px] font-bold text-[#666] uppercase">Item Description *</label><input type="text" value={reqItemDescription} onChange={(e) => setReqItemDescription(e.target.value)} placeholder="e.g. Steel Rebar 12mm" required className="py-2.5 px-3 border border-[#ccc] rounded-md text-[13px] text-[#333]" /></div>
              <div className="flex gap-4">
                <div className="flex flex-col gap-1.5 flex-1"><label className="text-[11px] font-bold text-[#666] uppercase">Qty *</label><input type="number" value={reqQty} onChange={(e) => setReqQty(e.target.value)} placeholder="0" required className="py-2.5 px-3 border border-[#ccc] rounded-md text-[13px] text-[#333]" /></div>
                <div className="flex flex-col gap-1.5 flex-1"><label className="text-[11px] font-bold text-[#666] uppercase">Unit</label><select value={reqUnit} onChange={(e) => setReqUnit(e.target.value)} className="py-2.5 px-3 border border-[#ccc] rounded-md text-[13px] bg-white text-[#333]"><option value="pcs">pcs</option><option value="bags">bags</option><option value="rolls">rolls</option><option value="boxes">boxes</option></select></div>
              </div>
              <div className="flex flex-col gap-1.5"><label className="text-[11px] font-bold text-[#666] uppercase">Approved By (Site Engineer) *</label><input type="text" value={reqApprovedBy} onChange={(e) => setReqApprovedBy(e.target.value)} placeholder="Enter name of approving engineer" required className="py-2.5 px-3 border border-[#ccc] rounded-md text-[13px] text-[#333]" /></div>
              <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-[#eee]">
                <button type="button" className="py-2.5 px-6 rounded-md text-sm font-semibold cursor-pointer transition-all duration-200 bg-white text-[#555] border border-gray-300 hover:bg-gray-50" onClick={() => setNewRequestModal(false)}>Cancel</button>
                <button type="submit" className="py-2.5 px-6 rounded-md text-sm font-semibold cursor-pointer transition-all duration-200 bg-[#1e3c72] text-white border-none hover:bg-[#2a5298]" disabled={reqBusy}>{reqBusy ? 'Submitting...' : 'Submit Request'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Monitoring Details Modal */}
      {showMonitoringModal && selectedMonitoringPo && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-[1000] animate-fade-in overflow-y-auto py-6 px-4">
          <div className="bg-white rounded-xl w-full max-w-[500px] shadow-[0_10px_30px_rgba(0,0,0,0.15)] animate-slide-in p-6 relative font-sans text-left">
            <button className="absolute top-4 right-4 bg-none border-none text-2xl cursor-pointer text-[#888] hover:text-[#333] transition-colors duration-200 p-1 leading-none" onClick={() => setShowMonitoringModal(false)}>X</button>
            <h2 className="m-0 text-lg font-bold text-[#333] mb-5 tracking-wide">Monitoring Details</h2>
            {showMonSuccess && (<div className="mb-4 p-3 bg-[#e8f5e9] text-[#2e7d32] border border-[#a5d6a7] rounded-md text-xs font-bold flex items-center justify-center gap-1.5 animate-pulse"><span>✓ Saved successfully!</span></div>)}
            <form onSubmit={handleSaveMonitoring} className="flex flex-col gap-4">
              <div className="flex gap-4">
                <div className="flex flex-col gap-1.5 flex-1 text-[11px] font-bold text-[#444]"><label>PO number:</label><input type="text" value={monPoNumber} disabled className="py-2 px-3 border border-[#ccc] rounded-md text-[13px] text-[#555] bg-gray-50 w-full box-border" /></div>
                <div className="flex flex-col gap-1.5 flex-1 text-[11px] font-bold text-[#444]"><label>Pick-up date:</label><input type="text" value={monPickupDate} disabled className="py-2 px-3 border border-[#ccc] rounded-md text-[13px] text-[#555] bg-gray-50 w-full box-border" /></div>
              </div>
              <div className="flex gap-4 items-end">
                <div className="flex flex-col gap-1.5 flex-[3] text-[11px] font-bold text-[#444]"><label>Item Description:</label><input type="text" value={monDescription} disabled className="py-2 px-3 border border-[#ccc] rounded-md text-[13px] text-[#555] bg-gray-50 w-full box-border" /></div>
                <div className="flex flex-col gap-1.5 flex-1 text-[11px] font-bold text-[#444]"><label>Qty. rvd.:</label><input type="number" value={monQtyRvd} onChange={(e) => setMonQtyRvd(e.target.value)} placeholder="0" required className="py-2 px-3 border border-[#ccc] rounded-md text-[13px] text-[#333] focus:outline-none focus:border-[#006680] w-full box-border" /></div>
                <div className="flex flex-col gap-1.5 flex-1 text-[11px] font-bold text-[#444]"><label>Unit:</label><input type="text" value={monUnit} disabled className="py-2 px-3 border border-[#ccc] rounded-md text-[13px] text-[#555] bg-gray-50 w-full box-border" /></div>
              </div>
              <div className="flex gap-4">
                <div className="flex flex-col gap-1.5 flex-1 text-[11px] font-bold text-[#444]"><label>Delivered By:</label><input type="text" value={monDeliveredBy} onChange={(e) => setMonDeliveredBy(e.target.value)} placeholder="Enter name" required className="py-2 px-3 border border-[#ccc] rounded-md text-[13px] text-[#333] focus:outline-none focus:border-[#006680] w-full box-border" /></div>
                <div className="flex flex-col gap-1.5 flex-1 text-[11px] font-bold text-[#444]"><label>Date delivered:</label><input type="text" value={monDateDelivered} onChange={(e) => setMonDateDelivered(e.target.value)} placeholder="MM/DD/YY" required className="py-2 px-3 border border-[#ccc] rounded-md text-[13px] text-[#333] focus:outline-none focus:border-[#006680] w-full box-border" /></div>
              </div>
              <div className="flex gap-4 items-end">
                <div className="flex flex-col gap-1.5 flex-1 text-[11px] font-bold text-[#444]"><label>Reference No.</label><input type="text" value={monReferenceNo} onChange={(e) => setMonReferenceNo(e.target.value)} placeholder="00000" required className="py-2 px-3 border border-[#ccc] rounded-md text-[13px] text-[#333] focus:outline-none focus:border-[#006680] w-full box-border" /></div>
                <div className="flex flex-col gap-1.5 flex-[0.8] text-[11px] font-bold text-[#444]"><label>DR date:</label><input type="text" value={monDrDate} onChange={(e) => setMonDrDate(e.target.value)} placeholder="0" required className="py-2 px-3 border border-[#ccc] rounded-md text-[13px] text-[#333] focus:outline-none focus:border-[#006680] w-full box-border" /></div>
                <div className="flex flex-col gap-1.5 flex-[1.2] text-[11px] font-bold text-[#444]"><label>Pick-up By:</label><input type="text" value={monPickupBy} onChange={(e) => setMonPickupBy(e.target.value)} placeholder="Enter name" required className="py-2 px-3 border border-[#ccc] rounded-md text-[13px] text-[#333] focus:outline-none focus:border-[#006680] w-full box-border" /></div>
              </div>
              <div className="flex gap-4 items-end">
                <div className="flex flex-col gap-1.5 flex-1 text-[11px] font-bold text-[#444]"><label>Remarks:</label><textarea value={monRemarks} onChange={(e) => setMonRemarks(e.target.value)} placeholder="Enter remarks.." className="py-2 px-3 border border-[#ccc] rounded-md text-[13px] text-[#333] focus:outline-none focus:border-[#006680] w-full box-border resize-none h-[80px]" /></div>
                <div className="flex flex-col gap-2.5">
                  <button type="submit" className="py-2.5 px-8 bg-[#006680] text-white border-none rounded-md text-sm font-semibold cursor-pointer transition-all duration-200 hover:bg-[#004d60] w-[120px]" disabled={monBusy}>{monBusy ? 'Saving...' : 'Save'}</button>
                  <button type="button" onClick={() => setShowMonitoringModal(false)} className="py-2.5 px-8 bg-white text-[#d32f2f] border border-[#d32f2f] rounded-md text-sm font-semibold cursor-pointer transition-all duration-200 hover:bg-[#fff5f5] w-[120px]">Cancel</button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Material Request Receipt Modal */}
      {showReceiptModal && selectedReceiptPo && (<MaterialRequestReceipt po={selectedReceiptPo} onClose={handleCloseReceiptModal} />)}
    </div>
  );
}

export default WarehouseDashboard;