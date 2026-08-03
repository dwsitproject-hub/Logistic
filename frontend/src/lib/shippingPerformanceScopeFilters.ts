/**
 * Shipping Performance — Source / Product multi-select scope (client-side only).
 * Does not change API URL, cache key, or refetch behaviour.
 */

import {
  matchesContractPerfProductMultiFilter,
  matchesContractPerfSourceMultiFilter,
} from '@/lib/contractPerformanceFilters'

export type ShippingPerfScopeRow = {
  source_type?: string | null
  product?: string | null
}

export function applyShippingPerfSourceProductFilter<T extends ShippingPerfScopeRow>(
  rows: T[],
  selectedSources: readonly string[],
  selectedProducts: readonly string[],
): T[] {
  if (selectedSources.length === 0 && selectedProducts.length === 0) return rows
  return rows.filter(
    (row) =>
      matchesContractPerfSourceMultiFilter(row.source_type, selectedSources) &&
      matchesContractPerfProductMultiFilter(row.product, selectedProducts),
  )
}
