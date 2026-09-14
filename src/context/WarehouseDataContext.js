'use client';
import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { getPOStats, updatePOMonitoring as updatePOMonitoringServer, updatePO as updatePOServer } from '../../actions/pos';
import { confirmReceiving as confirmReceivingServer, getPOFollowUpBalance as getPOFollowUpBalanceServer, getPOQuantityTracker as getPOQuantityTrackerServer, getV1WarehouseStats as getV1WarehouseStatsServer, getWarehouseV1Partials as getWarehouseV1PartialsServer } from '../../actions/deliveries';
import { createRequest as createRequestServer } from '../../actions/requests';

const WarehouseDataContext = createContext(null);

export function WarehouseDataProvider({ children }) {
  const [stats, setStats] = useState({ totalPOs: 0, completedPOs: 0, incompletePOs: 0, activeDeliveryCount: 0, discrepancyCount: 0, partiallyReceivedCount: 0 });
  const [v1Stats, setV1Stats] = useState({ openDeliveryCount: 0, discrepancyDeliveryCount: 0, partialPOCount: 0, readyPOCount: 0, outstandingPOCount: 0 });
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
  const getPOQuantityTracker = useCallback(async (poNumber) => getPOQuantityTrackerServer(poNumber), []);

  return <WarehouseDataContext.Provider value={{
    stats, v1Stats, loading, poVersion, requestVersion,
    completedCount: stats.completedPOs,
    // Unified V1 definitions — all cards derive from Delivery/DeliveryItem
    // aggregates via getV1WarehouseStats, never from legacy poType counts.
    // Partially Received folds in every PO with a real quantity gap
    // (requestOutstanding > 0), including approval shortfalls with no
    // partial-status delivery.
    openDeliveryCount: v1Stats.openDeliveryCount || 0,
    discrepancyCount: v1Stats.discrepancyDeliveryCount || 0,
    partiallyReceivedCount: v1Stats.outstandingPOCount || 0,
    refreshStats, updatePO, updatePOMonitoring, createRequest, confirmReceiving,
    getPOFollowUpBalance, getWarehouseV1Partials, getPOQuantityTracker,
  }}>{children}</WarehouseDataContext.Provider>;
}

export function useWarehouseData() {
  const context = useContext(WarehouseDataContext);
  if (!context) throw new Error('useWarehouseData must be used within WarehouseDataProvider');
  return context;
}
