'use client'

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import api from '@/lib/api'

export type PermFlags = {
  canView: boolean
  canCreate: boolean
  canEdit: boolean
  canDelete: boolean
}

type PermissionsContextValue = {
  byKey: Record<string, PermFlags>
  loaded: boolean
  userRole?: string
}

const PermissionsContext = createContext<PermissionsContextValue>({
  byKey: {},
  loaded: false,
})

type PermissionsCache = {
  userId: string
  byKey: Record<string, PermFlags>
}

let permissionsCache: PermissionsCache | null = null

export function seedPermissionsCache(userId: string, byKey: Record<string, PermFlags>) {
  permissionsCache = { userId, byKey }
}

export function clearPermissionsCache() {
  permissionsCache = null
}

function readPermissionsCache(userId?: string): PermissionsCache | null {
  if (!userId || !permissionsCache || permissionsCache.userId !== userId) return null
  return permissionsCache
}

export function PermissionsProvider({
  children,
  userRole,
  userId,
}: {
  children: ReactNode
  userRole?: string
  userId?: string
}) {
  const cached = readPermissionsCache(userId)
  const [byKey, setByKey] = useState<Record<string, PermFlags>>(() => cached?.byKey ?? {})
  const [loaded, setLoaded] = useState(() => !!cached)

  useEffect(() => {
    let cancelled = false
    api
      .get('/roles/my-permissions')
      .then((res) => {
        if (cancelled) return
        const raw = (res.data?.data?.permissions ?? {}) as Record<string, Record<string, boolean | undefined>>
        const next: Record<string, PermFlags> = {}
        for (const [k, v] of Object.entries(raw)) {
          next[k] = {
            canView: !!v?.canView,
            canCreate: !!v?.canCreate,
            canEdit: !!v?.canEdit,
            canDelete: !!v?.canDelete,
          }
        }
        setByKey(next)
        if (userId) {
          permissionsCache = { userId, byKey: next }
        }
      })
      .catch(() => {
        if (!cancelled && !readPermissionsCache(userId)) setByKey({})
      })
      .finally(() => {
        if (!cancelled) setLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [userId])

  const value = useMemo(() => ({ byKey, loaded, userRole }), [byKey, loaded, userRole])
  return <PermissionsContext.Provider value={value}>{children}</PermissionsContext.Provider>
}

export function usePermissions() {
  return useContext(PermissionsContext)
}

export function isAdminRole(role?: string) {
  return role === 'ADMIN'
}

export function canViewPermission(ctx: PermissionsContextValue, key: string): boolean {
  if (!ctx.loaded) return false
  return !!ctx.byKey[key]?.canView
}

/**
 * null = permissions still loading.
 * Explicit deny: perf key present with canView false (e.g. LOGISTICS Staff scoped row).
 * Legacy fallback: perf key absent (pre-migration) → use operational page permission.
 */
export function canViewContractPerformancePage(ctx: PermissionsContextValue): boolean | null {
  if (!ctx.loaded) return null
  const perfKey = 'page.contract_performance'
  const legacyKey = 'page.contracts'
  if (ctx.byKey[perfKey]?.canView) return true
  if (perfKey in ctx.byKey) return false
  return !!ctx.byKey[legacyKey]?.canView
}

/** null = permissions still loading — see canViewContractPerformancePage */
export function canViewShippingPerformancePage(ctx: PermissionsContextValue): boolean | null {
  if (!ctx.loaded) return null
  const perfKey = 'page.shipping_performance'
  const legacyKey = 'page.shipments'
  if (ctx.byKey[perfKey]?.canView) return true
  if (perfKey in ctx.byKey) return false
  return !!ctx.byKey[legacyKey]?.canView
}

export function canCreatePermission(ctx: PermissionsContextValue, key: string): boolean {
  if (!ctx.loaded) return false
  return !!ctx.byKey[key]?.canCreate
}

export function canEditPermission(ctx: PermissionsContextValue, key: string): boolean {
  if (!ctx.loaded) return false
  return !!ctx.byKey[key]?.canEdit
}

export function canDeletePermission(ctx: PermissionsContextValue, key: string): boolean {
  if (!ctx.loaded) return false
  return !!ctx.byKey[key]?.canDelete
}
