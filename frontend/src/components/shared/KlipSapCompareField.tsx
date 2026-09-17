'use client'

import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import {
  formatKlipSapDelta,
  formatKlipSapDisplayValue,
  hasKlipSapMismatch,
  resolveKlipSapProvenance,
  shouldShowKlipSapFooter,
  type KlipSapCompareFormat,
  type KlipSapProvenance,
} from '@/lib/klipSapCompare'
import { ModalReadonlyDateInput, ModalReadonlyTextInput } from '@/components/shared/ModalReadonlyControl'

export function KlipSapCompareLegend({ className }: { className?: string }) {
  return (
    <div className={cn('flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px]', className)}>
      <span className="flex items-center gap-1">
        <span className="rounded-full bg-blue-100 px-2 py-0.5 font-medium text-blue-800">KLIP</span>
        <span className="text-gray-500">diubah lewat KLIP</span>
      </span>
      <span className="flex items-center gap-1">
        <span className="rounded-full bg-gray-100 px-2 py-0.5 font-medium text-gray-600">SAP</span>
        <span className="text-gray-500">sama dengan data SAP</span>
      </span>
    </div>
  )
}

export function KlipSapSourceBadge({
  provenance,
  klipEditedBy = null,
}: {
  provenance: KlipSapProvenance
  klipEditedBy?: string | null
}) {
  if (provenance === 'klip') {
    return (
      <span
        className="shrink-0 rounded-full bg-blue-50 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-blue-700"
        title={klipEditedBy ? `Diubah oleh ${klipEditedBy}` : undefined}
      >
        KLIP
      </span>
    )
  }
  if (provenance === 'sap') {
    return (
      <span
        className="shrink-0 rounded-full bg-gray-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-gray-600"
        title="Sama dengan nilai SAP"
      >
        SAP
      </span>
    )
  }
  return null
}

export function KlipSapReferenceFooter({
  sapValue,
  format,
  delta,
}: {
  sapValue: unknown
  format: KlipSapCompareFormat
  delta?: string | null
}) {
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-gray-500">
      <KlipSapSourceBadge provenance="sap" />
      <span>{formatKlipSapDisplayValue(sapValue, format)}</span>
      {delta ? (
        <span className="rounded bg-amber-100 px-1.5 py-0.5 font-medium text-amber-800">
          Δ {delta}
        </span>
      ) : null}
    </div>
  )
}

export function KlipSapValueWithBadge({
  children,
  provenance,
  klipEditedBy = null,
}: {
  children: ReactNode
  provenance: KlipSapProvenance
  klipEditedBy?: string | null
}) {
  return (
    <div className="flex items-center gap-1.5">
      <div className="min-w-0 flex-1">{children}</div>
      <KlipSapSourceBadge provenance={provenance} klipEditedBy={klipEditedBy} />
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
  editControl?: ReactNode
  showOverrideBadge?: boolean
  /**
   * Force a KLIP chip when the caller has a stronger source of truth than value equality.
   * Leave unset to derive provenance from mismatch / recorded edit / SAP match.
   */
  showKlipBadge?: boolean
  /**
   * The data itself records a KLIP user writing this field (migration 167's klip_edited_fields).
   */
  klipEdited?: boolean
  /** "Budi, 12 Sep 2026" — shown on the KLIP chip's tooltip when audit_logs has the edit. */
  klipEditedBy?: string | null
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
  klipEditedBy = null,
  hidden = false,
}: KlipSapCompareFieldProps) {
  if (hidden) return null

  const mismatch = hasKlipSapMismatch(klipValue, sapValue, format)
  const delta = formatKlipSapDelta(klipValue, sapValue, format)
  const provenance =
    showKlipBadge === true
      ? resolveKlipSapProvenance({
          klipValue,
          sapValue,
          format,
          klipEdited: true,
        })
      : resolveKlipSapProvenance({
          klipValue,
          sapValue,
          format,
          klipEdited: klipEdited || showOverrideBadge,
        })
  const showFooter = shouldShowKlipSapFooter(provenance, sapValue, format)

  const labelClass = compact
    ? 'mb-1 block text-[10px] font-medium text-gray-600'
    : 'mb-1 block text-xs font-medium text-gray-600'

  const control =
    editing && editControl ? (
      editControl
    ) : format === 'date' ? (
      <ModalReadonlyDateInput
        valueIso={String(klipValue ?? '').trim().slice(0, 10)}
        compact={compact}
      />
    ) : (
      <ModalReadonlyTextInput
        value={formatKlipSapDisplayValue(klipValue, format)}
        compact={compact}
        className={format === 'number' ? 'text-right tabular-nums' : undefined}
      />
    )

  return (
    <div
      className={cn(
        mismatch && 'border-l-2 border-amber-400 pl-2',
      )}
    >
      <label className={labelClass}>{label}</label>
      <KlipSapValueWithBadge provenance={provenance} klipEditedBy={klipEditedBy}>
        {control}
      </KlipSapValueWithBadge>
      {showFooter ? (
        <KlipSapReferenceFooter sapValue={sapValue} format={format} delta={delta} />
      ) : null}
    </div>
  )
}
