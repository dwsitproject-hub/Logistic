'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  getInitialUserScopeFilters,
  markUserScopeFiltersCleared,
  syncAuthUserScopeFromProfile,
  wereUserScopeFiltersCleared,
  type UserScopePage,
} from '@/lib/userScopeFilters'

export function useUserScopeFilterDefaults(page: UserScopePage) {
  const [selectedProducts, setSelectedProducts] = useState<string[]>([])
  const [selectedGroupPlants, setSelectedGroupPlants] = useState<string[]>([])
  const [userScopeReady, setUserScopeReady] = useState(false)
  const initializedRef = useRef(false)

  useEffect(() => {
    if (initializedRef.current) return
    initializedRef.current = true

    let cancelled = false
    ;(async () => {
      await syncAuthUserScopeFromProfile()
      if (cancelled) return

      if (!wereUserScopeFiltersCleared(page)) {
        const { products, groupPlants } = getInitialUserScopeFilters()
        if (products.length > 0) setSelectedProducts(products)
        if (groupPlants.length > 0) setSelectedGroupPlants(groupPlants)
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
