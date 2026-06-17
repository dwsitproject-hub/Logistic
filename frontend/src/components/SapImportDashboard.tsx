'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Progress } from './ui/progress';
import { Loader2 } from 'lucide-react';
import {
  BulkUploadStatusModal,
  type BulkUploadStatusResult,
} from '@/components/BulkUploadStatusModal';
import api from '../lib/api';

/** Parses API error bodies (including HTML fallback) so alerts show the real backend message. */
function formatImportFailureMessage(error: unknown): string {
  const err = error as { message?: string; response?: { data?: unknown; status?: number } };
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
}

type UploadPhase = 'idle' | 'uploading' | 'processing';

const IMPORT_POLL_MS = 2000;

function computeProcessingProgress(imp: SapImport): number {
  const total = Number(imp.total_records) || 0;
  if (total <= 0) {
    return imp.status === 'processing' || imp.status === 'pending' ? 5 : 0;
  }
  const done = (Number(imp.processed_records) || 0) + (Number(imp.failed_records) || 0);
  return Math.min(100, Math.max(5, Math.round((done / total) * 100)));
}

const SapImportDashboard: React.FC = () => {
  const [imports, setImports] = useState<SapImport[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [uploadPhase, setUploadPhase] = useState<UploadPhase>('idle');
  const [uploadProgress, setUploadProgress] = useState(0);
  const [activeImportId, setActiveImportId] = useState<string | null>(null);
  const [bulkUploadResult, setBulkUploadResult] = useState<BulkUploadStatusResult | null>(null);
  const pollTimerRef = useRef<number | null>(null);
  const pendingImportIdRef = useRef<string | null>(null);

  const activeImport = useMemo(() => {
    if (activeImportId) {
      return imports.find((imp) => imp.id === activeImportId) ?? null;
    }
    return imports.find((imp) => imp.status === 'processing' || imp.status === 'pending') ?? null;
  }, [imports, activeImportId]);

  const processingProgress = activeImport ? computeProcessingProgress(activeImport) : 0;
  const showProgressBar =
    uploadPhase === 'uploading' ||
    uploadPhase === 'processing' ||
    (!!activeImport && (activeImport.status === 'processing' || activeImport.status === 'pending'));

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
      const nextImports: SapImport[] = response.data.data;
      setImports(nextImports);

      const pendingId = pendingImportIdRef.current;
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
      const response = await api.post('/sap-master-v2/import-upload', formData, {
        timeout: 120000,
        onUploadProgress: (event) => {
          const total = event.total ?? 0;
          if (total > 0) {
            setUploadProgress(Math.min(100, Math.round((event.loaded * 100) / total)));
          }
        },
      });

      const data = response.data?.data;
      const importId = data?.importId;
      const startedAsync = response.status === 202 || data?.status === 'processing';

      if (startedAsync && importId) {
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
      const err = error as { response?: { status?: number; data?: unknown }; message?: string };
      console.error('Failed to start import:', formatImportFailureMessage(error));
      console.error('Import upload response:', err.response?.status, err.response?.data);
      pendingImportIdRef.current = null;
      setActiveImportId(null);
      setUploadPhase('idle');
      setUploadProgress(0);
      setBulkUploadResult({
        created: 0,
        updated: 0,
        failed: 1,
        errors: [formatImportFailureMessage(error)],
      });
      setImporting(false);
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
            <Button
              onClick={handleStartImport}
              disabled={importing}
              className="ml-4"
            >
              {importing ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Uploading...
                </>
              ) : (
                '📁 Browse & Import File'
              )}
            </Button>
          </div>
        </CardHeader>
      </Card>

      {showProgressBar && (
        <Card className="border-blue-200 bg-blue-50/50">
          <CardContent className="pt-6 space-y-3">
            {uploadPhase === 'uploading' && (
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
              </>
            )}

            {(uploadPhase === 'processing' || (uploadPhase === 'idle' && activeImport)) && activeImport && (
              <>
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="font-medium text-blue-900 flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                    Processing SAP data...
                  </span>
                  <span className="tabular-nums text-blue-800">{processingProgress}%</span>
                </div>
                <Progress value={processingProgress} className="h-2" />
                <p className="text-xs text-blue-800/80">
                  {(Number(activeImport.processed_records) || 0).toLocaleString()}
                  {' / '}
                  {(Number(activeImport.total_records) || 0).toLocaleString()} records processed
                  {(Number(activeImport.failed_records) || 0) > 0 && (
                    <>
                      {' · '}
                      <span className="text-red-700">
                        {(Number(activeImport.failed_records) || 0).toLocaleString()} failed
                      </span>
                    </>
                  )}
                </p>
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
                  <th className="text-left p-3">Status</th>
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
                      <td className="p-3">{getStatusBadge(imp.status)}</td>
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
                          onClick={() => window.location.href = `/sap-imports/${imp.id}`}
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
                No import history available. Start your first import above.
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
    </div>
  );
};

export default SapImportDashboard;

