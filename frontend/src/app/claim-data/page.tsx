'use client'

import React from 'react'
import Layout from '@/components/Layout'
import ClaimDataImportDashboard from '@/components/ClaimDataImportDashboard'

export default function ClaimDataPage() {
  return (
    <Layout>
      <div className="space-y-4">
        <ClaimDataImportDashboard />
      </div>
    </Layout>
  )
}
