'use client';

import React from 'react';
import AppLayout from '@/components/Layout';
import SapDataEntry from '@/components/SapDataEntry';

export default function SapDataEntryPage() {
  // In production, get userRole from auth context
  // For now, using ADMIN as default
  const userRole = 'ADMIN';

  return (
    <AppLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">SAP Data Entry</h1>
          <p className="text-gray-600 mt-2">
            Complete missing fields from SAP imports
          </p>
        </div>

        <SapDataEntry userRole={userRole} />
      </div>
    </AppLayout>
  );
}

