'use client';

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from './ui/button';
import { Loader2, Upload } from 'lucide-react';
import { SapImportKpis } from '@/components/sap-import/SapImportKpis';
import { SapImportDropZone } from '@/components/sap-import/SapImportDropZone';
import { SapImportProgressPanel } from '@/components/sap-import/SapImportProgressPanel';
import { SapImportHistory } from '@/components/sap-import/SapImportHistory';
import { summarizeSapImports } from '@/lib/sapImportSummary';
import {
  BulkUploadStatusModal,
  type BulkUploadStatusResult,
} from '@/components/BulkUploadStatusModal';
import { SapImportDetailModal } from '@/components/SapImportDetailModal';
import { SapFolderSyncButton, SapFolderSyncStatus, useSapFolderSync } from '@/components/SapFolderSyncControl';
import api from '../lib/api';
import { canCreatePermission, usePermissions } from '@/components/PermissionsContext';
import {
  computeSapImportProgress,
  computeSapImportProgressStats,
  formatSapImportDuration,
} from '@/lib/sapImportProgress';

/** Parses API error bodies (including HTML fallback) so alerts show the real backend message. */
function formatImportFailureMessage(error: unknown): string {
  const err = error as { message?: string; response?: { data?: unknown; status?: number } };
  const status = err.response?.status;
  if (status === 403) {
    const d = err.response?.data;
    if (d && typeof d === 'object') {
      const o = d as { error?: { message?: string } };
      if (o.error?.message) return o.error.message;
    }
    return 'You do not have permission to upload SAP data. Contact an administrator.';
  }
  if (!err.response) {
    const msg = (err.message || '').toLowerCase();
    if (msg.includes('network error') || msg.includes('timeout')) {
      return 'Upload failed due to a network or timeout issue. Check your connection and try again.';
    }
  }
  const d = err.response?.data;
  if (typeof d === 'string' && d.trim()) {
    const stripped = d.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    return stripped.slice(0, 400) || err.message || 'Request failed';
  }
  if (d && typeof d === 'object') {
    const o = d as { error?: { message?: string; detail?: string; code?: string }; message?: string };
    const msg = o.error?.message ?? o.message;
    const detail = o.error?.detail;
    const code = o.error?.code;
    const parts = [msg, detail, code].filter(Boolean);
    if (parts.length) return parts.join(' — ');
    try {
      return JSON.stringify(d).slice(0, 400);
    } catch {
      /* ignore */
    }
  }
  return err.message || 'Request failed';
}

function parseImportErrors(errorLog: unknown): string[] {
  if (errorLog == null || errorLog === '') return [];
  if (Array.isArray(errorLog)) return errorLog.map(String);
  if (typeof errorLog === 'string') {
    try {
      const parsed = JSON.parse(errorLog);
      if (Array.isArray(parsed)) return parsed.map(String);
      return [errorLog];
    } catch {
      return [errorLog];
    }
  }
  return [String(errorLog)];
}

interface SapImport {
  id: string;
  import_date: string;
  import_timestamp: string;
  status: string;
  total_records: number;
  processed_records: number;
  failed_records: number;
  source?: string;
  file_name?: string | null;
  /** Who started it: the user's full name, or null for scheduled runs and imports made before the column existed. */
  imported_by_name?: string | null;
}

type UploadPhase = 'idle' | 'uploading' | 'processing';

const IMPORT_POLL_MS = 2000;

const computeProcessingProgress = computeSapImportProgress;
const formatDuration = formatSapImportDuration;

