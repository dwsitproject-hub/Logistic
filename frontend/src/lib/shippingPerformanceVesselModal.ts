/**
 * Shipping Performance — Vessel Detail Modal only (View Table > By Vessel).
 * Do not import from other pages or generic modals.
 */

import { resolveShipmentDisplayStoNumber } from './shipmentStoDisplay'
import type { ShippingPerformancePortSource } from './shippingPerformancePorts'

export type ShippingPerfVesselModalSourceRow = ShippingPerformancePortSource & {
  id: string
  shipment_id?: string | null
  sto_number?: string | null
  operation_id?: string | null
  contract_date?: string | null
  contract_ext_no?: string | null
  po_number?: string | null
  product?: string | null
  incoterm?: string | null
  supplier?: string | null
  loading_port?: string | null
  discharge_port?: string | null
  delivered_qty?: number | null
  received_qty?: number | null
  status?: string | null
  vessel_name?: string | null
  loading_delta_eta_etr_days?: number | null
  loading_delta_eta_etb_days?: number | null
  loading_delta_etb_etc_days?: number | null
  discharge_delta_eta_etb_days?: number | null
  discharge_delta_etb_etc_days?: number | null
  ata_loading_delta_eta_etr_days?: number | null
  ata_loading_delta_eta_etb_days?: number | null
  ata_loading_delta_etb_etc_days?: number | null
  ata_discharge_delta_eta_etb_days?: number | null
  ata_discharge_delta_etb_etc_days?: number | null
  ata_total_delta_days?: number | null
  // TC (Time Charter) vessel performance metrics - manually entered, SAP does not feed these.
  fuel_consumption?: number | null
  freight?: number | null
  pump_rate?: number | null
  sailing_speed?: number | null
  shortage?: number | null
}

export type ShippingPerfVesselModalAggregatedRow = {
  id: string
  sto: string | null
  shipment_id: string | null
  contract_date: string | null
  contract_ext_no: string | null
  po_number: string | null
  product: string | null
  incoterm: string | null
  supplier: string | null
  loading_port: string | null
  discharge_port: string | null
  delivered_qty: number | null
  received_qty: number | null
  status: string | null
  loading_delta_eta_etr_days: number | null
  loading_delta_eta_etb_days: number | null
  loading_delta_etb_etc_days: number | null
  discharge_delta_eta_etb_days: number | null
  discharge_delta_etb_etc_days: number | null
  ata_loading_delta_eta_etr_days: number | null
  ata_loading_delta_eta_etb_days: number | null
  ata_loading_delta_etb_etc_days: number | null
  ata_discharge_delta_eta_etb_days: number | null
  ata_discharge_delta_etb_etc_days: number | null
  ata_total_delta_days: number | null
  fuel_consumption: number | null
  freight: number | null
  pump_rate: number | null
  sailing_speed: number | null
  shortage: number | null
}

const PLANNED_STATUSES = new Set(['PLANNED'])
/** Matches Shipments module ATA ladder + legacy aliases (shipmentStatus.ts). */
const ON_GOING_ACTIVE_STATUSES = new Set([
  'IN_PROGRESS',
  'LOADING',
  'IN_TRANSIT',
  'ARRIVED',
  'UNLOADING',
  'ARRIVED_LP',
  'BERTHED_LP',
  'COMPLETED_LOADING',
  'SAILED',
  'ARRIVED_DP',
  'BERTHED_DP',
])
const HISTORY_STATUSES = new Set(['COMPLETED', 'CANCELLED', 'CANCELED'])

export function normalizeShippingPerfVesselModalStatus(
  status: string | null | undefined,
): string {
  return String(status ?? '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '_')
}

export function partitionShippingPerfVesselModalRows<T extends { status?: string | null }>(
  rows: readonly T[],
): { nextShipment: T[]; onGoing: T[]; history: T[] } {
  const nextShipment: T[] = []
  const onGoing: T[] = []
  const history: T[] = []
  for (const row of rows) {
    const status = normalizeShippingPerfVesselModalStatus(row.status)
    if (HISTORY_STATUSES.has(status)) {
      history.push(row)
    } else if (PLANNED_STATUSES.has(status)) {
      nextShipment.push(row)
    } else if (ON_GOING_ACTIVE_STATUSES.has(status)) {
      onGoing.push(row)
    }
  }
  return { nextShipment, onGoing, history }
}

function trimOrNull(value: unknown): string | null {
  const text = String(value ?? '').trim()
  return text ? text : null
}

function joinUnique(values: Array<string | null | undefined>): string | null {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
    const text = trimOrNull(value)
    if (!text || seen.has(text)) continue
    seen.add(text)
    out.push(text)
  }
  return out.length > 0 ? out.join(', ') : null
}

