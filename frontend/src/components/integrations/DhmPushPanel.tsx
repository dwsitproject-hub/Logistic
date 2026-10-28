'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import api from '@/lib/api'

/**
 * Integrations > DHM: the masters KLIP saved but could not deliver to DHM.
 *
 * A master is saved in KLIP first and pushed second, and a failed push never undoes the save, so the two can differ
 * without anybody noticing. This lists every such master with the reason. FAILED ones are pushed again by the sync
 * cron (with backoff) and from the button here; a CONFLICT means DHM already holds something different under that
 * name, which only a person can settle from the Master page (save again, choose overwrite).
 *
 * The list used to sit open inside the DHM card (200 rows of it pushed every setting off the screen). It is now behind a
 * "Failed to DHM" button in the card header, with the count on the button, and opens in a modal.
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

/** The summary line the modal opens with, in words. */
export function describePushState(data: Pick<PushStateData, 'items' | 'failed' | 'conflicts'> | null): string {
  if (!data || data.items.length === 0) return 'Semua perubahan master sudah terkirim ke DHM.'
  return `${data.failed} master gagal terkirim ke DHM` + (data.conflicts > 0 ? `, ${data.conflicts} konflik` : '')
}

export function DhmFailedPushButton() {
  const [open, setOpen] = useState(false)
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

  const items = data?.items ?? []
  const count = items.length

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          setOpen(true)
          setMessage(null)
          void load()
        }}
        className={count > 0 ? 'border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100' : undefined}
        title={count > 0 ? describePushState(data) : 'Tidak ada master yang gagal terkirim ke DHM'}
      >
        {loading && !data ? (
          <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
        ) : count > 0 ? (
          <AlertTriangle className="mr-1 h-3.5 w-3.5" />
        ) : (
          <CheckCircle2 className="mr-1 h-3.5 w-3.5 text-green-600" />
        )}
        Failed to DHM
        {count > 0 ? (
          <span className="ml-1.5 rounded-full bg-amber-200 px-1.5 py-0.5 text-[0.625rem] font-semibold tabular-nums text-amber-900">{count}</span>
        ) : null}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[85vh] max-w-5xl flex-col gap-3">
          <DialogHeader>
            <DialogTitle>Master yang gagal terkirim ke DHM</DialogTitle>
            <DialogDescription>
              Master tersimpan di KLIP lebih dulu, lalu dikirim ke DHM. Yang gagal dicoba lagi otomatis oleh sync cron (dengan jeda), atau dengan tombol di
              sini. Konflik hanya bisa diselesaikan dari halaman master: simpan ulang dan pilih overwrite.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="flex items-center gap-2 text-sm font-medium text-amber-900">
              {count > 0 ? <AlertTriangle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4 text-green-600" />}
              {loading && !data ? 'Memeriksa...' : describePushState(data)}
            </p>
            <Button variant="outline" size="sm" onClick={() => void retry()} disabled={retrying || (data?.failed ?? 0) === 0}>
              {retrying ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1 h-3.5 w-3.5" />}
              Kirim ulang sekarang
            </Button>
          </div>

          {message ? <p className="text-xs text-gray-700">{message}</p> : null}
          {error ? <p className="text-xs text-red-700">{error}</p> : null}

          {count > 0 ? (
            <div className="min-h-0 flex-1 overflow-auto rounded-md border border-amber-100">
              <table className="min-w-full text-xs">
                <thead className="sticky top-0 bg-amber-50 text-left text-[0.625rem] uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="px-2 py-1.5">Master</th>
                    <th className="px-2 py-1.5">Nama</th>
                    <th className="px-2 py-1.5">Status</th>
                    <th className="px-2 py-1.5">Alasan</th>
                    <th className="px-2 py-1.5 text-right">Percobaan</th>
                    <th className="px-2 py-1.5">Percobaan berikutnya</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={`${item.entity_kind}:${item.entity_id}`} className="border-t border-amber-100 align-top">
                      <td className="whitespace-nowrap px-2 py-1">{KIND_LABEL[item.entity_kind] ?? item.entity_kind}</td>
                      <td className="px-2 py-1 font-medium text-gray-800">{item.name}</td>
                      <td className="whitespace-nowrap px-2 py-1">
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
                      <td className="whitespace-nowrap px-2 py-1 text-gray-600">
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
        </DialogContent>
      </Dialog>
    </>
  )
}
