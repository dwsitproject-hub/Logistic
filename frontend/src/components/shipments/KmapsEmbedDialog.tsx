'use client'

import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import api from '@/lib/api'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'

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
 * Shipments table > KMAPS icon: the KMAPS map in a frame, limited to the vessel(s) of this shipment (KMAPS team's KLIP-EMBED.md).
 *
 * KLIP calls no KMAPS API and sends no data: the server only builds the URL (`/api/shipments/kmaps-link`, from Integrations > KMAPS and
 * the record id KLIP issues to KMAPS) and KMAPS resolves it with the user's own KMAPS session. The iframe exists only while the dialog
 * is open, so each open loads a fresh frame. No `sandbox`: KMAPS needs scripts, same-origin (its session cookie), popups and forms for
 * its sign-in popup.
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

  const title = shipment?.vessel_name || shipment?.shipment_id || shipment?.sto_number || 'Shipment'

  return (
    <Dialog open={shipment !== null} onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent className="flex h-[85vh] w-[90vw] max-w-[90vw] flex-col gap-3 p-4">
        <DialogHeader>
          <DialogTitle>KMAPS — {title}</DialogTitle>
          <DialogDescription>
            Posisi kapal untuk shipment ini, dari KMAPS. Jika diminta, masuk dengan akun KMAPS Anda di jendela ini.
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-hidden rounded-md border border-gray-200 bg-gray-50">
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
            <iframe src={link.url} title="Posisi kapal (KMAPS)" loading="lazy" className="h-full w-full border-0" />
          )}
        </div>
        <p className="text-xs text-gray-500">
          Bingkai kosong? Biasanya alamat KLIP belum didaftarkan di KMAPS (frame-ancestors) atau KMAPS tidak satu situs dengan KLIP.
        </p>
      </DialogContent>
    </Dialog>
  )
}
