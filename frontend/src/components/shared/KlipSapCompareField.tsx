'use client'

import { cn } from '@/lib/utils'
import {
  formatKlipSapDelta,
  formatKlipSapDisplayValue,
  hasKlipSapMismatch,
  hasKlipSapValue,
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
  /**
   * Leave unset. The badge is then derived from the comparison, which is the only thing that can
   * actually be known - see the note in the component body. Pass a boolean only where the caller
   * has a better source of truth than value equality.
   */
  showKlipBadge?: boolean
  /**
   * The data itself records a KLIP user writing this field (migration 167's klip_edited_fields).
   * When true it settles the question and the comparison is not consulted; false means only
   * "not recorded", which for older rows is the normal state and not evidence of anything.
   */
  klipEdited?: boolean
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
  showKlipBadge,
  klipEdited = false,
  hidden = false,
}: KlipSapCompareFieldProps) {
  if (hidden) return null

  const mismatch = hasKlipSapMismatch(klipValue, sapValue, format)
  const delta = formatKlipSapDelta(klipValue, sapValue, format)
  const sapDisplay = formatKlipSapDisplayValue(sapValue, format)

  /*
   * The KLIP chip used to be unconditional, which made it an assertion the data cannot support.
   *
   * Most KLIP-labelled columns are shared with the SAP import, which fills whatever the user left
   * empty; nothing records who wrote a value. So a field the user never opened displayed its SAP
   * value with a blue "KLIP" chip beside it, and there was no way to tell it apart from something
   * typed by hand.
   *
   * What IS knowable is whether the value still equals what SAP reported. Equal means SAP's number
   * is what you are looking at, whoever put it there; different means someone or something in KLIP
   * moved it. That is what the chips now say, and nothing more.
   */
  const klipHasValue = hasKlipSapValue(klipValue, format)
  const sapHasValue = hasKlipSapValue(sapValue, format)
  /*
   * Recorded provenance wins over the comparison. It answers the case equality cannot: a user who
   * typed the same number SAP reported looks SAP-sourced to an equality test, and for older rows
   * migration 130 copied effective values into the snapshot so they agree by construction.
   */
  const showKlip = showKlipBadge ?? (klipHasValue && (klipEdited || mismatch))
  const showSapSourced = !showKlip && klipHasValue && sapHasValue && !mismatch

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
          {showKlip ? (
            <span className="rounded-full bg-blue-50 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-blue-700">
              KLIP
            </span>
          ) : null}
          {showSapSourced ? (
            <span
              className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-gray-600"
              title="Sama dengan nilai SAP — bukan bukti diisi lewat KLIP"
            >
              SAP
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
