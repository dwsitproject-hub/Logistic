'use client';

import React, { Suspense } from 'react';
import Layout from '@/components/Layout';
import SapImportDashboard from '../../components/SapImportDashboard';

function SapImportsDashboardFallback() {
  return <div className="text-sm text-gray-500">Loading...</div>;
}

export default function SapImportsPage() {
  return (
    <Layout>
      <div className="space-y-4">
        <Suspense fallback={<SapImportsDashboardFallback />}>
          <SapImportDashboard />
        </Suspense>
      </div>
    </Layout>
  );
}
