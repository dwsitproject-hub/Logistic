'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ContractPerfTableSortHeader } from '@/components/performance/ContractPerfTableSortHeader'
import { ContractPerfTruncatedCell } from '@/components/performance/ContractPerfTruncatedCell'
import {
  CONTRACT_PERF_TABLE_CELL_PAD,
  CONTRACT_PERF_TABLE_ROW_MIN_H,
  COMPACT_TABLE_ACTIONS_CELL_CLASS,
  COMPACT_TABLE_ACTIONS_HEADER_CLASS,
} from '@/lib/contractPerformanceColumns'
import { MASTER_VESSEL_ACTIONS_COL_WIDTH_PX } from '@/lib/masterVesselColumns'

/** Two 32px icon buttons, 4px gap, and about 15px of space on each side. */
const MASTER_LIST_ICON_ACTIONS_COL_WIDTH_PX = 98
import {
  COMPACT_OPERATIONAL_TABLE_CELL_CLASS,
  COMPACT_OPERATIONAL_TABLE_CELL_INNER_CLASS,
  COMPACT_OPERATIONAL_TABLE_CLASS,
  COMPACT_OPERATIONAL_TABLE_ROW_VCENTER_CLASS,
  COMPACT_OPERATIONAL_TABLE_SCROLL_CLASS,
  COMPACT_TABLE_HEADER_LABEL_CLASS,
  LIST_PAGE_TABLE_HEADER_ROW_CLASS,
  compactTableColWidthCss,
  resolveCompactColumnWidthPx,
} from '@/lib/compactTableUi'
import { cn } from '@/lib/utils'

export type MasterListTableColumn<T> = {
  id: string
  label: string
  sortable?: boolean
  defaultVisible?: boolean
  widthPx?: number
  getText: (row: T) => string
  render?: (row: T) => ReactNode
}

type MasterListCompactTableProps<T> = {
  rows: T[]
  columns: readonly MasterListTableColumn<T>[]
  getRowId: (row: T) => string
  sortKey: string
  sortDir: 'asc' | 'desc'
  dragColId: string | null
  loading?: boolean
  emptyLabel: string
  onSort: (columnId: string) => void
  onDragStart: (columnId: string) => void
  onDragEnd: () => void
  onDrop: (columnId: string) => void
  renderActions?: (row: T) => ReactNode
  /** Fit the Actions column to two icon buttons with a small inset. */
  tightActions?: boolean
}

