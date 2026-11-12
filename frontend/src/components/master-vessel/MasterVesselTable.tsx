'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Ship } from 'lucide-react'
import { ContractPerfTableSortHeader } from '@/components/performance/ContractPerfTableSortHeader'
import { TableInitialLoadPlaceholder } from '@/components/performance/TableInitialLoadPlaceholder'
import { ContractPerfTruncatedCell } from '@/components/performance/ContractPerfTruncatedCell'
import {
  CONTRACT_PERF_TABLE_CELL_PAD,
  CONTRACT_PERF_TABLE_ROW_MIN_H,
} from '@/lib/contractPerformanceColumns'
import {
  COMPACT_OPERATIONAL_TABLE_CELL_CLASS,
  COMPACT_OPERATIONAL_TABLE_CELL_INNER_CLASS,
  COMPACT_OPERATIONAL_TABLE_CLASS,
  COMPACT_OPERATIONAL_TABLE_ROW_VCENTER_CLASS,
  COMPACT_OPERATIONAL_TABLE_SCROLL_CLASS,
  LIST_PAGE_TABLE_HEADER_ROW_CLASS,
} from '@/lib/compactTableUi'
import {
  MASTER_VESSEL_COLUMNS,
  sumMasterVesselTableWidthPx,
  type MasterVesselColumnId,
  type MasterVesselRow,
} from '@/lib/masterVesselColumns'
import { operationalTableColumnClass, getOperationalColumnLayout } from '@/lib/operationalTableLayout'
import { cn } from '@/lib/utils'

export interface MasterVesselTableProps {
  items: MasterVesselRow[]
  loading: boolean
  sortKey: MasterVesselColumnId
  sortDir: 'asc' | 'desc'
  isAdmin: boolean
  onSortChange: (colId: MasterVesselColumnId) => void
  onEdit: (row: MasterVesselRow) => void
  columnIds: readonly MasterVesselColumnId[]
  dragColId: string | null
  onColumnDragStart: (columnId: MasterVesselColumnId) => void
  onColumnDragEnd: () => void
  onColumnDrop: (columnId: MasterVesselColumnId) => void
}

const VESSEL_HUG_COLUMN_IDS = new Set(['vessel_code', 'vessel_codes_sap', 'dhm_code', 'dhm_status', 'klip_transaction', 'pair_code'])

