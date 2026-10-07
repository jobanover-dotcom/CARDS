'use client';
import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { getPOStats, createPO as createPOServer, createPOWithApproval, updatePO as updatePOServer, deletePO as deletePOServer } from '../../actions/pos';
import { savePurchase as savePurchaseServer, createFollowUpPO as createFollowUpPOServer, getPOTracker as getPOTrackerServer, getPOWorkload as getPOWorkloadServer } from '../../actions/procurement';
import { getRequestCounts, approveRequestPartial, declineRequest, deleteRequest as deleteRequestServer } from '../../actions/requests';
import { addUser as addUserServer, deleteUser as deleteUserServer, updateUserWarehouse } from '../../actions/users';
import { getWarehouses, addWarehouse as addWarehouseServer } from '../../actions/warehouses';
import { deleteWarehouseWithArchive } from '../../actions/archive';

const AdminDataContext = createContext(null);

// Lifecycle counts. Every number counts PARENT purchase orders.
const EMPTY_STATS = { totalPOs: 0, completedPOs: 0, awaitingPurchaseCount: 0, inProgressCount: 0, unifiedDiscrepancyCount: 0 };
// Quantity-driven workload: what the Admin can still buy, and what the
// warehouse can still receive. Derived from the same canonical server-side
// quantity chain the tables render.
const EMPTY_WORKLOAD = { totalPOs: 0, awaitingPurchaseCount: 0, inProgressCount: 0, completedCount: 0, followUpPOs: 0, receivingDuePOs: 0 };

export function AdminDataProvider({ children }) {
  const [warehouses, setWarehouses] = useState([]);
  const [stats, setStats] = useState(EMPTY_STATS);
  const [workload, setWorkload] = useState(EMPTY_WORKLOAD);
  const [requestCounts, setRequestCounts] = useState({ total: 0, pending: 0, rejected: 0, approved: 0, partiallyApproved: 0 });
  const [loading, setLoading] = useState(true);
  const [poVersion, setPoVersion] = useState(0);
  const [requestVersion, setRequestVersion] = useState(0);
  const [userVersion, setUserVersion] = useState(0);

  // Dashboard cards and their tables are both fed from the same server call,
  // so a card can never disagree with the list beside it.
  const refreshWorkload = useCallback(async (params = {}) => {
    try {
      setWorkload({ ...EMPTY_WORKLOAD, ...(await getPOWorkloadServer(params)) });
    } catch (e) {
      console.error('Failed to load procurement workload', e);
    }
  }, []);

  const refreshStats = useCallback(async () => {
    try {
      setStats({ ...EMPTY_STATS, ...(await getPOStats()) });
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
        const [whs] = await Promise.all([getWarehouses(), refreshStats(), refreshWorkload(), refreshRequestCounts()]);
        if (!cancelled) setWarehouses(whs.map(w => w.name));
      } catch (e) {
        console.error('Failed to load admin data', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [refreshStats, refreshWorkload, refreshRequestCounts]);

  const createPO = useCallback(async (data, source = null) => {
    if (source?.reqNumber) {
      await createPOWithApproval(data, source);
    } else {
      await createPOServer(data);
    }
    setPoVersion(v => v + 1);
    setRequestVersion(v => v + 1);
    await Promise.all([refreshStats(), refreshWorkload(), refreshRequestCounts()]);
  }, [refreshStats, refreshWorkload, refreshRequestCounts]);

  const updatePO = useCallback(async (poNumber, data) => {
    await updatePOServer(poNumber, data);
    setPoVersion(v => v + 1);
    await Promise.all([refreshStats(), refreshWorkload()]);
  }, [refreshStats, refreshWorkload]);

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

  // A removed request changes both the table and the stat cards, so the version
  // bump refetches the rows while the explicit count refresh keeps the totals in
  // step. Without the latter the cards would still count the deleted request.
  const handleDeleteRequest = useCallback(async (reqNumber) => {
    await deleteRequestServer(reqNumber);
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
    await Promise.all([refreshStats(), refreshWorkload()]);
  }, [refreshStats, refreshWorkload]);

  // Save Purchase records the FIRST purchase against a fresh PO: the supplier and
  // the purchased quantities belong to that PO, and it holds exactly one
  // purchasing transaction. Any further buying is a Follow-up Purchase below,
  // which raises a NEW PO on the same material request.
  const savePurchase = useCallback(async (input) => {
    const result = await savePurchaseServer(input);
    setPoVersion(v => v + 1);
    await Promise.all([refreshStats(), refreshWorkload()]);
    return result;
  }, [refreshStats, refreshWorkload]);

  // Follow-up Purchase never amends the PO it follows. It creates another PO on
  // the same MRS — same or different supplier — and leaves the original PO's
  // supplier, quantities and history untouched.
  const createFollowUpPO = useCallback(async (input) => {
    const result = await createFollowUpPOServer(input);
    setPoVersion(v => v + 1);
    await Promise.all([refreshStats(), refreshWorkload()]);
    return result;
  }, [refreshStats, refreshWorkload]);

  const getPOTracker = useCallback(async (poNumber) => getPOTrackerServer(poNumber), []);

  return (
    <AdminDataContext.Provider value={{
      warehouses,
      stats,
      workload,
      requestCounts,
      loading,
      poVersion,
      requestVersion,
      userVersion,
      refreshStats,
      refreshWorkload,
      createPO, updatePO, deletePO, addUser, deleteUser, assignWarehouse,
      savePurchase, createFollowUpPO, getPOTracker,
      approveRequest: handleApproveRequest,
      declineRequest: handleDeclineRequest,
      deleteRequest: handleDeleteRequest,
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
