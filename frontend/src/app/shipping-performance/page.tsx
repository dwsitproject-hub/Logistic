'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import Layout from '@/components/Layout'
import { canViewShippingPerformancePage, usePermissions } from '@/components/PermissionsContext'
import api from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { GripVertical, Search, SlidersHorizontal, X } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { PerformanceScopeFilters } from '@/components/performance/PerformanceScopeFilters'
import { SearchableMultiSelect } from '@/components/SearchableMultiSelect'
import VesselHistoryModal, {
  type VesselHistoryModalSelection,
} from '@/components/shipping-performance/VesselHistoryModal'
import {
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
  shippingPerfCardTitleLines,
  type ShippingPerfCardFilter,
  type ShippingSummaryMetricKey,
} from '@/lib/shippingPerformanceLabels'
import {
  SHIPPING_PERF_TABLE_BODY_CLASS,
  SHIPPING_PERF_TABLE_CELL_PAD,
  SHIPPING_PERF_TABLE_HEADER_ROW_CLASS,
  SHIPPING_PERF_TABLE_ROW_MIN_H,
  SHIPPING_PERF_TRUNCATE_TOOLTIP_COLUMN_IDS,
  getShippingPerfTableColumnLayout,
  shippingPerfCellTooltipText,
} from '@/lib/shippingPerformanceTableUi'
import {
  COMPACT_OPERATIONAL_TABLE_CELL_CLASS,
  COMPACT_OPERATIONAL_TABLE_CELL_INNER_CLASS,
  COMPACT_OPERATIONAL_TABLE_CLASS,
  COMPACT_OPERATIONAL_TABLE_SCROLL_CLASS,
} from '@/lib/compactTableUi'
import { ContractPerfTruncatedCell } from '@/components/performance/ContractPerfTruncatedCell'
import {
  OperationalNowrapCell,
  OperationalStackedCommaCell,
  operationalTableColumnClass,
} from '@/lib/operationalTableLayout'
import { ContractPerfTableSortHeader } from '@/components/performance/ContractPerfTableSortHeader'
import {
  ContractPerfTableSubtitleSkeleton,
  ContractTableBodySkeleton,
} from '@/components/performance/ContractPerfTableSkeleton'
import {
  applySection3PortDisplay,
  resolveShippingPerfDischargePort,
  resolveShippingPerfLoadingPort,
} from '@/lib/shippingPerformancePorts'
import { cn } from '@/lib/utils'

interface ShippingPerformanceRow {
  id: string
  shipment_id: string
  po_number?: string | null
  contract_ext_no?: string | null
  contract_number: string
  sto_number?: string | null
  contract_date?: string | null
  incoterm?: string | null
  product?: string | null
  supplier?: string | null
  contract_qty?: number | null
  status?: string | null
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
  /** SAP fallback — Vessel Loading Port 1 text name. */
  sap_vessel_loading_port_1?: string | null
  /** SAP fallback — Vessel Discharge Port. */
  sap_vessel_discharge_port?: string | null
  remark?: string | null
  ata_loading_delta_eta_etr_days?: number | null
  ata_loading_delta_eta_etb_days?: number | null
  ata_loading_delta_etb_etc_days?: number | null
  ata_discharge_delta_eta_etb_days?: number | null
  ata_discharge_delta_etb_etc_days?: number | null
  ata_total_delta_days?: number | null
}

type TableViewMode = 'all' | 'by_vessel'
type PerfDashMode = 'eta' | 'ata'
type TableStatusFilter = 'All' | 'Open' | 'Closed'

type TableColumnKey = keyof ShippingPerformanceRow

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

function aggregateByVessel(rows: ShippingPerformanceRow[], mode: PerfDashMode = 'eta'): ShippingPerformanceRow[] {
  const groups = new Map<string, ShippingPerformanceRow[]>()
  for (const row of rows) {
    const key = normalizeVesselKey(row.vessel_name)
    const bucket = groups.get(key)
    if (bucket) bucket.push(row)
    else groups.set(key, [row])
  }

  const avgDelta = (vesselRows: ShippingPerformanceRow[], logicalKey: (typeof PERF_DELTA_LOGICAL_KEYS)[number]) =>
    avgMetric(vesselRows, resolvePerfTableDataKey(logicalKey, mode))

  return [...groups.entries()].map(([vesselKey, vesselRows]) => ({
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
    outstanding_qty: sumMetric(vesselRows, 'outstanding_qty'),
    loading_delta_eta_etr_days: avgDelta(vesselRows, 'loading_delta_eta_etr_days'),
    loading_delta_eta_etb_days: avgDelta(vesselRows, 'loading_delta_eta_etb_days'),
    loading_delta_etb_etc_days: avgDelta(vesselRows, 'loading_delta_etb_etc_days'),
    discharge_delta_eta_etb_days: avgDelta(vesselRows, 'discharge_delta_eta_etb_days'),
    discharge_delta_etb_etc_days: avgDelta(vesselRows, 'discharge_delta_etb_etc_days'),
    total_delta_days: avgDelta(vesselRows, 'total_delta_days'),
    cargo_readiness_date: null,
    loading_eta_arrival: null,
    loading_eta_berthed: null,
    loading_eta_completed: null,
    discharge_eta_arrival: null,
    discharge_eta_berthed: null,
    discharge_eta_completed: null,
  }))
}

type LatePerfNode = {
  key: string
  /** Distinct contract count for this drilldown node (not shipment/row count). */
  count: number
  vesselCount: number
  children: LatePerfNode[]
}

function addDistinctContract(contracts: Set<string>, row: ShippingPerformanceRow): void {
  const contractNumber = String(row.contract_number || '').trim()
  if (contractNumber) contracts.add(contractNumber)
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
  avgTotalDelta: number | null
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
  avgTotalDelta: null,
}

const ETA_DATE_FIELDS: Array<keyof ShippingPerformanceRow> = [
  'loading_eta_arrival',
  'loading_eta_berthed',
  'loading_eta_completed',
  'discharge_eta_arrival',
  'discharge_eta_berthed',
  'discharge_eta_completed',
]

const ATA_DATE_FIELDS: Array<keyof ShippingPerformanceRow> = [
  'loading_ata_arrival',
  'loading_ata_berthed',
  'loading_ata_completed',
  'discharge_ata_arrival',
  'discharge_ata_berthed',
  'discharge_ata_completed',
]

function hasPresentDate(value: unknown): boolean {
  return value !== null && value !== undefined && String(value).trim() !== ''
}

function rowHasEta(row: ShippingPerformanceRow): boolean {
  return ETA_DATE_FIELDS.some((key) => hasPresentDate(row[key]))
}

