'use client'

import { useState } from 'react'
import { RefreshCw } from 'lucide-react'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'

interface SyncPayload {
  total?: number
  synced?: number
  failed?: number
  conflicts?: number
  disabled?: boolean
  errors?: Array<{ name?: string; error?: string }>
}

function summary(data: SyncPayload | undefined): string {
  if (data?.disabled) return 'DHM is not enabled'
  const synced = Number(data?.synced || 0)
  const total = Number(data?.total || 0)
  const failed = Number(data?.failed || 0)
  const conflicts = Number(data?.conflicts || 0)
  const parts = [`Synced ${synced} of ${total} to DHM`]
  if (conflicts > 0) parts.push(`${conflicts} already exist in DHM`)
  if (failed > 0) parts.push(`${failed} failed`)
  const first = String(data?.errors?.[0]?.error || '').trim()
  if (first) parts.push(first)
  return parts.join('. ')
}

export function MasterDhmSyncButton({ master, onDone }: { master: string; onDone?: () => void }) {
  const [busy, setBusy] = useState(false)

  const sync = async () => {
    setBusy(true)
    try {
      const post = (overwrite: boolean) => api.post('/dhm/sync', { master, overwrite }, { timeout: 0 })
      let response = await post(false)
      let data = response.data?.data as SyncPayload | undefined
      if (data?.disabled) {
        alert('DHM is not enabled')
        return
      }
      if (Number(data?.conflicts || 0) > 0) {
        const overwrite = confirm(`${data?.conflicts} row(s) already exist in DHM. Overwrite them?`)
        if (overwrite) {
          response = await post(true)
          data = response.data?.data as SyncPayload | undefined
        }
      }
      alert(summary(data))
      onDone?.()
    } catch (error: unknown) {
      const message =
        (error as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ||
        'Failed to sync to DHM'
      alert(message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Button type="button" size="sm" variant="outline" className="shrink-0" disabled={busy} onClick={() => void sync()}>
      <RefreshCw className={`mr-2 h-4 w-4 ${busy ? 'animate-spin' : ''}`} />
      {busy ? 'Syncing' : 'Sync'}
    </Button>
  )
}