const SapImportDashboard: React.FC = () => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const perms = usePermissions();
  const canUploadSap = canCreatePermission(perms, 'page.sap');
  const [imports, setImports] = useState<SapImport[]>([]);
  /*
   * A refused request used to be indistinguishable from an empty one: the 403 went to
   * console.error and the table rendered "No import history available". The user concluded there
   * were no imports; the admin who had just granted the permission concluded it had worked.
   */
  const [importsError, setImportsError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [uploadPhase, setUploadPhase] = useState<UploadPhase>('idle');
  const [uploadProgress, setUploadProgress] = useState(0);
  const [activeImportId, setActiveImportId] = useState<string | null>(null);
  const [bulkUploadResult, setBulkUploadResult] = useState<BulkUploadStatusResult | null>(null);
  const pollTimerRef = useRef<number | null>(null);
  const pendingImportIdRef = useRef<string | null>(null);
  const uploadAbortRef = useRef<AbortController | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const detailImportId = searchParams.get('import');

  const openImportDetail = useCallback(
    (id: string) => {
      const next = new URLSearchParams(searchParams.toString());
      next.set('import', id);
      router.replace(`/sap-imports?${next.toString()}`, { scroll: false });
    },
    [router, searchParams],
  );

  const closeImportDetail = useCallback(() => {
    const next = new URLSearchParams(searchParams.toString());
    next.delete('import');
    const q = next.toString();
    router.replace(q ? `/sap-imports?${q}` : '/sap-imports', { scroll: false });
  }, [router, searchParams]);

  const activeImport = useMemo(() => {
    if (activeImportId) {
      return imports.find((imp) => imp.id === activeImportId) ?? null;
    }
    return imports.find((imp) => imp.status === 'processing' || imp.status === 'pending') ?? null;
  }, [imports, activeImportId]);

  const processingProgress = activeImport ? computeProcessingProgress(activeImport) : 0;
  const showUploadingCard = uploadPhase === 'uploading';
  const showProcessingCard =
    !!activeImport &&
    (activeImport.status === 'processing' || activeImport.status === 'pending') &&
    uploadPhase !== 'uploading';
  const showProgressBar = showUploadingCard || showProcessingCard;
  const isProcessingLive =
    (uploadPhase === 'processing' || (uploadPhase === 'idle' && !!activeImport)) &&
    !!activeImport &&
    (activeImport.status === 'processing' || activeImport.status === 'pending');

  // Tick every second so the elapsed-time / ETA display visibly moves between polls,
  // instead of only updating every 2s when a fresh poll response arrives.
  useEffect(() => {
    if (!isProcessingLive) return;
    const timer = window.setInterval(() => setNowTick(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [isProcessingLive]);

  const { doneCount, elapsedSeconds, rowsPerSecond, remainingRows, etaSeconds } = activeImport
    ? computeSapImportProgressStats(activeImport, nowTick)
    : { doneCount: 0, elapsedSeconds: 0, rowsPerSecond: 0, remainingRows: 0, etaSeconds: null };

  const stopImportPolling = () => {
    if (pollTimerRef.current != null) {
      window.clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  };

  const startImportPolling = () => {
    stopImportPolling();
    pollTimerRef.current = window.setInterval(() => {
      void loadImports(true);
    }, IMPORT_POLL_MS);
  };

  useEffect(() => {
    loadImports();
    return () => stopImportPolling();
  }, []);

  const showImportResultModal = async (importId: string) => {
    try {
      const response = await api.get(`/sap-master-v2/imports/${importId}`);
      const imp = response.data?.data?.import;
      if (!imp) return;
      setBulkUploadResult({
        created: Number(imp.processed_records) || 0,
        updated: Number(imp.skipped_records) || 0,
        failed: Number(imp.failed_records) || 0,
        errors: parseImportErrors(imp.error_log),
      });
    } catch (error) {
      console.error('Failed to load import result:', error);
    }
  };

  const loadImports = async (fromPoll = false) => {
    try {
      const response = await api.get('/sap-master-v2/imports');
      setImportsError(null);
      const nextImports: SapImport[] = response.data.data || [];
      const pendingId = pendingImportIdRef.current;
      setImports((prev) => {
        if (!pendingId) return nextImports;
        if (nextImports.some((imp) => imp.id === pendingId)) return nextImports;
        const optimistic = prev.find((imp) => imp.id === pendingId);
        return optimistic ? [optimistic, ...nextImports] : nextImports;
      });

      if (pendingId) {
        const pendingImport = nextImports.find((imp) => imp.id === pendingId);
        if (
          pendingImport &&
          pendingImport.status !== 'processing' &&
          pendingImport.status !== 'pending'
        ) {
          pendingImportIdRef.current = null;
          setActiveImportId(null);
          setUploadPhase('idle');
          setUploadProgress(0);
          setImporting(false);
          setCancelling(false);
          await showImportResultModal(pendingId);
        }
      }

      const hasProcessing = nextImports.some((imp) => imp.status === 'processing' || imp.status === 'pending');
      if (hasProcessing) {
        if (!activeImportId && !pendingImportIdRef.current) {
          const running = nextImports.find((imp) => imp.status === 'processing' || imp.status === 'pending');
          if (running) {
            setActiveImportId(running.id);
            setUploadPhase('processing');
            setImporting(true);
          }
        }
        if (pollTimerRef.current == null) startImportPolling();
      } else {
        stopImportPolling();
        if (fromPoll && !pendingImportIdRef.current) {
          setActiveImportId(null);
          setUploadPhase('idle');
          setUploadProgress(0);
          setImporting(false);
          setCancelling(false);
        }
      }
    } catch (error) {
      console.error('Failed to load imports:', error);
      const status = (error as { response?: { status?: number } })?.response?.status;
      setImportsError(
        status === 403
          ? 'You do not have permission to view SAP import history. Ask an administrator to grant Logistics Data view access for your role and level.'
          : 'Could not load import history. Please retry, and tell IT if it keeps happening.',
      );
    } finally {
      if (!fromPoll) setLoading(false);
    }
  };

  const isExcelFile = (file: File): boolean => {
    const name = (file.name || '').trim();
    const extOk = /\.xls(x|m|b)?$/i.test(name);
    const mime = (file.type || '').toLowerCase();
    const mimeOk = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'application/vnd.ms-excel.sheet.macroenabled.12',
      'application/vnd.ms-excel.sheet.binary.macroenabled.12'
    ].includes(mime);
    return extOk || mimeOk;
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      // Verify it's an Excel file
      if (!isExcelFile(file)) {
        alert('Please select an Excel file (.xlsx, .xlsm, .xlsb, or .xls)');
        return;
      }
      void handleStartImportWithFile(file).finally(() => {
        event.target.value = '';
      });
    }
  };

  /** A file dropped on the drop zone goes through the same check and the same import as one picked with the button. */
  const handleFileDropped = (file: File) => {
    if (!canUploadSap || importing) return;
    if (!isExcelFile(file)) {
      alert('Please select an Excel file (.xlsx, .xlsm, .xlsb, or .xls)');
      return;
    }
    void handleStartImportWithFile(file);
  };

  const handleStartImportWithFile = async (file: File) => {
    setImporting(true);
    setUploadPhase('uploading');
    setUploadProgress(0);
    setActiveImportId(null);
    try {
      // Create FormData for file upload
      const formData = new FormData();
      formData.append('file', file);

      // Do not set Content-Type: FormData needs multipart boundary from the browser/axios.
      const abortController = new AbortController();
      uploadAbortRef.current = abortController;
      const response = await api.post('/sap-master-v2/import-upload', formData, {
        timeout: 120000,
        signal: abortController.signal,
        onUploadProgress: (event) => {
          const total = event.total ?? 0;
          if (total > 0) {
            setUploadProgress(Math.min(100, Math.round((event.loaded * 100) / total)));
          }
        },
      });
      uploadAbortRef.current = null;

      const data = response.data?.data;
      const importId = data?.importId;
      const startedAsync = response.status === 202 || data?.status === 'processing';

      if (startedAsync && importId) {
        const optimistic: SapImport = {
          id: importId,
          import_date: new Date().toISOString().slice(0, 10),
          import_timestamp: new Date().toISOString(),
          status: 'processing',
          total_records: Number(data?.totalRecords) || 0,
          processed_records: 0,
          failed_records: 0,
          source: 'manual',
          file_name: (typeof data?.fileName === 'string' && data.fileName) || file.name,
        };
        setImports((prev) => (prev.some((imp) => imp.id === importId) ? prev : [optimistic, ...prev]));
        setUploadProgress(100);
        setUploadPhase('processing');
        setActiveImportId(importId);
        pendingImportIdRef.current = importId;
        startImportPolling();
        await loadImports(true);
      } else if (importId) {
        pendingImportIdRef.current = null;
        setActiveImportId(null);
        setUploadPhase('idle');
        setUploadProgress(0);
        setImporting(false);
        await showImportResultModal(importId);
        await loadImports();
      } else {
        setActiveImportId(null);
        setUploadPhase('idle');
        setUploadProgress(0);
        setImporting(false);
        await loadImports();
      }
    } catch (error: unknown) {
      uploadAbortRef.current = null;
      const err = error as { response?: { status?: number; data?: unknown }; message?: string; code?: string; name?: string };
      const aborted =
        err.code === 'ERR_CANCELED' ||
        err.name === 'CanceledError' ||
        /cancel/i.test(err.message || '');
      pendingImportIdRef.current = null;
      setActiveImportId(null);
      setUploadPhase('idle');
      setUploadProgress(0);
      setImporting(false);
      setCancelling(false);
      if (aborted) {
        setBulkUploadResult({
          created: 0,
          updated: 0,
          failed: 0,
          errors: ['Upload cancelled. The file was not imported.'],
        });
        return;
      }
      console.error('Failed to start import:', formatImportFailureMessage(error));
      console.error('Import upload response:', err.response?.status, err.response?.data);
      setBulkUploadResult({
        created: 0,
        updated: 0,
        failed: 1,
        errors: [formatImportFailureMessage(error)],
      });
    }
  };

  const handleCancelUpload = async () => {
    if (cancelling) return;
    setCancelling(true);

    if (uploadPhase === 'uploading' && uploadAbortRef.current) {
      uploadAbortRef.current.abort();
      return;
    }

    const importId = activeImportId || pendingImportIdRef.current || activeImport?.id;
    if (!importId) {
      setCancelling(false);
      return;
    }

    try {
      await api.post(`/sap-master-v2/imports/${importId}/cancel`);
      pendingImportIdRef.current = null;
      setActiveImportId(null);
      setUploadPhase('idle');
      setUploadProgress(0);
      setImporting(false);
      setCancelling(false);
      stopImportPolling();
      setBulkUploadResult({
        created: 0,
        updated: 0,
        failed: 0,
        errors: ['Import cancelled. Remaining rows will stop shortly.'],
      });
      await loadImports();
    } catch (error: unknown) {
      const err = error as { response?: { status?: number; data?: { error?: { status?: string } } } };
      const alreadyFinished = err.response?.status === 409;
      const alreadyCancelled = err.response?.data?.error?.status === 'cancelled';
      if (alreadyFinished || alreadyCancelled) {
        pendingImportIdRef.current = null;
        setActiveImportId(null);
        setUploadPhase('idle');
        setUploadProgress(0);
        setImporting(false);
        setCancelling(false);
        stopImportPolling();
        await loadImports();
        return;
      }
      console.error('Failed to cancel import:', formatImportFailureMessage(error));
      alert(formatImportFailureMessage(error));
      setCancelling(false);
    }
  };

  const handleStartImport = () => {
    // Trigger file input click
    document.getElementById('file-upload-input')?.click();
  };

  const summary = useMemo(() => summarizeSapImports(imports), [imports]);
  const folderSync = useSapFolderSync(() => void loadImports(true));

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-gray-500">Loading...</div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Hidden File Input */}
      <input
        id="file-upload-input"
        type="file"
        accept=".xlsx,.xlsm,.xlsb,.xls"
        onChange={handleFileSelect}
        disabled={importing}
        style={{ display: 'none' }}
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-gray-500">
          SAP MASTER v2: upload a file, or let the schedule pull it from the SAP folder.
        </p>
      </div>

      <SapFolderSyncStatus folderSync={folderSync} />

      {!canUploadSap ? (
        <p className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm text-gray-600">
          View only: you do not have permission to upload SAP files.
        </p>
      ) : null}

      <SapImportKpis summary={summary} />

      {showProgressBar ? (
        <SapImportProgressPanel
          phase={showUploadingCard ? 'uploading' : 'processing'}
          uploadProgress={uploadProgress}
          processingProgress={processingProgress}
          doneCount={doneCount}
          totalCount={Number(activeImport?.total_records) || 0}
          failedCount={Number(activeImport?.failed_records) || 0}
          elapsed={formatDuration(elapsedSeconds)}
          elapsedSeconds={elapsedSeconds}
          rowsPerSecond={rowsPerSecond}
          eta={etaSeconds != null && remainingRows > 0 ? formatDuration(etaSeconds) : null}
          canCancel={canUploadSap}
          cancelling={cancelling}
          onCancel={() => void handleCancelUpload()}
        />
      ) : canUploadSap ? (
        <SapImportDropZone onFile={handleFileDropped} onBrowse={handleStartImport} disabled={importing} />
      ) : null}

      <SapImportHistory
        imports={imports}
        error={importsError}
        canUpload={canUploadSap}
        onOpen={openImportDetail}
        actions={
          canUploadSap ? (
            <>
              <SapFolderSyncButton folderSync={folderSync} canSync={canUploadSap} />
              <Button
                size="icon"
                className="h-9 w-9 shrink-0"
                onClick={handleStartImport}
                disabled={importing}
                title={importing ? (uploadPhase === 'processing' ? 'Processing...' : 'Uploading...') : 'Import Logistics Data'}
                aria-label={importing ? (uploadPhase === 'processing' ? 'Processing' : 'Uploading') : 'Import Logistics Data'}
              >
                {importing ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Upload className="h-4 w-4" aria-hidden />}
              </Button>
            </>
          ) : null
        }
      />

      <BulkUploadStatusModal
        open={!!bulkUploadResult}
        onOpenChange={(open) => { if (!open) setBulkUploadResult(null) }}
        title="Logistics Data upload result"
        result={bulkUploadResult}
        createdLabel="Processed"
        updatedLabel="Skipped"
        failedLabel="Failed"
        errorsTitle="Import issues"
      />
      <SapImportDetailModal importId={detailImportId} onClose={closeImportDetail} />
    </div>
  );
};

export default SapImportDashboard;

