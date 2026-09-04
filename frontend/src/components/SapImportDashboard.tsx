'use client';

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Progress } from './ui/progress';
import { Loader2, Upload } from 'lucide-react';
import {
  BulkUploadStatusModal,
  type BulkUploadStatusResult,
} from '@/components/BulkUploadStatusModal';
import { SapImportDetailModal } from '@/components/SapImportDetailModal';
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
}

/** History display: "CPO 3 Sep 2026.xlsx" → "CPO 3 Sep 2026". */
function displayImportFileName(fileName: string | null | undefined): string {
  const raw = String(fileName || '').trim();
  if (!raw) return '—';
  const withoutExt = raw.replace(/\.(xlsx|xlsm|xlsb|xls)$/i, '').trim();
  return withoutExt || raw;
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
    } finally {
      if (!fromPoll) setLoading(false);
    }
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      // Verify it's an Excel file
      const name = (file.name || '').trim();
      const extOk = /\.xls(x|m|b)?$/i.test(name);
      const mime = (file.type || '').toLowerCase();
      const mimeOk = [
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.ms-excel',
        'application/vnd.ms-excel.sheet.macroenabled.12',
        'application/vnd.ms-excel.sheet.binary.macroenabled.12'
      ].includes(mime);
      if (!extOk && !mimeOk) {
        alert('Please select an Excel file (.xlsx, .xlsm, .xlsb, or .xls)');
        return;
      }
      void handleStartImportWithFile(file).finally(() => {
        event.target.value = '';
      });
    }
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

  const getStatusBadge = (status: string) => {
    const statusMap: { [key: string]: { variant: any; label: string } } = {
      'pending': { variant: 'secondary', label: 'Pending' },
      'processing': { variant: 'default', label: 'Processing' },
      'completed': { variant: 'default', label: 'Completed' },
      'completed_with_errors': { variant: 'destructive', label: 'Completed with Errors' },
      'cancelled': { variant: 'secondary', label: 'Cancelled' },
      'failed': { variant: 'destructive', label: 'Failed' }
    };

    const statusInfo = statusMap[status] || { variant: 'secondary', label: status };
    return <Badge variant={statusInfo.variant}>{statusInfo.label}</Badge>;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-gray-500">Loading...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Hidden File Input */}
      <input
        id="file-upload-input"
        type="file"
        accept=".xlsx,.xlsm,.xlsb,.xls"
        onChange={handleFileSelect}
        disabled={importing}
        style={{ display: 'none' }}
      />

      {/* Header with Action Button */}
      <Card>
        <CardHeader>
          <div className="flex justify-between items-center">
            <div>
              <CardTitle>SAP Data Imports</CardTitle>
              <CardDescription>
                Monitor and manage SAP MASTER v2 data imports
              </CardDescription>
            </div>
            {canUploadSap ? (
              <Button
                size="sm"
                variant="outline"
                onClick={handleStartImport}
                disabled={importing}
                className="ml-4 border-indigo-600 text-indigo-700 hover:bg-indigo-50"
              >
                {importing ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    {uploadPhase === 'processing' ? 'Processing...' : 'Uploading...'}
                  </>
                ) : (
                  <>
                    <Upload className="h-4 w-4 mr-2" />
                    Import SAP Data
                  </>
                )}
              </Button>
            ) : (
              <p className="ml-4 text-sm text-muted-foreground max-w-xs text-right">
                View only — you do not have permission to upload SAP files.
              </p>
            )}
          </div>
        </CardHeader>
      </Card>

      {showProgressBar && (
        <Card className="border-blue-200 bg-blue-50/50">
          <CardContent className="pt-6 space-y-3">
            {showUploadingCard && (
              <>
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="font-medium text-blue-900 flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                    Uploading file to server...
                  </span>
                  <span className="tabular-nums text-blue-800">{uploadProgress}%</span>
                </div>
                <Progress value={uploadProgress} className="h-2" />
                <p className="text-xs text-blue-800/80">
                  Please keep this page open until the upload completes.
                </p>
                {canUploadSap && (
                  <div className="flex justify-end">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void handleCancelUpload()}
                      disabled={cancelling}
                    >
                      {cancelling ? 'Cancelling...' : 'Cancel upload'}
                    </Button>
                  </div>
                )}
              </>
            )}

            {showProcessingCard && activeImport && (
              <>
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="font-medium text-blue-900 flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                    Processing SAP data...
                  </span>
                  <span className="tabular-nums text-blue-800">{processingProgress}%</span>
                </div>
                <Progress value={processingProgress} className="h-2" />
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-blue-800/80">
                  <span>
                    <span className="font-semibold text-blue-900">
                      {doneCount.toLocaleString()}
                    </span>
                    {' / '}
                    {(Number(activeImport.total_records) || 0).toLocaleString()} rows processed
                  </span>
                  <span>Elapsed: {formatDuration(elapsedSeconds)}</span>
                  {rowsPerSecond > 0 && (
                    <span>
                      ~{rowsPerSecond >= 1 ? Math.round(rowsPerSecond) : rowsPerSecond.toFixed(1)} rows/sec
                    </span>
                  )}
                  {etaSeconds != null && remainingRows > 0 && (
                    <span>Est. remaining: {formatDuration(etaSeconds)}</span>
                  )}
                  {(Number(activeImport.failed_records) || 0) > 0 && (
                    <span className="text-red-700">
                      {(Number(activeImport.failed_records) || 0).toLocaleString()} failed
                    </span>
                  )}
                </div>
                {doneCount === 0 && elapsedSeconds < 20 ? (
                  <p className="text-xs text-blue-800/80">
                    Reading the file and starting the first rows — this usually takes a few seconds.
                  </p>
                ) : doneCount === 0 && elapsedSeconds >= 20 ? (
                  <p className="text-xs text-amber-800">
                    Still starting up after {formatDuration(elapsedSeconds)} — large files can take a little
                    longer. If this doesn&apos;t move for several minutes, refresh the page or re-upload.
                  </p>
                ) : (
                  <p className="text-xs text-blue-800/80">
                    Large files can take several minutes. You can leave this page — progress is saved on the
                    server and Import History will update when it&apos;s done.
                  </p>
                )}
                {canUploadSap && (
                  <div className="flex justify-end">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void handleCancelUpload()}
                      disabled={cancelling}
                    >
                      {cancelling ? 'Cancelling...' : 'Cancel upload'}
                    </Button>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Import History */}
      <Card>
        <CardHeader>
          <CardTitle>Import History</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b">
                  <th className="text-left p-3">Import Date</th>
                  <th className="text-left p-3">File Name</th>
                  <th className="text-left p-3">Status</th>
                  <th className="text-left p-3">Source</th>
                  <th className="text-right p-3">Total Records</th>
                  <th className="text-right p-3">Processed</th>
                  <th className="text-right p-3">Failed</th>
                  <th className="text-right p-3">Success Rate</th>
                  <th className="text-right p-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {imports.map((imp) => {
                  const successRate = imp.total_records > 0
                    ? ((imp.processed_records / imp.total_records) * 100).toFixed(1)
                    : '0.0';

                  return (
                    <tr key={imp.id} className="border-b hover:bg-gray-50">
                      <td className="p-3">
                        <div className="font-medium">
                          {new Date(imp.import_timestamp).toLocaleString()}
                        </div>
                        <div className="text-xs text-gray-500">
                          {imp.import_date}
                        </div>
                      </td>
                      <td className="p-3">
                        <div className="font-medium" title={imp.file_name || undefined}>
                          {displayImportFileName(imp.file_name)}
                        </div>
                      </td>
                      <td className="p-3">{getStatusBadge(imp.status)}</td>
                      <td className="p-3">
                        <Badge variant="secondary">
                          {imp.source === 'scheduler' ? 'Scheduler' : 'Manual'}
                        </Badge>
                      </td>
                      <td className="p-3 text-right">{imp.total_records.toLocaleString()}</td>
                      <td className="p-3 text-right text-green-600 font-medium">
                        {imp.processed_records.toLocaleString()}
                      </td>
                      <td className="p-3 text-right text-red-600 font-medium">
                        {imp.failed_records.toLocaleString()}
                      </td>
                      <td className="p-3 text-right">
                        <Badge variant={parseFloat(successRate) >= 95 ? 'default' : 'destructive'}>
                          {successRate}%
                        </Badge>
                      </td>
                      <td className="p-3 text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => openImportDetail(imp.id)}
                        >
                          View Details
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {imports.length === 0 && (
              <div className="text-center text-gray-500 py-12">
                {canUploadSap
                  ? 'No import history available. Start your first import above.'
                  : 'No import history available.'}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Summary Statistics */}
      {imports.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Total Imports</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{imports.length}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Total Records Processed</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-green-600">
                {imports.reduce((sum, imp) => sum + imp.processed_records, 0).toLocaleString()}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Total Failures</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-red-600">
                {imports.reduce((sum, imp) => sum + imp.failed_records, 0).toLocaleString()}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Avg Success Rate</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">
                {(imports.reduce((sum, imp) => {
                  const rate = imp.total_records > 0
                    ? (imp.processed_records / imp.total_records) * 100
                    : 0;
                  return sum + rate;
                }, 0) / imports.length).toFixed(1)}%
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <BulkUploadStatusModal
        open={!!bulkUploadResult}
        onOpenChange={(open) => { if (!open) setBulkUploadResult(null) }}
        title="SAP Data upload result"
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

