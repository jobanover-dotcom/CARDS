'use client';
import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { getPOStats, updatePOMonitoring as updatePOMonitoringServer, updatePO as updatePOServer } from '../../actions/pos';
import { confirmReceiving as confirmReceivingServer, confirmReceivingV2 as confirmReceivingV2Server, getPOFollowUpBalance as getPOFollowUpBalanceServer, getPOQuantityTracker as getPOQuantityTrackerServer, getSimplifiedTracker as getSimplifiedTrackerServer, getWarehouseReceivingDue as getWarehouseReceivingDueServer } from '../../actions/deliveries';
import { createRequest as createRequestServer } from '../../actions/requests';

const WarehouseDataContext = createContext(null);

export function WarehouseDataProvider({ children }) {
  const [stats, setStats] = useState({ totalPOs: 0, completedPOs: 0, incompletePOs: 0, activeDeliveryCount: 0, discrepancyCount: 0, partiallyReceivedCount: 0 });
  const [v1Stats, setV1Stats] = useState({ openDeliveryCount: 0, discrepancyDeliveryCount: 0, partialPOCount: 0, readyPOCount: 0, outstandingPOCount: 0 });
  const [loading, setLoading] = useState(true);
  const [poVersion, setPoVersion] = useState(0);
  const [requestVersion, setRequestVersion] = useState(0);

  const [receivingDue, setReceivingDue] = useState([]);

  const refreshStats = useCallback(async () => {
    try {
      const [legacy, due] = await Promise.all([getPOStats(), getWarehouseReceivingDueServer().catch(() => [])]);
      setStats(legacy);
      setReceivingDue(due);
      setV1Stats({ openDeliveryCount: 0, discrepancyDeliveryCount: 0, partialPOCount: 0, readyPOCount: 0, outstandingPOCount: due.length });
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

  const confirmReceivingV2 = useCallback(async (input) => {
    const result = await confirmReceivingV2Server(input);
    setPoVersion((v) => v + 1);
    await refreshStats();
    return result;
  }, [refreshStats]);

  // V1 follow-up data comes only from server-computed DeliveryItem balances.
  const getPOFollowUpBalance = useCallback(async (poNumber) => getPOFollowUpBalanceServer(poNumber), []);
  const getWarehouseV1Partials = useCallback(async () => getWarehouseReceivingDueServer(), []);
  const getPOQuantityTracker = useCallback(async (poNumber) => getPOQuantityTrackerServer(poNumber), []);
  const getSimplifiedTracker = useCallback(async (poNumber) => getSimplifiedTrackerServer(poNumber), []);

  return <WarehouseDataContext.Provider value={{
    stats, v1Stats, loading, poVersion, requestVersion, receivingDue,
    completedCount: stats.completedPOs,
    // Simplified workflow: receiving due = POs with purchased > received.
    // Purchasing follow-up is a Purchaser responsibility, never Warehouse.
    openDeliveryCount: 0,
    discrepancyCount: 0,
    partiallyReceivedCount: v1Stats.outstandingPOCount || 0,
    receivingDueCount: receivingDue.length,
    refreshStats, updatePO, updatePOMonitoring, createRequest, confirmReceiving, confirmReceivingV2,
    getPOFollowUpBalance, getWarehouseV1Partials, getPOQuantityTracker, getSimplifiedTracker,
  }}>{children}</WarehouseDataContext.Provider>;
}

export function useWarehouseData() {
  const context = useContext(WarehouseDataContext);
  if (!context) throw new Error('useWarehouseData must be used within WarehouseDataProvider');
  return context;
}
