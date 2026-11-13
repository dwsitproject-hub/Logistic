'use client'

import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'

type Props = {
  page: number
  totalPages: number
  onPageChange: (page: number) => void
  /** True while a fetch is running: every button waits. */
  disabled?: boolean
  /** Left side of the footer, e.g. "Page 1/53 · 1,049 shipments". */
  summary?: ReactNode
}

/** Up to five page numbers around the current one. */
export function pagerWindow(page: number, totalPages: number): number[] {
  const count = Math.min(5, totalPages)
  return Array.from({ length: count }, (_, i) => {
    if (totalPages <= 5 || page <= 3) return i + 1
    if (page >= totalPages - 2) return totalPages - 4 + i
    return page - 2 + i
  })
}

/**
 * The page buttons with the ends kept: up to seven numbers when there are few pages, otherwise the first and last page, the current one with
 * a neighbour each side, and a 'gap' (drawn as an ellipsis) where pages are left out. Page 1 of 62 gives 1 2 3 4 5 ... 62, page 4 gives
 * 1 ... 3 4 5 ... 62, page 61 gives 1 ... 58 59 60 61 62.
 */
export function pagerItems(page: number, totalPages: number): Array<number | 'gap'> {
  if (totalPages <= 7) return Array.from({ length: Math.max(0, totalPages) }, (_, i) => i + 1)
  if (page <= 3) return [1, 2, 3, 4, 5, 'gap', totalPages]
  if (page >= totalPages - 2) return [1, 'gap', totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages]
  return [1, 'gap', page - 1, page, page + 1, 'gap', totalPages]
}

/**
 * The footer under a list table: "Previous 1 2 3 4 5 Next" with a summary on the left. One component for Shipments, Contracts,
 * Shipping Performance and Trucking, so the card header holds only the title, the counts, the actions and the sort line.
 */
export function ListPager({ page, totalPages, onPageChange, disabled = false, summary }: Props) {
  if (totalPages <= 1) return null
  return (
    <div className="mt-6 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t pt-4">
      <div className="text-xs text-gray-500 tabular-nums">{summary}</div>
      <nav className="flex items-center gap-2" aria-label="Pagination">
        <Button variant="outline" size="sm" onClick={() => onPageChange(page - 1)} disabled={page <= 1 || disabled}>
          Previous
        </Button>
        <div className="flex items-center gap-1">
          {pagerWindow(page, totalPages).map((pageNum) => (
            <Button
              key={pageNum}
              variant={page === pageNum ? 'default' : 'outline'}
              size="sm"
              onClick={() => onPageChange(pageNum)}
              disabled={disabled}
              aria-current={page === pageNum ? 'page' : undefined}
              className="min-w-[40px]"
            >
              {pageNum}
            </Button>
          ))}
        </div>
        <Button variant="outline" size="sm" onClick={() => onPageChange(page + 1)} disabled={page >= totalPages || disabled}>
          Next
        </Button>
      </nav>
    </div>
  )
}
