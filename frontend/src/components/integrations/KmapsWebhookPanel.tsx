'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, Loader2, Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import api from '@/lib/api'

/**
 * Integrations > KMAPS: the bells KLIP rings when a shipment changes, and how current the records are that KMAPS reads.
 *
 * KMAPS reads the shipments itself (every 15 minutes, per vessel); the bell only tells it to read sooner. A lost bell therefore only delays an update, but a
 * bell that keeps failing means KMAPS is unreachable from this server or rejects the signature, which is worth knowing. A failed bell is retried by KLIP
 * (30 seconds, 2 minutes, 10 minutes, 1 hour, 6 hours) and then waits here for a person.
 */

interface DeliveryItem {
  delivery_id: string
  event: string
  record_id: string
  version: string
  vessel_code: string | null
  status: 'PENDING' | 'DELIVERED' | 'FAILED'
  attempts: number
  next_attempt_at: string | null
  last_attempt_at: string | null
  last_status: number | null
  last_error: string | null
}

interface DeliveriesData {
  items: DeliveryItem[]
  counts: { PENDING: number; DELIVERED: number; FAILED: number }
  snapshot: { refreshed_at: string | null; record_count: number | null; duration_ms: number | null; last_error: string | null } | null
}

function formatWib(value: string | null): string {
  if (!value) return '-'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '-'
  return d.toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta' })
}

/** The line the modal opens with, in words. */
export function describeDeliveries(data: DeliveriesData | null): string {
  if (!data) return 'Memeriksa...'
  const failed = data.counts.FAILED
  const pending = data.counts.PENDING
  if (failed === 0 && pending === 0) return 'Semua bel ke KMAPS sudah terkirim.'
  return [failed > 0 ? `${failed} bel gagal terkirim ke KMAPS` : null, pending > 0 ? `${pending} menunggu dikirim atau dicoba lagi` : null]
    .filter(Boolean)
    .join(', ')
}

export function KmapsWebhookButton() {
  const [open, setOpen] = useState(false)
  const [data, setData] = useState<DeliveriesData | null>(null)
  const [loading, setLoading] = useState(true)
  const [resending, setResending] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await api.get('/integrations/kmaps/webhook-deliveries', { params: { status: 'FAILED' } })
      setData(res.data?.data ?? null)
    } catch {
      setError('Gagal memuat daftar bel ke KMAPS.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const resend = async () => {
    setResending(true)
    setMessage(null)
    setError(null)
    try {
      const res = await api.post('/integrations/kmaps/webhook-deliveries/resend', {})
      const queued = Number(res.data?.data?.queued ?? 0)
      setMessage(queued === 0 ? 'Tidak ada bel berstatus gagal.' : `${queued} bel dimasukkan lagi ke antrean; terkirim dalam beberapa detik.`)
      await load()
    } catch {
      setError('Gagal memasukkan bel ke antrean.')
    } finally {
      setResending(false)
    }
  }

  const items = data?.items ?? []
  const failed = data?.counts.FAILED ?? 0
  const snap = data?.snapshot

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
        className={failed > 0 ? 'border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100' : undefined}
        title={failed > 0 ? describeDeliveries(data) : 'Tidak ada bel yang gagal terkirim ke KMAPS'}
      >
        {loading && !data ? (
          <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
        ) : failed > 0 ? (
          <AlertTriangle className="mr-1 h-3.5 w-3.5" />
        ) : (
          <CheckCircle2 className="mr-1 h-3.5 w-3.5 text-green-600" />
        )}
        Webhook to KMAPS
        {failed > 0 ? (
          <span className="ml-1.5 rounded-full bg-amber-200 px-1.5 py-0.5 text-[0.625rem] font-semibold tabular-nums text-amber-900">{failed}</span>
        ) : null}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[85vh] max-w-5xl flex-col gap-3">
          <DialogHeader>
            <DialogTitle>Bel webhook ke KMAPS</DialogTitle>
            <DialogDescription>
              KMAPS membaca shipment sendiri; bel hanya memberi tahu agar KMAPS membaca lebih cepat. Bel berisi id record, versi, dan kode kapal, tanpa data
              dan tanpa harga. Yang gagal dicoba lagi otomatis (30 detik, 2 menit, 10 menit, 1 jam, 6 jam), lalu menunggu di sini.
            </DialogDescription>
          </DialogHeader>

          <p className="text-xs text-gray-600">
            Record untuk KMAPS terakhir dibangun: {formatWib(snap?.refreshed_at ?? null)}
            {snap?.record_count != null ? ` (${snap.record_count} shipment)` : ''}
            {snap?.last_error ? <span className="text-red-700"> - build terakhir gagal: {snap.last_error}</span> : null}
          </p>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="flex items-center gap-2 text-sm font-medium text-amber-900">
              {failed > 0 ? <AlertTriangle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4 text-green-600" />}
              {loading && !data ? 'Memeriksa...' : describeDeliveries(data)}
            </p>
            <Button variant="outline" size="sm" onClick={() => void resend()} disabled={resending || failed === 0}>
              {resending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Send className="mr-1 h-3.5 w-3.5" />}
              Kirim ulang yang gagal
            </Button>
          </div>

          {message ? <p className="text-xs text-gray-700">{message}</p> : null}
          {error ? <p className="text-xs text-red-700">{error}</p> : null}

          {items.length > 0 ? (
            <div className="min-h-0 flex-1 overflow-auto rounded-md border border-amber-100">
              <table className="min-w-full text-xs">
                <thead className="sticky top-0 bg-amber-50 text-left text-[0.625rem] uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="px-2 py-1.5">Event</th>
                    <th className="px-2 py-1.5">Record</th>
                    <th className="px-2 py-1.5 text-right">Versi</th>
                    <th className="px-2 py-1.5">Kapal</th>
                    <th className="px-2 py-1.5">Alasan</th>
                    <th className="px-2 py-1.5 text-right">Percobaan</th>
                    <th className="px-2 py-1.5">Percobaan terakhir</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.delivery_id} className="border-t border-amber-100 align-top">
                      <td className="whitespace-nowrap px-2 py-1">{item.event}</td>
                      <td className="whitespace-nowrap px-2 py-1 font-mono text-gray-800">{item.record_id}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{item.version}</td>
                      <td className="whitespace-nowrap px-2 py-1">{item.vessel_code ?? '-'}</td>
                      <td className="px-2 py-1 text-red-800">{item.last_error ?? '-'}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{item.attempts}</td>
                      <td className="whitespace-nowrap px-2 py-1">{formatWib(item.last_attempt_at)}</td>
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
