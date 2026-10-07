'use client';
import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { getPOStats, updatePOMonitoring as updatePOMonitoringServer, updatePO as updatePOServer } from '../../actions/pos';
import { recordReceiving as recordReceivingServer, getPOTracker as getPOTrackerServer, getPOWorkload as getPOWorkloadServer } from '../../actions/procurement';
import { createRequest as createRequestServer } from '../../actions/requests';

const WarehouseDataContext = createContext(null);

const EMPTY_STATS = { totalPOs: 0, completedPOs: 0, awaitingPurchaseCount: 0, inProgressCount: 0, unifiedDiscrepancyCount: 0 };
const EMPTY_WORKLOAD = { totalPOs: 0, awaitingPurchaseCount: 0, inProgressCount: 0, completedCount: 0, followUpPOs: 0, receivingDuePOs: 0 };

export function WarehouseDataProvider({ children }) {
  const [stats, setStats] = useState(EMPTY_STATS);
  const [workload, setWorkload] = useState(EMPTY_WORKLOAD);
  const [loading, setLoading] = useState(true);
  const [poVersion, setPoVersion] = useState(0);
  const [requestVersion, setRequestVersion] = useState(0);

  // Same server call the PO screen renders its cards and tables from, so a
  // warehouse card can never disagree with the rows beneath it.
  const refreshWorkload = useCallback(async (params = {}) => {
    try {
      setWorkload({ ...EMPTY_WORKLOAD, ...(await getPOWorkloadServer(params)) });
    } catch (e) {
      console.error('Failed to load receiving workload', e);
    }
  }, []);

  const refreshStats = useCallback(async () => {
    try {
      setStats({ ...EMPTY_STATS, ...(await getPOStats()) });
    } catch (e) {
      console.error('Failed to load stats', e);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await Promise.all([refreshStats(), refreshWorkload()]);
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [refreshStats, refreshWorkload]);

  const updatePO = useCallback(async (poNumber, data) => {
    await updatePOServer(poNumber, data);
    setPoVersion((v) => v + 1);
    await Promise.all([refreshStats(), refreshWorkload()]);
  }, [refreshStats, refreshWorkload]);

  // Legacy single-shot receiving, retained for pre-procurement records only.
  const updatePOMonitoring = useCallback(async (poNumber, data) => {
    const result = await updatePOMonitoringServer(poNumber, data);
    setPoVersion((v) => v + 1);
    await Promise.all([refreshStats(), refreshWorkload()]);
    return result;
  }, [refreshStats, refreshWorkload]);

  // Material requests (including request-level follow-ups for a partially
  // approved request). Procurement follow-up against a PO is NOT exposed here:
  // the Admin performs a Follow-up Purchase on the same PO instead.
  const createRequest = useCallback(async (data) => {
    await createRequestServer(data);
    setRequestVersion((v) => v + 1);
  }, []);

  // Receiving is the warehouse's only purchase-order action.
  const recordReceiving = useCallback(async (input) => {
    const result = await recordReceivingServer(input);
    setPoVersion((v) => v + 1);
    await Promise.all([refreshStats(), refreshWorkload()]);
    return result;
  }, [refreshStats, refreshWorkload]);

  const getPOTracker = useCallback(async (poNumber) => getPOTrackerServer(poNumber), []);

  return <WarehouseDataContext.Provider value={{
    stats, workload, loading, poVersion, requestVersion,
    completedCount: stats.completedPOs,
    // Parent-PO counts, from the same canonical quantity chain as the tables.
    receivingDueCount: workload.receivingDuePOs ?? 0,
    inProgressCount: workload.inProgressCount ?? 0,
    completedWorkloadCount: workload.completedCount ?? 0,
    refreshStats, refreshWorkload, updatePO, updatePOMonitoring, createRequest, recordReceiving, getPOTracker,
  }}>{children}</WarehouseDataContext.Provider>;
}

export function useWarehouseData() {
  const context = useContext(WarehouseDataContext);
  if (!context) throw new Error('useWarehouseData must be used within WarehouseDataProvider');
  return context;
}
