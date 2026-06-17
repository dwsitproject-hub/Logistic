/**
 * Oil Loss — Section 3 "By Supplier" compact table column order, visibility, and aggregation.
 * Scoped to `/oil-loss` when viewMode === 'by_supplier' only.
 */

import type { OilLossSourceRow } from '@/lib/oilLossAllContractColumns'
import { sumR4OilLossPctByContract } from '@/lib/oilLossSummary'
import type { OilLossByTransporterRow } from '@/lib/oilLossByTransporterColumns'
import {
  OIL_LOSS_BY_TRANSPORTER_COLUMN_WIDTH_PX,
  mergeDistinctTokens,
} from '@/lib/oilLossByTransporterColumns'

export type OilLossBySupplierRow = OilLossByTransporterRow

export const OIL_LOSS_BY_SUPPLIER_COLUMN_LAYOUT_VERSION = 'oil-loss-by-supplier-v1'
export const OIL_LOSS_BY_SUPPLIER_COLUMN_LAYOUT_VERSION_KEY =
  'oil-loss.by-supplier.compact.columnLayoutVersion'

/** Default visible columns — same as By Transporter but supplier first instead of transporter. */
export const OIL_LOSS_BY_SUPPLIER_DEFAULT_VISIBLE_COLUMN_IDS: readonly string[] = [
  'supplier',
  'quantity_contract',
  'quantity_delivery',
  'quantity_received',
  'gain_loss_amount',
  'gain_loss_percentage',
] as const

export const OIL_LOSS_BY_SUPPLIER_COLUMN_WIDTH_PX = OIL_LOSS_BY_TRANSPORTER_COLUMN_WIDTH_PX

function parseNum(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export function oilLossSupplierGroupKey(row: Pick<OilLossSourceRow, 'supplier'>): string {
  const s = String(row.supplier ?? '').trim()
  if (!s) return '__unknown__'
  return s.toLowerCase()
}

export function oilLossSupplierLabel(row: Pick<OilLossSourceRow, 'supplier'>): string {
  const s = String(row.supplier ?? '').trim()
  return s || '-'
}

export function aggregateOilLossBySupplier(rows: OilLossSourceRow[]): OilLossBySupplierRow[] {
  const buckets = new Map<string, { row: OilLossBySupplierRow; groupRows: OilLossSourceRow[] }>()

  for (const row of rows) {
    const key = oilLossSupplierGroupKey(row)
    const delivery = parseNum(row.quantity_sent) ?? 0
    const received = parseNum(row.quantity_received) ?? 0
    const contractQty = parseNum(row.quantity_contract) ?? 0
    const supplierLabel = oilLossSupplierLabel(row)

    const bucket = buckets.get(key)
    if (!bucket) {
      buckets.set(key, {
        groupRows: [row],
        row: {
          id: key,
          transporter: String(row.transporter ?? '').trim() || null,
          supplier: supplierLabel,
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
    existing.transporter = mergeDistinctTokens(existing.transporter, row.transporter) || null
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

export function oilLossBySupplierDefaultVisibleColumnIds(allIds: string[]): string[] {
  return OIL_LOSS_BY_SUPPLIER_DEFAULT_VISIBLE_COLUMN_IDS.filter((id) => allIds.includes(id))
}

export function oilLossBySupplierCompactColumnFallbackOrder(allIds: string[]): string[] {
  const primary = [...OIL_LOSS_BY_SUPPLIER_DEFAULT_VISIBLE_COLUMN_IDS]
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
    'transporter',
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

export function mergeOilLossBySupplierColumnOrder(saved: string[], allIds: string[]): string[] {
  const canonical = oilLossBySupplierCompactColumnFallbackOrder(allIds)
  if (saved.length === 0) return canonical

  const primary = OIL_LOSS_BY_SUPPLIER_DEFAULT_VISIBLE_COLUMN_IDS.filter((id) => allIds.includes(id))
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

export function buildOilLossBySupplierVisibleColumns<T extends { id: string }>(
  columns: T[],
  visibleIds: ReadonlySet<string>,
  orderIds: readonly string[],
): T[] {
  const byId = new Map(columns.map((c) => [c.id, c]))
  const order =
    orderIds.length > 0 ? orderIds : oilLossBySupplierCompactColumnFallbackOrder(columns.map((c) => c.id))
  const out: T[] = []
  for (const id of order) {
    if (!visibleIds.has(id)) continue
    const col = byId.get(id)
    if (col) out.push(col)
  }
  return out
}
