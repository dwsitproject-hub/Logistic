/**
 * Shipments table - a CIF / CFR PO with several STOs shown as ONE collapsible header.
 *
 * A CIF / CFR PO usually carries several SAP STOs of Type T (trucking legs, no vessel), and the list is one row per STO. The header gives the
 * PO one line (the STOs comma-separated, quantities added up where they are per STO); the STO rows stay underneath it, because each of them
 * is a real shipment with its own status, edit, documents and quantities.
 *
 * This is DISPLAY only. The rows, the paging, the cards and the OS are untouched: a PO still counts once per STO in the stage counts, and
 * its Contract Qty and OS are already once per contract. Merging at the data grain is a different, riskier change (see
 * backend/src/utils/shipmentCifCfrStoGrain.regression.test.ts).
 *
 * Only a row of exactly ONE PO is groupable. A STO shared by several POs is one row of several POs and stays where it is - it belongs to no
 * single PO header.
 */

import { resolveShipmentStoKey, type ShipmentStoGroup } from '@/lib/shipmentStoGrouping'

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

export type ShipmentDisplayGroup<T> =
  | { kind: 'sto'; key: string; stoGroup: ShipmentStoGroup<T> }
  | {
      kind: 'po'
      key: string
      poNumber: string
      stoGroups: ShipmentStoGroup<T>[]
      /** Every row of the PO, in list order. */
      rows: T[]
      /** The distinct STO numbers of the rows, in list order. */
      stoDisplays: string[]
    }

/**
 * Put the STO groups of one PO under one header, at the position of the PO's first row. A STO group joins a PO only when ALL its rows are
 * groupable and of the same PO. A PO that ends up with a single row is not a group: it stays an ordinary STO group.
 */
export function groupShipmentsForDisplay<T extends ShipmentPoGroupRow>(
  stoGroups: readonly ShipmentStoGroup<T>[],
): ShipmentDisplayGroup<T>[] {
  const out: ShipmentDisplayGroup<T>[] = []
  const poIndex = new Map<string, number>()

  for (const stoGroup of stoGroups) {
    const keys = new Set(stoGroup.rows.map((row) => shipmentPoGroupKey(row)))
    const key = keys.size === 1 ? [...keys][0] : null
    if (!key) {
      out.push({ kind: 'sto', key: stoGroup.stoKey, stoGroup })
      continue
    }
    const at = poIndex.get(key)
    if (at === undefined) {
      poIndex.set(key, out.length)
      out.push({
        kind: 'po',
        key,
        poNumber: key.slice('po:'.length),
        stoGroups: [stoGroup],
        rows: [...stoGroup.rows],
        stoDisplays: [],
      })
      continue
    }
    const existing = out[at]
    if (existing.kind === 'po') {
      existing.stoGroups.push(stoGroup)
      existing.rows.push(...stoGroup.rows)
    }
  }

  return out.map((group) => {
    if (group.kind !== 'po') return group
    if (group.rows.length < 2) return { kind: 'sto' as const, key: group.stoGroups[0].stoKey, stoGroup: group.stoGroups[0] }
    const seen = new Set<string>()
    const stoDisplays: string[] = []
    for (const stoGroup of group.stoGroups) {
      const text = stoGroup.stoDisplay
      if (!text || text === '—' || seen.has(text)) continue
      seen.add(text)
      stoDisplays.push(text)
    }
    return { ...group, stoDisplays }
  })
}

/* ------------------------------------------------------------------------------------------------------------------------------------ */
/* What the header shows in each column                                                                                                */
/* ------------------------------------------------------------------------------------------------------------------------------------ */

export type PoGroupColumnMode = 'sto' | 'status' | 'once' | 'sum' | 'stack'

/**
 * Contract Qty and Outstanding Qty are PO-level figures every sibling STO row already repeats, so the header shows them ONCE (adding them up
 * would be the 4.2x the status cards used to show). STO Qty, Plan, Delivery and Received are per STO, so they are added up.
 */
const ONCE_COLUMNS = new Set(['contract_qty', 'outstanding_quantity'])
const SUM_COLUMNS = new Set(['sto_quantity', 'quantity_shipment_plan', 'quantity_delivered', 'quantity_receive'])

export function poGroupColumnMode(columnId: string): PoGroupColumnMode {
  if (columnId === 'shipment_id') return 'sto'
  if (columnId === 'status') return 'status'
  if (ONCE_COLUMNS.has(columnId)) return 'once'
  if (SUM_COLUMNS.has(columnId)) return 'sum'
  return 'stack'
}

/**
 * How far along the pipeline a status is - the same ranks as backend/src/utils/shipmentActiveStageRank.ts (furthest active stage wins; anything
 * not listed, COMPLETED and CANCELLED included, ranks below every active stage).
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
 * The row whose status the PO header shows: the furthest active stage, so the header sits where the PO's OS already sits on the cards. With
 * nothing active, COMPLETED beats CANCELLED (a cancelled leg does not undo a delivered one). Ties keep list order.
 */
export function poGroupStatusRow<T extends { status?: string | null }>(rows: readonly T[]): T {
  const score = (row: T) => {
    const status = String(row.status ?? '').trim().toUpperCase()
    return shipmentStageRank(status) * 10 + (status === 'COMPLETED' ? 1 : 0)
  }
  return rows.reduce((best, row) => (score(row) > score(best) ? row : best))
}
