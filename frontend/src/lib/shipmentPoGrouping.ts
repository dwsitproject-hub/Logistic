/**
 * Shipments table - the STO rows of one CIF / CFR PO shown as ONE row.
 *
 * A CIF / CFR PO usually carries several SAP STOs of Type T (trucking legs, no vessel), and the list is one row per STO. This puts them in one table row, the way the PO
 * column already lists several POs of one STO: the STO cell lists the STOs side by side, comma-separated, and its hover tooltip shows them one per line. Quantities that are per
 * STO are added up; Contract Qty and Outstanding Qty are PO-level figures every sibling row repeats, so they are shown once; the status is the furthest active stage of the siblings,
 * where the PO's OS already sits on the cards.
 *
 * This is DISPLAY only. The rows, the paging, the cards and the OS are untouched: the stage counts still count one per STO, and Contract Qty and OS on the cards are already
 * once per contract. The row's buttons act on ONE of the STOs (the one whose status the row shows) - the others cannot be edited from this row.
 *
 * Only a row of exactly ONE PO merges. A STO shared by several POs is one row of several POs and stays as it is.
 */

import { resolveShipmentStoDisplay, resolveShipmentStoKey } from '@/lib/shipmentStoGrouping'

export const SHIPMENT_PO_GROUP_INCOTERMS = ['CIF', 'CFR'] as const

export type ShipmentPoGroupRow = {
  id: string
  sto_number?: string | null
  sto_key?: string | null
  shipment_id?: string | null
  incoterm?: string | null
  po_numbers?: string | null
  po_number?: string | null
  status?: string | null
  row_kind?: string | null
}

function poTokens(row: ShipmentPoGroupRow): string[] {
  const raw = String(row.po_numbers ?? row.po_number ?? '')
  return [...new Set(raw.split(',').map((t) => t.trim()).filter(Boolean))]
}

/** `po:<PO>` for a CIF / CFR STO row of exactly one PO; null for everything else (other incoterms, backlog rows, no STO, several POs). */
export function shipmentPoGroupKey(row: ShipmentPoGroupRow): string | null {
  if (row.row_kind === 'contract_backlog') return null
  const incoterm = String(row.incoterm ?? '').trim().toUpperCase()
  if (!(SHIPMENT_PO_GROUP_INCOTERMS as readonly string[]).includes(incoterm)) return null
  const tokens = poTokens(row)
  if (tokens.length !== 1) return null
  if (resolveShipmentStoKey(row).startsWith('__no_sto__')) return null
  return `po:${tokens[0]}`
}

/** A row that stands for several STO rows of one PO. `poRows` are the rows it replaced, in list order; `poStos` their distinct STO numbers. */
export type PoMergedRow<T> = T & { poRows?: T[]; poStos?: string[] }

/**
 * Replace the STO rows of one PO by a single row at the position of the PO's first row. The merged row IS the row whose status it shows (so its buttons act on that STO),
 * with `poRows` and `poStos` added. A PO with a single row is left exactly as it is.
 */
export function mergeRowsByPo<T extends ShipmentPoGroupRow>(rows: readonly T[]): PoMergedRow<T>[] {
  const members = new Map<string, T[]>()
  for (const row of rows) {
    const key = shipmentPoGroupKey(row)
    if (key) {
      const list = members.get(key)
      if (list) list.push(row)
      else members.set(key, [row])
    }
  }
  const out: PoMergedRow<T>[] = []
  const placed = new Set<string>()
  for (const row of rows) {
    const key = shipmentPoGroupKey(row)
    const group = key ? members.get(key) : undefined
    if (!key || !group || group.length < 2) {
      out.push(row)
      continue
    }
    if (placed.has(key)) continue
    placed.add(key)
    const seen = new Set<string>()
    const poStos: string[] = []
    for (const member of group) {
      const text = resolveShipmentStoDisplay(resolveShipmentStoKey(member))
      if (!text || text === '—' || seen.has(text)) continue
      seen.add(text)
      poStos.push(text)
    }
    out.push({ ...poGroupStatusRow(group), poRows: group, poStos })
  }
  return out
}

/** 'A, B' + 'B, C' -> 'A, B, C': the distinct comma-separated values of several rows, in first-seen order. */
export function joinDistinctValues(values: ReadonlyArray<string | null | undefined>): string {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
    for (const part of String(value ?? '').split(',')) {
      const text = part.trim()
      const k = text.toLowerCase()
      if (!text || seen.has(k)) continue
      seen.add(k)
      out.push(text)
    }
  }
  return out.join(', ')
}

/**
 * How far along the pipeline a status is - the same ranks as backend/src/utils/shipmentActiveStageRank.ts (furthest active stage wins; anything not listed, COMPLETED and
 * CANCELLED included, ranks below every active stage).
 */
const STAGE_RANKS: ReadonlyArray<readonly [number, readonly string[]]> = [
  [5, ['ARRIVED_DP', 'BERTHED_DP', 'UNLOADING']],
  [4, ['SAILED']],
  [3, ['ARRIVED_LP', 'BERTHED_LP', 'LOADING', 'COMPLETED_LOADING']],
  [2, ['PLANNED']],
]

export function shipmentStageRank(status: string | null | undefined): number {
  const key = String(status ?? '').trim().toUpperCase()
  for (const [rank, statuses] of STAGE_RANKS) if (statuses.includes(key)) return rank
  return 1
}

/**
 * The row whose status the merged row shows: the furthest active stage, so it sits where the PO's OS already sits on the cards. With nothing active, COMPLETED beats
 * CANCELLED (a cancelled leg does not undo a delivered one). Ties keep list order.
 */
export function poGroupStatusRow<T extends { status?: string | null }>(rows: readonly T[]): T {
  const score = (row: T) => {
    const status = String(row.status ?? '').trim().toUpperCase()
    return shipmentStageRank(status) * 10 + (status === 'COMPLETED' ? 1 : 0)
  }
  return rows.reduce((best, row) => (score(row) > score(best) ? row : best))
}