function sumQty(values: Array<number | null | undefined>): number | null {
  let total = 0
  let hasValue = false
  for (const value of values) {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) continue
    total += Number(value)
    hasValue = true
  }
  return hasValue ? total : null
}

function firstNonNull<T>(values: T[], pick: (row: T) => string | null | undefined): string | null {
  for (const value of values) {
    const picked = trimOrNull(pick(value))
    if (picked) return picked
  }
  return null
}

/** Group key: SAP STO when present, else operation_id, else shipment_id. */
export function resolveShippingPerfVesselModalAggregateKey(
  row: Pick<
    ShippingPerfVesselModalSourceRow,
    'id' | 'sto_number' | 'operation_id' | 'shipment_id'
  >,
): string {
  const sto = resolveShipmentDisplayStoNumber(row.sto_number)
  if (sto !== '-') return `sto:${sto}`
  const operationId = trimOrNull(row.operation_id)
  if (operationId) return `op:${operationId}`
  const shipmentId = trimOrNull(row.shipment_id)
  if (shipmentId) return `ship:${shipmentId}`
  return `row:${row.id}`
}

function resolveAggregatedStoDisplay(rows: ShippingPerfVesselModalSourceRow[]): string | null {
  for (const row of rows) {
    const sto = resolveShipmentDisplayStoNumber(row.sto_number)
    if (sto !== '-') return sto
  }
  return null
}

/** Postgres `numeric` columns (e.g. TC vessel metrics) arrive as strings — coerce, don't reject. */
function toFiniteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function avgMetric(
  rows: ShippingPerfVesselModalSourceRow[],
  key: keyof ShippingPerfVesselModalSourceRow,
): number | null {
  const values = rows
    .map((row) => toFiniteNumber(row[key]))
    .filter((value): value is number => value !== null)
  if (values.length === 0) return null
  const avg = values.reduce((sum, value) => sum + value, 0) / values.length
  return Math.round(avg * 10) / 10
}

export function aggregateShippingPerfVesselModalBySto(
  rows: readonly ShippingPerfVesselModalSourceRow[],
): ShippingPerfVesselModalAggregatedRow[] {
  const groups = new Map<string, ShippingPerfVesselModalSourceRow[]>()
  for (const row of rows) {
    const key = resolveShippingPerfVesselModalAggregateKey(row)
    const bucket = groups.get(key)
    if (bucket) bucket.push(row)
    else groups.set(key, [row])
  }

  return [...groups.entries()].map(([groupKey, groupRows]) => ({
    id: groupKey,
    sto: resolveAggregatedStoDisplay(groupRows),
    shipment_id: joinUnique(groupRows.map((row) => row.shipment_id)),
    contract_date: firstNonNull(groupRows, (row) => row.contract_date),
    contract_ext_no: joinUnique(groupRows.map((row) => row.contract_ext_no)),
    po_number: joinUnique(groupRows.map((row) => row.po_number)),
    product: joinUnique(groupRows.map((row) => row.product)),
    incoterm: joinUnique(groupRows.map((row) => row.incoterm)),
    supplier: joinUnique(groupRows.map((row) => row.supplier)),
    loading_port: firstNonNull(groupRows, (row) => row.loading_port),
    discharge_port: firstNonNull(groupRows, (row) => row.discharge_port),
    delivered_qty: sumQty(groupRows.map((row) => row.delivered_qty)),
    received_qty: sumQty(groupRows.map((row) => row.received_qty)),
    status: firstNonNull(groupRows, (row) => row.status),
    loading_delta_eta_etr_days: avgMetric(groupRows, 'loading_delta_eta_etr_days'),
    loading_delta_eta_etb_days: avgMetric(groupRows, 'loading_delta_eta_etb_days'),
    loading_delta_etb_etc_days: avgMetric(groupRows, 'loading_delta_etb_etc_days'),
    discharge_delta_eta_etb_days: avgMetric(groupRows, 'discharge_delta_eta_etb_days'),
    discharge_delta_etb_etc_days: avgMetric(groupRows, 'discharge_delta_etb_etc_days'),
    ata_loading_delta_eta_etr_days: avgMetric(groupRows, 'ata_loading_delta_eta_etr_days'),
    ata_loading_delta_eta_etb_days: avgMetric(groupRows, 'ata_loading_delta_eta_etb_days'),
    ata_loading_delta_etb_etc_days: avgMetric(groupRows, 'ata_loading_delta_etb_etc_days'),
    ata_discharge_delta_eta_etb_days: avgMetric(groupRows, 'ata_discharge_delta_eta_etb_days'),
    ata_discharge_delta_etb_etc_days: avgMetric(groupRows, 'ata_discharge_delta_etb_etc_days'),
    ata_total_delta_days: avgMetric(groupRows, 'ata_total_delta_days'),
    // TC vessel metrics are per-shipment; average across the group's rows (usually identical).
    fuel_consumption: avgMetric(groupRows, 'fuel_consumption'),
    freight: avgMetric(groupRows, 'freight'),
    pump_rate: avgMetric(groupRows, 'pump_rate'),
    sailing_speed: avgMetric(groupRows, 'sailing_speed'),
    shortage: avgMetric(groupRows, 'shortage'),
  }))
}

