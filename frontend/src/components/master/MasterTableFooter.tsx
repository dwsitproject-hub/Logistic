'use client'

import { Button } from '@/components/ui/button'
import { pagerWindow } from '@/components/performance/ListPager'
import type { MasterCodeKind } from '@/components/shared/MasterCodeBadge'

const LEGEND_LABEL: Record<MasterCodeKind, string> = {
  klip: 'KLIP',
  dhm: 'DHM',
  sap: 'SAP',
  pair: 'Pair',
}

/** The little square in front of each word: a tint with a stronger edge of the same colour as the code chips (KLIP blue, DHM red, SAP gray, tug/barge pair green). */
const LEGEND_SWATCH: Record<MasterCodeKind, string> = {
  klip: 'border-blue-400 bg-blue-100',
  dhm: 'border-red-400 bg-red-100',
  sap: 'border-slate-400 bg-slate-200',
  pair: 'border-green-500 bg-green-100',
}

/** What the coloured code chips in the table mean: a small coloured square and one word each (KLIP, DHM, SAP; Pair where the tug/barge pair is shown). */
export function MasterCodeLegend({ kinds }: { kinds: readonly MasterCodeKind[] }) {
  if (kinds.length === 0) return null
  return (
    <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1" role="group" aria-label="Code colours">
      {kinds.map((kind) => (
        <span key={kind} className="inline-flex items-center gap-1.5">
          <span className={`inline-block h-3 w-3 shrink-0 rounded-[3px] border ${LEGEND_SWATCH[kind]}`} aria-hidden />
          <span>{LEGEND_LABEL[kind]}</span>
        </span>
      ))}
    </span>
  )
}

interface Pager {
  page: number
  totalPages: number
  onPageChange: (page: number) => void
  disabled?: boolean
}

/**
 * The strip under a Master table: on the left how many rows there are and the legend of the code chips, on the right the pagination, all on one line
 * (they wrap on a narrow screen). The pager shows only when there is more than one page; the count and the legend always do.
 */
export function MasterTableFooter({ countText, kinds, pager }: { countText: string; kinds: readonly MasterCodeKind[]; pager?: Pager }) {
  const paged = pager != null && pager.totalPages > 1
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-gray-100 px-4 py-2.5">
      <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-gray-500">
        <span>{countText}</span>
        <MasterCodeLegend kinds={kinds} />
      </div>
      {paged ? (
        <nav className="flex items-center gap-2" aria-label="Pagination">
          <Button variant="outline" size="sm" onClick={() => pager.onPageChange(pager.page - 1)} disabled={pager.page <= 1 || pager.disabled}>
            Previous
          </Button>
          <div className="flex items-center gap-1">
            {pagerWindow(pager.page, pager.totalPages).map((pageNum) => (
              <Button
                key={pageNum}
                variant={pager.page === pageNum ? 'default' : 'outline'}
                size="sm"
                onClick={() => pager.onPageChange(pageNum)}
                disabled={pager.disabled}
                aria-current={pager.page === pageNum ? 'page' : undefined}
                className="min-w-[40px]"
              >
                {pageNum}
              </Button>
            ))}
          </div>
          <Button variant="outline" size="sm" onClick={() => pager.onPageChange(pager.page + 1)} disabled={pager.page >= pager.totalPages || pager.disabled}>
            Next
          </Button>
        </nav>
      ) : null}
    </div>
  )
}
