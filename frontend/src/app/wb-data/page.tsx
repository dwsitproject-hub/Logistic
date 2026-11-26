'use client'

import React, { Suspense } from 'react'
import Layout from '@/components/Layout'
import WbDataDashboard from '@/components/WbDataDashboard'

function WbDataFallback() {
  return <div className="text-sm text-gray-500">Loading...</div>
}

export default function WbDataPage() {
  return (
    <Layout>
      <div className="space-y-4">
        <Suspense fallback={<WbDataFallback />}>
          <WbDataDashboard />
        </Suspense>
      </div>
    </Layout>
  )
}
