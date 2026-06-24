'use client'

import type { ReactNode } from 'react'
import { CheckCircle2, MinusCircle } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import {
  COMMERCIAL_DOCUMENT_LABELS,
  COMMERCIAL_DOCUMENT_TYPES,
  type CommercialDocumentType,
  type CommercialDocumentsSummary,
} from '@/lib/commercialDocumentsTypes'

type DocumentStatusFilter = '' | 'checked' | 'unchecked'

type Props = {
  summary: CommercialDocumentsSummary | null
  documentTypeFilter: CommercialDocumentType | ''
  documentStatusFilter: DocumentStatusFilter
  onFilter: (type: CommercialDocumentType, status: 'checked' | 'unchecked') => void
  onResetSelection?: () => void
}

type MetricRowProps = {
  label: string
  count: number
  pct: number
  active: boolean
  onClick: () => void
  tone: 'checked' | 'unchecked'
  icon: ReactNode
}

function MetricRow({ label, count, pct, active, onClick, tone, icon }: MetricRowProps) {
  const isChecked = tone === 'checked'
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full rounded-md px-2 py-1.5 text-left transition-colors cursor-pointer',
        isChecked ? 'hover:bg-green-50' : 'hover:bg-gray-50',
        active &&
          (isChecked
            ? 'bg-green-50 ring-1 ring-green-200'
            : 'bg-gray-50 ring-1 ring-gray-200'),
      )}
    >
      <div className="flex items-center gap-1 text-[11px] font-medium leading-none text-gray-500">
        {icon}
        <span>{label}</span>
      </div>
      <div
        className={cn(
          'mt-1 text-sm font-semibold tabular-nums leading-tight break-words',
          isChecked ? 'text-green-600' : 'text-gray-500',
        )}
      >
        {count.toLocaleString('en-US')}
        <span className={cn('ml-1 text-[11px] font-medium', isChecked ? 'text-green-600/80' : 'text-gray-400')}>
          ({pct}%)
        </span>
      </div>
    </button>
  )
}

export function CommercialDocumentsSummaryCards({
  summary,
  documentTypeFilter,
  documentStatusFilter,
  onFilter,
  onResetSelection,
}: Props) {
  const hasSummarySelection = documentTypeFilter !== '' || documentStatusFilter !== ''

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3 px-1">
        <p className="text-xs text-gray-500">
          Click Checked or Unchecked to filter the contract table below.
        </p>
        {hasSummarySelection && onResetSelection ? (
          <button
            type="button"
            onClick={onResetSelection}
            className="text-sm text-blue-700 hover:underline shrink-0"
          >
            Reset selection
          </button>
        ) : null}
      </div>
      <div className="overflow-x-auto pb-0.5 -mx-1 px-1">
      <div className="grid grid-cols-5 gap-3 min-w-[760px] xl:min-w-0">
        {COMMERCIAL_DOCUMENT_TYPES.map((type) => {
          const card = summary?.[type]
          const openCount = card?.openCount ?? 0
          const checkedCount = card?.checkedCount ?? 0
          const checkedPct = card?.checkedPct ?? 0
          const uncheckedPct = card?.uncheckedPct ?? 0
          const uncheckedCount = Math.max(0, openCount - checkedCount)
          const isTypeActive = documentTypeFilter === type

          return (
            <Card
              key={type}
              className="border shadow-sm hover:shadow-md hover:border-gray-300 transition-all min-w-0 h-full"
            >
              <CardContent className="p-2.5 flex flex-col gap-2 h-full">
                <div
                  className="text-sm font-semibold text-gray-700 leading-snug min-h-[2.25rem] line-clamp-2"
                  title={COMMERCIAL_DOCUMENT_LABELS[type]}
                >
                  {COMMERCIAL_DOCUMENT_LABELS[type]}
                </div>

                <div className="space-y-1">
                  <MetricRow
                    label="Checked"
                    count={checkedCount}
                    pct={checkedPct}
                    active={isTypeActive && documentStatusFilter === 'checked'}
                    onClick={() => onFilter(type, 'checked')}
                    tone="checked"
                    icon={<CheckCircle2 className="h-3 w-3 shrink-0 text-green-600" aria-hidden />}
                  />
                  <MetricRow
                    label="Unchecked"
                    count={uncheckedCount}
                    pct={uncheckedPct}
                    active={isTypeActive && documentStatusFilter === 'unchecked'}
                    onClick={() => onFilter(type, 'unchecked')}
                    tone="unchecked"
                    icon={<MinusCircle className="h-3 w-3 shrink-0 text-gray-400" aria-hidden />}
                  />
                </div>

                <div
                  className="h-1.5 w-full rounded-full overflow-hidden flex mt-auto bg-gray-100"
                  aria-hidden
                >
                  <div
                    className="h-full bg-green-500 transition-all"
                    style={{ width: `${checkedPct}%` }}
                  />
                  <div
                    className="h-full bg-gray-300 transition-all"
                    style={{ width: `${uncheckedPct}%` }}
                  />
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>
      </div>
    </div>
  )
}
