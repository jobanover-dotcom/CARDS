'use client';
import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { getPOs, getPOStats, updatePO as updatePOServer } from '../../actions/pos';
import { getRequests, createRequest as createRequestServer } from '../../actions/requests';

const WarehouseDataContext = createContext(null);

export function WarehouseDataProvider({ children }) {
  const [purchaseOrders, setPurchaseOrders] = useState([]);
  const [requestsList, setRequestsList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [completedCount, setCompletedCount] = useState(0);
  const [activeCount, setActiveCount] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const [pos, reqs] = await Promise.all([
        getPOs(),
        getRequests(),
      ]);
      setPurchaseOrders(pos);
      setRequestsList(reqs);
      setCompletedCount(pos.filter(o => o.status === 'completed').length);
      setActiveCount(pos.filter(o => o.status === 'incomplete' && o.poType === 'active-delivery').length);
    } catch (e) {
      console.error('Failed to load warehouse data', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const updatePO = useCallback(async (poNumber, data) => {
    const updated = await updatePOServer(poNumber, data);
    setPurchaseOrders(prev => prev.map(po => po.poNumber === poNumber ? { ...po, ...updated } : po));
    const stats = await getPOStats();
    setCompletedCount(pos => (data.status === 'completed' ? pos + 1 : pos));
    setActiveCount(pos => (data.status === 'completed' ? Math.max(0, pos - 1) : pos));
  }, []);

  const createRequest = useCallback(async (data) => {
    const req = await createRequestServer(data);
    setRequestsList(prev => [req, ...prev]);
  }, []);

  return (
    <WarehouseDataContext.Provider value={{
      purchaseOrders, setPurchaseOrders,
      requestsList, setRequestsList,
      loading,
      completedCount, activeCount,
      updatePO, createRequest,
    }}>
      {children}
    </WarehouseDataContext.Provider>
  );
}

export function useWarehouseData() {
  const context = useContext(WarehouseDataContext);
  if (!context) throw new Error('useWarehouseData must be used within WarehouseDataProvider');
  return context;
}
