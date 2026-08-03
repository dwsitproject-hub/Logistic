'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import Layout from '@/components/Layout'
import { canViewShippingPerformancePage, usePermissions } from '@/components/PermissionsContext'
import api from '@/lib/api'
import { isAuthenticatedLocally } from '@/lib/authSession'
import { buildCacheKey, cachedGet, invalidateLogisticsListCaches, peekCache } from '@/lib/clientDataCache'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Eye, GripVertical, Loader2, MessageSquare, Package, Search, SlidersHorizontal, X } from 'lucide-react'
import { PerformanceScopeFilters } from '@/components/performance/PerformanceScopeFilters'
import { PerformanceSection1CardShell } from '@/components/performance/PerformanceSection1CardShell'
import PerformanceDrilldownScopeLine from '@/components/performance/PerformanceDrilldownScopeLine'
import { SearchableMultiSelect } from '@/components/SearchableMultiSelect'
import VesselHistoryModal, {
  type VesselHistoryModalSelection,
} from '@/components/shipping-performance/VesselHistoryModal'
import {
  normalizeScopeGroupKey,
  rowMatchesGlobalSearch,
  rowMatchesToolbarMultiFilters,
} from '@/lib/globalScopeFilters'
import {
  formatAvgDays,
  formatSignedCycleDays,
  formatSignedDeltaDays,
  signedCycleDaysClass,
} from '@/lib/cycleDaysDisplay'
import {
  formatShippingPerfDisplayLabel,
  getShippingSummaryMetricLabel,
  perfDataModeFromCard,
  resolveShippingPerfLabelMode,
  SHIPPING_PERF_CARD_TITLES,
  type ShippingPerfCardFilter,
  type ShippingSummaryMetricKey,
} from '@/lib/shippingPerformanceLabels'
import { resolveShippingPerfTotalDeltaDisplay } from '@/lib/shippingPerformanceTotalDelta'
import { formatOperationalTableTextDisplay, formatSapGroupDisplayLabel, formatSapOutstandingQtyMtDisplay, formatVesselTableDisplay, isEmptySapDisplayValue } from '@/lib/sapDisplayValue'
import {
  addDistinctContractIds,
  addDistinctShippingPerfVessel,
  countUniqueContractsFromField,
  countUniqueShippingPerfVessels,
  isCountableShippingPerfVessel,
} from '@/lib/shippingPerformanceSummaryCounts'
import { outstandingQtyMtColorClass } from '@/lib/utils'
import { FIELD_HELP } from '@/lib/fieldHelpText'
import { formatShipmentStatusLabel, shipmentStatusBadgeClass } from '@/lib/shipmentStatusDisplay'
import {
  COMPACT_TABLE_ACTIONS_CELL_CLASS,
  COMPACT_TABLE_ACTIONS_HEADER_CLASS,
  SHIPPING_PERF_TABLE_BODY_CLASS,
  SHIPPING_PERF_TABLE_CELL_PAD,
  SHIPPING_PERF_TABLE_HEADER_ROW_CLASS,
  SHIPPING_PERF_TABLE_ROW_MIN_H,
  SHIPPING_PERF_TRUNCATE_TOOLTIP_COLUMN_IDS,
  buildAllShipmentsPresetVisibleColumns,
  ensureAllShipmentsPresetColumnOrder,
  getShippingPerfTableColumnLayout,
  isAllShipmentsPresetVisibleColumn,
  shippingPerfCellTooltipText,
  shippingPerfTableColumnWidthPx,
} from '@/lib/shippingPerformanceTableUi'
import {
  COMPACT_OPERATIONAL_TABLE_CELL_CLASS,
  COMPACT_OPERATIONAL_TABLE_CELL_INNER_CLASS,
  COMPACT_OPERATIONAL_TABLE_CLASS,
  COMPACT_OPERATIONAL_TABLE_ROW_VCENTER_CLASS,
  COMPACT_OPERATIONAL_TABLE_SCROLL_CLASS,
  compactTableColWidthCss,
} from '@/lib/compactTableUi'
import { ContractPerfTruncatedCell } from '@/components/performance/ContractPerfTruncatedCell'
import { operationalTableColumnClass } from '@/lib/operationalTableLayout'
import { ContractPerfTableSortHeader } from '@/components/performance/ContractPerfTableSortHeader'
import { TableInitialLoadPlaceholder } from '@/components/performance/TableInitialLoadPlaceholder'
import {
  applySection3PortDisplay,
  resolveShippingPerfDischargePort,
  resolveShippingPerfLoadingPort,
} from '@/lib/shippingPerformancePorts'
import { cn } from '@/lib/utils'
import { ViewShipmentModal } from '@/components/shared/ViewShipmentModal'
import { HistoricalRemarksModal } from '@/components/shared/HistoricalRemarksModal'
import {
  mergeShippingPerfColumnOrder,
  mergeShippingPerfVisibleColumns,
  parseShippingPerfColumnPrefsFromApiValue,
  readShippingPerfColumnPrefsFromStorage,
  SHIPPING_PERF_COLUMN_PREFS_STORAGE_KEY,
  SHIPPING_PERF_COLUMN_PREFS_USER_KEY,
  writeShippingPerfColumnPrefsToStorage,
  type ShippingPerfColumnPrefs,
  type ShippingPerfColumnPrefsByMode,
} from '@/lib/shippingPerformanceColumnPrefs'
import { resolveShipmentApiLookupKey } from '@/lib/shipmentStoDisplay'
import { PerformancePeriodSelect } from '@/components/performance/PerformancePeriodSelect'
import {
  CONTRACT_PERF_PRODUCT_MULTI_OPTIONS,
  CONTRACT_PERF_SOURCE_MULTI_OPTIONS,
} from '@/lib/contractPerformanceFilters'
import { applyShippingPerfSourceProductFilter } from '@/lib/shippingPerformanceScopeFilters'
import {
  resolvePerformancePeriodDateRange,
  rowMatchesPerformancePeriod,
  type PerformancePeriodKey,
} from '@/lib/performancePeriodFilters'
import {
  applyShippingPerfCardFilter,
} from '@/lib/shippingPerformanceCardFilter'

interface ShippingPerformanceRow {
  id: string
  shipment_id: string
  po_number?: string | null
  contract_ext_no?: string | null
  contract_number: string
  sto_number?: string | null
  operation_id?: string | null
  contract_date?: string | null
  incoterm?: string | null
  product?: string | null
  /** contracts.source_type — used by client-only Source toggle (Interco / 3rd Party). */
  source_type?: string | null
  supplier?: string | null
  contract_qty?: number | null
  status?: string | null
  /** SAP GR PO / GR STO status resolved by incoterm matrix. */
  import_status?: string | null
  plant_site?: string | null
  vessel_name: string | null
  group_name: string | null
  loading_delta_eta_etr_days: number | null
  loading_delta_eta_etb_days: number | null
  loading_delta_etb_etc_days: number | null
  discharge_delta_eta_etb_days: number | null
  discharge_delta_etb_etc_days: number | null
  total_delta_days: number | null
  sto_qty?: number | null
  received_qty?: number | null
  delivered_qty?: number | null
  planning_qty?: number | null
  outstanding_qty_actual?: number | null
  outstanding_qty_planning?: number | null
  /** @deprecated Use outstanding_qty_actual — kept for API backward compatibility. */
  outstanding_qty?: number | null
  shipment_count?: number | null
  cargo_readiness_date?: string | null
  loading_eta_arrival?: string | null
  loading_eta_berthed?: string | null
  loading_eta_completed?: string | null
  discharge_eta_arrival?: string | null
  discharge_eta_berthed?: string | null
  discharge_eta_completed?: string | null
  loading_ata_arrival?: string | null
  loading_ata_berthed?: string | null
  loading_ata_completed?: string | null
  discharge_ata_arrival?: string | null
  discharge_ata_berthed?: string | null
  discharge_ata_completed?: string | null
  loading_port?: string | null
  discharge_port?: string | null
  /** Shipment operation — raw from shipments.port_of_loading (may be null when unset). */
  port_of_loading?: string | null
  /** Shipment operation — raw from shipments.port_of_discharge (may be null when unset). */
  port_of_discharge?: string | null
  /** Shipment operation — vessel_loading_ports.port_name (loading leg). */
  vlp_loading_port_name?: string | null
  /** Shipment operation — vessel_loading_ports.port_name (discharge leg). */
  vlp_discharge_port_name?: string | null
  /** SAP fallback — Vessel Loading Port text name. */
  sap_vessel_loading_port_1?: string | null
  /** SAP fallback — Vessel Discharge Port text name. */
  sap_vessel_discharge_port?: string | null
  remark?: string | null
  ata_loading_delta_eta_etr_days?: number | null
  ata_loading_delta_eta_etb_days?: number | null
  ata_loading_delta_etb_etc_days?: number | null
  ata_discharge_delta_eta_etb_days?: number | null
  ata_discharge_delta_etb_etc_days?: number | null
  ata_total_delta_days?: number | null
  /** Computed: numerator MT / loading berth→complete days (actual). Null when N/A. */
  lp_flow_rate?: number | null
  /** Computed: numerator MT / discharge berth→complete days (actual). Null when N/A. */
  dp_flow_rate?: number | null
}

type TableViewMode = 'all' | 'by_vessel'
type PerfDashMode = 'eta' | 'ata'
type TableStatusFilter = 'All' | 'Open' | 'Closed'

type TableColumnKey = keyof ShippingPerformanceRow

/** By Vessel table only — display keys mapped to row payload fields. */
type ByVesselOnlyColumnKey =
  | 'by_vessel_qty_contract'
  | 'by_vessel_qty_delivery'
  | 'by_vessel_qty_receive'

type ShippingPerfColumnKey = TableColumnKey | ByVesselOnlyColumnKey

const BY_VESSEL_QTY_COLUMN_DATA_KEYS: Record<ByVesselOnlyColumnKey, TableColumnKey> = {
  by_vessel_qty_contract: 'contract_qty',
  by_vessel_qty_delivery: 'delivered_qty',
  by_vessel_qty_receive: 'received_qty',
}

function isByVesselOnlyColumnKey(key: ShippingPerfColumnKey): key is ByVesselOnlyColumnKey {
  return Object.prototype.hasOwnProperty.call(BY_VESSEL_QTY_COLUMN_DATA_KEYS, key)
}

function resolveColumnDataKey(
  colKey: ShippingPerfColumnKey,
  mode: PerfDashMode,
): TableColumnKey {
  if (isByVesselOnlyColumnKey(colKey)) {
    return BY_VESSEL_QTY_COLUMN_DATA_KEYS[colKey]
  }
  return resolvePerfTableDataKey(colKey, mode)
}

/** Shipment-level columns hidden in the By Vessel summary view. */
const DETAIL_COLUMN_KEYS = new Set<string>([
  'status',
  'po_number',
  'contract_number',
  'sto_number',
  'group_name',
  'incoterm',
  'product',
  'supplier',
  'contract_qty',
  'delivered_qty',
  'plant_site',
  'contract_date',
  'loading_port',
  'discharge_port',
])

const ALL_SHIPMENTS_HIDDEN_COLUMNS = new Set<string>(['group_name'])

/** Hidden in the By Vessel summary table. */
const BY_VESSEL_HIDDEN_COLUMNS = new Set<string>(['group_name'])

/** Section 3 — shown only in the By Vessel aggregated view. */
const BY_VESSEL_ONLY_COLUMNS = new Set<string>(['contract_ext_no'])

const OPEN_TABLE_STATUSES = new Set([
  'PLANNED',
  'IN_PROGRESS',
  'LOADING',
  'IN_TRANSIT',
  'ARRIVED',
  'UNLOADING',
])

function isUnplannedShippingStatus(status: string | null | undefined): boolean {
  return String(status ?? '').trim().toUpperCase() === 'UNPLANNED'
}

/** Shipping Performance page only — excludes UNPLANNED from all sections. */
function excludeUnplannedShippingRows(rows: ShippingPerformanceRow[]): ShippingPerformanceRow[] {
  return rows.filter((row) => !isUnplannedShippingStatus(row.status))
}

/**
 * Global filter section (search, incoterm, group plant, vessel, status, contract date).
 * When false: UI is hidden (not removed) and the filter pipeline is bypassed.
 */
const SHIPPING_PERF_GLOBAL_FILTERS_ENABLED = false

/**
 * Port flow rate = shipped MT / berth→complete duration (days, actual dates).
 * `deltaBerthedMinusCompleted` is the row's ATA "ETB - ETC" delta (berthed − completed),
 * so the duration is its negation. Returns null when duration is missing/≤0 or qty missing.
 */
function computePortFlowRate(
  numeratorKg: number | null | undefined,
  deltaBerthedMinusCompleted: number | null | undefined,
): number | null {
  const days =
    typeof deltaBerthedMinusCompleted === 'number' && Number.isFinite(deltaBerthedMinusCompleted)
      ? -deltaBerthedMinusCompleted
      : null
  if (days === null || days <= 0) return null
  if (typeof numeratorKg !== 'number' || !Number.isFinite(numeratorKg)) return null
  return numeratorKg / 1000 / days
}

/** LP/DP flow rate for one shipment row. FOB uses Delivered Qty; everything else uses Received Qty. */
function computeRowFlowRates(row: ShippingPerformanceRow): {
  lp_flow_rate: number | null
  dp_flow_rate: number | null
} {
  const isFob = String(row.incoterm ?? '').trim().toUpperCase() === 'FOB'
  const numeratorKg = isFob ? row.delivered_qty : row.received_qty
  return {
    lp_flow_rate: computePortFlowRate(numeratorKg, row.ata_loading_delta_etb_etc_days),
    dp_flow_rate: computePortFlowRate(numeratorKg, row.ata_discharge_delta_etb_etc_days),
  }
}