function rowHasAta(row: ShippingPerformanceRow): boolean {
  return ATA_DATE_FIELDS.some((key) => hasPresentDate(row[key]))
}

function normalizeGroupKey(value: unknown, fallback = 'Blank'): string {
  const trimmed = String(value ?? '').trim()
  return trimmed || fallback
}

function normalizeVesselKey(value: unknown): string {
  return normalizeGroupKey(value, 'Unknown')
}

function countUniqueVessels(rows: ShippingPerformanceRow[]): number {
  return new Set(rows.map((row) => normalizeVesselKey(row.vessel_name))).size
}

type ContractActivityFlags = {
  hasOpenEtaRow: boolean
  hasOpenNoEtaRow: boolean
  hasAtaRow: boolean
}

/** One entry per contract across all rows in scope (may include multiple shipments). */
function getContractActivityByContract(rows: ShippingPerformanceRow[]): Map<string, ContractActivityFlags> {
  const byContract = new Map<string, ContractActivityFlags>()
  for (const row of rows) {
    const contractNumber = String(row.contract_number || '').trim()
    if (!contractNumber) continue
    let acc = byContract.get(contractNumber)
    if (!acc) acc = { hasOpenEtaRow: false, hasOpenNoEtaRow: false, hasAtaRow: false }
    if (rowHasAta(row)) acc.hasAtaRow = true
    else if (rowHasEta(row)) acc.hasOpenEtaRow = true
    else acc.hasOpenNoEtaRow = true
    byContract.set(contractNumber, acc)
  }
  return byContract
}

/**
 * Contract-level counts for summary cards:
 * - On Going (with ETA): at least one open shipment with ETA, no ATA on contract
 * - On Going (no ETA): at least one open shipment without ETA, no ATA on contract
 * - Close: at least one shipment with ATA in scope
 */
function contractMatchesPerfCard(
  acc: ContractActivityFlags,
  card: ShippingPerfCardFilter,
): boolean {
  if (card === 'all') return true
  if (card === 'close') return acc.hasAtaRow
  if (card === 'ongoingWithEta') return acc.hasOpenEtaRow && !acc.hasAtaRow
  return acc.hasOpenNoEtaRow && !acc.hasAtaRow
}

function getEligibleContractIds(
  scopeRows: ShippingPerformanceRow[],
  card: ShippingPerfCardFilter,
): Set<string> {
  const byContract = getContractActivityByContract(scopeRows)
  const ids = new Set<string>()
  for (const [contractNumber, acc] of byContract.entries()) {
    if (contractMatchesPerfCard(acc, card)) ids.add(contractNumber)
  }
  return ids
}

function countUniqueContractsForPerfCard(
  scopeRows: ShippingPerformanceRow[],
  card: ShippingPerfCardFilter,
): number {
  return getEligibleContractIds(scopeRows, card).size
}

function countUniqueContractsFromRows(rows: ShippingPerformanceRow[]): number {
  const ids = new Set<string>()
  for (const row of rows) {
    const contractNumber = String(row.contract_number || '').trim()
    if (contractNumber) ids.add(contractNumber)
  }
  return ids.size
}

function displayGroupLabel(key: string): string {
  return key === 'Blank' ? 'Uncategorized' : key
}

