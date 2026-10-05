'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import api from '@/lib/api'

/**
 * Integrations > DHM: the masters KLIP saved but could not deliver to DHM.
 *
 * A master is saved in KLIP first and pushed second, and a failed push never undoes the save, so the two can differ
 * without anybody noticing. This lists every such master with the reason. FAILED ones are pushed again by the sync
 * cron (with backoff) and from the button here; a CONFLICT means DHM already holds something different under that
 * name, which only a person can settle from the Master page (save again, choose overwrite).
 */

interface PushStateItem {
  entity_kind: string
  entity_id: string
  name: string
  status: 'FAILED' | 'CONFLICT'
  error: string | null
  attempts: number
  last_attempt_at: string
  next_attempt_at: string | null
}

interface PushStateData {
  items: PushStateItem[]
  failed: number
  conflicts: number
}

interface RetrySummary {
  disabled: boolean
  attempted: number
  synced: number
  stillFailing: number
  dropped: number
}

const KIND_LABEL: Record<string, string> = {
  vessel: 'Vessel',
  product: 'Product',
  port: 'Port',
  plant: 'Plant',
  site: 'Site',
  company: 'Company (Int)',
  ext_company: 'Company (Ext)',
  incoterm: 'Incoterm',
}

function formatWib(value: string | null): string {
  if (!value) return '-'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '-'
  return d.toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta' })
}

export function DhmPushPanel() {
  const [data, setData] = useState<PushStateData | null>(null)
  const [loading, setLoading] = useState(true)
  const [retrying, setRetrying] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await api.get('/integrations/dhm/push-state')
      setData(res.data?.data ?? null)
    } catch {
      setError('Gagal memuat daftar master yang belum terkirim ke DHM.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const retry = async () => {
    setRetrying(true)
    setMessage(null)
    setError(null)
    try {
      const res = await api.post('/integrations/dhm/push-retry')
      const s = res.data?.data as RetrySummary | undefined
      if (s?.disabled) {
        setMessage('DHM tidak aktif (DHM_ENABLED), jadi tidak ada yang dikirim.')
      } else if (s) {
        setMessage(
          s.attempted === 0 && s.dropped === 0
            ? 'Tidak ada master berstatus gagal untuk dikirim ulang.'
            : `Dikirim ulang ${s.attempted}: ${s.synced} berhasil, ${s.stillFailing} masih gagal` +
                (s.dropped > 0 ? `, ${s.dropped} dibuang karena master-nya sudah tidak ada.` : '.'),
        )
      }
      await load()
    } catch {
      setError('Gagal mengirim ulang ke DHM.')
    } finally {
      setRetrying(false)
    }
  }

  if (loading && !data) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-500">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Memeriksa master yang belum terkirim ke DHM...
      </div>
    )
  }

  const items = data?.items ?? []
  if (items.length === 0 && !error && !message) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-800">
        <CheckCircle2 className="h-3.5 w-3.5" /> Semua perubahan master sudah terkirim ke DHM.
      </div>
    )
  }

  return (
    <div className="space-y-2 rounded-md border border-amber-200 bg-amber-50/60 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-sm font-medium text-amber-900">
          <AlertTriangle className="h-4 w-4" />
          {items.length === 0
            ? 'Tidak ada master yang tertunda.'
            : `${data?.failed ?? 0} master gagal terkirim ke DHM` +
              ((data?.conflicts ?? 0) > 0 ? `, ${data?.conflicts} konflik` : '')}
        </p>
        <Button variant="outline" size="sm" onClick={() => void retry()} disabled={retrying || (data?.failed ?? 0) === 0}>
          {retrying ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1 h-3.5 w-3.5" />}
          Kirim ulang sekarang
        </Button>
      </div>

      {message ? <p className="text-xs text-gray-700">{message}</p> : null}
      {error ? <p className="text-xs text-red-700">{error}</p> : null}

      {items.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead className="text-left text-[10px] uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-2 py-1">Master</th>
                <th className="px-2 py-1">Nama</th>
                <th className="px-2 py-1">Status</th>
                <th className="px-2 py-1">Alasan</th>
                <th className="px-2 py-1 text-right">Percobaan</th>
                <th className="px-2 py-1">Percobaan berikutnya</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={`${item.entity_kind}:${item.entity_id}`} className="border-t border-amber-100 align-top">
                  <td className="px-2 py-1 whitespace-nowrap">{KIND_LABEL[item.entity_kind] ?? item.entity_kind}</td>
                  <td className="px-2 py-1 font-medium text-gray-800">{item.name}</td>
                  <td className="px-2 py-1 whitespace-nowrap">
                    <span
                      className={
                        item.status === 'CONFLICT'
                          ? 'rounded-full bg-orange-100 px-2 py-0.5 font-medium text-orange-900'
                          : 'rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-900'
                      }
                    >
                      {item.status === 'CONFLICT' ? 'Conflict' : 'Sync Failed'}
                    </span>
                  </td>
                  <td className="px-2 py-1 text-gray-700">
                    {item.error ??
                      (item.status === 'CONFLICT'
                        ? 'DHM sudah punya data berbeda. Simpan ulang di halaman master dan pilih overwrite.'
                        : '-')}
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums">{item.attempts}</td>
                  <td className="px-2 py-1 whitespace-nowrap text-gray-600">
                    {item.status === 'CONFLICT'
                      ? 'menunggu keputusan'
                      : item.next_attempt_at
                        ? formatWib(item.next_attempt_at)
                        : 'otomatis habis'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  )
}
