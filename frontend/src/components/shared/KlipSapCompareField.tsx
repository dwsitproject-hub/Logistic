'use client'

import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import {
  formatKlipSapDelta,
  formatKlipSapDisplayValue,
  hasKlipSapMismatch,
  resolveKlipSapProvenance,
  shouldShowJpsReferenceFooter,
  shouldShowKlipSapFooter,
  type KlipSapCompareFormat,
  type KlipSapProvenance,
  type KlipSapRecordedSource,
} from '@/lib/klipSapCompare'
import { ModalReadonlyDateInput, ModalReadonlyTextInput } from '@/components/shared/ModalReadonlyControl'

/**
 * `showJps` is opt-in: a legend entry for a badge that can never appear on the page is noise, so
 * only blocks whose fields JPS can actually supply ask for it.
 */
export function KlipSapCompareLegend({
  className,
  showJps = false,
}: {
  className?: string
  showJps?: boolean
}) {
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
      {showJps ? (
        <span className="flex items-center gap-1">
          <span className="rounded-full bg-violet-100 px-2 py-0.5 font-medium text-violet-800">JPS</span>
          <span className="text-gray-500">dari Jetty Planning System</span>
        </span>
      ) : null}
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
  if (provenance === 'jps') {
    return (
      <span
        className="shrink-0 rounded-full bg-violet-50 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-violet-700"
        title="Dilaporkan oleh Jetty Planning System (JPS)"
      >
        JPS
      </span>
    )
  }
  return null
}

export function KlipSapReferenceFooter({
  sapValue,
  format,
  delta,
  source = 'sap',
}: {
  /** The reference value shown - SAP's by default, JPS's when `source` is 'jps'. */
  sapValue: unknown
  format: KlipSapCompareFormat
  delta?: string | null
  source?: 'sap' | 'jps'
}) {
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-gray-500">
      <KlipSapSourceBadge provenance={source} />
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
  /** What the Jetty Planning System reported for this field, when JPS covers it. */
  jpsValue?: unknown
  /** Who the data records as having written the value, when the backend knows. Beats inference. */
  source?: KlipSapRecordedSource | null
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
  jpsValue,
  source,
  hidden = false,
}: KlipSapCompareFieldProps) {
  if (hidden) return null

  const mismatch = hasKlipSapMismatch(klipValue, sapValue, format)
  const delta = formatKlipSapDelta(klipValue, sapValue, format)
  /*
   * showOverrideBadge means "differs from SAP" - and a JPS value differs from SAP too. Letting it
   * force KLIP would stamp every JPS date as a KLIP edit, so it only does when JPS cannot account
   * for the difference. A RECORDED KLIP edit (klipEdited) still wins either way.
   */
  const jpsExplainsDifference =
    jpsValue !== undefined &&
    resolveKlipSapProvenance({ klipValue, sapValue, format, jpsValue }) === 'jps'
  const provenance =
    showKlipBadge === true
      ? resolveKlipSapProvenance({
          klipValue,
          sapValue,
          format,
          klipEdited: true,
          source,
        })
      : resolveKlipSapProvenance({
          klipValue,
          sapValue,
          format,
          klipEdited: klipEdited || (showOverrideBadge && !jpsExplainsDifference),
          jpsValue,
          source,
        })
  const showFooter = shouldShowKlipSapFooter(provenance, sapValue, format)
  const showJpsFooter = shouldShowJpsReferenceFooter(provenance, klipValue, jpsValue, format)
  const jpsDelta = formatKlipSapDelta(klipValue, jpsValue, format)

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
      {showJpsFooter ? (
        <KlipSapReferenceFooter sapValue={jpsValue} format={format} delta={jpsDelta} source="jps" />
      ) : null}
    </div>
  )
}
