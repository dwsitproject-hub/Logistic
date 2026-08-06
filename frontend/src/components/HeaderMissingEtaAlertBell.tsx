'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Bell, Loader2 } from 'lucide-react'
import api from '@/lib/api'
import {
  cachedGet,
  MISSING_ETA_ALERT_CACHE_KEY,
  peekCache,
  subscribeMissingEtaAlertRefresh,
} from '@/lib/clientDataCache'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

export interface MissingEtaAlertUnit {
  unit_key: string
  contract_id: string
  contract_ext_no: string | null
  po_number: string | null
  sto_number: string | null
  operation_id: string | null
  supplier: string | null
  product: string | null
  incoterm: string | null
  transport_mode: string | null
  missing_leg: 'Shipment' | 'Trucking'
  cargo_readiness_date: string
  days_to_cargo_readiness: number
  group_plant: string
}

type AlertResponse = {
  total: number
  items: MissingEtaAlertUnit[]
  scopedAsStaff: boolean
  visible: boolean
}

const EMPTY_ALERT_RESPONSE: AlertResponse = {
  total: 0,
  items: [],
  scopedAsStaff: false,
  visible: true,
}

const MISSING_ETA_TOOLTIP =
  'Contracts or STOs with cargo readiness within 14 days but missing planning. Opens the alert list — scoped to your role and assignments.'

function normalizeAlertResponse(payload: AlertResponse | undefined): AlertResponse {
  if (!payload) return EMPTY_ALERT_RESPONSE
  return {
    total: Number(payload.total) || 0,
    items: Array.isArray(payload.items) ? payload.items : [],
    scopedAsStaff: Boolean(payload.scopedAsStaff),
    visible: payload.visible !== false,
  }
}

function formatDaysLabel(days: number): string {
  if (days < 0) {
    const n = Math.abs(days)
    return `Overdue by ${n} day${n === 1 ? '' : 's'}`
  }
  if (days === 0) return 'Due today'
  return `${days} day${days === 1 ? '' : 's'} left`
}

function daysTone(days: number): string {
  if (days < 0) return 'text-red-700'
  if (days <= 3) return 'text-amber-700'
  return 'text-gray-600'
}

function chipTone(total: number, items: MissingEtaAlertUnit[]): {
  border: string
  gradient: string
  hoverBorder: string
  hoverGradient: string
  iconBox: string
  icon: string
  label: string
  badge: string
  ring: string
} {
  const hasOverdue = items.some((i) => i.days_to_cargo_readiness < 0)
  const hasUrgent = items.some((i) => i.days_to_cargo_readiness <= 3)

  if (total === 0) {
    return {
      border: 'border-gray-200/90',
      gradient: 'from-gray-50 to-slate-50',
      hoverBorder: 'hover:border-gray-300',
      hoverGradient: 'hover:from-gray-100 hover:to-slate-100',
      iconBox: 'bg-gray-100 text-gray-600',
      icon: 'text-gray-500',
      label: 'text-gray-700',
      badge: 'bg-gray-500',
      ring: 'focus-visible:ring-gray-400',
    }
  }

  if (hasOverdue || hasUrgent) {
    return {
      border: 'border-red-200/90',
      gradient: 'from-red-50 to-rose-50',
      hoverBorder: 'hover:border-red-300',
      hoverGradient: 'hover:from-red-100 hover:to-rose-100',
      iconBox: 'bg-red-100 text-red-800',
      icon: 'text-red-700',
      label: 'text-red-950',
      badge: 'bg-red-600',
      ring: 'focus-visible:ring-red-400',
    }
  }

  return {
    border: 'border-rose-200/90',
    gradient: 'from-rose-50 to-red-50',
    hoverBorder: 'hover:border-rose-300',
    hoverGradient: 'hover:from-rose-100 hover:to-red-100',
    iconBox: 'bg-rose-100 text-rose-800',
    icon: 'text-rose-700',
    label: 'text-rose-950',
    badge: 'bg-rose-600',
    ring: 'focus-visible:ring-rose-400',
  }
}

function formatDateDisplay(iso: string): string {
  const d = (iso || '').slice(0, 10)
  if (d.length < 10) return iso || '-'
  const [y, m, dd] = d.split('-')
  return `${dd}/${m}/${y}`
}