/** Materialize lp_flow_rate/dp_flow_rate on each row so render + sort + averaging read a field. */
function materializeFlowRates(rows: ShippingPerformanceRow[]): ShippingPerformanceRow[] {
  return rows.map((row) => ({ ...row, ...computeRowFlowRates(row) }))
}

function avgMetric(rows: ShippingPerformanceRow[], key: TableColumnKey): number | null {
  const vals = rows
    .map((r) => r[key])
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
  if (vals.length === 0) return null
  const avg = vals.reduce((sum, v) => sum + v, 0) / vals.length
  return Math.round(avg * 10) / 10
}

function sumMetric(rows: ShippingPerformanceRow[], key: TableColumnKey): number {
  return rows.reduce((sum, r) => sum + Number(r[key] ?? 0), 0)
}

/** By Vessel view — unique non-empty contract ext numbers, comma-separated. */
function aggregateUniqueContractExtNos(vesselRows: ShippingPerformanceRow[]): string | null {
  const seen = new Set<string>()
  const values: string[] = []
  for (const row of vesselRows) {
    const value = String(row.contract_ext_no ?? '').trim()
    if (!value || seen.has(value)) continue
    seen.add(value)
    values.push(value)
  }
  return values.length > 0 ? values.join(', ') : null
}

/** Logical delta column keys in the table — map to ATA payload fields when Close card is active. */
const PERF_DELTA_LOGICAL_KEYS = [
  'loading_delta_eta_etr_days',
  'loading_delta_eta_etb_days',
  'loading_delta_etb_etc_days',
  'discharge_delta_eta_etb_days',
  'discharge_delta_etb_etc_days',
  'total_delta_days',
] as const satisfies ReadonlyArray<keyof ShippingPerformanceRow>

const PERF_DELTA_ATA_KEY_MAP: Record<
  (typeof PERF_DELTA_LOGICAL_KEYS)[number],
  keyof ShippingPerformanceRow
> = {
  loading_delta_eta_etr_days: 'ata_loading_delta_eta_etr_days',
  loading_delta_eta_etb_days: 'ata_loading_delta_eta_etb_days',
  loading_delta_etb_etc_days: 'ata_loading_delta_etb_etc_days',
  discharge_delta_eta_etb_days: 'ata_discharge_delta_eta_etb_days',
  discharge_delta_etb_etc_days: 'ata_discharge_delta_etb_etc_days',
  total_delta_days: 'ata_total_delta_days',
}

function isPerfDeltaLogicalKey(key: string): key is (typeof PERF_DELTA_LOGICAL_KEYS)[number] {
  return Object.prototype.hasOwnProperty.call(PERF_DELTA_ATA_KEY_MAP, key)
}

function resolvePerfTableDataKey(
  logicalKey: keyof ShippingPerformanceRow,
  mode: PerfDashMode,
): keyof ShippingPerformanceRow {
  if (mode === 'eta' || !isPerfDeltaLogicalKey(String(logicalKey))) return logicalKey
  return PERF_DELTA_ATA_KEY_MAP[logicalKey as keyof typeof PERF_DELTA_ATA_KEY_MAP]
}

/** UI tooltip text only — same E→A replacements as column headers when Close. */
function resolvePerfColumnTooltip(
  tooltip: string | undefined,
  labelMode: ReturnType<typeof resolveShippingPerfLabelMode>,
): string | undefined {
  if (!tooltip) return tooltip
  return formatShippingPerfDisplayLabel(tooltip, labelMode)
}

type PerfDeltaAggregateKey =
  | (typeof PERF_DELTA_LOGICAL_KEYS)[number]
  | (typeof PERF_DELTA_ATA_KEY_MAP)[(typeof PERF_DELTA_LOGICAL_KEYS)[number]]

function aggregateDeltaFields(
  vesselRows: ShippingPerformanceRow[],
): Record<PerfDeltaAggregateKey, number | null> {
  const fields = {} as Record<PerfDeltaAggregateKey, number | null>
  for (const logicalKey of PERF_DELTA_LOGICAL_KEYS) {
    const ataKey = PERF_DELTA_ATA_KEY_MAP[logicalKey]
    fields[logicalKey] = avgMetric(vesselRows, logicalKey)
    fields[ataKey] = avgMetric(vesselRows, ataKey)
  }
  return fields
}

function aggregateByVessel(rows: ShippingPerformanceRow[]): ShippingPerformanceRow[] {
  const groups = new Map<string, ShippingPerformanceRow[]>()
  for (const row of rows) {
    // Match Section 1 Total Vessels — exclude null / blank / Unknown placeholders.
    if (!isCountableShippingPerfVessel(row.vessel_name)) continue
    const key = normalizeVesselKey(row.vessel_name)
    const bucket = groups.get(key)
    if (bucket) bucket.push(row)
    else groups.set(key, [row])
  }

  return [...groups.entries()].map(([vesselKey, vesselRows]): ShippingPerformanceRow => {
    const deltas = aggregateDeltaFields(vesselRows)
    return {
      id: `vessel-group:${vesselKey}`,
      shipment_id: '',
      contract_number: '',
      group_name: null,
      vessel_name: vesselKey,
      po_number: null,
      contract_ext_no: aggregateUniqueContractExtNos(vesselRows),
      sto_number: null,
      contract_date: null,
      incoterm: null,
      product: null,
      supplier: null,
      contract_qty: sumMetric(vesselRows, 'contract_qty'),
      status: null,
      plant_site: null,
      shipment_count: vesselRows.length,
      sto_qty: sumMetric(vesselRows, 'sto_qty'),
      received_qty: sumMetric(vesselRows, 'received_qty'),
      delivered_qty: sumMetric(vesselRows, 'delivered_qty'),
      outstanding_qty_actual: sumMetric(vesselRows, 'outstanding_qty_actual'),
      outstanding_qty_planning: sumMetric(vesselRows, 'outstanding_qty_planning'),
      outstanding_qty: sumMetric(vesselRows, 'outstanding_qty_actual'),
      loading_delta_eta_etr_days: deltas.loading_delta_eta_etr_days,
      loading_delta_eta_etb_days: deltas.loading_delta_eta_etb_days,
      loading_delta_etb_etc_days: deltas.loading_delta_etb_etc_days,
      discharge_delta_eta_etb_days: deltas.discharge_delta_eta_etb_days,
      discharge_delta_etb_etc_days: deltas.discharge_delta_etb_etc_days,
      total_delta_days: deltas.total_delta_days,
      ata_loading_delta_eta_etr_days: deltas.ata_loading_delta_eta_etr_days,
      ata_loading_delta_eta_etb_days: deltas.ata_loading_delta_eta_etb_days,
      ata_loading_delta_etb_etc_days: deltas.ata_loading_delta_etb_etc_days,
      ata_discharge_delta_eta_etb_days: deltas.ata_discharge_delta_eta_etb_days,
      ata_discharge_delta_etb_etc_days: deltas.ata_discharge_delta_etb_etc_days,
      ata_total_delta_days: deltas.ata_total_delta_days,
      // By Vessel = average of the per-shipment flow rates (same as the delta columns).
      lp_flow_rate: avgMetric(vesselRows, 'lp_flow_rate'),
      dp_flow_rate: avgMetric(vesselRows, 'dp_flow_rate'),
      cargo_readiness_date: null,
      loading_eta_arrival: null,
      loading_eta_berthed: null,
      loading_eta_completed: null,
      discharge_eta_arrival: null,
      discharge_eta_berthed: null,
      discharge_eta_completed: null,
    }
  })
}

type LatePerfNode = {
  key: string
  /** Distinct contract count for this drilldown node (not shipment/row count). */
  count: number
  vesselCount: number
  children: LatePerfNode[]
}

function addDistinctContract(contracts: Set<string>, row: ShippingPerformanceRow): void {
  addDistinctContractIds(contracts, row.contract_number)
}

type PerVesselPerfSummary = {
  vesselCount: number
  contractCount: number
  totalQty: number
  avgLoadingEtaEtr: number | null
  avgLoadingEtaEtb: number | null
  avgLoadingEtbEtc: number | null
  avgDischargeEtaEtb: number | null
  avgDischargeEtbEtc: number | null
}

const EMPTY_PER_VESSEL_SUMMARY: PerVesselPerfSummary = {
  vesselCount: 0,
  contractCount: 0,
  totalQty: 0,
  avgLoadingEtaEtr: null,
  avgLoadingEtaEtb: null,
  avgLoadingEtbEtc: null,
  avgDischargeEtaEtb: null,
  avgDischargeEtbEtc: null,
}

function normalizeGroupKey(value: unknown, fallback = 'Blank'): string {
  const trimmed = String(value ?? '').trim()
  return trimmed || fallback
}

function normalizeVesselKey(value: unknown): string {
  return normalizeGroupKey(value, 'Unknown')
}

function countUniqueVessels(rows: ShippingPerformanceRow[]): number {
  return countUniqueShippingPerfVessels(rows, normalizeVesselKey)
}

function countUniqueContractsFromRows(rows: ShippingPerformanceRow[]): number {
  return countUniqueContractsFromField(rows)
}

function displayGroupLabel(key: string): string {
  return formatSapGroupDisplayLabel(key)
}

function rowMatchesGroupSelection(rowValue: unknown, selectedKey: string): boolean {
  return normalizeGroupKey(rowValue) === selectedKey
}

type DrilldownFilters = {
  product: string | null
  plant: string | null
  incoterm: string | null
  vessel: string | null
}

const EMPTY_DRILLDOWN_FILTERS: DrilldownFilters = {
  product: null,
  plant: null,
  incoterm: null,
  vessel: null,
}

/**
 * Row/STO-level scope for Sections 1–3.
 * Close = shipment status COMPLETED; On Going = PLANNED through pre-COMPLETED (ETA not split).
 */
function applyPerfCardFilter(
  rows: ShippingPerformanceRow[],
  card: ShippingPerfCardFilter,
): ShippingPerformanceRow[] {
  return applyShippingPerfCardFilter(rows, card)
}

function applyDrilldownFiltersToRows(
  sourceRows: ShippingPerformanceRow[],
  filters: DrilldownFilters,
): ShippingPerformanceRow[] {
  return sourceRows.filter((row) => {
    if (filters.vessel && normalizeVesselKey(row.vessel_name) !== filters.vessel) return false
    if (filters.incoterm && !rowMatchesGroupSelection(row.incoterm, filters.incoterm)) return false
    if (filters.product && !rowMatchesGroupSelection(row.product, filters.product)) return false
    if (filters.plant && !rowMatchesGroupSelection(row.plant_site, filters.plant)) return false
    return true
  })
}

function distinctFieldValues(
  rows: ShippingPerformanceRow[],
  field: 'incoterm' | 'plant_site' | 'product',
): string[] {
  const values = new Set<string>()
  for (const row of rows) {
    values.add(normalizeGroupKey(row[field]))
  }
  return [...values].sort((a, b) => a.localeCompare(b))
}

function distinctVesselNames(rows: ShippingPerformanceRow[]): string[] {
  const values = new Set<string>()
  for (const row of rows) {
    values.add(normalizeVesselKey(row.vessel_name))
  }
  return [...values].sort((a, b) => a.localeCompare(b))
}

function applyGlobalFiltersToRows(
  sourceRows: ShippingPerformanceRow[],
  filters: {
    selectedIncoterms: string[]
    selectedProducts: string[]
    selectedGroupPlants: string[]
    selectedVessels: string[]
    statusFilter: TableStatusFilter
    dateFrom: string
    dateTo: string
    searchTerm: string
  },
): ShippingPerformanceRow[] {
  const searchTrim = filters.searchTerm.trim()
  const searchFields = [
    'shipment_id',
    'contract_number',
    'contract_ext_no',
    'po_number',
    'sto_number',
    'vessel_name',
    'product',
    'incoterm',
    'group_name',
    'loading_port',
    'discharge_port',
  ] as const

  return sourceRows.filter((row) => {
    if (!rowMatchesGlobalSearch(row, searchTrim, searchFields)) return false
    if (!rowMatchesToolbarMultiFilters(row, filters)) return false
    const vessel = normalizeVesselKey(row.vessel_name)
    if (filters.selectedVessels.length > 0 && !filters.selectedVessels.includes(vessel)) return false
    if (!matchesTableStatusFilter(String(row.status || ''), filters.statusFilter)) return false
    const cDate = String(row.contract_date || '').slice(0, 10)
    if (filters.dateFrom && cDate && cDate < filters.dateFrom) return false
    if (filters.dateTo && cDate && cDate > filters.dateTo) return false
    return true
  })
}

type PerfDatasetBundle = {
  rows: ShippingPerformanceRow[]
  tree: LatePerfNode[]
  summary: PerVesselPerfSummary
}

function buildPerfDatasetBundle(
  modeRows: ShippingPerformanceRow[],
  card: ShippingPerfCardFilter,
  _contractScopeRows: ShippingPerformanceRow[],
): PerfDatasetBundle {
  const dataMode = perfDataModeFromCard(card)
  const tree = buildPerfTree(modeRows)
  const metrics = buildCardSummary(modeRows, dataMode)
  const vesselCount = countUniqueVessels(modeRows)
  // On Going / Close card "Contracts" metric = unique contracts in the filtered row set
  // (e.g. 1 STO × 3 contract shipments → Contracts 3).
  const contractCount = countUniqueContractsFromRows(modeRows)

  return {
    rows: modeRows,
    tree,
    summary: {
      ...metrics,
      vesselCount,
      contractCount,
    },
  }
}