export function MasterListCompactTable<T>({
  rows,
  columns,
  getRowId,
  sortKey,
  sortDir,
  dragColId,
  loading,
  emptyLabel,
  onSort,
  onDragStart,
  onDragEnd,
  onDrop,
  renderActions,
  tightActions = false,
}: MasterListCompactTableProps<T>) {
  const topScrollRef = useRef<HTMLDivElement>(null)
  const bottomScrollRef = useRef<HTMLDivElement>(null)
  const isSyncingScroll = useRef(false)
  const [tableScrollWidth, setTableScrollWidth] = useState(0)
  const colSpan = columns.length + (renderActions ? 1 : 0)

  useEffect(() => {
    const table = bottomScrollRef.current?.querySelector('table')
    if (table) setTableScrollWidth(table.scrollWidth)
  }, [rows.length, columns])

  return (
    <div className={loading && rows.length === 0 ? 'min-h-[240px]' : undefined}>
      <div className="border rounded-lg overflow-hidden">
        <div
          ref={topScrollRef}
          className={cn(COMPACT_OPERATIONAL_TABLE_SCROLL_CLASS, 'border-b bg-white')}
          onScroll={() => {
            if (isSyncingScroll.current) return
            const top = topScrollRef.current
            const bottom = bottomScrollRef.current
            if (!top || !bottom) return
            isSyncingScroll.current = true
            bottom.scrollLeft = top.scrollLeft
            window.requestAnimationFrame(() => {
              isSyncingScroll.current = false
            })
          }}
        >
          <div style={{ width: tableScrollWidth || 0, height: 1 }} />
        </div>
        <div
          ref={bottomScrollRef}
          className={COMPACT_OPERATIONAL_TABLE_SCROLL_CLASS}
          onScroll={() => {
            if (isSyncingScroll.current) return
            const top = topScrollRef.current
            const bottom = bottomScrollRef.current
            if (!top || !bottom) return
            isSyncingScroll.current = true
            top.scrollLeft = bottom.scrollLeft
            window.requestAnimationFrame(() => {
              isSyncingScroll.current = false
            })
          }}
        >
          <table
            className={cn(
              COMPACT_OPERATIONAL_TABLE_CLASS,
              COMPACT_OPERATIONAL_TABLE_ROW_VCENTER_CLASS,
              'klip-compact-table--perf-narrow-cols klip-master-list-table',
              tightActions && 'klip-master-tight-actions',
            )}
          >
            <colgroup>
              {columns.map((col) => (
                <col
                  key={col.id}
                  style={{
                    width: compactTableColWidthCss(
                      resolveCompactColumnWidthPx(col.widthPx ?? 120, col.label, { hasSort: col.sortable !== false }),
                    ),
                  }}
                />
              ))}
              {renderActions ? (
                <col style={{ width: tightActions ? MASTER_LIST_ICON_ACTIONS_COL_WIDTH_PX : MASTER_VESSEL_ACTIONS_COL_WIDTH_PX }} />
              ) : null}
            </colgroup>
            <thead>
              <tr className={LIST_PAGE_TABLE_HEADER_ROW_CLASS}>
                {columns.map((col) => (
                  <th
                    key={col.id}
                    scope="col"
                    draggable
                    onDragStart={(event) => {
                      onDragStart(col.id)
                      event.dataTransfer.setData('text/plain', col.id)
                      event.dataTransfer.effectAllowed = 'move'
                    }}
                    onDragEnd={onDragEnd}
                    onDragOver={(event) => {
                      event.preventDefault()
                      event.dataTransfer.dropEffect = 'move'
                    }}
                    onDrop={(event) => {
                      event.preventDefault()
                      onDrop(col.id)
                    }}
                    className={cn(
                      'relative text-left font-semibold cursor-move align-top sticky top-0 z-20 bg-slate-50',
                      CONTRACT_PERF_TABLE_CELL_PAD,
                      dragColId === col.id && 'opacity-60',
                    )}
                  >
                    <ContractPerfTableSortHeader
                      label={col.label}
                      sortable={col.sortable !== false}
                      activeSort={sortKey === col.id}
                      sortDir={sortDir}
                      onSortClick={() => onSort(col.id)}
                    />
                  </th>
                ))}
                {renderActions ? (
                  <th scope="col" className={cn(COMPACT_TABLE_ACTIONS_HEADER_CLASS, CONTRACT_PERF_TABLE_CELL_PAD)}>
                    <span className={COMPACT_TABLE_HEADER_LABEL_CLASS}>Actions</span>
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {loading && rows.length === 0 ? (
                <tr className="bg-white">
                  <td colSpan={colSpan} className="px-4 py-10 text-center text-sm text-gray-500">
                    Loading...
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr className="bg-white">
                  <td colSpan={colSpan} className="px-4 py-10 text-center text-sm text-gray-500">
                    {emptyLabel}
                  </td>
                </tr>
              ) : (
                rows.map((row, index) => {
                  const stripe = index % 2 === 0 ? 'bg-white' : 'bg-gray-50'
                  return (
                    <tr key={getRowId(row)} className={stripe}>
                      {columns.map((col) => {
                        const text = col.getText(row)
                        const tooltip = text && text !== '-' ? text : null
                        return (
                          <td
                            key={col.id}
                            className={cn(
                              COMPACT_OPERATIONAL_TABLE_CELL_CLASS,
                              'align-middle',
                              CONTRACT_PERF_TABLE_CELL_PAD,
                              col.id === 'dhm_status' && 'klip-op-col--token',
                              stripe,
                            )}
                          >
                            <div className={cn(COMPACT_OPERATIONAL_TABLE_CELL_INNER_CLASS, CONTRACT_PERF_TABLE_ROW_MIN_H)}>
                              {col.render ? (
                                col.render(row)
                              ) : tooltip ? (
                                <ContractPerfTruncatedCell tooltip={tooltip} className="w-full">
                                  <span className="text-sm">{text}</span>
                                </ContractPerfTruncatedCell>
                              ) : (
                                <span className="text-sm">{text || '-'}</span>
                              )}
                            </div>
                          </td>
                        )
                      })}
                      {renderActions ? (
                        <td className={cn(COMPACT_TABLE_ACTIONS_CELL_CLASS, stripe)}>{renderActions(row)}</td>
                      ) : null}
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