export function HeaderMissingEtaAlertBell() {
  const cachedInitial = peekCache<AlertResponse>(MISSING_ETA_ALERT_CACHE_KEY)
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(!cachedInitial)
  const [data, setData] = useState<AlertResponse>(cachedInitial ?? EMPTY_ALERT_RESPONSE)
  const panelRef = useRef<HTMLDivElement>(null)

  const fetchAlertsFromApi = useCallback(async (): Promise<AlertResponse> => {
    const res = await api.get('/alerts/missing-eta-cargo-readiness')
    const payload = res.data?.data as AlertResponse | undefined
    return normalizeAlertResponse(payload)
  }, [])

  const loadAlerts = useCallback(
    async (options?: { force?: boolean }) => {
      try {
        const result = await cachedGet(
          MISSING_ETA_ALERT_CACHE_KEY,
          fetchAlertsFromApi,
          {
            force: options?.force,
            onRevalidate: (fresh) => setData(fresh),
          },
        )
        setData(result.data)
      } catch {
        // Keep last known count; bell stays non-blocking.
      } finally {
        setLoading(false)
      }
    },
    [fetchAlertsFromApi],
  )

  useEffect(() => {
    void loadAlerts()
    return subscribeMissingEtaAlertRefresh(() => {
      void loadAlerts({ force: true })
    })
  }, [loadAlerts])

  useEffect(() => {
    if (open) void loadAlerts()
  }, [open, loadAlerts])

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return
      void cachedGet(MISSING_ETA_ALERT_CACHE_KEY, fetchAlertsFromApi, {
        onRevalidate: (fresh) => setData(fresh),
      })
        .then(({ data: fresh }) => setData(fresh))
        .catch(() => {})
    }, 10 * 60 * 1000)
    return () => window.clearInterval(interval)
  }, [fetchAlertsFromApi])

  useEffect(() => {
    if (!open) return
    const onDocClick = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  if (!data.visible) return null

  const badgeLabel = data.total > 99 ? '99+' : String(data.total)
  const tone = chipTone(data.total, data.items)

  return (
    <div className="relative" ref={panelRef}>
      <Tooltip delayDuration={200}>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className={cn(
              'inline-flex min-h-9 items-center gap-2 rounded-lg border px-3 py-1.5 text-sm shadow-sm transition-all',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2',
              tone.border,
              tone.gradient,
              tone.hoverBorder,
              tone.hoverGradient,
              tone.ring,
              'bg-gradient-to-r',
            )}
            aria-label={`Missing Planning alerts: ${loading ? 'loading' : data.total}`}
            aria-expanded={open}
          >
            <span
              className={cn(
                'flex h-7 w-7 shrink-0 items-center justify-center rounded-md',
                tone.iconBox,
              )}
            >
              {loading ? (
                <Loader2 className={cn('h-4 w-4 animate-spin', tone.icon)} aria-hidden />
              ) : (
                <Bell className={cn('h-4 w-4', tone.icon)} aria-hidden />
              )}
            </span>
            <span className={cn('hidden font-medium sm:inline', tone.label)}>Missing Planning</span>
            <span
              className={cn(
                'inline-flex min-w-[1.5rem] items-center justify-center rounded-md px-1.5 py-0.5 text-xs font-bold tabular-nums text-white',
                tone.badge,
              )}
            >
              {loading ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : badgeLabel}
            </span>
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-xs whitespace-pre-wrap text-xs leading-relaxed">
          {MISSING_ETA_TOOLTIP}
        </TooltipContent>
      </Tooltip>

      {open && (
        <div className="absolute right-0 top-full z-[70] mt-2 w-[min(24rem,calc(100vw-2rem))] rounded-lg border border-gray-200 bg-white shadow-lg">
          <div className="border-b border-gray-100 px-4 py-3">
            <p className="text-sm font-semibold leading-snug text-gray-900">
              Missing Planning — Cargo Ready ≤ 14 Days
            </p>
            <p className="mt-0.5 text-xs leading-relaxed text-gray-500">
              {data.scopedAsStaff
                ? 'Scoped to your transport type, group plant, and product assignments.'
                : `${data.total} alert unit${data.total === 1 ? '' : 's'} in your role scope.`}
            </p>
          </div>

          <div className="max-h-80 overflow-y-auto">
            {data.items.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-gray-500">
                No contracts or STOs match this alert right now.
              </p>
            ) : (
              <ul className="divide-y divide-gray-100">
                {data.items.map((item) => {
                  const identity =
                    item.po_number ||
                    item.contract_ext_no ||
                    item.contract_id ||
                    '-'
                  const stoOrOp =
                    item.sto_number || item.operation_id
                      ? ` · ${item.sto_number || item.operation_id}`
                      : ''
                  return (
                    <li key={item.unit_key} className="px-4 py-3 text-sm">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate font-medium leading-snug text-gray-900">
                            PO {identity}
                            {stoOrOp}
                          </p>
                          <p className="truncate text-xs leading-relaxed text-gray-500">
                            {item.product || '-'} · {item.missing_leg} ·{' '}
                            {item.group_plant || '-'}
                          </p>
                          <p className="text-xs leading-relaxed text-gray-500">
                            Cargo ready {formatDateDisplay(item.cargo_readiness_date)}
                          </p>
                        </div>
                        <span
                          className={cn(
                            'shrink-0 text-xs font-semibold tabular-nums',
                            daysTone(item.days_to_cargo_readiness),
                          )}
                        >
                          {formatDaysLabel(item.days_to_cargo_readiness)}
                        </span>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          {data.total > data.items.length && (
            <p className="border-t border-gray-100 px-4 py-2 text-xs leading-relaxed text-gray-500">
              Showing {data.items.length} of {data.total} alert units.
            </p>
          )}

          <div className="flex flex-wrap gap-2 border-t border-gray-100 px-4 py-3">
            <Link
              href="/shipments"
              className="text-xs font-medium text-primary hover:underline"
              onClick={() => setOpen(false)}
            >
              Shipments
            </Link>
            <Link
              href="/trucking"
              className="text-xs font-medium text-primary hover:underline"
              onClick={() => setOpen(false)}
            >
              Trucking
            </Link>
            <Link
              href="/contracts"
              className="text-xs font-medium text-primary hover:underline"
              onClick={() => setOpen(false)}
            >
              Contracts
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