function buildCardSummary(rows: ShippingPerformanceRow[], mode: PerfDashMode): PerVesselPerfSummary {
  if (rows.length === 0) return { ...EMPTY_PER_VESSEL_SUMMARY }

  const vessels = new Set<string>()
  const contracts = new Set<string>()
  let totalQty = 0

  for (const row of rows) {
    addDistinctShippingPerfVessel(vessels, row.vessel_name, normalizeVesselKey)
    addDistinctContractIds(contracts, row.contract_number)
    totalQty += Number(row.outstanding_qty_actual ?? row.outstanding_qty ?? 0)
  }

  const avgDelta = (logicalKey: (typeof PERF_DELTA_LOGICAL_KEYS)[number]) =>
    avgMetric(rows, resolvePerfTableDataKey(logicalKey, mode))

  return {
    vesselCount: vessels.size,
    contractCount: contracts.size,
    totalQty,
    avgLoadingEtaEtr: avgDelta('loading_delta_eta_etr_days'),
    avgLoadingEtaEtb: avgDelta('loading_delta_eta_etb_days'),
    avgLoadingEtbEtc: avgDelta('loading_delta_etb_etc_days'),
    avgDischargeEtaEtb: avgDelta('discharge_delta_eta_etb_days'),
    avgDischargeEtbEtc: avgDelta('discharge_delta_etb_etc_days'),
  }
}

function buildPerfTree(rows: ShippingPerformanceRow[]): LatePerfNode[] {
  type VesAcc = { contracts: Set<string>; vessels: Set<string> }
  type VesMap = Map<string, VesAcc>
  type IncAcc = { contracts: Set<string>; vessels: Set<string>; vesselsMap: VesMap }
  type IncMap = Map<string, IncAcc>
  type PlantAcc = { contracts: Set<string>; vessels: Set<string>; incoterms: IncMap }
  type PlantMap = Map<string, PlantAcc>
  type ProdAcc = { contracts: Set<string>; vessels: Set<string>; plants: PlantMap }
  type ProdMap = Map<string, ProdAcc>
  const root: ProdMap = new Map()

  for (const row of rows) {
    const prod = normalizeGroupKey(row.product)
    const plant = normalizeGroupKey(row.plant_site)
    const inc = normalizeGroupKey(row.incoterm)
    const ves = normalizeVesselKey(row.vessel_name)

    if (!root.has(prod)) root.set(prod, { contracts: new Set(), vessels: new Set(), plants: new Map() })
    const pN = root.get(prod)!
    addDistinctContract(pN.contracts, row)
    addDistinctShippingPerfVessel(pN.vessels, row.vessel_name, normalizeVesselKey)
    if (!pN.plants.has(plant)) pN.plants.set(plant, { contracts: new Set(), vessels: new Set(), incoterms: new Map() })
    const plN = pN.plants.get(plant)!
    addDistinctContract(plN.contracts, row)
    addDistinctShippingPerfVessel(plN.vessels, row.vessel_name, normalizeVesselKey)
    if (!plN.incoterms.has(inc)) plN.incoterms.set(inc, { contracts: new Set(), vessels: new Set(), vesselsMap: new Map() })
    const iN = plN.incoterms.get(inc)!
    addDistinctContract(iN.contracts, row)
    addDistinctShippingPerfVessel(iN.vessels, row.vessel_name, normalizeVesselKey)
    // Keep Unknown leaf for drilldown of null-vessel STOs; vesselCount on parents still excludes it.
    if (!iN.vesselsMap.has(ves)) {
      iN.vesselsMap.set(ves, { contracts: new Set(), vessels: new Set() })
      addDistinctShippingPerfVessel(iN.vesselsMap.get(ves)!.vessels, row.vessel_name, normalizeVesselKey)
    }
    const vN = iN.vesselsMap.get(ves)!
    addDistinctContract(vN.contracts, row)
  }

  const srtByVesselCount = <T,>(m: Map<string, T & { vessels: Set<string> }>) =>
    [...m.entries()].sort((a, b) => b[1].vessels.size - a[1].vessels.size)

  const srtVesselLeaves = (m: VesMap) =>
    [...m.entries()].sort((a, b) => b[1].contracts.size - a[1].contracts.size)

  return srtByVesselCount(root).map(([prod, pN]) => ({
    key: prod,
    count: pN.contracts.size,
    vesselCount: pN.vessels.size,
    children: srtByVesselCount(pN.plants).map(([plant, plN]) => ({
      key: plant,
      count: plN.contracts.size,
      vesselCount: plN.vessels.size,
      children: srtByVesselCount(plN.incoterms).map(([inc, iN]) => ({
        key: inc,
        count: iN.contracts.size,
        vesselCount: iN.vessels.size,
        children: srtVesselLeaves(iN.vesselsMap).map(([ves, vN]) => ({
          key: ves,
          count: vN.contracts.size,
          vesselCount: isEmptySapDisplayValue(ves) ? 0 : vN.vessels.size || 1,
          children: [],
        })),
      })),
    })),
  }))
}

function matchesTableStatusFilter(status: string, filter: TableStatusFilter): boolean {
  const normalized = String(status || '').trim().toUpperCase()
  if (filter === 'All') return true
  if (filter === 'Closed') return normalized === 'COMPLETED'
  if (filter === 'Open') return OPEN_TABLE_STATUSES.has(normalized)
  return true
}

type ColumnType = 'text' | 'number'

type ColumnDef = {
  key: ShippingPerfColumnKey
  label: string
  type: ColumnType
  defaultVisible?: boolean
  /** Default visibility when the By Vessel toggle is active. */
  byVesselDefaultVisible?: boolean
  /** Shown only in the By Vessel table view (column manager + table). */
  byVesselOnly?: boolean
  /** Header label override in the By Vessel table view only. */
  byVesselLabel?: string
  tooltip?: string
}

function resolveColumnBaseLabel(col: ColumnDef, tableViewMode: TableViewMode): string {
  if (tableViewMode === 'by_vessel' && col.byVesselLabel) return col.byVesselLabel
  return col.label
}

function columnDefaultVisible(col: ColumnDef, tableViewMode: TableViewMode): boolean {
  if (tableViewMode === 'by_vessel' && col.byVesselDefaultVisible !== undefined) {
    return col.byVesselDefaultVisible
  }
  if (tableViewMode === 'all') {
    return isAllShipmentsPresetVisibleColumn(String(col.key))
  }
  return col.defaultVisible !== false
}

/** Shipping Performance Section 3 — column header tooltips (ETA → ATA when Close via resolvePerfColumnTooltip). */
const SHIPPING_PERF_OUTSTANDING_QTY_TOOLTIP =
  'Contract Qty - Delivery Qty (FOB)/Receive Qty (CIF,CFR)'

const SHIPPING_PERF_DELTA_COLUMN_TOOLTIPS: Partial<Record<keyof ShippingPerformanceRow, string>> = {
  loading_delta_eta_etr_days:
    'ETA Vessel Arrival at Loading Port - Cargo Readiness Date',
  loading_delta_eta_etb_days:
    'ETA Vessel Arrival at Loading Port - ETA Vessel Berthed at Loading Port',
  loading_delta_etb_etc_days:
    'ETA Vessel Berthed at Loading Port - ETA Vessel Completed Loading',
  discharge_delta_eta_etb_days:
    'ETA Vessel Arrive at Discharge Port - ETA Vessel Berthed at Discharge Port',
  discharge_delta_etb_etc_days:
    'ETA Vessel Berthed at Discharge Port - ETA Vessel Complete Discharge',
  total_delta_days:
    'Total duration in days: sum of Loading (ETA−ETR), Loading (ETA−ETB), Loading (ETB−ETC), ' +
    'Discharge (ETA−ETB), and Discharge (ETB−ETC). Shows "-" when all segments are missing.',
}

const COLUMN_DEFS: ColumnDef[] = [
  { key: 'vessel_name', label: 'Vessel', type: 'text', defaultVisible: false, byVesselDefaultVisible: true },
  {
    key: 'by_vessel_qty_contract',
    label: 'Qty Contract',
    type: 'number',
    byVesselOnly: true,
    byVesselDefaultVisible: true,
  },
  {
    key: 'by_vessel_qty_delivery',
    label: 'Qty Delivery',
    type: 'number',
    byVesselOnly: true,
    byVesselDefaultVisible: true,
  },
  {
    key: 'by_vessel_qty_receive',
    label: 'Qty Receive',
    type: 'number',
    byVesselOnly: true,
    byVesselDefaultVisible: true,
  },
  {
    key: 'contract_ext_no',
    label: 'Contract Ext No',
    type: 'text',
    defaultVisible: false,
    byVesselDefaultVisible: false,
  },
  { key: 'loading_port', label: 'Loading Port', type: 'text', defaultVisible: false },
  { key: 'discharge_port', label: 'Discharge Port', type: 'text', defaultVisible: false },
  { key: 'incoterm', label: 'Incoterm', type: 'text', defaultVisible: false },
  { key: 'product', label: 'Product', type: 'text', defaultVisible: false },
  { key: 'supplier', label: 'Supplier', type: 'text', defaultVisible: false },
  { key: 'contract_qty', label: 'Contract Qty', type: 'number', defaultVisible: false },
  { key: 'group_name', label: 'Supplier Group', type: 'text', defaultVisible: false },
  { key: 'shipment_count', label: 'Shipments', type: 'number', defaultVisible: false },
  { key: 'status', label: 'Status Shipment', type: 'text', defaultVisible: false },
  { key: 'po_number', label: 'PO No', type: 'text', defaultVisible: false },
  { key: 'contract_number', label: 'Contract No', type: 'text', defaultVisible: false },
  { key: 'sto_number', label: 'STO', type: 'text', defaultVisible: false },
  { key: 'sto_qty', label: 'STO Qty', type: 'number', defaultVisible: false },
  { key: 'received_qty', label: 'Received Qty', type: 'number', defaultVisible: false },
  { key: 'delivered_qty', label: 'Delivery Qty', type: 'number', defaultVisible: false },
  {
    key: 'outstanding_qty_actual',
    label: 'Outstanding Qty',
    byVesselLabel: 'Qty Outstanding Actual',
    type: 'number',
    defaultVisible: false,
    byVesselDefaultVisible: true,
    tooltip: SHIPPING_PERF_OUTSTANDING_QTY_TOOLTIP,
  },
  {
    key: 'loading_delta_eta_etr_days',
    label: 'Loading ETA - ETR',
    type: 'number',
    defaultVisible: false,
    tooltip: SHIPPING_PERF_DELTA_COLUMN_TOOLTIPS.loading_delta_eta_etr_days,
  },
  {
    key: 'loading_delta_eta_etb_days',
    label: 'Loading ETA - ETB',
    type: 'number',
    defaultVisible: false,
    tooltip: SHIPPING_PERF_DELTA_COLUMN_TOOLTIPS.loading_delta_eta_etb_days,
  },
  {
    key: 'loading_delta_etb_etc_days',
    label: 'Loading ETB - ETC',
    type: 'number',
    defaultVisible: false,
    tooltip: SHIPPING_PERF_DELTA_COLUMN_TOOLTIPS.loading_delta_etb_etc_days,
  },
  {
    key: 'discharge_delta_eta_etb_days',
    label: 'Discharge ETA - ETB',
    type: 'number',
    defaultVisible: false,
    tooltip: SHIPPING_PERF_DELTA_COLUMN_TOOLTIPS.discharge_delta_eta_etb_days,
  },
  {
    key: 'discharge_delta_etb_etc_days',
    label: 'Discharge ETB - ETC',
    type: 'number',
    defaultVisible: false,
    tooltip: SHIPPING_PERF_DELTA_COLUMN_TOOLTIPS.discharge_delta_etb_etc_days,
  },
  {
    key: 'total_delta_days',
    label: 'Total',
    type: 'number',
    defaultVisible: false,
    tooltip: SHIPPING_PERF_DELTA_COLUMN_TOOLTIPS.total_delta_days,
  },
  {
    key: 'lp_flow_rate',
    label: 'LP Flow Rate',
    type: 'number',
    defaultVisible: true,
    byVesselDefaultVisible: true,
    tooltip:
      'Loading-port flow rate (MT/day) = shipped MT ÷ loading berth→complete days (actual). ' +
      'FOB uses Delivered Qty; CIF/CFR use Received Qty. "-" when the duration is missing or ≤ 0.',
  },
  {
    key: 'dp_flow_rate',
    label: 'DP Flow Rate',
    type: 'number',
    defaultVisible: true,
    byVesselDefaultVisible: true,
    tooltip:
      'Discharge-port flow rate (MT/day) = shipped MT ÷ discharge berth→complete days (actual). ' +
      'FOB uses Delivered Qty; CIF/CFR use Received Qty. "-" when the duration is missing or ≤ 0.',
  },
]

function applyAllShipmentsColumnDefaults(): {
  order: ShippingPerfColumnKey[]
  visible: Record<string, boolean>
} {
  const allKeys = COLUMN_DEFS.map((col) => col.key)
  return {
    order: ensureAllShipmentsPresetColumnOrder([], allKeys) as ShippingPerfColumnKey[],
    visible: buildAllShipmentsPresetVisibleColumns(allKeys),
  }
}

function defaultVisibleForKey(key: string, tableViewMode: TableViewMode): boolean {
  const col = COLUMN_MAP[key]
  if (!col) return false
  return columnDefaultVisible(col, tableViewMode)
}

function normalizeColumnPrefsForMode(
  order: readonly ShippingPerfColumnKey[],
  visible: Record<string, boolean>,
  tableViewMode: TableViewMode,
): ShippingPerfColumnPrefs {
  const allKeys = COLUMN_DEFS.map((col) => String(col.key))
  return {
    columnOrder: mergeShippingPerfColumnOrder(order, allKeys, (merged) =>
      ensureTableColumnOrder(merged as ShippingPerfColumnKey[], tableViewMode),
    ),
    visibleColumns: mergeShippingPerfVisibleColumns(visible, allKeys, (key) =>
      defaultVisibleForKey(key, tableViewMode),
    ),
  }
}

