/**
 * Shipping Performance — Source / Product pill scope (client-side only).
 * Does not change API URL, cache key, or refetch behaviour.
 */

import {
  contractPerfProductQueryValue,
  matchesContractPerfProductTabFilter,
  matchesContractPerfSourceFilter,
  type ContractPerfProductTab,
  type ContractPerfSourceFilter,
} from '@/lib/contractPerformanceFilters'

export type ShippingPerfScopeRow = {
  source_type?: string | null
  product?: string | null
}

export function applyShippingPerfSourceProductFilter<T extends ShippingPerfScopeRow>(
  rows: T[],
  sourceFilter: ContractPerfSourceFilter,
  productTab: ContractPerfProductTab,
): T[] {
  const productQuery = contractPerfProductQueryValue(productTab)
  if (sourceFilter === 'All' && !productQuery) return rows
  return rows.filter(
    (row) =>
      matchesContractPerfSourceFilter(row.source_type, sourceFilter) &&
      matchesContractPerfProductTabFilter(row.product, productQuery),
  )
}