export function MasterVesselTable({
  items,
  loading,
  sortKey,
  sortDir,
  isAdmin,
  onSortChange,
  onEdit,
  columnIds,
  dragColId,
  onColumnDragStart,
  onColumnDragEnd,
  onColumnDrop,
}: MasterVesselTableProps) {
  const topScrollRef = useRef<HTMLDivElement>(null)
  const bottomScrollRef = useRef<HTMLDivElement>(null)
  const isSyncingScroll = useRef(false)
  const [tableScrollWidth, setTableScrollWidth] = useState(sumMasterVesselTableWidthPx())
  // The DHM status icon is frozen on the right edge, so it always stays last, whatever order the user dragged the others into.
  const orderedColumnIds = useMemo(
    () => [...columnIds.filter((id) => id !== 'dhm_status'), ...columnIds.filter((id) => id === 'dhm_status')],
    [columnIds],
  )

  useEffect(() => {
    const el = bottomScrollRef.current?.querySelector('table')
    if (el) setTableScrollWidth(el.scrollWidth)
  }, [items.length, loading])

  const handleSort = (colId: MasterVesselColumnId) => {
    onSortChange(colId)
  }

  return (
    <div className={loading && items.length === 0 ? 'min-h-[480px]' : undefined}>
      <p className="mb-1.5 text-xs text-gray-500">Click a row to {isAdmin ? 'edit' : 'view'} it</p>
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
            requestAnimationFrame(() => {
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
            requestAnimationFrame(() => {
              isSyncingScroll.current = false
            })
          }}
        >
          <table
            className={`${COMPACT_OPERATIONAL_TABLE_CLASS} ${COMPACT_OPERATIONAL_TABLE_ROW_VCENTER_CLASS} klip-compact-table--perf-narrow-cols klip-master-vessel-table`}
          >
            <colgroup>
              {orderedColumnIds.map((id) => {
                const col = MASTER_VESSEL_COLUMNS.find((item) => item.id === id)
                if (!col) return null
                const hugs = VESSEL_HUG_COLUMN_IDS.has(col.id)
                return (
                <col
                  key={col.id}
                  className={hugs ? 'klip-master-col-hug' : 'klip-master-col-grow'}
                  style={hugs ? { width: '1%' } : undefined}
                />
                )
              })}
            </colgroup>
            <thead>
              <tr className={LIST_PAGE_TABLE_HEADER_ROW_CLASS}>
                {orderedColumnIds.map((id) => {
                  const col = MASTER_VESSEL_COLUMNS.find((item) => item.id === id)
                  if (!col) return null
                  const columnLayout = getOperationalColumnLayout('master_vessel', col.id)
                  const opColClass = operationalTableColumnClass(columnLayout)
                  return (
                    <th
                      key={col.id}
                      scope="col"
                      draggable={col.id !== 'dhm_status'}
                      onDragStart={(event) => {
                        onColumnDragStart(col.id)
                        event.dataTransfer.setData('text/plain', col.id)
                        event.dataTransfer.effectAllowed = 'move'
                      }}
                      onDragEnd={onColumnDragEnd}
                      onDragOver={(event) => {
                        event.preventDefault()
                        event.dataTransfer.dropEffect = 'move'
                      }}
                      onDrop={(event) => {
                        event.preventDefault()
                        onColumnDrop(col.id)
                      }}
                      className={cn(
                        'relative text-left font-semibold cursor-move align-top sticky top-0 z-20 bg-slate-50',
                        CONTRACT_PERF_TABLE_CELL_PAD,
                        opColClass,
                        VESSEL_HUG_COLUMN_IDS.has(col.id) ? 'klip-master-col-hug' : 'klip-master-col-grow',
                        col.id === 'dhm_status' && 'right-0 z-30 cursor-default text-center',
                        dragColId === col.id && 'opacity-60',
                      )}
                    >
                      <ContractPerfTableSortHeader
                        label={col.label}
                        sortable={col.sortable !== false}
                        activeSort={sortKey === col.id}
                        sortDir={sortDir}
                        onSortClick={() => handleSort(col.id)}
                      />
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {loading && items.length === 0 ? (
                <TableInitialLoadPlaceholder colSpan={columnIds.length} icon={Ship} />
              ) : items.length === 0 ? (
                <tr className="bg-white">
                  <td
                    colSpan={columnIds.length}
                    className="px-4 py-10 text-center text-gray-500"
                  >
                    <Ship className="h-16 w-16 text-gray-400 mx-auto mb-4" />
                    <p>No vessels found</p>
                  </td>
                </tr>
              ) : (
                items.map((row, idx) => {
                  const stripe = idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'
                  return (
                    <tr
                      key={row.id}
                      className={cn(stripe, 'group cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500')}
                      tabIndex={0}
                      onClick={() => {
                        // a drag over the text is a selection, not a click on the row
                        if (typeof window !== 'undefined' && window.getSelection()?.toString()) return
                        onEdit(row)
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' && event.target === event.currentTarget) onEdit(row)
                      }}
                    >
                      {orderedColumnIds.map((id) => {
                        const col = MASTER_VESSEL_COLUMNS.find((item) => item.id === id)
                        if (!col) return null
                        const columnLayout = getOperationalColumnLayout('master_vessel', col.id)
                        const opColClass = operationalTableColumnClass(columnLayout)
                        // the DHM status icon brings its own tooltip
                        const useTruncate = (columnLayout === 'truncate' || columnLayout === 'token') && col.id !== 'dhm_status'
                        const rendered = col.render(row)
                        const cellText = col.getCellText(row)
                        const tooltip =
                          useTruncate && cellText !== '-' ? cellText.toUpperCase() : null
                        return (
                          <td
                            key={col.id}
                            className={cn(
                              COMPACT_OPERATIONAL_TABLE_CELL_CLASS,
                              opColClass,
                              'align-middle uppercase',
                              CONTRACT_PERF_TABLE_CELL_PAD,
                              VESSEL_HUG_COLUMN_IDS.has(col.id) ? 'klip-master-col-hug' : 'klip-master-col-grow',
                              col.id === 'dhm_status' && 'sticky right-0 z-10 text-center',
                              stripe,
                              'group-hover:bg-blue-50',
                            )}
                          >
                            <div
                              className={cn(
                                COMPACT_OPERATIONAL_TABLE_CELL_INNER_CLASS,
                                CONTRACT_PERF_TABLE_ROW_MIN_H,
                              )}
                            >
                              {tooltip ? (
                                <ContractPerfTruncatedCell tooltip={tooltip} className="w-full">
                                  {rendered}
                                </ContractPerfTruncatedCell>
                              ) : (
                                rendered
                              )}
                            </div>
                          </td>
                        )
                      })}
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
