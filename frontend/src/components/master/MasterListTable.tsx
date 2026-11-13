'use client'

import type { KeyboardEvent, MouseEvent, ReactNode } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { dhmStatusHint, type DhmStatusRow } from '@/lib/masterVesselDhmStatus'
import { masterDhmChip, masterInitials, type MasterDhmChipTone } from '@/lib/masterDirectory'

export interface MasterTableColumn<T> {
  id: string
  label: string
  /** Header and cell classes, e.g. a fixed width. */
  className?: string
  /** Clicking the header sorts by this column (the page sorts its rows). */
  sortable?: boolean
  render: (row: T) => ReactNode
}

interface Props<T> {
  rows: T[]
  columns: readonly MasterTableColumn<T>[]
  getRowId: (row: T) => string
  loading?: boolean
  emptyLabel: string
  sortKey?: string
  sortDir?: 'asc' | 'desc'
  onSort?: (columnId: string) => void
  /** The whole row opens the row (and Enter on a focused row). Selecting text in a row does not. */
  onRowClick?: (row: T) => void
  /** Icon buttons at the end of a row; clicks in them do not open the row. */
  renderActions?: (row: T) => ReactNode
  minWidthPx?: number
}

/**
 * The Master list in the Users style: a light header, roomy rows with an avatar and a two-line first cell, chips for status and quiet icon buttons.
 * The page owns the data, the sorting and the paging; this only draws.
 */
export function MasterListTable<T>({
  rows,
  columns,
  getRowId,
  loading = false,
  emptyLabel,
  sortKey,
  sortDir = 'asc',
  onSort,
  onRowClick,
  renderActions,
  minWidthPx = 760,
}: Props<T>) {
  const stop = (event: MouseEvent | KeyboardEvent) => event.stopPropagation()
  const colSpan = columns.length + (renderActions ? 1 : 0)

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm" style={{ minWidth: minWidthPx }}>
        <thead>
          <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs font-medium text-gray-500">
            {columns.map((col) => {
              const active = sortKey === col.id
              return (
                <th key={col.id} scope="col" className={`px-4 py-2.5 ${col.className ?? ''}`} aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined}>
                  {col.sortable && onSort ? (
                    <button type="button" onClick={() => onSort(col.id)} className="inline-flex items-center gap-1 hover:text-gray-800">
                      {col.label}
                      {active ? (
                        sortDir === 'asc' ? <ArrowUp className="h-3 w-3" aria-hidden /> : <ArrowDown className="h-3 w-3" aria-hidden />
                      ) : (
                        <ArrowUpDown className="h-3 w-3 text-gray-300" aria-hidden />
                      )}
                    </button>
                  ) : (
                    col.label
                  )}
                </th>
              )
            })}
            {renderActions ? (
              <th scope="col" className="w-[5.5rem] px-2 py-2.5">
                <span className="sr-only">Actions</span>
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={colSpan} className="px-4 py-12 text-center text-sm text-gray-500">
                {loading ? 'Loading...' : emptyLabel}
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr
                key={getRowId(row)}
                tabIndex={onRowClick ? 0 : undefined}
                onClick={
                  onRowClick
                    ? () => {
                        // a drag over the text is a selection, not a click on the row
                        if (typeof window !== 'undefined' && window.getSelection()?.toString()) return
                        onRowClick(row)
                      }
                    : undefined
                }
                onKeyDown={
                  onRowClick
                    ? (event) => {
                        if (event.key === 'Enter' && event.target === event.currentTarget) onRowClick(row)
                      }
                    : undefined
                }
                className={`border-b border-gray-100 outline-none transition-colors last:border-b-0 ${
                  onRowClick ? 'cursor-pointer hover:bg-gray-50 focus-visible:bg-blue-50' : ''
                } ${loading ? 'opacity-60' : ''}`}
              >
                {columns.map((col) => (
                  <td key={col.id} className={`px-4 py-3 align-middle ${col.className ?? ''}`}>
                    {col.render(row)}
                  </td>
                ))}
                {renderActions ? (
                  <td className="px-2 py-3" onClick={stop} onKeyDown={stop}>
                    <div className="flex items-center justify-center gap-1">{renderActions(row)}</div>
                  </td>
                ) : null}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}

const AVATAR_TONE = ['bg-blue-50 text-blue-700', 'bg-emerald-50 text-emerald-700', 'bg-violet-50 text-violet-700', 'bg-amber-50 text-amber-800', 'bg-rose-50 text-rose-700', 'bg-cyan-50 text-cyan-700']

/** A stable colour for a name, so the same row always has the same avatar. */
function avatarTone(name: string): string {
  let h = 0
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return AVATAR_TONE[h % AVATAR_TONE.length]
}

/** The first cell of a Master row: initials in a circle, the name, and one quiet line under it. */
export function MasterIdentityCell({ name, subtitle }: { name: string; subtitle?: string | null }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${avatarTone(name)}`} aria-hidden>
        {masterInitials(name)}
      </div>
      <div className="min-w-0">
        <div className="truncate font-medium text-gray-900" title={name}>
          {name || '-'}
        </div>
        <div className="truncate text-xs text-gray-500">{subtitle || ' '}</div>
      </div>
    </div>
  )
}

const CHIP_TONE: Record<MasterDhmChipTone, { chip: string; dot: string }> = {
  ok: { chip: 'bg-emerald-50 text-emerald-700', dot: 'bg-emerald-500' },
  idle: { chip: 'bg-gray-100 text-gray-600', dot: 'bg-gray-400' },
  bad: { chip: 'bg-red-50 text-red-700', dot: 'bg-red-500' },
  warn: { chip: 'bg-orange-50 text-orange-700', dot: 'bg-orange-500' },
}

/** The DHM status of a row as a chip; when the last push did not go through, the reason shows on hover. */
export function MasterDhmChip({ row }: { row: DhmStatusRow }) {
  const chip = masterDhmChip(row)
  const hint = dhmStatusHint(row)
  const tone = CHIP_TONE[chip.tone]
  const body = (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${tone.chip}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} aria-hidden />
      {chip.label}
    </span>
  )
  if (!hint) return body
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className="cursor-help rounded-full outline-none focus-visible:ring-2 focus-visible:ring-blue-400" aria-label={`DHM ${chip.label}: ${hint}`}>
          {body}
        </span>
      </TooltipTrigger>
      <TooltipContent side="left" className="max-w-xs text-xs normal-case leading-relaxed">
        <div className="font-semibold">DHM: {chip.label}</div>
        <div className="mt-0.5 text-gray-600">{hint}</div>
      </TooltipContent>
    </Tooltip>
  )
}
