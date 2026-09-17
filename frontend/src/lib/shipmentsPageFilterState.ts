/**
 * Shipments page — consolidated global filter scope (Section 1 toolbar).
 * Pipeline stage (Section 2 card) is a list-only modifier layered on top.
 */

import type { ShipmentPagePipelineStage } from '@/lib/shipmentPagePipeline'

/** Global Filters Open/Close buckets plus granular Section 2 pipeline stages. */
export type ShipmentsPipelineStageFilter = ShipmentPagePipelineStage | 'ALL' | 'OPEN' | 'CLOSE'

export const SHIPMENT_GLOBAL_STATUS_OPTIONS = [
  { value: 'ALL', label: 'All Status' },
  { value: 'OPEN', label: 'Open' },
  { value: 'CLOSE', label: 'Close' },
] as const

const SHIPMENT_OPEN_STAGES = new Set<string>([
  'UNPLANNED',
  'PREPLANNED',
  'PLANNED',
  'AT_LOADING_PORT',
  'SAILED',
  'AT_DISCHARGE_PORT',
  'OPEN',
])

const SHIPMENT_CLOSE_STAGES = new Set<string>(['COMPLETED', 'CANCELLED', 'CLOSE'])

/** Map granular card stage → Global Filters display bucket. */
export function mapShipmentPipelineStageToGlobalStatusBucket(
  stage: string,
): 'ALL' | 'OPEN' | 'CLOSE' {
  const v = String(stage ?? '')
    .trim()
    .toUpperCase()
  if (!v || v === 'ALL') return 'ALL'
  if (v === 'OPEN' || v === 'CLOSE') return v
  if (SHIPMENT_CLOSE_STAGES.has(v)) return 'CLOSE'
  if (SHIPMENT_OPEN_STAGES.has(v)) return 'OPEN'
  return 'ALL'
}

export interface ShipmentsGlobalFilterScope {
  dateFrom: string
  dateTo: string
  searchTerm: string
  selectedIncoterms: readonly string[]
  selectedProducts: readonly string[]
  selectedGroupPlants: readonly string[]
  lateIndicatorFilter: string
  charterTypeFilter: string
  sourceTypeFilter: string
  viewOption: string
  viewFilterValue: string
  columnFiltersJson: string
  urlDelayed: boolean
  urlSto: string | null
  urlContract: string | null
}

export interface ShipmentsListQueryScope extends ShipmentsGlobalFilterScope {
  pipelineStage: ShipmentsPipelineStageFilter
  page: number
  sortKey: string
  sortDir: string
}

function sortedKey(values: readonly string[]): string {
  return [...values].map(String).sort().join('\u001f')
}

/** Stable key for toolbar/global scope — drives summary + list base fetch. */
export function buildShipmentsGlobalScopeKey(scope: ShipmentsGlobalFilterScope): string {
  return JSON.stringify({
    df: scope.dateFrom,
    dt: scope.dateTo,
    q: scope.searchTerm.trim(),
    inc: sortedKey(scope.selectedIncoterms),
    prod: sortedKey(scope.selectedProducts),
    plant: sortedKey(scope.selectedGroupPlants),
    late: scope.lateIndicatorFilter,
    charter: scope.charterTypeFilter,
    source: scope.sourceTypeFilter,
    vo: scope.viewOption,
    vq: scope.viewFilterValue.trim(),
    cf: scope.columnFiltersJson,
    delayed: scope.urlDelayed,
    sto: scope.urlSto ?? '',
    contract: scope.urlContract ?? '',
  })
}

/** Full list fetch key = global scope + pipeline stage + pagination + server sort. */
export function buildShipmentsListQueryKey(scope: ShipmentsListQueryScope): string {
  return `${buildShipmentsGlobalScopeKey(scope)}|st:${scope.pipelineStage}|p:${scope.page}|sk:${scope.sortKey}|sd:${scope.sortDir}`
}

export function normalizePipelineStageFilter(value: string): ShipmentsPipelineStageFilter {
  const v = String(value ?? '').trim().toUpperCase()
  if (!v || v === 'ALL') return 'ALL'
  if (v === 'OPEN' || v === 'CLOSE') return v
  return v as ShipmentsPipelineStageFilter
}

export function togglePipelineStageFilter(
  current: ShipmentsPipelineStageFilter,
  stage: ShipmentPagePipelineStage,
): ShipmentsPipelineStageFilter {
  return current === stage ? 'ALL' : stage
}
