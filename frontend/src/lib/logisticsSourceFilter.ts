import { CONTRACT_PERF_SOURCE_MULTI_OPTIONS } from '@/lib/contractPerformanceFilters'

export const LOGISTICS_SOURCE_FILTER_ALL = 'ALL' as const

/** Single-select Source options for Shipments / Trucking Global Filters. */
export const LOGISTICS_SOURCE_FILTER_OPTIONS = [
  { value: LOGISTICS_SOURCE_FILTER_ALL, label: 'All Source' },
  ...CONTRACT_PERF_SOURCE_MULTI_OPTIONS.map((value) => ({ value, label: value })),
] as const

export type LogisticsSourceFilter =
  | typeof LOGISTICS_SOURCE_FILTER_ALL
  | (typeof CONTRACT_PERF_SOURCE_MULTI_OPTIONS)[number]

export function normalizeLogisticsSourceFilter(value: string | undefined | null): LogisticsSourceFilter {
  const v = String(value ?? '').trim()
  if (!v || v.toUpperCase() === 'ALL' || v === 'All') return LOGISTICS_SOURCE_FILTER_ALL
  if ((CONTRACT_PERF_SOURCE_MULTI_OPTIONS as readonly string[]).includes(v)) {
    return v as LogisticsSourceFilter
  }
  return LOGISTICS_SOURCE_FILTER_ALL
}

/** True when a sourceType query param should be sent. */
export function isActiveLogisticsSourceFilter(value: string | undefined | null): boolean {
  return normalizeLogisticsSourceFilter(value) !== LOGISTICS_SOURCE_FILTER_ALL
}
