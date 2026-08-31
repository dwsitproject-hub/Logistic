'use client'

import { useCallback, useEffect, useState } from 'react'
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
  }
}
