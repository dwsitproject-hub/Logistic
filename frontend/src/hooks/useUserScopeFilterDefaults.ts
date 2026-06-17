'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  getInitialUserScopeFilters,
  markUserScopeFiltersCleared,
  syncAuthUserScopeFromProfile,
  wereUserScopeFiltersCleared,
  type UserScopePage,
} from '@/lib/userScopeFilters'

function readInitialScopeFilters(page: UserScopePage): { products: string[]; groupPlants: string[] } {
  if (typeof window === 'undefined') return { products: [], groupPlants: [] }
  if (wereUserScopeFiltersCleared(page)) return { products: [], groupPlants: [] }
  return getInitialUserScopeFilters()
}

export function useUserScopeFilterDefaults(page: UserScopePage) {
  const [selectedProducts, setSelectedProducts] = useState<string[]>(
    () => readInitialScopeFilters(page).products,
  )
  const [selectedGroupPlants, setSelectedGroupPlants] = useState<string[]>(
    () => readInitialScopeFilters(page).groupPlants,
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
        setSelectedProducts(products)
        setSelectedGroupPlants(groupPlants)
      }

      if (!cancelled) setUserScopeReady(true)
    })()

    return () => {
      cancelled = true
    }
  }, [page])

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
