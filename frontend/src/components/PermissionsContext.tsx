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

export function PermissionsProvider({
  children,
  userRole,
}: {
  children: ReactNode
  userRole?: string
}) {
  const [byKey, setByKey] = useState<Record<string, PermFlags>>({})
  const [loaded, setLoaded] = useState(false)

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
      })
      .catch(() => {
        if (!cancelled) setByKey({})
      })
      .finally(() => {
        if (!cancelled) setLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

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
  if (isAdminRole(ctx.userRole)) return true
  if (!ctx.loaded) return false
  return !!ctx.byKey[key]?.canView
}

/** null = permissions still loading */
export function canViewContractPerformancePage(ctx: PermissionsContextValue): boolean | null {
  if (isAdminRole(ctx.userRole)) return true
  if (!ctx.loaded) return null
  const perf = ctx.byKey['page.contract_performance']
  if (perf?.canView) return true
  if (perf) return false
  return !!ctx.byKey['page.contracts']?.canView
}

/** null = permissions still loading */
export function canViewShippingPerformancePage(ctx: PermissionsContextValue): boolean | null {
  if (isAdminRole(ctx.userRole)) return true
  if (!ctx.loaded) return null
  const perf = ctx.byKey['page.shipping_performance']
  if (perf?.canView) return true
  if (perf) return false
  return !!ctx.byKey['page.shipments']?.canView
}

export function canCreatePermission(ctx: PermissionsContextValue, key: string): boolean {
  if (isAdminRole(ctx.userRole)) return true
  if (!ctx.loaded) return false
  return !!ctx.byKey[key]?.canCreate
}

export function canEditPermission(ctx: PermissionsContextValue, key: string): boolean {
  if (isAdminRole(ctx.userRole)) return true
  if (!ctx.loaded) return false
  return !!ctx.byKey[key]?.canEdit
}

export function canDeletePermission(ctx: PermissionsContextValue, key: string): boolean {
  if (isAdminRole(ctx.userRole)) return true
  if (!ctx.loaded) return false
  return !!ctx.byKey[key]?.canDelete
}
