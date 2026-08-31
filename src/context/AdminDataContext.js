'use client';
import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { getPOStats, createPO as createPOServer, createPOWithApproval, updatePO as updatePOServer, deletePO as deletePOServer } from '../../actions/pos';
import { getRequestCounts, approveRequestPartial, declineRequest } from '../../actions/requests';
import { addUser as addUserServer, deleteUser as deleteUserServer, updateUserWarehouse } from '../../actions/users';
import { getWarehouses, addWarehouse as addWarehouseServer } from '../../actions/warehouses';
import { deleteWarehouseWithArchive } from '../../actions/archive';

const AdminDataContext = createContext(null);

export function AdminDataProvider({ children }) {
  const [warehouses, setWarehouses] = useState([]);
  const [stats, setStats] = useState({
    totalPOs: 0, completedPOs: 0, incompletePOs: 0,
    activeDeliveryCount: 0, discrepancyCount: 0,
  });
  const [requestCounts, setRequestCounts] = useState({ total: 0, pending: 0, rejected: 0, approved: 0, partiallyApproved: 0 });
  const [loading, setLoading] = useState(true);
  const [poVersion, setPoVersion] = useState(0);
  const [requestVersion, setRequestVersion] = useState(0);
  const [userVersion, setUserVersion] = useState(0);

  const refreshStats = useCallback(async () => {
    try {
      setStats(await getPOStats());
    } catch (e) {
      console.error('Failed to load PO stats', e);
    }
  }, []);

  const refreshRequestCounts = useCallback(async () => {
    try {
      setRequestCounts(await getRequestCounts());
    } catch (e) {
      console.error('Failed to load request counts', e);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [whs] = await Promise.all([getWarehouses(), refreshStats(), refreshRequestCounts()]);
        if (!cancelled) setWarehouses(whs.map(w => w.name));
      } catch (e) {
        console.error('Failed to load admin data', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [refreshStats, refreshRequestCounts]);

  const createPO = useCallback(async (data, source = null) => {
    if (source?.reqNumber) {
      await createPOWithApproval(data, source);
    } else {
      await createPOServer(data);
    }
    setPoVersion(v => v + 1);
    setRequestVersion(v => v + 1);
    await Promise.all([refreshStats(), refreshRequestCounts()]);
  }, [refreshStats, refreshRequestCounts]);

  const updatePO = useCallback(async (poNumber, data) => {
    await updatePOServer(poNumber, data);
    setPoVersion(v => v + 1);
    await refreshStats();
  }, [refreshStats]);

  const addUser = useCallback(async (data) => {
    const user = await addUserServer(data);
    setUserVersion(v => v + 1);
    return user;
  }, []);

  const deleteUser = useCallback(async (username) => {
    await deleteUserServer(username);
    setUserVersion(v => v + 1);
  }, []);

  const handleApproveRequest = useCallback(async (reqNumber) => {
    await approveRequestPartial(reqNumber);
    setRequestVersion(v => v + 1);
    await refreshRequestCounts();
  }, [refreshRequestCounts]);

  const handleDeclineRequest = useCallback(async (reqNumber, remarks) => {
    await declineRequest(reqNumber, remarks);
    setRequestVersion(v => v + 1);
    await refreshRequestCounts();
  }, [refreshRequestCounts]);

  const handleAddWarehouse = useCallback(async (name) => {
    const wh = await addWarehouseServer(name);
    setWarehouses(prev => [...prev, wh.name]);
    return wh;
  }, []);

  const handleDeleteWarehouse = useCallback(async (name) => {
    await deleteWarehouseWithArchive(name);
    setWarehouses(prev => prev.filter(w => w !== name));
  }, []);

  const assignWarehouse = useCallback(async (username, warehouse) => {
    await updateUserWarehouse(username, warehouse);
    setUserVersion(v => v + 1);
  }, []);

  const deletePO = useCallback(async (poNumber) => {
    await deletePOServer(poNumber);
    setPoVersion(v => v + 1);
  }, []);

  return (
    <AdminDataContext.Provider value={{
      warehouses,
      stats,
      requestCounts,
      loading,
      poVersion,
      requestVersion,
      userVersion,
      refreshStats,
      createPO, updatePO, deletePO, addUser, deleteUser, assignWarehouse,
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
