/**
 * Oil Loss — Section 3 "By Transporter" compact table column order, visibility, and aggregation.
 * Scoped to `/oil-loss` when viewMode === 'by_transporter' only.
 */

import type { OilLossSourceRow } from '@/lib/oilLossAllContractColumns'
import { sumR4OilLossPctByContract } from '@/lib/oilLossSummary'
import { formatOperationalTableTextDisplay } from '@/lib/sapDisplayValue'

export const OIL_LOSS_BY_TRANSPORTER_COLUMN_LAYOUT_VERSION = 'oil-loss-by-transporter-v2'
export const OIL_LOSS_BY_TRANSPORTER_COLUMN_LAYOUT_VERSION_KEY =
  'oil-loss.by-transporter.compact.columnLayoutVersion'

/** Default visible columns in left-to-right table order. */
export const OIL_LOSS_BY_TRANSPORTER_DEFAULT_VISIBLE_COLUMN_IDS: readonly string[] = [
  'transporter',
  'quantity_contract',
  'quantity_delivery',
  'quantity_received',
  'gain_loss_amount',
  'gain_loss_percentage',
] as const

export const OIL_LOSS_BY_TRANSPORTER_COLUMN_WIDTH_PX: Readonly<Record<string, number>> = {
  transporter: 120,
  loading_location: 120,
  unloading_location: 120,
  contract_ext_no: 120,
  sto_number: 110,
  quantity_delivery: 96,
  quantity_received: 96,
  gain_loss_amount: 96,
  gain_loss_percentage: 88,
  contract_date: 100,
  po_number: 110,
  product: 120,
  incoterm: 72,
  quantity_contract: 96,
  status: 80,
  transport_mode: 72,
  group_name: 88,
  supplier: 120,
  buyer: 88,
  plant_site: 100,
  operation_id: 120,
  contract_number: 110,
  quantity_sfal: 96,
  quantity_sfbd: 96,
}

export type OilLossByTransporterRow = {
  id: string
  transporter: string | null
  loading_location: string | null
  unloading_location: string | null
  contract_ext_no: string | null
  sto_number: string | null
  quantity_delivery: number | null
  quantity_received: number | null
  gain_loss_amount: number | null
  gain_loss_percentage: number | null
  contract_date: string | null
  po_number: string | null
  product: string | null
  incoterm: string | null
  quantity_contract: number | null
  status: string | null
  transport_mode: string | null
  group_name: string | null
  supplier: string | null
  buyer: string | null
  plant_site: string | null
  operation_id: string | null
  contract_number: string | null
  quantity_sfal: number | null
  quantity_sfbd: number | null
  row_count: number
}

