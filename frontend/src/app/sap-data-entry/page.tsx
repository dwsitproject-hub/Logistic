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
        <SapDataEntry userRole={userRole} />
      </div>
    </AppLayout>
  );
}

