'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import api from '@/lib/api'
import Layout from '@/components/Layout'
import { DashboardContent } from '../dashboard/DashboardContent'

export default function ManagementDashboardPage() {
  const router = useRouter()
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    api
      .get('/roles/my-permissions')
      .then((res) => {
        if (cancelled) return
        const ok = !!res.data?.data?.permissions?.['page.management_dashboard']?.canView
        if (!ok) {
          router.replace('/dashboard')
          return
        }
        setReady(true)
      })
      .catch(() => {
        if (cancelled) return
        setReady(true)
      })
    return () => {
      cancelled = true
    }
  }, [router])

  if (!ready) {
    return (
      <Layout>
        <div className="flex items-center justify-center min-h-[50vh] text-gray-500 text-sm">Loading…</div>
      </Layout>
    )
  }

  return <DashboardContent pageTitle="Management Dashboard" />
}
