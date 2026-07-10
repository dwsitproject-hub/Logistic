'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import api from '@/lib/api'
import Layout from '@/components/Layout'
import { DashboardContent } from '../dashboard/DashboardContent'
import { canViewNavItem, getFirstAccessibleRoute, parsePermissionsResponse } from '@/lib/navigationAccess'
import { NAV_ITEMS } from '@/lib/navigationConfig'

export default function ManagementDashboardPage() {
  const router = useRouter()
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    api
      .get('/roles/my-permissions')
      .then((res) => {
        if (cancelled) return
        const raw = (res.data?.data?.permissions ?? {}) as Record<string, Record<string, boolean | undefined>>
        const byKey = parsePermissionsResponse(raw)
        const userStr = localStorage.getItem('user')
        const userRole = userStr ? (JSON.parse(userStr).role as string | undefined) : undefined
        const perms = { byKey, loaded: true, userRole }
        const mgmtNav = NAV_ITEMS.find((item) => item.href === '/management-dashboard')
        const ok = mgmtNav ? canViewNavItem(mgmtNav, userRole, perms) : false
        if (!ok) {
          const fallback = getFirstAccessibleRoute(userRole, perms)
          router.replace(fallback ?? '/login?error=no_access')
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
        <div className="space-y-6 max-w-6xl mx-auto px-4 py-8" aria-busy="true" aria-label="Loading management dashboard">
          <div className="h-9 w-64 bg-gray-200 rounded-md animate-pulse" />
          <div className="h-4 w-96 max-w-full bg-gray-100 rounded animate-pulse" />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="rounded-lg border border-gray-200 bg-white p-6 space-y-4 shadow-sm">
                <div className="h-5 w-40 bg-gray-200 rounded animate-pulse" />
                <div className="h-3 w-full bg-gray-100 rounded animate-pulse" />
                <div className="grid grid-cols-2 gap-3">
                  <div className="h-16 bg-gray-50 rounded-lg animate-pulse" />
                  <div className="h-16 bg-gray-50 rounded-lg animate-pulse" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </Layout>
    )
  }

  return <DashboardContent pageTitle="Management Dashboard" />
}