function buildColumnPrefsForMode(
  mode: TableViewMode,
  saved: Partial<ShippingPerfColumnPrefs> | undefined,
): ShippingPerfColumnPrefs {
  const allDefaults = applyAllShipmentsColumnDefaults()
  const baseOrder =
    saved?.columnOrder && saved.columnOrder.length > 0 ? saved.columnOrder : allDefaults.order
  const baseVisible =
    saved?.visibleColumns && Object.keys(saved.visibleColumns).length > 0
      ? saved.visibleColumns
      : mode === 'by_vessel'
        ? applyByVesselColumnDefaults(allDefaults.visible)
        : allDefaults.visible
  return normalizeColumnPrefsForMode(
    baseOrder as ShippingPerfColumnKey[],
    baseVisible,
    mode,
  )
}

function buildInitialColumnPrefsByMode(): ShippingPerfColumnPrefsByMode {
  const stored = readShippingPerfColumnPrefsFromStorage()
  return {
    all: buildColumnPrefsForMode('all', stored?.all),
    by_vessel: buildColumnPrefsForMode('by_vessel', stored?.by_vessel),
  }
}

const COLUMN_MAP = Object.fromEntries(COLUMN_DEFS.map((col) => [col.key, col])) as Record<string, ColumnDef>

function isColumnEligibleForView(key: string, tableViewMode: TableViewMode): boolean {
  const col = COLUMN_MAP[key]
  if (col?.byVesselOnly) {
    return tableViewMode === 'by_vessel'
  }
  if (BY_VESSEL_ONLY_COLUMNS.has(key)) {
    return tableViewMode === 'by_vessel'
  }
  if (tableViewMode === 'all') {
    if (ALL_SHIPMENTS_HIDDEN_COLUMNS.has(key)) return false
    if (key === 'shipment_count') return false
    return true
  }
  if (BY_VESSEL_HIDDEN_COLUMNS.has(key)) return false
  if (DETAIL_COLUMN_KEYS.has(key)) return false
  return true
}

function resolveManageableColumnKeys(
  columnOrder: ShippingPerfColumnKey[],
  tableViewMode: TableViewMode,
): ShippingPerfColumnKey[] {
  return columnOrder.filter((key) => {
    const id = String(key)
    return Boolean(COLUMN_MAP[id]) && isColumnEligibleForView(id, tableViewMode)
  })
}

function resolveVisibleTableColumnKeys(
  columnOrder: ShippingPerfColumnKey[],
  visibleColumns: Record<string, boolean>,
  tableViewMode: TableViewMode,
): ShippingPerfColumnKey[] {
  return resolveManageableColumnKeys(columnOrder, tableViewMode).filter(
    (key) => visibleColumns[String(key)],
  )
}

/** Column manager list — visible columns in table order, then hidden columns A→Z (shipments/trucking pattern). */
function buildShippingPerfColumnManagerKeys(
  columnOrder: ShippingPerfColumnKey[],
  visibleColumns: Record<string, boolean>,
  tableViewMode: TableViewMode,
): ShippingPerfColumnKey[] {
  const manageable = resolveManageableColumnKeys(columnOrder, tableViewMode)
  const visibleInOrder = manageable.filter((key) => visibleColumns[String(key)])
  const hiddenSorted = manageable
    .filter((key) => !visibleColumns[String(key)])
    .sort((a, b) => {
      const labelA = COLUMN_MAP[String(a)]?.label ?? String(a)
      const labelB = COLUMN_MAP[String(b)]?.label ?? String(b)
      return labelA.localeCompare(labelB)
    })
  return [...visibleInOrder, ...hiddenSorted]
}

/** Preserve user column order; append any missing definition keys. */
function ensureByVesselTableColumnOrder(order: ShippingPerfColumnKey[]): ShippingPerfColumnKey[] {
  const defOrder = COLUMN_DEFS.map((c) => c.key)
  const deduped = order.filter((key) => defOrder.includes(key))
  const missing = defOrder.filter((key) => !deduped.includes(key))
  return [...deduped, ...missing]
}

/** All Shipments view table — preset column order (On Going / Close share keys; ATA labels are display-only). */
function ensureAllShipmentsTableColumnOrder(order: ShippingPerfColumnKey[]): ShippingPerfColumnKey[] {
  const allKeys = COLUMN_DEFS.map((c) => c.key)
  return ensureAllShipmentsPresetColumnOrder(order, allKeys) as ShippingPerfColumnKey[]
}

function ensureTableColumnOrder(
  order: ShippingPerfColumnKey[],
  tableViewMode: TableViewMode,
): ShippingPerfColumnKey[] {
  if (tableViewMode === 'by_vessel') return ensureByVesselTableColumnOrder(order)
  return ensureAllShipmentsTableColumnOrder(order)
}

function applyByVesselColumnDefaults(
  visibleColumns: Record<string, boolean>,
): Record<string, boolean> {
  const next = { ...visibleColumns }
  for (const col of COLUMN_DEFS) {
    if (!isColumnEligibleForView(String(col.key), 'by_vessel')) continue
    next[String(col.key)] = columnDefaultVisible(col, 'by_vessel')
  }
  return next
}

function reorderColumnsInOrder(
  order: ShippingPerfColumnKey[],
  fromKey: string,
  toKey: string,
): ShippingPerfColumnKey[] {
  if (!fromKey || !toKey || fromKey === toKey) return order
  const fromIdx = order.findIndex((key) => String(key) === fromKey)
  const toIdx = order.findIndex((key) => String(key) === toKey)
  if (fromIdx < 0 || toIdx < 0) return order
  const next = [...order]
  const [moved] = next.splice(fromIdx, 1)
  next.splice(toIdx, 0, moved)
  return next
}

function asDisplayValue(value: unknown): string {
  return formatOperationalTableTextDisplay(value)
}

/** Section 3 — null/empty/placeholder port values render as "-". */
function formatPortColumnDisplay(value: unknown): string {
  return formatOperationalTableTextDisplay(value)
}

function isOutstandingQtyColumn(key: string): boolean {
  return (
    key === 'outstanding_qty_actual' ||
    key === 'outstanding_qty_planning' ||
    key === 'outstanding_qty'
  )
}

function isMtQtyColumn(key: string): boolean {
  return (
    (isByVesselOnlyColumnKey(key as ShippingPerfColumnKey) ||
    key === 'sto_qty' ||
    key === 'received_qty' ||
    key === 'planning_qty' ||
    key === 'contract_qty' ||
    key === 'delivered_qty') &&
    !isOutstandingQtyColumn(key)
  )
}

function NumberCell({
  value,
  isDeltaDays = false,
  decimalPlaces,
}: {
  value: unknown
  isDeltaDays?: boolean
  decimalPlaces?: number
}) {
  if (value === null || value === undefined || value === '') {
    return <span className="text-sm text-gray-400">-</span>
  }
  const n = Number(value)
  if (Number.isNaN(n)) return <span className="text-sm text-gray-400">-</span>
  if (isDeltaDays) {
    const formatted =
      decimalPlaces != null
        ? (n === 0 ? (0).toFixed(decimalPlaces) : Math.abs(n).toFixed(decimalPlaces))
        : formatSignedDeltaDays(n)
    return (
      <span className={`text-sm font-normal tabular-nums ${signedCycleDaysClass(n)}`}>
        {formatted} days
      </span>
    )
  }
  return <span className="text-sm font-normal tabular-nums">{n}</span>
}

export default function ShippingPerformancePage() {
  return (
    <Layout>
      <ShippingPerformancePageContent />
    </Layout>
  )
}

