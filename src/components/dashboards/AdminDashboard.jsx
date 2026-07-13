import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { getPurchaseOrders, getWarehouseRequests, getWarehouseUsers } from '../../services/api';

function AdminDashboard() {
  const { user, logout } = useAuth();
  const [activeMenu, setActiveMenu] = useState('dashboard');
  const [selectedStat, setSelectedStat] = useState(null);
  
  // States for Purchase Orders view

  const [dashboardSearchQuery, setDashboardSearchQuery] = useState('');
  const [poSearchQuery, setPoSearchQuery] = useState('');
  // States for Requests view
  const [requestsSearchQuery, setRequestsSearchQuery] = useState('');
  const [selectedRequestStatus, setSelectedRequestStatus] = useState('');
  const [selectedRequest, setSelectedRequest] = useState(null);
  const [showRequestDetailsModal, setShowRequestDetailsModal] = useState(false);
  const [isDeclineMode, setIsDeclineMode] = useState(false);
  const [declineRemarks, setDeclineRemarks] = useState('');
  const [showRemarksModal, setShowRemarksModal] = useState(false);
  const [remarksToDisplay, setRemarksToDisplay] = useState('');
  // Warehouse requests state
  const [warehouseRequests, setWarehouseRequests] = useState(getWarehouseRequests());
  // States for History view
  const [historyTab, setHistoryTab] = useState('purchase-orders');
  const [historySearchQuery, setHistorySearchQuery] = useState('');
  const [showHistoryFilter, setShowHistoryFilter] = useState(false);
  const [appliedFilters, setAppliedFilters] = useState({
    // Purchase Order filters
    completed: false,
    incomplete: false,
    activeDelivery: false,
    inProcess: false,
    // Warehouse Request filters
    approved: false,
    pending: false,
    rejected: false,
  });
  const [warehouseUsers, setWarehouseUsers] = useState(getWarehouseUsers());
  const [warehouses, setWarehouses] = useState(['Bajada Warehouse', 'Tagum Warehouse']);
  const [showAddWarehouseModal, setShowAddWarehouseModal] = useState(false);
  const [newWarehouseName, setNewWarehouseName] = useState('');

  // State for Add User modal
  const [showAddUserModal, setShowAddUserModal] = useState(false);
  const [newUserName, setNewUserName] = useState('');
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserWarehouse, setNewUserWarehouse] = useState('Bajada Warehouse');
  const [userSearchQuery, setUserSearchQuery] = useState('');

  const handleAddWarehouse = () => {
    const trimmedName = newWarehouseName.trim();
    if (!trimmedName) {
      alert('Please enter a warehouse name');
      return;
    }
    
    // Auto-capitalize each word (Title Case)
    const formattedName = trimmedName
      .split(/\s+/)
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');

    // Case-insensitive existence check
    const exists = warehouses.some(
      (w) => w.toLowerCase() === formattedName.toLowerCase()
    );

    if (exists) {
      alert('Warehouse already exists (case-insensitive check)');
      return;
    }

    setWarehouses([...warehouses, formattedName]);
    setNewWarehouseName('');
    setShowAddWarehouseModal(false);
  };

  const handleDeleteWarehouse = (warehouseName) => {
    if (warehouses.length <= 1) {
      alert('You must have at least one warehouse in the system.');
      return;
    }
    if (window.confirm(`Are you sure you want to delete "${warehouseName}"? This will reassign users in this warehouse to "${warehouses.filter(w => w !== warehouseName)[0]}".`)) {
      const updatedWarehouses = warehouses.filter(w => w !== warehouseName);
      setWarehouses(updatedWarehouses);
      const fallback = updatedWarehouses[0];
      setWarehouseUsers(
        warehouseUsers.map((u) =>
          u.warehouse === warehouseName ? { ...u, warehouse: fallback } : u
        )
      );
    }
  };

  // Functions to handle user CRUD
  const handleAddUser = () => {
    if (!newUserName || !newUserEmail || !newUserWarehouse) {
      alert('Please fill all fields');
      return;
    }
    const newUser = {
      id: Date.now(),
      name: newUserName,
      email: newUserEmail,
      warehouse: newUserWarehouse,
    };
    setWarehouseUsers([...warehouseUsers, newUser]);
    setShowAddUserModal(false);
    setNewUserName('');
    setNewUserEmail('');
    setNewUserWarehouse(warehouses[0] || '');
  };

  const handleDeleteUser = (id) => {
    if (window.confirm('Delete this user?')) {
      setWarehouseUsers(warehouseUsers.filter(u => u.id !== id));
    }
  };

  const handleAssignWarehouse = (id, warehouse) => {
    setWarehouseUsers(
      warehouseUsers.map(u => (u.id === id ? { ...u, warehouse } : u))
    );
  };
