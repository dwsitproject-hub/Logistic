'use client';

import React, { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import AppLayout from '@/components/Layout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import api from '@/lib/api';
import { formatDateDMY, formatDateTimeDMY, formatTimeHMS } from '@/lib/dateFormat';

interface ImportDetail {
  id: string;
  import_date: string;
  import_timestamp: string;
  status: string;
  total_records: number;
  processed_records: number;
  failed_records: number;
  skipped_records?: number;
  error_log: string | null;
}

interface ImportRecord {
  id: string;
  contract_number: string;
  shipment_id: string;
  po_number: string;
  sto_number: string;
  supplier_name: string;
  product: string;
  vessel_name: string;
  row_number: number;
  record_status: string;
  error_message: string | null;
  created_at: string;
  processed_data?: any;
  raw_data?: any;
}

interface FieldMapping {
  id: string;
  sap_field_name: string;
  display_name: string;
  field_type: string;
  user_role: string;
  is_required: boolean;
  is_editable: boolean;
  sap_source: string | null;
  color_code: string | null;
  sort_order: number;
}

export default function ImportDetailPage() {
  const params = useParams();
  const router = useRouter();
  const [importData, setImportData] = useState<ImportDetail | null>(null);
  const [records, setRecords] = useState<ImportRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState<string[]>([]);
  const [fieldMappings, setFieldMappings] = useState<FieldMapping[]>([]);
  const [selectedRecord, setSelectedRecord] = useState<ImportRecord | null>(null);
  const [userRole, setUserRole] = useState<string>('ADMIN'); // Get from auth context in production

  useEffect(() => {
    loadImportDetail();
    loadFieldMappings();
  }, [params.id]);

  const loadImportDetail = async () => {
    try {
      const response = await api.get(`/sap-master-v2/imports/${params.id}`);
      setImportData(response.data.data.import);
      setRecords(response.data.data.records || []);
      
      // Parse error log if exists
      if (response.data.data.import.error_log) {
        try {
          const errorArray = JSON.parse(response.data.data.import.error_log);
          setErrors(errorArray);
        } catch (e) {
          setErrors([response.data.data.import.error_log]);
        }
      }
    } catch (error: any) {
      console.error('Failed to load import details:', error);
      alert('Failed to load import details: ' + (error.response?.data?.error?.message || error.message));
    } finally {
      setLoading(false);
    }
  };

  const loadFieldMappings = async () => {
    try {
      // ADMIN sees all fields, others see only their role
      const queryParam = userRole === 'ADMIN' ? '' : `?role=${userRole}`;
      const response = await api.get(`/sap/field-mappings${queryParam}`);
      setFieldMappings(response.data.data || []);
    } catch (error: any) {
      console.error('Failed to load field mappings:', error);
    }
  };

  const getFieldValue = (record: ImportRecord, fieldName: string): any => {
    if (!record.processed_data) return null;
    
    // Mapping from field mapping names (PascalCase_With_Underscores) to backend snake_case
    const fieldNameMapping: { [key: string]: string } = {
      'Group': 'group',
      'Supplier': 'supplier',
      'Contract_Date': 'contract_date',
      'Product': 'product',
      'Contract_Number': 'contract_no',
      'PO_Number': 'po_no',
      'Incoterm': 'incoterm',
      'Sea_Land': 'sea_land',
      'Contract_Quantity': 'contract_quantity',
      'Unit_Price': 'unit_price',
      'Due_Date_Delivery_Start': 'due_date_delivery_start',
      'Due_Date_Delivery_End': 'due_date_delivery_end',
      'Source_Type': 'source',
      'Contract_Type': 'ltc_spot',
      'Status': 'status',
      'STO_Number': 'sto_no',
      'STO_Quantity': 'sto_quantity',
      'Logistics_Classification': 'logistics_area_classification',
      'PO_Classification': 'po_classification',
      'Due_Date_Payment': 'due_date_payment',
      'DP_Date': 'dp_date',
      'Payoff_Date': 'payoff_date',
      'Payment_Deviation': 'payment_date_deviation_days',
      'Cargo_Readiness_1': 'cargo_readiness_at_starting_location',
      'Truck_Loading_1': 'truck_loading_at_starting_location',
      'Truck_Unloading_1': 'truck_unloading_at_starting_location',
      'Trucking_Owner_1': 'trucking_owner_at_starting_location',
      'Trucking_OA_Budget_1': 'trucking_oa_budget_at_starting_location',
      'Trucking_OA_Actual_1': 'trucking_oa_actual_at_starting_location',
      'Quantity_Sent_Trucking': 'quantity_sent_via_trucking_based_on_surat_jalan',
      'Quantity_Delivered_Trucking': 'quantity_delivered_via_trucking',
      'Trucking_Start_Date_1': 'trucking_starting_date_at_starting_location',
      'Trucking_Completion_Date_1': 'trucking_completion_date_at_starting_location',
      'Vessel_Code': 'vessel_code',
      'Vessel_Name': 'vessel_name',
      'Vessel_Owner': 'vessel_owner',
      'Voyage_Number': 'voyage_no'
    };
    
    // Get the mapped field name
    const mappedFieldName = fieldNameMapping[fieldName] || fieldName.toLowerCase().replace(/_/g, '_');
    
    // Try to find value in nested structure
    const { contract, shipment, payment, trucking, vessel, raw } = record.processed_data;
    
    // Check contract fields
    if (contract && contract[mappedFieldName] !== undefined && contract[mappedFieldName] !== null) {
      return contract[mappedFieldName];
    }
    
    // Check shipment fields
    if (shipment && shipment[mappedFieldName] !== undefined && shipment[mappedFieldName] !== null) {
      return shipment[mappedFieldName];
    }
    
    // Check payment fields
    if (payment && payment[mappedFieldName] !== undefined && payment[mappedFieldName] !== null) {
      return payment[mappedFieldName];
    }
    
    // Check vessel fields
    if (vessel && vessel[mappedFieldName] !== undefined && vessel[mappedFieldName] !== null) {
      return vessel[mappedFieldName];
    }
    
    // Check trucking data (array of locations)
    if (trucking && Array.isArray(trucking)) {
      for (const truckingItem of trucking) {
        if (truckingItem.data && truckingItem.data[mappedFieldName] !== undefined && truckingItem.data[mappedFieldName] !== null) {
          return truckingItem.data[mappedFieldName];
        }
      }
    }
    
    // Check raw data
    if (raw && raw[mappedFieldName] !== undefined && raw[mappedFieldName] !== null) {
      return raw[mappedFieldName];
    }
    
    // Fallback: try to find in raw object directly (for fields that weren't categorized)
    if (record.processed_data.raw) {
      const rawObj = record.processed_data.raw;
      // Try various field name formats
      if (rawObj[fieldName] !== undefined && rawObj[fieldName] !== null) {
        return rawObj[fieldName];
      }
      if (rawObj[mappedFieldName] !== undefined && rawObj[mappedFieldName] !== null) {
        return rawObj[mappedFieldName];
      }
    }
    
    return null;
  };

  const formatFieldValue = (value: any, fieldType: string): string => {
    if (value === null || value === undefined || value === '') return '-';
    
    switch (fieldType) {
      case 'date':
        try {
          return formatDateDMY(String(value));
        } catch {
          return String(value);
        }
      case 'number':
        return typeof value === 'number' ? value.toLocaleString() : String(value);
      case 'boolean':
        return value ? 'Yes' : 'No';
      default:
        return String(value);
    }
  };

  const groupFieldsByRole = (mappings: FieldMapping[]) => {
    const grouped: { [role: string]: FieldMapping[] } = {};
    
    mappings.forEach(mapping => {
      if (!grouped[mapping.user_role]) {
        grouped[mapping.user_role] = [];
      }
      grouped[mapping.user_role].push(mapping);
    });
    
    // Sort each group by sort_order
    Object.keys(grouped).forEach(role => {
      grouped[role].sort((a, b) => a.sort_order - b.sort_order);
    });
    
    return grouped;
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
      <AppLayout>
        <div className="flex items-center justify-center p-12">
          <div className="text-gray-500">Loading import details...</div>
        </div>
      </AppLayout>
    );
  }

  if (!importData) {
    return (
      <AppLayout>
        <Card>
          <CardContent className="p-12 text-center">
            <div className="text-red-500 text-4xl mb-4">❌</div>
            <div className="text-xl font-semibold mb-2">Import Not Found</div>
            <Button onClick={() => router.push('/sap-imports')} className="mt-4">
              Back to Imports
            </Button>
          </CardContent>
        </Card>
      </AppLayout>
    );
  }

  const successRate = importData.total_records > 0
    ? ((importData.processed_records / importData.total_records) * 100).toFixed(1)
    : '0.0';

  return (
    <AppLayout>
      <div className="space-y-6">
        <div>
          <Button variant="outline" onClick={() => router.push('/sap-imports')} className="mb-4">
            ← Back to Imports
          </Button>
          <h1 className="text-3xl font-bold text-gray-900">Import Details</h1>
          <p className="text-gray-600 mt-2">
            Import ID: {importData.id}
          </p>
        </div>

      <div className="space-y-6">
        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Import Date</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {formatDateDMY(importData.import_date)}
              </div>
              <div className="text-sm text-gray-500">
                {formatTimeHMS(importData.import_timestamp)}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Status</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {getStatusBadge(importData.status)}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Total Records</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {importData.total_records.toLocaleString()}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Success Rate</CardDescription>
            </CardHeader>
            <CardContent>
              <div className={`text-2xl font-bold ${parseFloat(successRate) >= 95 ? 'text-green-600' : 'text-red-600'}`}>
                {successRate}%
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Detailed Stats */}
        <Card>
          <CardHeader>
            <CardTitle>Processing Results</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex justify-between items-center p-3 bg-green-50 rounded">
                <span className="font-medium">Successfully Processed</span>
                <span className="text-2xl font-bold text-green-600">
                  {importData.processed_records.toLocaleString()}
                </span>
              </div>
              
              {typeof importData.skipped_records === 'number' && (
                <div className="flex justify-between items-center p-3 bg-yellow-50 rounded">
                  <span className="font-medium">Skipped Records</span>
                  <span className="text-2xl font-bold text-yellow-600">
                    {importData.skipped_records.toLocaleString()}
                  </span>
                </div>
              )}

              <div className="flex justify-between items-center p-3 bg-red-50 rounded">
                <span className="font-medium">Failed Records</span>
                <span className="text-2xl font-bold text-red-600">
                  {importData.failed_records.toLocaleString()}
                </span>
              </div>

              <div className="flex justify-between items-center p-3 bg-gray-50 rounded">
                <span className="font-medium">Total Imported</span>
                <span className="text-2xl font-bold">
                  {importData.total_records.toLocaleString()}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Error Log */}
        {errors.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Error Log ({errors.length} errors)</CardTitle>
              <CardDescription>
                Details of failed records
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {errors.slice(0, 50).map((error, index) => (
                  <div key={index} className="p-2 bg-red-50 border border-red-200 rounded text-sm">
                    <span className="text-red-600">{error}</span>
                  </div>
                ))}
                {errors.length > 50 && (
                  <div className="p-3 bg-gray-100 text-center text-sm">
                    ... and {errors.length - 50} more errors
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Import Information */}
        <Card>
          <CardHeader>
            <CardTitle>Import Information</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <div className="text-sm text-gray-500">Import ID</div>
                <div className="font-mono text-sm">{importData.id}</div>
              </div>
              <div>
                <div className="text-sm text-gray-500">Import Timestamp</div>
                <div className="font-medium">{formatDateTimeDMY(importData.import_timestamp)}</div>
              </div>
              <div>
                <div className="text-sm text-gray-500">Import Date</div>
                <div className="font-medium">{formatDateDMY(importData.import_date)}</div>
              </div>
              <div>
                <div className="text-sm text-gray-500">Status</div>
                <div>{getStatusBadge(importData.status)}</div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* All Imported Records */}
        <Card>
          <CardHeader>
            <CardTitle>Imported Records ({records.length})</CardTitle>
            <CardDescription>
              All records from this import (success and failed)
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b">
                    <th className="text-left p-3">Row</th>
                    <th className="text-left p-3">Contract/PO</th>
                    <th className="text-left p-3">Shipment/STO</th>
                    <th className="text-left p-3">Supplier</th>
                    <th className="text-left p-3">Product</th>
                    <th className="text-left p-3">Vessel</th>
                    <th className="text-left p-3">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {records.map((record) => (
                    <tr 
                      key={record.id} 
                      className="border-b hover:bg-gray-50 cursor-pointer"
                      onClick={() => setSelectedRecord(record)}
                    >
                      <td className="p-3 text-sm font-mono">{record.row_number}</td>
                      <td className="p-3">
                        <div className="font-medium">{(record as any).display_contract_po || '-'}</div>
                      </td>
                      <td className="p-3">
                        <div className="font-medium">{(record as any).display_shipment_sto || '-'}</div>
                      </td>
                      <td className="p-3">
                        <div className="text-sm">{(record as any).display_supplier_name || '-'}</div>
                      </td>
                      <td className="p-3">
                        <div className="text-sm">{(record as any).display_product || '-'}</div>
                      </td>
                      <td className="p-3">
                        <div className="text-sm">{(record as any).display_vessel_name || '-'}</div>
                      </td>
                      <td className="p-3">
                        {record.record_status === 'processed' ? (
                          <Badge variant="default">✅ Success</Badge>
                        ) : record.record_status === 'error' ? (
                          <Badge variant="destructive">❌ Failed</Badge>
                        ) : (
                          <Badge variant="secondary">{record.record_status}</Badge>
                        )}
                        {record.error_message && (
                          <div className="text-xs text-red-600 mt-1">{record.error_message}</div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {records.length === 0 && (
                <div className="text-center text-gray-500 py-12">
                  No records found for this import.
                </div>
              )}
            </div>

          </CardContent>
        </Card>

        {/* Detailed Field View - Role-based Sections */}
        {selectedRecord && fieldMappings.length > 0 && (
          <Card>
            <CardHeader>
              <div className="flex justify-between items-center">
                <div>
                  <CardTitle>Record Details - Row {selectedRecord.row_number}</CardTitle>
                  <CardDescription>
                    {userRole === 'ADMIN' ? 'All fields (267 fields across all roles)' : `Fields for ${userRole} role`}
                  </CardDescription>
                </div>
                <Button variant="outline" size="sm" onClick={() => setSelectedRecord(null)}>
                  Close
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {(() => {
                const groupedFields = groupFieldsByRole(fieldMappings);
                const roles = Object.keys(groupedFields).sort();
                
                return (
                  <div className="space-y-6">
                    {roles.map(role => {
                      const roleFields = groupedFields[role];
                      const filledFields = roleFields.filter(f => {
                        const val = getFieldValue(selectedRecord, f.sap_field_name);
                        return val !== null && val !== undefined && val !== '';
                      });
                      
                      return (
                        <div key={role} className="border rounded-lg p-4">
                          <div className="flex items-center justify-between mb-4">
                            <h3 className="text-lg font-semibold flex items-center gap-2">
                              {role}
                              <Badge variant="secondary">
                                {filledFields.length} / {roleFields.length} fields populated
                              </Badge>
                            </h3>
                          </div>
                          
                          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {roleFields.map(field => {
                              const value = getFieldValue(selectedRecord, field.sap_field_name);
                              const formattedValue = formatFieldValue(value, field.field_type);
                              const isEmpty = value === null || value === undefined || value === '';
                              
                              return (
                                <div 
                                  key={field.id} 
                                  className={`p-3 rounded border ${isEmpty ? 'bg-gray-50' : 'bg-white'}`}
                                  style={field.color_code ? { borderLeftColor: field.color_code, borderLeftWidth: '4px' } : {}}
                                >
                                  <div className="flex items-start justify-between mb-1">
                                    <div className="text-xs text-gray-500 font-medium">
                                      {field.display_name}
                                    </div>
                                    {field.is_required && (
                                      <Badge variant="destructive" className="text-xs px-1 py-0">Required</Badge>
                                    )}
                                  </div>
                                  <div className={`text-sm ${isEmpty ? 'text-gray-400' : 'font-medium'}`}>
                                    {formattedValue}
                                  </div>
                                  <div className="text-xs text-gray-400 mt-1">
                                    {field.sap_field_name}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                    
                    {/* Raw JSON fallback for debugging */}
                    <details className="border rounded p-3">
                      <summary className="cursor-pointer font-medium text-sm">Raw JSON Data</summary>
                      <pre className="bg-gray-50 p-3 rounded border max-h-80 overflow-auto text-xs mt-2">
{JSON.stringify({processed: selectedRecord.processed_data, raw: selectedRecord.raw_data}, null, 2)}
                      </pre>
                    </details>
                  </div>
                );
              })()}
            </CardContent>
          </Card>
        )}
      </div>
      </div>
    </AppLayout>
  );
}

