'use client'

import { useEffect, useState } from 'react'
import api from '@/lib/api'

/**
 * Is the KMAPS integration switched on (Integrations > KMAPS > Enabled)? The Shipments table shows the KMAPS icon in its Action column only then; while it is
 * off the column keeps the View Documents button. One GET /shipments/kmaps-status is shared by every row and the answer is kept for a minute. While the answer
 * is unknown (not asked yet, or the request failed) the hook returns false, so the documents button is the safe default and a missing answer never hides it.
 */
const TTL_MS = 60_000

let cached: { enabled: boolean; at: number } | null = null
let inflight: Promise<boolean> | null = null
const listeners = new Set<(enabled: boolean) => void>()

async function load(): Promise<boolean> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.enabled
  if (!inflight) {
    inflight = (async () => {
      try {
        const res = await api.get('/shipments/kmaps-status')
        const enabled = res.data?.data?.enabled === true
        cached = { enabled, at: Date.now() }
        return enabled
      } catch {
        return false
      } finally {
        inflight = null
      }
    })()
  }
  return inflight
}

export function useKmapsEnabled(): boolean {
  const [enabled, setEnabled] = useState<boolean>(cached?.enabled ?? false)
  useEffect(() => {
    let cancelled = false
    listeners.add(setEnabled)
    void load().then((value) => {
      if (!cancelled) setEnabled(value)
    })
    return () => {
      cancelled = true
      listeners.delete(setEnabled)
    }
  }, [])
  return enabled
}
