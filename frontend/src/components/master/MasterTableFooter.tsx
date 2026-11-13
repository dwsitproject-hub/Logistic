'use client'

import { Button } from '@/components/ui/button'
import { pagerWindow } from '@/components/performance/ListPager'
import { MASTER_CODE_TONE, type MasterCodeKind } from '@/components/shared/MasterCodeBadge'

const LEGEND_LABEL: Record<MasterCodeKind, string> = {
  klip: 'KLIP code',
  dhm: 'DHM code',
  sap: 'SAP code',
  pair: 'Tug / barge pair',
}

/** What the coloured code chips in the table mean, drawn as the same chips: KLIP blue, DHM red, SAP gray (and the tug/barge pair, green, where it is shown). */
export function MasterCodeLegend({ kinds }: { kinds: readonly MasterCodeKind[] }) {
  if (kinds.length === 0) return null
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5" role="group" aria-label="Code colours">
      {kinds.map((kind) => (
        <span key={kind} className={`inline-block whitespace-nowrap rounded-md border px-2 py-0.5 text-xs leading-4 ${MASTER_CODE_TONE[kind]}`}>
          {LEGEND_LABEL[kind]}
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
