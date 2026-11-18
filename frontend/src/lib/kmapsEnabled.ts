'use client'

import { useEffect, useState } from 'react'
import api from '@/lib/api'

/**
 * KMAPS Action-column state for the Shipments table (KLIP-EMBED.md Draft 3 §8).
 *
 * - Integration off, or no usable availability → View Documents on every row.
 * - Availability mode `all` (KMAPS endpoint not deployed / 404) → map icon on every real shipment row.
 * - Mode `filter` → map icon only when the row matches the available sets.
 *
 * One GET /shipments/kmaps-status is shared by every row and cached for a minute.
 */

const TTL_MS = 60_000

export type KmapsAvailabilityMode = 'none' | 'all' | 'filter'

export interface KmapsAvailability {
  mode: KmapsAvailabilityMode
  ops?: string[]
  stos?: string[]
  shipments?: string[]
  stoKeys?: string[]
}

export interface KmapsActionState {
  enabled: boolean
  availability: KmapsAvailability
}

const DEFAULT: KmapsActionState = { enabled: false, availability: { mode: 'none' } }

let cached: { state: KmapsActionState; at: number } | null = null
let inflight: Promise<KmapsActionState> | null = null
const listeners = new Set<(state: KmapsActionState) => void>()

function normalize(raw: unknown): KmapsActionState {
  const data = (raw as { data?: { enabled?: unknown; availability?: Record<string, unknown> } } | undefined)?.data
  const enabled = data?.enabled === true
  const a = data?.availability
  const mode = a?.mode === 'all' || a?.mode === 'filter' || a?.mode === 'none' ? a.mode : 'none'
  if (!enabled) return { enabled: false, availability: { mode: 'none' } }
  if (mode === 'all') return { enabled: true, availability: { mode: 'all' } }
  if (mode !== 'filter') return { enabled: true, availability: { mode: 'none' } }
  const asList = (v: unknown): string[] =>
    Array.isArray(v) ? v.map((x) => String(x ?? '').trim()).filter((s) => s !== '') : []
  return {
    enabled: true,
    availability: {
      mode: 'filter',
      ops: asList(a?.ops),
      stos: asList(a?.stos),
      shipments: asList(a?.shipments),
      stoKeys: asList(a?.stoKeys),
    },
  }
}

async function load(): Promise<KmapsActionState> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.state
  if (!inflight) {
    inflight = (async () => {
      try {
        const res = await api.get('/shipments/kmaps-status')
        const state = normalize(res.data)
        cached = { state, at: Date.now() }
        for (const listener of listeners) listener(state)
        return state
      } catch {
        return DEFAULT
      } finally {
        inflight = null
      }
    })()
  }
  return inflight
}

function clean(v: unknown): string | null {
  const s = String(v ?? '').trim()
  return s !== '' ? s : null
}

/** Whether this Shipments row should show the map icon instead of View Documents. */
export function shipmentMatchesKmapsAvailability(
  row: { sto_key?: string | null; sto_number?: string | null; shipment_id?: string | null },
  availability: KmapsAvailability,
): boolean {
  if (availability.mode === 'none') return false
  if (availability.mode === 'all') return true
  const stoKey = clean(row.sto_key)
  if (stoKey && availability.stoKeys?.includes(stoKey)) return true
  const sto = clean(row.sto_number) ?? stoKey
  if (sto && availability.stos?.includes(sto)) return true
  const shipment = clean(row.shipment_id)
  if (shipment && availability.shipments?.includes(shipment)) return true
  return false
}

/** @deprecated Prefer useKmapsActionState — kept so existing call sites that only need the Enabled flag still compile. */
export function useKmapsEnabled(): boolean {
  return useKmapsActionState().enabled
}

export function useKmapsActionState(): KmapsActionState {
  const [state, setState] = useState<KmapsActionState>(cached?.state ?? DEFAULT)
  useEffect(() => {
    let cancelled = false
    listeners.add(setState)
    void load().then((value) => {
      if (!cancelled) setState(value)
    })
    return () => {
      cancelled = true
      listeners.delete(setState)
    }
  }, [])
  return state
}
