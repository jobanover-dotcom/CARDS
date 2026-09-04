'use client';
import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { getPOStats, updatePO as updatePOServer } from '../../actions/pos';
import { createRequest as createRequestServer } from '../../actions/requests';

const WarehouseDataContext = createContext(null);

export function WarehouseDataProvider({ children }) {
  const [stats, setStats] = useState({
    totalPOs: 0, completedPOs: 0, incompletePOs: 0,
    activeDeliveryCount: 0, discrepancyCount: 0,
    partiallyReceivedCount: 0,
  });
  const [loading, setLoading] = useState(true);
  const [poVersion, setPoVersion] = useState(0);
  const [requestVersion, setRequestVersion] = useState(0);

  const refreshStats = useCallback(async () => {
    try {
      setStats(await getPOStats());
    } catch (e) {
      console.error('Failed to load stats', e);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await refreshStats();
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [refreshStats]);

  const updatePO = useCallback(async (poNumber, data) => {
    await updatePOServer(poNumber, data);
    setPoVersion(v => v + 1);
    await refreshStats();
  }, [refreshStats]);

  const createRequest = useCallback(async (data) => {
    await createRequestServer(data);
    setRequestVersion(v => v + 1);
  }, []);

  return (
    <WarehouseDataContext.Provider value={{
      stats,
      loading,
      poVersion,
      requestVersion,
      completedCount: stats.completedPOs,
      activeCount: (stats.incompletePOs || 0) - (stats.partiallyReceivedCount || 0),
      partiallyReceivedCount: stats.partiallyReceivedCount || 0,
      refreshStats,
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
