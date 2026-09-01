'use client'

import type { ReactNode } from 'react'
import { DateInputDdMmYyyy } from '@/components/DateInputDdMmYyyy'

export type PerformancePeriodDateRowProps = {
  dateFrom: string
  dateTo: string
  onDateFromChange: (value: string) => void
  onDateToChange: (value: string) => void
  /** Optional control rendered to the right of the date range (e.g. Reset selection). */
  trailingAction?: ReactNode
  dateLabel?: string
  className?: string
}

/**
 * Performance header date row: Contract Date from/to (+ optional trailing action),
 * same DateInputDdMmYyyy pattern as Contracts / Shipments / Trucking.
 */
export function PerformancePeriodDateRow({
  dateFrom,
  dateTo,
  onDateFromChange,
  onDateToChange,
  trailingAction,
  dateLabel = 'Contract Date:',
  className,
}: PerformancePeriodDateRowProps) {
  return (
    <div className={`flex items-center gap-4 flex-wrap ${className ?? ''}`.trim()}>
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-sm font-medium text-gray-700">{dateLabel}</label>
        <DateInputDdMmYyyy valueIso={dateFrom} onChangeIso={onDateFromChange} className="w-40" />
        <span className="text-gray-500">to</span>
        <DateInputDdMmYyyy valueIso={dateTo} onChangeIso={onDateToChange} className="w-40" />
      </div>
      {trailingAction}
    </div>
  )
}
