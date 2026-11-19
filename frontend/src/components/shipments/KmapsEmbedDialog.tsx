'use client'

import { useEffect, useState } from 'react'
import { Loader2, X } from 'lucide-react'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'

/** What the dialog needs from a Shipments table row. */
export interface KmapsEmbedShipment {
  id: string
  sto_key?: string | null
  sto_number?: string | null
  shipment_id?: string | null
  vessel_name?: string | null
}

interface KmapsLink {
  enabled: boolean
  url: string | null
  reason?: string
}

export interface KmapsEmbedDialogProps {
  /** The row whose shipment to show; null = closed. */
  shipment: KmapsEmbedShipment | null
  onClose: () => void
}

const errorText = (e: unknown): string => {
  const err = e as { response?: { data?: { error?: { message?: string } } }; message?: string }
  return err?.response?.data?.error?.message || err?.message || 'Gagal membuka KMAPS.'
}

/**
 * Shipments table > map icon: KMAPS in a frame for this shipment's vessel(s) (KLIP-EMBED.md).
 *
 * Custom overlay (same pattern as the Documents modal) so the iframe gets a real flex height —
 * DialogContent's scroll body is not a flex column and collapsed the map. Map-first: thin chrome,
 * ~92vw × 90vh panel. No sandbox: KMAPS needs scripts, cookies, popups and forms for sign-in.
 */
export function KmapsEmbedDialog({ shipment, onClose }: KmapsEmbedDialogProps) {
  const [link, setLink] = useState<KmapsLink | null>(null)
  const [error, setError] = useState<string | null>(null)
  const shipmentKey = shipment?.id ?? null

  useEffect(() => {
    if (!shipment) {
      setLink(null)
      setError(null)
      return
    }
    let cancelled = false
    setLink(null)
    setError(null)
    void (async () => {
      try {
        const res = await api.get('/shipments/kmaps-link', {
          params: {
            id: shipment.id,
            stoKey: shipment.sto_key || undefined,
            sto: shipment.sto_number || undefined,
            shipment: shipment.shipment_id || undefined,
          },
        })
        if (!cancelled) setLink(res.data?.data ?? null)
      } catch (e) {
        if (!cancelled) setError(errorText(e))
      }
    })()
    return () => {
      cancelled = true
    }
    // The row object is rebuilt on every list render; its id is what identifies the shipment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shipmentKey])

  useEffect(() => {
    if (!shipment) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [shipment, onClose])

  if (!shipment) return null

  const title = shipment.vessel_name || shipment.shipment_id || shipment.sto_number || 'Shipment'
  const showHint =
    error != null ||
    (link !== null && (!link.enabled || !link.url))

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`KMAPS — ${title}`}
      onClick={onClose}
    >
      <div
        className="flex h-[90vh] w-[92vw] max-w-[1600px] flex-col overflow-hidden rounded-lg bg-white shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b px-4 py-3">
          <h3 className="truncate text-lg font-semibold text-gray-900">KMAPS — {title}</h3>
          <Button variant="ghost" size="icon" className="shrink-0" aria-label="Close" onClick={onClose}>
            <X className="h-5 w-5" />
          </Button>
        </div>

        <div className="relative min-h-0 flex-1 bg-gray-50">
          {error ? (
            <p className="p-6 text-sm text-red-700">{error}</p>
          ) : link === null ? (
            <div className="flex h-full items-center justify-center gap-2 text-sm text-gray-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              Memuat KMAPS…
            </div>
          ) : !link.enabled ? (
            <p className="p-6 text-sm text-gray-600">
              KMAPS belum diatur di KLIP. Minta ADMIN mengisi <b>Map (embed) URL</b> di Integrations &gt; KMAPS.
            </p>
          ) : !link.url ? (
            <p className="p-6 text-sm text-gray-600">Baris ini belum punya identitas shipment yang bisa dicari di KMAPS.</p>
          ) : (
            <iframe
              src={link.url}
              title="Posisi kapal (KMAPS)"
              loading="lazy"
              className="absolute inset-0 h-full w-full border-0"
            />
          )}
        </div>

        {showHint ? (
          <p className="shrink-0 border-t px-4 py-2 text-xs text-gray-500">
            Bingkai kosong? Biasanya CSP frame-src KLIP belum mengizinkan origin KMAPS, atau alamat KLIP belum
            didaftarkan di KMAPS (frame-ancestors).
          </p>
        ) : null}
      </div>
    </div>
  )
}