function parseNum(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export function mergeDistinctTokens(existing: string | null | undefined, incoming: string | null | undefined): string {
  const parts = new Set<string>()
  for (const raw of [existing, incoming]) {
    const s = String(raw ?? '').trim()
    if (!s) continue
    for (const piece of s.split(',')) {
      const t = piece.trim()
      if (t) parts.add(t)
    }
  }
  return [...parts].join(', ')
}

export function oilLossTransporterGroupKey(row: Pick<OilLossSourceRow, 'transporter'>): string {
  const t = String(row.transporter ?? '').trim()
  if (!t) return '__unknown__'
  return t.toLowerCase()
}

export function oilLossTransporterLabel(row: Pick<OilLossSourceRow, 'transporter'>): string {
  return formatOperationalTableTextDisplay(row.transporter)
}

export function aggregateOilLossByTransporter(rows: OilLossSourceRow[]): OilLossByTransporterRow[] {
  const buckets = new Map<string, { row: OilLossByTransporterRow; groupRows: OilLossSourceRow[] }>()

  for (const row of rows) {
    const key = oilLossTransporterGroupKey(row)
    const delivery = parseNum(row.quantity_sent) ?? 0
    const received = parseNum(row.quantity_received) ?? 0
    const contractQty = parseNum(row.quantity_contract) ?? 0
    const transporterLabel = oilLossTransporterLabel(row)

    const bucket = buckets.get(key)
    if (!bucket) {
      buckets.set(key, {
        groupRows: [row],
        row: {
          id: key,
          transporter: transporterLabel,
          loading_location: String(row.loading_location ?? '').trim() || null,
          unloading_location: String(row.unloading_location ?? '').trim() || null,
          contract_ext_no: String(row.contract_ext_no ?? '').trim() || null,
          sto_number: String(row.sto_number ?? '').trim() || null,
          quantity_delivery: delivery,
          quantity_received: received,
          gain_loss_amount: received - delivery,
          gain_loss_percentage: 0,
          contract_date: String(row.contract_date ?? row.operation_date ?? '').slice(0, 10) || null,
          po_number: String(row.po_number ?? '').trim() || null,
          product: String(row.product ?? '').trim() || null,
          incoterm: String(row.incoterm ?? '').trim() || null,
          quantity_contract: contractQty,
          status: String(row.status ?? '').trim() || null,
          transport_mode: String(row.transport_mode ?? '').trim() || null,
          group_name: String(row.group_name ?? '').trim() || null,
          supplier: String(row.supplier ?? '').trim() || null,
          buyer: String(row.buyer ?? '').trim() || null,
          plant_site: String(row.plant_site ?? '').trim() || null,
          operation_id: String(row.operation_id ?? '').trim() || null,
          contract_number: String(row.contract_number ?? '').trim() || null,
          quantity_sfal: parseNum(row.quantity_sfal),
          quantity_sfbd: parseNum(row.quantity_sfbd),
          row_count: 1,
        },
      })
      continue
    }

    const existing = bucket.row
    bucket.groupRows.push(row)
    existing.loading_location =
      mergeDistinctTokens(existing.loading_location, row.loading_location) || null
    existing.unloading_location =
      mergeDistinctTokens(existing.unloading_location, row.unloading_location) || null
    existing.contract_ext_no = mergeDistinctTokens(existing.contract_ext_no, row.contract_ext_no) || null
    existing.sto_number = mergeDistinctTokens(existing.sto_number, row.sto_number) || null
    existing.quantity_delivery = (existing.quantity_delivery ?? 0) + delivery
    existing.quantity_received = (existing.quantity_received ?? 0) + received
    existing.gain_loss_amount = (existing.quantity_received ?? 0) - (existing.quantity_delivery ?? 0)
    existing.quantity_contract = (existing.quantity_contract ?? 0) + contractQty
    existing.quantity_sfal = (existing.quantity_sfal ?? 0) + (parseNum(row.quantity_sfal) ?? 0)
    existing.quantity_sfbd = (existing.quantity_sfbd ?? 0) + (parseNum(row.quantity_sfbd) ?? 0)
    existing.row_count += 1
  }

  for (const bucket of buckets.values()) {
    bucket.row.gain_loss_percentage = Number(sumR4OilLossPctByContract(bucket.groupRows).toFixed(4))
  }

  return [...buckets.values()].map((bucket) => bucket.row)
}

export function oilLossByTransporterDefaultVisibleColumnIds(allIds: string[]): string[] {
  return OIL_LOSS_BY_TRANSPORTER_DEFAULT_VISIBLE_COLUMN_IDS.filter((id) => allIds.includes(id))
}

export function oilLossByTransporterCompactColumnFallbackOrder(allIds: string[]): string[] {
  const primary = [...OIL_LOSS_BY_TRANSPORTER_DEFAULT_VISIBLE_COLUMN_IDS]
  const hiddenOrder = [
    'loading_location',
    'unloading_location',
    'contract_ext_no',
    'sto_number',
    'contract_date',
    'po_number',
    'product',
    'incoterm',
    'status',
    'transport_mode',
    'group_name',
    'supplier',
    'buyer',
    'plant_site',
    'operation_id',
    'contract_number',
    'quantity_sfal',
    'quantity_sfbd',
  ]
  const seen = new Set<string>()
  const out: string[] = []
  for (const id of [...primary, ...hiddenOrder]) {
    if (allIds.includes(id) && !seen.has(id)) {
      out.push(id)
      seen.add(id)
    }
  }
  for (const id of allIds) {
    if (!seen.has(id)) {
      out.push(id)
      seen.add(id)
    }
  }
  return out
}

export function mergeOilLossByTransporterColumnOrder(saved: string[], allIds: string[]): string[] {
  const canonical = oilLossByTransporterCompactColumnFallbackOrder(allIds)
  if (saved.length === 0) return canonical

  const primary = OIL_LOSS_BY_TRANSPORTER_DEFAULT_VISIBLE_COLUMN_IDS.filter((id) => allIds.includes(id))
  const primarySet = new Set(primary)
  const extras: string[] = []
  const seen = new Set<string>()

  for (const id of saved) {
    if (allIds.includes(id) && !primarySet.has(id) && !seen.has(id)) {
      extras.push(id)
      seen.add(id)
    }
  }
  for (const id of canonical) {
    if (!primarySet.has(id) && !seen.has(id)) {
      extras.push(id)
      seen.add(id)
    }
  }
  return [...primary, ...extras]
}

export function buildOilLossByTransporterVisibleColumns<T extends { id: string }>(
  columns: T[],
  visibleIds: ReadonlySet<string>,
  orderIds: readonly string[],
): T[] {
  const byId = new Map(columns.map((c) => [c.id, c]))
  const order =
    orderIds.length > 0 ? orderIds : oilLossByTransporterCompactColumnFallbackOrder(columns.map((c) => c.id))
  const out: T[] = []
  for (const id of order) {
    if (!visibleIds.has(id)) continue
    const col = byId.get(id)
    if (col) out.push(col)
  }
  return out
}
