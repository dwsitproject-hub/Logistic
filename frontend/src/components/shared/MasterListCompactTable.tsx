'use client'

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ContractPerfTableSortHeader } from '@/components/performance/ContractPerfTableSortHeader'
import { ContractPerfTruncatedCell } from '@/components/performance/ContractPerfTruncatedCell'
import {
  CONTRACT_PERF_TABLE_CELL_PAD,
  CONTRACT_PERF_TABLE_ROW_MIN_H,
  COMPACT_TABLE_ACTIONS_CELL_CLASS,
  COMPACT_TABLE_ACTIONS_HEADER_CLASS,
} from '@/lib/contractPerformanceColumns'
import { MASTER_VESSEL_ACTIONS_COL_WIDTH_PX } from '@/lib/masterVesselColumns'
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
  COMPACT_TABLE_ICON_COL_WIDTH_PX,
} from '@/lib/compactTableUi'
import { cn } from '@/lib/utils'
import { MasterCodeBadge, masterCodeKind } from '@/components/shared/MasterCodeBadge'

export type MasterListTableColumn<T> = {
  id: string
  label: string
  sortable?: boolean
  defaultVisible?: boolean
  widthPx?: number
  getText: (row: T) => string
  render?: (row: T) => ReactNode
}

/** Two 32px icon buttons, 4px gap, and 14px of space on each side. */
const MASTER_LIST_ICON_ACTIONS_COL_WIDTH_PX = 128

const MASTER_LIST_NAME_COLUMN_IDS = new Set([
  'product_name',
  'long_name',
  'port',
  'plant_name',
  'company_name',
  'site_name',
  'value_1',
  'value_3',
])

/** Code and DHM status stay as wide as their value. Other columns absorb the leftover width. */
function masterListColumnHugsContent(columnId: string): boolean {
  return masterCodeKind(columnId) != null || columnId === 'dhm_status'
}

function masterListColumnWidthPx(col: Pick<MasterListTableColumn<unknown>, 'id' | 'label' | 'widthPx' | 'sortable'>): number {
  const base = masterCodeKind(col.id)
    ? 168
    : col.id === 'dhm_status'
      ? 64
      : MASTER_LIST_NAME_COLUMN_IDS.has(col.id)
        ? 200
        : (col.widthPx ?? 148)
  return resolveCompactColumnWidthPx(base, col.label, { hasSort: col.sortable !== false })
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
  /** Size each column to its longest value so the text stays on one line. */
  fitContent?: boolean
  /** Make the whole row the click target (and Enter on a focused row), instead of an Actions column. Selecting text in a row does not open it. */
  onRowClick?: (row: T) => void
  /** One quiet line above the table that says the rows are clickable (shown only with onRowClick). */
  rowClickHint?: string
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
  fitContent = false,
  onRowClick,
  rowClickHint,
}: MasterListCompactTableProps<T>) {
  const topScrollRef = useRef<HTMLDivElement>(null)
  const bottomScrollRef = useRef<HTMLDivElement>(null)
  const isSyncingScroll = useRef(false)
  const [tableScrollWidth, setTableScrollWidth] = useState(0)
  const colSpan = columns.length + (renderActions ? 1 : 0)
  // The DHM status icon is frozen on the right edge like the Actions column, so it always stays last, whatever order the user dragged the others into.
  const orderedColumns = useMemo(
    () => [...columns.filter((col) => col.id !== 'dhm_status'), ...columns.filter((col) => col.id === 'dhm_status')],
    [columns],
  )
  // When an Actions column is also frozen, the DHM status sits just left of it.
  const dhmStickyRight = renderActions ? (tightActions ? MASTER_LIST_ICON_ACTIONS_COL_WIDTH_PX : MASTER_VESSEL_ACTIONS_COL_WIDTH_PX) : 0

  useEffect(() => {
    const table = bottomScrollRef.current?.querySelector('table')
    if (table) setTableScrollWidth(table.scrollWidth)
  }, [rows.length, columns])

  return (
    <div className={loading && rows.length === 0 ? 'min-h-[240px]' : undefined}>
      {onRowClick && rowClickHint ? <p className="mb-1.5 text-xs text-gray-500">{rowClickHint}</p> : null}
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
              fitContent && 'klip-master-fit-values',
            )}
          >
            <colgroup>
              {orderedColumns.map((col) => {
                const hugs = masterListColumnHugsContent(col.id)
                const isIcon = col.id === 'dhm_status'
                return (
                  <col
                    key={col.id}
                    className={isIcon ? 'klip-op-col--icon' : hugs ? 'klip-master-col-hug' : 'klip-master-col-grow'}
                    style={
                      isIcon
                        ? { width: COMPACT_TABLE_ICON_COL_WIDTH_PX }
                        : hugs
                        ? {
                            width: fitContent
                              ? '1%'
                              : compactTableColWidthCss(masterListColumnWidthPx(col)),
                          }
                        : undefined
                    }
                  />
                )
              })}
              {renderActions ? (
                <col
                  className="klip-master-col-actions"
                  style={{ width: tightActions ? MASTER_LIST_ICON_ACTIONS_COL_WIDTH_PX : MASTER_VESSEL_ACTIONS_COL_WIDTH_PX }}
                />
              ) : null}
            </colgroup>
            <thead>
              <tr className={LIST_PAGE_TABLE_HEADER_ROW_CLASS}>
                {orderedColumns.map((col) => (
                  <th
                    key={col.id}
                    scope="col"
                    style={col.id === 'dhm_status' ? { right: dhmStickyRight } : undefined}
                    draggable={col.id !== 'dhm_status'}
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
                      col.id === 'dhm_status'
                        ? 'klip-op-col--icon'
                        : masterListColumnHugsContent(col.id)
                          ? 'klip-master-col-hug'
                          : 'klip-master-col-grow',
                      col.id === 'dhm_status' && 'klip-op-col--dhm-sticky cursor-default',
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
                    <span className="sr-only">Actions</span>
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
                    <tr
                      key={getRowId(row)}
                      className={cn(stripe, onRowClick && 'group cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500')}
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
                    >
                      {orderedColumns.map((col) => {
                        const text = col.getText(row)
                        const tooltip = text && text !== '-' ? text.toUpperCase() : null
                        return (
                          <td
                            key={col.id}
                            style={col.id === 'dhm_status' ? { right: dhmStickyRight } : undefined}
                            className={cn(
                              COMPACT_OPERATIONAL_TABLE_CELL_CLASS,
                              'align-middle uppercase',
                              col.id === 'dhm_status' && 'klip-op-col--dhm-sticky text-center',
                              CONTRACT_PERF_TABLE_CELL_PAD,
                              col.id === 'dhm_status'
                                ? 'klip-op-col--icon'
                                : masterListColumnHugsContent(col.id)
                                  ? 'klip-master-col-hug'
                                  : 'klip-master-col-grow',
                              stripe,
                              onRowClick && 'group-hover:bg-blue-50',
                            )}
                          >
                            <div className={cn(COMPACT_OPERATIONAL_TABLE_CELL_INNER_CLASS, CONTRACT_PERF_TABLE_ROW_MIN_H)}>
                              {col.render ? (
                                col.render(row)
                              ) : masterCodeKind(col.id) ? (
                                <MasterCodeBadge kind={masterCodeKind(col.id)!} value={text} fit={fitContent} />
                              ) : fitContent ? (
                                // one line while it fits; a long list (a company's sites, a port's SAP names) wraps at 28rem instead of pushing the columns after it off screen
                                <span className="block max-w-[28rem] whitespace-normal text-sm leading-snug">{text || '-'}</span>
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
