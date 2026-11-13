'use client'

import { ChevronLeft, ChevronRight } from 'lucide-react'
import { pagerItems } from '@/components/performance/ListPager'
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

const PAGE_BUTTON = 'inline-flex h-8 min-w-[2rem] items-center justify-center rounded-lg px-2 text-sm transition-colors disabled:pointer-events-none'

/** Previous / next as chevrons, page numbers as soft rounded squares (the current one filled blue), an ellipsis where pages are left out. */
function PagerNav({ pager }: { pager: Pager }) {
  const { page, totalPages, onPageChange, disabled } = pager
  return (
    <nav className="flex items-center gap-1" aria-label="Pagination">
      <button
        type="button"
        onClick={() => onPageChange(page - 1)}
        disabled={page <= 1 || disabled}
        aria-label="Previous page"
        title="Previous page"
        className={`${PAGE_BUTTON} text-gray-600 hover:bg-gray-100 disabled:text-gray-300`}
      >
        <ChevronLeft className="h-4 w-4" aria-hidden />
      </button>
      {pagerItems(page, totalPages).map((item, index) =>
        item === 'gap' ? (
          <span key={`gap-${index}`} className="px-1 text-sm text-gray-400" aria-hidden>
            &hellip;
          </span>
        ) : (
          <button
            key={item}
            type="button"
            onClick={() => onPageChange(item)}
            disabled={disabled}
            aria-current={page === item ? 'page' : undefined}
            className={`${PAGE_BUTTON} ${page === item ? 'bg-blue-600 font-medium text-white' : 'text-gray-700 hover:bg-gray-100'}`}
          >
            {item}
          </button>
        ),
      )}
      <button
        type="button"
        onClick={() => onPageChange(page + 1)}
        disabled={page >= totalPages || disabled}
        aria-label="Next page"
        title="Next page"
        className={`${PAGE_BUTTON} text-gray-600 hover:bg-gray-100 disabled:text-gray-300`}
      >
        <ChevronRight className="h-4 w-4" aria-hidden />
      </button>
    </nav>
  )
}

/**
 * The strip under a Master table: on the left how many rows there are and the legend of the code chips, on the right the pagination, all on one line
 * (they wrap on a narrow screen). The pager shows only when there is more than one page; the count and the legend always do. With a pager the
 * right edge keeps 4rem free, so the round assistant button floating over the bottom-right corner never covers Next.
 */
export function MasterTableFooter({ countText, kinds, pager }: { countText: string; kinds: readonly MasterCodeKind[]; pager?: Pager }) {
  const paged = pager != null && pager.totalPages > 1
  return (
    <div className={`flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-gray-100 py-2.5 pl-4 ${paged ? 'pr-16' : 'pr-4'}`}>
      <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-gray-500">
        <span>{countText}</span>
        <MasterCodeLegend kinds={kinds} />
      </div>
      {paged ? <PagerNav pager={pager} /> : null}
    </div>
  )
}