/** Drilldown card vessel label — per-node count; summing sibling cards can exceed the global unique total. */
function drilldownVesselCountLabel(level: 'product' | 'plant' | 'incoterm' | 'vessel'): string {
  switch (level) {
    case 'product':
      return 'Vessels in product'
    case 'plant':
      return 'Vessels in plant'
    case 'incoterm':
      return 'Vessels in incoterm'
    default:
      return 'Vessel'
  }
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
 * Contract-level scope for Sections 1–3 — includes all shipment rows whose contract
 * matches the same partition rules as summary card contract counts.
 */
function applyPerfCardFilter(
  rows: ShippingPerformanceRow[],
  card: ShippingPerfCardFilter,
): ShippingPerformanceRow[] {
  if (card === 'all') return rows
  const eligible = getEligibleContractIds(rows, card)
  return rows.filter((row) => {
    const contractNumber = String(row.contract_number || '').trim()
    return contractNumber.length > 0 && eligible.has(contractNumber)
  })
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
  contractScopeRows: ShippingPerformanceRow[],
): PerfDatasetBundle {
  const dataMode = perfDataModeFromCard(card)
  const tree = buildPerfTree(modeRows)
  const metrics = buildCardSummary(modeRows, dataMode)
  const vesselCount = countUniqueVessels(modeRows)
  const contractCount = countUniqueContractsForPerfCard(contractScopeRows, card)

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
    vessels.add(normalizeVesselKey(row.vessel_name))
    const contractNumber = String(row.contract_number || '').trim()
    if (contractNumber) contracts.add(contractNumber)
    totalQty += Number(row.outstanding_qty ?? 0)
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
    avgTotalDelta: avgDelta('total_delta_days'),
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
    pN.vessels.add(ves)
    if (!pN.plants.has(plant)) pN.plants.set(plant, { contracts: new Set(), vessels: new Set(), incoterms: new Map() })
    const plN = pN.plants.get(plant)!
    addDistinctContract(plN.contracts, row)
    plN.vessels.add(ves)
    if (!plN.incoterms.has(inc)) plN.incoterms.set(inc, { contracts: new Set(), vessels: new Set(), vesselsMap: new Map() })
    const iN = plN.incoterms.get(inc)!
    addDistinctContract(iN.contracts, row)
    iN.vessels.add(ves)
    if (!iN.vesselsMap.has(ves)) iN.vesselsMap.set(ves, { contracts: new Set(), vessels: new Set([ves]) })
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
          vesselCount: 1,
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
  key: keyof ShippingPerformanceRow
  label: string
  type: ColumnType
  defaultVisible?: boolean
  /** Default visibility when the By Vessel toggle is active. */
  byVesselDefaultVisible?: boolean
  tooltip?: string
}

function columnDefaultVisible(col: ColumnDef, tableViewMode: TableViewMode): boolean {
  if (tableViewMode === 'by_vessel' && col.byVesselDefaultVisible !== undefined) {
    return col.byVesselDefaultVisible
  }
  return col.defaultVisible !== false
}

/** Shipping Performance Section 3 only — SAP delta column header tooltips. */
const SHIPPING_PERF_DELTA_COLUMN_TOOLTIPS: Partial<Record<keyof ShippingPerformanceRow, string>> = {
  loading_delta_eta_etr_days:
    'This metric represents the duration calculated as: ETA Vessel Arrival at Loading Port − Cargo Readiness Date (ETR) based on SAP tables VBEP/LIPS/VTTK.',
  loading_delta_eta_etb_days:
    'This metric represents the duration calculated as: ETA Vessel Arrival at Loading Port − ETA Vessel Berthed at Loading Port based on SAP tables VBEP/LIPS/VTTK.',
  loading_delta_etb_etc_days:
    'This metric represents the duration calculated as: ETA Vessel Berthed at Loading Port − ETA Loading Completed based on SAP tables VBEP/LIPS/VTTK.',
  discharge_delta_eta_etb_days:
    'This metric represents the duration calculated as: ETA Vessel Arrive at Discharge Port − ETA Vessel Berthed at Discharge Port based on SAP tables VBEP/LIPS/VTTK.',
  discharge_delta_etb_etc_days:
    'This metric represents the duration calculated as: ETA Vessel Berthed at Discharge Port − ETA Vessel Complete Discharge based on SAP tables VBEP/LIPS/VTTK.',
}

const COLUMN_DEFS: ColumnDef[] = [
  { key: 'vessel_name', label: 'Vessel', type: 'text', defaultVisible: true },
  {
    key: 'contract_ext_no',
    label: 'Contract Ext No',
    type: 'text',
    defaultVisible: false,
    byVesselDefaultVisible: false,
  },
  { key: 'loading_port', label: 'Loading Port', type: 'text', defaultVisible: true },
  { key: 'discharge_port', label: 'Discharge Port', type: 'text', defaultVisible: true },
  { key: 'incoterm', label: 'Incoterm', type: 'text', defaultVisible: true },
  { key: 'product', label: 'Product', type: 'text', defaultVisible: true },
  { key: 'supplier', label: 'Supplier', type: 'text', defaultVisible: true },
  { key: 'contract_qty', label: 'Contract Qty', type: 'number', defaultVisible: true },
  { key: 'group_name', label: 'Supplier Group', type: 'text', defaultVisible: false },
  { key: 'shipment_count', label: 'Shipments', type: 'number', defaultVisible: false },
  { key: 'status', label: 'Status', type: 'text', defaultVisible: true },
  { key: 'po_number', label: 'PO No', type: 'text', defaultVisible: false },
  { key: 'contract_number', label: 'Contract No', type: 'text', defaultVisible: false },
  { key: 'sto_number', label: 'STO No', type: 'text', defaultVisible: false },
  { key: 'sto_qty', label: 'STO Qty (MT)', type: 'number', defaultVisible: false },
  { key: 'received_qty', label: 'Received Qty (MT)', type: 'number', defaultVisible: false },
  { key: 'outstanding_qty', label: 'Outstanding Qty (MT)', type: 'number', defaultVisible: true },
  {
    key: 'loading_delta_eta_etr_days',
    label: 'Loading ETA - ETR',
    type: 'number',
    defaultVisible: true,
    tooltip: SHIPPING_PERF_DELTA_COLUMN_TOOLTIPS.loading_delta_eta_etr_days,
  },
  {
    key: 'loading_delta_eta_etb_days',
    label: 'Loading ETA - ETB',
    type: 'number',
    defaultVisible: true,
    tooltip: SHIPPING_PERF_DELTA_COLUMN_TOOLTIPS.loading_delta_eta_etb_days,
  },
  {
    key: 'loading_delta_etb_etc_days',
    label: 'Loading ETB - ETC',
    type: 'number',
    defaultVisible: true,
    tooltip: SHIPPING_PERF_DELTA_COLUMN_TOOLTIPS.loading_delta_etb_etc_days,
  },
  {
    key: 'discharge_delta_eta_etb_days',
    label: 'Discharge ETA - ETB',
    type: 'number',
    defaultVisible: true,
    tooltip: SHIPPING_PERF_DELTA_COLUMN_TOOLTIPS.discharge_delta_eta_etb_days,
  },
  {
    key: 'discharge_delta_etb_etc_days',
    label: 'Discharge ETB - ETC',
    type: 'number',
    defaultVisible: true,
    tooltip: SHIPPING_PERF_DELTA_COLUMN_TOOLTIPS.discharge_delta_etb_etc_days,
  },
  { key: 'total_delta_days', label: 'Total', type: 'number', defaultVisible: true },
]

const COLUMN_MAP = Object.fromEntries(COLUMN_DEFS.map((col) => [col.key, col])) as Record<string, ColumnDef>

function isColumnEligibleForView(key: string, tableViewMode: TableViewMode): boolean {
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
  columnOrder: Array<keyof ShippingPerformanceRow>,
  tableViewMode: TableViewMode,
): TableColumnKey[] {
  return columnOrder.filter((key) => {
    const id = String(key)
    return Boolean(COLUMN_MAP[id]) && isColumnEligibleForView(id, tableViewMode)
  })
}

function resolveVisibleTableColumnKeys(
  columnOrder: Array<keyof ShippingPerformanceRow>,
  visibleColumns: Record<string, boolean>,
  tableViewMode: TableViewMode,
): TableColumnKey[] {
  return resolveManageableColumnKeys(columnOrder, tableViewMode).filter(
    (key) => visibleColumns[String(key)],
  )
}

/** Column manager list — visible columns in table order, then hidden columns A→Z (shipments/trucking pattern). */
function buildShippingPerfColumnManagerKeys(
  columnOrder: Array<keyof ShippingPerformanceRow>,
  visibleColumns: Record<string, boolean>,
  tableViewMode: TableViewMode,
): TableColumnKey[] {
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

/** Keep Contract Ext No immediately after Vessel in table + column modal order. */
function ensureContractExtNoAfterVessel(
  order: Array<keyof ShippingPerformanceRow>,
): Array<keyof ShippingPerformanceRow> {
  const defOrder = COLUMN_DEFS.map((c) => c.key)
  const deduped = order.filter((key) => defOrder.includes(key))
  const missing = defOrder.filter((key) => !deduped.includes(key))
  const merged: Array<keyof ShippingPerformanceRow> = [...deduped, ...missing]
  const vesselIdx = merged.indexOf('vessel_name')
  const extIdx = merged.indexOf('contract_ext_no')
  if (vesselIdx < 0 || extIdx < 0 || extIdx === vesselIdx + 1) return merged
  const extKey: keyof ShippingPerformanceRow = 'contract_ext_no'
  const withoutExt: Array<keyof ShippingPerformanceRow> = merged.filter((key) => key !== extKey)
  withoutExt.splice(vesselIdx + 1, 0, extKey)
  return withoutExt
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
  order: Array<keyof ShippingPerformanceRow>,
  fromKey: string,
  toKey: string,
): Array<keyof ShippingPerformanceRow> {
  if (!fromKey || !toKey || fromKey === toKey) return order
  const fromIdx = order.findIndex((key) => String(key) === fromKey)
  const toIdx = order.findIndex((key) => String(key) === toKey)
  if (fromIdx < 0 || toIdx < 0) return order
  const next = [...order]
  const [moved] = next.splice(fromIdx, 1)
  next.splice(toIdx, 0, moved)
  return next
}

function getStatusColor(status: string): string {
  switch (status) {
    case 'PLANNED':     return 'bg-blue-100 text-blue-800'
    case 'IN_PROGRESS': return 'bg-yellow-100 text-yellow-800'
    case 'LOADING':     return 'bg-orange-100 text-orange-800'
    case 'IN_TRANSIT':  return 'bg-purple-100 text-purple-800'
    case 'ARRIVED':     return 'bg-indigo-100 text-indigo-800'
    case 'UNLOADING':   return 'bg-cyan-100 text-cyan-800'
    case 'COMPLETED':   return 'bg-green-100 text-green-800'
    case 'CANCELLED':
    case 'CANCELED':    return 'bg-red-100 text-red-800'
    default:            return 'bg-gray-100 text-gray-800'
  }
}

function asDisplayValue(value: unknown): string {
  if (value === null || value === undefined) return ''
  return String(value)
}

/** Section 3 — null/empty/placeholder port values render as "-". */
function formatPortColumnDisplay(value: unknown): string {
  const trimmed = String(value ?? '').trim()
  if (!trimmed || trimmed.toLowerCase() === 'blank') return '-'
  return trimmed
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
      <span className={`text-sm font-semibold tabular-nums ${signedCycleDaysClass(n)}`}>
        {formatted}
      </span>
    )
  }
  return <span className="text-sm tabular-nums">{n}</span>
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
  const section3TableLoading = summaryLoading
  const [authReady, setAuthReady] = useState(false)

  useEffect(() => {
    if (canViewPage === false) {
      router.replace('/shipments')
    }
  }, [canViewPage, router])
  const [showColumnManager, setShowColumnManager] = useState(false)
  const [columnOrder, setColumnOrder] = useState<Array<keyof ShippingPerformanceRow>>(
    () => ensureContractExtNoAfterVessel(COLUMN_DEFS.map((c) => c.key)),
  )
  const [visibleColumns, setVisibleColumns] = useState<Record<string, boolean>>(
    Object.fromEntries(COLUMN_DEFS.map((c) => [c.key, columnDefaultVisible(c, 'all')])),
  )
  const [dragColId, setDragColId] = useState<string | null>(null)
  const [draggingColumn, setDraggingColumn] = useState<string | null>(null)
  const [sortBy, setSortBy] = useState<keyof ShippingPerformanceRow>('total_delta_days')
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
  const [selectedProducts, setSelectedProducts] = useState<string[]>([])
  const [selectedGroupPlants, setSelectedGroupPlants] = useState<string[]>([])
  const [selectedVessels, setSelectedVessels] = useState<string[]>([])
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date()
    return `${d.getFullYear()}-01-01`
  })
  const [dateTo, setDateTo] = useState(() => {
    const d = new Date()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${d.getFullYear()}-${m}-${day}`
  })
  const [perfCardFilter, setPerfCardFilter] = useState<ShippingPerfCardFilter>('all')
  const perfDashMode = useMemo(() => perfDataModeFromCard(perfCardFilter), [perfCardFilter])
  const [drilldownFilters, setDrilldownFilters] = useState<DrilldownFilters>(EMPTY_DRILLDOWN_FILTERS)
  const [tableViewMode, setTableViewMode] = useState<TableViewMode>('all')
  const [vesselModalOpen, setVesselModalOpen] = useState(false)
  const [selectedVesselData, setSelectedVesselData] = useState<VesselHistoryModalSelection | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const hasToken = () => Boolean(localStorage.getItem('token'))
    if (hasToken()) {
      setAuthReady(true)
      return
    }
    const startedAt = Date.now()
    const interval = window.setInterval(() => {
      if (hasToken()) {
        window.clearInterval(interval)
        setAuthReady(true)
      } else if (Date.now() - startedAt > 3000) {
        window.clearInterval(interval)
      }
    }, 150)
    return () => window.clearInterval(interval)
  }, [])

  const buildShippingPerfFetchParams = useCallback(() => {
    const params = new URLSearchParams()
    params.append('scope', 'ytd')
    params.append('_ts', String(Date.now()))
    return params
  }, [])

  const fetchShippingPerformanceDashboard = useCallback(async () => {
    const params = buildShippingPerfFetchParams().toString()
    try {
      setSummaryLoading(true)
      const rowsResp = await api.get(`/shipments/performance?${params}`, { timeout: 120000 })
      setRows(Array.isArray(rowsResp.data?.data) ? rowsResp.data.data : [])
    } catch (error) {
      console.error('Failed to load shipping performance dashboard:', error)
      setRows([])
    } finally {
      setSummaryLoading(false)
    }
  }, [buildShippingPerfFetchParams])

  const fetchStartedRef = useRef(false)

  useEffect(() => {
    if (!authReady || canViewPage !== true || fetchStartedRef.current) return
    fetchStartedRef.current = true
    void fetchShippingPerformanceDashboard()
  }, [authReady, canViewPage, fetchShippingPerformanceDashboard])

  // Step A: exclude UNPLANNED at base — single source of truth for Sections 1–3
  const baseFilteredRows = useMemo(() => excludeUnplannedShippingRows(rows), [rows])

  const availableIncoterms = useMemo(
    () => distinctFieldValues(baseFilteredRows, 'incoterm'),
    [baseFilteredRows],
  )
  const availableGroupPlants = useMemo(
    () => distinctFieldValues(baseFilteredRows, 'plant_site'),
    [baseFilteredRows],
  )
  const availableProducts = useMemo(
    () => distinctFieldValues(baseFilteredRows, 'product'),
    [baseFilteredRows],
  )
  const availableVessels = useMemo(
    () => distinctVesselNames(baseFilteredRows),
    [baseFilteredRows],
  )

  // Step B: apply global filters (incoterm, group plant, vessel, status, contract date)
  const globallyFilteredRows = useMemo(
    () =>
      applyGlobalFiltersToRows(baseFilteredRows, {
        selectedIncoterms,
        selectedProducts,
        selectedGroupPlants,
        selectedVessels,
        statusFilter,
        dateFrom,
        dateTo,
        searchTerm,
      }),
    [baseFilteredRows, selectedIncoterms, selectedProducts, selectedGroupPlants, selectedVessels, statusFilter, dateFrom, dateTo, searchTerm],
  )

  /** Vessel history — Open + Close in toolbar scope; ignores summary card & status filter. */
  const vesselHistorySourceRows = useMemo(
    () =>
      applyGlobalFiltersToRows(baseFilteredRows, {
        selectedIncoterms,
        selectedProducts,
        selectedGroupPlants,
        selectedVessels,
        statusFilter: 'All',
        dateFrom,
        dateTo,
        searchTerm,
      }).map(applySection3PortDisplay),
    [
      baseFilteredRows,
      selectedIncoterms,
      selectedProducts,
      selectedGroupPlants,
      selectedVessels,
      dateFrom,
      dateTo,
      searchTerm,
    ],
  )

  const ongoingWithEtaFilteredData = useMemo(
    () => applyPerfCardFilter(globallyFilteredRows, 'ongoingWithEta'),
    [globallyFilteredRows],
  )

  const ongoingNoEtaFilteredData = useMemo(
    () => applyPerfCardFilter(globallyFilteredRows, 'ongoingNoEta'),
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

  const ongoingWithEtaDatasetBundle = useMemo(
    () => buildPerfDatasetBundle(ongoingWithEtaFilteredData, 'ongoingWithEta', globallyFilteredRows),
    [ongoingWithEtaFilteredData, globallyFilteredRows],
  )

  const ongoingNoEtaDatasetBundle = useMemo(
    () => buildPerfDatasetBundle(ongoingNoEtaFilteredData, 'ongoingNoEta', globallyFilteredRows),
    [ongoingNoEtaFilteredData, globallyFilteredRows],
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
      case 'ongoingNoEta':
        return ongoingNoEtaDatasetBundle
      case 'close':
        return closeDatasetBundle
      case 'ongoingWithEta':
        return ongoingWithEtaDatasetBundle
      default:
        return allDatasetBundle
    }
  }, [
    perfCardFilter,
    ongoingWithEtaDatasetBundle,
    ongoingNoEtaDatasetBundle,
    closeDatasetBundle,
    allDatasetBundle,
  ])

  const perfTree = activeDatasetBundle.tree

  const ongoingWithEtaPerformanceSummary = ongoingWithEtaDatasetBundle.summary
  const ongoingNoEtaPerformanceSummary = ongoingNoEtaDatasetBundle.summary
  const closePerformanceSummary = closeDatasetBundle.summary

  /** Unique contracts in the current card + drilldown scope (Section 2 header & Section 3 subtitle). */
  const scopedUniqueContractCount = useMemo(
    () => countUniqueContractsFromRows(drilldownFilteredRows),
    [drilldownFilteredRows],
  )

  const cardScopeContractCount = useMemo(
    () => countUniqueContractsFromRows(perfModeFilteredRows),
    [perfModeFilteredRows],
  )

  const hasActiveDrilldown = Boolean(
    drilldownFilters.product ||
      drilldownFilters.plant ||
      drilldownFilters.incoterm ||
      drilldownFilters.vessel,
  )

  useEffect(() => {
    setDrilldownFilters(EMPTY_DRILLDOWN_FILTERS)
    setCurrentPage(1)
  }, [perfCardFilter, selectedIncoterms, selectedProducts, selectedGroupPlants, selectedVessels, statusFilter, dateFrom, dateTo, searchTerm])

  useEffect(() => {
    const allKeys = COLUMN_DEFS.map((col) => col.key)
    setColumnOrder((prev) => {
      const deduped = prev.filter((key) => allKeys.includes(key))
      const missing = allKeys.filter((key) => !deduped.includes(key))
      const next = ensureContractExtNoAfterVessel([...deduped, ...missing])
      if (prev.length === next.length && prev.every((key, index) => key === next[index])) return prev
      return next
    })
  }, [])

  const activateByVesselTableView = useCallback(() => {
    setTableViewMode('by_vessel')
    setColumnOrder((prev) => ensureContractExtNoAfterVessel(prev))
    setVisibleColumns((prev) => applyByVesselColumnDefaults(prev))
    setCurrentPage(1)
  }, [])

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

  const summaryCardClass = useCallback(
    (card: Exclude<ShippingPerfCardFilter, 'all'>) => {
      const selected = perfCardFilter === card
      const ringByCard: Record<Exclude<ShippingPerfCardFilter, 'all'>, string> = {
        ongoingWithEta: 'ring-blue-500',
        ongoingNoEta: 'ring-amber-500',
        close: 'ring-indigo-500',
      }
      const widthClass =
        card === 'ongoingNoEta'
          ? 'w-full xl:w-1/4 xl:shrink-0'
          : 'w-full xl:min-w-0 xl:flex-1'
      return cn(
        'flex min-h-full flex-col self-stretch rounded-xl border bg-white p-3 shadow-sm text-left transition-all hover:shadow-md cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-300',
        widthClass,
        selected && `ring-2 ${ringByCard[card]}`,
      )
    },
    [perfCardFilter],
  )

  const renderSummaryCardTitle = (card: ShippingPerfCardFilter) => {
    const { main: titleMain } = shippingPerfCardTitleLines(card)
    if (card === 'ongoingWithEta') {
      return (
        <div className="mb-2.5 flex items-center gap-2">
          <h2 className="text-lg font-bold text-gray-900">{titleMain}</h2>
          <span className="rounded-full border border-blue-100 bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
            with ETA
          </span>
        </div>
      )
    }
    if (card === 'ongoingNoEta') {
      return (
        <div className="mb-2.5 flex items-center gap-2">
          <h2 className="text-lg font-bold text-gray-900">{titleMain}</h2>
          <span className="rounded-full border border-amber-100 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
            no ETA
          </span>
        </div>
      )
    }
    return (
      <div className="mb-2.5">
        <h2 className="text-lg font-bold text-gray-900">{titleMain}</h2>
      </div>
    )
  }

  const renderSummaryPrimaryTotals = (
    card: ShippingPerfCardFilter,
    summary: PerVesselPerfSummary,
  ) => {
    return (
      <>
        {renderSummaryCardTitle(card)}
        <div className="space-y-2">
          <div>
            <div className="text-[11px] font-medium uppercase tracking-wider text-gray-500">
              Total Vessels
            </div>
            <div className="mt-0.5 text-2xl font-bold leading-tight tabular-nums text-gray-900">
              {summary.vesselCount.toLocaleString('en-US')}
            </div>
          </div>
          <div>
            <div className="text-[10px] font-medium uppercase tracking-wider text-gray-500">
              Contracts
            </div>
            <div className="mt-0.5 text-sm font-semibold leading-tight tabular-nums text-gray-700">
              {summary.contractCount.toLocaleString('en-US')}
            </div>
          </div>
        </div>
      </>
    )
  }

  const renderSummaryGapMetrics = (summary: PerVesselPerfSummary, card: ShippingPerfCardFilter) => {
    const labelMode = card === 'close' ? 'actual' : 'estimated'
    const fmt = (days: number | null) =>
      formatAvgDays(days == null || !Number.isFinite(days) ? null : Math.abs(days))
    const metricValueClass = (days: number | null) =>
      cn('text-[10px] font-semibold text-gray-900 tabular-nums', signedCycleDaysClass(days))
    const metrics: { key: ShippingSummaryMetricKey; value: number | null }[] = [
      { key: 'loadingEtr', value: summary.avgLoadingEtaEtr },
      { key: 'loadingEtb', value: summary.avgLoadingEtaEtb },
      { key: 'loadingEtc', value: summary.avgLoadingEtbEtc },
      { key: 'dischargeEtb', value: summary.avgDischargeEtaEtb },
      { key: 'dischargeEtc', value: summary.avgDischargeEtbEtc },
      { key: 'total', value: summary.avgTotalDelta },
    ]

    return (
      <div className="flex w-fit shrink-0 flex-col gap-y-1">
        {metrics.map(({ key, value }) => {
          const shortLabel = getShippingSummaryMetricLabel(key, labelMode, 'short')
          const fullLabel = getShippingSummaryMetricLabel(key, labelMode, 'full')
          const isTotal = key === 'total'
          return (
            <div
              key={key}
              className={cn(
                'flex min-w-[max-content] flex-row items-center justify-between gap-6',
                isTotal && 'mt-0.5 border-t border-gray-200 pt-1',
              )}
            >
              <span
                className="min-w-0 shrink text-[10px] leading-tight text-gray-500 whitespace-nowrap"
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

  /** Section 1 — asymmetrical layout: compact no-ETA card; expanded cards with inline averages. */
  const renderShippingSummaryCardBody = (
    card: ShippingPerfCardFilter,
    summary: PerVesselPerfSummary,
  ) => {
    if (card === 'ongoingNoEta') {
      return (
        <div className="flex h-full min-h-full w-full flex-1 flex-col justify-center text-left">
          {renderSummaryPrimaryTotals(card, summary)}
        </div>
      )
    }

    return (
      <div className="flex h-full min-h-full w-full min-w-0 flex-col gap-4 text-left sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1 sm:border-r sm:border-gray-200 sm:pr-4">
          {renderSummaryPrimaryTotals(card, summary)}
        </div>
        <div className="w-fit shrink-0">{renderSummaryGapMetrics(summary, card)}</div>
      </div>
    )
  }

  /** Section 3 column headers — recompute when Close/Open card or global status filter changes. */
  const tableLabelMode = useMemo(
    () => resolveShippingPerfLabelMode(perfCardFilter, statusFilter),
    [perfCardFilter, statusFilter],
  )

  const resolveTableColumnLabel = useCallback(
    (baseLabel: string) => formatShippingPerfDisplayLabel(baseLabel, tableLabelMode),
    [tableLabelMode],
  )

  const tableScopeParts = useMemo(() => {
    const parts: string[] =
      perfCardFilter === 'all' ? [] : [SHIPPING_PERF_CARD_TITLES[perfCardFilter]]
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
    if (drilldownFilters.product) parts.push(`Product: ${displayGroupLabel(drilldownFilters.product)}`)
    if (drilldownFilters.plant) parts.push(`Group Plant node: ${displayGroupLabel(drilldownFilters.plant)}`)
    if (drilldownFilters.incoterm) parts.push(`Incoterm node: ${displayGroupLabel(drilldownFilters.incoterm)}`)
    if (drilldownFilters.vessel) parts.push(`Vessel: ${drilldownFilters.vessel}`)
    if (statusFilter !== 'All') parts.push(`Status: ${statusFilter}`)
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
    const sortDataKey = resolvePerfTableDataKey(sortBy, perfDashMode)
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
    return aggregateByVessel(filteredRows, perfDashMode)
  }, [filteredRows, tableViewMode, perfDashMode])

  const columnManagerKeys = useMemo(
    () => buildShippingPerfColumnManagerKeys(columnOrder, visibleColumns, tableViewMode),
    [columnOrder, visibleColumns, tableViewMode],
  )

  const tableColumnKeys = useMemo(
    () => resolveVisibleTableColumnKeys(columnOrder, visibleColumns, tableViewMode),
    [columnOrder, visibleColumns, tableViewMode],
  )

  const totalPages = Math.max(1, Math.ceil(tableRows.length / pageSize))
  const paginatedRows = useMemo(
    () => tableRows.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [tableRows, currentPage, pageSize]
  )

  useEffect(() => {
    setCurrentPage(1)
  }, [
    statusFilter,
    selectedIncoterms,
    selectedGroupPlants,
    selectedVessels,
    dateFrom,
    dateTo,
    drilldownFilters,
    tableViewMode,
    sortBy,
    sortDirection,
  ])

  useEffect(() => {
    if (tableViewMode !== 'by_vessel') return
    setColumnOrder((prev) => ensureContractExtNoAfterVessel(prev))
    setVisibleColumns((prev) => applyByVesselColumnDefaults(prev))
  }, [tableViewMode])

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

  const onToggleColumn = (key: keyof ShippingPerformanceRow) => {
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

  const onHeaderSort = (key: keyof ShippingPerformanceRow) => {
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
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Shipping Performance</h1>
          </div>
        </div>

        {/* Section 1: Summary Cards */}
        {(() => {
          if (summaryLoading) {
            return (
              <div className="space-y-2">
                <div className="flex items-center justify-end">
                  <button
                    type="button"
                    onClick={resetPerfSelections}
                    className="text-sm text-blue-700 hover:underline"
                  >
                    Reset selection
                  </button>
                </div>
                <div className="flex w-full flex-col gap-4 xl:flex-row xl:items-stretch">
                  <div className="flex min-h-full w-full flex-col justify-center space-y-1.5 self-stretch rounded-xl border bg-white p-3 shadow-sm animate-pulse xl:w-1/4 xl:shrink-0">
                    <div className="space-y-0.5">
                      <div className="h-3.5 bg-gray-200 rounded w-20" />
                      <div className="h-2.5 bg-gray-100 rounded w-14" />
                    </div>
                    <div className="h-3 bg-gray-100 rounded w-20" />
                    <div className="h-7 bg-gray-200 rounded w-16" />
                    <div className="h-3 bg-gray-100 rounded w-24" />
                  </div>
                  {[0, 1].map((i) => (
                    <div
                      key={i}
                      className="flex min-h-full w-full min-w-0 flex-1 flex-row items-center gap-4 self-stretch rounded-xl border bg-white p-3 shadow-sm animate-pulse"
                    >
                      <div className="w-[32%] shrink-0 space-y-1 border-r border-gray-200 pr-4">
                        <div className="space-y-0.5">
                          <div className="h-3.5 bg-gray-200 rounded w-20" />
                          <div className="h-2.5 bg-gray-100 rounded w-14" />
                        </div>
                        <div className="h-3 bg-gray-100 rounded w-20" />
                        <div className="h-7 bg-gray-200 rounded w-16" />
                        <div className="h-3 bg-gray-100 rounded w-24" />
                      </div>
                      <div className="min-w-0 flex-1 space-y-1.5">
                        {[0, 1, 2, 3, 4, 5].map((j) => (
                          <div key={j} className="flex justify-between gap-2">
                            <div className="h-3 flex-1 bg-gray-100 rounded" />
                            <div className="h-3 w-12 bg-gray-200 rounded" />
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )
          }

          return (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-gray-600">
                  {perfCardFilter === 'all' ? (
                    <>
                      Combined total:{' '}
                      <span className="font-semibold tabular-nums text-gray-900">
                        {allDatasetBundle.summary.contractCount.toLocaleString('en-US')}
                      </span>{' '}
                      unique contracts
                      <span className="text-gray-400 mx-1" aria-hidden>
                        ·
                      </span>
                      <span className="tabular-nums text-gray-800">
                        {globallyFilteredRows.length.toLocaleString('en-US')}
                      </span>{' '}
                      shipments
                    </>
                  ) : (
                    <>
                      Active card:{' '}
                      <span className="font-semibold tabular-nums text-gray-900">
                        {activeDatasetBundle.summary.contractCount.toLocaleString('en-US')}
                      </span>{' '}
                      unique contracts
                      <span className="text-gray-400 mx-1" aria-hidden>
                        ·
                      </span>
                      <span className="tabular-nums text-gray-800">
                        {perfModeFilteredRows.length.toLocaleString('en-US')}
                      </span>{' '}
                      shipments
                    </>
                  )}
                  <span className="text-gray-500">
                    {' '}
                    — contract totals align with Sections 2 &amp; 3 when no drilldown is selected.
                  </span>
                </p>
                <button
                  type="button"
                  onClick={resetPerfSelections}
                  className="text-sm text-blue-700 hover:underline shrink-0"
                >
                  Reset selection
                </button>
              </div>
              <div className="flex w-full flex-col gap-4 xl:flex-row xl:items-stretch">
                <button
                  type="button"
                  onClick={() => togglePerfCardFilter('ongoingNoEta')}
                  className={summaryCardClass('ongoingNoEta')}
                >
                  {renderShippingSummaryCardBody('ongoingNoEta', ongoingNoEtaPerformanceSummary)}
                </button>

                <button
                  type="button"
                  onClick={() => togglePerfCardFilter('ongoingWithEta')}
                  className={summaryCardClass('ongoingWithEta')}
                >
                  {renderShippingSummaryCardBody('ongoingWithEta', ongoingWithEtaPerformanceSummary)}
                </button>

                <button
                  type="button"
                  onClick={() => togglePerfCardFilter('close')}
                  className={summaryCardClass('close')}
                >
                  {renderShippingSummaryCardBody('close', closePerformanceSummary)}
                </button>
              </div>
            </div>
          )
        })()}

        {/* Section 2: Drilldown */}
        <Card>
          <CardHeader className="pb-2">
            <div>
              <CardTitle className="text-base">
                {perfDashMode === 'eta' ? 'Performance Drilldown (ETA)' : 'Performance Drilldown (ATA)'}
                <span className="font-normal text-gray-500"> · {SHIPPING_PERF_CARD_TITLES[perfCardFilter]}</span>
              </CardTitle>
              <div className="text-sm text-gray-600 mt-1">
                Navigate as a tree: <span className="font-medium">Product → Group Plant → Incoterm → Vessel</span>.
                Click a node to filter the table below.
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-2">
            {summaryLoading ? (
              <div className="rounded-xl border bg-white p-6 animate-pulse">
                <div className="h-5 bg-gray-200 rounded w-48 mb-4" />
                <div className="grid grid-cols-1 lg:grid-cols-4 gap-3">
                  {[0, 1, 2, 3].map((i) => (
                    <div key={i} className="h-40 bg-gray-100 rounded-lg" />
                  ))}
                </div>
              </div>
            ) : perfTree.length === 0 ? (
              <div className="text-sm text-gray-500">No shipments found for the current filters.</div>
            ) : (
              <div className="rounded-xl border bg-white p-4">
                <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
                  <div>
                    <div className="text-sm font-semibold text-gray-900">Drilldown</div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      <span className="font-semibold text-gray-800 tabular-nums">
                        {scopedUniqueContractCount.toLocaleString('en-US')}
                      </span>{' '}
                      unique contracts
                      {hasActiveDrilldown ? ' (drilldown scope)' : ' (card scope)'}
                      <span className="text-gray-400 mx-1" aria-hidden>
                        ·
                      </span>
                      <span className="tabular-nums">{drilldownFilteredRows.length.toLocaleString('en-US')}</span>{' '}
                      shipments
                      <span className="text-gray-400 mx-1" aria-hidden>
                        ·
                      </span>
                      {activeDatasetBundle.summary.vesselCount.toLocaleString('en-US')} unique vessels
                    </div>
                    <p className="text-[11px] text-gray-500 mt-1 max-w-2xl">
                      Contract totals here match Section 3. Product node counts are unique within that product only — do
                      not add them together. Percentages show each node&apos;s share of the{' '}
                      {cardScopeContractCount.toLocaleString('en-US')} contracts in the current card scope.
                    </p>
                  </div>
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
                                <div className="mt-1 text-xs text-gray-700 flex items-center justify-between gap-2">
                                  <span className="font-semibold">{node.count.toLocaleString('en-US')}</span>
                                  <span className="text-gray-500">contracts</span>
                                  <span className="ml-auto text-right whitespace-nowrap">
                                    <span className="block text-[10px] text-gray-500 leading-tight">
                                      {drilldownVesselCountLabel(col.level)}
                                    </span>
                                    <span className="font-semibold">{node.vesselCount.toLocaleString('en-US')}</span>
                                  </span>
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

        {/* Global Filters — above table (matches Contract Performance layout) */}
        <Card>
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

        {/* Section 3: View Table — scope filters use global section above */}
        <div>
        <Card>
          <CardHeader className="space-y-3">
            <div>
              <CardTitle>{tableViewMode === 'all' ? 'All Shipments' : 'By Vessel'}</CardTitle>
              {section3TableLoading ? (
                <ContractPerfTableSubtitleSkeleton />
              ) : (
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
              )}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="inline-flex rounded-lg border bg-white p-1">
                <button
                  type="button"
                  onClick={() => { setTableViewMode('all'); setCurrentPage(1) }}
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
                <Button variant="outline" size="sm" onClick={() => setShowColumnManager((v) => !v)} disabled={section3TableLoading}>
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
                              <span className="truncate">{resolveTableColumnLabel(col.label)}</span>
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
                  <Button variant="outline" size="sm" onClick={() => handlePageChange(currentPage - 1)} disabled={currentPage === 1 || section3TableLoading}>
                    Previous
                  </Button>
                  {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                    let pageNum: number
                    if (totalPages <= 5) { pageNum = i + 1 }
                    else if (currentPage <= 3) { pageNum = i + 1 }
                    else if (currentPage >= totalPages - 2) { pageNum = totalPages - 4 + i }
                    else { pageNum = currentPage - 2 + i }
                    return (
                      <Button key={pageNum} variant={currentPage === pageNum ? 'default' : 'outline'} size="sm" onClick={() => handlePageChange(pageNum)} disabled={section3TableLoading} className="min-w-[36px]">
                        {pageNum}
                      </Button>
                    )
                  })}
                  <Button variant="outline" size="sm" onClick={() => handlePageChange(currentPage + 1)} disabled={currentPage === totalPages || section3TableLoading}>
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
                    'klip-compact-table--intrinsic-token-cols',
                  )}
                >
                  <thead>
                    <tr className={SHIPPING_PERF_TABLE_HEADER_ROW_CLASS}>
                      {tableColumnKeys.map((key) => {
                        const col = COLUMN_MAP[String(key)]
                        const columnLabel = resolveTableColumnLabel(col.label)
                        const columnTooltip = resolvePerfColumnTooltip(col.tooltip, tableLabelMode)
                        const isSorted = sortBy === key
                        const opColClass = operationalTableColumnClass(
                          getShippingPerfTableColumnLayout(String(key), tableViewMode),
                        )
                        const headerButton = (
                          <ContractPerfTableSortHeader
                            label={columnLabel}
                            activeSort={isSorted}
                            sortDir={sortDirection}
                            onSortClick={() => onHeaderSort(key)}
                          />
                        )
                        return (
                          <th
                            key={String(key)}
                            scope="col"
                            className={cn(
                              'relative cursor-move select-none text-left font-semibold align-top',
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
                            {columnTooltip ? (
                              <Tooltip delayDuration={200}>
                                <TooltipTrigger asChild>{headerButton}</TooltipTrigger>
                                <TooltipContent side="top" className="text-xs leading-relaxed max-w-sm">
                                  {columnTooltip}
                                </TooltipContent>
                              </Tooltip>
                            ) : (
                              headerButton
                            )}
                          </th>
                        )
                      })}
                    </tr>
                  </thead>
                  <tbody className={SHIPPING_PERF_TABLE_BODY_CLASS}>
                    {section3TableLoading ? (
                      <ContractTableBodySkeleton
                        columnCount={tableColumnKeys.length || 1}
                        showActionsColumn={false}
                      />
                    ) : tableRows.length === 0 ? (
                      <tr className="bg-white">
                        <td colSpan={tableColumnKeys.length || 1} className="px-4 py-10 text-center text-sm text-gray-500">
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
                            const dataKey = resolvePerfTableDataKey(key, perfDashMode)
                            const rawValue = row[dataKey]
                            const layout = getShippingPerfTableColumnLayout(colKey, tableViewMode)
                            const opColClass = operationalTableColumnClass(layout)
                            const useTruncateTooltip =
                              layout === 'truncate' &&
                              SHIPPING_PERF_TRUNCATE_TOOLTIP_COLUMN_IDS.has(colKey)
                            const truncateTooltip = useTruncateTooltip
                              ? shippingPerfCellTooltipText(colKey, row)
                              : null

                            let cellContent: ReactNode
                            if (key === 'vessel_name') {
                              const vesselName = asDisplayValue(rawValue) || 'Unknown'
                              if (tableViewMode === 'by_vessel') {
                                cellContent = (
                                  <button
                                    type="button"
                                    className="block w-max max-w-none whitespace-nowrap text-left text-sm font-medium text-blue-700 hover:text-blue-900 hover:underline"
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      setSelectedVesselData({
                                        vesselName,
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
                                  <OperationalNowrapCell value={vesselName} className="text-sm" />
                                )
                              }
                            } else if (
                              key === 'sto_qty' ||
                              key === 'received_qty' ||
                              key === 'outstanding_qty' ||
                              key === 'contract_qty'
                            ) {
                              cellContent =
                                rawValue === null || rawValue === undefined ? (
                                  <span className="text-gray-400">-</span>
                                ) : (
                                  <span className="text-sm tabular-nums">
                                    {(Number(rawValue) / 1000).toLocaleString('en-US', {
                                      maximumFractionDigits: 2,
                                    })}{' '}
                                    MT
                                  </span>
                                )
                            } else if (key === 'shipment_count') {
                              cellContent = (
                                <span className="text-sm font-medium tabular-nums">
                                  {Number(rawValue ?? 0).toLocaleString('en-US')}
                                </span>
                              )
                            } else if (key === 'status') {
                              cellContent = rawValue ? (
                                <Badge
                                  className={cn(
                                    'text-xs whitespace-nowrap shrink-0',
                                    getStatusColor(String(rawValue)),
                                  )}
                                >
                                  {String(rawValue)}
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
                              const text = asDisplayValue(rawValue) || '-'
                              cellContent =
                                colKey === 'contract_ext_no' || colKey === 'po_number' ? (
                                  <OperationalStackedCommaCell
                                    value={text === '-' ? '' : text}
                                    title={text}
                                  />
                                ) : (
                                  <OperationalNowrapCell
                                    value={text === '-' ? '' : text}
                                    title={text}
                                  />
                                )
                            } else if (col.type === 'number') {
                              cellContent = (
                                <NumberCell
                                  value={rawValue}
                                  isDeltaDays={
                                    String(key).includes('delta') || String(dataKey).includes('delta')
                                  }
                                  decimalPlaces={
                                    tableViewMode === 'by_vessel' &&
                                    (String(key).includes('delta') || String(dataKey).includes('delta'))
                                      ? 1
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
                                <span className="text-sm">{formatPortColumnDisplay(resolved)}</span>
                              )
                            } else {
                              const text = asDisplayValue(rawValue) || '-'
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
      </div>
  )
}
