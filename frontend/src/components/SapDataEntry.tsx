'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Badge } from './ui/badge';
import api from '../lib/api';

interface FieldMapping {
  id: string;
  sap_field_name: string;
  display_name: string;
  field_type: string;
  user_role: string;
  is_required: boolean;
  is_editable: boolean;
  color_code: string;
  sort_order: number;
}

interface PendingEntry {
  id: string;
  contract_number: string;
  shipment_id: string;
  supplier_name: string;
  product: string;
  data: any;
  created_at: string;
  completed_fields: number;
}

interface SapDataEntryProps {
  userRole: string;
}

const SapDataEntry: React.FC<SapDataEntryProps> = ({ userRole }) => {
  const [pendingEntries, setPendingEntries] = useState<PendingEntry[]>([]);
  const [selectedEntry, setSelectedEntry] = useState<PendingEntry | null>(null);
  const [fieldMappings, setFieldMappings] = useState<FieldMapping[]>([]);
  const [formData, setFormData] = useState<{ [key: string]: any }>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadPendingEntries();
    loadFieldMappings();
  }, [userRole]);

  const loadPendingEntries = async () => {
    try {
      const response = await api.get('/sap-master-v2/pending-entries', {
        params: { role: userRole }
      });
      setPendingEntries(response.data.data);
    } catch (error) {
      console.error('Failed to load pending entries:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadFieldMappings = async () => {
    try {
      const response = await api.get('/sap/field-mappings', {
        params: { role: userRole }
      });
      setFieldMappings(response.data.data);
    } catch (error) {
      console.error('Failed to load field mappings:', error);
    }
  };

  const handleSelectEntry = (entry: PendingEntry) => {
    setSelectedEntry(entry);
    // Initialize form data from entry data
    const initialData: { [key: string]: any } = {};
    Object.keys(entry.data).forEach(key => {
      initialData[key] = entry.data[key] || '';
    });
    setFormData(initialData);
  };

  const handleFieldChange = (fieldName: string, value: any) => {
    setFormData(prev => ({
      ...prev,
      [fieldName]: value
    }));
  };

  const handleSave = async () => {
    if (!selectedEntry) return;

    setSaving(true);
    try {
      await api.post('/sap/user-input', {
        processed_data_id: selectedEntry.id,
        field_values: formData
      });

      alert('Data saved successfully!');
      loadPendingEntries();
      setSelectedEntry(null);
    } catch (error) {
      console.error('Failed to save data:', error);
      alert('Failed to save data. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const renderField = (mapping: FieldMapping) => {
    const value = formData[mapping.sap_field_name] || '';
    const isReadOnly = !mapping.is_editable;

    return (
      <div key={mapping.id} className="space-y-2">
        <Label htmlFor={mapping.sap_field_name}>
          {mapping.display_name}
          {mapping.is_required && <span className="text-red-500 ml-1">*</span>}
          {!mapping.is_editable && <Badge variant="secondary" className="ml-2">SAP</Badge>}
        </Label>
        
        {mapping.field_type === 'number' ? (
          <Input
            id={mapping.sap_field_name}
            type="number"
            value={value}
            onChange={(e) => handleFieldChange(mapping.sap_field_name, e.target.value)}
            disabled={isReadOnly}
            className={isReadOnly ? 'bg-gray-100' : ''}
          />
        ) : mapping.field_type === 'date' ? (
          <Input
            id={mapping.sap_field_name}
            type="date"
            value={value}
            onChange={(e) => handleFieldChange(mapping.sap_field_name, e.target.value)}
            disabled={isReadOnly}
            className={isReadOnly ? 'bg-gray-100' : ''}
          />
        ) : (
          <Input
            id={mapping.sap_field_name}
            type="text"
            value={value}
            onChange={(e) => handleFieldChange(mapping.sap_field_name, e.target.value)}
            disabled={isReadOnly}
            className={isReadOnly ? 'bg-gray-100' : ''}
          />
        )}
      </div>
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-gray-500">Loading...</div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
      {/* Left Panel - List of Pending Entries */}
      <div className="md:col-span-1">
        <Card>
          <CardHeader>
            <CardTitle>Pending Data Entry</CardTitle>
            <CardDescription>
              {pendingEntries.length} record(s) need your input
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {pendingEntries.map((entry) => (
                <div
                  key={entry.id}
                  onClick={() => handleSelectEntry(entry)}
                  className={`p-3 border rounded-lg cursor-pointer hover:bg-gray-50 ${
                    selectedEntry?.id === entry.id ? 'border-blue-500 bg-blue-50' : ''
                  }`}
                >
                  <div className="font-medium text-sm">
                    {entry.contract_number || entry.shipment_id}
                  </div>
                  <div className="text-xs text-gray-500">
                    {entry.supplier_name}
                  </div>
                  <div className="text-xs text-gray-500">
                    {entry.product}
                  </div>
                  <div className="mt-2">
                    <Badge variant="outline" className="text-xs">
                      {entry.completed_fields} fields completed
                    </Badge>
                  </div>
                </div>
              ))}
              
              {pendingEntries.length === 0 && (
                <div className="text-center text-gray-500 py-8">
                  No pending entries
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Right Panel - Data Entry Form */}
      <div className="md:col-span-2">
        {selectedEntry ? (
          <Card>
            <CardHeader>
              <CardTitle>Data Entry Form</CardTitle>
              <CardDescription>
                Complete the required fields for {selectedEntry.contract_number || selectedEntry.shipment_id}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-6">
                {/* Group fields by section */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {fieldMappings
                    .filter(m => m.user_role === userRole || m.user_role === 'ALL')
                    .sort((a, b) => a.sort_order - b.sort_order)
                    .map(renderField)}
                </div>

                {/* Action Buttons */}
                <div className="flex gap-4 pt-6 border-t">
                  <Button
                    onClick={handleSave}
                    disabled={saving}
                    className="w-full md:w-auto"
                  >
                    {saving ? 'Saving...' : 'Save Data'}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setSelectedEntry(null)}
                    className="w-full md:w-auto"
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-12 text-center text-gray-500">
              <div className="text-4xl mb-4">📝</div>
              <div>Select a record from the list to start data entry</div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
};

export default SapDataEntry;

