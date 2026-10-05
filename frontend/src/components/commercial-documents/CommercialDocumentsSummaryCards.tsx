'use client'

import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import {
  COMMERCIAL_DOCUMENT_LABELS,
  COMMERCIAL_DOCUMENT_TYPES,
  type CommercialDocumentType,
  type CommercialDocumentsSummary,
} from '@/lib/commercialDocumentsTypes'

type Props = {
  summary: CommercialDocumentsSummary | null
  loading?: boolean
  /** The card whose uploaded contracts are currently listed in the table, if any. */
  activeType: CommercialDocumentType | ''
  onSelect: (type: CommercialDocumentType) => void
}

export function formatUploadedPct(uploaded: number, total: number): string {
  if (total <= 0) return '0.0%'
  return `${((uploaded / total) * 100).toFixed(1)}%`
}

export function CommercialDocumentsSummaryCards({ summary, loading = false, activeType, onSelect }: Props) {
  return (
    <div className="space-y-2">
      <p className="px-1 text-xs text-gray-500">
        Contracts with the document uploaded, out of all contracts in the selected date range. Click a card to list
        them in the table below.
      </p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 2xl:grid-cols-8">
        {COMMERCIAL_DOCUMENT_TYPES.map((type) => {
          const card = summary?.[type]
          const uploaded = card?.uploadedCount ?? 0
          const total = card?.totalCount ?? 0
          const active = activeType === type
          const label = COMMERCIAL_DOCUMENT_LABELS[type]

          return (
            <button
              key={type}
              type="button"
              onClick={() => onSelect(type)}
              aria-pressed={active}
              title={`Show contracts with ${label} uploaded`}
              className="min-w-0 text-left cursor-pointer rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            >
              <Card
                className={cn(
                  'h-full border shadow-sm transition-all hover:border-gray-300 hover:shadow-md',
                  active && 'border-blue-300 bg-blue-50/60 ring-1 ring-blue-200',
                )}
              >
                <CardContent className="flex h-full flex-col gap-1 p-3">
                  <div className="line-clamp-2 min-h-[2.5rem] text-base font-semibold leading-snug text-gray-800">
                    {label}
                  </div>
                  <div className="text-[11px] font-medium leading-none text-gray-500">Contract</div>
                  <div
                    className={cn(
                      'mt-1 text-xl font-semibold tabular-nums leading-tight text-gray-900',
                      loading && 'opacity-40',
                    )}
                  >
                    {uploaded.toLocaleString('en-US')}/{total.toLocaleString('en-US')}
                  </div>
                  <div
                    className={cn(
                      'text-sm font-medium tabular-nums',
                      loading ? 'opacity-40' : 'text-green-600',
                    )}
                  >
                    {formatUploadedPct(uploaded, total)}
                  </div>
                </CardContent>
              </Card>
            </button>
          )
        })}
      </div>
    </div>
  )
}
