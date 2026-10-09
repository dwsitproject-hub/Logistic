import type { ReactNode } from 'react'

export type MasterCodeKind = 'klip' | 'dhm' | 'sap' | 'pair'

const TONE: Record<MasterCodeKind, string> = {
  dhm: 'border-red-200 bg-red-50 text-red-600',
  klip: 'border-blue-200 bg-blue-50 text-blue-700',
  sap: 'border-slate-200 bg-slate-100 text-slate-500',
  pair: 'border-green-200 bg-green-50 text-green-700',
}

/** One-line code chip. DHM red, KLIP blue, SAP gray, tug/barge pair green. Empty stays a plain dash. */
export function MasterCodeBadge({
  kind,
  value,
  fit,
}: {
  kind: MasterCodeKind
  value: string
  /** Keep the full code visible. Used when the column width follows the value. */
  fit?: boolean
}): ReactNode {
  const text = String(value ?? '').trim()
  if (!text || text === '-') return <span className="text-sm text-slate-400">-</span>
  return (
    <span
      title={text}
      className={`inline-block whitespace-nowrap rounded-md border px-2 py-0.5 text-xs leading-4 ${fit ? '' : 'max-w-full truncate'} ${TONE[kind]}`}
    >
      {text}
    </span>
  )
}

const CODE_KIND_BY_COLUMN: Record<string, MasterCodeKind> = {
  code_klip: 'klip',
  vessel_code: 'klip',
  code_dhm: 'dhm',
  dhm_code: 'dhm',
  plant_code: 'sap',
  company_code: 'sap',
  vessel_codes_sap: 'sap',
}

export function masterCodeKind(columnId: string): MasterCodeKind | null {
  return CODE_KIND_BY_COLUMN[columnId] ?? null
}
