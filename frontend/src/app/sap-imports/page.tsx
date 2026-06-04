'use client';

import React from 'react';
import Layout from '@/components/Layout';
import SapImportDashboard from '../../components/SapImportDashboard';

export default function SapImportsPage() {
  return (
    <Layout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">SAP Import Management</h1>
          <p className="text-gray-600 mt-2">
            Monitor and manage SAP MASTER v2 data imports
          </p>
        </div>

        <SapImportDashboard />
      </div>
    </Layout>
  );
}

