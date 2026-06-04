'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { 
  Database, 
  Filter, 
  Download, 
  Eye, 
  Edit, 
  CheckCircle, 
  XCircle, 
  Clock,
  TrendingUp,
  Users,
  Calendar
} from 'lucide-react';
import { api } from '@/lib/api';
import { formatDateDMY } from '@/lib/dateFormat';

interface SapDataRow {
  id: string;
  contract_number: string;
  shipment_id: string;
  trader_name: string;
  logistics_team: string;
  estimated_date: string;
  actual_date: string;
  status: string;
  priority: string;
  data: any;
  import_date: string;
  created_at: string;
}

interface ImportHistory {
  id: string;
  import_date: string;
  import_timestamp: string;
  status: string;
  total_records: number;
  processed_records: number;
  failed_records: number;
  created_at: string;
}

export default function SapDataViewer() {
  const [data, setData] = useState<SapDataRow[]>([]);
  const [importHistory, setImportHistory] = useState<ImportHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({
    userRole: 'all',
    status: 'all',
    dateFrom: '',
    dateTo: '',
    search: ''
  });
  const [selectedImport, setSelectedImport] = useState<string>('');

  useEffect(() => {
    loadData();
    loadImportHistory();
  }, [filters, selectedImport]);

  const loadData = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      
      if (filters.userRole && filters.userRole !== 'all') params.append('userRole', filters.userRole);
      if (filters.status && filters.status !== 'all') params.append('status', filters.status);
      if (filters.dateFrom) params.append('dateFrom', filters.dateFrom);
      if (filters.dateTo) params.append('dateTo', filters.dateTo);
      if (selectedImport) params.append('importId', selectedImport);

      const response = await api.get(`/sap/processed-data?${params.toString()}`);
      
      if (response.data.success) {
        let filteredData = response.data.data.processedData;
        
        // Client-side search filter
        if (filters.search) {
          const searchLower = filters.search.toLowerCase();
          filteredData = filteredData.filter((row: SapDataRow) =>
            row.contract_number?.toLowerCase().includes(searchLower) ||
            row.shipment_id?.toLowerCase().includes(searchLower) ||
            row.trader_name?.toLowerCase().includes(searchLower) ||
            row.logistics_team?.toLowerCase().includes(searchLower)
          );
        }
        
        setData(filteredData);
      }
    } catch (error) {
      console.error('Failed to load data:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadImportHistory = async () => {
    try {
      const response = await api.get('/sap/imports');
      if (response.data.success) {
        setImportHistory(response.data.data.imports);
      }
    } catch (error) {
      console.error('Failed to load import history:', error);
    }
  };

  const getStatusBadge = (status: string) => {
    const statusConfig = {
      'completed': { color: 'bg-green-100 text-green-800', icon: CheckCircle },
      'pending': { color: 'bg-yellow-100 text-yellow-800', icon: Clock },
      'failed': { color: 'bg-red-100 text-red-800', icon: XCircle },
      'processing': { color: 'bg-blue-100 text-blue-800', icon: Clock }
    };

    const config = statusConfig[status as keyof typeof statusConfig] || statusConfig.pending;
    const Icon = config.icon;

    return (
      <Badge className={`${config.color} flex items-center gap-1`}>
        <Icon className="h-3 w-3" />
        {status}
      </Badge>
    );
  };

  const getPriorityBadge = (priority: string) => {
    const priorityConfig = {
      'high': 'bg-red-100 text-red-800',
      'medium': 'bg-yellow-100 text-yellow-800',
      'low': 'bg-green-100 text-green-800'
    };

    return (
      <Badge className={priorityConfig[priority as keyof typeof priorityConfig] || priorityConfig.medium}>
        {priority}
      </Badge>
    );
  };

  const exportData = async () => {
    try {
      const response = await api.get('/sap/processed-data', {
        responseType: 'blob',
        params: { ...filters, export: true }
      });
      
      const blob = new Blob([response.data], { type: 'text/csv' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `sap-data-${new Date().toISOString().split('T')[0]}.csv`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error('Export failed:', error);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold">SAP Data Viewer</h2>
          <p className="text-muted-foreground">View and manage imported SAP data</p>
        </div>
        <Button onClick={exportData} className="flex items-center gap-2">
          <Download className="h-4 w-4" />
          Export Data
        </Button>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Filter className="h-5 w-5" />
            Filters
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
            <div className="space-y-2">
              <Label htmlFor="search">Search</Label>
              <Input
                id="search"
                placeholder="Search records..."
                value={filters.search}
                onChange={(e) => setFilters(prev => ({ ...prev, search: e.target.value }))}
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="userRole">User Role</Label>
              <Select value={filters.userRole} onValueChange={(value) => setFilters(prev => ({ ...prev, userRole: value }))}>
                <SelectTrigger>
                  <SelectValue placeholder="All roles" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All roles</SelectItem>
                  <SelectItem value="TRADING">Trading</SelectItem>
                  <SelectItem value="LOGISTICS">Logistics</SelectItem>
                  <SelectItem value="FINANCE">Finance</SelectItem>
                  <SelectItem value="MANAGEMENT">Management</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="status">Status</Label>
              <Select value={filters.status} onValueChange={(value) => setFilters(prev => ({ ...prev, status: value }))}>
                <SelectTrigger>
                  <SelectValue placeholder="All statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="failed">Failed</SelectItem>
                  <SelectItem value="processing">Processing</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="dateFrom">From Date</Label>
              <Input
                id="dateFrom"
                type="date"
                value={filters.dateFrom}
                onChange={(e) => setFilters(prev => ({ ...prev, dateFrom: e.target.value }))}
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="dateTo">To Date</Label>
              <Input
                id="dateTo"
                type="date"
                value={filters.dateTo}
                onChange={(e) => setFilters(prev => ({ ...prev, dateTo: e.target.value }))}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Data Tabs */}
      <Tabs defaultValue="data" className="space-y-4">
        <TabsList>
          <TabsTrigger value="data" className="flex items-center gap-2">
            <Database className="h-4 w-4" />
            Data ({data.length})
          </TabsTrigger>
          <TabsTrigger value="imports" className="flex items-center gap-2">
            <Calendar className="h-4 w-4" />
            Import History ({importHistory.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="data">
          <Card>
            <CardHeader>
              <CardTitle>Processed Data</CardTitle>
              <CardDescription>
                View and manage processed SAP data records
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="flex justify-center py-8">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                </div>
              ) : data.length === 0 ? (
                <Alert>
                  <AlertDescription>
                    No data found matching your filters. Try adjusting your search criteria.
                  </AlertDescription>
                </Alert>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Contract</TableHead>
                        <TableHead>Shipment ID</TableHead>
                        <TableHead>Trader</TableHead>
                        <TableHead>Logistics Team</TableHead>
                        <TableHead>Estimated Date</TableHead>
                        <TableHead>Actual Date</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Priority</TableHead>
                        <TableHead>Import Date</TableHead>
                        <TableHead>Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.map((row) => (
                        <TableRow key={row.id}>
                          <TableCell className="font-medium">{row.contract_number}</TableCell>
                          <TableCell>{row.shipment_id}</TableCell>
                          <TableCell>{row.trader_name}</TableCell>
                          <TableCell>{row.logistics_team}</TableCell>
                          <TableCell>{row.estimated_date ? formatDateDMY(row.estimated_date) : '-'}</TableCell>
                          <TableCell>{row.actual_date ? formatDateDMY(row.actual_date) : '-'}</TableCell>
                          <TableCell>{getStatusBadge(row.status)}</TableCell>
                          <TableCell>{getPriorityBadge(row.priority)}</TableCell>
                          <TableCell>{formatDateDMY(row.import_date)}</TableCell>
                          <TableCell>
                            <div className="flex gap-2">
                              <Button size="sm" variant="outline">
                                <Eye className="h-3 w-3" />
                              </Button>
                              <Button size="sm" variant="outline">
                                <Edit className="h-3 w-3" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="imports">
          <Card>
            <CardHeader>
              <CardTitle>Import History</CardTitle>
              <CardDescription>
                View history of SAP data imports
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Import Date</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Total Records</TableHead>
                      <TableHead>Processed</TableHead>
                      <TableHead>Failed</TableHead>
                      <TableHead>Import Time</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {importHistory.map((import_) => (
                      <TableRow key={import_.id}>
                        <TableCell className="font-medium">
                          {formatDateDMY(import_.import_date)}
                        </TableCell>
                        <TableCell>{getStatusBadge(import_.status)}</TableCell>
                        <TableCell>{import_.total_records}</TableCell>
                        <TableCell className="text-green-600">{import_.processed_records}</TableCell>
                        <TableCell className="text-red-600">{import_.failed_records}</TableCell>
                        <TableCell>{new Date(import_.import_timestamp).toLocaleString()}</TableCell>
                        <TableCell>
                          <Button 
                            size="sm" 
                            variant="outline"
                            onClick={() => setSelectedImport(import_.id)}
                          >
                            <Eye className="h-3 w-3" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
