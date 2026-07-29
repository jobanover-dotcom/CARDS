'use client';
import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { getPOs, getPOStats, createPO as createPOServer, updatePO as updatePOServer } from '../../actions/pos';
import { getRequests, approveRequest, declineRequest, approveRequestsByMrsNo } from '../../actions/requests';
import { getUsers, addUser as addUserServer, deleteUser as deleteUserServer, updateUserWarehouse } from '../../actions/users';
import { getWarehouses, addWarehouse as addWarehouseServer, deleteWarehouse as deleteWarehouseServer } from '../../actions/warehouses';

const AdminDataContext = createContext(null);

export function AdminDataProvider({ children }) {
  const [purchaseOrders, setPurchaseOrders] = useState([]);
  const [warehouseRequests, setWarehouseRequests] = useState([]);
  const [warehouseUsers, setWarehouseUsers] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [loading, setLoading] = useState(true);

  const [totalPOs, setTotalPOs] = useState(0);
  const [completedPOs, setCompletedPOs] = useState(0);
  const [incompletePOs, setIncompletePOs] = useState(0);
  const [activeDeliveryCount, setActiveDeliveryCount] = useState(0);
  const [discrepancyCount, setDiscrepancyCount] = useState(0);
  const [pendingRequestsCount, setPendingRequestsCount] = useState(0);
  const [rejectedRequestsCount, setRejectedRequestsCount] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const [pos, reqs, users, whs, stats] = await Promise.all([
        getPOs(),
        getRequests(),
        getUsers(),
        getWarehouses(),
        getPOStats(),
      ]);
      setPurchaseOrders(pos);
      setWarehouseRequests(reqs);
      setWarehouseUsers(users);
      setWarehouses(whs.map(w => w.name));
      setTotalPOs(stats.totalPOs);
      setCompletedPOs(stats.completedPOs);
      setIncompletePOs(stats.incompletePOs);
      setActiveDeliveryCount(stats.activeDeliveryCount);
      setDiscrepancyCount(stats.discrepancyCount);
      setPendingRequestsCount(reqs.filter(r => r.status === 'Pending').length);
      setRejectedRequestsCount(reqs.filter(r => r.status === 'Rejected').length);
    } catch (e) {
      console.error('Failed to load admin data', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const createPO = useCallback(async (data) => {
    const po = await createPOServer(data);
    setPurchaseOrders(prev => [po, ...prev]);
    if (data.mrsNo) {
      await approveRequestsByMrsNo(data.mrsNo);
      setWarehouseRequests(prev =>
        prev.map(req => req.mrsNo === data.mrsNo ? { ...req, status: 'Approved' } : req)
      );
    }
    const stats = await getPOStats();
    setTotalPOs(stats.totalPOs);
    setCompletedPOs(stats.completedPOs);
    setIncompletePOs(stats.incompletePOs);
    setActiveDeliveryCount(stats.activeDeliveryCount);
    setDiscrepancyCount(stats.discrepancyCount);
  }, []);

  const updatePO = useCallback(async (poNumber, data) => {
    const updated = await updatePOServer(poNumber, data);
    setPurchaseOrders(prev => prev.map(po => po.poNumber === poNumber ? { ...po, ...updated } : po));
    const stats = await getPOStats();
    setTotalPOs(stats.totalPOs);
    setCompletedPOs(stats.completedPOs);
    setIncompletePOs(stats.incompletePOs);
    setActiveDeliveryCount(stats.activeDeliveryCount);
    setDiscrepancyCount(stats.discrepancyCount);
  }, []);

  const addUser = useCallback(async (data) => {
    const user = await addUserServer(data);
    setWarehouseUsers(prev => [...prev, user]);
    return user;
  }, []);

  const deleteUser = useCallback(async (username) => {
    await deleteUserServer(username);
    setWarehouseUsers(prev => prev.filter(u => u.username !== username));
  }, []);

  const handleApproveRequest = useCallback(async (reqNumber) => {
    await approveRequest(reqNumber);
    setWarehouseRequests(prev => prev.map(req =>
      req.reqNumber === reqNumber ? { ...req, status: 'Approved' } : req
    ));
  }, []);

  const handleDeclineRequest = useCallback(async (reqNumber, remarks) => {
    await declineRequest(reqNumber, remarks);
    setWarehouseRequests(prev => prev.map(req =>
      req.reqNumber === reqNumber ? { ...req, status: 'Rejected', remarks } : req
    ));
  }, []);

  const handleAddWarehouse = useCallback(async (name) => {
    const wh = await addWarehouseServer(name);
    setWarehouses(prev => [...prev, wh.name]);
    return wh;
  }, []);

  const handleDeleteWarehouse = useCallback(async (name) => {
    await deleteWarehouseServer(name);
    setWarehouses(prev => prev.filter(w => w !== name));
  }, []);

  const assignWarehouse = useCallback(async (username, warehouse) => {
    await updateUserWarehouse(username, warehouse);
    setWarehouseUsers(prev => prev.map(u => u.username === username ? { ...u, warehouse } : u));
  }, []);

  return (
    <AdminDataContext.Provider value={{
      purchaseOrders, setPurchaseOrders,
      warehouseRequests, setWarehouseRequests,
      warehouseUsers, setWarehouseUsers,
      warehouses, setWarehouses,
      loading,
      totalPOs, completedPOs, incompletePOs,
      activeDeliveryCount, discrepancyCount,
      pendingRequestsCount, rejectedRequestsCount,
      createPO, updatePO, addUser, deleteUser, assignWarehouse,
      approveRequest: handleApproveRequest,
      declineRequest: handleDeclineRequest,
      addWarehouse: handleAddWarehouse,
      deleteWarehouse: handleDeleteWarehouse,
    }}>
      {children}
    </AdminDataContext.Provider>
  );
}

export function useAdminData() {
  const context = useContext(AdminDataContext);
  if (!context) throw new Error('useAdminData must be used within AdminDataProvider');
  return context;
}
