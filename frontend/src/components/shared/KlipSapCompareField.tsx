'use client'

import { cn } from '@/lib/utils'
import {
  formatKlipSapDelta,
  formatKlipSapDisplayValue,
  hasKlipSapMismatch,
  type KlipSapCompareFormat,
} from '@/lib/klipSapCompare'

const KLIP_VALUE_CLASS = 'text-sm font-medium text-gray-900 tabular-nums'

export function KlipSapCompareLegend({ className }: { className?: string }) {
  return (
    <div className={cn('flex items-center gap-2 text-[10px]', className)}>
      <span className="rounded-full bg-blue-100 px-2 py-0.5 font-medium text-blue-800">KLIP</span>
      <span className="rounded-full bg-gray-100 px-2 py-0.5 font-medium text-gray-600">SAP</span>
    </div>
  )
}

type KlipSapCompareFieldProps = {
  label: string
  klipValue: unknown
  sapValue: unknown
  format: KlipSapCompareFormat
  compact?: boolean
  editing?: boolean
  editControl?: React.ReactNode
  showOverrideBadge?: boolean
  /** When false, hide the always-on KLIP chip (use for fields where chip only means override). */
  showKlipBadge?: boolean
  hidden?: boolean
}

export function KlipSapCompareField({
  label,
  klipValue,
  sapValue,
  format,
  compact = false,
  editing = false,
  editControl,
  showOverrideBadge = false,
  showKlipBadge = true,
  hidden = false,
}: KlipSapCompareFieldProps) {
  if (hidden) return null

  const mismatch = hasKlipSapMismatch(klipValue, sapValue, format)
  const delta = formatKlipSapDelta(klipValue, sapValue, format)
  const sapDisplay = formatKlipSapDisplayValue(sapValue, format)

  const labelClass = compact
    ? 'mb-1 block text-[10px] font-medium text-gray-600'
    : 'mb-1 block text-xs font-medium text-gray-600'

  return (
    <div
      className={cn(
        mismatch && 'border-l-2 border-amber-400 pl-2',
      )}
    >
      <label className={labelClass}>{label}</label>
      {editing && editControl ? (
        editControl
      ) : (
        <div className={cn('flex min-h-8 items-center gap-2', KLIP_VALUE_CLASS)}>
          <span>{formatKlipSapDisplayValue(klipValue, format)}</span>
          {showKlipBadge ? (
            <span className="rounded-full bg-blue-50 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-blue-700">
              KLIP
            </span>
          ) : null}
          {showOverrideBadge ? (
            <span className="text-[10px] font-medium text-emerald-600">(KLIP override)</span>
          ) : null}
        </div>
      )}
      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-gray-500">
        <span>SAP {sapDisplay}</span>
        {delta ? (
          <span className="rounded bg-amber-100 px-1.5 py-0.5 font-medium text-amber-800">
            Δ {delta}
          </span>
        ) : null}
      </div>
    </div>
  )
}