function ShippingPerformancePageContent() {
  const router = useRouter()
  const perms = usePermissions()
  const canViewPage = canViewShippingPerformancePage(perms)
  const [rows, setRows] = useState<ShippingPerformanceRow[]>([])
  const [summaryLoading, setSummaryLoading] = useState(false)
  const [summaryFetching, setSummaryFetching] = useState(false)
  const section3TableLoading = summaryLoading && rows.length === 0
  const [authReady, setAuthReady] = useState(false)

  useEffect(() => {
    if (canViewPage === false) {
      router.replace('/shipments')
    }
  }, [canViewPage, router])
  const [showColumnManager, setShowColumnManager] = useState(false)
  const columnPrefsRef = useRef(buildInitialColumnPrefsByMode())
  const saveViewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [columnOrder, setColumnOrder] = useState<ShippingPerfColumnKey[]>(
    () => columnPrefsRef.current.all.columnOrder as ShippingPerfColumnKey[],
  )
  const [visibleColumns, setVisibleColumns] = useState<Record<string, boolean>>(
    () => ({ ...columnPrefsRef.current.all.visibleColumns }),
  )
  const [dragColId, setDragColId] = useState<string | null>(null)
  const [draggingColumn, setDraggingColumn] = useState<string | null>(null)
  const [sortBy, setSortBy] = useState<ShippingPerfColumnKey>('total_delta_days')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc')
  const [currentPage, setCurrentPage] = useState(1)
  const pageSize = 20
  const columnsMenuRef = useRef<HTMLDivElement | null>(null)
  const topScrollRef = useRef<HTMLDivElement | null>(null)
  const bottomScrollRef = useRef<HTMLDivElement | null>(null)
  const [tableScrollWidth, setTableScrollWidth] = useState<number>(0)
  const isSyncingScroll = useRef(false)
  const [statusFilter, setStatusFilter] = useState<TableStatusFilter>('All')
  const [searchDraft, setSearchDraft] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedIncoterms, setSelectedIncoterms] = useState<string[]>([])
  const [selectedSources, setSelectedSources] = useState<string[]>([])
  const [selectedProducts, setSelectedProducts] = useState<string[]>([])
  const [selectedGroupPlants, setSelectedGroupPlants] = useState<string[]>([])
  const [selectedVessels, setSelectedVessels] = useState<string[]>([])
  const [performancePeriod, setPerformancePeriod] = useState<PerformancePeriodKey>('YTD')
  const [dateFrom, setDateFrom] = useState(() => resolvePerformancePeriodDateRange('YTD').dateFrom)
  const [dateTo, setDateTo] = useState(() => resolvePerformancePeriodDateRange('YTD').dateTo)
  const [perfCardFilter, setPerfCardFilter] = useState<ShippingPerfCardFilter>('ongoing')
  const perfDashMode = useMemo(() => perfDataModeFromCard(perfCardFilter), [perfCardFilter])
  const [drilldownFilters, setDrilldownFilters] = useState<DrilldownFilters>(EMPTY_DRILLDOWN_FILTERS)
  const [tableViewMode, setTableViewMode] = useState<TableViewMode>('all')
  const [vesselModalOpen, setVesselModalOpen] = useState(false)
  const [selectedVesselData, setSelectedVesselData] = useState<VesselHistoryModalSelection | null>(null)
  const [viewShipmentModal, setViewShipmentModal] = useState<{
    shipmentId: string
    editContractId: string | null
    editStoNumber: string | null
    editContractNumbers: string | null
  } | null>(null)
  const [remarksModal, setRemarksModal] = useState<{ shipmentId: string; subtitle: string } | null>(
    null,
  )

  const openViewShipmentFromRow = useCallback((row: ShippingPerformanceRow) => {
    const shipmentId = String(row.id || '').trim()
    if (!shipmentId) return
    const contractNumbers = String(row.contract_number || '').trim()
    const editContractId =
      contractNumbers
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean)[0] || null
    setViewShipmentModal({
      shipmentId,
      editContractId,
      editStoNumber: resolveShipmentApiLookupKey(row) || null,
      editContractNumbers: contractNumbers || null,
    })
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const hasAuth = () => isAuthenticatedLocally()
    if (hasAuth()) {
      setAuthReady(true)
      return
    }
    const startedAt = Date.now()
    const interval = window.setInterval(() => {
      if (hasAuth()) {
        window.clearInterval(interval)
        setAuthReady(true)
      } else if (Date.now() - startedAt > 3000) {
        window.clearInterval(interval)
      }
    }, 150)
    return () => window.clearInterval(interval)
  }, [])

  useEffect(() => {
    const { dateFrom: from, dateTo: to } = resolvePerformancePeriodDateRange(performancePeriod)
    setDateFrom(from)
    setDateTo(to)
  }, [performancePeriod])

  const shippingPerfListUrl = '/shipments/performance?scope=ytd'

  const fetchShippingPerformanceDashboard = useCallback(async () => {
    const cacheKey = buildCacheKey('GET', shippingPerfListUrl)
    const cached = peekCache<{ data?: ShippingPerformanceRow[] }>(cacheKey)
    const hadRows = cached && Array.isArray(cached.data) && cached.data.length > 0
    if (hadRows && cached?.data) {
      setRows(cached.data)
    }
    try {
      if (!hadRows) setSummaryLoading(true)
      setSummaryFetching(true)
      const { data, revalidating } = await cachedGet(
        cacheKey,
        () => api.get(shippingPerfListUrl, { timeout: 120000 }).then((r) => r.data),
        {
          onRevalidate: (fresh) => {
            setRows(Array.isArray(fresh?.data) ? fresh.data : [])
            setSummaryFetching(false)
          },
        },
      )
      setRows(Array.isArray(data?.data) ? data.data : [])
      if (!revalidating) setSummaryFetching(false)
    } catch (error) {
      console.error('Failed to load shipping performance dashboard:', error)
      if (!hadRows) setRows([])
      setSummaryFetching(false)
    } finally {
      setSummaryLoading(false)
    }
  }, [shippingPerfListUrl])

  const fetchStartedRef = useRef(false)

  useEffect(() => {
    if (!authReady || canViewPage !== true || fetchStartedRef.current) return
    fetchStartedRef.current = true
    void fetchShippingPerformanceDashboard()
  }, [authReady, canViewPage, fetchShippingPerformanceDashboard])

  // Step A: exclude UNPLANNED at base — single source of truth for Sections 1–3.
  // Materialize LP/DP flow rate here so every downstream consumer (table render, sort,
  // By-Vessel averaging) reads a real row field.
  const baseFilteredRows = useMemo(
    () => materializeFlowRates(excludeUnplannedShippingRows(rows)),
    [rows],
  )

  // Step A2: Period scope (contract_date)
  const periodFilteredRows = useMemo(
    () =>
      baseFilteredRows.filter((row) =>
        rowMatchesPerformancePeriod(String(row.contract_date ?? ''), dateFrom, dateTo),
      ),
    [baseFilteredRows, dateFrom, dateTo],
  )

  // Step A3: Source / Product multi-select (client-side only; no refetch)
  const scopeFilteredRows = useMemo(
    () => applyShippingPerfSourceProductFilter(periodFilteredRows, selectedSources, selectedProducts),
    [periodFilteredRows, selectedSources, selectedProducts],
  )

  // Options for the 3 toolbar filters (Group Plant/Product/Incoterm) — always populated from the
  // current pill scope, normalized the same way rowMatchesToolbarMultiFilters matches so a
  // selection always matches its rows.
  const distinctScopeOptions = useCallback(
    (field: 'incoterm' | 'product' | 'plant_site'): string[] =>
      [...new Set(scopeFilteredRows.map((r) => normalizeScopeGroupKey(r[field])))].sort((a, b) =>
        a.localeCompare(b),
      ),
    [scopeFilteredRows],
  )
  const availableIncoterms = useMemo(() => distinctScopeOptions('incoterm'), [distinctScopeOptions])
  const availableGroupPlants = useMemo(
    () => distinctScopeOptions('plant_site'),
    [distinctScopeOptions],
  )
  const availableProducts = useMemo(() => distinctScopeOptions('product'), [distinctScopeOptions])
  const availableVessels = useMemo(
    () =>
      SHIPPING_PERF_GLOBAL_FILTERS_ENABLED ? distinctVesselNames(scopeFilteredRows) : [],
    [scopeFilteredRows],
  )

  // Step B: apply global filters. The 3 toolbar filters above the cards (Group Plant, Product,
  // Incoterm) are always active and feed BOTH the card counts and the table. The rest of the
  // legacy global-filter set stays gated behind SHIPPING_PERF_GLOBAL_FILTERS_ENABLED.
  const globallyFilteredRows = useMemo(() => {
    if (SHIPPING_PERF_GLOBAL_FILTERS_ENABLED) {
      return applyGlobalFiltersToRows(scopeFilteredRows, {
        selectedIncoterms,
        selectedProducts,
        selectedGroupPlants,
        selectedVessels,
        statusFilter,
        dateFrom,
        dateTo,
        searchTerm,
      })
    }
    if (
      selectedIncoterms.length === 0 &&
      selectedGroupPlants.length === 0
    ) {
      return scopeFilteredRows
    }
    return scopeFilteredRows.filter((row) =>
      rowMatchesToolbarMultiFilters(row, {
        selectedIncoterms,
        selectedGroupPlants,
      }),
    )
  }, [
    scopeFilteredRows,
    selectedIncoterms,
    selectedProducts,
    selectedGroupPlants,
    selectedVessels,
    statusFilter,
    dateFrom,
    dateTo,
    searchTerm,
  ])

  /** Vessel history — Open + Close in toolbar scope; ignores summary card & status filter. */
  const vesselHistorySourceRows = useMemo(() => {
    if (!SHIPPING_PERF_GLOBAL_FILTERS_ENABLED) {
      return scopeFilteredRows.map(applySection3PortDisplay)
    }
    return applyGlobalFiltersToRows(scopeFilteredRows, {
      selectedIncoterms,
      selectedProducts,
      selectedGroupPlants,
      selectedVessels,
      statusFilter: 'All',
      dateFrom,
      dateTo,
      searchTerm,
    }).map(applySection3PortDisplay)
  }, [
    scopeFilteredRows,
    selectedIncoterms,
    selectedProducts,
    selectedGroupPlants,
    selectedVessels,
    dateFrom,
    dateTo,
    searchTerm,
  ])

  const ongoingFilteredData = useMemo(
    () => applyPerfCardFilter(globallyFilteredRows, 'ongoing'),
    [globallyFilteredRows],
  )

  const closeFilteredData = useMemo(
    () => applyPerfCardFilter(globallyFilteredRows, 'close'),
    [globallyFilteredRows],
  )

  const perfModeFilteredRows = useMemo(
    () => applyPerfCardFilter(globallyFilteredRows, perfCardFilter),
    [globallyFilteredRows, perfCardFilter],
  )

  // Step C: apply drilldown node selection (product → plant → incoterm → vessel)
  const drilldownFilteredRows = useMemo(
    () => applyDrilldownFiltersToRows(perfModeFilteredRows, drilldownFilters),
    [perfModeFilteredRows, drilldownFilters],
  )

  const ongoingDatasetBundle = useMemo(
    () => buildPerfDatasetBundle(ongoingFilteredData, 'ongoing', globallyFilteredRows),
    [ongoingFilteredData, globallyFilteredRows],
  )

  const closeDatasetBundle = useMemo(
    () => buildPerfDatasetBundle(closeFilteredData, 'close', globallyFilteredRows),
    [closeFilteredData, globallyFilteredRows],
  )

  const allDatasetBundle = useMemo(
    () => buildPerfDatasetBundle(globallyFilteredRows, 'all', globallyFilteredRows),
    [globallyFilteredRows],
  )

  const activeDatasetBundle = useMemo(() => {
    switch (perfCardFilter) {
      case 'ongoing':
        return ongoingDatasetBundle
      case 'close':
        return closeDatasetBundle
      default:
        return allDatasetBundle
    }
  }, [perfCardFilter, ongoingDatasetBundle, closeDatasetBundle, allDatasetBundle])

  const perfTree = activeDatasetBundle.tree

  const ongoingPerformanceSummary = ongoingDatasetBundle.summary
  const closePerformanceSummary = closeDatasetBundle.summary

  /** Unique contracts in the current card + drilldown scope (Section 3 subtitle). */
  const scopedUniqueContractCount = useMemo(
    () => countUniqueContractsFromRows(drilldownFilteredRows),
    [drilldownFilteredRows],
  )

  /** Section 2 title subtitle: period, card mode, and non-empty global filters. */
  const shippingPerfDrilldownScopeSegments = useMemo(() => {
    const parts: string[] = [
      resolvePerformancePeriodDateRange(performancePeriod).label,
      SHIPPING_PERF_CARD_TITLES[perfCardFilter],
    ]
    if (selectedSources.length > 0) parts.push(selectedSources.join(', '))
    if (selectedProducts.length > 0) parts.push(selectedProducts.join(', '))
    if (selectedGroupPlants.length > 0) parts.push(selectedGroupPlants.join(', '))
    if (selectedVessels.length > 0) parts.push(selectedVessels.join(', '))
    if (selectedIncoterms.length > 0) parts.push(selectedIncoterms.join(', '))
    if (statusFilter === 'Open' || statusFilter === 'Closed') parts.push(statusFilter)
    return parts
  }, [
    performancePeriod,
    perfCardFilter,
    selectedSources,
    selectedProducts,
    selectedGroupPlants,
    selectedVessels,
    selectedIncoterms,
    statusFilter,
  ])

  const globalFilterEffectKey = [
    performancePeriod,
    selectedSources.join('\0'),
    selectedProducts.join('\0'),
    SHIPPING_PERF_GLOBAL_FILTERS_ENABLED
      ? [
          selectedIncoterms.join('\0'),
          selectedGroupPlants.join('\0'),
          selectedVessels.join('\0'),
          statusFilter,
          dateFrom,
          dateTo,
          searchTerm,
        ].join('|')
      : [selectedIncoterms.join('\0'), selectedGroupPlants.join('\0')].join('|'),
  ].join('::')

  useEffect(() => {
    setDrilldownFilters(EMPTY_DRILLDOWN_FILTERS)
    setCurrentPage(1)
  }, [perfCardFilter, globalFilterEffectKey])

  const switchTableViewMode = useCallback(
    (nextMode: TableViewMode) => {
      if (tableViewMode === nextMode) {
        setCurrentPage(1)
        return
      }
      columnPrefsRef.current[tableViewMode] = normalizeColumnPrefsForMode(
        columnOrder,
        visibleColumns,
        tableViewMode,
      )
      writeShippingPerfColumnPrefsToStorage(columnPrefsRef.current)
      const nextPrefs = columnPrefsRef.current[nextMode]
      setTableViewMode(nextMode)
      setColumnOrder(nextPrefs.columnOrder as ShippingPerfColumnKey[])
      setVisibleColumns({ ...nextPrefs.visibleColumns })
      setCurrentPage(1)
    },
    [columnOrder, visibleColumns, tableViewMode],
  )

  useEffect(() => {
    let cancelled = false
    const hadLocalPrefs = (() => {
      try {
        const raw = localStorage.getItem(SHIPPING_PERF_COLUMN_PREFS_STORAGE_KEY)
        if (!raw) return false
        const parsed = JSON.parse(raw) as unknown
        return Boolean(parsed && typeof parsed === 'object')
      } catch {
        return Boolean(localStorage.getItem(SHIPPING_PERF_COLUMN_PREFS_STORAGE_KEY))
      }
    })()
    ;(async () => {
      try {
        const res = await api.get(
          `/user-preferences/me?key=${encodeURIComponent(SHIPPING_PERF_COLUMN_PREFS_USER_KEY)}`,
        )
        const parsed = parseShippingPerfColumnPrefsFromApiValue(res.data?.data?.value)
        if (cancelled || !parsed || hadLocalPrefs) return
        const next: ShippingPerfColumnPrefsByMode = {
          all: buildColumnPrefsForMode('all', parsed.all ?? columnPrefsRef.current.all),
          by_vessel: buildColumnPrefsForMode(
            'by_vessel',
            parsed.by_vessel ?? columnPrefsRef.current.by_vessel,
          ),
        }
        columnPrefsRef.current = next
        writeShippingPerfColumnPrefsToStorage(next)
        setTableViewMode((activeMode) => {
          const active = next[activeMode]
          setColumnOrder(active.columnOrder as ShippingPerfColumnKey[])
          setVisibleColumns({ ...active.visibleColumns })
          return activeMode
        })
      } catch {
        // keep localStorage bootstrap
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    columnPrefsRef.current[tableViewMode] = normalizeColumnPrefsForMode(
      columnOrder,
      visibleColumns,
      tableViewMode,
    )
    writeShippingPerfColumnPrefsToStorage(columnPrefsRef.current)

    if (typeof window === 'undefined') return
    if (saveViewTimerRef.current) clearTimeout(saveViewTimerRef.current)
    saveViewTimerRef.current = setTimeout(() => {
      void api
        .post('/user-preferences/me', {
          key: SHIPPING_PERF_COLUMN_PREFS_USER_KEY,
          value: columnPrefsRef.current,
        })
        .catch(() => {
          /* localStorage fallback */
        })
    }, 500)
    return () => {
      if (saveViewTimerRef.current) clearTimeout(saveViewTimerRef.current)
    }
  }, [columnOrder, visibleColumns, tableViewMode])

  const activateByVesselTableView = useCallback(() => {
    switchTableViewMode('by_vessel')
  }, [switchTableViewMode])

  useEffect(() => {
    const onDocClick = (ev: MouseEvent) => {
      const t = ev.target as Node
      if (showColumnManager && columnsMenuRef.current && !columnsMenuRef.current.contains(t)) {
        setShowColumnManager(false)
      }
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [showColumnManager])

  const resetPerfSelections = useCallback(() => {
    setPerfCardFilter('all')
    setPerformancePeriod('YTD')
    setSelectedSources([])
    setSelectedProducts([])
    setSelectedGroupPlants([])
    setSelectedIncoterms([])
    setDrilldownFilters(EMPTY_DRILLDOWN_FILTERS)
    setCurrentPage(1)
  }, [])

  const togglePerfCardFilter = useCallback((card: Exclude<ShippingPerfCardFilter, 'all'>) => {
    setPerfCardFilter((prev) => (prev === card ? 'all' : card))
    setCurrentPage(1)
  }, [])

  const applyPerfDrilldownClick = useCallback((next: Partial<DrilldownFilters>) => {
    setDrilldownFilters((prev) => ({
      product: 'product' in next ? (next.product ?? null) : prev.product,
      plant: 'plant' in next ? (next.plant ?? null) : prev.plant,
      incoterm: 'incoterm' in next ? (next.incoterm ?? null) : prev.incoterm,
      vessel: 'vessel' in next ? (next.vessel ?? null) : prev.vessel,
    }))
    setCurrentPage(1)
  }, [])

  const renderSummaryPrimaryTotals = (summary: PerVesselPerfSummary) => {
    return (
      <div className="space-y-2.5">
        <div>
          <div className="text-[11px] font-medium tracking-wider text-gray-500 leading-none">
            Total Vessels
          </div>
          <div className="mt-0.5 text-xl font-bold leading-none tabular-nums text-gray-900">
            {summary.vesselCount.toLocaleString('en-US')}
          </div>
        </div>
        <div>
          <div className="text-[10px] font-medium tracking-wider text-gray-500 leading-none">
            Contracts
          </div>
          <div className="mt-0.5 text-sm font-semibold leading-none tabular-nums text-gray-700">
            {summary.contractCount.toLocaleString('en-US')}
          </div>
        </div>
      </div>
    )
  }

  const renderSummaryGapMetrics = (summary: PerVesselPerfSummary, card: ShippingPerfCardFilter) => {
    const labelMode = card === 'close' ? 'actual' : 'estimated'
    const fmt = (days: number | null) =>
      formatAvgDays(days == null || !Number.isFinite(days) ? null : Math.abs(days))
    const metricValueClass = (days: number | null) =>
      cn('text-[10px] font-semibold leading-none text-gray-900 tabular-nums', signedCycleDaysClass(days))
    const metrics: { key: ShippingSummaryMetricKey; value: number | null }[] = [
      { key: 'loadingEtr', value: summary.avgLoadingEtaEtr },
      { key: 'loadingEtb', value: summary.avgLoadingEtaEtb },
      { key: 'loadingEtc', value: summary.avgLoadingEtbEtc },
      { key: 'dischargeEtb', value: summary.avgDischargeEtaEtb },
      { key: 'dischargeEtc', value: summary.avgDischargeEtbEtc },
    ]

    return (
      <div className="flex w-fit shrink-0 flex-col gap-y-1.5">
        {metrics.map(({ key, value }) => {
          const shortLabel = getShippingSummaryMetricLabel(key, labelMode, 'short')
          const fullLabel = getShippingSummaryMetricLabel(key, labelMode, 'full')
          return (
            <div
              key={key}
              className="flex min-w-[max-content] flex-row items-center justify-between gap-3"
            >
              <span
                className="min-w-0 shrink text-[10px] leading-none text-gray-500 whitespace-nowrap"
                title={fullLabel}
              >
                {shortLabel}
              </span>
              <span className={cn('shrink-0', metricValueClass(value))}>{fmt(value)}</span>
            </div>
          )
        })}
      </div>
    )
  }

  /** Section 1 body — left stays tight under icon; Avg bottom-aligns to Contracts. */
  const renderShippingSummaryCardBody = (
    card: ShippingPerfCardFilter,
    summary: PerVesselPerfSummary,
  ) => {
    return (
      <div className="relative w-full min-w-0 text-left">
        <div className="min-w-0 pt-1 sm:max-w-[calc(100%-10.5rem)]">
          {renderSummaryPrimaryTotals(summary)}
        </div>
        <div className="mt-2 w-fit shrink-0 sm:absolute sm:bottom-0 sm:right-0 sm:mt-0">
          {renderSummaryGapMetrics(summary, card)}
        </div>
      </div>
    )
  }

  /** Section 3 column headers — recompute when Close/Open card or global status filter changes. */
  const tableLabelMode = useMemo(
    () =>
      resolveShippingPerfLabelMode(
        perfCardFilter,
        SHIPPING_PERF_GLOBAL_FILTERS_ENABLED ? statusFilter : 'All',
      ),
    [perfCardFilter, statusFilter],
  )

  const resolveTableColumnLabel = useCallback(
    (baseLabel: string) => formatShippingPerfDisplayLabel(baseLabel, tableLabelMode),
    [tableLabelMode],
  )

  const getColumnHeaderLabel = useCallback(
    (col: ColumnDef) => resolveTableColumnLabel(resolveColumnBaseLabel(col, tableViewMode)),
    [resolveTableColumnLabel, tableViewMode],
  )

  const tableScopeParts = useMemo(() => {
    const parts: string[] =
      perfCardFilter === 'all' ? [] : [SHIPPING_PERF_CARD_TITLES[perfCardFilter]]
    if (SHIPPING_PERF_GLOBAL_FILTERS_ENABLED) {
      if (selectedIncoterms.length > 0) {
        parts.push(`Incoterm: ${selectedIncoterms.map(displayGroupLabel).join(', ')}`)
      }
      if (selectedGroupPlants.length > 0) {
        parts.push(`Group Plant: ${selectedGroupPlants.map(displayGroupLabel).join(', ')}`)
      }
      if (selectedVessels.length > 0) {
        parts.push(`Vessel: ${selectedVessels.map(displayGroupLabel).join(', ')}`)
      }
      if (dateFrom || dateTo) {
        parts.push(`Contract date: ${dateFrom || '…'} to ${dateTo || '…'}`)
      }
      if (statusFilter !== 'All') parts.push(`Status: ${statusFilter}`)
    }
    if (drilldownFilters.product) parts.push(`Product: ${displayGroupLabel(drilldownFilters.product)}`)
    if (drilldownFilters.plant) parts.push(`Group Plant node: ${displayGroupLabel(drilldownFilters.plant)}`)
    if (drilldownFilters.incoterm) parts.push(`Incoterm node: ${displayGroupLabel(drilldownFilters.incoterm)}`)
    if (drilldownFilters.vessel) parts.push(`Vessel: ${drilldownFilters.vessel}`)
    return parts
  }, [
    perfCardFilter,
    selectedIncoterms,
    selectedGroupPlants,
    selectedVessels,
    dateFrom,
    dateTo,
    drilldownFilters,
    statusFilter,
  ])

  /** Section 3 only — resolve port columns (shipment operation → SAP fallback) before sort/render. */
  const section3DisplayRows = useMemo(
    () => drilldownFilteredRows.map(applySection3PortDisplay),
    [drilldownFilteredRows],
  )

  // Step D: apply Section 3 sorting
  const filteredRows = useMemo(() => {
    const sortDataKey = resolveColumnDataKey(sortBy, perfDashMode)
    const sorted = [...section3DisplayRows].sort((a, b) => {
      const aVal = a[sortDataKey]
      const bVal = b[sortDataKey]
      const colType = COLUMN_MAP[String(sortBy)]?.type ?? 'text'
      if (colType === 'number') {
        const aNum = aVal === null || aVal === undefined || aVal === '' ? Number.NEGATIVE_INFINITY : Number(aVal)
        const bNum = bVal === null || bVal === undefined || bVal === '' ? Number.NEGATIVE_INFINITY : Number(bVal)
        return sortDirection === 'asc' ? aNum - bNum : bNum - aNum
      }
      const aStr = asDisplayValue(aVal).toLowerCase()
      const bStr = asDisplayValue(bVal).toLowerCase()
      if (aStr < bStr) return sortDirection === 'asc' ? -1 : 1
      if (aStr > bStr) return sortDirection === 'asc' ? 1 : -1
      return 0
    })
    return sorted
  }, [section3DisplayRows, sortBy, sortDirection, perfDashMode])

  const tableRows = useMemo(() => {
    if (tableViewMode === 'all') return filteredRows
    return aggregateByVessel(filteredRows)
  }, [filteredRows, tableViewMode])

  const columnManagerKeys = useMemo(
    () => buildShippingPerfColumnManagerKeys(columnOrder, visibleColumns, tableViewMode),
    [columnOrder, visibleColumns, tableViewMode],
  )

  const tableColumnKeys = useMemo(
    () => resolveVisibleTableColumnKeys(columnOrder, visibleColumns, tableViewMode),
    [columnOrder, visibleColumns, tableViewMode],
  )
  const showTableActionsColumn = tableViewMode !== 'by_vessel'
  const tableColSpan = (tableColumnKeys.length || 0) + (showTableActionsColumn ? 1 : 0)

  const totalPages = Math.max(1, Math.ceil(tableRows.length / pageSize))
  const paginatedRows = useMemo(
    () => tableRows.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [tableRows, currentPage, pageSize]
  )

  useEffect(() => {
    setCurrentPage(1)
  }, [
    globalFilterEffectKey,
    drilldownFilters,
    tableViewMode,
    sortBy,
    sortDirection,
  ])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const calc = () => {
      const el = bottomScrollRef.current
      if (el) setTableScrollWidth(el.scrollWidth)
    }
    calc()
    window.addEventListener('resize', calc)
    return () => window.removeEventListener('resize', calc)
  }, [tableColumnKeys, paginatedRows.length])

  const handlePageChange = (newPage: number) => {
    if (newPage >= 1 && newPage <= totalPages) {
      setCurrentPage(newPage)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }

  const onToggleColumn = (key: ShippingPerfColumnKey) => {
    setVisibleColumns((prev) => {
      const next = { ...prev, [String(key)]: !prev[String(key)] }
      const visibleCount = Object.values(next).filter(Boolean).length
      if (visibleCount === 0) return prev
      return next
    })
  }

  const reorderColumnByDrag = (fromId: string, toId: string) => {
    setColumnOrder((prev) => reorderColumnsInOrder(prev, fromId, toId))
  }

  const onHeaderSort = (key: ShippingPerfColumnKey) => {
    const nextDir: 'asc' | 'desc' =
      sortBy === key ? (sortDirection === 'asc' ? 'desc' : 'asc') : 'asc'
    setSortDirection(nextDir)
    setSortBy(key)
    setCurrentPage(1)
  }

  const moveColumn = (fromKey: string, toKey: string) => {
    setColumnOrder((prev) => reorderColumnsInOrder(prev, fromKey, toKey))
  }

  if (canViewPage === null) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-500">Loading...</div>
    )
  }

  if (canViewPage === false) {
    return null
  }

  return (
    <div className="space-y-6">
        {/* Header + Source / Product scope toggles (client-side only) */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-2">
                <span>Shipping Performance</span>
                {summaryLoading || summaryFetching ? (
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin text-gray-400" aria-hidden />
                ) : null}
              </h1>
            </div>
          </div>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-6 flex-wrap">
              <PerformancePeriodSelect
                value={performancePeriod}
                onChange={(value) => {
                  setPerformancePeriod(value)
                  setCurrentPage(1)
                }}
              />
              <div className="flex items-center gap-3">
                <span className="text-sm font-medium text-gray-700 shrink-0">Plant:</span>
                <div className="w-48">
                  <SearchableMultiSelect
                    label=""
                    options={availableGroupPlants}
                    selected={selectedGroupPlants}
                    onChange={setSelectedGroupPlants}
                    placeholder="All group plants"
                    emptyMessage="No group plants"
                    uppercaseOptionLabels
                  />
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm font-medium text-gray-700 shrink-0">Source:</span>
                <div className="w-48">
                  <SearchableMultiSelect
                    label=""
                    options={[...CONTRACT_PERF_SOURCE_MULTI_OPTIONS]}
                    selected={selectedSources}
                    onChange={(values) => {
                      setSelectedSources(values)
                      setCurrentPage(1)
                    }}
                    placeholder="All sources"
                    emptyMessage="No sources"
                    uppercaseOptionLabels
                  />
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm font-medium text-gray-700 shrink-0">Incoterm:</span>
                <div className="w-48">
                  <SearchableMultiSelect
                    label=""
                    options={availableIncoterms}
                    selected={selectedIncoterms}
                    onChange={setSelectedIncoterms}
                    placeholder="All incoterms"
                    emptyMessage="No incoterms"
                    uppercaseOptionLabels
                  />
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm font-medium text-gray-700 shrink-0">Product:</span>
                <div className="w-48">
                  <SearchableMultiSelect
                    label=""
                    options={[...CONTRACT_PERF_PRODUCT_MULTI_OPTIONS]}
                    selected={selectedProducts}
                    onChange={(values) => {
                      setSelectedProducts(values)
                      setCurrentPage(1)
                    }}
                    placeholder="All products"
                    emptyMessage="No products"
                    uppercaseOptionLabels
                  />
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={resetPerfSelections}
              className="text-sm text-blue-700 hover:underline shrink-0"
            >
              Reset selection
            </button>
          </div>
        </div>

        {/* Section 1: Summary Cards */}
        {(() => {
          return (
            <div
              className={`space-y-2 transition-opacity duration-200 ${
                (summaryLoading || summaryFetching) && rows.length > 0 ? 'opacity-65' : 'opacity-100'
              }`}
            >
              <div className="flex w-full flex-col gap-4 xl:flex-row xl:items-stretch">
                <PerformanceSection1CardShell
                  variant="ongoing"
                  title={SHIPPING_PERF_CARD_TITLES.ongoing}
                  selected={perfCardFilter === 'ongoing'}
                  onClick={() => togglePerfCardFilter('ongoing')}
                  className="min-w-0 flex-1"
                >
                  {renderShippingSummaryCardBody('ongoing', ongoingPerformanceSummary)}
                </PerformanceSection1CardShell>

                <PerformanceSection1CardShell
                  variant="completed"
                  title={SHIPPING_PERF_CARD_TITLES.close}
                  selected={perfCardFilter === 'close'}
                  onClick={() => togglePerfCardFilter('close')}
                  className="min-w-0 flex-1"
                >
                  {renderShippingSummaryCardBody('close', closePerformanceSummary)}
                </PerformanceSection1CardShell>
              </div>
            </div>
          )
        })()}

        {/* Section 2: Drilldown */}
        <Card>
          <CardHeader className="pb-2">
            <div>
              <CardTitle className="text-base flex items-center gap-2 flex-wrap">
                <span>
                  {perfDashMode === 'eta'
                    ? 'Shipping Performance Drilldown (ETA)'
                    : 'Shipping Performance Drilldown (ATA)'}
                </span>
              </CardTitle>
              <PerformanceDrilldownScopeLine segments={shippingPerfDrilldownScopeSegments} />
            </div>
          </CardHeader>
          <CardContent className="pt-2">
            {perfTree.length === 0 && !summaryLoading && !summaryFetching ? (
              <div className="text-sm text-gray-500">No shipments found for the current filters.</div>
            ) : (
              <div
                className={`transition-opacity duration-200 ${
                  (summaryLoading || summaryFetching) && rows.length > 0 ? 'opacity-65' : 'opacity-100'
                }`}
              >
                <div className="flex items-center justify-end mb-3">
                  <button
                    type="button"
                    onClick={resetPerfSelections}
                    className="text-sm text-blue-700 hover:underline"
                  >
                    Reset selection
                  </button>
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-4 gap-3">
                  {([
                      { title: 'Product',     subtitle: drilldownFilters.product  ? `Under ${displayGroupLabel(drilldownFilters.product)}`  : 'Pick one',                             level: 'product'  as const },
                      { title: 'Group Plant', subtitle: drilldownFilters.product  ? `Under ${displayGroupLabel(drilldownFilters.product)}`  : 'Pick product first',                 level: 'plant'    as const },
                      { title: 'Incoterm',    subtitle: drilldownFilters.plant    ? `Under ${displayGroupLabel(drilldownFilters.plant)}`    : 'Pick group plant first',             level: 'incoterm' as const },
                      { title: 'Vessel',   subtitle: drilldownFilters.incoterm ? `Under ${displayGroupLabel(drilldownFilters.incoterm)}` : 'Pick incoterm first',             level: 'vessel'   as const },
                    ] as const).map((col) => {
                      const activeTree = perfTree
                      const vesselDenom = activeDatasetBundle.summary.vesselCount || 1
                      const levelStyles: Record<string, { headerBg: string; badge: string; bar: string; border: string }> = {
                        vessel:  { headerBg: 'bg-sky-50',     badge: 'bg-sky-100 text-sky-800',        bar: 'bg-sky-600',     border: 'border-sky-200' },
                        incoterm:{ headerBg: 'bg-violet-50',  badge: 'bg-violet-100 text-violet-800',  bar: 'bg-violet-600',  border: 'border-violet-200' },
                        product: { headerBg: 'bg-amber-50',   badge: 'bg-amber-100 text-amber-800',    bar: 'bg-amber-600',   border: 'border-amber-200' },
                        plant:   { headerBg: 'bg-emerald-50', badge: 'bg-emerald-100 text-emerald-800',bar: 'bg-emerald-600', border: 'border-emerald-200' },
                      }
                      const style = levelStyles[col.level]
                      const itemClass = (selected: boolean) =>
                        `w-full text-left rounded-lg border px-3 py-2 hover:bg-gray-50 focus:outline-none ${
                          selected ? `bg-white ${style.border}` : 'bg-white border-gray-200'
                        }`

                      const renderNode = (node: LatePerfNode, selected: boolean, onClick: () => void, isTotal = false) => {
                        const label = col.level === 'vessel' ? node.key : displayGroupLabel(node.key)
                        const vesselPct = Math.max(1, Math.round((node.vesselCount / vesselDenom) * 100))
                        return (
                          <button key={node.key} type="button" className={itemClass(selected)} onClick={onClick}>
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0 flex-1 text-left">
                                <div className="text-sm font-semibold text-gray-900 truncate">{label}</div>
                                <div className="mt-1 h-1.5 rounded bg-gray-100 overflow-hidden">
                                  <div className={`h-full ${style.bar}`} style={{ width: `${vesselPct}%` }} />
                                </div>
                                <div className="mt-1 text-xs text-gray-700 flex items-center gap-2">
                                  <span className="font-semibold">{node.vesselCount.toLocaleString('en-US')}</span>
                                  <span className="text-gray-500">Vessels</span>
                                </div>
                              </div>
                              {isTotal && (
                                <span className={`shrink-0 px-2 py-1 rounded text-[11px] font-semibold ${style.badge}`}>Total</span>
                              )}
                            </div>
                          </button>
                        )
                      }

                      const panelHeader = (
                        <div className={`rounded-lg border px-3 py-2 ${style.headerBg} ${style.border}`}>
                          <div className="text-sm font-semibold text-gray-900">{col.title}</div>
                          <div className="text-[11px] text-gray-500">{col.subtitle}</div>
                        </div>
                      )

                      const productNode  = activeTree.find((n) => n.key === drilldownFilters.product)
                      const plantNode    = productNode?.children.find((n) => n.key === drilldownFilters.plant)
                      const incotermNode = plantNode?.children.find((n) => n.key === drilldownFilters.incoterm)

                      const body = (() => {
                        if (col.level === 'product') {
                          return (
                            <div className="space-y-2">
                              {activeTree.map((n) => renderNode(n, drilldownFilters.product === n.key, () => {
                                applyPerfDrilldownClick({ product: n.key, plant: null, incoterm: null, vessel: null })
                              }))}
                            </div>
                          )
                        }
                        if (col.level === 'plant') {
                          if (!drilldownFilters.product) return <div className="text-sm text-gray-500">Select a product to see group plants.</div>
                          return (
                            <div className="space-y-2">
                              {(productNode?.children || []).map((n) => renderNode(n, drilldownFilters.plant === n.key, () => {
                                applyPerfDrilldownClick({ plant: n.key, incoterm: null, vessel: null })
                              }))}
                            </div>
                          )
                        }
                        if (col.level === 'incoterm') {
                          if (!drilldownFilters.plant) return <div className="text-sm text-gray-500">Select a group plant to see incoterms.</div>
                          return (
                            <div className="space-y-2">
                              {(plantNode?.children || []).map((n) => renderNode(n, drilldownFilters.incoterm === n.key, () => {
                                applyPerfDrilldownClick({ incoterm: n.key, vessel: null })
                              }))}
                            </div>
                          )
                        }
                        if (!drilldownFilters.incoterm) return <div className="text-sm text-gray-500">Select an incoterm to see vessels.</div>
                        return (
                          <div className="space-y-2">
                            {(incotermNode?.children || []).map((n) => renderNode(n, drilldownFilters.vessel === n.key, () => {
                              applyPerfDrilldownClick({ vessel: n.key })
                            }))}
                          </div>
                        )
                      })()

                      return (
                        <div key={col.level} className="space-y-2">
                          {panelHeader}
                          <div className="space-y-2 max-h-[420px] overflow-auto pr-1">{body}</div>
                        </div>
                      )
                    })}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Global Filters — hidden when SHIPPING_PERF_GLOBAL_FILTERS_ENABLED is false */}
        <Card
          className={cn(!SHIPPING_PERF_GLOBAL_FILTERS_ENABLED && 'hidden')}
          aria-hidden={!SHIPPING_PERF_GLOBAL_FILTERS_ENABLED}
        >
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Filters</CardTitle>
            <p className="text-sm text-gray-600 mt-1">
              Apply incoterm, group plant, vessel, status, and contract date filters to the summary, drilldown, and shipment table.
            </p>
          </CardHeader>
          <CardContent className="pt-2 space-y-4">
            <div className="flex flex-wrap items-end gap-4">
              <div className="flex min-w-[12rem] flex-1 flex-col gap-1">
                <label htmlFor="shipping-perf-search" className="text-sm font-medium text-gray-700">
                  Search
                </label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 transform text-gray-400" />
                  <Input
                    id="shipping-perf-search"
                    placeholder="Search by Contract, PO, STO, Vessel, Product, or Incoterm..."
                    value={searchDraft}
                    onChange={(e) => setSearchDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        setSearchTerm(searchDraft)
                      }
                    }}
                    className="h-10 pl-10"
                  />
                </div>
              </div>
              <div className="flex w-full min-w-[12rem] shrink-0 flex-col gap-1 sm:w-44">
                <label htmlFor="shipping-perf-status-filter" className="text-sm font-medium text-gray-700">
                  Status
                </label>
                <select
                  id="shipping-perf-status-filter"
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as TableStatusFilter)}
                  className="flex h-10 w-full rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-900 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
                >
                  <option value="All">All</option>
                  <option value="Open">Open</option>
                  <option value="Closed">Closed</option>
                </select>
              </div>
              <div className="flex w-full min-w-[12rem] shrink-0 flex-col gap-1 sm:w-56">
                <SearchableMultiSelect
                  label="Vessel"
                  options={availableVessels}
                  selected={selectedVessels}
                  onChange={setSelectedVessels}
                  placeholder="Select vessel(s)"
                  emptyMessage="No vessels"
                />
              </div>
            </div>
            <PerformanceScopeFilters
              hideGroupPlantFilter={false}
              incotermOptions={availableIncoterms}
              selectedIncoterms={selectedIncoterms}
              onIncotermsChange={setSelectedIncoterms}
              showProductFilter
              productOptions={availableProducts}
              selectedProducts={selectedProducts}
              onProductsChange={setSelectedProducts}
              groupPlantOptions={availableGroupPlants}
              selectedGroupPlants={selectedGroupPlants}
              onGroupPlantsChange={setSelectedGroupPlants}
              dateFrom={dateFrom}
              dateTo={dateTo}
              onDateFromChange={setDateFrom}
              onDateToChange={setDateTo}
              showClearButton
              onClear={() => {
                setSearchDraft('')
                setSearchTerm('')
                setSelectedIncoterms([])
                setSelectedProducts([])
                setSelectedGroupPlants([])
                setSelectedVessels([])
                setStatusFilter('All')
                setDateFrom('')
                setDateTo('')
              }}
              incotermEmptyMessage="No incoterms"
              productEmptyMessage="No products"
              groupPlantPlaceholder="Select group plant(s)"
              groupPlantEmptyMessage="No group plants"
            />
          </CardContent>
        </Card>

        {/* Section 3: View Table — scoped by Section 1 card + Section 2 drilldown */}
        <div>
        <Card>
          <CardHeader className="space-y-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                <span>{tableViewMode === 'all' ? 'All Shipments' : 'By Vessel'}</span>
                {summaryFetching ? (
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin text-gray-400" aria-hidden />
                ) : null}
              </CardTitle>
              <p className="text-xs text-gray-500 mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0 max-w-full">
                  <span className="whitespace-nowrap tabular-nums text-gray-700">
                    <span className="font-semibold">{scopedUniqueContractCount.toLocaleString('en-US')}</span>{' '}
                    unique contracts
                  </span>
                  <span className="text-gray-400" aria-hidden>
                    ·
                  </span>
                  <span className="whitespace-nowrap tabular-nums text-gray-700">
                    <span className="font-semibold">
                      {(tableViewMode === 'all' ? drilldownFilteredRows.length : tableRows.length).toLocaleString('en-US')}
                    </span>{' '}
                    {tableViewMode === 'all' ? 'shipments' : `vessel${tableRows.length === 1 ? '' : 's'}`}
                  </span>
                  <span className="text-gray-400" aria-hidden>
                    ·
                  </span>
                  <span className="whitespace-nowrap tabular-nums">
                    Page {currentPage}/{totalPages} · {paginatedRows.length} rows
                  </span>
                  {tableScopeParts.length > 0 && (
                    <>
                      <span className="text-gray-400" aria-hidden>
                        ·
                      </span>
                      <span className="whitespace-nowrap text-gray-600 font-medium">
                        {tableScopeParts.join(' · ')}
                      </span>
                    </>
                  )}
                </p>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="inline-flex rounded-lg border bg-white p-1">
                <button
                  type="button"
                  onClick={() => switchTableViewMode('all')}
                  className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${tableViewMode === 'all' ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-100'}`}
                >
                  All Shipment
                </button>
                <button
                  type="button"
                  onClick={activateByVesselTableView}
                  className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${tableViewMode === 'by_vessel' ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-100'}`}
                >
                  By Vessel
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-2 ml-auto">
              <div ref={columnsMenuRef} className="relative">
                <Button variant="outline" size="sm" onClick={() => setShowColumnManager((v) => !v)} disabled={summaryFetching || section3TableLoading}>
                  <SlidersHorizontal className="h-4 w-4 mr-2" />
                  Columns
                </Button>
                {showColumnManager && (
                  <div className="absolute right-0 mt-2 w-64 rounded-md border bg-white shadow-md z-50 p-3">
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <div className="text-xs font-semibold text-gray-600">Visible columns</div>
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setShowColumnManager(false)}>
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                    <div className="flex items-center gap-1 mb-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="flex-1 text-xs h-7"
                        onClick={() => setVisibleColumns(Object.fromEntries(COLUMN_DEFS.map((c) => [c.key, true])))}
                      >
                        Select All
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="flex-1 text-xs h-7"
                        onClick={() => setVisibleColumns(Object.fromEntries(COLUMN_DEFS.map((c) => [c.key, false])))}
                      >
                        Unselect All
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="flex-1 text-xs h-7"
                        onClick={() =>
                          setVisibleColumns(
                            Object.fromEntries(
                              COLUMN_DEFS.map((c) => [c.key, columnDefaultVisible(c, tableViewMode)]),
                            ),
                          )
                        }
                      >
                        Reset
                      </Button>
                    </div>
                    <div className="border-t pt-2 space-y-2 max-h-72 overflow-auto pr-1">
                      {columnManagerKeys.map((key) => {
                        const col = COLUMN_MAP[String(key)]
                        if (!col) return null
                        return (
                          <div
                            key={String(col.key)}
                            onDragOver={(e) => e.preventDefault()}
                            onDrop={(e) => {
                              e.preventDefault()
                              e.stopPropagation()
                              if (dragColId && dragColId !== String(col.key)) {
                                reorderColumnByDrag(dragColId, String(col.key))
                              }
                              setDragColId(null)
                            }}
                            className={`flex items-center gap-2 text-sm select-none rounded px-1 py-0.5 ${dragColId === String(col.key) ? 'bg-slate-100' : 'hover:bg-gray-50'}`}
                          >
                            <span
                              draggable
                              onDragStart={() => setDragColId(String(col.key))}
                              onDragEnd={() => setDragColId(null)}
                              className={`cursor-grab active:cursor-grabbing shrink-0 ${dragColId === String(col.key) ? 'opacity-40' : ''}`}
                              title="Drag to reorder"
                            >
                              <GripVertical className="h-3.5 w-3.5 text-gray-400" />
                            </span>
                            <label className="flex items-center gap-2 cursor-pointer flex-1 min-w-0">
                              <Checkbox
                                checked={Boolean(visibleColumns[String(col.key)])}
                                onCheckedChange={() => onToggleColumn(col.key)}
                              />
                              <span className="truncate">{getColumnHeaderLabel(col)}</span>
                            </label>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
              {totalPages > 1 && (
                <div className="flex flex-wrap items-center gap-1">
                  <Button variant="outline" size="sm" onClick={() => handlePageChange(currentPage - 1)} disabled={currentPage === 1 || summaryFetching || section3TableLoading}>
                    Previous
                  </Button>
                  {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                    let pageNum: number
                    if (totalPages <= 5) { pageNum = i + 1 }
                    else if (currentPage <= 3) { pageNum = i + 1 }
                    else if (currentPage >= totalPages - 2) { pageNum = totalPages - 4 + i }
                    else { pageNum = currentPage - 2 + i }
                    return (
                      <Button key={pageNum} variant={currentPage === pageNum ? 'default' : 'outline'} size="sm" onClick={() => handlePageChange(pageNum)} disabled={summaryFetching || section3TableLoading} className="min-w-[36px]">
                        {pageNum}
                      </Button>
                    )
                  })}
                  <Button variant="outline" size="sm" onClick={() => handlePageChange(currentPage + 1)} disabled={currentPage === totalPages || summaryFetching || section3TableLoading}>
                    Next
                  </Button>
                  <span className="text-xs text-gray-500 ml-1 tabular-nums">
                    Page {currentPage} of {totalPages}
                  </span>
                </div>
              )}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className={section3TableLoading ? 'min-h-[480px]' : undefined}>
            <div className="border rounded-lg overflow-hidden">
              {/* Top scrollbar */}
              <div
                ref={topScrollRef}
                className={cn(COMPACT_OPERATIONAL_TABLE_SCROLL_CLASS, 'border-b bg-white')}
                onScroll={() => {
                  if (isSyncingScroll.current) return
                  const top = topScrollRef.current
                  const bottom = bottomScrollRef.current
                  if (!top || !bottom) return
                  isSyncingScroll.current = true
                  bottom.scrollLeft = top.scrollLeft
                  window.requestAnimationFrame(() => { isSyncingScroll.current = false })
                }}
              >
                <div style={{ width: tableScrollWidth || 0, height: 1 }} />
              </div>

              {/* Table */}
              <div
                ref={bottomScrollRef}
                className={COMPACT_OPERATIONAL_TABLE_SCROLL_CLASS}
                onScroll={() => {
                  if (isSyncingScroll.current) return
                  const top = topScrollRef.current
                  const bottom = bottomScrollRef.current
                  if (!top || !bottom) return
                  isSyncingScroll.current = true
                  top.scrollLeft = bottom.scrollLeft
                  window.requestAnimationFrame(() => { isSyncingScroll.current = false })
                }}
              >
                <div className="min-w-0">
                <table
                  className={cn(
                    COMPACT_OPERATIONAL_TABLE_CLASS,
                    COMPACT_OPERATIONAL_TABLE_ROW_VCENTER_CLASS,
                    'klip-compact-table--perf-narrow-cols',
                  )}
                >
                  <colgroup>
                    {tableColumnKeys.map((key) => {
                      const col = COLUMN_MAP[String(key)]
                      const columnLabel = getColumnHeaderLabel(col)
                      return (
                        <col
                          key={String(key)}
                          style={{
                            width: compactTableColWidthCss(
                              shippingPerfTableColumnWidthPx(String(key), columnLabel),
                            ),
                          }}
                        />
                      )
                    })}
                    {showTableActionsColumn ? (
                      <col style={{ width: 120 }} />
                    ) : null}
                  </colgroup>
                  <thead>
                    <tr className={SHIPPING_PERF_TABLE_HEADER_ROW_CLASS}>
                      {tableColumnKeys.map((key) => {
                        const col = COLUMN_MAP[String(key)]
                        const columnLabel = getColumnHeaderLabel(col)
                        const columnTooltip = resolvePerfColumnTooltip(col.tooltip, tableLabelMode)
                        const isSorted = sortBy === key
                        const opColClass = operationalTableColumnClass(
                          getShippingPerfTableColumnLayout(String(key), tableViewMode),
                        )
                        return (
                          <th
                            key={String(key)}
                            scope="col"
                            className={cn(
                              'relative cursor-move select-none text-left font-semibold align-top sticky top-0 z-20 bg-gray-50',
                              SHIPPING_PERF_TABLE_CELL_PAD,
                              opColClass,
                              draggingColumn === String(key) && 'opacity-60',
                            )}
                            draggable
                            onDragStart={() => setDraggingColumn(String(key))}
                            onDragEnd={() => setDraggingColumn(null)}
                            onDragOver={(e) => e.preventDefault()}
                            onDrop={(e) => {
                              e.preventDefault()
                              if (draggingColumn) moveColumn(draggingColumn, String(key))
                              setDraggingColumn(null)
                            }}
                          >
                            <ContractPerfTableSortHeader
                              label={columnLabel}
                              formulaHelp={columnTooltip}
                              activeSort={isSorted}
                              sortDir={sortDirection}
                              onSortClick={() => onHeaderSort(key)}
                            />
                          </th>
                        )
                      })}
                      {showTableActionsColumn ? (
                        <th scope="col" className={COMPACT_TABLE_ACTIONS_HEADER_CLASS}>
                          Actions
                        </th>
                      ) : null}
                    </tr>
                  </thead>
                  <tbody
                    className={`${SHIPPING_PERF_TABLE_BODY_CLASS} ${
                      summaryFetching && rows.length > 0 ? 'opacity-65' : 'opacity-100'
                    }`}
                  >
                    {(summaryLoading || summaryFetching) && rows.length === 0 ? (
                      <TableInitialLoadPlaceholder
                        colSpan={tableColSpan}
                        icon={Package}
                      />
                    ) : !summaryFetching && tableRows.length === 0 ? (
                      <tr className="bg-white">
                        <td colSpan={tableColSpan} className="px-4 py-10 text-center text-sm text-gray-500">
                          No data found
                        </td>
                      </tr>
                    ) : (
                      paginatedRows.map((row, rowIdx) => {
                        const stripeClass = rowIdx % 2 === 0 ? 'bg-white' : 'bg-gray-50'
                        return (
                        <tr key={row.id} className={stripeClass}>
                          {tableColumnKeys.map((key) => {
                            const col = COLUMN_MAP[String(key)]
                            const colKey = String(key)
                            const dataKey = resolveColumnDataKey(key, perfDashMode)
                            const rawValue = row[dataKey]
                            const numericDisplayValue =
                              colKey === 'total_delta_days'
                                ? resolveShippingPerfTotalDeltaDisplay(
                                    row as unknown as Record<string, unknown>,
                                    perfDashMode,
                                  )
                                : rawValue
                            const layout = getShippingPerfTableColumnLayout(colKey, tableViewMode)
                            const opColClass = operationalTableColumnClass(layout)
                            const useTruncateTooltip =
                              SHIPPING_PERF_TRUNCATE_TOOLTIP_COLUMN_IDS.has(colKey) &&
                              (layout === 'wrap' ||
                                layout === 'truncate' ||
                                layout === 'short')
                            const truncateTooltip = useTruncateTooltip
                              ? shippingPerfCellTooltipText(colKey, row)
                              : null

                            let cellContent: ReactNode
                            if (key === 'vessel_name') {
                              const vesselName = formatVesselTableDisplay(rawValue)
                              if (tableViewMode === 'by_vessel') {
                                cellContent = (
                                  <button
                                    type="button"
                                    className="block w-full min-w-0 truncate text-left text-sm text-blue-700 hover:text-blue-900 hover:underline"
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      setSelectedVesselData({
                                        vesselName: normalizeVesselKey(rawValue),
                                        vesselKey: normalizeVesselKey(rawValue),
                                      })
                                      setVesselModalOpen(true)
                                    }}
                                  >
                                    {vesselName}
                                  </button>
                                )
                              } else {
                                cellContent = (
                                  <span className="text-sm">{vesselName}</span>
                                )
                              }
                            } else if (isOutstandingQtyColumn(String(key))) {
                              cellContent =
                                rawValue === null || rawValue === undefined ? (
                                  <span className="text-gray-400">-</span>
                                ) : (
                                  <span
                                    className={cn(
                                      'text-sm tabular-nums font-normal',
                                      outstandingQtyMtColorClass(Number(rawValue)),
                                    )}
                                  >
                                    {formatSapOutstandingQtyMtDisplay(rawValue as number)}
                                  </span>
                                )
                            } else if (isMtQtyColumn(String(key))) {
                              cellContent =
                                rawValue === null || rawValue === undefined ? (
                                  <span className="text-gray-400">-</span>
                                ) : (
                                  <span className="text-sm tabular-nums">
                                    {(Number(rawValue) / 1000).toLocaleString('en-US', {
                                      maximumFractionDigits: 0,
                                    })}
                                    {' MT'}
                                  </span>
                                )
                            } else if (key === 'shipment_count') {
                              cellContent = (
                                <span className="text-sm tabular-nums">
                                  {Number(rawValue ?? 0).toLocaleString('en-US')}
                                </span>
                              )
                            } else if (key === 'status') {
                              cellContent = rawValue ? (
                                <Badge
                                  className={cn(
                                    'text-xs whitespace-nowrap shrink-0',
                                    shipmentStatusBadgeClass(String(rawValue)),
                                  )}
                                >
                                  {formatShipmentStatusLabel(String(rawValue))}
                                </Badge>
                              ) : (
                                <span className="text-sm text-gray-400">-</span>
                              )
                            } else if (
                              colKey === 'contract_ext_no' ||
                              colKey === 'po_number' ||
                              colKey === 'contract_number' ||
                              colKey === 'sto_number'
                            ) {
                              const text = asDisplayValue(rawValue)
                              cellContent = <span className="text-sm">{text}</span>
                            } else if (colKey === 'lp_flow_rate' || colKey === 'dp_flow_rate') {
                              cellContent =
                                rawValue === null || rawValue === undefined ? (
                                  <span className="text-sm text-gray-400">-</span>
                                ) : (
                                  <span className="text-sm font-normal tabular-nums">
                                    {Number(rawValue).toLocaleString('en-US', {
                                      minimumFractionDigits: 1,
                                      maximumFractionDigits: 1,
                                    })}
                                  </span>
                                )
                            } else if (col.type === 'number') {
                              cellContent = (
                                <NumberCell
                                  value={numericDisplayValue}
                                  isDeltaDays={
                                    String(key).includes('delta') || String(dataKey).includes('delta')
                                  }
                                  decimalPlaces={
                                    tableViewMode === 'by_vessel' &&
                                    (String(key).includes('delta') || String(dataKey).includes('delta'))
                                      ? 0
                                      : undefined
                                  }
                                />
                              )
                            } else if (key === 'loading_port' || key === 'discharge_port') {
                              const resolved =
                                key === 'loading_port'
                                  ? resolveShippingPerfLoadingPort(row)
                                  : resolveShippingPerfDischargePort(row)
                              cellContent = (
                                <span className="text-sm">
                                  {formatPortColumnDisplay(resolved)}
                                </span>
                              )
                            } else {
                              const text = asDisplayValue(rawValue)
                              cellContent = <span className="text-sm">{text}</span>
                            }

                            return (
                              <td
                                key={`${row.id}-${colKey}`}
                                className={cn(
                                  COMPACT_OPERATIONAL_TABLE_CELL_CLASS,
                                  opColClass,
                                  'align-middle',
                                  SHIPPING_PERF_TABLE_CELL_PAD,
                                  stripeClass,
                                )}
                              >
                                <div
                                  className={cn(
                                    COMPACT_OPERATIONAL_TABLE_CELL_INNER_CLASS,
                                    SHIPPING_PERF_TABLE_ROW_MIN_H,
                                  )}
                                >
                                  {useTruncateTooltip ? (
                                    <ContractPerfTruncatedCell
                                      tooltip={truncateTooltip}
                                      className="w-full"
                                    >
                                      {cellContent}
                                    </ContractPerfTruncatedCell>
                                  ) : (
                                    cellContent
                                  )}
                                </div>
                              </td>
                            )
                          })}
                          {showTableActionsColumn ? (
                            <td className={cn(COMPACT_TABLE_ACTIONS_CELL_CLASS, stripeClass)}>
                              <div className="flex items-center justify-center gap-2">
                                {String(row.id || '').trim() ? (
                                  <>
                                    <Button
                                      variant="outline"
                                      size="icon"
                                      onClick={() => openViewShipmentFromRow(row)}
                                      title="View shipment"
                                      className="bg-green-50 border-green-200 text-green-700 hover:bg-green-100"
                                    >
                                      <Eye className="h-4 w-4" />
                                    </Button>
                                    <Button
                                      variant="outline"
                                      size="icon"
                                      onClick={() =>
                                        setRemarksModal({
                                          shipmentId: row.id,
                                          subtitle:
                                            row.operation_id ||
                                            row.shipment_id ||
                                            row.sto_number ||
                                            '',
                                        })
                                      }
                                      title="View remarks"
                                      className="bg-orange-50 border-orange-200 text-orange-700 hover:bg-orange-100"
                                    >
                                      <MessageSquare className="h-4 w-4" />
                                    </Button>
                                  </>
                                ) : null}
                              </div>
                            </td>
                          ) : null}
                        </tr>
                        )
                      })
                    )}
                  </tbody>
                </table>
                </div>
              </div>
            </div>

            <p className="text-xs text-gray-500 mt-3">
              Delta unit is day difference. Records include transport mode SEA or MIX only.
            </p>
            </div>
          </CardContent>
        </Card>
        </div>

        <VesselHistoryModal
          open={vesselModalOpen}
          onClose={() => {
            setVesselModalOpen(false)
            setSelectedVesselData(null)
          }}
          selection={selectedVesselData}
          sourceRows={vesselHistorySourceRows}
        />

        <ViewShipmentModal
          open={viewShipmentModal != null}
          onClose={() => setViewShipmentModal(null)}
          editShipmentId={viewShipmentModal?.shipmentId ?? null}
          editContractId={viewShipmentModal?.editContractId ?? null}
          editStoNumber={viewShipmentModal?.editStoNumber ?? null}
          editContractNumbers={viewShipmentModal?.editContractNumbers ?? null}
          onSubmit={async () => {}}
          onShipmentChanged={() => {
            invalidateLogisticsListCaches()
            void fetchShippingPerformanceDashboard()
          }}
        />

        <HistoricalRemarksModal
          open={remarksModal != null}
          onClose={() => setRemarksModal(null)}
          entityType="shipment"
          entityId={remarksModal?.shipmentId ?? null}
          subtitle={remarksModal?.subtitle}
        />
      </div>
  )
}