export type VesselModalOpenColumnKey =
  | 'sto'
  | 'contract_date'
  | 'po_number'
  | 'product'
  | 'incoterm'
  | 'supplier'
  | 'loading_port'
  | 'discharge_port'
  | 'delivered_qty'
  | 'received_qty'
  | 'status'
  | 'loading_delta_eta_etr_days'
  | 'loading_delta_eta_etb_days'
  | 'loading_delta_etb_etc_days'
  | 'discharge_delta_eta_etb_days'
  | 'discharge_delta_etb_etc_days'
  | 'fuel_consumption'
  | 'freight'
  | 'pump_rate'
  | 'sailing_speed'
  | 'shortage'

export type VesselModalHistoryColumnKey =
  | 'sto'
  | 'contract_date'
  | 'po_number'
  | 'product'
  | 'incoterm'
  | 'supplier'
  | 'loading_port'
  | 'discharge_port'
  | 'delivered_qty'
  | 'received_qty'
  | 'status'
  | 'ata_loading_delta_eta_etr_days'
  | 'ata_loading_delta_eta_etb_days'
  | 'ata_loading_delta_etb_etc_days'
  | 'ata_discharge_delta_eta_etb_days'
  | 'ata_discharge_delta_etb_etc_days'
  | 'fuel_consumption'
  | 'freight'
  | 'pump_rate'
  | 'sailing_speed'
  | 'shortage'

export const VESSEL_MODAL_OPEN_COLUMNS: ReadonlyArray<{
  key: VesselModalOpenColumnKey
  label: string
  align?: 'left' | 'right'
}> = [
  { key: 'sto', label: 'STO' },
  { key: 'contract_date', label: 'Contract Date' },
  { key: 'po_number', label: 'PO' },
  { key: 'product', label: 'Product' },
  { key: 'incoterm', label: 'Incoterm' },
  { key: 'supplier', label: 'Supplier' },
  { key: 'loading_port', label: 'Loading Port' },
  { key: 'discharge_port', label: 'Discharge Port' },
  { key: 'delivered_qty', label: 'Qty Delivery', align: 'right' },
  { key: 'received_qty', label: 'Qty Receive', align: 'right' },
  { key: 'status', label: 'Status' },
  { key: 'loading_delta_eta_etr_days', label: 'Loading ETA - ETR', align: 'right' },
  { key: 'loading_delta_eta_etb_days', label: 'Loading ETA - ETB', align: 'right' },
  { key: 'loading_delta_etb_etc_days', label: 'Loading ETB - ETC', align: 'right' },
  { key: 'discharge_delta_eta_etb_days', label: 'Discharge ETA - ETB', align: 'right' },
  { key: 'discharge_delta_etb_etc_days', label: 'Discharge ETB - ETC', align: 'right' },
  { key: 'fuel_consumption', label: 'Fuel Consumption', align: 'right' },
  { key: 'freight', label: 'Freight', align: 'right' },
  { key: 'pump_rate', label: 'Pump Rate', align: 'right' },
  { key: 'sailing_speed', label: 'Sailing Speed', align: 'right' },
  { key: 'shortage', label: 'Shortage', align: 'right' },
]

