'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
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

interface SapImport {
  id: string;
  import_date: string;
  import_timestamp: string;
  status: string;
  total_records: number;
  processed_records: number;
  failed_records: number;
}

const SapImportDashboard: React.FC = () => {
  const [imports, setImports] = useState<SapImport[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [showFileDialog, setShowFileDialog] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  useEffect(() => {
    loadImports();
  }, []);

  const loadImports = async () => {
    try {
      const response = await api.get('/sap-master-v2/imports');
      setImports(response.data.data);
    } catch (error) {
      console.error('Failed to load imports:', error);
    } finally {
      setLoading(false);
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
      setSelectedFile(file);
      setShowFileDialog(false);
      // Automatically start import after file selection
      handleStartImportWithFile(file);
    }
  };

  const handleStartImportWithFile = async (file: File) => {
    setImporting(true);
    try {
      // Create FormData for file upload
      const formData = new FormData();
      formData.append('file', file);

      // Do not set Content-Type: FormData needs multipart boundary from the browser/axios.
      const response = await api.post('/sap-master-v2/import-upload', formData, {
        timeout: 0,
      });
      
      alert(`Import started successfully!\nFile: ${file.name}\nImport ID: ${response.data.data.importId}\nTotal Records: ${response.data.data.totalRecords}`);
      loadImports();
    } catch (error: unknown) {
      console.error('Failed to start import:', error);
      alert(`Import failed: ${formatImportFailureMessage(error)}`);
    } finally {
      setImporting(false);
      setSelectedFile(null);
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
              {importing ? 'Importing...' : '📁 Browse & Import File'}
            </Button>
          </div>
        </CardHeader>
      </Card>

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
    </div>
  );
};

export default SapImportDashboard;

