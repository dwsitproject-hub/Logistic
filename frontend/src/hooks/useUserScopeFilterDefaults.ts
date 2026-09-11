'use client'

import { useCallback, useEffect, useState } from 'react'
import { alignSelectedToRegionSiteOptions } from '@/lib/globalScopeFilters'
import {
  getInitialUserScopeFilters,
  markUserScopeFiltersCleared,
  syncAuthUserScopeFromProfile,
  wereUserScopeFiltersCleared,
  type UserScopePage,
} from '@/lib/userScopeFilters'

export type UserScopeFilterDefaultsOptions = {
  /** Map auth product labels onto page-specific multi-select options (e.g. Shell Palm). */
  mapProducts?: (products: string[]) => string[]
}

function readInitialScopeFilters(
  page: UserScopePage,
  mapProducts?: (products: string[]) => string[],
): { products: string[]; groupPlants: string[] } {
  if (typeof window === 'undefined') return { products: [], groupPlants: [] }
  if (wereUserScopeFiltersCleared(page)) return { products: [], groupPlants: [] }
  const initial = getInitialUserScopeFilters()
  return {
    products: mapProducts ? mapProducts(initial.products) : initial.products,
    groupPlants: initial.groupPlants,
  }
}

export function useUserScopeFilterDefaults(
  page: UserScopePage,
  options?: UserScopeFilterDefaultsOptions,
) {
  const mapProducts = options?.mapProducts
  const [selectedProducts, setSelectedProducts] = useState<string[]>(
    () => readInitialScopeFilters(page, mapProducts).products,
  )
  const [selectedGroupPlants, setSelectedGroupPlants] = useState<string[]>(
    () => readInitialScopeFilters(page, mapProducts).groupPlants,
  )
  /** False until profile sync finishes and default Staff filters are applied. */
  const [userScopeReady, setUserScopeReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      await syncAuthUserScopeFromProfile()
      if (cancelled) return

      if (!wereUserScopeFiltersCleared(page)) {
        const { products, groupPlants } = getInitialUserScopeFilters()
        setSelectedProducts(mapProducts ? mapProducts(products) : products)
        setSelectedGroupPlants(groupPlants)
      }

      if (!cancelled) setUserScopeReady(true)
    })()

    return () => {
      cancelled = true
    }
  }, [page, mapProducts])

  /**
   * Re-spell the scoped Region/Plant values as the dropdown spells them.
   *
   * The two come from different places and disagree on case: the user's scope is stored against
   * `master_plants` and arrives as `Bontang`, while the options are DISTINCT SAP Discharge
   * Destination and arrive as `BONTANG`. `SearchableMultiSelect` matches with
   * `selected.includes(option)`, so the box read "1 selected (OR)" - the state did hold one
   * value - with nothing ticked.
   *
   * Fixing only the display would have made it worse: the toggle removes by
   * `selected.filter((s) => s !== value)`, so a box ticked by a looser comparison could never be
   * unticked. The stored value has to become the option string, which is what this does.
   *
   * The request was always correct - the backend matches `UPPER(...) IN (UPPER($n))` - so this
   * changes what the filter *shows*, never what it returns. Call it when the options arrive;
   * it returns the same array reference when nothing needs changing, so it will not re-render.
   */
  const alignGroupPlantsToOptions = useCallback((options: string[]) => {
    if (!Array.isArray(options) || options.length === 0) return
    setSelectedGroupPlants((current) => {
      if (current.length === 0) return current
      const aligned = alignSelectedToRegionSiteOptions(current, options)
      const unchanged =
        aligned.length === current.length && aligned.every((value, i) => value === current[i])
      return unchanged ? current : aligned
    })
  }, [])

  const resetUserScopeFilters = useCallback(() => {
    setSelectedProducts([])
    setSelectedGroupPlants([])
  }, [])

  const noteScopeFiltersClearedIfEmpty = useCallback(
    (products: string[], groupPlants: string[]) => {
      if (products.length === 0 && groupPlants.length === 0) {
        markUserScopeFiltersCleared(page)
      }
    },
    [page],
  )

  const handleProductsChange = useCallback(
    (next: string[]) => {
      setSelectedProducts(next)
      setSelectedGroupPlants((currentGroupPlants) => {
        noteScopeFiltersClearedIfEmpty(next, currentGroupPlants)
        return currentGroupPlants
      })
    },
    [noteScopeFiltersClearedIfEmpty],
  )

  const handleGroupPlantsChange = useCallback(
    (next: string[]) => {
      setSelectedGroupPlants(next)
      setSelectedProducts((currentProducts) => {
        noteScopeFiltersClearedIfEmpty(currentProducts, next)
        return currentProducts
      })
    },
    [noteScopeFiltersClearedIfEmpty],
  )

  return {
    selectedProducts,
    setSelectedProducts,
    selectedGroupPlants,
    setSelectedGroupPlants,
    handleProductsChange,
    handleGroupPlantsChange,
    userScopeReady,
    resetUserScopeFilters,
    alignGroupPlantsToOptions,
  }
}