export const VESSEL_MODAL_HISTORY_COLUMNS: ReadonlyArray<{
  key: VesselModalHistoryColumnKey
  label: string
  align?: 'left' | 'right'
}> = [
  { key: 'sto', label: 'STO' },
  { key: 'contract_date', label: 'Contract Date' },
  { key: 'po_number', label: 'PO' },
  { key: 'product', label: 'Product' },
  { key: 'incoterm', label: 'Incoterm' },
  { key: 'supplier', label: 'Supplier' },
  { key: 'loading_port', label: 'Loading Port' },
  { key: 'discharge_port', label: 'Discharge Port' },
  { key: 'delivered_qty', label: 'Qty Delivery', align: 'right' },
  { key: 'received_qty', label: 'Qty Receive', align: 'right' },
  { key: 'status', label: 'Status' },
  { key: 'ata_loading_delta_eta_etr_days', label: 'Loading ATA - ATR', align: 'right' },
  { key: 'ata_loading_delta_eta_etb_days', label: 'Loading ATA - ATB', align: 'right' },
  { key: 'ata_loading_delta_etb_etc_days', label: 'Loading ATB - ATC', align: 'right' },
  { key: 'ata_discharge_delta_eta_etb_days', label: 'Discharge ATA - ATB', align: 'right' },
  { key: 'ata_discharge_delta_etb_etc_days', label: 'Discharge ATB - ATC', align: 'right' },
  { key: 'fuel_consumption', label: 'Fuel Consumption', align: 'right' },
  { key: 'freight', label: 'Freight', align: 'right' },
  { key: 'pump_rate', label: 'Pump Rate', align: 'right' },
  { key: 'sailing_speed', label: 'Sailing Speed', align: 'right' },
  { key: 'shortage', label: 'Shortage', align: 'right' },
]

export function formatShippingPerfVesselModalDate(value: string | null | undefined): string {
  if (!value) return '-'
  const iso = String(value).slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso || '-'
  const [, year, month, day] = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/) ?? []
  if (!year || !month || !day) return iso
  return `${day}/${month}/${year}`
}

export function formatShippingPerfVesselModalQtyMt(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '-'
  const mt = Number(value) / 1000
  return `${mt.toLocaleString('en-US', { maximumFractionDigits: 2 })} MT`
}

const OPEN_DELTA_COLUMN_KEYS = new Set<VesselModalOpenColumnKey>([
  'loading_delta_eta_etr_days',
  'loading_delta_eta_etb_days',
  'loading_delta_etb_etc_days',
  'discharge_delta_eta_etb_days',
  'discharge_delta_etb_etc_days',
])

const HISTORY_DELTA_COLUMN_KEYS = new Set<VesselModalHistoryColumnKey>([
  'ata_loading_delta_eta_etr_days',
  'ata_loading_delta_eta_etb_days',
  'ata_loading_delta_etb_etc_days',
  'ata_discharge_delta_eta_etb_days',
  'ata_discharge_delta_etb_etc_days',
])

export function isVesselModalOpenDeltaColumn(key: VesselModalOpenColumnKey): boolean {
  return OPEN_DELTA_COLUMN_KEYS.has(key)
}

export function isVesselModalHistoryDeltaColumn(key: VesselModalHistoryColumnKey): boolean {
  return HISTORY_DELTA_COLUMN_KEYS.has(key)
}

export function resolveVesselModalOpenDeltaDays(
  row: ShippingPerfVesselModalAggregatedRow,
  key: VesselModalOpenColumnKey,
): number | null {
  if (!isVesselModalOpenDeltaColumn(key)) return null
  const value = row[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function resolveVesselModalHistoryDeltaDays(
  row: ShippingPerfVesselModalAggregatedRow,
  key: VesselModalHistoryColumnKey,
): number | null {
  if (!isVesselModalHistoryDeltaColumn(key)) return null
  const value = row[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function sortShippingPerfVesselModalRows(
  rows: ShippingPerfVesselModalAggregatedRow[],
): ShippingPerfVesselModalAggregatedRow[] {
  return [...rows].sort((a, b) => {
    const aDate = String(a.contract_date ?? '').slice(0, 10)
    const bDate = String(b.contract_date ?? '').slice(0, 10)
    return bDate.localeCompare(aDate)
  })
}
