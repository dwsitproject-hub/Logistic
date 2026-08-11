'use client'

import { useEffect, useRef, useState } from 'react'
import { Edit2, Ship, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ContractPerfTableSortHeader } from '@/components/performance/ContractPerfTableSortHeader'
import { TableInitialLoadPlaceholder } from '@/components/performance/TableInitialLoadPlaceholder'
import { ContractPerfTruncatedCell } from '@/components/performance/ContractPerfTruncatedCell'
import {
  CONTRACT_PERF_TABLE_CELL_PAD,
  CONTRACT_PERF_TABLE_HEADER_ROW_OPERATIONAL_CLASS,
  CONTRACT_PERF_TABLE_ROW_MIN_H,
} from '@/lib/contractPerformanceColumns'
import {
  COMPACT_OPERATIONAL_TABLE_CELL_CLASS,
  COMPACT_OPERATIONAL_TABLE_CELL_INNER_CLASS,
  COMPACT_OPERATIONAL_TABLE_CLASS,
  COMPACT_OPERATIONAL_TABLE_ROW_VCENTER_CLASS,
  COMPACT_OPERATIONAL_TABLE_SCROLL_CLASS,
  COMPACT_TABLE_ACTIONS_CELL_CLASS,
  COMPACT_TABLE_ACTIONS_HEADER_CLASS,
  COMPACT_TABLE_HEADER_LABEL_CLASS,
  compactTableColWidthCss,
} from '@/lib/compactTableUi'
import {
  MASTER_VESSEL_ACTIONS_COL_WIDTH_PX,
  MASTER_VESSEL_COLUMNS,
  masterVesselTableColumnWidthPx,
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
  onDelete: (row: MasterVesselRow) => void
}

export function MasterVesselTable({
  items,
  loading,
  sortKey,
  sortDir,
  isAdmin,
  onSortChange,
  onEdit,
  onDelete,
}: MasterVesselTableProps) {
  const topScrollRef = useRef<HTMLDivElement>(null)
  const bottomScrollRef = useRef<HTMLDivElement>(null)
  const isSyncingScroll = useRef(false)
  const [tableScrollWidth, setTableScrollWidth] = useState(sumMasterVesselTableWidthPx())

  useEffect(() => {
    const el = bottomScrollRef.current?.querySelector('table')
    if (el) setTableScrollWidth(el.scrollWidth)
  }, [items.length, loading])

  const handleSort = (colId: MasterVesselColumnId) => {
    onSortChange(colId)
  }

  return (
    <div className={loading && items.length === 0 ? 'min-h-[480px]' : undefined}>
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
            className={`${COMPACT_OPERATIONAL_TABLE_CLASS} ${COMPACT_OPERATIONAL_TABLE_ROW_VCENTER_CLASS} klip-compact-table--perf-narrow-cols`}
          >
            <colgroup>
              {MASTER_VESSEL_COLUMNS.map((col) => (
                <col
                  key={col.id}
                  style={{
                    width: compactTableColWidthCss(
                      masterVesselTableColumnWidthPx(col.id, col.label),
                    ),
                  }}
                />
              ))}
              <col style={{ width: MASTER_VESSEL_ACTIONS_COL_WIDTH_PX }} />
            </colgroup>
            <thead>
              <tr className={CONTRACT_PERF_TABLE_HEADER_ROW_OPERATIONAL_CLASS}>
                {MASTER_VESSEL_COLUMNS.map((col) => {
                  const columnLayout = getOperationalColumnLayout('master_vessel', col.id)
                  const opColClass = operationalTableColumnClass(columnLayout)
                  return (
                    <th
                      key={col.id}
                      scope="col"
                      className={cn(
                        'relative text-left font-semibold align-top sticky top-0 z-20 bg-gray-50',
                        CONTRACT_PERF_TABLE_CELL_PAD,
                        opColClass,
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
                <th
                  scope="col"
                  className={cn(COMPACT_TABLE_ACTIONS_HEADER_CLASS, CONTRACT_PERF_TABLE_CELL_PAD)}
                >
                  <span className={COMPACT_TABLE_HEADER_LABEL_CLASS}>Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {loading && items.length === 0 ? (
                <TableInitialLoadPlaceholder colSpan={MASTER_VESSEL_COLUMNS.length + 1} icon={Ship} />
              ) : items.length === 0 ? (
                <tr className="bg-white">
                  <td
                    colSpan={MASTER_VESSEL_COLUMNS.length + 1}
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
                    <tr key={row.id} className={stripe}>
                      {MASTER_VESSEL_COLUMNS.map((col) => {
                        const columnLayout = getOperationalColumnLayout('master_vessel', col.id)
                        const opColClass = operationalTableColumnClass(columnLayout)
                        const useTruncate = columnLayout === 'truncate' || columnLayout === 'token'
                        const rendered = col.render(row)
                        const cellText = col.getCellText(row)
                        const tooltip =
                          useTruncate && cellText !== '-' ? cellText : null
                        return (
                          <td
                            key={col.id}
                            className={cn(
                              COMPACT_OPERATIONAL_TABLE_CELL_CLASS,
                              opColClass,
                              'align-middle',
                              CONTRACT_PERF_TABLE_CELL_PAD,
                              stripe,
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
                      <td className={cn(COMPACT_TABLE_ACTIONS_CELL_CLASS, stripe)}>
                        <div className="inline-flex items-center justify-center gap-1">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="outline"
                                size="icon"
                                onClick={() => onEdit(row)}
                                className="h-8 w-8 bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100"
                                aria-label={isAdmin ? 'Edit vessel' : 'View vessel'}
                              >
                                <Edit2 className="h-4 w-4" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent side="top">{isAdmin ? 'Edit vessel' : 'View vessel'}</TooltipContent>
                          </Tooltip>
                          {isAdmin ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="outline"
                                  size="icon"
                                  onClick={() => onDelete(row)}
                                  className="h-8 w-8 bg-red-50 border-red-200 text-red-700 hover:bg-red-100"
                                  aria-label="Delete vessel"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent side="top">Delete vessel</TooltipContent>
                            </Tooltip>
                          ) : null}
                        </div>
                      </td>
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
