'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { startUserActivityTracker, trackPageView } from '@/lib/userActivityTracker'

/** Records UI navigation, clicks, and API mutations for the User Activity Log (Admin). */
export function UserActivityTracker() {
  const pathname = usePathname()

  useEffect(() => {
    startUserActivityTracker()
  }, [])

  useEffect(() => {
    trackPageView(pathname)
  }, [pathname])

  return null
}