const [selectedStatus, setSelectedStatus] = useState(''); // dropdown filter

  // Purchase orders state
  const [purchaseOrders, setPurchaseOrders] = useState(getPurchaseOrders());
  const [selectedPoType, setSelectedPoType] = useState('all');

  // Modal visibility state
  const [showModal, setShowModal] = useState(false);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [selectedReceiptPo, setSelectedReceiptPo] = useState(null);
  const [showReceiptModal, setShowReceiptModal] = useState(false);

  const handleOpenReceipt = (po) => {
    setSelectedReceiptPo(po);
    setShowReceiptModal(true);
  };

  const handleCloseReceiptModal = () => {
    setSelectedReceiptPo(null);
    setShowReceiptModal(false);
  };

  // Form input states
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

  // Calculate stats from data
  const totalPOs = purchaseOrders.length;
  const completedPOs = purchaseOrders.filter(order => order.status === 'completed').length;
  const incompletePOs = purchaseOrders.filter(order => order.status === 'incomplete').length;

  // Calculate purchase order section card values
  const activeDeliveryCount = purchaseOrders.filter(order => order.poType === 'active-delivery').length;
  const discrepancyCount = purchaseOrders.filter(order => order.poType === 'discrepancy').length;

  // Calculate warehouse request section card values
  const pendingRequestsCount = warehouseRequests.filter(req => req.status === 'Pending').length;
  const rejectedRequestsCount = warehouseRequests.filter(req => req.status === 'Rejected').length;

  const handleSavePurchaseOrder = (e) => {
    e.preventDefault();
    if (!formPoNumber || !formPoDate || !formItemDescription || !formQty || !formRequisitioner || !formMrsNo || !formPickupBy || !formPlateNumber || !formSupplierName) {
      alert('Please fill in all required fields marked with *');
      return;
    }

    const newPO = {
      date: formPoDate,
      poNumber: formPoNumber,
      itemDescription: formItemDescription,
      qty: parseInt(formQty) || 0,
      unit: formUnit,
      supplier: formSupplierName,
      supplierAddress: formSupplierAddress,
      requisitioner: formRequisitioner,
      mrsNo: formMrsNo,
      poExpDate: formApprovalDate || formPoDate,
      pickupBy: formPickupBy,
      plateNumber: formPlateNumber,
      approvedBy: formApprovedBy,
      listedBy: formListedBy,
      notes: formNotes,
      status: 'incomplete',
      poType: 'active-delivery'
    };

    setPurchaseOrders([...purchaseOrders, newPO]);
    
    // Update the corresponding warehouse request status to Approved if it was generated from a request
    if (formMrsNo) {
      setWarehouseRequests(prevRequests =>
        prevRequests.map(req =>
          req.mrsNo === formMrsNo ? { ...req, status: 'Approved' } : req
        )
      );
    }

    handleCloseModal();
    setShowSuccessModal(true); // Open custom success confirmation modal!
  };

  const handleCloseModal = () => {
    setShowModal(false);
    // Reset form states (keep listedBy as current user)
    setFormPoNumber('');
    setFormPoDate('');
    setFormItemDescription('');
    setFormQty('');
    setFormUnit('pcs');
    setFormNotes('');
    setFormApprovedBy('');
    setFormApprovalDate('');
    setFormRequisitioner('');
    setFormMrsNo('');
    setFormPickupBy('');
    setFormPlateNumber('');
    setFormSupplierName('');
    setFormSupplierAddress('');
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

  const handleSubmitDecline = () => {
    if (!declineRemarks.trim()) {
      alert('Please enter remarks for declining this request');
      return;
    }

    // Update the request status to Rejected and add remarks
    const updatedRequests = warehouseRequests.map(req => 
      req.mrsNo === selectedRequest.mrsNo 
        ? { ...req, status: 'Rejected', remarks: declineRemarks }
        : req
    );

    setWarehouseRequests(updatedRequests);
    handleCloseRequestDetailsModal();
  };

  const handleViewRejectedRemarks = (request) => {
    setRemarksToDisplay(request.remarks);
    setShowRemarksModal(true);
  };

  const handleCloseRemarksModal = () => {
    setShowRemarksModal(false);
    setRemarksToDisplay('');
  };

  const handleProceedPO = () => {
    // Populate the PO form with request details
    setFormItemDescription(selectedRequest.itemDescription);
    setFormQty(selectedRequest.qty.toString());
    setFormUnit(selectedRequest.unit);
    setFormRequisitioner(selectedRequest.requisitioner);
    setFormMrsNo(selectedRequest.mrsNo);
    setFormApprovedBy(selectedRequest.requestedBy || '');
    setFormApprovalDate(selectedRequest.date || '');
    
    // Close the request details modal and open PO modal
    handleCloseRequestDetailsModal();
    setShowModal(true);
  };

  const menuItems = [
    { 
      id: 'dashboard', 
      label: 'Dashboard', 
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
      id: 'users', 
      label: 'Users', 
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="inline-block align-middle">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      )
    },
    { 
      id: 'requests', 
      label: 'Requests', 
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="inline-block align-middle">
          <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
          <polyline points="22,6 12,13 2,6" />
        </svg>
      )
    },
  ];

  // Filtering dashboard orders
  const filteredDashboardOrders = purchaseOrders.filter(order => {
    if (selectedStat === 'completed' && order.status !== 'completed') return false;
    if (selectedStat === 'incomplete' && order.status !== 'incomplete') return false;
    if (dashboardSearchQuery && !order.poNumber.includes(dashboardSearchQuery)) return false;
    return true;
  });

  // Filtering purchase order section orders
  const filteredPurchaseOrders = purchaseOrders.filter(order => {
    if (selectedPoType !== 'all' && order.poType !== selectedPoType) return false;
    if (poSearchQuery && !order.poNumber.includes(poSearchQuery)) return false;
    return true;
  });

  // Filtering history POs
  let filteredHistoryPOs = purchaseOrders.filter(order => {
    if (historySearchQuery && !order.poNumber.includes(historySearchQuery) && !order.itemDescription.toLowerCase().includes(historySearchQuery.toLowerCase())) return false;
    
    const activeFiltersCount = Object.keys(appliedFilters)
      .filter(key => !['approved','pending','rejected'].includes(key) && appliedFilters[key]).length;

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

  // Sorting by PO is no longer required as group-by feature has been removed.
  // If needed, you can implement custom sorting here.
  // Example: filteredHistoryPOs = [...filteredHistoryPOs].sort((a, b) => a.poNumber.localeCompare(b.poNumber));

  // Filtering history warehouse requests
  let filteredHistoryReqs = warehouseRequests.filter(req => {
    if (historySearchQuery && !req.mrsNo.includes(historySearchQuery) && !req.itemDescription.toLowerCase().includes(historySearchQuery.toLowerCase())) return false;
    
    const activeFiltersCount = Object.keys(appliedFilters)
      .filter(key => ['approved','pending','rejected'].includes(key) && appliedFilters[key]).length;
      
    if (activeFiltersCount > 0) {
      let match = false;
      if (appliedFilters.pending && req.status === 'Pending') match = true;
      if (appliedFilters.approved && req.status === 'Approved') match = true;
      if (appliedFilters.rejected && req.status === 'Rejected') match = true;
      if (!match) return false;
    }
    
    return true;
  });

  // Sorting by PO is no longer required for warehouse requests.
  // Implement custom sorting if desired.
  // Example: filteredHistoryReqs = [...filteredHistoryReqs].sort((a, b) => a.reqNumber.localeCompare(b.reqNumber));

  // Filtering requests section
  let filteredRequests = warehouseRequests.filter(req => {
    if (requestsSearchQuery && !req.mrsNo.includes(requestsSearchQuery) && !req.itemDescription.toLowerCase().includes(requestsSearchQuery.toLowerCase())) return false;
    
    if (selectedRequestStatus && req.status !== selectedRequestStatus) return false;
    
    return true;
  });

  return (
    <div className="flex h-screen bg-[#f5f5f5] w-full max-md:flex-col font-sans">
      {/* Sidebar */}
      <div className="w-[240px] max-md:w-full bg-[#e8eef2] p-6 max-md:p-4 flex flex-col max-md:flex-row max-md:items-center border-r border-[#ddd] max-md:border-r-0 max-md:border-b overflow-y-auto">
        <div className="flex items-center gap-3 mb-8 max-md:mb-0 pb-4 max-md:pb-0 border-b border-[#d0d8e0] max-md:border-b-0">
          <img src="/clogo.jpg" alt="CARWILL Logo" className="w-12 h-12 rounded-full bg-[#ccc] object-cover" />
          <div className="flex-1">
            <h3 className="m-0 text-sm font-semibold text-[#333]">Carwill Construction Inc.</h3>
            <span className="inline-block bg-[#7ec8e3] text-white px-2 py-1 rounded text-[11px] font-semibold mt-1">Admin</span>
          </div>
        </div>

        <nav className="flex-1 flex flex-col max-md:flex-row gap-2 max-md:gap-0 mb-8 max-md:mb-0 max-md:ml-8">
          {menuItems.map(item => (
            <button
              key={item.id}
              className={`flex items-center justify-start max-md:justify-center gap-3 py-3 px-4 max-md:py-2 max-md:px-3 border-none rounded-md cursor-pointer text-sm font-medium transition-all duration-300 max-md:flex-1 ${
                activeMenu === item.id 
                  ? 'bg-[#1e3c72] text-white' 
                  : 'bg-transparent text-[#555] hover:bg-[#7ec8e3]/20 hover:text-[#333]'
              }`}
              onClick={() => setActiveMenu(item.id)}
            >
              <span className="text-base">{item.icon}</span>
              <span className="flex-1 text-left max-md:hidden">{item.label}</span>
            </button>
          ))}
        </nav>

        <button onClick={logout} className="flex items-center gap-3 py-3 px-4 bg-transparent border-none rounded-md cursor-pointer text-[#d32f2f] text-sm font-semibold transition-all duration-300 hover:bg-[#d32f2f]/10 max-md:ml-auto">
          <span className="text-base flex items-center justify-center">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
          </span>
          Log out
        </button>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto p-8 max-md:p-4">
        {activeMenu === 'dashboard' && (
          <div className="bg-white rounded-lg p-6">
            <div className="mb-8">
              <h1 className="m-0 text-3xl max-md:text-2xl text-[#333] font-bold">Dashboard</h1>
              <p className="mt-2 mx-0 mb-0 text-sm text-[#666]">Overview of complete vs incomplete purchase order fulfillment</p>
            </div>

            <div className="grid grid-cols-[repeat(auto-fit,minmax(250px,1fr))] max-md:grid-cols-1 gap-5 mb-8">
              <div 
                className={`border-2 rounded-xl p-8 text-center cursor-pointer transition-all duration-300 transform ${
                  selectedStat === 'total' 
                    ? 'bg-gradient-to-br from-[#e3f2fd] to-[#bbdefb] border-[#1e3c72] shadow-[0_4px_16px_rgba(30,60,114,0.15)] scale-[1.02] -translate-y-1' 
                    : 'bg-white border-[#90caf9] hover:border-[#1e3c72] hover:shadow-[0_4px_12px_rgba(30,60,114,0.12)] shadow-[0_2px_8px_rgba(0,0,0,0.06)]'
                }`}
                onClick={() => setSelectedStat(selectedStat === 'total' ? null : 'total')}
              >
                <h3 className="m-0 text-sm text-[#666] font-semibold mb-3">Total PO's</h3>
                <div className="text-5xl font-bold text-[#1e3c72]">{totalPOs}</div>
              </div>
              <div 
                className={`border-2 rounded-xl p-8 text-center cursor-pointer transition-all duration-300 transform ${
                  selectedStat === 'completed' 
                    ? 'bg-gradient-to-br from-[#e8f5e9] to-[#c8e6c9] border-[#2e7d32] shadow-[0_4px_16px_rgba(46,125,50,0.15)] scale-[1.02] -translate-y-1' 
                    : 'bg-white border-[#a5d6a7] hover:border-[#2e7d32] hover:shadow-[0_4px_12px_rgba(46,125,50,0.12)] shadow-[0_2px_8px_rgba(0,0,0,0.06)]'
                }`}
                onClick={() => setSelectedStat(selectedStat === 'completed' ? null : 'completed')}
              >
                <h3 className="m-0 text-sm text-[#666] font-semibold mb-3">Completed</h3>
                <div className="text-5xl font-bold text-[#2e7d32]">{completedPOs}</div>
              </div>
              <div 
                className={`border-2 rounded-xl p-8 text-center cursor-pointer transition-all duration-300 transform ${
                  selectedStat === 'incomplete' 
                    ? 'bg-gradient-to-br from-[#fef5f5] to-[#ffcdd2] border-[#c62828] shadow-[0_4px_16px_rgba(198,40,40,0.15)] scale-[1.02] -translate-y-1' 
                    : 'bg-white border-[#f44336] hover:border-[#c62828] hover:shadow-[0_4px_12px_rgba(198,40,40,0.12)] shadow-[0_2px_8px_rgba(0,0,0,0.06)]'
                }`}
                onClick={() => setSelectedStat(selectedStat === 'incomplete' ? null : 'incomplete')}
              >
                <h3 className="m-0 text-sm text-[#666] font-semibold mb-3">Incomplete</h3>
                <div className="text-5xl font-bold text-[#c62828]">{incompletePOs}</div>
              </div>
            </div>

            <div className="mt-8">
              <div className="mb-4">
                <h2 className="m-0 text-lg text-[#333] font-bold">
                  {selectedStat === 'completed' ? 'Completed Purchase Orders' : selectedStat === 'incomplete' ? 'Incomplete Purchase Orders' : 'Total Purchase Orders'}
                </h2>
                <p className="mt-1 mx-0 mb-0 text-[13px] text-[#999]">
                  {selectedStat === 'completed' ? 'Successfully completed purchase orders' : selectedStat === 'incomplete' ? 'Purchase orders pending fulfillment' : 'Successfully made purchase orders'}
                </p>
              </div>
              <input 
                type="text" 
                placeholder="Search PO number..." 
                className="w-full max-w-[300px] py-2.5 px-4 border border-[#e0e0e0] rounded-md text-[13px] mb-4 placeholder:text-[#999] focus:outline-none focus:border-[#7ec8e3] focus:ring-2 focus:ring-[#7ec8e3]/10" 
                value={dashboardSearchQuery}
                onChange={(e) => setDashboardSearchQuery(e.target.value)}
              />
              <div className="border border-[#e0e0e0] rounded-lg overflow-hidden">
                <div className="overflow-x-auto max-h-[500px]">
                  <table className="w-full border-collapse text-[13px]">
                    <thead className="bg-gradient-to-r from-[#e3f2fd] to-[#bbdefb] sticky top-0 z-10">
                      <tr>
                        <th className="p-4 text-left font-bold text-[#1e3c72] border-b-2 border-[#1e3c72]/30 whitespace-nowrap">PO date</th>
                        <th className="p-4 text-left font-bold text-[#1e3c72] border-b-2 border-[#1e3c72]/30 whitespace-nowrap">PO number</th>
                        <th className="p-4 text-left font-bold text-[#1e3c72] border-b-2 border-[#1e3c72]/30 whitespace-nowrap">Item Description</th>
                        <th className="p-4 text-left font-bold text-[#1e3c72] border-b-2 border-[#1e3c72]/30 whitespace-nowrap">Qty</th>
                        <th className="p-4 text-left font-bold text-[#1e3c72] border-b-2 border-[#1e3c72]/30 whitespace-nowrap">Unit</th>
                        <th className="p-4 text-left font-bold text-[#1e3c72] border-b-2 border-[#1e3c72]/30 whitespace-nowrap">Supplier Name</th>
                        <th className="p-4 text-left font-bold text-[#1e3c72] border-b-2 border-[#1e3c72]/30 whitespace-nowrap">Requisitioner</th>
                        <th className="p-4 text-left font-bold text-[#1e3c72] border-b-2 border-[#1e3c72]/30 whitespace-nowrap">MRS No.</th>
                        <th className="p-4 text-left font-bold text-[#1e3c72] border-b-2 border-[#1e3c72]/30 whitespace-nowrap">PO red date</th>
                        <th className="p-4 text-left font-bold text-[#1e3c72] border-b-2 border-[#1e3c72]/30 whitespace-nowrap">Pick-up by</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredDashboardOrders.length > 0 ? (
                        filteredDashboardOrders.map((order, index) => {
                          const isCompletedOrActive = order.status === 'completed' || order.poType === 'active-delivery';
                          return (
                            <tr key={index} onClick={() => handleOpenReceipt(order)} className={`border-b border-gray-200 transition-colors duration-150 cursor-pointer ${isCompletedOrActive ? 'bg-[#e8f5e9]' : order.status === 'incomplete' ? 'bg-[#fef5f5]' : (index % 2 === 0 ? 'bg-white' : 'bg-gray-50/50')} hover:bg-[#f0f8fc]/50`}>
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
                          );
                        })
                      ) : (
                        <tr>
                          <td colSpan="10" className="p-8 text-center text-[#999]">
                            No purchase orders found
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeMenu === 'purchase-order' && (
          <div className="bg-white rounded-lg p-6">
            <div className="mb-8">
              <h1 className="m-0 text-3xl max-md:text-2xl text-[#333] font-bold">Purchase Orders</h1>
              <p className="mt-2 mx-0 mb-0 text-sm text-[#666]">Manage and track material requisitions</p>
            </div>

            <div className="grid grid-cols-[repeat(auto-fit,minmax(250px,1fr))] max-md:grid-cols-1 gap-5 mb-8">
              <div 
                className={`border-2 rounded-xl p-8 text-center cursor-pointer transition-all duration-300 transform ${
                  selectedPoType === 'all' 
                    ? 'bg-gradient-to-br from-[#e3f2fd] to-[#bbdefb] border-[#1e3c72] shadow-[0_4px_16px_rgba(30,60,114,0.15)] scale-[1.02] -translate-y-1' 
                    : 'bg-white border-[#90caf9] hover:border-[#1e3c72] hover:shadow-[0_4px_12px_rgba(30,60,114,0.12)] shadow-[0_2px_8px_rgba(0,0,0,0.06)]'
                }`}
                onClick={() => setSelectedPoType('all')}
              >
                <h3 className="m-0 text-sm text-[#555] font-semibold mb-3">Total POs</h3>
                <div className="text-4xl font-bold text-[#1e3c72]">{purchaseOrders.length}</div>
                <p className="mt-3 mx-0 mb-0 text-xs text-[#777]">All purchase orders</p>
              </div>
              <div 
                className={`border-2 rounded-xl p-8 text-center cursor-pointer transition-all duration-300 transform ${
                  selectedPoType === 'active-delivery' 
                    ? 'bg-gradient-to-br from-[#e8f5e9] to-[#c8e6c9] border-[#2e7d32] shadow-[0_4px_16px_rgba(46,125,50,0.15)] scale-[1.02] -translate-y-1' 
                    : 'bg-white border-[#a5d6a7] hover:border-[#2e7d32] hover:shadow-[0_4px_12px_rgba(46,125,50,0.12)] shadow-[0_2px_8px_rgba(0,0,0,0.06)]'
                }`}
                onClick={() => setSelectedPoType('active-delivery')}
              >
                <h3 className="m-0 text-sm text-[#555] font-semibold mb-3">Active Delivery</h3>
                <div className="text-4xl font-bold text-[#2e7d32]">{activeDeliveryCount}</div>
                <p className="mt-3 mx-0 mb-0 text-xs text-[#777]">Orders currently in delivery</p>
              </div>
              <div 
                className={`border-2 rounded-xl p-8 text-center cursor-pointer transition-all duration-300 transform ${
                  selectedPoType === 'discrepancy' 
                    ? 'bg-gradient-to-br from-[#fef5f5] to-[#ffcdd2] border-[#c62828] shadow-[0_4px_16px_rgba(198,40,40,0.15)] scale-[1.02] -translate-y-1' 
                    : 'bg-white border-[#f44336] hover:border-[#c62828] hover:shadow-[0_4px_12px_rgba(198,40,40,0.12)] shadow-[0_2px_8px_rgba(0,0,0,0.06)]'
                }`}
                onClick={() => setSelectedPoType('discrepancy')}
              >
                <h3 className="m-0 text-sm text-[#555] font-semibold mb-3">Discrepancies</h3>
                <div className="text-4xl font-bold text-[#c62828]">{discrepancyCount}</div>
                <p className="mt-3 mx-0 mb-0 text-xs text-[#777]">Orders with issues</p>
              </div>
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
                  {selectedPoType === 'all' 
                    ? 'All purchase orders' 
                    : selectedPoType === 'active-delivery' 
                    ? 'Purchase orders currently active and out for delivery' 
                    : 'Purchase orders with identified discrepancies'}
                </p>
              </div>
              
              <input 
                type="text" 
                placeholder="Search PO number..." 
                className="w-full max-w-[300px] py-2.5 px-4 border border-[#e0e0e0] rounded-md text-[13px] mb-4 placeholder:text-[#999] focus:outline-none focus:border-[#7ec8e3] focus:ring-2 focus:ring-[#7ec8e3]/10" 
                value={poSearchQuery}
                onChange={(e) => setPoSearchQuery(e.target.value)}
              />

              <div className="border border-[#e0e0e0] rounded-lg overflow-hidden">
                <div className="overflow-x-auto max-h-[500px]">
                  <table className="w-full border-collapse text-[13px]">
                    <thead className={`bg-gradient-to-r sticky top-0 z-10 ${
                      selectedPoType === 'all' 
                        ? 'from-[#e3f2fd] to-[#bbdefb]' 
                        : selectedPoType === 'active-delivery'
                        ? 'from-[#e8f5e9] to-[#c8e6c9]'
                        : 'from-[#fef5f5] to-[#ffcdd2]'
                    }`}>
                      <tr>
                        <th className={`p-4 text-left font-bold ${
                          selectedPoType === 'all' 
                            ? 'text-[#1e3c72] border-b-2 border-[#1e3c72]/30' 
                            : selectedPoType === 'active-delivery'
                            ? 'text-[#2e7d32] border-b-2 border-[#2e7d32]/30'
                            : 'text-[#c62828] border-b-2 border-[#c62828]/30'
                        } whitespace-nowrap`}>PO date</th>
                        <th className={`p-4 text-left font-bold ${
                          selectedPoType === 'all' 
                            ? 'text-[#1e3c72] border-b-2 border-[#1e3c72]/30' 
                            : selectedPoType === 'active-delivery'
                            ? 'text-[#2e7d32] border-b-2 border-[#2e7d32]/30'
                            : 'text-[#c62828] border-b-2 border-[#c62828]/30'
                        } whitespace-nowrap`}>PO number</th>
                        <th className={`p-4 text-left font-bold ${
                          selectedPoType === 'all' 
                            ? 'text-[#1e3c72] border-b-2 border-[#1e3c72]/30' 
                            : selectedPoType === 'active-delivery'
                            ? 'text-[#2e7d32] border-b-2 border-[#2e7d32]/30'
                            : 'text-[#c62828] border-b-2 border-[#c62828]/30'
                        } whitespace-nowrap`}>Item Description</th>
                        <th className={`p-4 text-left font-bold ${
                          selectedPoType === 'all' 
                            ? 'text-[#1e3c72] border-b-2 border-[#1e3c72]/30' 
                            : selectedPoType === 'active-delivery'
                            ? 'text-[#2e7d32] border-b-2 border-[#2e7d32]/30'
                            : 'text-[#c62828] border-b-2 border-[#c62828]/30'
                        } whitespace-nowrap`}>Qty</th>
                        <th className={`p-4 text-left font-bold ${
                          selectedPoType === 'all' 
                            ? 'text-[#1e3c72] border-b-2 border-[#1e3c72]/30' 
                            : selectedPoType === 'active-delivery'
                            ? 'text-[#2e7d32] border-b-2 border-[#2e7d32]/30'
                            : 'text-[#c62828] border-b-2 border-[#c62828]/30'
                        } whitespace-nowrap`}>Unit</th>
                        <th className={`p-4 text-left font-bold ${
                          selectedPoType === 'all' 
                            ? 'text-[#1e3c72] border-b-2 border-[#1e3c72]/30' 
                            : selectedPoType === 'active-delivery'
                            ? 'text-[#2e7d32] border-b-2 border-[#2e7d32]/30'
                            : 'text-[#c62828] border-b-2 border-[#c62828]/30'
                        } whitespace-nowrap`}>Supplier Name</th>
                        <th className={`p-4 text-left font-bold ${
                          selectedPoType === 'all' 
                            ? 'text-[#1e3c72] border-b-2 border-[#1e3c72]/30' 
                            : selectedPoType === 'active-delivery'
                            ? 'text-[#2e7d32] border-b-2 border-[#2e7d32]/30'
                            : 'text-[#c62828] border-b-2 border-[#c62828]/30'
                        } whitespace-nowrap`}>Requisitioner</th>
                        <th className={`p-4 text-left font-bold ${
                          selectedPoType === 'all' 
                            ? 'text-[#1e3c72] border-b-2 border-[#1e3c72]/30' 
                            : selectedPoType === 'active-delivery'
                            ? 'text-[#2e7d32] border-b-2 border-[#2e7d32]/30'
                            : 'text-[#c62828] border-b-2 border-[#c62828]/30'
                        } whitespace-nowrap`}>MRS No.</th>
                        <th className={`p-4 text-left font-bold ${
                          selectedPoType === 'all' 
                            ? 'text-[#1e3c72] border-b-2 border-[#1e3c72]/30' 
                            : selectedPoType === 'active-delivery'
                            ? 'text-[#2e7d32] border-b-2 border-[#2e7d32]/30'
                            : 'text-[#c62828] border-b-2 border-[#c62828]/30'
                        } whitespace-nowrap`}>PO red date</th>
                        <th className={`p-4 text-left font-bold ${
                          selectedPoType === 'all' 
                            ? 'text-[#1e3c72] border-b-2 border-[#1e3c72]/30' 
                            : selectedPoType === 'active-delivery'
                            ? 'text-[#2e7d32] border-b-2 border-[#2e7d32]/30'
                            : 'text-[#c62828] border-b-2 border-[#c62828]/30'
                        } whitespace-nowrap`}>Pick-up by</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredPurchaseOrders.length > 0 ? (
                        filteredPurchaseOrders.map((order, index) => (
                          <tr 
                            key={index} 
                            onClick={() => handleOpenReceipt(order)}
                            className={`border-b border-gray-200 transition-colors duration-150 cursor-pointer ${index % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'} hover:bg-[#f4fbf7]/50`}
                          >
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
                        <tr>
                          <td colSpan="10" className="p-8 text-center text-[#999]">
                            No purchase orders found
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeMenu === 'history' && (
          <div className="flex flex-col gap-6 w-full text-slate-800">
            <div className="mb-2 text-left">
              <h1 className="m-0 text-3xl max-md:text-2xl text-[#333] font-bold">HISTORY</h1>
              <p className="mt-2 mx-0 mb-0 text-sm text-[#666]">Records and monitors all past purchase orders</p>
            </div>

            {/* Stats Cards */}
            <div className="grid grid-cols-3 max-md:grid-cols-1 gap-6 mb-6 text-left">
              <div 
                className={`rounded-xl p-8 cursor-pointer transition-all duration-300 transform ${
                  historyTab === 'purchase-orders' 
                    ? 'bg-gradient-to-br from-[#e3f2fd] to-[#bbdefb] border-2 border-[#1e3c72] shadow-[0_4px_16px_rgba(30,60,114,0.15)] scale-[1.02] -translate-y-1' 
                    : 'bg-white border-2 border-[#e0e0e0] shadow-[0_2px_8px_rgba(0,0,0,0.06)] hover:border-[#1e3c72] hover:shadow-[0_4px_12px_rgba(30,60,114,0.12)]'
                }`}
                onClick={() => {
                  setHistoryTab('purchase-orders');
                  setHistorySearchQuery('');
                }}
              >
                <div className="text-base font-semibold text-slate-700 mb-2">Purchase Orders</div>
                <div className="text-5xl font-extrabold text-[#1e3c72]">{purchaseOrders.length}</div>
                <div className="text-xs text-slate-500 mt-4">All purchase orders</div>
              </div>
              
              <div 
                className={`rounded-xl p-8 cursor-pointer transition-all duration-300 transform ${
                  historyTab === 'warehouse-requests' 
                    ? 'bg-gradient-to-br from-[#e8f5e9] to-[#c8e6c9] border-2 border-[#2e7d32] shadow-[0_4px_16px_rgba(46,125,50,0.15)] scale-[1.02] -translate-y-1' 
                    : 'bg-white border-2 border-[#e0e0e0] shadow-[0_2px_8px_rgba(0,0,0,0.06)] hover:border-[#2e7d32] hover:shadow-[0_4px_12px_rgba(46,125,50,0.12)]'
                }`}
                onClick={() => {
                  setHistoryTab('warehouse-requests');
                  setHistorySearchQuery('');
                }}
              >
                <div className="text-base font-semibold text-slate-700 mb-2">Warehouse Requests</div>
                <div className="text-5xl font-extrabold text-[#2e7d32]">{warehouseRequests.length}</div>
                <div className="text-xs text-slate-500 mt-4">All warehouse requests</div>
              </div>

            </div>

            {/* White card table container */}
            <div className="bg-white rounded-xl shadow-[0_2px_12px_rgba(0,0,0,0.08)] border border-gray-200 overflow-visible">
              <div className={`p-8 border-b border-gray-100 ${historyTab === 'purchase-orders' ? 'bg-gradient-to-r from-[#e8f5e9] to-[#c8e6c9]' : 'bg-gradient-to-r from-[#e3f2fd] to-[#bbdefb]'} `}>
                <div className="flex justify-between items-center max-md:flex-col max-md:align-stretch gap-4 text-left">
                  <div>
                    <h2 className="m-0 text-2xl font-bold text-[#333] mb-1">
                      {historyTab === 'purchase-orders' ? 'Purchase Orders' : 'Warehouse Requests'}
                    </h2>
                    <p className="mt-0 mx-0 mb-0 text-sm text-[#999]">
                      General History
                    </p>
                  </div>
                  
                  <div className="flex items-center gap-3 max-md:w-full">
                    <div className="relative flex-1">
                      <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-gray-400">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                        </svg>
                      </span>
                      <input 
                        type="text" 
                        placeholder="Search MRS #..." 
                        className="w-full pl-9 pr-4 py-2.5 border border-gray-300 rounded-lg text-[13px] placeholder:text-[#999] focus:outline-none focus:border-[#7ec8e3] focus:ring-2 focus:ring-[#7ec8e3]/10 transition-all duration-200" 
                        value={historySearchQuery}
                        onChange={(e) => setHistorySearchQuery(e.target.value)}
                      />
                    </div>
                    
                    <select
                      value={selectedStatus}
                      onChange={(e) => {
                        const val = e.target.value;
                        setSelectedStatus(val);
                        const reset = {
                          completed: false,
                          incomplete: false,
                          activeDelivery: false,
                          inProcess: false,
                          approved: false,
                          pending: false,
                          rejected: false,
                        };
                        if (val) reset[val] = true;
                        setAppliedFilters(reset);
                      }}
                      className="p-2 border rounded bg-white"
                    >
                      <option value="">All</option>
                      {historyTab === 'purchase-orders' && (
                        <>
                          <option value="completed">Completed</option>
                          <option value="incomplete">Incomplete</option>
                          <option value="activeDelivery">Active Delivery</option>
                          <option value="inProcess">In Process</option>
                        </>
                      )}
                      {historyTab === 'warehouse-requests' && (
                        <>
                          <option value="approved">Approved</option>
                          <option value="pending">Pending</option>
                          <option value="rejected">Rejected</option>
                        </>
                      )}
                    </select>            
                  </div>
                </div>
              </div>

              {historyTab === 'purchase-orders' ? (
                <div className="overflow-x-auto max-h-[500px] border-t border-gray-100">
                <table className="w-full border-collapse text-[13px]">
                  <thead className="bg-gradient-to-r from-[#e3f2fd] to-[#bbdefb] sticky top-0 z-20">
                    <tr>
                      <th className="p-4 text-left font-bold text-[#1e3c72] border-b-2 border-[#1e3c72]/30 whitespace-nowrap">PO date</th>
                      <th className="p-4 text-left font-bold text-[#1e3c72] border-b-2 border-[#1e3c72]/30 whitespace-nowrap">PO number</th>
                      <th className="p-4 text-left font-bold text-[#1e3c72] border-b-2 border-[#1e3c72]/30 whitespace-nowrap">Item Description</th>
                      <th className="p-4 text-left font-bold text-[#1e3c72] border-b-2 border-[#1e3c72]/30 whitespace-nowrap">Qty</th>
                      <th className="p-4 text-left font-bold text-[#1e3c72] border-b-2 border-[#1e3c72]/30 whitespace-nowrap">Unit</th>
                      <th className="p-4 text-left font-bold text-[#1e3c72] border-b-2 border-[#1e3c72]/30 whitespace-nowrap">Supplier Name</th>
                      <th className="p-4 text-left font-bold text-[#1e3c72] border-b-2 border-[#1e3c72]/30 whitespace-nowrap">Requisitioner</th>
                      <th className="p-4 text-left font-bold text-[#1e3c72] border-b-2 border-[#1e3c72]/30 whitespace-nowrap">MRS No.</th>
                      <th className="p-4 text-left font-bold text-[#1e3c72] border-b-2 border-[#1e3c72]/30 whitespace-nowrap">PO rvd date</th>
                      <th className="p-4 text-left font-bold text-[#1e3c72] border-b-2 border-[#1e3c72]/30 whitespace-nowrap">Pick-up by</th>
                      <th className="p-4 text-left font-bold text-[#1e3c72] border-b-2 border-[#1e3c72]/30 whitespace-nowrap">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                     {filteredHistoryPOs.length > 0 ? (
                      filteredHistoryPOs.map((order, index) => {
                        const isCompleted = order.status === 'completed';
                        return (
                          <tr key={index} onClick={() => handleOpenReceipt(order)} className={`border-b border-gray-200 transition-colors duration-150 cursor-pointer ${index % 2 === 0 ? (historyTab === 'purchase-orders' ? 'bg-[#e8f5e9]' : 'bg-[#e3f2fd]') : (historyTab === 'purchase-orders' ? 'bg-[#c8e6c9]' : 'bg-[#bbdefb]')} hover:bg-[#f0f8fc]/50`}>
                            <td className="p-4 text-[#333] font-medium">{order.date}</td>
                            <td className="p-4 text-[#333] font-medium">{order.poNumber}</td>
                            <td className="p-4 text-[#333] font-medium">{order.itemDescription}</td>
                            <td className="p-4 text-[#333] font-medium">{order.qty}</td>
                            <td className="p-4 text-[#333] font-medium">{order.unit}</td>
                            <td className="p-4 text-[#333] font-medium">{order.supplier}</td>
                            <td className="p-4 text-[#333] font-medium">{order.requisitioner}</td>
                            <td className="p-4 text-[#333] font-medium">{order.mrsNo || '676767'}</td>
                            <td className="p-4 text-[#333] font-medium">{order.poExpDate || '12'}</td>
                            <td className="p-4 text-[#333] font-medium">{order.pickupBy || 'John Doe'}</td>
                            <td className="p-4">
                              <span className={`px-3 py-1 rounded-full text-[11px] font-bold border transition-colors duration-200 ${
                                isCompleted 
                                  ? 'bg-gray-100 text-gray-700 border-gray-300' 
                                  : 'bg-[#e8f5e9] text-[#2e7d32] border-[#a5d6a7]'
                              }`}>
                                {isCompleted ? 'Completed' : 'Open'}
                              </span>
                            </td>
                          </tr>
                        );
                      })
                    ) : (
                      <tr>
                        <td colSpan="11" className="p-8 text-center text-[#999]">
                          No purchase orders found
                        </td>
                      </tr>
                    )}
                  </tbody>
                  </table>
                </div>
              ) : (
                <div className="overflow-x-auto max-h-[500px] border-t border-gray-100">
                  <table className="w-full min-w-[900px] border-collapse text-[13px]">
                    <thead className="bg-gradient-to-r from-[#e8f5e9] to-[#c8e6c9] sticky top-0 z-20">
                      <tr>
                        <th className="p-4 text-left font-bold text-[#2e7d32] border-b-2 border-[#2e7d32]/30">Request Date</th>
                        <th className="p-4 text-left font-bold text-[#2e7d32] border-b-2 border-[#2e7d32]/30">MRS #</th>
                        <th className="p-4 text-left font-bold text-[#2e7d32] border-b-2 border-[#2e7d32]/30">Item Description</th>
                        <th className="p-4 text-left font-bold text-[#2e7d32] border-b-2 border-[#2e7d32]/30">Qty</th>
                        <th className="p-4 text-left font-bold text-[#2e7d32] border-b-2 border-[#2e7d32]/30">Unit</th>
                        <th className="p-4 text-left font-bold text-[#2e7d32] border-b-2 border-[#2e7d32]/30">MRS No.</th>
                        <th className="p-4 text-left font-bold text-[#2e7d32] border-b-2 border-[#2e7d32]/30">Requested By</th>
                        <th className="p-4 text-left font-bold text-[#2e7d32] border-b-2 border-[#2e7d32]/30">Requisitioner</th>
                        <th className="p-4 text-left font-bold text-[#2e7d32] border-b-2 border-[#2e7d32]/30">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredHistoryReqs.length > 0 ? (
                        filteredHistoryReqs.map((req, index) => (
                          <tr key={index} className={`border-b border-gray-200 transition-colors duration-150 ${index % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'} hover:bg-[#f4fbf7]/50 ${req.status === 'Rejected' ? 'cursor-pointer' : ''}`}
                          onClick={() => {
                            if (req.status === 'Rejected') {
                              handleViewRejectedRemarks(req);
                            }
                          }}>
                            <td className="p-4 text-[#333] font-medium">{req.date}</td>
                            <td className="p-4 text-[#333] font-medium">{req.mrsNo}</td>
                            <td className="p-4 text-[#333] font-medium">{req.itemDescription}</td>
                            <td className="p-4 text-[#333] font-medium">{req.qty}</td>
                            <td className="p-4 text-[#333] font-medium">{req.unit}</td>
                            <td className="p-4 text-[#333] font-medium">{req.mrsNo}</td>
                            <td className="p-4 text-[#333] font-medium">{req.requestedBy}</td>
                            <td className="p-4 text-[#333] font-medium">{req.requisitioner}</td>
                            <td className="p-4">
                              <span className={`px-3 py-1 rounded-full text-[11px] font-bold border transition-colors duration-200 ${
                                req.status === 'Approved' 
                                  ? 'bg-[#e8f5e9] text-[#2e7d32] border-[#a5d6a7]' 
                                  : req.status === 'Pending' 
                                  ? 'bg-yellow-50 text-yellow-700 border-yellow-300' 
                                  : 'bg-red-50 text-red-700 border-red-300'
                              }`}>
                                {req.status}
                              </span>
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan="9" className="p-8 text-center text-[#999]">
                            No requests found
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
        {activeMenu === 'users' && (
  <div className="bg-white rounded-lg p-8">
    <h2 className="m-0 text-3xl text-[#333] mb-4">Warehouse Users & Warehouses</h2>
    <div className="flex justify-between items-center max-md:flex-col max-md:items-stretch gap-4 mb-6">
      <div className="flex gap-3">
        <button
          className="bg-white text-[#0288d1] border-2 border-[#7ec8e3] py-2.5 px-5 rounded-md text-sm font-semibold cursor-pointer hover:bg-[#f0f8fc]"
          onClick={() => setShowAddUserModal(true)}
        >
          Add User
        </button>
        <button
          className="bg-white text-[#2e7d32] border-2 border-[#a5d6a7] py-2.5 px-5 rounded-md text-sm font-semibold cursor-pointer hover:bg-[#e8f5e9]"
          onClick={() => setShowAddWarehouseModal(true)}
        >
          Add Warehouse
        </button>
      </div>
      <input
        type="text"
        placeholder="Search user by name..."
        className="w-full max-w-[300px] py-2 px-4 border border-[#e0e0e0] rounded-md text-[13px] placeholder:text-[#999] focus:outline-none focus:border-[#7ec8e3]"
        value={userSearchQuery}
        onChange={(e) => setUserSearchQuery(e.target.value)}
      />
    </div>
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[13px]">
        <thead className="bg-gradient-to-r from-[#e3f2fd] to-[#bbdefb] sticky top-0">
          <tr>
            <th className="p-4 text-left font-bold text-[#1e3c72]">Name</th>
            <th className="p-4 text-left font-bold text-[#1e3c72]">Email</th>
            <th className="p-4 text-left font-bold text-[#1e3c72]">Warehouse</th>
            <th className="p-4 text-left font-bold text-[#1e3c72]">Actions</th>
          </tr>
        </thead>
        <tbody>
          {warehouseUsers
            .filter((u) => u.name.toLowerCase().includes(userSearchQuery.toLowerCase()))
            .map((user) => (
              <tr key={user.id} className="border-b border-gray-200 hover:bg-[#f0f8fc]/50">
                <td className="p-4 text-[#333]">{user.name}</td>
                <td className="p-4 text-[#333]">{user.email}</td>
                <td className="p-4 text-[#333]">{user.warehouse}</td>
                <td className="p-4 flex items-center">
                  <select
                    value={user.warehouse}
                    onChange={(e) => handleAssignWarehouse(user.id, e.target.value)}
                    className="mr-2 p-1 border rounded"
                  >
                    {warehouses.map((w) => (
                      <option key={w} value={w}>{w}</option>
                    ))}
                  </select>
                  <button className="text-[#d32f2f]" onClick={() => handleDeleteUser(user.id)}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          {warehouseUsers.filter((u) => u.name.toLowerCase().includes(userSearchQuery.toLowerCase())).length === 0 && (
            <tr>
              <td colSpan="4" className="p-8 text-center text-[#999]">
                No users found
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>

    {/* Active Warehouses Management */}
    <div className="mt-10 border-t pt-8">
      <h3 className="m-0 text-xl font-bold text-[#1e3c72] mb-4">Active Warehouses List</h3>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
        {warehouses.map((w) => (
          <div key={w} className="flex justify-between items-center bg-[#f0f8fc] border border-[#7ec8e3]/30 p-3.5 rounded-lg hover:shadow-sm transition-shadow">
            <span className="text-sm font-semibold text-[#333]">{w}</span>
            <button
              className="bg-none border-none text-[#d32f2f] hover:text-[#c62828] cursor-pointer text-xs font-semibold"
              onClick={() => handleDeleteWarehouse(w)}
            >
              Delete
            </button>
          </div>
        ))}
      </div>
    </div>

    {/* Add User Modal */}
    {showAddUserModal && (
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-[1000] animate-fade-in">
        <div className="bg-white rounded-xl w-full max-w-[500px] p-6 shadow-[0_10px_30px_rgba(0,0,0,0.15)] animate-slide-in">
          <div className="flex justify-between items-center border-b pb-3 mb-4">
            <h2 className="m-0 text-lg font-bold text-[#333]">Add Warehouse User</h2>
            <button className="bg-none border-none text-2xl cursor-pointer" onClick={() => setShowAddUserModal(false)}>&times;</button>
          </div>
          <div className="flex flex-col gap-4">
            <input
              type="text"
              placeholder="Name"
              value={newUserName}
              onChange={(e) => setNewUserName(e.target.value)}
              className="py-2.5 px-3 border rounded-md"
            />
            <input
              type="email"
              placeholder="Email"
              value={newUserEmail}
              onChange={(e) => setNewUserEmail(e.target.value)}
              className="py-2.5 px-3 border rounded-md"
            />
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500 font-semibold">Assign Warehouse</label>
              <select
                value={newUserWarehouse}
                onChange={(e) => setNewUserWarehouse(e.target.value)}
                className="py-2.5 px-3 border rounded-md"
              >
                {warehouses.map((w) => (
                  <option key={w} value={w}>{w}</option>
                ))}
              </select>
            </div>
            <div className="flex justify-end gap-2">
              <button className="px-4 py-2 bg-gray-200 rounded" onClick={() => setShowAddUserModal(false)}>
                Cancel
              </button>
              <button className="px-4 py-2 bg-[#0288d1] text-white rounded" onClick={handleAddUser}>
                Add User
              </button>
            </div>
          </div>
        </div>
      </div>
    )}

    {/* Add Warehouse Modal */}
    {showAddWarehouseModal && (
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-[1000] animate-fade-in">
        <div className="bg-white rounded-xl w-full max-w-[500px] p-6 shadow-[0_10px_30px_rgba(0,0,0,0.15)] animate-slide-in">
          <div className="flex justify-between items-center border-b pb-3 mb-4">
            <h2 className="m-0 text-lg font-bold text-[#333]">Add New Warehouse</h2>
            <button className="bg-none border-none text-2xl cursor-pointer" onClick={() => setShowAddWarehouseModal(false)}>&times;</button>
          </div>
          <div className="flex flex-col gap-4">
            <input
              type="text"
              placeholder="Warehouse Name (e.g. Davao Warehouse)"
              value={newWarehouseName}
              onChange={(e) => setNewWarehouseName(e.target.value)}
              className="py-2.5 px-3 border rounded-md"
            />
            <div className="flex justify-end gap-2">
              <button className="px-4 py-2 bg-gray-200 rounded" onClick={() => setShowAddWarehouseModal(false)}>
                Cancel
              </button>
              <button className="px-4 py-2 bg-[#2e7d32] text-white rounded" onClick={handleAddWarehouse}>
                Add Warehouse
              </button>
            </div>
          </div>
        </div>
      </div>
    )}
  </div>
)}
        {activeMenu === 'requests' && (
          <div className="bg-white rounded-lg p-6">
            <div className="mb-8">
              <h1 className="m-0 text-3xl max-md:text-2xl text-[#333] font-bold">Requests</h1>
              <p className="mt-2 mx-0 mb-0 text-sm text-[#666]">Pending Requests from Warehouses</p>
            </div>

            <div className="grid grid-cols-[repeat(auto-fit,minmax(250px,1fr))] max-md:grid-cols-1 gap-5 mb-8">
              <div 
                className={`border-2 rounded-xl p-8 text-center cursor-pointer transition-all duration-300 transform ${
                  selectedRequestStatus === 'Pending' 
                    ? 'bg-gradient-to-br from-[#fff8e1] to-[#ffe0b2] border-[#f57f17] shadow-[0_4px_16px_rgba(245,127,23,0.15)] scale-[1.02] -translate-y-1' 
                    : 'bg-white border-[#ffb74d] hover:border-[#f57f17] hover:shadow-[0_4px_12px_rgba(245,127,23,0.12)] shadow-[0_2px_8px_rgba(0,0,0,0.06)]'
                }`}
                onClick={() => setSelectedRequestStatus(selectedRequestStatus === 'Pending' ? '' : 'Pending')}
              >
                <h3 className="m-0 text-sm text-[#666] font-semibold mb-3">Pending</h3>
                <div className="text-5xl font-bold text-[#f57f17]">{pendingRequestsCount.toLocaleString()}</div>
              </div>
              <div 
                className={`border-2 rounded-xl p-8 text-center cursor-pointer transition-all duration-300 transform ${
                  selectedRequestStatus === 'Rejected' 
                    ? 'bg-gradient-to-br from-[#ffebee] to-[#ffcdd2] border-[#c62828] shadow-[0_4px_16px_rgba(198,40,40,0.15)] scale-[1.02] -translate-y-1' 
                    : 'bg-white border-[#ef5350] hover:border-[#c62828] hover:shadow-[0_4px_12px_rgba(198,40,40,0.12)] shadow-[0_2px_8px_rgba(0,0,0,0.06)]'
                }`}
                onClick={() => setSelectedRequestStatus(selectedRequestStatus === 'Rejected' ? '' : 'Rejected')}
              >
                <h3 className="m-0 text-sm text-[#666] font-semibold mb-3">Rejected</h3>
                <div className="text-5xl font-bold text-[#c62828]">{rejectedRequestsCount.toLocaleString()}</div>
              </div>
            </div>

            <div className="mt-8">
              <div className="mb-4">
                <h2 className="m-0 text-lg text-[#333] font-bold">
                  {selectedRequestStatus === 'Pending' ? 'Pending Requests' : selectedRequestStatus === 'Rejected' ? 'Rejected Requests' : 'All Requests'}
                </h2>
                <p className="mt-1 mx-0 mb-0 text-[13px] text-[#999]">
                  {selectedRequestStatus === 'Pending' ? 'Warehouse requests awaiting approval' : selectedRequestStatus === 'Rejected' ? 'Rejected warehouse requests' : 'All warehouse requests'}
                </p>
              </div>
              <input 
                type="text" 
                placeholder="Search MRS #..." 
                className="w-full max-w-[300px] py-2.5 px-4 border border-[#e0e0e0] rounded-md text-[13px] mb-4 placeholder:text-[#999] focus:outline-none focus:border-[#7ec8e3] focus:ring-2 focus:ring-[#7ec8e3]/10" 
                value={requestsSearchQuery}
                onChange={(e) => setRequestsSearchQuery(e.target.value)}
              />
              <div className="overflow-x-auto overflow-y-auto max-h-[500px] border border-[#e0e0e0] rounded-lg">
                <table className="w-full min-w-[900px] border-collapse text-[13px]">
                  <thead>
                    <tr className="bg-gradient-to-r from-[#fff8e1] to-[#ffe0b2]">
                      <th className="p-4 text-left font-bold text-[#f57f17] border-b-2 border-[#f57f17]/30 sticky top-0 z-10">R date</th>
                      <th className="p-4 text-left font-bold text-[#f57f17] border-b-2 border-[#f57f17]/30 sticky top-0 z-10">MRS #</th>
                      <th className="p-4 text-left font-bold text-[#f57f17] border-b-2 border-[#f57f17]/30 sticky top-0 z-10">Item Description</th>
                      <th className="p-4 text-left font-bold text-[#f57f17] border-b-2 border-[#f57f17]/30 sticky top-0 z-10">Qty</th>
                      <th className="p-4 text-left font-bold text-[#f57f17] border-b-2 border-[#f57f17]/30 sticky top-0 z-10">Unit</th>
                      <th className="p-4 text-left font-bold text-[#f57f17] border-b-2 border-[#f57f17]/30 sticky top-0 z-10">Approved by</th>
                      <th className="p-4 text-left font-bold text-[#f57f17] border-b-2 border-[#f57f17]/30 sticky top-0 z-10">Requisitioner</th>
                      <th className="p-4 text-left font-bold text-[#f57f17] border-b-2 border-[#f57f17]/30 sticky top-0 z-10">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRequests.length > 0 ? (
                      filteredRequests.map((req, index) => (
                        <tr key={index} className={`border-b border-gray-200 transition-colors duration-150 cursor-pointer ${
                          req.status === 'Approved' ? 'bg-[#e8f5e9]' : req.status === 'Pending' ? 'bg-[#fff9e6]' : 'bg-[#ffebee]'
                        } hover:bg-[#f0f8fc]/50`}
                        onClick={() => {
                          if (req.status === 'Rejected') {
                            handleViewRejectedRemarks(req);
                          } else if (req.status === 'Pending') {
                            handleOpenRequestDetails(req);
                          }
                        }}>
                          <td className="p-4 text-[#333] font-medium">{req.date}</td>
                          <td className="p-4 text-[#333] font-medium">{req.mrsNo}</td>
                          <td className="p-4 text-[#333] font-medium">{req.itemDescription}</td>
                          <td className="p-4 text-[#333] font-medium">{req.qty}</td>
                          <td className="p-4 text-[#333] font-medium">{req.unit}</td>
                          <td className="p-4 text-[#333] font-medium">{req.requestedBy}</td>
                          <td className="p-4 text-[#333] font-medium">{req.requisitioner}</td>
                          <td className="p-4">
                            <span className={`px-3 py-1 rounded-full text-[11px] font-bold border transition-colors duration-200 ${
                              req.status === 'Approved' 
                                ? 'bg-[#e8f5e9] text-[#2e7d32] border-[#a5d6a7]' 
                                : req.status === 'Pending' 
                                ? 'bg-[#fff9e6] text-[#f57f17] border-[#ffb74d]' 
                                : 'bg-[#ffebee] text-[#c62828] border-[#ef5350]'
                            }`}>
                              {req.status}
                            </span>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan="8" className="p-8 text-center text-[#999]">
                          No requests found
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* PO Creation Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-[1000] animate-fade-in">
          <div className="bg-white rounded-xl w-full max-w-[580px] max-h-[90vh] overflow-y-auto shadow-[0_10px_30px_rgba(0,0,0,0.15)] animate-slide-in p-6">
            <div className="flex justify-between items-center border-b border-[#eee] pb-3 mb-5">
              <h2 className="m-0 text-sm font-bold text-[#333] tracking-wide">PURCHASE ORDER FORM</h2>
              <button className="bg-none border-none text-2xl cursor-pointer text-[#888] hover:text-[#333] transition-colors duration-200 p-1 leading-none" onClick={handleCloseModal}>&times;</button>
            </div>
            
            <form onSubmit={handleSavePurchaseOrder} className="flex flex-col gap-4">
              {/* LISTED BY at the top */}
              <div className="flex flex-col gap-1.5 text-left w-full">
                <label className="text-[11px] font-bold text-[#444]">LISTED BY (PURCHASER) <span className="text-[#d32f2f] ml-0.5">*</span></label>
                <input 
                  type="text" 
                  value={formListedBy} 
                  onChange={(e) => setFormListedBy(e.target.value)} 
                  placeholder="Enter purchaser email"
                  required
                  className="py-2.5 px-3 border border-[#ccc] rounded-md text-[13px] text-[#333] bg-white transition-all duration-200 w-full box-border focus:outline-none focus:border-[#0288d1] focus:ring-2 focus:ring-[#0288d1]/10 placeholder:text-[#bbb]"
                />
              </div>

              <div className="flex gap-4 w-full">
                <div className="flex flex-col gap-1.5 text-left flex-1 w-1/2">
                  <label className="text-[11px] font-bold text-[#444]">PO NUMBER <span className="text-[#d32f2f] ml-0.5">*</span></label>
                  <input 
                    type="text" 
                    value={formPoNumber} 
                    onChange={(e) => setFormPoNumber(e.target.value)} 
                    placeholder="Enter PO number"
                    required
                    className="py-2.5 px-3 border border-[#ccc] rounded-md text-[13px] text-[#333] bg-white transition-all duration-200 w-full box-border focus:outline-none focus:border-[#0288d1] focus:ring-2 focus:ring-[#0288d1]/10 placeholder:text-[#bbb]"
                  />
                </div>
                <div className="flex flex-col gap-1.5 text-left flex-1 w-1/2">
                  <label className="text-[11px] font-bold text-[#444]">DATE <span className="text-[#d32f2f] ml-0.5">*</span></label>
                  <input 
                    type="text" 
                    value={formPoDate} 
                    onChange={(e) => setFormPoDate(e.target.value)} 
                    placeholder="MM/DD/YY"
                    required
                    className="py-2.5 px-3 border border-[#ccc] rounded-md text-[13px] text-[#333] bg-white transition-all duration-200 w-full box-border focus:outline-none focus:border-[#0288d1] focus:ring-2 focus:ring-[#0288d1]/10 placeholder:text-[#bbb]"
                  />
                </div>
              </div>

              <div className="text-[11px] font-bold text-[#888] tracking-widest mt-3 mb-1 border-b border-[#f0f0f0] pb-1 uppercase text-left">ITEM DETAILS</div>
              
              <div className="flex gap-4 w-full">
                <div className="flex flex-col gap-1.5 text-left flex-[2]">
                  <label className="text-[11px] font-bold text-[#444]">ITEM DESCRIPTION <span className="text-[#d32f2f] ml-0.5">*</span></label>
                  <input 
                    type="text" 
                    value={formItemDescription} 
                    onChange={(e) => setFormItemDescription(e.target.value)} 
                    placeholder="Enter description"
                    required
                    className="py-2.5 px-3 border border-[#ccc] rounded-md text-[13px] text-[#333] bg-white transition-all duration-200 w-full box-border focus:outline-none focus:border-[#0288d1] focus:ring-2 focus:ring-[#0288d1]/10 placeholder:text-[#bbb]"
                  />
                </div>
                <div className="flex flex-col gap-1.5 text-left flex-[0.8]">
                  <label className="text-[11px] font-bold text-[#444]">QTY <span className="text-[#d32f2f] ml-0.5">*</span></label>
                  <input 
                    type="number" 
                    value={formQty} 
                    onChange={(e) => setFormQty(e.target.value)} 
                    placeholder="0"
                    required
                    className="py-2.5 px-3 border border-[#ccc] rounded-md text-[13px] text-[#333] bg-white transition-all duration-200 w-full box-border focus:outline-none focus:border-[#0288d1] focus:ring-2 focus:ring-[#0288d1]/10 placeholder:text-[#bbb]"
                  />
                </div>
                <div className="flex flex-col gap-1.5 text-left flex-[1]">
                  <label className="text-[11px] font-bold text-[#444]">UNIT <span className="text-[#d32f2f] ml-0.5">*</span></label>
                  <select 
                    value={formUnit} 
                    onChange={(e) => setFormUnit(e.target.value)}
                    required
                    className="py-2.5 px-3 border border-[#ccc] rounded-md text-[13px] text-[#333] bg-white transition-all duration-200 w-full box-border focus:outline-none focus:border-[#0288d1] focus:ring-2 focus:ring-[#0288d1]/10"
                  >
                    <option value="pcs">pcs</option>
                    <option value="bags">bags</option>
                    <option value="rolls">rolls</option>
                    <option value="sets">sets</option>
                    <option value="boxes">boxes</option>
                  </select>
                </div>
              </div>

              <div className="flex flex-col gap-1.5 text-left w-full">
                <label className="text-[11px] font-bold text-[#444]">ITEM NOTES (optional)</label>
                <input 
                  type="text" 
                  value={formNotes} 
                  onChange={(e) => setFormNotes(e.target.value)} 
                  placeholder="Enter notes"
                  className="py-2.5 px-3 border border-[#ccc] rounded-md text-[13px] text-[#333] bg-white transition-all duration-200 w-full box-border focus:outline-none focus:border-[#0288d1] focus:ring-2 focus:ring-[#0288d1]/10 placeholder:text-[#bbb]"
                />
              </div>

              <div className="text-[11px] font-bold text-[#888] tracking-widest mt-3 mb-1 border-b border-[#f0f0f0] pb-1 uppercase text-left">APPROVAL & PICK UP</div>
              
              <div className="flex gap-4 w-full">
                <div className="flex flex-col gap-1.5 text-left flex-1 w-1/2">
                  <label className="text-[11px] font-bold text-[#444]">APPROVED BY (WAREHOUSE) <span className="text-[#d32f2f] ml-0.5">*</span></label>
                  <input 
                    type="text" 
                    value={formApprovedBy} 
                    onChange={(e) => setFormApprovedBy(e.target.value)} 
                    placeholder="Enter name"
                    required
                    className="py-2.5 px-3 border border-[#ccc] rounded-md text-[13px] text-[#333] bg-white transition-all duration-200 w-full box-border focus:outline-none focus:border-[#0288d1] focus:ring-2 focus:ring-[#0288d1]/10 placeholder:text-[#bbb]"
                  />
                </div>
                <div className="flex flex-col gap-1.5 text-left flex-1 w-1/2">
                  <label className="text-[11px] font-bold text-[#444]">DATE <span className="text-[#d32f2f] ml-0.5">*</span></label>
                  <input 
                    type="text" 
                    value={formApprovalDate} 
                    onChange={(e) => setFormApprovalDate(e.target.value)} 
                    placeholder="MM/DD/YYYY"
                    required
                    className="py-2.5 px-3 border border-[#ccc] rounded-md text-[13px] text-[#333] bg-white transition-all duration-200 w-full box-border focus:outline-none focus:border-[#0288d1] focus:ring-2 focus:ring-[#0288d1]/10 placeholder:text-[#bbb]"
                  />
                </div>
              </div>

              <div className="flex gap-4 w-full">
                <div className="flex flex-col gap-1.5 text-left flex-1 w-1/2">
                  <label className="text-[11px] font-bold text-[#444]">REQUISITIONER <span className="text-[#d32f2f] ml-0.5">*</span></label>
                  <input 
                    type="text" 
                    value={formRequisitioner} 
                    onChange={(e) => setFormRequisitioner(e.target.value)} 
                    placeholder="Enter name"
                    required
                    className="py-2.5 px-3 border border-[#ccc] rounded-md text-[13px] text-[#333] bg-white transition-all duration-200 w-full box-border focus:outline-none focus:border-[#0288d1] focus:ring-2 focus:ring-[#0288d1]/10 placeholder:text-[#bbb]"
                  />
                </div>
                <div className="flex flex-col gap-1.5 text-left flex-1 w-1/2">
                  <label className="text-[11px] font-bold text-[#444]">MRS # <span className="text-[#d32f2f] ml-0.5">*</span></label>
                  <input 
                    type="text" 
                    value={formMrsNo} 
                    onChange={(e) => setFormMrsNo(e.target.value)} 
                    placeholder="00000"
                    required
                    className="py-2.5 px-3 border border-[#ccc] rounded-md text-[13px] text-[#333] bg-white transition-all duration-200 w-full box-border focus:outline-none focus:border-[#0288d1] focus:ring-2 focus:ring-[#0288d1]/10 placeholder:text-[#bbb]"
                  />
                </div>
              </div>

              <div className="flex gap-4 w-full">
                <div className="flex flex-col gap-1.5 text-left flex-1 w-1/2">
                  <label className="text-[11px] font-bold text-[#444]">PICK UP BY <span className="text-[#d32f2f] ml-0.5">*</span></label>
                  <input 
                    type="text" 
                    value={formPickupBy} 
                    onChange={(e) => setFormPickupBy(e.target.value)} 
                    placeholder="Enter name"
                    required
                    className="py-2.5 px-3 border border-[#ccc] rounded-md text-[13px] text-[#333] bg-white transition-all duration-200 w-full box-border focus:outline-none focus:border-[#0288d1] focus:ring-2 focus:ring-[#0288d1]/10 placeholder:text-[#bbb]"
                  />
                </div>
                <div className="flex flex-col gap-1.5 text-left flex-1 w-1/2">
                  <label className="text-[11px] font-bold text-[#444]">PLATE NUMBER <span className="text-[#d32f2f] ml-0.5">*</span></label>
                  <input 
                    type="text" 
                    value={formPlateNumber} 
                    onChange={(e) => setFormPlateNumber(e.target.value)} 
                    placeholder="Enter plate number"
                    required
                    className="py-2.5 px-3 border border-[#ccc] rounded-md text-[13px] text-[#333] bg-white transition-all duration-200 w-full box-border focus:outline-none focus:border-[#0288d1] focus:ring-2 focus:ring-[#0288d1]/10 placeholder:text-[#bbb]"
                  />
                </div>
              </div>

              <div className="text-[11px] font-bold text-[#888] tracking-widest mt-3 mb-1 border-b border-[#f0f0f0] pb-1 uppercase text-left">SUPPLIER INFO</div>
              
              <div className="flex gap-4 w-full">
                <div className="flex flex-col gap-1.5 text-left flex-1 w-1/2">
                  <label className="text-[11px] font-bold text-[#444]">SUPPLIER NAME <span className="text-[#d32f2f] ml-0.5">*</span></label>
                  <input 
                    type="text" 
                    value={formSupplierName} 
                    onChange={(e) => setFormSupplierName(e.target.value)} 
                    placeholder="Enter name"
                    required
                    className="py-2.5 px-3 border border-[#ccc] rounded-md text-[13px] text-[#333] bg-white transition-all duration-200 w-full box-border focus:outline-none focus:border-[#0288d1] focus:ring-2 focus:ring-[#0288d1]/10 placeholder:text-[#bbb]"
                  />
                </div>
                <div className="flex flex-col gap-1.5 text-left flex-1 w-1/2">
                  <label className="text-[11px] font-bold text-[#444]">ADDRESS <span className="text-[#d32f2f] ml-0.5">*</span></label>
                  <input 
                    type="text" 
                    value={formSupplierAddress} 
                    onChange={(e) => setFormSupplierAddress(e.target.value)} 
                    placeholder="Enter address"
                    required
                    className="py-2.5 px-3 border border-[#ccc] rounded-md text-[13px] text-[#333] bg-white transition-all duration-200 w-full box-border focus:outline-none focus:border-[#0288d1] focus:ring-2 focus:ring-[#0288d1]/10 placeholder:text-[#bbb]"
                  />
                </div>
              </div>

              <div className="flex justify-center gap-4 mt-6 pt-4 border-t border-[#eee]">
                <button type="button" className="py-2.5 px-6 rounded-md text-sm font-semibold cursor-pointer transition-all duration-200 min-w-[120px] bg-white text-[#d32f2f] border border-[#d32f2f] hover:bg-[#fff5f5] hover:shadow-[0_2px_6px_rgba(211,47,47,0.1)]" onClick={handleCloseModal}>Cancel</button>
                <button type="submit" className="py-2.5 px-6 rounded-md text-sm font-semibold cursor-pointer transition-all duration-200 min-w-[120px] bg-[#006680] text-white border-none hover:bg-[#004d60] hover:shadow-[0_2px_8px_rgba(0,102,128,0.2)]">Save</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Success Notification Modal */}
      {showSuccessModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-[1000] animate-fade-in">
          <div className="bg-white rounded-xl w-full max-w-[380px] text-center py-8 px-6 shadow-[0_10px_30px_rgba(0,0,0,0.15)] animate-slide-in">
            <div className="flex flex-col items-center gap-3">
              <div className="bg-[#e8f5e9] text-[#2e7d32] text-3xl w-16 h-16 rounded-full flex items-center justify-center mb-3 border-2 border-[#a5d6a7] font-bold">✓</div>
              <h3 className="m-0 text-lg text-[#333] font-bold">Successfully Added</h3>
              <p className="m-0 text-[13px] text-[#666] leading-relaxed mb-4">The purchase order has been successfully added to Active Delivery.</p>
              <button className="bg-[#2e7d32] text-white border-none py-2.5 px-8 rounded-md text-sm font-semibold cursor-pointer transition-all duration-200 min-w-[100px] hover:bg-[#1b5e20] hover:shadow-[0_2px_8px_rgba(46,125,50,0.3)] hover:-translate-y-0.5" onClick={() => setShowSuccessModal(false)}>
                OK
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Request Details Modal */}
      {showRequestDetailsModal && selectedRequest && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-[1000] animate-fade-in">
          <div className="bg-white rounded-xl w-full max-w-[500px] shadow-[0_10px_30px_rgba(0,0,0,0.15)] animate-slide-in p-6">
            <div className="flex justify-between items-center border-b border-[#eee] pb-3 mb-5">
              <h2 className="m-0 text-lg font-bold text-[#333] tracking-wide">Request Details: {selectedRequest.requisitioner}</h2>
              <button className="bg-none border-none text-2xl cursor-pointer text-[#888] hover:text-[#333] transition-colors duration-200 p-1 leading-none" onClick={handleCloseRequestDetailsModal}>&times;</button>
            </div>
            
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-3 gap-4">
                <div className="flex flex-col gap-1.5 text-left col-span-2">
                  <label className="text-[11px] font-bold text-[#666]">ITEM DESCRIPTION</label>
                  <input 
                    type="text" 
                    value={selectedRequest.itemDescription}
                    disabled
                    className="py-2.5 px-3 border border-[#ccc] rounded-md text-[13px] text-[#333] bg-[#f5f5f5] transition-all duration-200 w-full box-border"
                  />
                </div>
                <div className="flex flex-col gap-1.5 text-left">
                  <label className="text-[11px] font-bold text-[#666]">QTY</label>
                  <input 
                    type="text" 
                    value={selectedRequest.qty}
                    disabled
                    className="py-2.5 px-3 border border-[#ccc] rounded-md text-[13px] text-[#333] bg-[#f5f5f5] transition-all duration-200 w-full box-border"
                  />
                </div>
              </div>

              <div className="flex gap-4">
                <div className="flex flex-col gap-1.5 text-left flex-1">
                  <label className="text-[11px] font-bold text-[#666]">UNIT</label>
                  <input 
                    type="text" 
                    value={selectedRequest.unit}
                    disabled
                    className="py-2.5 px-3 border border-[#ccc] rounded-md text-[13px] text-[#333] bg-[#f5f5f5] transition-all duration-200 w-full box-border"
                  />
                </div>
              </div>

              <div className="flex gap-4">
                <div className="flex flex-col gap-1.5 text-left flex-1">
                  <label className="text-[11px] font-bold text-[#666]">APPROVED BY(WAREHOUSE)</label>
                  <input 
                    type="text" 
                    value={selectedRequest.requestedBy}
                    disabled
                    className="py-2.5 px-3 border border-[#ccc] rounded-md text-[13px] text-[#333] bg-[#f5f5f5] transition-all duration-200 w-full box-border"
                  />
                </div>
                <div className="flex flex-col gap-1.5 text-left flex-1">
                  <label className="text-[11px] font-bold text-[#666]">DATE</label>
                  <input 
                    type="text" 
                    value={selectedRequest.date}
                    disabled
                    className="py-2.5 px-3 border border-[#ccc] rounded-md text-[13px] text-[#333] bg-[#f5f5f5] transition-all duration-200 w-full box-border"
                  />
                </div>
              </div>

              <div className="flex flex-col gap-1.5 text-left">
                <label className="text-[11px] font-bold text-[#666]">REQUISITIONER (OPTIONAL)</label>
                <input 
                  type="text" 
                  value={selectedRequest.requisitioner}
                  disabled
                  className="py-2.5 px-3 border border-[#ccc] rounded-md text-[13px] text-[#333] bg-[#f5f5f5] transition-all duration-200 w-full box-border"
                />
              </div>

              {isDeclineMode && (
                <div className="flex flex-col gap-1.5 text-left">
                  <label className="text-[11px] font-bold text-[#444]">REMARKS <span className="text-[#d32f2f] ml-0.5">*</span></label>
                  <textarea 
                    value={declineRemarks}
                    onChange={(e) => setDeclineRemarks(e.target.value)}
                    placeholder="Enter reason for declining this request"
                    className="py-2.5 px-3 border border-[#ccc] rounded-md text-[13px] text-[#333] bg-white transition-all duration-200 w-full box-border focus:outline-none focus:border-[#0288d1] focus:ring-2 focus:ring-[#0288d1]/10 placeholder:text-[#bbb] resize-none h-[100px]"
                  />
                </div>
              )}

              <div className="flex justify-center gap-4 mt-6 pt-4 border-t border-[#eee]">
                {!isDeclineMode ? (
                  <>
                    <button type="button" className="py-2.5 px-6 rounded-md text-sm font-semibold cursor-pointer transition-all duration-200 min-w-[120px] bg-white text-[#d32f2f] border border-[#d32f2f] hover:bg-[#fff5f5] hover:shadow-[0_2px_6px_rgba(211,47,47,0.1)]" onClick={handleDeclineClick}>Decline</button>
                    <button type="button" className="py-2.5 px-6 rounded-md text-sm font-semibold cursor-pointer transition-all duration-200 min-w-[120px] bg-[#006680] text-white border-none hover:bg-[#004d60] hover:shadow-[0_2px_8px_rgba(0,102,128,0.2)]" onClick={handleProceedPO}>Proceed PO</button>
                  </>
                ) : (
                  <>
                    <button type="button" className="py-2.5 px-6 rounded-md text-sm font-semibold cursor-pointer transition-all duration-200 min-w-[120px] bg-white text-[#333] border border-[#ccc] hover:bg-[#f5f5f5] hover:shadow-[0_2px_6px_rgba(0,0,0,0.08)]" onClick={() => {setIsDeclineMode(false); setDeclineRemarks('');}}>Back</button>
                    <button type="button" className="py-2.5 px-6 rounded-md text-sm font-semibold cursor-pointer transition-all duration-200 min-w-[120px] bg-[#d32f2f] text-white border-none hover:bg-[#b71c1c] hover:shadow-[0_2px_8px_rgba(211,47,47,0.3)]" onClick={handleSubmitDecline}>Submit</button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Remarks Modal */}
      {showRemarksModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-[1000] animate-fade-in">
          <div className="bg-white rounded-xl w-full max-w-[400px] shadow-[0_10px_30px_rgba(0,0,0,0.15)] animate-slide-in p-6">
            <div className="flex justify-between items-center border-b border-[#eee] pb-3 mb-5">
              <h2 className="m-0 text-lg font-bold text-[#333] tracking-wide">Rejection Remarks</h2>
              <button className="bg-none border-none text-2xl cursor-pointer text-[#888] hover:text-[#333] transition-colors duration-200 p-1 leading-none" onClick={handleCloseRemarksModal}>&times;</button>
            </div>
            
            <div className="flex flex-col gap-4">
              <div className="bg-[#fef5f5] border border-[#ffcdd2] rounded-lg p-4">
                <p className="m-0 text-[13px] text-[#333] leading-relaxed whitespace-pre-wrap">{remarksToDisplay}</p>
              </div>
              
              <button type="button" className="py-2.5 px-6 rounded-md text-sm font-semibold cursor-pointer transition-all duration-200 bg-[#d32f2f] text-white border-none hover:bg-[#b71c1c] hover:shadow-[0_2px_8px_rgba(211,47,47,0.3)]" onClick={handleCloseRemarksModal}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Material Request Receipt Modal */}
      {showReceiptModal && selectedReceiptPo && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[1050] animate-fade-in overflow-y-auto py-10 px-4">
          <div className="bg-white rounded-xl w-full max-w-[500px] shadow-[0_10px_40px_rgba(0,0,0,0.2)] animate-slide-in p-8 text-[#333] border border-gray-200 font-sans relative">
            
            {/* Close Button top-right */}
            <button 
              className="absolute top-4 right-4 bg-none border-none text-2xl cursor-pointer text-[#888] hover:text-[#333] transition-colors duration-200 p-1 leading-none no-print" 
              onClick={handleCloseReceiptModal}
            >
              &times;
            </button>

            {/* Receipt Content container */}
            <div className="text-center mb-5">
              <h2 className="m-0 text-lg font-extrabold tracking-wider text-[#1e2d3b] uppercase">CARWILL CONSTRUCTION INC.</h2>
              <p className="m-0 text-[11px] text-[#777] mt-1 font-medium">123 Business Street, Davao City | Tel: (082) 000-0000</p>
            </div>

            {/* Dark Title Bar */}
            <div className="bg-[#1e2d3b] text-white text-center py-2 px-4 font-bold text-[12px] tracking-widest uppercase mb-4 rounded-sm">
              MATERIAL REQUEST RECEIPT
            </div>

            {/* Header Metadata */}
            <div className="flex justify-between items-center text-xs font-bold border-b border-gray-200 pb-2 mb-4">
              <span className="font-mono text-[#444]">{selectedReceiptPo.poNumber || 'PO-REQ-001'}</span>
              <span className="text-[#0288d1] flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-[#0288d1] inline-block"></span>
                {selectedReceiptPo.status === 'completed' ? 'Completed' : 'New Request'}
              </span>
            </div>

            {/* Info Grid */}
            <div className="flex flex-col gap-4 text-[12px]">
              
              {/* Request Info */}
              <div className="flex flex-col gap-1.5">
                <h3 className="m-0 text-[10px] font-bold text-[#999] tracking-widest uppercase text-left border-b border-dashed border-gray-200 pb-0.5">REQUEST INFO</h3>
                <div className="flex justify-between">
                  <span className="text-[#777]">MRS no.</span>
                  <span className="font-mono font-semibold bg-gray-100 px-1.5 py-0.5 rounded text-[11px]">{selectedReceiptPo.mrsNo || 'MRS-001-2026'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#777]">Request date</span>
                  <span className="font-semibold">{selectedReceiptPo.date}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#777]">Submitted</span>
                  <span className="font-semibold text-gray-600">{selectedReceiptPo.date} at 8:16 AM</span>
                </div>
                {selectedReceiptPo.listedBy && (
                  <div className="flex justify-between">
                    <span className="text-[#777]">Listed by (Purchaser)</span>
                    <span className="font-semibold">{selectedReceiptPo.listedBy}</span>
                  </div>
                )}
              </div>

              {/* Supplier Info */}
              <div className="flex flex-col gap-1.5">
                <h3 className="m-0 text-[10px] font-bold text-[#999] tracking-widest uppercase text-left border-b border-dashed border-gray-200 pb-0.5">SUPPLIER</h3>
                <div className="flex justify-between">
                  <span className="text-[#777]">Name</span>
                  <span className="font-semibold">{selectedReceiptPo.supplier || 'N/A'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#777]">Address</span>
                  <span className="font-semibold">{selectedReceiptPo.supplierAddress || 'Davao City'}</span>
                </div>
              </div>

              {/* Requested By Info */}
              <div className="flex flex-col gap-1.5">
                <h3 className="m-0 text-[10px] font-bold text-[#999] tracking-widest uppercase text-left border-b border-dashed border-gray-200 pb-0.5">REQUESTED BY & TRANSPORT</h3>
                <div className="flex justify-between">
                  <span className="text-[#777]">Requisitioner</span>
                  <span className="font-semibold">{selectedReceiptPo.requisitioner || 'N/A'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#777]">Approved by (Site Engineer)</span>
                  <span className="font-semibold">{selectedReceiptPo.approvedBy || 'Approved by Warehouse'}</span>
                </div>
                {selectedReceiptPo.poExpDate && (
                  <div className="flex justify-between">
                    <span className="text-[#777]">Approval/Exp Date</span>
                    <span className="font-semibold">{selectedReceiptPo.poExpDate}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-[#777]">Picked up by</span>
                  <span className="font-semibold">{selectedReceiptPo.pickupBy || 'N/A'}</span>
                </div>
                {selectedReceiptPo.plateNumber && (
                  <div className="flex justify-between">
                    <span className="text-[#777]">Plate Number</span>
                    <span className="font-semibold uppercase">{selectedReceiptPo.plateNumber}</span>
                  </div>
                )}
              </div>

              {/* Items Section */}
              <div className="flex flex-col gap-2 mt-1">
                <h3 className="m-0 text-[10px] font-bold text-[#999] tracking-widest uppercase text-left border-b border-dashed border-gray-200 pb-0.5">ITEMS</h3>
                <div className="flex justify-between font-bold text-[10px] text-gray-500 uppercase">
                  <span># DESCRIPTION</span>
                  <span>QTY</span>
                </div>
                <div className="flex justify-between items-start pt-1">
                  <div className="text-left">
                    <div className="font-bold text-[#333]">1 {selectedReceiptPo.itemDescription}</div>
                    <div className="text-[10px] text-gray-400 font-medium">Construction Materials</div>
                    {selectedReceiptPo.notes && (
                      <div className="text-[10px] text-gray-400 italic">Note: {selectedReceiptPo.notes}</div>
                    )}
                  </div>
                  <div className="text-right">
                    <span className="font-bold text-[#333] block">{selectedReceiptPo.qty} {selectedReceiptPo.unit}</span>
                    <span className={`inline-block px-2.5 py-0.5 rounded-md text-[9px] font-bold mt-1.5 uppercase ${
                      selectedReceiptPo.status === 'completed' 
                        ? 'bg-[#e8f5e9] text-[#2e7d32]' 
                        : 'bg-[#fff9e6] text-[#f57f17]'
                    }`}>
                      {selectedReceiptPo.status === 'completed' ? 'Completed' : 'Pending'}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Signature Block */}
            <div className="grid grid-cols-2 gap-8 mt-8 pt-6 border-t border-gray-200 text-center">
              <div>
                <div className="border-b border-gray-400 pb-1 font-semibold text-[13px] text-[#333] font-mono min-h-[20px]">
                  {selectedReceiptPo.pickupBy || 'N/A'}
                </div>
                <div className="text-[10px] font-extrabold text-[#777] tracking-wider uppercase mt-1">PICKED UP BY</div>
              </div>
              <div>
                <div className="border-b border-gray-400 pb-1 font-semibold text-[13px] text-[#333] font-mono min-h-[20px]">
                  {selectedReceiptPo.approvedBy || 'Approved by Warehouse'}
                </div>
                <div className="text-[10px] font-extrabold text-[#777] tracking-wider uppercase mt-1">APPROVED BY</div>
              </div>
            </div>

            {/* Bottom expanded completed monitoring details */}
            {selectedReceiptPo.status === 'completed' && (
              <div className="mt-6 pt-6 border-t border-dashed border-gray-300">
                <h3 className="m-0 text-[10px] font-extrabold text-[#777] tracking-widest uppercase mb-3 text-left">MONITORING DETAILS</h3>
                <div className="grid grid-cols-2 gap-x-4 gap-y-3.5 text-left bg-gray-50 border border-gray-200 rounded-lg p-4 text-[11px] leading-tight">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[#888] font-bold text-[9px] uppercase">PO number:</span>
                    <span className="text-[#333] font-semibold">{selectedReceiptPo.poNumber}</span>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[#888] font-bold text-[9px] uppercase">Pick-up date:</span>
                    <span className="text-[#333] font-semibold">{selectedReceiptPo.date}</span>
                  </div>
                  <div className="col-span-2 flex flex-col gap-0.5">
                    <span className="text-[#888] font-bold text-[9px] uppercase">Item Description:</span>
                    <span className="text-[#333] font-semibold">{selectedReceiptPo.itemDescription}</span>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[#888] font-bold text-[9px] uppercase">Qty. rvd:</span>
                    <span className="text-[#333] font-semibold">{selectedReceiptPo.qty}</span>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[#888] font-bold text-[9px] uppercase">Unit:</span>
                    <span className="text-[#333] font-semibold">{selectedReceiptPo.unit}</span>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[#888] font-bold text-[9px] uppercase">Delivered By:</span>
                    <span className="text-[#333] font-semibold">{selectedReceiptPo.pickupBy || 'Warehouse Staff'}</span>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[#888] font-bold text-[9px] uppercase">Date delivered:</span>
                    <span className="text-[#333] font-semibold">{selectedReceiptPo.poExpDate || selectedReceiptPo.date}</span>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[#888] font-bold text-[9px] uppercase">Reference No.</span>
                    <span className="text-[#333] font-semibold">DR-{selectedReceiptPo.poNumber}</span>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[#888] font-bold text-[9px] uppercase">DR date:</span>
                    <span className="text-[#333] font-semibold">{selectedReceiptPo.date}</span>
                  </div>
                  <div className="col-span-2 flex flex-col gap-0.5 border-t border-gray-200/60 pt-2 mt-1">
                    <span className="text-[#888] font-bold text-[9px] uppercase">Pick-up By:</span>
                    <span className="text-[#333] font-semibold">{selectedReceiptPo.pickupBy}</span>
                  </div>
                </div>
              </div>
            )}

            {/* Footer Text */}
            <div className="text-center mt-6 text-[10px] text-gray-400 font-bold uppercase tracking-wider">
              CARWILL CONSTRUCTION INC. • {selectedReceiptPo.mrsNo || 'MRS-001'} • {selectedReceiptPo.poNumber || 'PO-001'}
            </div>

            {/* Modal Controls (No Print) */}
            <div className="flex justify-center gap-3 mt-6 pt-4 border-t border-gray-100 no-print">
              <button 
                type="button" 
                className="py-2.5 px-6 rounded-md text-xs font-bold cursor-pointer transition-all duration-200 bg-white text-[#555] border border-gray-300 hover:bg-gray-50 flex-1"
                onClick={handleCloseReceiptModal}
              >
                Close
              </button>
              <button 
                type="button" 
                className="py-2.5 px-6 rounded-md text-xs font-bold cursor-pointer transition-all duration-200 bg-[#1e2d3b] text-white border-none hover:bg-[#2c3e50] flex-1 flex items-center justify-center gap-1.5"
                onClick={() => window.print()}
              >
                Print Receipt
              </button>
            </div>

          </div>
        </div>
      )}
    </div>
  );
}

export default AdminDashboard;
