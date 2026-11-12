'use client'

import { useEffect, useState } from 'react'
import api from '@/lib/api'

/**
 * Does this shipment (or contract backlog row) have a document? The Docs button on the Shipments table is turned off for rows with none, so nobody opens an empty
 * dialog. Each row asks through useDocumentPresence; the asks of one render are sent together as one GET /documents/presence, and the answers are kept for a minute.
 * While the answer is unknown (not asked yet, or the request failed) the hook returns undefined and the button stays ON: a missing answer must never lock a document away.
 */
export type DocPresenceKind = 'shipment' | 'contract' | 'trucking'

const TTL_MS = 60_000
const BATCH_MS = 40
const CHUNK = 100

const cache = new Map<string, { has: boolean; at: number }>()
const pending = new Set<string>()
const listeners = new Set<() => void>()
let timer: ReturnType<typeof setTimeout> | null = null

const keyOf = (kind: DocPresenceKind, id: string) => `${kind}:${id}`
const notify = () => listeners.forEach((listener) => listener())

async function flush() {
  timer = null
  const keys = Array.from(pending)
  pending.clear()
  for (let i = 0; i < keys.length; i += CHUNK) {
    const chunk = keys.slice(i, i + CHUNK)
    const shipmentIds = chunk.filter((k) => k.startsWith('shipment:')).map((k) => k.slice('shipment:'.length))
    const contractIds = chunk.filter((k) => k.startsWith('contract:')).map((k) => k.slice('contract:'.length))
    const truckingIds = chunk.filter((k) => k.startsWith('trucking:')).map((k) => k.slice('trucking:'.length))
    try {
      const res = await api.get('/documents/presence', {
        params: { shipmentIds: shipmentIds.join(','), contractIds: contractIds.join(','), truckingOperationIds: truckingIds.join(',') },
      })
      const data = res.data?.data as { shipmentIds?: string[]; contractIds?: string[]; truckingOperationIds?: string[] } | undefined
      if (!data) continue
      const withShipment = new Set((data.shipmentIds ?? []).map(String))
      const withContract = new Set((data.contractIds ?? []).map(String))
      const withTrucking = new Set((data.truckingOperationIds ?? []).map(String))
      const now = Date.now()
      for (const id of shipmentIds) cache.set(keyOf('shipment', id), { has: withShipment.has(id), at: now })
      for (const id of contractIds) cache.set(keyOf('contract', id), { has: withContract.has(id), at: now })
      for (const id of truckingIds) cache.set(keyOf('trucking', id), { has: withTrucking.has(id), at: now })
    } catch {
      // unknown stays unknown: the button stays on
    }
  }
  notify()
}

function schedule() {
  if (timer == null) timer = setTimeout(() => void flush(), BATCH_MS)
}

export function requestDocumentPresence(kind: DocPresenceKind, id: string) {
  const key = keyOf(kind, id)
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL_MS) return
  pending.add(key)
  schedule()
}

/** After a document is uploaded or deleted: ask again for every row already known (their answers stay on screen until the new ones arrive). */
export function refreshDocumentPresence() {
  for (const key of cache.keys()) pending.add(key)
  if (pending.size > 0) schedule()
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function useDocumentPresence(kind: DocPresenceKind, rawId: string | null | undefined): boolean | undefined {
  const id = rawId && UUID_RE.test(rawId) ? rawId : null
  const [, setTick] = useState(0)
  useEffect(() => {
    const listener = () => setTick((n) => n + 1)
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }, [])
  useEffect(() => {
    if (id) requestDocumentPresence(kind, id)
  }, [kind, id])
  return id ? cache.get(keyOf(kind, id))?.has : undefined
}

export interface DocRef {
  kind: DocPresenceKind
  id: string
}

/**
 * A row whose Documents dialog merges two sources (a trucking operation's own files and its contract's): true when either has one, false only when every source
 * asked about is known to have none, otherwise unknown (undefined).
 */
export function useRowDocumentPresence(a: DocRef | null, b: DocRef | null): boolean | undefined {
  const first = useDocumentPresence(a?.kind ?? 'shipment', a?.id ?? null)
  const second = useDocumentPresence(b?.kind ?? 'shipment', b?.id ?? null)
  const asked = [a ? first : null, b ? second : null].filter((v): v is boolean | undefined => v !== null)
  if (asked.length === 0) return undefined
  if (asked.some((v) => v === true)) return true
  return asked.every((v) => v === false) ? false : undefined
}
