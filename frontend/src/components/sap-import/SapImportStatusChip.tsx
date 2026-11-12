'use client'

import { sapImportStatusMeta, type SapImportTone } from '@/lib/sapImportSummary'

const TONE_CLASS: Record<SapImportTone, string> = {
  success: 'bg-emerald-50 text-emerald-700',
  warning: 'bg-amber-50 text-amber-800',
  danger: 'bg-red-50 text-red-700',
  info: 'bg-blue-50 text-blue-700',
  neutral: 'bg-gray-100 text-gray-600',
}

const DOT_CLASS: Record<SapImportTone, string> = {
  success: 'bg-emerald-500',
  warning: 'bg-amber-500',
  danger: 'bg-red-500',
  info: 'bg-blue-500 animate-pulse',
  neutral: 'bg-gray-400',
}

/** A status as a small chip with a coloured dot (the dot pulses while the import is running). */
export function SapImportStatusChip({ status }: { status: string }) {
  const meta = sapImportStatusMeta(status)
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${TONE_CLASS[meta.tone]}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${DOT_CLASS[meta.tone]}`} aria-hidden />
      {meta.label}
    </span>
  )
}
