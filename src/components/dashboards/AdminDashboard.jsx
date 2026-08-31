'use client';
import React, { useState, useCallback, useMemo } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useAdminData } from '../../context/AdminDataContext';
import { useInfiniteRows } from '../../hooks/useInfiniteRows';
import MaterialRequestReceipt from '../shared/MaterialRequestReceipt';
import { getPOs } from '../../../actions/pos';
import { createPO as createPOServer } from '../../../actions/pos';
import { getRequests } from '../../../actions/requests';
import { approveRequest, declineRequest } from '../../../actions/requests';
import { getUsers } from '../../../actions/users';
import { deleteUser as deleteUserServer, updateUserWarehouse } from '../../../actions/users';
import { getWarehouses } from '../../../actions/warehouses';

function AdminDashboard() {
  const { user, logout } = useAuth();
  const { warehouses, poVersion, requestVersion, userVersion, refreshStats, refreshRequestCounts, createPO, updatePO, addUser, deleteUser, assignWarehouse, approveRequest: handleApproveRequest, declineRequest: handleDeclineRequest, addWarehouse: handleAddWarehouse, deleteWarehouse } = useAdminData();

  const [activeMenu, setActiveMenu] = useState('dashboard');
  const [selectedStat, setSelectedStat] = useState(null);
  const [dashboardSearchQuery, setDashboardSearchQuery] = useState('');
  const [poSearchQuery, setPoSearchQuery] = useState('');
  const [requestsSearchQuery, setRequestsSearchQuery] = useState('');
  const [selectedRequestStatus, setSelectedRequestStatus] = useState('');
  const [selectedRequest, setSelectedRequest] = useState(null);
  const [showRequestDetailsModal, setShowRequestDetailsModal] = useState(false);
  const [isDeclineMode, setIsDeclineMode] = useState(false);
  const [declineRemarks, setDeclineRemarks] = useState('');
  const [showRemarksModal, setShowRemarksModal] = useState(false);
  const [remarksToDisplay, setRemarksToDisplay] = useState('');
  const [historyTab, setHistoryTab] = useState('purchase-orders');
  const [historySearchQuery, setHistorySearchQuery] = useState('');
  const [appliedFilters, setAppliedFilters] = useState({
    completed: false, incomplete: false, activeDelivery: false, inProcess: false,
    approved: false, pending: false, rejected: false,
  });
  const [showAddWarehouseModal, setShowAddWarehouseModal] = useState(false);
  const [newWarehouseName, setNewWarehouseName] = useState('');
  const [showAddUserModal, setShowAddUserModal] = useState(false);
  const [newUserName, setNewUserName] = useState('');
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserRole, setNewUserRole] = useState('Warehouse');
  const [newUserWarehouse, setNewUserWarehouse] = useState('');
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [selectedReceiptPo, setSelectedReceiptPo] = useState(null);
  const [showReceiptModal, setShowReceiptModal] = useState(false);
  const [showNewPOModal, setShowNewPOModal] = useState(false);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [formListedBy, setFormListedBy] = useState(user?.email || '');
  const [formPoNumber, setFormPoNumber] = useState('');
  const [formPoDate, setFormPoDate] = useState('');
  const [formItemDescription, setFormItemDescription] = useState('');
  const [formQty, setFormQty] = useState('');
  const [formUnit, setFormUnit] = useState('pcs');
  const [formNotes, setFormNotes] = useState('');
  const [formApprovedBy, setFormApprovedBy] = useState('');
  const [formApprovalDate, setFormApprovalDate] = useState('');
  const [formRequisitioner, setFormRequisitioner] = useState('');
  const [formMrsNo, setFormMrsNo] = useState('');
  const [formPickupBy, setFormPickupBy] = useState('');
  const [formPlateNumber, setFormPlateNumber] = useState('');
  const [formSupplierName, setFormSupplierName] = useState('');
  const [formSupplierAddress, setFormSupplierAddress] = useState('');
  const [showHistoryFilter, setShowHistoryFilter] = useState(false);
  const [selectedStatus, setSelectedStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const queryParams = useMemo(() => ({
    status: selectedStat === 'completed' ? 'completed' : selectedStat === 'incomplete' ? 'incomplete' : undefined,
    poType: selectedStat === 'discrepancy' ? 'discrepancy' : selectedStat === 'active-delivery' ? 'active-delivery' : undefined,
    search: dashboardSearchQuery || undefined,
  }), [selectedStat, dashboardSearchQuery]);

  const { rows: purchaseOrders, total: poTotal, initialLoading: poLoading, loadingMore: poLoadingMore, hasMore: poHasMore, loadMore: poLoadMore } = useInfiniteRows(getPOs, queryParams, poVersion);

  const reqQueryParams = useMemo(() => ({
    status: selectedRequestStatus || undefined,
    search: requestsSearchQuery || undefined,
  }), [selectedRequestStatus, requestsSearchQuery]);

  const { rows: requestsList, total: reqTotal, initialLoading: reqLoading, loadingMore: reqLoadingMore, hasMore: reqHasMore, loadMore: reqLoadMore } = useInfiniteRows(getRequests, reqQueryParams, requestVersion);

  const userQueryParams = useMemo(() => ({ search: '' }), []);
  const { rows: usersList, total: usersTotal, initialLoading: usersLoading, loadingMore: usersLoadingMore, hasMore: usersHasMore, loadMore: usersLoadMore } = useInfiniteRows(getUsers, userQueryParams, userVersion);

  const completedPOs = purchaseOrders.filter(o => o.status === 'completed').length;
  const incompletePOs = purchaseOrders.filter(o => o.status === 'incomplete').length;
  const activeDeliveryCount = purchaseOrders.filter(o => o.poType === 'active-delivery').length;
  const discrepancyCount = purchaseOrders.filter(o => o.poType === 'discrepancy').length;

  const filteredDashboardOrders = useMemo(() => {
    return purchaseOrders.filter(order => {
      if (dashboardSearchQuery && !order.poNumber.includes(dashboardSearchQuery)) return false;
      return true;
    });
  }, [purchaseOrders, dashboardSearchQuery]);

  const filteredPurchaseOrders = useMemo(() => {
    return purchaseOrders.filter(order => {
      if (poSearchQuery && !order.poNumber.includes(poSearchQuery)) return false;
      return true;
    });
  }, [purchaseOrders, poSearchQuery]);

  let filteredHistoryPOs = useMemo(() => {
    return purchaseOrders.filter(order => {
      if (historySearchQuery && !order.poNumber.includes(historySearchQuery) && !order.itemDescription.toLowerCase().includes(historySearchQuery.toLowerCase())) return false;
      const activeFiltersCount = Object.keys(appliedFilters).filter(key => !['approved','pending','rejected'].includes(key) && appliedFilters[key]).length;
      if (activeFiltersCount > 0) {
        let match = false;
        if (appliedFilters.activeDelivery && order.poType === 'active-delivery') match = true;
        if (appliedFilters.inProcess && order.status === 'incomplete' && order.poType === 'active-delivery') match = true;
        if (appliedFilters.incomplete && order.status === 'incomplete') match = true;
        if (appliedFilters.completed && order.status === 'completed') match = true;
        if (!match) return false;
      }
      return true;
    });
  }, [purchaseOrders, historySearchQuery, appliedFilters]);

  let filteredHistoryReqs = useMemo(() => {
    return requestsList.filter(req => {
      if (historySearchQuery && !req.mrsNo.includes(historySearchQuery) && !req.itemDescription.toLowerCase().includes(historySearchQuery.toLowerCase())) return false;
      const activeFiltersCount = Object.keys(appliedFilters).filter(key => ['approved','pending','rejected'].includes(key) && appliedFilters[key]).length;
      if (activeFiltersCount > 0) {
        let match = false;
        if (appliedFilters.pending && req.status === 'Pending') match = true;
        if (appliedFilters.approved && req.status === 'Approved') match = true;
        if (appliedFilters.rejected && req.status === 'Rejected') match = true;
        if (!match) return false;
      }
      return true;
    });
  }, [requestsList, historySearchQuery, appliedFilters]);

  let filteredRequests = useMemo(() => {
    return requestsList.filter(req => {
      if (requestsSearchQuery && !req.mrsNo.includes(requestsSearchQuery) && !req.itemDescription.toLowerCase().includes(requestsSearchQuery.toLowerCase())) return false;
      if (selectedRequestStatus && req.status !== selectedRequestStatus) return false;
      return true;
    });
  }, [requestsList, requestsSearchQuery, selectedRequestStatus]);

  const handleSavePurchaseOrder = async (e) => {
    e.preventDefault();
    if (!formPoNumber || !formPoDate || !formItemDescription || !formQty || !formRequisitioner || !formMrsNo || !formPickupBy || !formPlateNumber || !formSupplierName) {
      alert('Please fill in all required fields marked with *');
      return;
    }
    try {
      await createPOServer({
        date: formPoDate, poNumber: formPoNumber, itemDescription: formItemDescription,
        qty: parseInt(formQty) || 0, unit: formUnit, supplier: formSupplierName,
        supplierAddress: formSupplierAddress, requisitioner: formRequisitioner,
        mrsNo: formMrsNo, poExpDate: formApprovalDate || formPoDate,
        pickupBy: formPickupBy, plateNumber: formPlateNumber, approvedBy: formApprovedBy,
        listedBy: formListedBy, notes: formNotes, status: 'incomplete', poType: 'active-delivery',
      });
      setShowSuccessModal(true);
      setFormPoNumber(''); setFormPoDate(''); setFormItemDescription(''); setFormQty('');
      setFormUnit('pcs'); setFormNotes(''); setFormApprovedBy(''); setFormApprovalDate('');
      setFormRequisitioner(''); setFormMrsNo(''); setFormPickupBy(''); setFormPlateNumber('');
      setFormSupplierName(''); setFormSupplierAddress('');
      await refreshStats();
      await refreshRequestCounts();
    } catch (e) {
      alert('Failed to create PO: ' + e.message);
    }
  };

  const handleCloseModal = () => {
    setShowSuccessModal(false);
    setFormPoNumber(''); setFormPoDate(''); setFormItemDescription(''); setFormQty('');
    setFormUnit('pcs'); setFormNotes(''); setFormApprovedBy(''); setFormApprovalDate('');
    setFormRequisitioner(''); setFormMrsNo(''); setFormPickupBy(''); setFormPlateNumber('');
    setFormSupplierName(''); setFormSupplierAddress('');
  };

  const handleOpenRequestDetails = (request) => {
    setSelectedRequest(request);
    setShowRequestDetailsModal(true);
  };

  const handleCloseRequestDetailsModal = () => {
    setShowRequestDetailsModal(false);
    setSelectedRequest(null);
    setIsDeclineMode(false);
    setDeclineRemarks('');
  };

  const handleDeclineClick = () => {
    setIsDeclineMode(true);
  };

  const handleSubmitDecline = async () => {
    if (!declineRemarks.trim()) {
      alert('Please enter remarks for declining this request');
      return;
    }
    try {
      await declineRequest(selectedRequest.mrsNo, declineRemarks);
      await refreshRequestCounts();
      handleCloseRequestDetailsModal();
    } catch (e) {
      alert('Failed to decline request: ' + e.message);
    }
  };

  const handleViewRejectedRemarks = (request) => {
    setRemarksToDisplay(request.remarks);
    setShowRemarksModal(true);
  };

  const handleCloseRemarksModal = () => {
    setShowRemarksModal(false);
    setRemarksToDisplay('');
  };

  const handleProceedPO = async () => {
    setFormItemDescription(selectedRequest.itemDescription);
    setFormQty(selectedRequest.qty.toString());
    setFormUnit(selectedRequest.unit);
    setFormRequisitioner(selectedRequest.requisitioner);
    setFormMrsNo(selectedRequest.mrsNo);
    setFormApprovedBy(selectedRequest.requestedBy || '');
    setFormApprovalDate(selectedRequest.date || '');
    handleCloseRequestDetailsModal();
    setShowNewPOModal(true);
  };

  const handleAddUser = async (e) => {
    e.preventDefault();
    if (!newUserName || !newUserEmail || !newUserRole) {
      alert('Please fill all required fields');
      return;
    }
    try {
      await addUser({ username: newUserName, name: newUserName, email: newUserEmail, role: newUserRole, warehouse: newUserWarehouse || null });
      setShowAddUserModal(false);
      setNewUserName(''); setNewUserEmail(''); setNewUserRole('Warehouse'); setNewUserWarehouse('');
    } catch (e) {
      alert('Failed to add user: ' + e.message);
    }
  };

  const handleDeleteUser = async (username) => {
    if (!window.confirm(`Delete user ${username}?`)) return;
    try {
      await deleteUserServer(username);
    } catch (e) {
      alert('Failed to delete user: ' + e.message);
    }
  };

  const handleUpdateUserWarehouse = async (userId, warehouse) => {
    try {
      await updateUserWarehouse(userId, warehouse);
    } catch (e) {
      alert('Failed to update user warehouse: ' + e.message);
    }
  };

  const handleAddWarehouseForm = async (e) => {
    e.preventDefault();
    if (!newWarehouseName.trim()) return;
    try {
      await handleAddWarehouse(newWarehouseName);
      setNewWarehouseName('');
      setShowAddWarehouseModal(false);
    } catch (e) {
      alert('Failed to add warehouse: ' + e.message);
    }
  };

  const handleDeleteWarehouse = async (name) => {
    if (!window.confirm(`Permanently delete warehouse "${name}" and all its data?`)) return;
    try {
      await deleteWarehouse(name);
    } catch (e) {
      alert('Failed to delete warehouse: ' + e.message);
    }
  };

  const handleApproveRequest = async (reqNumber) => {
    try {
      await approveRequest(reqNumber);
      await refreshRequestCounts();
    } catch (e) {
      alert('Failed to approve request: ' + e.message);
    }
  };

  const menuItems = [
    { id: 'dashboard', label: 'Dashboard', href: '/admin', icon: (<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="inline-block align-middle"><rect x="3" y="3" width="7" height="9" rx="1" /><rect x="14" y="3" width="7" height="5" rx="1" /><rect x="14" y="12" width="7" height="9" rx="1" /><rect x="3" y="16" width="7" height="5" rx="1" /></svg>) },
    { id: 'purchase-order', label: 'Purchase Order', href: '/admin/purchase-orders', icon: (<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="inline-block align-middle"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /><polyline points="10 9 9 9 8 9" /></svg>) },
    { id: 'history', label: 'History', href: '/admin/history', icon: (<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="inline-block align-middle"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><polyline points="3 3 3 8 8 8" /><line x1="12" y1="7" x2="12" y2="12" /><line x1="12" y1="12" x2="16" y2="14" /></svg>) },
    { id: 'users', label: 'Users', href: '/admin/users', icon: (<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="inline-block align-middle"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>) },
    { id: 'requests', label: 'Requests', href: '/admin/requests', icon: (<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="inline-block align-middle"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" /><polyline points="22,6 12,13 2,6" /></svg>) },
    { id: 'archive', label: 'Archive', href: '/admin/archive', icon: (<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="inline-block align-middle"><polyline points="21 8 21 21 3 21 3 8" /><rect x="1" y="3" width="22" height="5" /><line x1="10" y1="12" x2="14" y2="12" /></svg>) },
    { id: 'settings', label: 'Settings', href: '/admin/settings', icon: (<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="inline-block align-middle"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0-.33-1.82V9a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33-1.82V9a1.65 1.65 0 0 0-1.51 1z" /></svg>) },
  ];

  const buildFilterWhere = (filters) => {
    const result = [];
    if (filters.completed) result.push({ status: 'completed' });
    if (filters.incomplete) result.push({ status: 'incomplete' });
    if (filters.activeDelivery) result.push({ poType: 'active-delivery' });
    if (filters.inProcess) result.push({ status: 'incomplete', poType: 'active-delivery' });
    return result;
  };

  const renderDashboard = () => (
    <div className="bg-white rounded-lg p-6">
      <div className="mb-8">
        <h1 className="m-0 text-3xl max-md:text-2xl text-[#333] font-bold">Dashboard</h1>
        <p className="mt-2 mx-0 mb-0 text-sm text-[#666]">Overview of complete vs incomplete purchase order fulfillment</p>
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(250px,1fr))] max-md:grid-cols-1 gap-5 mb-8">
        <div className={`border-2 rounded-xl p-8 text-center cursor-pointer transition-all duration-300 transform ${selectedStat === 'total' ? 'bg-gradient-to-br from-[#e3f2fd] to-[#bbdefb] border-[#1e3c72] shadow-[0_4px_16px_rgba(30,60,114,0.15)] scale-[1.02] -translate-y-1' : 'bg-white border-[#90caf9] hover:border-[#1e3c72] hover:shadow-[0_4px_12px_rgba(30,60,114,0.12)] shadow-[0_2px_8px_rgba(0,0,0,0.06)]'}`} onClick={() => setSelectedStat(selectedStat === 'total' ? null : 'total')}>
          <h3 className="m-0 text-sm text-[#666] font-semibold mb-3">Total PO's</h3>
          <div className="text-5xl font-bold text-[#1e3c72]">{purchaseOrders.length}</div>
        </div>
        <div className={`border-2 rounded-xl p-8 text-center cursor-pointer transition-all duration-300 transform ${selectedStat === 'completed' ? 'bg-gradient-to-br from-[#e8f5e9] to-[#c8e6c9] border-[#2e7d32] shadow-[0_4px_16px_rgba(46,125,50,0.15)] scale-[1.02] -translate-y-1' : 'bg-white border-[#a5d6a7] hover:border-[#2e7d32] hover:shadow-[0_4px_12px_rgba(46,125,50,0.12)] shadow-[0_2px_8px_rgba(0,0,0,0.06)]'}`} onClick={() => setSelectedStat(selectedStat === 'completed' ? null : 'completed')}>
          <h3 className="m-0 text-sm text-[#666] font-semibold mb-3">Completed</h3>
          <div className="text-5xl font-bold text-[#2e7d32]">{completedPOs}</div>
        </div>
        <div className={`border-2 rounded-xl p-8 text-center cursor-pointer transition-all duration-300 transform ${selectedStat === 'incomplete' ? 'bg-gradient-to-br from-[#fef5f5] to-[#ffcdd2] border-[#c62828] shadow-[0_4px_16px_rgba(198,40,40,0.15)] scale-[1.02] -translate-y-1' : 'bg-white border-[#f44336] hover:border-[#c62828] hover:shadow-[0_4px_12px_rgba(198,40,40,0.12)] shadow-[0_2px_8px_rgba(0,0,0,0.06)]'}`} onClick={() => setSelectedStat(selectedStat === 'incomplete' ? null : 'incomplete')}>
          <h3 className="m-0 text-sm text-[#666] font-semibold mb-3">Incomplete</h3>
          <div className="text-5xl font-bold text-[#c62828]">{incompletePOs}</div>
        </div>
      </div>
      <div className="mt-8">
        <div className="mb-4"><h2 className="m-0 text-lg text-[#333] font-bold">Total Purchase Orders</h2></div>
        <input type="text" placeholder="Search PO number..." className="w-full max-w-[300px] py-2.5 px-4 border border-[#e0e0e0] rounded-md text-[13px] mb-4 placeholder:text-[#999] focus:outline-none focus:border-[#7ec8e3]" value={dashboardSearchQuery} onChange={(e) => setDashboardSearchQuery(e.target.value)} />
        <div className="border border-[#e0e0e0] rounded-lg overflow-hidden">
          <div className="overflow-x-auto max-h-[500px]">
            <table className="w-full border-collapse text-[13px]">
              <thead className="bg-gradient-to-r from-[#e3f2fd] to-[#bbdefb] sticky top-0 z-10">
                <tr>
                  {['PO date', 'PO number', 'Item Description', 'Qty', 'Unit', 'Supplier Name', 'Requisitioner', 'MRS No.', 'PO red date', 'Pick-up by'].map((h, i) => (<th key={i} className="p-4 text-left font-bold text-[#1e3c72] border-b-2 border-[#1e3c72]/30 whitespace-nowrap">{h}</th>))}
                </tr>
              </thead>
              <tbody>
                {filteredDashboardOrders.length > 0 ? filteredDashboardOrders.map((order, index) => {
                  const isCompletedOrActive = order.status === 'completed' || order.poType === 'active-delivery';
                  return (<tr key={index} onClick={() => { setSelectedReceiptPo(order); setShowReceiptModal(true); }} className={`border-b border-gray-200 transition-colors duration-150 cursor-pointer ${isCompletedOrActive ? 'bg-[#e8f5e9]' : order.status === 'incomplete' ? 'bg-[#fef5f5]' : (index % 2 === 0 ? 'bg-white' : 'bg-gray-50/50')} hover:bg-[#f0f8fc]/50`}><td className="p-4 text-[#333] font-medium whitespace-nowrap">{order.date}</td><td className="p-4 text-[#333] font-medium whitespace-nowrap">{order.poNumber}</td><td className="p-4 text-[#333] font-medium">{order.itemDescription}</td><td className="p-4 text-[#333] font-medium whitespace-nowrap">{order.qty}</td><td className="p-4 text-[#333] font-medium whitespace-nowrap">{order.unit}</td><td className="p-4 text-[#333] font-medium">{order.supplier}</td><td className="p-4 text-[#333] font-medium">{order.requisitioner}</td><td className="p-4 text-[#333] font-medium whitespace-nowrap">{order.mrsNo}</td><td className="p-4 text-[#333] font-medium whitespace-nowrap">{order.poExpDate}</td><td className="p-4 text-[#333] font-medium whitespace-nowrap">{order.pickupBy}</td></tr>);
                }) : (<tr><td colSpan="10" className="p-8 text-center text-[#999]">No purchase orders found</td></tr>)}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );

  const renderPurchaseOrders = () => (
    <div className="bg-white rounded-lg p-6">
      <div className="mb-8"><h1 className="m-0 text-3xl max-md:text-2xl text-[#333] font-bold">Purchase Orders</h1><p className="mt-2 mx-0 mb-0 text-sm text-[#666]">Manage and track material requisitions</p></div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(250px,1fr))] max-md:grid-cols-1 gap-5 mb-8">
        <div className="border-2 rounded-xl p-8 text-center border-[#1e3c72]"><h3 className="m-0 text-sm text-[#666] font-semibold mb-3">Total POs</h3><div className="text-4xl font-bold text-[#1e3c72]">{purchaseOrders.length}</div></div>
        <div className="border-2 rounded-xl p-8 text-center border-[#2e7d32]"><h3 className="m-0 text-sm text-[#666] font-semibold mb-3">Active Delivery</h3><div className="text-4xl font-bold text-[#2e7d32]">{activeDeliveryCount}</div></div>
        <div className="border-2 rounded-xl p-8 text-center border-[#c62828]"><h3 className="m-0 text-sm text-[#666] font-semibold mb-3">Discrepancies</h3><div className="text-4xl font-bold text-[#c62828]">{discrepancyCount}</div></div>
      </div>
      <div className="mb-6"><button className="bg-white text-[#0288d1] border-2 border-[#7ec8e3] py-2.5 px-5 rounded-md text-sm font-semibold cursor-pointer transition-all duration-300 hover:bg-[#f0f8fc]" onClick={() => setShowNewPOModal(true)}>New purchase order</button></div>
      <div className="mt-8">
        <div className="mb-4">
          <h2 className="m-0 text-lg text-[#333] font-bold">All Purchase Orders</h2>
          <input type="text" placeholder="Search PO number..." className="w-full max-w-[300px] py-2.5 px-4 border border-[#e0e0e0] rounded-md text-[13px] mb-4 placeholder:text-[#999] focus:outline-none focus:border-[#7ec8e3]" value={poSearchQuery} onChange={(e) => setPoSearchQuery(e.target.value)} />
        </div>
        <div className="border border-[#e0e0e0] rounded-lg overflow-hidden">
          <div className="overflow-x-auto max-h-[500px]">
            <table className="w-full border-collapse text-[13px]">
              <thead className="bg-gradient-to-r from-[#e3f2fd] to-[#bbdefb] sticky top-0 z-10">
                <tr>{['PO date', 'PO number', 'Item Description', 'Qty', 'Unit', 'Supplier Name', 'Requisitioner', 'MRS No.', 'PO red date', 'Pick-up by'].map((h, i) => (<th key={i} className="p-4 text-left font-bold text-[#1e3c72] border-b-2 border-[#1e3c72]/30 whitespace-nowrap">{h}</th>))}</tr>
              </thead>
              <tbody>
                {filteredPurchaseOrders.length > 0 ? filteredPurchaseOrders.map((order, index) => (<tr key={index} onClick={() => { setSelectedReceiptPo(order); setShowReceiptModal(true); }} className={`border-b border-gray-200 transition-colors duration-150 cursor-pointer ${index % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'} hover:bg-[#f4fbf7]/50`}><td className="p-4 text-[#333] font-medium whitespace-nowrap">{order.date}</td><td className="p-4 text-[#333] font-medium whitespace-nowrap">{order.poNumber}</td><td className="p-4 text-[#333] font-medium">{order.itemDescription}</td><td className="p-4 text-[#333] font-medium whitespace-nowrap">{order.qty}</td><td className="p-4 text-[#333] font-medium whitespace-nowrap">{order.unit}</td><td className="p-4 text-[#333] font-medium">{order.supplier}</td><td className="p-4 text-[#333] font-medium">{order.requisitioner}</td><td className="p-4 text-[#333] font-medium whitespace-nowrap">{order.mrsNo}</td><td className="p-4 text-[#333] font-medium whitespace-nowrap">{order.poExpDate}</td><td className="p-4 text-[#333] font-medium whitespace-nowrap">{order.pickupBy}</td></tr>)) : (<tr><td colSpan="10" className="p-8 text-center text-[#999]">No purchase orders found</td></tr>)}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );

  const renderHistory = () => (
    <div className="flex flex-col gap-6 w-full text-slate-800">
      <div className="mb-2 text-left"><h1 className="m-0 text-3xl max-md:text-2xl text-[#333] font-bold">HISTORY</h1><p className="mt-2 mx-0 mb-0 text-sm text-[#666]">Records and monitors all past purchase orders</p></div>
      <div className="grid grid-cols-3 max-md:grid-cols-1 gap-6 mb-6 text-left">
        <div className={`rounded-xl p-8 cursor-pointer transition-all duration-300 transform ${historyTab === 'purchase-orders' ? 'bg-gradient-to-br from-[#e3f2fd] to-[#bbdefb] border-2 border-[#1e3c72]' : 'bg-white border-2 border-[#e0e0e0]'}`} onClick={() => { setHistoryTab('purchase-orders'); setHistorySearchQuery(''); }}><div className="text-base font-semibold text-slate-700 mb-2">Purchase Orders</div><div className="text-5xl font-extrabold text-[#1e3c72]">{purchaseOrders.length}</div><div className="text-xs text-slate-500 mt-4">All purchase orders</div></div>
        <div className={`rounded-xl p-8 cursor-pointer transition-all duration-300 transform ${historyTab === 'warehouse-requests' ? 'bg-gradient-to-br from-[#e8f5e9] to-[#c8e6c9] border-2 border-[#2e7d32]' : 'bg-white border-2 border-[#e0e0e0]'}`} onClick={() => { setHistoryTab('warehouse-requests'); setHistorySearchQuery(''); }}><div className="text-base font-semibold text-slate-700 mb-2">Warehouse Requests</div><div className="text-5xl font-extrabold text-[#2e7d32]">{requestsList.length}</div><div className="text-xs text-slate-500 mt-4">All warehouse requests</div></div>
      </div>
      <div className="bg-white rounded-xl shadow-[0_2px_12px_rgba(0,0,0,0.08)] border border-gray-200 overflow-visible">
        <div className={`p-8 border-b border-gray-100 ${historyTab === 'purchase-orders' ? 'bg-gradient-to-r from-[#e8f5e9] to-[#c8e6c9]' : 'bg-gradient-to-r from-[#e3f2fd] to-[#bbdefb]'} `}>
          <div className="flex justify-between items-center max-md:flex-col max-md:align-stretch gap-4 text-left">
            <div><h2 className="m-0 text-2xl font-bold text-[#333] mb-1">{historyTab === 'purchase-orders' ? 'Purchase Orders' : 'Warehouse Requests'}</h2><p className="mt-0 mx-0 mb-0 text-sm text-[#999]">General History</p></div>
            <div className="flex items-center gap-3 max-md:w-full">
              <div className="relative flex-1"><span className="absolute inset-y-0 left-0 flex items-center pl-3 text-gray-400"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg></span><input type="text" placeholder="Search MRS #..." className="w-full pl-9 pr-4 py-2.5 border border-gray-300 rounded-lg text-[13px] placeholder:text-[#999] focus:outline-none focus:border-[#7ec8e3]" value={historySearchQuery} onChange={(e) => setHistorySearchQuery(e.target.value)} /></div>
              <select value={selectedStatus} onChange={(e) => { setSelectedStatus(e.target.value); const reset = { completed: false, incomplete: false, activeDelivery: false, inProcess: false, approved: false, pending: false, rejected: false }; if (e.target.value) reset[e.target.value] = true; setAppliedFilters(reset); }} className="p-2 border rounded bg-white"><option value="">All</option>{historyTab === 'purchase-orders' ? <><option value="completed">Completed</option><option value="incomplete">Incomplete</option><option value="activeDelivery">Active Delivery</option><option value="inProcess">In Process</option></> : <><option value="approved">Approved</option><option value="pending">Pending</option><option value="rejected">Rejected</option></>}</select>
            </div>
          </div>
        </div>
        {historyTab === 'purchase-orders' ? (
          <div className="overflow-x-auto max-h-[500px] border-t border-gray-100"><table className="w-full border-collapse text-[13px]"><thead className="bg-gradient-to-r from-[#e3f2fd] to-[#bbdefb] sticky top-0 z-20"><tr>{['PO date', 'PO number', 'Item Description', 'Qty', 'Unit', 'Supplier Name', 'Requisitioner', 'MRS No.', 'PO rvd date', 'Pick-up by', 'Status'].map((h, i) => (<th key={i} className="p-4 text-left font-bold text-[#1e3c72] border-b-2 border-[#1e3c72]/30 whitespace-nowrap">{h}</th>))}</tr></thead><tbody>{purchaseOrders.length > 0 ? purchaseOrders.map((order, index) => { const isCompleted = order.status === 'completed'; return (<tr key={index} onClick={() => { setSelectedReceiptPo(order); setShowReceiptModal(true); }} className={`border-b border-gray-200 transition-colors duration-150 cursor-pointer ${index % 2 === 0 ? 'bg-[#e8f5e9]' : 'bg-[#e3f2fd]'} hover:bg-[#f0f8fc]/50`}><td className="p-4 text-[#333] font-medium">{order.date}</td><td className="p-4 text-[#333] font-medium">{order.poNumber}</td><td className="p-4 text-[#333] font-medium">{order.itemDescription}</td><td className="p-4 text-[#333] font-medium">{order.qty}</td><td className="p-4 text-[#333] font-medium">{order.unit}</td><td className="p-4 text-[#333] font-medium">{order.supplier}</td><td className="p-4 text-[#333] font-medium">{order.requisitioner}</td><td className="p-4 text-[#333] font-medium">{order.mrsNo}</td><td className="p-4 text-[#333] font-medium">{order.poExpDate}</td><td className="p-4 text-[#333] font-medium">{order.pickupBy}</td><td className="p-4"><span className={`px-3 py-1 rounded-full text-[11px] font-bold border ${isCompleted ? 'bg-gray-100 text-gray-700 border-gray-300' : 'bg-[#e8f5e9] text-[#2e7d32] border-[#a5d6a7]'}`}>{isCompleted ? 'Completed' : 'Open'}</span></td></tr>; })} : (<tr><td colSpan="11" className="p-8 text-center text-[#999]">No purchase orders found</td></tr>)}</tbody></table></div>
        ) : (
          <div className="overflow-x-auto max-h-[500px] border-t border-gray-100"><table className="w-full min-w-[900px] border-collapse text-[13px]"><thead className="bg-gradient-to-r from-[#e8f5e9] to-[#c8e6c9] sticky top-0 z-20"><tr>{['Request Date', 'REQ No.', 'MRS No.', 'Item Description', 'Qty', 'Unit', 'Requested By', 'Requisitioner', 'Approved Qty', 'Status'].map((h, i) => (<th key={i} className="p-4 text-left font-bold text-[#2e7d32] border-b-2 border-[#2e7d32]/30">{h}</th>))}</tr></thead><tbody>{requestsList.length > 0 ? requestsList.map((req, index) => (<tr key={index} className={`border-b border-gray-200 ${index % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}`}><td className="p-4 text-[#333] font-medium">{req.date}</td><td className="p-4 text-[#333] font-medium">{req.reqNumber}</td><td className="p-4 text-[#333] font-medium">{req.mrsNo}</td><td className="p-4 text-[#333] font-medium">{req.itemDescription}</td><td className="p-4 text-[#333] font-medium">{req.qty}</td><td className="p-4 text-[#333] font-medium">{req.unit}</td><td className="p-4 text-[#333] font-medium">{req.requestedBy}</td><td className="p-4 text-[#333] font-medium">{req.requisitioner}</td><td className="p-4 text-[#333] font-medium">{req.approvedQty ?? '-'}</td><td className="p-4"><span className={`px-3 py-1 rounded-full text-[11px] font-bold border ${req.status === 'Approved' ? 'bg-[#e8f5e9] text-[#2e7d32] border-[#a5d6a7]' : req.status === 'Pending' ? 'bg-[#fff9e6] text-[#f57f17] border-[#ffb74d]' : 'bg-[#ffebee] text-[#c62828] border-[#ef5350]'}`}>{req.status}</span></td></tr>)) : (<tr><td colSpan="10" className="p-8 text-center text-[#999]">No requests found</td></tr>)}</tbody></table></div>
        )}
      </div>
    </div>
  );

  const renderUsers = () => (
    <div className="bg-white rounded-lg p-6">
      <div className="flex items-start justify-between mb-8 max-md:flex-col max-md:gap-4"><div><h1 className="m-0 text-3xl max-md:text-2xl text-[#333] font-bold">Users</h1><p className="mt-2 mx-0 mb-0 text-sm text-[#666]">Manage user accounts and permissions</p></div><button className="bg-[#1e3c72] text-white border-none py-2.5 px-5 rounded-md text-sm font-semibold cursor-pointer hover:bg-[#2a5298]" onClick={() => setShowAddUserModal(true)}>Add User</button></div>
      <div className="border border-[#e0e0e0] rounded-lg overflow-hidden">
        <div className="overflow-x-auto max-h-[500px]"><table className="w-full min-w-[700px] border-collapse text-[13px]"><thead><tr>{['Name', 'Username', 'Role', 'Warehouse', 'Actions'].map((h, i) => (<th key={i} className="bg-gradient-to-r from-[#e3f2fd] to-[#bbdefb] p-4 text-left font-bold text-[#1e3c72] border-b-2 border-[#1e3c72]/30 whitespace-nowrap">{h}</th>))}</tr></thead><tbody>{usersList.length > 0 ? usersList.map((u, index) => (<tr key={u.id || index} className={`border-b border-gray-200 ${index % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'} hover:bg-[#f0f8fc]/50`}><td className="p-4 text-[#333] font-medium">{u.name}</td><td className="p-4 text-[#333] font-medium">{u.username}</td><td className="p-4"><span className={`px-3 py-1 rounded-full text-[11px] font-bold border ${u.role === 'Superadmin' ? 'bg-[#f3e5f5] text-[#7b1fa2] border-[#ce93d8]' : u.role === 'Admin' ? 'bg-[#e3f2fd] text-[#1565c0] border-[#90caf9]' : 'bg-[#e8f5e9] text-[#2e7d32] border-[#a5d6a7]'}`}>{u.role}</span></td><td className="p-4 text-[#333]">{(() => { const wh = warehouses.find(w => w.name === u.warehouse); return wh ? wh.name : '-'; })()}</td><td className="p-4"><div className="flex gap-2"><select value={u.warehouse || ''} onChange={(e) => handleUpdateUserWarehouse(u.id, e.target.value)} className="p-1.5 border border-gray-300 rounded text-[11px]"><option value="">None</option>{warehouses.map(w => <option key={w.name} value={w.name}>{w.name}</option>)}</select><button className="p-1.5 bg-[#d32f2f] text-white border-none rounded text-[11px] font-bold cursor-pointer hover:bg-[#b71c1c]" onClick={() => handleDeleteUser(u.username)}>Delete</button></div></td></tr>)) : (<tr><td colSpan="5" className="p-8 text-center text-[#999]">No users found</td></tr>)}</tbody></table></div>
      </div>
    </div>
  );

  const renderRequests = () => (
    <div className="bg-white rounded-lg p-6">
      <div className="flex items-start justify-between mb-8 max-md:flex-col max-md:gap-4"><div><h1 className="m-0 text-3xl max-md:text-2xl text-[#333] font-bold">Requests</h1><p className="mt-2 mx-0 mb-0 text-sm text-[#666]">Pending requests from warehouses</p></div></div>
      <div className="border border-[#e0e0e0] rounded-lg overflow-hidden">
        <div className="overflow-x-auto max-h-[500px]"><table className="w-full min-w-[900px] border-collapse text-[13px]"><thead><tr>{['Request Date', 'REQ No.', 'MRS No.', 'Item Description', 'Qty', 'Unit', 'Requested By', 'Requisitioner', 'Approved Qty', 'Status', 'Actions'].map((h, i) => (<th key={i} className="bg-gradient-to-r from-[#fff8e1] to-[#ffe0b2] p-4 text-left font-bold text-[#f57f17] border-b-2 border-[#f57f17]/30 sticky top-0 z-10 whitespace-nowrap">{h}</th>))}</tr></thead><tbody>{filteredRequests.length > 0 ? filteredRequests.map((req, index) => (<tr key={index} className={`border-b border-gray-200 ${req.status === 'Approved' ? 'bg-[#e8f5e9]' : req.status === 'Partially Approved' ? 'bg-[#fff8e1]' : req.status === 'Pending' ? 'bg-[#fff9e6]' : 'bg-[#ffebee]'} hover:bg-[#f0f8fc]/50`}><td className="p-4 text-[#333] font-medium">{req.date}</td><td className="p-4 text-[#333] font-medium">{req.reqNumber}</td><td className="p-4 text-[#333] font-medium">{req.mrsNo}</td><td className="p-4 text-[#333] font-medium">{req.itemDescription}</td><td className="p-4 text-[#333] font-medium">{req.qty}</td><td className="p-4 text-[#333] font-medium">{req.unit}</td><td className="p-4 text-[#333] font-medium">{req.requestedBy}</td><td className="p-4 text-[#333] font-medium">{req.requisitioner}</td><td className="p-4 text-[#333] font-medium">{req.approvedQty ?? '-'}</td><td className="p-4"><span className={`px-3 py-1 rounded-full text-[11px] font-bold border ${req.status === 'Approved' ? 'bg-[#e8f5e9] text-[#2e7d32] border-[#a5d6a7]' : req.status === 'Partially Approved' ? 'bg-[#fff8e1] text-[#f57f17] border-[#ffcc80]' : req.status === 'Pending' ? 'bg-[#fff9e6] text-[#f57f17] border-[#ffb74d]' : 'bg-[#ffebee] text-[#c62828] border-[#ef5350]'}`}>{req.status}</span></td><td className="p-4"><div className="flex gap-2">{req.status === 'Pending' && <><button className="p-1.5 bg-[#2e7d32] text-white border-none rounded text-[11px] font-bold cursor-pointer hover:bg-[#1b5e20]" onClick={() => handleApproveRequest(req.reqNumber)}>Approve</button><button className="p-1.5 bg-[#d32f2f] text-white border-none rounded text-[11px] font-bold cursor-pointer hover:bg-[#b71c1c]" onClick={() => { setSelectedRequest(req); setIsDeclineMode(true); setShowRequestDetailsModal(true); }}>Decline</button></>}{req.status === 'Rejected' && <button className="p-1.5 bg-[#1e3c72] text-white border-none rounded text-[11px] font-bold cursor-pointer hover:bg-[#2a5298]" onClick={() => { setSelectedRequest(req); setShowRequestDetailsModal(true); }}>View</button>}</div></td></tr>)) : (<tr><td colSpan="11" className="p-8 text-center text-[#999]">No requests found</td></tr>)}</tbody></table></div>
      </div>
    </div>
  );

  const renderSettings = () => (
    <div className="bg-white rounded-lg p-6">
      <div className="mb-8"><h1 className="m-0 text-3xl max-md:text-2xl text-[#333] font-bold">Settings</h1><p className="mt-2 mx-0 mb-0 text-sm text-[#666]">Warehouse and user management</p></div>
      <div className="mb-8"><h2 className="m-0 text-lg text-[#333] font-bold mb-4">Warehouses</h2><div className="flex flex-wrap gap-2 mb-4">{warehouses.map(wh => (<span key={wh.name} className="inline-flex items-center gap-2 bg-[#e3f2fd] text-[#1e3c72] px-3 py-1.5 rounded-full text-sm font-medium border border-[#90caf9]"><span>{wh.name}</span><button className="text-[#d32f2f] hover:text-[#b71c1c] cursor-pointer" onClick={() => handleDeleteWarehouse(wh.name)}>×</button></span>))}</div><button className="bg-[#1e3c72] text-white border-none py-2.5 px-5 rounded-md text-sm font-semibold cursor-pointer hover:bg-[#2a5298]" onClick={() => setShowAddWarehouseModal(true)}>Add Warehouse</button></div>
      <div className="border border-red-300 bg-[#fff5f5] rounded-xl p-6"><h3 className="m-0 text-lg font-bold text-[#c62828] mb-2">Danger Zone — Reset System</h3><p className="mt-0 mx-0 mb-3 text-[13px] text-[#666]">Resetting clears all purchase orders and requests across all warehouses and updates the mock data. Archived data remains recoverable.</p><button className="px-6 py-2.5 bg-[#d32f2f] text-white rounded-md text-sm font-semibold hover:bg-[#b71c1c] cursor-pointer" onClick={async () => { if (window.confirm('Reset all system data? This will clear all POs and requests.')) { try { const { systemReset } = await import('../../../actions/archive'); await systemReset(); alert('System reset complete'); } catch (e) { alert('Reset failed: ' + e.message); } } }}>Reset System Data</button></div>
      {showAddWarehouseModal && (<div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-[1000]"><div className="bg-white rounded-xl w-full max-w-[420px] shadow-[0_10px_30px_rgba(0,0,0,0.15)] p-6 text-left"><h2 className="m-0 text-lg font-bold text-[#333] mb-4">Add Warehouse</h2><form onSubmit={handleAddWarehouseForm} className="flex flex-col gap-4"><input type="text" value={newWarehouseName} onChange={(e) => setNewWarehouseName(e.target.value)} placeholder="Warehouse name" required className="py-2.5 px-3 border border-gray-300 rounded-md text-sm" /><div className="flex justify-end gap-3"><button type="button" onClick={() => { setShowAddWarehouseModal(false); setNewWarehouseName(''); }} className="py-2.5 px-5 rounded-md text-sm font-semibold cursor-pointer bg-white text-[#555] border border-[#ccc] hover:bg-gray-50">Cancel</button><button type="submit" className="py-2.5 px-5 rounded-md text-sm font-semibold cursor-pointer bg-[#1e3c72] text-white border-none hover:bg-[#2a5298]">Add</button></div></form></div></div>)}
      {showAddUserModal && (<div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-[1000]"><div className="bg-white rounded-xl w-full max-w-[420px] shadow-[0_10px_30px_rgba(0,0,0,0.15)] p-6 text-left"><h2 className="m-0 text-lg font-bold text-[#333] mb-4">Add User</h2><form onSubmit={handleAddUser} className="flex flex-col gap-4"><input type="text" value={newUserName} onChange={(e) => setNewUserName(e.target.value)} placeholder="Full name" required className="py-2.5 px-3 border border-gray-300 rounded-md text-sm" /><input type="email" value={newUserEmail} onChange={(e) => setNewUserEmail(e.target.value)} placeholder="Email" required className="py-2.5 px-3 border border-gray-300 rounded-md text-sm" /><select value={newUserRole} onChange={(e) => setNewUserRole(e.target.value)} className="py-2.5 px-3 border border-gray-300 rounded-md text-sm"><option value="Warehouse">Warehouse</option><option value="Admin">Admin</option><option value="Superadmin">Superadmin</option></select><select value={newUserWarehouse} onChange={(e) => setNewUserWarehouse(e.target.value)} className="py-2.5 px-3 border border-gray-300 rounded-md text-sm"><option value="">No warehouse</option>{warehouses.map(w => <option key={w.name} value={w.name}>{w.name}</option>)}</select><div className="flex justify-end gap-3"><button type="button" onClick={() => { setShowAddUserModal(false); setNewUserName(''); setNewUserEmail(''); }} className="py-2.5 px-5 rounded-md text-sm font-semibold cursor-pointer bg-white text-[#555] border border-[#ccc] hover:bg-gray-50">Cancel</button><button type="submit" className="py-2.5 px-5 rounded-md text-sm font-semibold cursor-pointer bg-[#1e3c72] text-white border-none hover:bg-[#2a5298]">Add</button></div></form></div></div>)}
    </div>
  );

  return (
    <div className="flex h-screen bg-[#f5f5f5] w-full max-md:flex-col font-sans">
      <div className="w-[240px] max-md:w-full bg-[#e8eef2] p-6 max-md:p-4 flex flex-col max-md:flex-row max-md:items-center border-r border-[#ddd] max-md:border-r-0 max-md:border-b overflow-y-auto">
        <div className="flex items-center gap-3 mb-8 max-md:mb-0 pb-4 max-md:pb-0 border-b border-[#d0d8e0] max-md:border-b-0">
          <img src="/clogo.jpg" alt="CARWILL Logo" className="w-12 h-12 rounded-full bg-[#ccc] object-cover" />
          <div className="flex-1"><h3 className="m-0 text-sm font-semibold text-[#333]">Carwill Construction Inc.</h3><span className="inline-block bg-[#7ec8e3] text-white px-2 py-1 rounded text-[11px] font-semibold mt-1">Admin</span></div>
        </div>
        <nav className="flex-1 flex flex-col max-md:flex-row gap-2 max-md:gap-0 mb-8 max-md:mb-0 max-md:ml-8">
          {menuItems.map(item => { const isActive = activeMenu === item.id; return (<button key={item.id} className={`flex items-center justify-start max-md:justify-center gap-3 py-3 px-4 max-md:py-2 max-md:px-3 border-none rounded-md cursor-pointer text-sm font-medium transition-all duration-300 max-md:flex-1 ${isActive ? 'bg-[#1e3c72] text-white' : 'bg-transparent text-[#555] hover:bg-[#7ec8e3]/20 hover:text-[#333]'}`} onClick={() => setActiveMenu(item.id)}><span className="text-base">{item.icon}</span><span className="flex-1 text-left max-md:hidden">{item.label}</span></button>); })}
        </nav>
        <button onClick={logout} className="flex items-center gap-3 py-3 px-4 bg-transparent border-none rounded-md cursor-pointer text-[#d32f2f] text-sm font-semibold transition-all duration-300 hover:bg-[#d32f2f]/10 max-md:ml-auto w-full justify-start"><span className="text-base flex items-center justify-center"><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg></span>Log out</button>
      </div>
      <div className="flex-1 overflow-y-auto p-8 max-md:p-4">
        {activeMenu === 'dashboard' && renderDashboard()}
        {activeMenu === 'purchase-order' && renderPurchaseOrders()}
        {activeMenu === 'history' && renderHistory()}
        {activeMenu === 'users' && renderUsers()}
        {activeMenu === 'requests' && renderRequests()}
        {activeMenu === 'settings' && renderSettings()}
      </div>
      {showReceiptModal && selectedReceiptPo && <MaterialRequestReceipt po={selectedReceiptPo} onClose={() => { setShowReceiptModal(false); setSelectedReceiptPo(null); }} />}
    </div>
  );
}

export default AdminDashboard;