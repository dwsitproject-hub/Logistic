'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { CalendarDays, ChevronDown } from 'lucide-react'
import { DateInputDdMmYyyy } from '@/components/DateInputDdMmYyyy'
import { formatDateDMY } from '@/lib/dateFormat'

export type PerformanceContractDateOption<T extends string = string> = {
  value: T
  label: string
}

export type PerformancePeriodRange = {
  dateFrom: string
  dateTo: string
  label: string
}

export function periodRangeMatchesDates(
  resolved: Pick<PerformancePeriodRange, 'dateFrom' | 'dateTo'>,
  dateFrom: string,
  dateTo: string,
): boolean {
  return resolved.dateFrom === dateFrom && resolved.dateTo === dateTo
}

/** Scope / chip label: preset name when dates match period; otherwise date range. */
export function formatContractDateScopeLabel(
  period: string,
  dateFrom: string,
  dateTo: string,
  resolvePeriodRange: (period: string) => PerformancePeriodRange,
  opts?: { prefix?: boolean },
): string {
  const resolved = resolvePeriodRange(period)
  const withPrefix = opts?.prefix === true
  if (periodRangeMatchesDates(resolved, dateFrom, dateTo)) {
    return withPrefix ? `Contract date: ${resolved.label}` : resolved.label
  }
  const range = `${dateFrom || '…'} to ${dateTo || '…'}`
  return withPrefix ? `Contract date: ${range}` : range
}

function formatTriggerSummary(
  period: string,
  dateFrom: string,
  dateTo: string,
  resolvePeriodRange: (period: string) => PerformancePeriodRange,
): string {
  const resolved = resolvePeriodRange(period)
  if (periodRangeMatchesDates(resolved, dateFrom, dateTo)) {
    return resolved.label
  }
  const from = dateFrom ? formatDateDMY(dateFrom) : '…'
  const to = dateTo ? formatDateDMY(dateTo) : '…'
  return `${from} – ${to}`
}

export type PerformanceContractDateControlProps<T extends string = string> = {
  period: T
  options: readonly PerformanceContractDateOption<T>[]
  dateFrom: string
  dateTo: string
  onPeriodChange: (value: T) => void
  onDateFromChange: (value: string) => void
  onDateToChange: (value: string) => void
  resolvePeriodRange: (period: T) => PerformancePeriodRange
  trailingAction?: ReactNode
  dateLabel?: string
  className?: string
}

/**
 * Compact Contract Date control: trigger shows active preset or custom range;
 * popover holds period presets + editable from/to.
 */
export function PerformanceContractDateControl<T extends string>({
  period,
  options,
  dateFrom,
  dateTo,
  onPeriodChange,
  onDateFromChange,
  onDateToChange,
  resolvePeriodRange,
  trailingAction,
  dateLabel = 'Contract Date',
  className,
}: PerformanceContractDateControlProps<T>) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const resolved = resolvePeriodRange(period)
  const presetActive = periodRangeMatchesDates(resolved, dateFrom, dateTo)
  const summary = formatTriggerSummary(period, dateFrom, dateTo, (p) =>
    resolvePeriodRange(p as T),
  )

  useEffect(() => {
    if (!open) return
    const onMouseDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div className={`flex items-end gap-3 flex-wrap ${className ?? ''}`.trim()}>
      <div className="min-w-0">
        <label className="text-sm font-medium text-gray-700 mb-1 block">{dateLabel}</label>
        <div ref={containerRef} className="relative">
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-haspopup="dialog"
            className="flex h-10 min-w-[11rem] max-w-[18rem] items-center justify-between gap-2 rounded-md border border-gray-300 bg-white px-3 py-2 text-left text-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1"
          >
            <span className="flex min-w-0 items-center gap-2">
              <CalendarDays className="h-4 w-4 shrink-0 text-gray-500" aria-hidden />
              <span className="truncate text-gray-900">{summary}</span>
            </span>
            <ChevronDown
              className={`h-4 w-4 shrink-0 text-gray-500 transition-transform ${open ? 'rotate-180' : ''}`}
              aria-hidden
            />
          </button>
          {open ? (
            <div
              role="dialog"
              aria-label="Contract date presets and range"
              className="absolute left-0 z-50 mt-1 w-[22rem] max-w-[calc(100vw-2rem)] rounded-md border border-gray-200 bg-white p-3 shadow-lg"
            >
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                Presets
              </div>
              <div className="mb-3 flex flex-wrap gap-1.5" role="group" aria-label="Period presets">
                {options.map((opt) => {
                  const active = presetActive && opt.value === period
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => {
                        onPeriodChange(opt.value)
                        setOpen(false)
                      }}
                      className={
                        active
                          ? 'rounded-md bg-slate-800 px-2.5 py-1 text-sm font-medium text-white'
                          : 'rounded-md border border-gray-200 bg-white px-2.5 py-1 text-sm font-medium text-slate-700 hover:bg-slate-100'
                      }
                    >
                      {opt.label}
                    </button>
                  )
                })}
              </div>
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                Custom range
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <DateInputDdMmYyyy
                  valueIso={dateFrom}
                  onChangeIso={onDateFromChange}
                  className="w-[9.5rem]"
                />
                <span className="text-gray-500 text-sm">to</span>
                <DateInputDdMmYyyy
                  valueIso={dateTo}
                  onChangeIso={onDateToChange}
                  className="w-[9.5rem]"
                />
              </div>
            </div>
          ) : null}
        </div>
      </div>
      {trailingAction}
    </div>
  )
}
