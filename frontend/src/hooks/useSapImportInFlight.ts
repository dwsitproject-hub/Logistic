'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import api from '@/lib/api';
import {
  computeSapImportProgress,
  computeSapImportProgressStats,
  isSapImportInFlight,
  type SapImportProgressRow,
} from '@/lib/sapImportProgress';

export interface ActiveSapImport extends SapImportProgressRow {
  id: string;
}

export interface UseSapImportInFlightResult {
  active: boolean;
  activeImport: ActiveSapImport | null;
  progress: number;
  progressStats: ReturnType<typeof computeSapImportProgressStats>;
  loading: boolean;
  refresh: () => Promise<void>;
}

const POLL_ACTIVE_MS = 3000;
const POLL_IDLE_MS = 30000;

export function useSapImportInFlight(): UseSapImportInFlightResult {
  const [activeImport, setActiveImport] = useState<ActiveSapImport | null>(null);
  const [loading, setLoading] = useState(true);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const timerRef = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    try {
      const response = await api.get('/sap-master-v2/imports/active');
      const data = response.data?.data;
      const row = data?.import ?? null;
      if (data?.active && row && isSapImportInFlight(row.status)) {
        setActiveImport(row as ActiveSapImport);
      } else {
        setActiveImport(null);
      }
    } catch {
      // Keep last known state on transient errors; banner may linger briefly.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const intervalMs = activeImport ? POLL_ACTIVE_MS : POLL_IDLE_MS;
    timerRef.current = window.setInterval(() => {
      void refresh();
    }, intervalMs);
    return () => {
      if (timerRef.current != null) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [activeImport, refresh]);

  useEffect(() => {
    if (!activeImport) return;
    const tick = window.setInterval(() => setNowTick(Date.now()), 1000);
    return () => window.clearInterval(tick);
  }, [activeImport]);

  const progress = useMemo(
    () => (activeImport ? computeSapImportProgress(activeImport) : 0),
    [activeImport],
  );

  const progressStats = useMemo(
    () =>
      activeImport
        ? computeSapImportProgressStats(activeImport, nowTick)
        : { doneCount: 0, elapsedSeconds: 0, rowsPerSecond: 0, remainingRows: 0, etaSeconds: null },
    [activeImport, nowTick],
  );

  return {
    active: activeImport != null,
    activeImport,
    progress,
    progressStats,
    loading,
    refresh,
  };
}
