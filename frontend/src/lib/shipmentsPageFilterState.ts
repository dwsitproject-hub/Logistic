/**
 * Shipments page — consolidated global filter scope (Section 1 toolbar).
 * Pipeline stage (Section 2 card) is a list-only modifier layered on top.
 */

import type { ShipmentPagePipelineStage } from '@/lib/shipmentPagePipeline'

export type ShipmentsPipelineStageFilter = ShipmentPagePipelineStage | 'ALL'

export interface ShipmentsGlobalFilterScope {
  dateFrom: string
  dateTo: string
  searchTerm: string
  selectedIncoterms: readonly string[]
  selectedProducts: readonly string[]
  selectedGroupPlants: readonly string[]
  lateIndicatorFilter: string
  charterTypeFilter: string
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
    vo: scope.viewOption,
    vq: scope.viewFilterValue.trim(),
    cf: scope.columnFiltersJson,
    delayed: scope.urlDelayed,
    sto: scope.urlSto ?? '',
    contract: scope.urlContract ?? '',
  })
}

/** Full list fetch key = global scope + pipeline stage modifier + pagination. Sort is client-side only. */
export function buildShipmentsListQueryKey(scope: ShipmentsListQueryScope): string {
  return `${buildShipmentsGlobalScopeKey(scope)}|st:${scope.pipelineStage}|p:${scope.page}`
}

export function normalizePipelineStageFilter(value: string): ShipmentsPipelineStageFilter {
  const v = String(value ?? '').trim().toUpperCase()
  if (!v || v === 'ALL') return 'ALL'
  return v as ShipmentsPipelineStageFilter
}

export function togglePipelineStageFilter(
  current: ShipmentsPipelineStageFilter,
  stage: ShipmentPagePipelineStage,
): ShipmentsPipelineStageFilter {
  return current === stage ? 'ALL' : stage
}
