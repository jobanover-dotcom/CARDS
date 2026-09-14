'use client';
import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { getPOStats, updatePOMonitoring as updatePOMonitoringServer, updatePO as updatePOServer } from '../../actions/pos';
import { confirmReceiving as confirmReceivingServer, getPOFollowUpBalance as getPOFollowUpBalanceServer, getV1WarehouseStats as getV1WarehouseStatsServer, getWarehouseV1Partials as getWarehouseV1PartialsServer } from '../../actions/deliveries';
import { createRequest as createRequestServer } from '../../actions/requests';

const WarehouseDataContext = createContext(null);

export function WarehouseDataProvider({ children }) {
  const [stats, setStats] = useState({ totalPOs: 0, completedPOs: 0, incompletePOs: 0, activeDeliveryCount: 0, discrepancyCount: 0, partiallyReceivedCount: 0 });
  const [v1Stats, setV1Stats] = useState({ openDeliveryCount: 0, discrepancyDeliveryCount: 0, partialPOCount: 0, readyPOCount: 0 });
  const [loading, setLoading] = useState(true);
  const [poVersion, setPoVersion] = useState(0);
  const [requestVersion, setRequestVersion] = useState(0);

  const refreshStats = useCallback(async () => {
    try {
      const [legacy, v1] = await Promise.all([getPOStats(), getV1WarehouseStatsServer()]);
      setStats(legacy);
      setV1Stats(v1);
    }
    catch (e) { console.error('Failed to load stats', e); }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => { await refreshStats(); if (!cancelled) setLoading(false); })();
    return () => { cancelled = true; };
  }, [refreshStats]);

  const updatePO = useCallback(async (poNumber, data) => {
    await updatePOServer(poNumber, data);
    setPoVersion((v) => v + 1);
    await refreshStats();
  }, [refreshStats]);

  const updatePOMonitoring = useCallback(async (poNumber, data) => {
    const result = await updatePOMonitoringServer(poNumber, data);
    setPoVersion((v) => v + 1);
    await refreshStats();
    return result;
  }, [refreshStats]);

  const createRequest = useCallback(async (data) => {
    await createRequestServer(data);
    setRequestVersion((v) => v + 1);
  }, []);

  const confirmReceiving = useCallback(async (input) => {
    const delivery = await confirmReceivingServer(input);
    setPoVersion((v) => v + 1);
    await refreshStats();
    return delivery;
  }, [refreshStats]);

  // V1 follow-up data comes only from server-computed DeliveryItem balances.
  const getPOFollowUpBalance = useCallback(async (poNumber) => getPOFollowUpBalanceServer(poNumber), []);
  const getWarehouseV1Partials = useCallback(async () => getWarehouseV1PartialsServer(), []);

  return <WarehouseDataContext.Provider value={{
    stats, v1Stats, loading, poVersion, requestVersion,
    completedCount: stats.completedPOs,
    // Legacy active-delivery POs plus V1 POs still moving through procurement.
    activeCount: ((stats.incompletePOs || 0) - (stats.partiallyReceivedCount || 0)) + (v1Stats.readyPOCount || 0),
    // Legacy partials plus V1 POs with real receiving shortfalls.
    partiallyReceivedCount: (stats.partiallyReceivedCount || 0) + (v1Stats.partialPOCount || 0),
    refreshStats, updatePO, updatePOMonitoring, createRequest, confirmReceiving,
    getPOFollowUpBalance, getWarehouseV1Partials,
  }}>{children}</WarehouseDataContext.Provider>;
}

export function useWarehouseData() {
  const context = useContext(WarehouseDataContext);
  if (!context) throw new Error('useWarehouseData must be used within WarehouseDataProvider');
  return context;
}
