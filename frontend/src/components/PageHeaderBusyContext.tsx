'use client'

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

type PageHeaderBusyContextValue = {
  busy: boolean
  setBusy: (value: boolean) => void
}

const PageHeaderBusyContext = createContext<PageHeaderBusyContextValue | null>(null)

export function PageHeaderBusyProvider({ children }: { children: ReactNode }) {
  const [busy, setBusy] = useState(false)
  const value = useMemo(() => ({ busy, setBusy }), [busy])
  return <PageHeaderBusyContext.Provider value={value}>{children}</PageHeaderBusyContext.Provider>
}

export function usePageHeaderBusyState(): PageHeaderBusyContextValue {
  const ctx = useContext(PageHeaderBusyContext)
  return ctx ?? { busy: false, setBusy: () => {} }
}

/** Pages call this so the Layout header shows a spinner next to the title. */
export function usePageHeaderBusy(busy: boolean) {
  const ctx = useContext(PageHeaderBusyContext)
  useEffect(() => {
    if (!ctx) return
    ctx.setBusy(busy)
    return () => ctx.setBusy(false)
  }, [busy, ctx])
}
