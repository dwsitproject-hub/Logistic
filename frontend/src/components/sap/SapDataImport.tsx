'use client';

import React, { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Upload, FileText, CheckCircle, XCircle, AlertCircle } from 'lucide-react';
import { api } from '@/lib/api';

interface ImportResult {
  success: boolean;
  importId?: string;
  totalRecords: number;
  processedRecords: number;
  failedRecords: number;
  errors?: string[];
}

export default function SapDataImport() {
  const [file, setFile] = useState<File | null>(null);
  const [importDate, setImportDate] = useState<string>('');
  const [isImporting, setIsImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [progress, setProgress] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0];
    if (selectedFile) {
      setFile(selectedFile);
      setImportResult(null);
    }
  };

  const handleImport = async () => {
    if (!file) {
      alert('Please select a file to import');
      return;
    }

    setIsImporting(true);
    setProgress(0);

    try {
      // Simulate progress
      const progressInterval = setInterval(() => {
        setProgress(prev => {
          if (prev >= 90) {
            clearInterval(progressInterval);
            return 90;
          }
          return prev + 10;
        });
      }, 200);

      // Read and parse CSV file
      const csvData = await readCSVFile(file);
      
      // Send to backend
      const response = await api.post('/sap/import', {
        data: csvData,
        importDate: importDate || new Date().toISOString().split('T')[0]
      });

      clearInterval(progressInterval);
      setProgress(100);

      if (response.data.success) {
        setImportResult(response.data.data);
      } else {
        throw new Error(response.data.error?.message || 'Import failed');
      }

    } catch (error) {
      console.error('Import failed:', error);
      setImportResult({
        success: false,
        totalRecords: 0,
        processedRecords: 0,
        failedRecords: 0,
        errors: [error instanceof Error ? error.message : 'Unknown error']
      });
    } finally {
      setIsImporting(false);
    }
  };

  const readCSVFile = (file: File): Promise<any[]> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      
      reader.onload = (e) => {
        try {
          const csv = e.target?.result as string;
          const lines = csv.split('\n');
          const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
          
          const data = lines.slice(1).map((line, index) => {
            if (line.trim()) {
              const values = line.split(',').map(v => v.trim().replace(/"/g, ''));
              const row: any = {};
              
              headers.forEach((header, i) => {
                row[header] = values[i] || '';
              });
              
              return row;
            }
            return null;
          }).filter(row => row !== null);
          
          resolve(data);
        } catch (error) {
          reject(error);
        }
      };
      
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsText(file);
    });
  };

  const resetImport = () => {
    setFile(null);
    setImportDate('');
    setImportResult(null);
    setProgress(0);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5" />
            SAP Data Import
          </CardTitle>
          <CardDescription>
            Import daily SAP data from spreadsheet files. The system will automatically
            process and categorize data based on user roles and field mappings.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* File Selection */}
          <div className="space-y-2">
            <Label htmlFor="file">Select CSV/Excel File</Label>
            <Input
              ref={fileInputRef}
              id="file"
              type="file"
              accept=".csv,.xlsx,.xls"
              onChange={handleFileSelect}
              disabled={isImporting}
            />
            {file && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <FileText className="h-4 w-4" />
                {file.name} ({(file.size / 1024).toFixed(1)} KB)
              </div>
            )}
          </div>

          {/* Import Date */}
          <div className="space-y-2">
            <Label htmlFor="importDate">Import Date (Optional)</Label>
            <Input
              id="importDate"
              type="date"
              value={importDate}
              onChange={(e) => setImportDate(e.target.value)}
              disabled={isImporting}
            />
          </div>

          {/* Import Button */}
          <div className="flex gap-2">
            <Button 
              onClick={handleImport} 
              disabled={!file || isImporting}
              className="flex items-center gap-2"
            >
              {isImporting ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                  Importing...
                </>
              ) : (
                <>
                  <Upload className="h-4 w-4" />
                  Import Data
                </>
              )}
            </Button>
            
            {importResult && (
              <Button variant="outline" onClick={resetImport}>
                Import New File
              </Button>
            )}
          </div>

          {/* Progress Bar */}
          {isImporting && (
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>Importing data...</span>
                <span>{progress}%</span>
              </div>
              <Progress value={progress} className="w-full" />
            </div>
          )}

          {/* Import Results */}
          {importResult && (
            <div className="space-y-4">
              <Alert className={importResult.success ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}>
                <div className="flex items-center gap-2">
                  {importResult.success ? (
                    <CheckCircle className="h-4 w-4 text-green-600" />
                  ) : (
                    <XCircle className="h-4 w-4 text-red-600" />
                  )}
                  <AlertDescription>
                    {importResult.success ? 'Import completed successfully!' : 'Import completed with errors'}
                  </AlertDescription>
                </div>
              </Alert>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="text-center">
                  <div className="text-2xl font-bold text-blue-600">{importResult.totalRecords}</div>
                  <div className="text-sm text-muted-foreground">Total Records</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-green-600">{importResult.processedRecords}</div>
                  <div className="text-sm text-muted-foreground">Processed</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-red-600">{importResult.failedRecords}</div>
                  <div className="text-sm text-muted-foreground">Failed</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-purple-600">
                    {importResult.importId ? importResult.importId.slice(-8) : 'N/A'}
                  </div>
                  <div className="text-sm text-muted-foreground">Import ID</div>
                </div>
              </div>

              {importResult.errors && importResult.errors.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="h-4 w-4 text-orange-600" />
                    <span className="font-medium">Errors ({importResult.errors.length})</span>
                  </div>
                  <div className="max-h-32 overflow-y-auto space-y-1">
                    {importResult.errors.map((error, index) => (
                      <Badge key={index} variant="destructive" className="text-xs">
                        {error}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Instructions */}
      <Card>
        <CardHeader>
          <CardTitle>Import Instructions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p><strong>Supported formats:</strong> CSV, Excel (.xlsx, .xls)</p>
          <p><strong>Required columns:</strong> Contract Number, Trader Name, Shipment ID, Logistics Team</p>
          <p><strong>Date formats:</strong> YYYY-MM-DD, DD/MM/YYYY, MM/DD/YYYY</p>
          <p><strong>Data processing:</strong> The system will automatically categorize data by user roles based on field content and color coding from the original spreadsheet.</p>
        </CardContent>
      </Card>
    </div>
  );
}
