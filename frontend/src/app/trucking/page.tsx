'use client'

import { useEffect, useState, useMemo, useRef, useCallback, Suspense, memo } from 'react'
import { useSearchParams } from 'next/navigation'
import Layout from '@/components/Layout'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Search, Filter, X, Truck, Save, Loader2, Download, Upload, Plus, SlidersHorizontal, ArrowUp, ArrowDown, Check, ArrowLeft, ArrowRight, FileText, Pencil, GripVertical } from 'lucide-react'
import { DateInputDdMmYyyy } from '@/components/DateInputDdMmYyyy'
import api from '@/lib/api'
import { Checkbox } from '@/components/ui/checkbox'
import { FieldHelp } from '@/components/FieldHelp'
import { FIELD_HELP } from '@/lib/fieldHelpText'
import { formatDateDMY, formatDateTimeDMY } from '@/lib/dateFormat'
import { computeLateIndicatorDisplay } from '@/lib/calendarDays'
import { format } from 'date-fns'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { CreateTruckingOperationModal } from '@/components/trucking/CreateTruckingOperationModal'
import { SearchableMultiSelect } from '@/components/SearchableMultiSelect'
import { PerformanceScopeFilters } from '@/components/performance/PerformanceScopeFilters'
import { appendToolbarMultiToColumnFilters } from '@/lib/globalScopeFilters'

const TRUCKING_ACTIONS_COL_WIDTH = 140

function columnWidthToPx(width: string): number {
  const n = parseInt(width, 10)
  return Number.isFinite(n) ? n : 120
}

/** Aligns with list `formatNumber` / `formatKg`: comma thousands, period decimals. */
function formatTruckingQtyPlain(n: number): string {
  if (!Number.isFinite(n)) return '—'
  if (n === 0) return '0'
  return n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2, useGrouping: true })
}

interface TruckingOperation {
  id: string
  operation_id: string
  contract_id: string
  contract_number: string
  po_number?: string
  sto_number: string
  sto_quantity?: number
  contract_qty?: number
  delivery_start_date?: string
  delivery_end_date?: string
  location: string
  loading_location?: string
  unloading_location?: string
  trucking_owner: string
  cargo_readiness_date: string
  trucking_start_date: string
  trucking_completion_date: string
  eta_trucking_completion_date?: string | null
  quantity_sent: number
  quantity_delivered: number
  quantity_receive?: number
  gain_loss_percentage: number
  gain_loss_amount: number
  oa_budget: number
  oa_actual: number
  estimated_km?: number
  status: string
  // ETA dates removed from UI (kept in DB/backend)
  created_at: string
  supplier: string
  buyer: string
  product: string
  incoterm?: string
  group_name: string
  contract_ext_no?: string
  daily_deliverables?: Array<{ date: string; quantity_delivered: number }>
}

type TruckingCalendarRow = {
  id: string
  operation_id: string
  contract_number: string
  contract_ext_no?: string
  sto_number?: string
  po_number?: string
  supplier?: string
  product?: string
  group_name?: string
  source_type?: string
  lt_spot?: string
  outstanding_quantity?: number
  loading_location?: string
  unloading_location?: string
  trucking_owner?: string
  delivery_start_date?: string
  delivery_end_date?: string
  trucking_start_date?: string
  trucking_completion_date?: string
  quantity_sent?: number
  quantity_delivered?: number
  quantity_receive?: number
  daily_deliverables?: Array<{ date: string; quantity_delivered: number }>
}

interface DocumentItem {
  id: string
  document_type?: string
  file_name: string
  file_path?: string
  mime_type?: string
  file_size?: number
  trucking_operation_id?: string
  created_at?: string
}

function buildCalendarCellDrafts(rows: TruckingCalendarRow[], month: Date): Record<string, string> {
  const yyyy = month.getFullYear()
  const mm = month.getMonth()
  const daysInMonth = new Date(yyyy, mm + 1, 0).getDate()
  const drafts: Record<string, string> = {}
  for (const r of rows) {
    const byDate = new Map(
      (r.daily_deliverables || []).map((x) => [(x?.date || '').slice(0, 10), Number(x?.quantity_delivered || 0)]),
    )
    for (let d = 1; d <= daysInMonth; d++) {
      const date = `${yyyy}-${String(mm + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
      const qty = byDate.get(date) || 0
      drafts[`${r.id}:${date}`] = qty ? String(qty) : ''
    }
  }
  return drafts
}

function parseCalendarDraftQty(raw: string): number | 'invalid' {
  const trimmed = raw.trim()
  if (trimmed === '') return 0
  const n = Number(String(raw).replace(/,/g, ''))
  if (!Number.isFinite(n) || n < 0) return 'invalid'
  return n
}

function isDateInCalendarMonth(dateIso: string, month: Date): boolean {
  const d = (dateIso || '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false
  const yyyy = month.getFullYear()
  const mm = month.getMonth()
  const prefix = `${yyyy}-${String(mm + 1).padStart(2, '0')}-`
  return d.startsWith(prefix)
}

function getRowDueDateBounds(row: TruckingCalendarRow): { start: string; end: string } | null {
  const start = (row.delivery_start_date || '').slice(0, 10)
  const end = (row.delivery_end_date || '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) return null
  return { start, end }
}

function isDateInDueWindow(row: TruckingCalendarRow, dateIso: string): boolean {
  const bounds = getRowDueDateBounds(row)
  if (!bounds) return true
  return dateIso >= bounds.start && dateIso <= bounds.end
}

function buildRowDeliverablesFromDrafts(
  row: TruckingCalendarRow,
  month: Date,
  drafts: Record<string, string>,
): Array<{ date: string; quantity_delivered: number }> {
  const yyyy = month.getFullYear()
  const mm = month.getMonth()
  const daysInMonth = new Date(yyyy, mm + 1, 0).getDate()
  const outsideMonth = (row.daily_deliverables || []).filter(
    (x) => !isDateInCalendarMonth((x?.date || '').slice(0, 10), month),
  )
  const inMonth: Array<{ date: string; quantity_delivered: number }> = []
  for (let d = 1; d <= daysInMonth; d++) {
    const date = `${yyyy}-${String(mm + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    const key = `${row.id}:${date}`
    const qty = parseCalendarDraftQty(drafts[key] ?? '')
    if (qty === 'invalid') throw new Error(`Invalid quantity on ${date}`)
    if (qty > 0) {
      if (!isDateInDueWindow(row, date)) {
        const bounds = getRowDueDateBounds(row)
        throw new Error(
          bounds
            ? `Date ${date} is outside Due Start (${bounds.start}) – Due End (${bounds.end})`
            : `Date ${date} is outside the allowed due delivery window`,
        )
      }
      inMonth.push({ date, quantity_delivered: qty })
    }
  }
  return [...outsideMonth, ...inMonth].sort((a, b) => (a.date || '').localeCompare(b.date || ''))
}

function calendarDraftsHaveChanges(
  rows: TruckingCalendarRow[],
  month: Date,
  drafts: Record<string, string>,
  baseline: Record<string, string>,
): boolean {
  const yyyy = month.getFullYear()
  const mm = month.getMonth()
  const daysInMonth = new Date(yyyy, mm + 1, 0).getDate()
  for (const r of rows) {
    for (let d = 1; d <= daysInMonth; d++) {
      const date = `${yyyy}-${String(mm + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
      const key = `${r.id}:${date}`
      if ((drafts[key] ?? '') !== (baseline[key] ?? '')) return true
    }
  }
  return false
}

function CalendarDeliverablesTable({
  month,
  rows,
  loading,
  savingAll,
  cellDrafts,
  cellBaseline,
  formatQty,
  visibleMetaCols,
  metaOrderIds,
  onReorderMetaCols,
  onCellChange,
}: {
  month: Date
  rows: TruckingCalendarRow[]
  loading: boolean
  savingAll: boolean
  cellDrafts: Record<string, string>
  cellBaseline: Record<string, string>
  formatQty: (n: number) => string
  visibleMetaCols: Set<string>
  metaOrderIds: string[]
  onReorderMetaCols: (dragId: string, dropId: string) => void
  onCellChange: (id: string, date: string, value: string) => void
}) {
  const yyyy = month.getFullYear()
  const mm = month.getMonth()
  const daysInMonth = new Date(yyyy, mm + 1, 0).getDate()
  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1)
  const operationColW = 220
  const contractColW = 300
  const opShown = visibleMetaCols.has('operation_id')
  const contractShown = visibleMetaCols.has('contract_block')
  const contractLeft = opShown ? operationColW : 0
  const [dragMetaColId, setDragMetaColId] = useState<string | null>(null)
  const scrollTopRef = useRef<HTMLDivElement | null>(null)
  const scrollBottomRef = useRef<HTMLDivElement | null>(null)
  const isSyncing = useRef(false)
  const editInputRef = useRef<HTMLInputElement | null>(null)
  const [editingQtyCellKey, setEditingQtyCellKey] = useState<string | null>(null)
  const editingQtyValueRef = useRef<string>('')
  const dayIso = (day: number) => {
    const m = String(mm + 1).padStart(2, '0')
    const d = String(day).padStart(2, '0')
    return `${yyyy}-${m}-${d}`
  }
  const sumPlannedQty = (r: TruckingCalendarRow) =>
    (r.daily_deliverables || []).reduce((s, x) => s + Number(x?.quantity_delivered || 0), 0)

  useEffect(() => {
    if (editingQtyCellKey) {
      editInputRef.current?.focus()
      editInputRef.current?.select()
    }
  }, [editingQtyCellKey])

  const startInlineQtyEdit = useCallback((key: string, current: string) => {
    if (savingAll) return
    editingQtyValueRef.current = current
    setEditingQtyCellKey(key)
  }, [savingAll])

  const commitInlineQtyEdit = useCallback((rowId: string, date: string) => {
    onCellChange(rowId, date, editingQtyValueRef.current)
    setEditingQtyCellKey(null)
  }, [onCellChange])

  const cancelInlineQtyEdit = useCallback(() => {
    setEditingQtyCellKey(null)
  }, [])

  const orderedMetaCols = useMemo(() => {
    const all = [
      'owner',
      'due_start',
      'due_end',
      'source_type',
      'lt_spot',
      'product',
      'group_name',
      'supplier',
      'outstanding_quantity',
      'qty_sent',
      'qty_sent_planning',
      'qty_delivered',
      'qty_received',
    ]
    const base = metaOrderIds?.length ? metaOrderIds : all
    const deduped = Array.from(new Set(base))
    const healed = [...deduped, ...all.filter((x) => !deduped.includes(x))].filter((x) => all.includes(x))
    return healed.filter((id) => visibleMetaCols.has(id))
  }, [metaOrderIds, visibleMetaCols])

  useEffect(() => {
    const top = scrollTopRef.current
    const bottom = scrollBottomRef.current
    if (!top || !bottom) return
    const onTop = () => {
      if (isSyncing.current) return
      isSyncing.current = true
      bottom.scrollLeft = top.scrollLeft
      isSyncing.current = false
    }
    const onBottom = () => {
      if (isSyncing.current) return
      isSyncing.current = true
      top.scrollLeft = bottom.scrollLeft
      isSyncing.current = false
    }
    top.addEventListener('scroll', onTop)
    bottom.addEventListener('scroll', onBottom)
    return () => {
      top.removeEventListener('scroll', onTop)
      bottom.removeEventListener('scroll', onBottom)
    }
  }, [rows.length, daysInMonth, opShown, contractShown, visibleMetaCols])

  return (
    <div>
      {loading ? (
        <div className="text-center py-10 text-gray-500">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="text-center py-10 text-gray-500">No trucking operations in this month window</div>
      ) : (
        <>
        <div ref={scrollTopRef} className="overflow-x-auto border rounded-md bg-white">
          <div className="h-3" style={{ width: `${2000 + daysInMonth * 48}px` }} />
        </div>
        <div ref={scrollBottomRef} className="overflow-x-auto mt-2">
        <table className="min-w-[2000px] w-full text-xs border-separate border-spacing-0">
          <thead className="sticky top-0 z-10">
            <tr className="bg-gray-100">
              {opShown ? (
                <th
                  className="sticky z-20 bg-gray-100 px-3 py-2 text-left font-semibold text-gray-700 border-b border-gray-200"
                  style={{ left: 0, minWidth: operationColW, maxWidth: operationColW }}
                >
                  Operation ID
                </th>
              ) : null}
              {contractShown ? (
                <th
                  className="sticky z-20 bg-gray-100 px-3 py-2 text-left font-semibold text-gray-700 border-b border-gray-200"
                  style={{ left: contractLeft, minWidth: contractColW }}
                >
                  Contract Ext No / STO / Supplier
                </th>
              ) : null}
              {orderedMetaCols.map((id) => {
                const label =
                  id === 'owner' ? 'Owner'
                    : id === 'due_start' ? 'Due Start'
                      : id === 'due_end' ? 'Due End'
                        : id === 'source_type' ? 'Source Type'
                          : id === 'lt_spot' ? 'LT/SPOT'
                            : id === 'product' ? 'Product'
                              : id === 'group_name' ? 'Group Name'
                                : id === 'supplier' ? 'Supplier'
                                  : id === 'outstanding_quantity' ? 'Outstanding Qty'
                                    : id === 'qty_sent' ? 'Qty Sent'
                                      : id === 'qty_sent_planning' ? 'QTY Sent (planning)'
                                        : id === 'qty_delivered' ? 'Qty Delivered'
                                          : 'Qty Received'
                const alignRight = new Set(['outstanding_quantity', 'qty_sent', 'qty_sent_planning', 'qty_delivered', 'qty_received']).has(id)
                return (
                  <th
                    key={id}
                    className={`px-3 py-2 font-semibold text-gray-700 border-b border-gray-200 cursor-move ${alignRight ? 'text-right' : 'text-left'} ${dragMetaColId === id ? 'opacity-60' : ''}`}
                    draggable
                    onDragStart={(e) => {
                      setDragMetaColId(id)
                      e.dataTransfer.setData('text/plain', id)
                      e.dataTransfer.effectAllowed = 'move'
                    }}
                    onDragEnd={() => setDragMetaColId(null)}
                    onDragOver={(e) => {
                      e.preventDefault()
                      e.dataTransfer.dropEffect = 'move'
                    }}
                    onDrop={(e) => {
                      e.preventDefault()
                      const dragged = e.dataTransfer.getData('text/plain')
                      if (dragged) onReorderMetaCols(dragged, id)
                      setDragMetaColId(null)
                    }}
                    title="Drag to reorder"
                  >
                    {label}
                  </th>
                )
              })}
              {days.map((d) => (
                <th key={d} className="px-2 py-2 text-right font-semibold text-gray-700 border-b border-gray-200 tabular-nums">
                  {d}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="bg-white">
            {rows.map((r) => {
              const opLabel = r.operation_id || '-'
              const contractLabel = (r.contract_ext_no || r.contract_number || '-') as string
              const stoLabel = r.sto_number || '-'
              const supplierLabel = r.supplier || '-'
              const dueStart = r.delivery_start_date
                ? formatDateDMY(r.delivery_start_date || '')
                : '-'
              const dueEnd = r.delivery_end_date
                ? formatDateDMY(r.delivery_end_date || '')
                : '-'
              const qtySent = Number(r.quantity_sent || 0)
              const qtyDel = Number(r.quantity_delivered || 0)
              const qtyRecv = Number(r.quantity_receive ?? 0)
              const plannedSum = sumPlannedQty(r)
              const outQty = Number((r as any).outstanding_quantity ?? 0)
              return (
                <tr key={r.id} className="hover:bg-gray-50">
                  {opShown ? (
                    <td
                      className="sticky z-10 bg-white px-3 py-2 border-b border-gray-100 align-top"
                      style={{ left: 0, minWidth: operationColW, maxWidth: operationColW }}
                    >
                      <div className="font-semibold text-gray-900 truncate" title={opLabel}>{opLabel}</div>
                      <div className="text-[10px] text-gray-500 truncate" title={`${r.loading_location || ''} → ${r.unloading_location || ''}`}>
                        {(r.loading_location || '-')} → {(r.unloading_location || '-')}
                      </div>
                    </td>
                  ) : null}
                  {contractShown ? (
                    <td
                      className="sticky z-10 bg-white px-3 py-2 border-b border-gray-100 align-top"
                      style={{ left: contractLeft, minWidth: contractColW, maxWidth: 'min(360px,40vw)' }}
                    >
                      <div className="font-medium text-gray-900 whitespace-normal break-words leading-snug" title={contractLabel}>{contractLabel}</div>
                      <div className="text-[10px] text-gray-500 whitespace-normal break-words mt-0.5" title={`STO: ${stoLabel}`}>STO: {stoLabel}</div>
                      <div className="text-[10px] text-gray-500 whitespace-normal break-words" title={supplierLabel}>{supplierLabel}</div>
                    </td>
                  ) : null}
                  {orderedMetaCols.map((id) => {
                    const alignRight = new Set(['outstanding_quantity', 'qty_sent', 'qty_sent_planning', 'qty_delivered', 'qty_received']).has(id)
                    const val = (() => {
                      switch (id) {
                        case 'owner':
                          return r.trucking_owner || '-'
                        case 'due_start':
                          return dueStart
                        case 'due_end':
                          return dueEnd
                        case 'source_type':
                          return (r as any).source_type || '—'
                        case 'lt_spot':
                          return (r as any).lt_spot || '—'
                        case 'product':
                          return r.product || '—'
                        case 'group_name':
                          return r.group_name || '—'
                        case 'supplier':
                          return r.supplier || '—'
                        case 'outstanding_quantity':
                          return outQty ? formatQty(outQty) : '—'
                        case 'qty_sent':
                          return qtySent ? formatQty(qtySent) : '-'
                        case 'qty_sent_planning':
                          return plannedSum ? formatQty(plannedSum) : '—'
                        case 'qty_delivered':
                          return qtyDel != null && Number.isFinite(qtyDel) ? formatQty(qtyDel) : '—'
                        case 'qty_received':
                          return qtyRecv != null && Number.isFinite(qtyRecv) ? formatQty(qtyRecv) : '—'
                        default:
                          return '-'
                      }
                    })()
                    return (
                      <td
                        key={id}
                        className={`px-3 py-2 border-b border-gray-100 text-gray-700 align-top ${alignRight ? 'text-right tabular-nums' : ''}`}
                      >
                        {val}
                      </td>
                    )
                  })}
                  {days.map((d) => {
                    const date = dayIso(d)
                    const key = `${r.id}:${date}`
                    const draftValue = cellDrafts[key] ?? ''
                    const isDirty = (draftValue ?? '') !== (cellBaseline[key] ?? '')
                    const isEditingThisCell = editingQtyCellKey === key
                    return (
                      <td
                        key={date}
                        className={`px-2 py-1.5 border-b border-gray-100 text-right tabular-nums ${isDirty ? 'bg-amber-50/50' : ''}`}
                      >
                        {isEditingThisCell ? (
                          <input
                            ref={editInputRef}
                            key={key}
                            defaultValue={draftValue}
                            onChange={(e) => {
                              editingQtyValueRef.current = e.target.value
                            }}
                            onBlur={() => commitInlineQtyEdit(r.id, date)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault()
                                commitInlineQtyEdit(r.id, date)
                              } else if (e.key === 'Escape') {
                                e.preventDefault()
                                cancelInlineQtyEdit()
                              }
                            }}
                            disabled={savingAll}
                            className="w-[64px] h-7 px-2 rounded border border-gray-200 bg-white text-right text-xs focus:border-blue-400 focus:ring-1 focus:ring-blue-200 disabled:opacity-60"
                            placeholder="0"
                            title={date}
                          />
                        ) : (
                          <button
                            type="button"
                            onClick={() => startInlineQtyEdit(key, draftValue)}
                            disabled={savingAll}
                            className="w-[64px] h-7 px-2 rounded border border-gray-200 bg-gray-50 text-right text-xs text-gray-700 hover:bg-white disabled:opacity-60"
                            title={`Click to edit ${date}`}
                          >
                            {draftValue ? formatQty(Number(String(draftValue).replace(/,/g, ''))) : '0'}
                          </button>
                        )}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
        </div>
        </>
      )}
    </div>
  )
}

function TruckingPageContent() {
  const searchParams = useSearchParams()
  const [truckingOperations, setTruckingOperations] = useState<TruckingOperation[]>([])
  const [loading, setLoading] = useState(true)
  // Search should apply only on Enter / Apply (not per keystroke)
  const [searchDraft, setSearchDraft] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editedData, setEditedData] = useState<Partial<TruckingOperation>>({})
  const [statusFilter, setStatusFilter] = useState<string>('ALL')
  const [lateIndicatorFilter, setLateIndicatorFilter] = useState<string>('ALL')
  const [loadingLocationFilter, setLoadingLocationFilter] = useState('')
  const [unloadingLocationFilter, setUnloadingLocationFilter] = useState('')
  const [selectedGroupPlants, setSelectedGroupPlants] = useState<string[]>([])
  const [availableGroupPlants, setAvailableGroupPlants] = useState<string[]>([])
  const [selectedIncoterms, setSelectedIncoterms] = useState<string[]>([])
  const [selectedProducts, setSelectedProducts] = useState<string[]>([])
  const [availableIncoterms, setAvailableIncoterms] = useState<string[]>([])
  const [availableProducts, setAvailableProducts] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const defaultContractDateRange = useMemo(() => {
    const now = new Date()
    const yyyy = now.getFullYear()
    return {
      from: `${yyyy}-01-01`,
      to: `${yyyy}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`,
    }
  }, [])
  const [dateFrom, setDateFrom] = useState(() => defaultContractDateRange.from)
  const [dateTo, setDateTo] = useState(() => defaultContractDateRange.to)
  const [uploadingId, setUploadingId] = useState<string>('')
  const [page, setPage] = useState<number>(1)
  const pageSize = 20
  const [totalCount, setTotalCount] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [hasMore, setHasMore] = useState<boolean>(true)
  const [truckingSummary, setTruckingSummary] = useState<any>(null)

  // View tabs
  const [activeTab, setActiveTab] = useState<'list' | 'calendar'>('list')

  // Calendar tab state (Daily Planning Deliverables)
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const d = new Date()
    return new Date(d.getFullYear(), d.getMonth(), 1)
  })
  const [calendarRows, setCalendarRows] = useState<TruckingCalendarRow[]>([])
  const [calendarLoading, setCalendarLoading] = useState(false)
  const [calendarCellDrafts, setCalendarCellDrafts] = useState<Record<string, string>>({})
  const [calendarSavedBaseline, setCalendarSavedBaseline] = useState<Record<string, string>>({})
  const [calendarSavingAll, setCalendarSavingAll] = useState(false)
  const [planningUploadOpen, setPlanningUploadOpen] = useState(false)
  const [planningUploading, setPlanningUploading] = useState(false)
  const [planningUploadSummary, setPlanningUploadSummary] = useState<{
    processedRows: number
    succeededOperations: number
    failedOperations: number
    succeededRows: number
    rowLevelIssues: number
    operationLevelFailures: number
    rowParseFailures: { rowNumber: number; contract_ext_no: string; reason: string }[]
    operationFailures: { contract_ext_no: string; rowNumbers: number[]; reason: string; operation_ids?: string[] }[]
  } | null>(null)

  const [bulkCreateUploadOpen, setBulkCreateUploadOpen] = useState(false)
  const [bulkCreateUploading, setBulkCreateUploading] = useState(false)
  const [bulkCreateSummary, setBulkCreateSummary] = useState<{
    processedRows: number
    operationsCreated: number
    operationsFailed: number
    succeededRows: number
    rowParseFailures: { rowNumber: number; contract_ext_no: string; reason: string }[]
    operationFailures: { contract_ext_no: string; rowNumbers: number[]; reason: string }[]
  } | null>(null)
  const planningFileInputRef = useRef<HTMLInputElement | null>(null)
  const [calendarColumnsOpen, setCalendarColumnsOpen] = useState(false)
  const calendarColumnsRef = useRef<HTMLDivElement | null>(null)
  const truckingDailyPlanningPrefKey = 'trucking.daily_planning.view.v1'
  const [calendarVisibleMetaCols, setCalendarVisibleMetaCols] = useState<Set<string>>(
    () =>
      new Set([
        'operation_id',
        'contract_block',
        'owner',
        'due_start',
        'due_end',
        'qty_sent',
        'qty_sent_planning',
        'qty_delivered',
        'qty_received',
        'source_type',
        'lt_spot',
        'product',
        'group_name',
        'supplier',
        'outstanding_quantity',
      ]),
  )
  const [calendarMetaOrderIds, setCalendarMetaOrderIds] = useState<string[]>(() => {
    if (typeof window === 'undefined') return []
    try {
      const raw = localStorage.getItem('trucking.daily_planning.metaOrder.v1')
      const parsed = raw ? JSON.parse(raw) : null
      return Array.isArray(parsed) ? parsed.map(String) : []
    } catch {
      return []
    }
  })
  const calendarDailyPlanningSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    // Load per-user saved daily planning view (best effort).
    let cancelled = false
    ;(async () => {
      try {
        const res = await api.get(`/user-preferences/me?key=${encodeURIComponent(truckingDailyPlanningPrefKey)}`)
        const value = res.data?.data?.value
        if (cancelled) return
        const cols = Array.isArray(value?.visibleMetaCols) ? value.visibleMetaCols : Array.isArray(value?.visible) ? value.visible : null
        const order = Array.isArray(value?.metaOrderIds) ? value.metaOrderIds : Array.isArray(value?.metaOrder) ? value.metaOrder : null
        if (Array.isArray(cols) && cols.length > 0) setCalendarVisibleMetaCols(new Set(cols.map((x: any) => String(x))))
        if (Array.isArray(order) && order.length > 0) setCalendarMetaOrderIds(order.map((x: any) => String(x)))
      } catch {
        // ignore
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem('trucking.daily_planning.metaOrder.v1', JSON.stringify(calendarMetaOrderIds))
    } catch {}
  }, [calendarMetaOrderIds])

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (calendarDailyPlanningSaveTimerRef.current) clearTimeout(calendarDailyPlanningSaveTimerRef.current)
    calendarDailyPlanningSaveTimerRef.current = setTimeout(() => {
      void api
        .post('/user-preferences/me', {
          key: truckingDailyPlanningPrefKey,
          value: { visibleMetaCols: Array.from(calendarVisibleMetaCols), metaOrderIds: calendarMetaOrderIds },
        })
        .catch(() => null)
    }, 600)
    return () => {
      if (calendarDailyPlanningSaveTimerRef.current) clearTimeout(calendarDailyPlanningSaveTimerRef.current)
    }
  }, [calendarMetaOrderIds, calendarVisibleMetaCols])

  const reorderCalendarMetaCols = (dragId: string, dropId: string) => {
    if (dragId === dropId) return
    setCalendarMetaOrderIds((prev) => {
      const base = prev.length > 0 ? [...prev] : []
      const ids = base.length > 0
        ? base
        : [
            'owner',
            'due_start',
            'due_end',
            'source_type',
            'lt_spot',
            'product',
            'group_name',
            'supplier',
            'outstanding_quantity',
            'qty_sent',
            'qty_sent_planning',
            'qty_delivered',
            'qty_received',
          ]
      const from = ids.indexOf(dragId)
      const to = ids.indexOf(dropId)
      if (from < 0 || to < 0) return ids
      ids.splice(from, 1)
      ids.splice(to, 0, dragId)
      return ids
    })
  }

  useEffect(() => {
    if (typeof window === 'undefined') return
    const onMouseDown = (e: MouseEvent) => {
      if (!calendarColumnsOpen) return
      const el = calendarColumnsRef.current
      if (!el) return
      if (e.target instanceof Node && el.contains(e.target)) return
      setCalendarColumnsOpen(false)
    }
    window.addEventListener('mousedown', onMouseDown)
    return () => window.removeEventListener('mousedown', onMouseDown)
  }, [calendarColumnsOpen])

  const iso = (d: Date) => {
    const yyyy = d.getFullYear()
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const dd = String(d.getDate()).padStart(2, '0')
    return `${yyyy}-${mm}-${dd}`
  }

  const fetchCalendarRows = useCallback(async () => {
    setCalendarLoading(true)
    try {
      const from = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), 1)
      const to = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 0)
      const params = new URLSearchParams()
      params.set('from', iso(from))
      params.set('to', iso(to))
      const searchTrim = searchTerm.trim()
      if (searchTrim.length >= 2) params.set('search', searchTrim)
      if (statusFilter && statusFilter !== 'ALL') params.set('status', statusFilter)
      if (loadingLocationFilter.trim()) params.set('loadingLocation', loadingLocationFilter.trim())
      if (unloadingLocationFilter.trim()) params.set('unloadingLocation', unloadingLocationFilter.trim())
      if (dateFrom) params.set('dateFrom', dateFrom)
      if (dateTo) params.set('dateTo', dateTo)
      if (lateIndicatorFilter && lateIndicatorFilter !== 'ALL') params.set('lateIndicator', lateIndicatorFilter)

      const res = await api.get(`/trucking/daily-planning-deliverables?${params.toString()}`)
      setCalendarRows((res.data?.data || []) as TruckingCalendarRow[])
    } catch (e: any) {
      const msg = e?.response?.data?.error?.message || e?.message || 'Failed to load calendar deliverables'
      alert(msg)
      setCalendarRows([])
    } finally {
      setCalendarLoading(false)
    }
  }, [
    calendarMonth,
    searchTerm,
    statusFilter,
    loadingLocationFilter,
    unloadingLocationFilter,
    dateFrom,
    dateTo,
    lateIndicatorFilter,
  ])

  useEffect(() => {
    if (activeTab !== 'calendar') return
    fetchCalendarRows()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, fetchCalendarRows])

  useEffect(() => {
    if (activeTab !== 'calendar') return
    const baseline = buildCalendarCellDrafts(calendarRows, calendarMonth)
    setCalendarSavedBaseline(baseline)
    setCalendarCellDrafts(baseline)
  }, [activeTab, calendarRows, calendarMonth])

  const calendarHasUnsavedChanges = useMemo(
    () => calendarDraftsHaveChanges(calendarRows, calendarMonth, calendarCellDrafts, calendarSavedBaseline),
    [calendarRows, calendarMonth, calendarCellDrafts, calendarSavedBaseline],
  )

  const saveAllCalendarDrafts = useCallback(async () => {
    if (!calendarHasUnsavedChanges) return

    const yyyy = calendarMonth.getFullYear()
    const mm = calendarMonth.getMonth()
    const daysInMonth = new Date(yyyy, mm + 1, 0).getDate()
    const dirtyRowIds = new Set<string>()

    for (const r of calendarRows) {
      for (let d = 1; d <= daysInMonth; d++) {
        const date = `${yyyy}-${String(mm + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
        const key = `${r.id}:${date}`
        if ((calendarCellDrafts[key] ?? '') !== (calendarSavedBaseline[key] ?? '')) {
          dirtyRowIds.add(r.id)
        }
      }
    }

    for (const r of calendarRows) {
      const bounds = getRowDueDateBounds(r)
      for (let d = 1; d <= daysInMonth; d++) {
        const date = `${yyyy}-${String(mm + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
        const key = `${r.id}:${date}`
        const raw = calendarCellDrafts[key] ?? ''
        if (!dirtyRowIds.has(r.id)) continue
        const qty = parseCalendarDraftQty(raw)
        if (qty === 'invalid') {
          alert(`Invalid quantity for ${r.operation_id || r.id} on ${formatDateDMY(date)}. Use numbers >= 0.`)
          return
        }
        if (qty > 0 && bounds && !isDateInDueWindow(r, date)) {
          alert(
            `${r.operation_id || r.id}: ${formatDateDMY(date)} is outside the due delivery window (${formatDateDMY(bounds.start)} – ${formatDateDMY(bounds.end)}). Remove qty on that day or adjust Due End on the contract.`,
          )
          return
        }
      }
    }

    setCalendarSavingAll(true)
    let saved = 0
    let failed = 0
    let lastError = ''

    const updates = new Map<string, Array<{ date: string; quantity_delivered: number }>>()

    try {
      for (const id of dirtyRowIds) {
        const row = calendarRows.find((r) => r.id === id)
        if (!row) continue
        try {
          const next = buildRowDeliverablesFromDrafts(row, calendarMonth, calendarCellDrafts)
          const res = await api.put(`/trucking/${id}/daily-planning-deliverables`, {
            daily_deliverables: next,
          })
          if (res.data?.success) {
            updates.set(id, res.data.data.daily_deliverables || next)
            saved += 1
          } else {
            failed += 1
            lastError = res.data?.error?.message || 'Save failed'
          }
        } catch (e: any) {
          failed += 1
          lastError = e?.response?.data?.error?.message || e?.message || 'Save failed'
        }
      }

      if (updates.size > 0) {
        setCalendarRows((prev) =>
          prev.map((r) =>
            updates.has(r.id) ? { ...r, daily_deliverables: updates.get(r.id)! } : r,
          ),
        )
      }

      if (failed === 0) {
        if (saved > 0) {
          alert(`Saved daily planning for ${saved} operation(s).`)
        }
      } else {
        alert(
          lastError
            ? `Saved ${saved} operation(s); ${failed} failed. ${lastError}`
            : `Saved ${saved} operation(s); ${failed} failed.`,
        )
        if (updates.size === 0) {
          await fetchCalendarRows()
        }
      }
    } finally {
      setCalendarSavingAll(false)
    }
  }, [
    calendarHasUnsavedChanges,
    calendarRows,
    calendarMonth,
    calendarCellDrafts,
    calendarSavedBaseline,
    fetchCalendarRows,
  ])

  const downloadDailyPlanningTemplate = async () => {
    try {
      const res = await api.get('/trucking/daily-planning-deliverables/template', { responseType: 'blob' })
      const url = URL.createObjectURL(new Blob([res.data], { type: 'text/csv;charset=utf-8' }))
      const a = document.createElement('a')
      a.href = url
      a.download = 'daily_planning_deliverables_template.csv'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (e: any) {
      alert(e?.response?.data?.error?.message || e?.message || 'Failed to download template')
    }
  }

  const handleDailyPlanningFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setPlanningUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await api.post('/trucking/daily-planning-deliverables/bulk-upload', fd)
      const data = res.data?.data
      if (data) {
        setPlanningUploadSummary(data)
        setPlanningUploadOpen(true)
      }
      await fetchCalendarRows()
    } catch (err: any) {
      alert(err?.response?.data?.error?.message || err?.message || 'Upload failed')
    } finally {
      setPlanningUploading(false)
    }
  }

  const downloadBulkCreateTemplate = async () => {
    try {
      const res = await api.get('/trucking/bulk-create/template', { responseType: 'blob' })
      const url = URL.createObjectURL(new Blob([res.data], { type: 'text/csv;charset=utf-8' }))
      const a = document.createElement('a')
      a.href = url
      a.download = 'bulk_create_trucking_template.csv'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (e: any) {
      alert(e?.response?.data?.error?.message || (e as any)?.message || 'Failed to download template')
    }
  }

  const handleBulkCreateFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setBulkCreateUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await api.post('/trucking/bulk-create', fd)
      const data = res.data?.data
      if (data) {
        setBulkCreateSummary(data)
        setBulkCreateUploadOpen(true)
      }
      await fetchTruckingOperations(1)
    } catch (err: any) {
      alert(err?.response?.data?.error?.message || err?.message || 'Upload failed')
    } finally {
      setBulkCreateUploading(false)
    }
  }

  const planningYearOptions = useMemo(() => {
    const y = new Date().getFullYear()
    return Array.from({ length: 18 }, (_, i) => y - 8 + i)
  }, [])
  
  // Documents state
  const [selectedOperation, setSelectedOperation] = useState<TruckingOperation | null>(null)
  const [operationDocs, setOperationDocs] = useState<DocumentItem[]>([])
  const [docsLoading, setDocsLoading] = useState(false)
  const [showDocs, setShowDocs] = useState(false)

  // Create new trucking operation modal
  const [showCreateForm, setShowCreateForm] = useState(false)

  const [showColumnsMenu, setShowColumnsMenu] = useState(false)
  const [sortKey, setSortKey] = useState<string>('created_at')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [visibleColumnIds, setVisibleColumnIds] = useState<Set<string>>(() => new Set())
  const columnOrderStorageKey = 'trucking.compact.columnOrder'
  const userViewPrefKey = 'trucking.compact.view.v1'
  const [columnOrderIds, setColumnOrderIds] = useState<string[]>(() => {
    if (typeof window === 'undefined') return []
    try {
      const raw = localStorage.getItem(columnOrderStorageKey)
      if (raw) {
        const parsed = JSON.parse(raw)
        return Array.isArray(parsed) ? parsed.map(String) : []
      }
    } catch {}
    return []
  })
  const [dragColId, setDragColId] = useState<string | null>(null)
  const saveViewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Desktop table horizontal scroll sync
  const topScrollRef = useRef<HTMLDivElement | null>(null)
  const bottomScrollRef = useRef<HTMLDivElement | null>(null)
  const [tableScrollWidth, setTableScrollWidth] = useState<number>(0)
  const isSyncingScroll = useRef(false)

  // Excel-like column filtering
  type ColumnFilter =
    | { type: 'text'; value: string; exact?: boolean; emptyOnly?: boolean; notBlankOnly?: boolean }
    | { type: 'number'; min?: string; max?: string; emptyOnly?: boolean; notBlankOnly?: boolean }
    | { type: 'date'; from?: string; to?: string; emptyOnly?: boolean; notBlankOnly?: boolean }

  const [columnFilters, setColumnFilters] = useState<Record<string, ColumnFilter>>({})
  const [openHeaderFilterId, setOpenHeaderFilterId] = useState<string | null>(null)
  const headerFilterPopoverRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const onMouseDown = (e: MouseEvent) => {
      if (!openHeaderFilterId) return
      const el = headerFilterPopoverRef.current
      if (!el) return
      if (e.target instanceof Node && el.contains(e.target)) return
      setOpenHeaderFilterId(null)
    }
    window.addEventListener('mousedown', onMouseDown)
    return () => window.removeEventListener('mousedown', onMouseDown)
  }, [openHeaderFilterId])

  useEffect(() => {
    // Read URL parameters
    const statusParam = searchParams.get('status')
    if (statusParam) {
      setStatusFilter(statusParam)
    }
    setPage(1)
    setTruckingOperations([])
    setHasMore(true)
  }, [searchParams])

  useEffect(() => {
    fetchTruckingOperations()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, statusFilter, loadingLocationFilter, unloadingLocationFilter, searchParams, sortKey, sortDir, selectedGroupPlants, selectedIncoterms, selectedProducts, dateFrom, dateTo, searchTerm, columnFilters])

  useEffect(() => {
    let cancelled = false
    Promise.all([
      api.get('/contracts/filter-options/group-plants'),
      api.get('/contracts/filter-options/incoterms'),
      api.get('/dashboard/filter-options/products'),
    ])
      .then(([plantRes, incRes, productRes]) => {
        if (cancelled) return
        const plants = (plantRes.data?.data?.groupPlants || []) as string[]
        const incs = (incRes.data?.data?.incoterms || []) as string[]
        const productPayload = productRes.data?.data
        const products = (Array.isArray(productPayload)
          ? productPayload
          : productPayload && typeof productPayload === 'object' && 'products' in productPayload
            ? (productPayload as { products?: string[] }).products
            : []) as string[]
        setAvailableGroupPlants(Array.isArray(plants) ? plants : [])
        setAvailableIncoterms(Array.isArray(incs) ? incs : [])
        setAvailableProducts(Array.isArray(products) ? products : [])
      })
      .catch((e) => {
        if (cancelled) return
        console.error('Failed to fetch filter options:', e)
        setAvailableGroupPlants([])
        setAvailableIncoterms([])
        setAvailableProducts([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  const isFirstLateIndicatorEffect = useRef(true)
  useEffect(() => {
    if (isFirstLateIndicatorEffect.current) {
      isFirstLateIndicatorEffect.current = false
      return
    }
    setPage(1)
    fetchTruckingOperations(1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lateIndicatorFilter])

  const applySearch = useCallback(() => {
    setPage(1)
    setTruckingOperations([])
    setHasMore(true)
    setSearchTerm(searchDraft)
    fetchTruckingOperations(1, searchDraft)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchDraft])

  // Column header filters apply only when user presses Enter inside the filter popover.

  const fetchTruckingOperations = async (forcedPage?: number, searchOverride?: string) => {
    try {
      setLoading(true)
      const effectivePage = forcedPage ?? page
      const params = new URLSearchParams()
      params.append('limit', String(pageSize))
      params.append('page', String(effectivePage))
      params.append('sortKey', sortKey)
      params.append('sortDir', sortDir)
      if (statusFilter && statusFilter !== 'ALL') {
        params.append('status', statusFilter)
      }
      if (loadingLocationFilter) {
        params.append('loadingLocation', loadingLocationFilter)
      }
      if (unloadingLocationFilter) {
        params.append('unloadingLocation', unloadingLocationFilter)
      }
      if (dateFrom) params.append('dateFrom', dateFrom)
      if (dateTo) params.append('dateTo', dateTo)
      const searchTrim = (searchOverride ?? searchTerm).trim()
      if (searchTrim.length >= 2) {
        params.append('search', searchTrim)
      }
      const mergedColumnFilters = appendToolbarMultiToColumnFilters(columnFilters as Record<string, unknown>, {
        selectedIncoterms,
        selectedProducts,
      })
      const cfKeys = Object.keys(mergedColumnFilters)
      if (cfKeys.length > 0) {
        params.append('columnFilters', JSON.stringify(mergedColumnFilters))
      }
      if (lateIndicatorFilter && lateIndicatorFilter !== 'ALL') {
        params.append('lateIndicator', lateIndicatorFilter)
      }
      
      // Check for STO parameter from URL
      const stoParam = searchParams.get('sto')
      if (stoParam) {
        params.append('sto', stoParam)
      }
      
      // Check for contract parameter from URL
      const contractParam = searchParams.get('contract')
      if (contractParam) {
        params.append('contract', contractParam)
      }
      if (selectedGroupPlants.length > 0) {
        selectedGroupPlants.forEach((p) => params.append('plant', p))
      }
      
      const response = await api.get(`/trucking?${params.toString()}`)
      const items = response.data.data.truckingOperations || []
      setTruckingOperations(items)
      setTruckingSummary(response.data.data.summary || null)
      const total = Number(response.data.data.pagination?.total ?? 0)
      const pages = Number(response.data.data.pagination?.totalPages || 1)
      setTotalCount(total)
      setTotalPages(pages)
      setHasMore(effectivePage < pages)
    } catch (error) {
      console.error('Failed to fetch trucking operations:', error)
      alert('Failed to load trucking operations. Please refresh the page.')
      setTruckingSummary(null)
    } finally {
      setLoading(false)
    }
  }

  const handleEdit = (operation: TruckingOperation) => {
    setEditingId(operation.id)
    setEditedData({ ...operation })
  }

  const handleCancelEdit = () => {
    setEditingId(null)
    setEditedData({})
  }

  const handleSave = async (operationId: string) => {
    setSaving(true)
    try {
      const response = await api.put(`/trucking/${operationId}`, editedData)
      
      if (response.data.success) {
        setTruckingOperations(prev => prev.map(operation => 
          operation.id === operationId 
            ? { ...operation, ...response.data.data }
            : operation
        ))
        setEditingId(null)
        setEditedData({})
        alert('Trucking operation updated successfully!')
      }
    } catch (error: any) {
      console.error('Update trucking operation error:', error)
      const msg = error?.response?.data?.error?.message || 'Failed to update trucking operation. Please try again.'
      const detail = error?.response?.data?.error?.details || error?.response?.data?.error?.detail
      alert(detail ? `${msg}\n\nDetails: ${detail}` : msg)
    } finally {
      setSaving(false)
    }
  }

  const handleFieldChange = (field: keyof TruckingOperation, value: any) => {
    setEditedData(prev => ({ ...prev, [field]: value }))
  }

  const handleCreated = () => {
    setPage(1)
    setTruckingOperations([])
    setHasMore(true)
  }

  const downloadTemplate = async () => {
    const headers = [
      'Operation ID','Status','Location','Trucking Owner',
      'Cargo Readiness Date at Starting Location (YYYY-MM-DD)',
      'Trucking Start Receive Date (YYYY-MM-DD)','Trucking Last Receive Date (YYYY-MM-DD)',
      // ETA trucking dates removed from UI
      'Due Date Delivery Start (YYYY-MM-DD)','Due Date Delivery End (YYYY-MM-DD)',
      'Contract Qty (Kg)','Late Indicator',
      'Quantity Sent via Trucking (Based on Surat Jalan) (Kg)','Quantity Delivered via Trucking (Kg)','Gain/Loss %','Gain/Loss Amount (Kg)','Trucking OA Budget at Starting Location','Trucking OA Actual at Starting Location',
      'Contract Number','STO Number','Supplier','Product','Group'
    ]

    const rows: string[] = []
    const data = truckingOperations.filter(op =>
      (searchTerm === '' || op.operation_id?.toLowerCase().includes(searchTerm.toLowerCase()) || op.trucking_owner?.toLowerCase().includes(searchTerm.toLowerCase()))
    )

    for (const t of data) {
      rows.push([
        t.operation_id, t.status, t.location, t.trucking_owner,
        t.cargo_readiness_date?.substring(0,10) || '',
        t.trucking_start_date?.substring(0,10) || '', t.trucking_completion_date?.substring(0,10) || '',
        // ETA trucking dates removed from UI
        t.delivery_start_date?.substring(0,10) || '', t.delivery_end_date?.substring(0,10) || '',
        toKg(t.contract_qty ?? ''), getLateIndicator(t).text,
        toKg(t.quantity_sent ?? ''), toKg(t.quantity_delivered ?? ''), t.gain_loss_percentage ?? '', toKg(t.gain_loss_amount ?? ''), t.oa_budget ?? '', t.oa_actual ?? '',
        t.contract_number || '', t.sto_number || '', t.supplier || '', t.product || '', t.group_name || ''
      ].join(','))
    }

    const csvContent = [headers.join(','), ...(rows.length ? rows : [
      'TRUCK001,PLANNED,Starting Location,Truck Owner 1,2025-01-01,2025-01-02,2025-01-03,2025-01-02,2025-01-03,2025-01-01,2025-01-31,1000,On Time,1000,1000,0,0,5000,4500,CTR001,STO001,Supplier A,CPKO,Group X'
    ])].join('\n')

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement('a')
    const url = URL.createObjectURL(blob)
    link.setAttribute('href', url)
    link.setAttribute('download', 'Trucking_Export.csv')
    link.style.visibility = 'hidden'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'PLANNED': return 'bg-blue-100 text-blue-800'
      case 'IN_PROGRESS': return 'bg-yellow-100 text-yellow-800'
      case 'LOADING': return 'bg-orange-100 text-orange-800'
      case 'IN_TRANSIT': return 'bg-purple-100 text-purple-800'
      case 'UNLOADING': return 'bg-indigo-100 text-indigo-800'
      case 'COMPLETED': return 'bg-green-100 text-green-800'
      case 'CANCELLED': return 'bg-red-100 text-red-800'
      default: return 'bg-gray-100 text-gray-800'
    }
  }

  // Document functions
  const handleUploadFileChange = async (operation: TruckingOperation, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    
    const allowed = ['application/pdf', 'image/png', 'image/jpeg']
    if (!allowed.includes(file.type)) {
      alert('Only PDF, PNG, or JPEG files are allowed.')
      e.target.value = ''
      return
    }

    setUploadingId(operation.id)
    try {
      const form = new FormData()
      form.append('file', file)
      form.append('document_type', 'OTHER')
      form.append('trucking_operation_id', operation.id)

      const res = await api.post('/documents/upload', form, {
        headers: { 'Content-Type': 'multipart/form-data' }
      })
      if (res.data?.success) {
        alert('Document uploaded successfully!')
        if (selectedOperation && selectedOperation.id === operation.id) {
          await fetchOperationDocuments(operation.id)
        }
      } else {
        alert(res.data?.error?.message || 'Failed to upload document')
      }
    } catch (err) {
      console.error('Upload document error:', err)
      alert('Failed to upload document. Please try again.')
    } finally {
      setUploadingId('')
      e.target.value = ''
    }
  }

  const fetchOperationDocuments = async (operationInternalId: string) => {
    try {
      setDocsLoading(true)
      const params = new URLSearchParams()
      params.append('truckingOperationId', operationInternalId)
      const res = await api.get(`/documents?${params.toString()}`)
      const docs: DocumentItem[] = res.data?.data || []
      setOperationDocs(docs)
    } catch (err) {
      console.error('Fetch documents error:', err)
      setOperationDocs([])
    } finally {
      setDocsLoading(false)
    }
  }

  const handleDownloadDocument = async (docId: string, fileName: string) => {
    try {
      const response = await api.get(`/documents/${docId}/download`, {
        responseType: 'blob'
      })
      
      const blob = new Blob([response.data])
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = fileName
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      window.URL.revokeObjectURL(url)
    } catch (err) {
      console.error('Download document error:', err)
      alert('Failed to download document. Please try again.')
    }
  }

  const handleViewDocuments = async (operation: TruckingOperation) => {
    setSelectedOperation(operation)
    setShowDocs(true)
    await fetchOperationDocuments(operation.id)
  }

  const formatNumber = (num: number | string) => {
    if (num === null || num === undefined || num === '') return '-'
    const raw = typeof num === 'string' ? num : String(num)
    const cleaned = raw.replace(/,/g, '').replace(/\s+/g, '')
    const number = typeof num === 'string' ? parseFloat(cleaned) : num
    if (isNaN(number)) return '-'
    if (number === 0) return '0'
    return number.toLocaleString('en-US', { 
      minimumFractionDigits: 0, 
      maximumFractionDigits: 2,
      useGrouping: true
    })
  }

  const toKg = (mt: number | string | null | undefined) => {
    if (mt === null || mt === undefined || mt === '') return null
    const raw = typeof mt === 'string' ? mt : String(mt)
    const cleaned = raw.replace(/,/g, '').replace(/\s+/g, '')
    const n = typeof mt === 'string' ? parseFloat(cleaned) : (mt as number)
    if (!Number.isFinite(n)) return null
    return n
  }

  const formatKg = (mt: number | string | null | undefined) => {
    const n = toKg(mt)
    if (n === null) return '-'
    return `${formatNumber(n)} Kg`
  }

  const formatDate = (dateStr: string) => formatDateDMY(dateStr)

  const formatShortDate = (dateStr: string) => formatDateDMY(dateStr)

  // Helper function to calculate late indicator
  const getLateIndicator = (operation: TruckingOperation): { color: string; text: string } =>
    computeLateIndicatorDisplay(
      operation.delivery_end_date,
      operation.trucking_completion_date,
      operation.eta_trucking_completion_date,
    )

  const hasActiveTruckingFilters = useMemo(() => {
    return (
      searchDraft.trim() !== '' ||
      searchTerm.trim() !== '' ||
      statusFilter !== 'ALL' ||
      lateIndicatorFilter !== 'ALL' ||
      !!loadingLocationFilter.trim() ||
      !!unloadingLocationFilter.trim() ||
      selectedGroupPlants.length > 0 ||
      selectedIncoterms.length > 0 ||
      selectedProducts.length > 0 ||
      Object.keys(columnFilters).length > 0 ||
      dateFrom !== defaultContractDateRange.from ||
      dateTo !== defaultContractDateRange.to
    )
  }, [
    searchDraft,
    searchTerm,
    statusFilter,
    lateIndicatorFilter,
    loadingLocationFilter,
    unloadingLocationFilter,
    selectedGroupPlants,
    selectedIncoterms,
    selectedProducts,
    columnFilters,
    dateFrom,
    dateTo,
    defaultContractDateRange,
  ])

  const clearTruckingFilters = useCallback(() => {
    setSearchDraft('')
    setSearchTerm('')
    setStatusFilter('ALL')
    setLateIndicatorFilter('ALL')
    setLoadingLocationFilter('')
    setUnloadingLocationFilter('')
    setSelectedGroupPlants([])
    setSelectedIncoterms([])
    setSelectedProducts([])
    setColumnFilters({})
    setDateFrom(defaultContractDateRange.from)
    setDateTo(defaultContractDateRange.to)
    setPage(1)
    setTruckingOperations([])
    setHasMore(true)
  }, [defaultContractDateRange])

  // Excel-like filtering helpers
  const getFilterTypeForColumn = (colId: string): ColumnFilter['type'] => {
    if (colId === 'contract_qty' || colId === 'sto_quantity' || colId === 'quantity_sent' || colId === 'quantity_delivered' || colId === 'quantity_receive' || colId === 'oa_budget' || colId === 'oa_actual' || colId === 'estimated_km' || colId === 'gain_loss_percentage' || colId === 'gain_loss_amount') return 'number'
    if (colId === 'cargo_readiness_date' || colId === 'trucking_start_date' || colId === 'trucking_completion_date' || colId === 'delivery_start_date' || colId === 'delivery_end_date' || colId === 'created_at') return 'date'
    return 'text'
  }

  const getColumnRawValue = (o: TruckingOperation, colId: string): string | number | null => {
    switch (colId) {
      case 'operation_id': return o.operation_id || ''
      case 'contract_number': return o.contract_number || ''
      case 'po_number': return o.po_number || ''
      case 'sto_number': return o.sto_number || ''
      case 'status': return o.status || ''
      case 'location': return o.location || ''
      case 'loading_location': return o.loading_location || o.location || ''
      case 'unloading_location': return o.unloading_location || ''
      case 'trucking_owner': return o.trucking_owner || ''
      case 'supplier': return o.supplier || ''
      case 'product': return o.product || ''
      case 'incoterm': return o.incoterm || ''
      case 'buyer': return o.buyer || ''
      case 'group_name': return o.group_name || ''
      case 'contract_qty': return typeof o.contract_qty === 'number' ? o.contract_qty : null
      case 'sto_quantity': return typeof o.sto_quantity === 'number' ? o.sto_quantity : null
      case 'quantity_sent': return typeof o.quantity_sent === 'number' ? o.quantity_sent : null
      case 'quantity_delivered': return typeof o.quantity_delivered === 'number' ? o.quantity_delivered : null
      case 'quantity_receive': return typeof o.quantity_receive === 'number' ? o.quantity_receive : (typeof o.quantity_delivered === 'number' ? o.quantity_delivered : null)
      case 'oa_budget': return typeof o.oa_budget === 'number' ? o.oa_budget : null
      case 'oa_actual': return typeof o.oa_actual === 'number' ? o.oa_actual : null
      case 'estimated_km': return typeof o.estimated_km === 'number' ? o.estimated_km : null
      case 'gain_loss_percentage': return typeof o.gain_loss_percentage === 'number' ? o.gain_loss_percentage : null
      case 'gain_loss_amount': return typeof o.gain_loss_amount === 'number' ? o.gain_loss_amount : null
      case 'cargo_readiness_date': return o.cargo_readiness_date || ''
      case 'trucking_start_date': return o.trucking_start_date || ''
      case 'trucking_completion_date': return o.trucking_completion_date || ''
      case 'delivery_start_date': return o.delivery_start_date || ''
      case 'delivery_end_date': return o.delivery_end_date || ''
      case 'created_at': return o.created_at || ''
      case 'late_indicator': return getLateIndicator(o).text
      default: return (o as any)[colId] ?? ''
    }
  }

  // Search, column filters, and late indicator are applied on the server across the full dataset.
  const filteredOperations = truckingOperations

  // Compact columns definition
  interface CompactColumn {
    id: string
    label: string
    defaultVisible: boolean
    sortable: boolean
    formulaHelp?: string
    getSortValue?: (o: TruckingOperation) => string | number
    render: (o: TruckingOperation) => React.ReactNode
    className?: string
    headerClassName?: string
  }

  const compactColumns: CompactColumn[] = useMemo(() => [
    {
      id: 'late_indicator',
      label: 'Late Indicator',
      formulaHelp: FIELD_HELP.lateIndicator,
      defaultVisible: true,
      sortable: true,
      getSortValue: (o) => {
        const indicator = getLateIndicator(o)
        return indicator.text
      },
      render: (o) => {
        const indicator = getLateIndicator(o)
        return <Badge className={indicator.color}>{indicator.text}</Badge>
      }
    },
    {
      id: 'operation_id',
      label: 'Operation ID',
      defaultVisible: true,
      sortable: true,
      getSortValue: (o) => o.operation_id || '',
      render: (o) => (
        <span className="text-sm break-words block" title={o.operation_id || ''}>
          {o.operation_id || '-'}
        </span>
      )
    },
    {
      id: 'status',
      label: 'Status',
      defaultVisible: true,
      sortable: true,
      getSortValue: (o) => o.status || '',
      render: (o) => (
        <Badge className={getStatusColor(o.status)}>
          {o.status}
        </Badge>
      )
    },
    {
      id: 'contract_number',
      label: 'Contract Ext No',
      defaultVisible: true,
      sortable: true,
      getSortValue: (o) => o.contract_ext_no || o.contract_number || '',
      render: (o) => (
        <span className="text-sm truncate block max-w-full" title={(o.contract_ext_no || o.contract_number || '') as string}>
          {o.contract_ext_no || o.contract_number || '-'}
        </span>
      )
    },
    {
      id: 'po_number',
      label: 'PO No',
      defaultVisible: true,
      sortable: true,
      getSortValue: (o) => o.po_number || '',
      render: (o) => (
        <span className="text-sm truncate block max-w-full" title={o.po_number || ''}>
          {o.po_number || '-'}
        </span>
      )
    },
    {
      id: 'sto_number',
      label: 'STO No',
      defaultVisible: true,
      sortable: true,
      getSortValue: (o) => o.sto_number || '',
      render: (o) => (
        <span className="text-sm truncate block max-w-full" title={o.sto_number || ''}>
          {o.sto_number || '-'}
        </span>
      )
    },
    {
      id: 'sto_quantity',
      label: 'STO Quantity',
      defaultVisible: true,
      sortable: true,
      getSortValue: (o) => o.sto_quantity || 0,
      render: (o) => (
        <span className="text-sm break-words">
          {formatKg(o.sto_quantity || 0)}
        </span>
      )
    },
    {
      id: 'location',
      label: 'Location',
      defaultVisible: false,
      sortable: true,
      getSortValue: (o) => o.location || '',
      render: (o) => <span className="text-sm break-words">{o.location || '-'}</span>
    },
    {
      id: 'loading_location',
      label: 'Truck Loading Location',
      defaultVisible: true,
      sortable: true,
      getSortValue: (o) => o.loading_location || o.location || '',
      render: (o) => <span className="text-sm break-words">{o.loading_location || o.location || '-'}</span>
    },
    {
      id: 'unloading_location',
      label: 'Truck Discharge Location',
      defaultVisible: true,
      sortable: true,
      getSortValue: (o) => o.unloading_location || '',
      render: (o) => <span className="text-sm break-words">{o.unloading_location || '-'}</span>
    },
    {
      id: 'trucking_owner',
      label: 'Trucking Owner',
      defaultVisible: true,
      sortable: true,
      getSortValue: (o) => o.trucking_owner || '',
      render: (o) => <span className="text-sm break-words">{o.trucking_owner || '-'}</span>
    },
    {
      id: 'supplier',
      label: 'Supplier',
      defaultVisible: true,
      sortable: true,
      getSortValue: (o) => o.supplier || '',
      render: (o) => <span className="text-sm break-words">{o.supplier || '-'}</span>
    },
    {
      id: 'product',
      label: 'Product',
      defaultVisible: true,
      sortable: true,
      getSortValue: (o) => o.product || '',
      render: (o) => <span className="text-sm break-words">{o.product || '-'}</span>
    },
    {
      id: 'incoterm',
      label: 'Incoterm',
      defaultVisible: true,
      sortable: true,
      getSortValue: (o) => o.incoterm || '',
      render: (o) => <span className="text-sm break-words">{o.incoterm || '-'}</span>
    },
    {
      id: 'quantity_sent',
      label: 'Qty Sent (Kg)',
      defaultVisible: true,
      sortable: true,
      getSortValue: (o) => o.quantity_sent || 0,
      render: (o) => (
        <span className="text-sm break-words">
          {formatKg(o.quantity_sent)}
        </span>
      )
    },
    {
      id: 'quantity_delivered',
      label: 'Quantity Delivery (Kg)',
      defaultVisible: true,
      sortable: true,
      getSortValue: (o) => o.quantity_delivered || 0,
      render: (o) => (
        <span className="text-sm break-words">
          {formatKg(o.quantity_delivered)}
        </span>
      )
    },
    {
      id: 'quantity_receive',
      label: 'Quantity Receive (Kg)',
      defaultVisible: true,
      sortable: true,
      getSortValue: (o) => o.quantity_receive || o.quantity_delivered || 0,
      render: (o) => (
        <span className="text-sm break-words">
          {formatKg(o.quantity_receive || o.quantity_delivered)}
        </span>
      )
    },
    {
      id: 'gain_loss_percentage',
      label: 'Gain/Loss %',
      formulaHelp: FIELD_HELP.gainLossPct,
      defaultVisible: false,
      sortable: true,
      getSortValue: (o) => o.gain_loss_percentage || 0,
      render: (o) => (
        <span className="text-sm break-words">
          {formatNumber(o.gain_loss_percentage)}%
        </span>
      )
    },
    {
      id: 'gain_loss_amount',
      label: 'Gain/Loss Amount (Kg)',
      formulaHelp: FIELD_HELP.gainLossAmount,
      defaultVisible: false,
      sortable: true,
      getSortValue: (o) => o.gain_loss_amount || 0,
      render: (o) => (
        <span className="text-sm break-words">
          {formatKg(o.gain_loss_amount)}
        </span>
      )
    },
    {
      id: 'oa_budget',
      label: 'Trucking OA Budget',
      formulaHelp: FIELD_HELP.truckingOaBudget,
      defaultVisible: true,
      sortable: true,
      getSortValue: (o) => o.oa_budget || 0,
      render: (o) => (
        <span className="text-sm break-words">
          {formatNumber(o.oa_budget)}
        </span>
      )
    },
    {
      id: 'oa_actual',
      label: 'Trucking OA Actual',
      formulaHelp: FIELD_HELP.truckingOaActual,
      defaultVisible: true,
      sortable: true,
      getSortValue: (o) => o.oa_actual || 0,
      render: (o) => (
        <span className="text-sm break-words">
          {formatNumber(o.oa_actual)}
        </span>
      )
    },
    {
      id: 'estimated_km',
      label: 'Estimated KM',
      defaultVisible: true,
      sortable: true,
      getSortValue: (o) => o.estimated_km || 0,
      render: (o) => (
        <span className="text-sm break-words">
          {o.estimated_km ? `${formatNumber(o.estimated_km)} km` : '-'}
        </span>
      )
    },
    {
      id: 'cargo_readiness_date',
      label: 'Cargo Readiness',
      defaultVisible: false,
      sortable: true,
      getSortValue: (o) => o.cargo_readiness_date || '',
      render: (o) => <span className="text-sm">{formatShortDate(o.cargo_readiness_date)}</span>
    },
    {
      id: 'trucking_start_date',
      label: 'Trucking Start Receive Date',
      defaultVisible: true,
      sortable: true,
      getSortValue: (o) => o.trucking_start_date || '',
      render: (o) => <span className="text-sm">{formatShortDate(o.trucking_start_date)}</span>
    },
    {
      id: 'trucking_completion_date',
      label: 'Trucking Last Receive Date',
      defaultVisible: true,
      sortable: true,
      getSortValue: (o) => o.trucking_completion_date || '',
      render: (o) => <span className="text-sm">{formatShortDate(o.trucking_completion_date)}</span>
    },
    // ETA date columns removed from UI
    {
      id: 'delivery_start_date',
      label: 'Due Date Delivery Start',
      formulaHelp: FIELD_HELP.etaVsDueDelivery,
      defaultVisible: true,
      sortable: true,
      getSortValue: (o) => o.delivery_start_date || '',
      render: (o) => <span className="text-sm">{formatShortDate(o.delivery_start_date || '')}</span>
    },
    {
      id: 'delivery_end_date',
      label: 'Due Date Delivery End',
      formulaHelp: FIELD_HELP.etaVsDueDelivery,
      defaultVisible: true,
      sortable: true,
      getSortValue: (o) => o.delivery_end_date || '',
      render: (o) => <span className="text-sm">{formatShortDate(o.delivery_end_date || '')}</span>
    },
    {
      id: 'contract_qty',
      label: 'Contract Qty',
      defaultVisible: true,
      sortable: true,
      getSortValue: (o) => o.contract_qty || 0,
      render: (o) => (
        <span className="text-sm break-words">
          {formatKg(o.contract_qty || 0)}
        </span>
      )
    },
    {
      id: 'buyer',
      label: 'Buyer',
      defaultVisible: false,
      sortable: true,
      getSortValue: (o) => o.buyer || '',
      render: (o) => <span className="text-sm break-words">{o.buyer || '-'}</span>
    },
    {
      id: 'group_name',
      label: 'Group',
      defaultVisible: false,
      sortable: true,
      getSortValue: (o) => o.group_name || '',
      render: (o) => <span className="text-sm break-words">{o.group_name || '-'}</span>
    }
  ], [])

  const defaultVisibleColumnIds = useMemo(() => {
    return compactColumns
      .filter(c => c.defaultVisible && c.render)
      .map(c => c.id)
  }, [compactColumns])

  useEffect(() => {
    if (visibleColumnIds.size === 0) {
      setVisibleColumnIds(new Set(defaultVisibleColumnIds))
    }
  }, [defaultVisibleColumnIds, visibleColumnIds.size])

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (columnOrderIds.length > 0) {
      try {
        localStorage.setItem(columnOrderStorageKey, JSON.stringify(columnOrderIds))
      } catch {}
    }
  }, [columnOrderIds])

  useEffect(() => {
    // Initialize / heal column order with any missing ids.
    const allIds = compactColumns.map((c) => c.id)
    setColumnOrderIds((prev) => {
      const base = prev.length > 0 ? prev : allIds
      const deduped = Array.from(new Set(base))
      const missing = allIds.filter((id) => !deduped.includes(id))
      return [...deduped, ...missing].filter((id) => allIds.includes(id))
    })
    // Load per-user saved view
    let cancelled = false
    ;(async () => {
      try {
        const res = await api.get(`/user-preferences/me?key=${encodeURIComponent(userViewPrefKey)}`)
        const value = res.data?.data?.value
        if (cancelled) return
        const cols = Array.isArray(value?.visibleColumnIds) ? value.visibleColumnIds : Array.isArray(value?.visible) ? value.visible : null
        const order = Array.isArray(value?.columnOrderIds) ? value.columnOrderIds : Array.isArray(value?.order) ? value.order : null
        if (Array.isArray(cols) && cols.length > 0) setVisibleColumnIds(new Set(cols.map((x: any) => String(x))))
        if (Array.isArray(order) && order.length > 0) setColumnOrderIds(order.map((x: any) => String(x)))
      } catch {
        // ignore
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compactColumns])

  const visibleColumns = useMemo(() => {
    const byId = new Map(compactColumns.map((c) => [c.id, c] as const))
    const orderedIds = (columnOrderIds.length > 0 ? columnOrderIds : compactColumns.map((c) => c.id))
      .filter((id) => byId.has(id))
    const orderedAll = orderedIds.map((id) => byId.get(id)!).filter(Boolean)
    const visible = orderedAll.filter((c) => visibleColumnIds.has(c.id))
    // Always include status even if hidden (editing requires it).
    const visibleIds = new Set(visible.map((c) => c.id))
    const statusCol = byId.get('status')
    const withStatus = !visibleIds.has('status') && statusCol ? [...visible, statusCol] : visible
    return withStatus
  }, [columnOrderIds, compactColumns, editingId, visibleColumnIds])

  const handlePageChange = (newPage: number) => {
    if (newPage < 1 || newPage > totalPages || loading) return
    setPage(newPage)
    fetchTruckingOperations(newPage)
  }

  const reorderColumnByDrag = (dragId: string, dropId: string) => {
    if (dragId === dropId) return
    setColumnOrderIds((prev) => {
      const ids = prev.length > 0 ? [...prev] : compactColumns.map((c) => c.id)
      const from = ids.indexOf(dragId)
      const to = ids.indexOf(dropId)
      if (from < 0 || to < 0) return ids
      ids.splice(from, 1)
      ids.splice(to, 0, dragId)
      return ids
    })
  }

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (saveViewTimerRef.current) clearTimeout(saveViewTimerRef.current)
    saveViewTimerRef.current = setTimeout(() => {
      void api
        .post('/user-preferences/me', {
          key: userViewPrefKey,
          value: { visibleColumnIds: Array.from(visibleColumnIds), columnOrderIds },
        })
        .catch(() => {
          /* keep localStorage fallback */
        })
    }, 600)
    return () => {
      if (saveViewTimerRef.current) clearTimeout(saveViewTimerRef.current)
    }
  }, [columnOrderIds, visibleColumnIds])

  const sortedOperations = useMemo(() => {
    const col = compactColumns.find(c => c.id === sortKey)
    if (!col?.sortable || !col.getSortValue) return filteredOperations

    const sorted = [...filteredOperations].sort((a, b) => {
      const aVal = col.getSortValue!(a)
      const bVal = col.getSortValue!(b)
      const dirMul = sortDir === 'asc' ? 1 : -1

      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return (aVal - bVal) * dirMul
      }
      return String(aVal).localeCompare(String(bVal)) * dirMul
    })

    return sorted
  }, [compactColumns, filteredOperations, sortDir, sortKey])

  const toggleColumn = (colId: string) => {
    setVisibleColumnIds(prev => {
      const next = new Set(prev)
      if (next.has(colId)) {
        next.delete(colId)
      } else {
        next.add(colId)
      }
      return next
    })
  }

  const isColumnFilterActive = (colId: string) => {
    const f = columnFilters[colId]
    if (!f) return false
    if (f.emptyOnly) return true
    if (f.type === 'text') return Boolean(f.value && f.value.trim() !== '')
    if (f.type === 'number') return Boolean((f.min && f.min !== '') || (f.max && f.max !== ''))
    if (f.type === 'date') return Boolean((f.from && f.from !== '') || (f.to && f.to !== ''))
    return false
  }

  const clearColumnFilter = (colId: string) => {
    setColumnFilters(prev => {
      const next = { ...prev }
      delete next[colId]
      return next
    })
  }

  const setOrClearFilter = (colId: string, next: ColumnFilter) => {
    const active =
      next.emptyOnly ||
      (next.type === 'text' && Boolean(next.value?.trim())) ||
      (next.type === 'number' && Boolean((next.min && next.min !== '') || (next.max && next.max !== ''))) ||
      (next.type === 'date' && Boolean((next.from && next.from !== '') || (next.to && next.to !== '')))

    setColumnFilters(prev => {
      const copy = { ...prev }
      if (!active) {
        delete copy[colId]
      } else {
        copy[colId] = next
      }
      return copy
    })
  }

  const getColumnWidth = (colId: string): string => {
    const widths: { [key: string]: string } = {
      'late_indicator': '110px',
      'operation_id': '180px',
      'status': '110px',
      'contract_number': '210px',
      'po_number': '130px',
      'sto_number': '130px',
      'sto_quantity': '130px',
      'location': '150px',
      'loading_location': '170px',
      'unloading_location': '180px',
      'trucking_owner': '150px',
      'supplier': '150px',
      'product': '120px',
      'quantity_sent': '130px',
      'quantity_delivered': '150px',
      'quantity_receive': '150px',
      'gain_loss_percentage': '120px',
      'gain_loss_amount': '150px',
      'oa_budget': '150px',
      'oa_actual': '150px',
      'estimated_km': '130px',
      'cargo_readiness_date': '140px',
      'trucking_start_date': '180px',
      'trucking_completion_date': '200px',
      'delivery_start_date': '180px',
      'delivery_end_date': '180px',
      'contract_qty': '130px',
      'buyer': '150px',
      'group_name': '120px'
    }
    return widths[colId] || '120px'
  }

  const tableMinWidthPx = useMemo(() => {
    const colSum = visibleColumns.reduce((sum, c) => sum + columnWidthToPx(getColumnWidth(c.id)), 0)
    return colSum + TRUCKING_ACTIONS_COL_WIDTH
  }, [visibleColumns])

  // Calculate table scroll width (match semantic table width for top scrollbar sync)
  useEffect(() => {
    const calculateWidth = () => {
      const table = bottomScrollRef.current?.querySelector('[data-trucking-list-table]') as HTMLElement | null
      if (table) {
        setTableScrollWidth(table.offsetWidth)
        return
      }
      const bottom = bottomScrollRef.current
      if (bottom) setTableScrollWidth(bottom.scrollWidth)
    }
    calculateWidth()
    const t = window.setTimeout(calculateWidth, 0)
    window.addEventListener('resize', calculateWidth)
    return () => {
      window.clearTimeout(t)
      window.removeEventListener('resize', calculateWidth)
    }
  }, [visibleColumns, sortedOperations, tableMinWidthPx, editingId])

  return (
    <Layout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Trucking Operations</h1>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="border-green-600 text-green-700 hover:bg-green-50"
              onClick={downloadBulkCreateTemplate}
            >
              <Download className="h-4 w-4 mr-2" />
              Download Template
            </Button>
            <input
              type="file"
              accept=".csv,.xlsx,.xls"
              className="hidden"
              id="bulk-create-trucking-input"
              onChange={handleBulkCreateFileChange}
              disabled={bulkCreateUploading}
            />
            <Button
              size="sm"
              variant="outline"
              onClick={() => document.getElementById('bulk-create-trucking-input')?.click()}
              disabled={bulkCreateUploading}
            >
              {bulkCreateUploading ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Uploading...</>
              ) : (
                <><Upload className="h-4 w-4 mr-2" />Upload CSV</>
              )}
            </Button>
            <Button
              size="sm"
              onClick={() => setShowCreateForm(true)}
            >
              <Plus className="h-4 w-4 mr-2" />
              Create New
            </Button>
          </div>
        </div>

        {/* Status Distribution */}
        <Card>
          <CardHeader>
            <CardTitle>Status Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-center gap-3 md:gap-6 overflow-x-auto py-4 px-4">
              {[
                {
                  status: 'PLANNED',
                  label: 'Planned',
                  color: 'bg-blue-100',
                  textColor: 'text-blue-800',
                  badgeColor: 'bg-blue-600',
                  help: FIELD_HELP.truckingStatusPlanned,
                },
                {
                  status: 'IN_PROGRESS',
                  label: 'In Progress',
                  color: 'bg-yellow-100',
                  textColor: 'text-yellow-800',
                  badgeColor: 'bg-yellow-600',
                  help: FIELD_HELP.truckingStatusInProgress,
                },
                {
                  status: 'COMPLETED',
                  label: 'Completed',
                  color: 'bg-green-100',
                  textColor: 'text-green-800',
                  badgeColor: 'bg-green-600',
                  help: FIELD_HELP.truckingStatusCompleted,
                },
                {
                  status: 'CANCELLED',
                  label: 'Cancelled',
                  color: 'bg-red-100',
                  textColor: 'text-red-800',
                  badgeColor: 'bg-red-600',
                  help: FIELD_HELP.truckingStatusCancelled,
                },
              ].map((statusInfo, index, array) => {
                const s = truckingSummary?.status
                const count =
                  statusInfo.status === 'PLANNED' ? Number(s?.planned ?? 0)
                    : statusInfo.status === 'IN_PROGRESS' ? Number(s?.inProgress ?? 0)
                      : statusInfo.status === 'COMPLETED' ? Number(s?.completed ?? 0)
                        : statusInfo.status === 'CANCELLED' ? Number(s?.cancelled ?? 0)
                          : 0
                return (
                  <div key={statusInfo.status} className="flex items-center flex-shrink-0">
                    <div className="relative">
                      {/* Status Circle — hover for help (title) */}
                      <div
                        title={statusInfo.help}
                        className={`relative w-24 h-24 md:w-28 md:h-28 rounded-full ${statusInfo.color} flex items-center justify-center border-2 border-white shadow-lg hover:shadow-xl transition-shadow cursor-help`}
                      >
                        {/* Count Badge */}
                        <div className={`absolute -top-3 -right-3 ${statusInfo.badgeColor} text-white text-xs md:text-sm font-bold rounded-full w-8 h-8 md:w-9 md:h-9 flex items-center justify-center shadow-lg z-10`}>
                          {count}
                        </div>
                        {/* Status Label */}
                        <span className={`text-xs md:text-sm font-semibold ${statusInfo.textColor} text-center px-2 leading-tight`}>
                          {statusInfo.label}
                        </span>
                      </div>
                    </div>
                    {/* Arrow */}
                    {index < array.length - 1 && (
                      <div className="flex-shrink-0 mx-2 md:mx-3">
                        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="text-gray-400">
                          <path d="M9 18L15 12L9 6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>

        {/* View: List vs Daily Planning Deliverables — above main table/calendar */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex rounded-lg border bg-white p-1">
            <button
              type="button"
              onClick={() => setActiveTab('list')}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${activeTab === 'list' ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-100'}`}
            >
              List
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('calendar')}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${activeTab === 'calendar' ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-100'}`}
            >
              Daily Planning Deliverables
            </button>
          </div>
          {activeTab === 'calendar' ? (
            <div className="text-xs text-slate-500 w-full sm:w-auto sm:text-right">
              Enter qty only on days within each row&apos;s Due Start – Due End (gray days are blocked). Amber = unsaved; click Save.
            </div>
          ) : null}
        </div>

        {/* Filters (list + daily planning) */}
        <Card>
          <CardContent className="pt-6">
            <div className="space-y-4">
              <div className="flex flex-wrap gap-4">
              <div className="relative min-w-[12rem] flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 transform text-gray-400" />
                <Input
                  placeholder="Search by Operation ID, Contract Numbers, PO No, or Truck Loading/Discharge..."
                  value={searchDraft}
                  onChange={(e) => setSearchDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      applySearch()
                    }
                  }}
                  className="pl-10"
                />
              </div>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="rounded-lg border px-4 py-2"
              >
                <option value="ALL">All Status</option>
                <option value="PLANNED">Planned</option>
                <option value="IN_PROGRESS">In Progress</option>
                <option value="COMPLETED">Completed</option>
                <option value="CANCELLED">Cancelled</option>
              </select>
              <select
                value={lateIndicatorFilter}
                onChange={(e) => setLateIndicatorFilter(e.target.value)}
                className="rounded-lg border px-4 py-2"
              >
                <option value="ALL">All Late Indicator</option>
                <option value="ON_TIME">On Time</option>
                <option value="LATE">Late</option>
                <option value="NA">N/A</option>
              </select>
              <Input
                placeholder="Truck Loading Location"
                value={loadingLocationFilter}
                onChange={(e) => setLoadingLocationFilter(e.target.value)}
                className="w-full sm:w-48"
              />
              <Input
                placeholder="Truck Discharge Location"
                value={unloadingLocationFilter}
                onChange={(e) => setUnloadingLocationFilter(e.target.value)}
                className="w-full sm:w-48"
              />
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <PerformanceScopeFilters
                  hideGroupPlantFilter={false}
                  incotermOptions={availableIncoterms}
                  selectedIncoterms={selectedIncoterms}
                  onIncotermsChange={setSelectedIncoterms}
                  showProductFilter
                  productOptions={availableProducts}
                  selectedProducts={selectedProducts}
                  onProductsChange={setSelectedProducts}
                  groupPlantOptions={availableGroupPlants}
                  selectedGroupPlants={selectedGroupPlants}
                  onGroupPlantsChange={setSelectedGroupPlants}
                  dateFrom={dateFrom}
                  dateTo={dateTo}
                  onDateFromChange={setDateFrom}
                  onDateToChange={setDateTo}
                  showDateRange={false}
                  incotermEmptyMessage="Loading incoterms..."
                  productEmptyMessage="Loading products..."
                  groupPlantPlaceholder="Select group plant(s)"
                  groupPlantEmptyMessage="No group plants"
                />
              </div>

              <div className="flex flex-wrap items-center gap-4">
                <div className="flex flex-wrap items-center gap-2">
                  <label className="text-sm font-medium text-gray-700">Contract Date:</label>
                  <DateInputDdMmYyyy valueIso={dateFrom} onChangeIso={setDateFrom} className="w-40" />
                  <span className="text-gray-500">to</span>
                  <DateInputDdMmYyyy valueIso={dateTo} onChangeIso={setDateTo} className="w-40" />
                  {hasActiveTruckingFilters ? (
                    <Button
                      type="button"
                      onClick={clearTruckingFilters}
                      variant="ghost"
                      size="sm"
                      className="text-gray-500"
                    >
                      <X className="h-4 w-4 mr-1" />
                      Clear
                    </Button>
                  ) : null}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Calendar is rendered in the main section below (replaces All Trucking Operations on that tab). */}

        {activeTab === 'calendar' && (
          <>
          <Card>
            <CardHeader className="space-y-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <CardTitle className="text-base flex flex-wrap items-center gap-2">
                    Daily Planning Deliverables — Calendar
                    <Badge variant="outline" className="text-[10px]">Unit: Kg</Badge>
                  </CardTitle>
                  <div className="text-xs text-gray-600 mt-1 max-w-xl">
                    Shows operations that overlap the selected month (due delivery / trucking dates). Edit cells or upload CSV/Excel (Contract Ext No, date, quantity) — same validation as the website (due date range, quantity caps).
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative" ref={calendarColumnsRef}>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setCalendarColumnsOpen((v) => !v)}
                    >
                      <SlidersHorizontal className="h-4 w-4 mr-1" />
                      Columns
                    </Button>
                    {calendarColumnsOpen ? (
                      <div className="absolute right-0 mt-2 w-72 rounded-md border bg-white shadow-md z-50 p-3">
                        <div className="text-xs font-semibold text-gray-600 mb-2">Visible columns (Daily Planning)</div>
                        <div className="space-y-2 max-h-72 overflow-auto pr-1">
                          {[
                            { id: 'operation_id', label: 'Operation ID' },
                            { id: 'contract_block', label: 'Contract Ext No / STO / Supplier' },
                            { id: 'owner', label: 'Owner' },
                            { id: 'due_start', label: 'Due Start' },
                            { id: 'due_end', label: 'Due End' },
                            { id: 'qty_sent', label: 'Qty Sent' },
                            { id: 'qty_sent_planning', label: 'Qty Sent (planning)' },
                            { id: 'qty_delivered', label: 'Qty Delivered' },
                            { id: 'qty_received', label: 'Qty Received' },
                            { id: 'source_type', label: 'Source Type' },
                            { id: 'lt_spot', label: 'LT/SPOT' },
                            { id: 'product', label: 'Product' },
                            { id: 'group_name', label: 'Group Name' },
                            { id: 'supplier', label: 'Supplier' },
                            { id: 'outstanding_quantity', label: 'Outstanding Quantity' },
                          ].map((c) => (
                            <label key={c.id} className="flex items-center gap-2 text-sm cursor-pointer select-none">
                              <Checkbox
                                checked={calendarVisibleMetaCols.has(c.id)}
                                onCheckedChange={() => {
                                  setCalendarVisibleMetaCols((prev) => {
                                    const next = new Set(prev)
                                    if (next.has(c.id)) next.delete(c.id)
                                    else next.add(c.id)
                                    return next
                                  })
                                }}
                              />
                              <span>{c.label}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                  <Button type="button" variant="outline" size="sm" onClick={downloadDailyPlanningTemplate}>
                    <Download className="h-4 w-4 mr-1" />
                    Template
                  </Button>
                  <input
                    ref={planningFileInputRef}
                    type="file"
                    accept=".csv,.xlsx,.xls,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
                    className="hidden"
                    onChange={handleDailyPlanningFileChange}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={planningUploading}
                    onClick={() => planningFileInputRef.current?.click()}
                  >
                    {planningUploading ? (
                      <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                    ) : (
                      <Upload className="h-4 w-4 mr-1" />
                    )}
                    Upload
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    disabled={!calendarHasUnsavedChanges || calendarSavingAll || calendarLoading}
                    onClick={() => void saveAllCalendarDrafts()}
                    className="bg-green-600 hover:bg-green-700 text-white"
                  >
                    {calendarSavingAll ? (
                      <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                    ) : (
                      <Save className="h-4 w-4 mr-1" />
                    )}
                    Save
                  </Button>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCalendarMonth((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1))}
                >
                  <ArrowLeft className="h-4 w-4 mr-1" /> Prev
                </Button>
                <select
                  className="h-9 rounded-md border border-input bg-background px-2 text-sm min-w-[140px]"
                  value={calendarMonth.getMonth()}
                  onChange={(e) => {
                    const m = Number(e.target.value)
                    setCalendarMonth(new Date(calendarMonth.getFullYear(), m, 1))
                  }}
                  aria-label="Month"
                >
                  {Array.from({ length: 12 }, (_, i) => (
                    <option key={i} value={i}>
                      {format(new Date(2000, i, 1), 'MMMM')}
                    </option>
                  ))}
                </select>
                <select
                  className="h-9 rounded-md border border-input bg-background px-2 text-sm min-w-[88px]"
                  value={calendarMonth.getFullYear()}
                  onChange={(e) => {
                    const y = Number(e.target.value)
                    setCalendarMonth(new Date(y, calendarMonth.getMonth(), 1))
                  }}
                  aria-label="Year"
                >
                  {planningYearOptions.map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCalendarMonth((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1))}
                >
                  Next <ArrowRight className="h-4 w-4 ml-1" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const d = new Date()
                    setCalendarMonth(new Date(d.getFullYear(), d.getMonth(), 1))
                  }}
                >
                  Today
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <CalendarDeliverablesTable
                month={calendarMonth}
                rows={calendarRows}
                loading={calendarLoading}
                savingAll={calendarSavingAll}
                cellDrafts={calendarCellDrafts}
                cellBaseline={calendarSavedBaseline}
                formatQty={formatTruckingQtyPlain}
                visibleMetaCols={calendarVisibleMetaCols}
                metaOrderIds={calendarMetaOrderIds}
                onReorderMetaCols={reorderCalendarMetaCols}
                onCellChange={(id, date, value) => {
                  const key = `${id}:${date}`
                  setCalendarCellDrafts((prev) => ({ ...prev, [key]: value }))
                }}
              />
            </CardContent>
          </Card>

          <Dialog open={planningUploadOpen} onOpenChange={setPlanningUploadOpen}>
            <DialogContent className="max-w-2xl max-h-[88vh]">
              <DialogHeader>
                <DialogTitle>Daily planning upload result</DialogTitle>
              </DialogHeader>
              {planningUploadSummary ? (
                <div className="space-y-4 text-sm">
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    <div className="rounded-md border bg-slate-50 px-3 py-2">
                      <div className="text-xs text-muted-foreground">Rows processed</div>
                      <div className="text-lg font-semibold tabular-nums">{planningUploadSummary.processedRows}</div>
                    </div>
                    <div className="rounded-md border bg-green-50 px-3 py-2">
                      <div className="text-xs text-muted-foreground">Operations succeeded</div>
                      <div className="text-lg font-semibold tabular-nums text-green-800">{planningUploadSummary.succeededOperations}</div>
                    </div>
                    <div className="rounded-md border bg-red-50 px-3 py-2">
                      <div className="text-xs text-muted-foreground">Operations failed</div>
                      <div className="text-lg font-semibold tabular-nums text-red-800">{planningUploadSummary.failedOperations}</div>
                    </div>
                    <div className="rounded-md border bg-slate-50 px-3 py-2">
                      <div className="text-xs text-muted-foreground">Rows applied (success)</div>
                      <div className="text-lg font-semibold tabular-nums">{planningUploadSummary.succeededRows}</div>
                    </div>
                    <div className="rounded-md border bg-amber-50 px-3 py-2">
                      <div className="text-xs text-muted-foreground">Row-level issues</div>
                      <div className="text-lg font-semibold tabular-nums text-amber-900">{planningUploadSummary.rowLevelIssues}</div>
                    </div>
                  </div>
                  {(planningUploadSummary.rowParseFailures?.length ?? 0) > 0 ? (
                    <div>
                      <div className="font-medium text-gray-900 mb-2">Row issues (file line #)</div>
                      <ul className="max-h-40 overflow-auto rounded border bg-white text-xs space-y-1 p-2">
                        {planningUploadSummary.rowParseFailures.map((f, i) => (
                          <li key={`rpf-${i}`} className="text-gray-800">
                            <span className="font-mono">Line {f.rowNumber}</span>
                            {f.contract_ext_no ? ` · ${f.contract_ext_no}` : ''}: {f.reason}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {(planningUploadSummary.operationFailures?.length ?? 0) > 0 ? (
                    <div>
                      <div className="font-medium text-gray-900 mb-2">Operation failures</div>
                      <ul className="max-h-48 overflow-auto rounded border bg-white text-xs space-y-2 p-2">
                        {planningUploadSummary.operationFailures.map((f, i) => (
                          <li key={`of-${i}`} className="text-gray-800">
                            <span className="font-semibold">{f.contract_ext_no}</span>
                            {f.rowNumbers?.length ? (
                              <span className="text-gray-600"> (rows {f.rowNumbers.join(', ')})</span>
                            ) : null}
                            {f.operation_ids?.length ? (
                              <span className="text-gray-600"> · Operation IDs: {f.operation_ids.join(', ')}</span>
                            ) : null}
                            : {f.reason}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </DialogContent>
          </Dialog>
          </>
        )}

        {/* Bulk Create Trucking Result Modal */}
        <Dialog open={bulkCreateUploadOpen} onOpenChange={setBulkCreateUploadOpen}>
          <DialogContent className="max-w-2xl max-h-[88vh]">
            <DialogHeader>
              <DialogTitle>Bulk create trucking upload result</DialogTitle>
            </DialogHeader>
            {bulkCreateSummary ? (
              <div className="space-y-4 text-sm">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  <div className="rounded-md border bg-slate-50 px-3 py-2">
                    <div className="text-xs text-muted-foreground">Rows processed</div>
                    <div className="text-lg font-semibold tabular-nums">{bulkCreateSummary.processedRows}</div>
                  </div>
                  <div className="rounded-md border bg-green-50 px-3 py-2">
                    <div className="text-xs text-muted-foreground">Operations created</div>
                    <div className="text-lg font-semibold tabular-nums text-green-800">{bulkCreateSummary.operationsCreated}</div>
                  </div>
                  <div className="rounded-md border bg-red-50 px-3 py-2">
                    <div className="text-xs text-muted-foreground">Operations failed</div>
                    <div className="text-lg font-semibold tabular-nums text-red-800">{bulkCreateSummary.operationsFailed}</div>
                  </div>
                  <div className="rounded-md border bg-slate-50 px-3 py-2">
                    <div className="text-xs text-muted-foreground">Rows applied (success)</div>
                    <div className="text-lg font-semibold tabular-nums">{bulkCreateSummary.succeededRows}</div>
                  </div>
                </div>
                {(bulkCreateSummary.rowParseFailures?.length ?? 0) > 0 && (
                  <div>
                    <div className="font-medium text-gray-900 mb-2">Row issues</div>
                    <ul className="max-h-40 overflow-auto rounded border bg-white text-xs space-y-1 p-2">
                      {bulkCreateSummary.rowParseFailures.map((f, i) => (
                        <li key={`rpf-${i}`} className="text-gray-800">
                          <span className="font-mono">Line {f.rowNumber}</span>
                          {f.contract_ext_no ? ` · ${f.contract_ext_no}` : ''}: {f.reason}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {(bulkCreateSummary.operationFailures?.length ?? 0) > 0 && (
                  <div>
                    <div className="font-medium text-gray-900 mb-2">Operation failures</div>
                    <ul className="max-h-48 overflow-auto rounded border bg-white text-xs space-y-2 p-2">
                      {bulkCreateSummary.operationFailures.map((f, i) => (
                        <li key={`of-${i}`} className="text-gray-800">
                          <span className="font-semibold">{f.contract_ext_no}</span>
                          {f.rowNumbers?.length ? (
                            <span className="text-gray-600"> (rows {f.rowNumbers.join(', ')})</span>
                          ) : null}
                          : {f.reason}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ) : null}
          </DialogContent>
        </Dialog>

        {/* Trucking Operations List */}
        {activeTab === 'list' && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>All Trucking Operations</CardTitle>
                <p className="text-sm text-gray-500 mt-1">
                  {totalCount} total operations
                  {truckingOperations.length > 0 && ` | Showing ${truckingOperations.length} on this page`}
                  {totalPages > 1 && ` (Page ${page} of ${totalPages})`}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowColumnsMenu(v => !v)}
                    disabled={loading}
                  >
                    <SlidersHorizontal className="h-4 w-4 mr-2" />
                    Columns
                  </Button>
                  {showColumnsMenu && (
                    <div className="absolute right-0 mt-2 w-64 rounded-md border bg-white shadow-md z-50 p-3">
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <div className="text-xs font-semibold text-gray-600">Visible columns</div>
                        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setShowColumnsMenu(false)}>
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                      <div className="flex items-center gap-1 mb-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="flex-1 text-xs h-7"
                          onClick={() => setVisibleColumnIds(new Set(compactColumns.map(c => c.id)))}
                        >
                          Select All
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="flex-1 text-xs h-7"
                          onClick={() => setVisibleColumnIds(new Set(['operation_id', 'status']))}
                        >
                          Unselect All
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="flex-1 text-xs h-7"
                          onClick={() => setVisibleColumnIds(new Set(defaultVisibleColumnIds))}
                        >
                          Reset
                        </Button>
                      </div>
                      <div className="border-t pt-2 space-y-1 max-h-72 overflow-auto pr-1">
                        {(() => {
                          const excluded = new Set(['operation_id', 'status'])
                          const byId = new Map(compactColumns.map(c => [c.id, c] as const))
                          const orderedIds = columnOrderIds.length > 0 ? columnOrderIds : compactColumns.map(c => c.id)
                          const visibleInMenu = orderedIds.map(id => byId.get(id)).filter((c): c is typeof compactColumns[0] => !!c && !excluded.has(c.id) && visibleColumnIds.has(c.id))
                          const hiddenCols = orderedIds.map(id => byId.get(id)).filter((c): c is typeof compactColumns[0] => !!c && !excluded.has(c.id) && !visibleColumnIds.has(c.id)).sort((a, b) => a.label.localeCompare(b.label))
                          return [...visibleInMenu, ...hiddenCols]
                        })().map(col => (
                          <div
                            key={col.id}
                            draggable
                            onDragStart={() => setDragColId(col.id)}
                            onDragEnd={() => setDragColId(null)}
                            onDragOver={e => e.preventDefault()}
                            onDrop={() => { if (dragColId && dragColId !== col.id) reorderColumnByDrag(dragColId, col.id) }}
                            className={`flex items-center gap-2 text-sm cursor-grab select-none rounded px-1 py-0.5 ${dragColId === col.id ? 'opacity-40' : 'hover:bg-gray-50'}`}
                          >
                            <GripVertical className="h-3.5 w-3.5 text-gray-400 shrink-0" />
                            <label className="flex items-center gap-2 cursor-pointer flex-1 min-w-0">
                              <Checkbox
                                checked={visibleColumnIds.has(col.id)}
                                onCheckedChange={() => toggleColumn(col.id)}
                              />
                              <span className="truncate">{col.label}</span>
                            </label>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                {totalPages > 1 && (
                  <div className="flex items-center gap-2 border-l border-gray-200 pl-2 ml-1">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handlePageChange(page - 1)}
                      disabled={page <= 1 || loading}
                    >
                      Previous
                    </Button>
                    <div className="flex items-center gap-1">
                      {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                        let pageNum: number
                        if (totalPages <= 5) {
                          pageNum = i + 1
                        } else if (page <= 3) {
                          pageNum = i + 1
                        } else if (page >= totalPages - 2) {
                          pageNum = totalPages - 4 + i
                        } else {
                          pageNum = page - 2 + i
                        }
                        return (
                          <Button
                            key={pageNum}
                            variant={page === pageNum ? 'default' : 'outline'}
                            size="sm"
                            onClick={() => handlePageChange(pageNum)}
                            disabled={loading}
                            className="min-w-[40px]"
                          >
                            {pageNum}
                          </Button>
                        )
                      })}
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handlePageChange(page + 1)}
                      disabled={page >= totalPages || loading}
                    >
                      Next
                    </Button>
                  </div>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {showCreateForm ? (
              <div className="text-center py-8 text-gray-500">
                Create form is open. Close it to view the trucking list.
              </div>
            ) : loading ? (
              <div className="text-center py-8">Loading trucking operations...</div>
            ) : (
              <>
                {/* Desktop compact table */}
                <div className="hidden lg:block border rounded-lg overflow-hidden">
                  {/* Top scrollbar (synced) */}
                  <div
                    ref={topScrollRef}
                    className="overflow-x-auto border-b bg-white"
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
                    className="overflow-x-auto"
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
                      data-trucking-list-table
                      className="w-full table-fixed border-collapse"
                      style={{ minWidth: tableMinWidthPx }}
                    >
                      <colgroup>
                        {visibleColumns.map((c) => (
                          <col key={c.id} style={{ width: getColumnWidth(c.id) }} />
                        ))}
                        <col style={{ width: TRUCKING_ACTIONS_COL_WIDTH }} />
                      </colgroup>
                      <thead>
                      <tr className="text-xs font-semibold text-gray-600 bg-gray-50 border-b">
                        {visibleColumns.map(col => {
                          const active = sortKey === col.id
                          const filterActive = isColumnFilterActive(col.id)
                          const filterType = getFilterTypeForColumn(col.id)
                          const current = columnFilters[col.id]

                          return (
                            <th
                              key={col.id}
                              scope="col"
                              className={`relative min-w-0 px-3 py-2 text-left align-bottom font-semibold cursor-move ${dragColId === col.id ? 'opacity-60' : ''}`}
                              draggable
                              onDragStart={(e) => {
                                setDragColId(col.id)
                                e.dataTransfer.setData('text/plain', col.id)
                                e.dataTransfer.effectAllowed = 'move'
                              }}
                              onDragEnd={() => setDragColId(null)}
                              onDragOver={(e) => {
                                e.preventDefault()
                                e.dataTransfer.dropEffect = 'move'
                              }}
                              onDrop={(e) => {
                                e.preventDefault()
                                const dragged = e.dataTransfer.getData('text/plain')
                                if (dragged) reorderColumnByDrag(dragged, col.id)
                                setDragColId(null)
                              }}
                            >
                              <div className="flex items-center gap-1 min-w-0">
                                <button
                                  type="button"
                                  className={`flex items-center gap-1 text-left min-w-0 ${col.sortable ? 'hover:text-gray-900' : ''}`}
                                  onClick={() => {
                                    if (col.sortable) {
                                      if (sortKey === col.id) {
                                        setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
                                      } else {
                                        setSortKey(col.id)
                                        setSortDir('asc')
                                      }
                                      setPage(1)
                                      fetchTruckingOperations(1)
                                    }
                                  }}
                                  title={col.sortable ? 'Sort' : undefined}
                                >
                                  <span className="truncate">{col.label}</span>
                                  {col.formulaHelp ? <FieldHelp text={col.formulaHelp} /> : null}
                                  {col.sortable && active && (
                                    sortDir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
                                  )}
                                </button>

                                <button
                                  type="button"
                                  className={`p-1 rounded hover:bg-gray-100 ${filterActive ? 'text-blue-700' : 'text-gray-500'}`}
                                  title="Filter"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    setOpenHeaderFilterId(prev => (prev === col.id ? null : col.id))
                                  }}
                                >
                                  <Filter className="h-3.5 w-3.5" />
                                </button>
                              </div>

                              {openHeaderFilterId === col.id && (
                                <div
                                  ref={headerFilterPopoverRef}
                                  className="absolute left-0 top-full mt-2 w-[280px] bg-white border border-gray-200 rounded-lg shadow-lg p-3 z-30"
                                  onClick={(e) => e.stopPropagation()}
                                  onMouseDown={(e) => e.stopPropagation()}
                                >
                                  <div className="flex items-center justify-between mb-2">
                                    <div className="text-xs font-semibold text-gray-700 truncate">{col.label} Filter</div>
                                    <button
                                      type="button"
                                      className="text-xs text-gray-500 hover:text-gray-800"
                                      onClick={() => setOpenHeaderFilterId(null)}
                                    >
                                      Close
                                    </button>
                                  </div>

                                  {/* Text filter */}
                                  {filterType === 'text' && (
                                    <div className="space-y-2">
                                      <Input
                                        value={(current?.type === 'text' && current.value) ? current.value : ''}
                                        onChange={(e) => {
                                          const value = e.target.value
                                          setOrClearFilter(col.id, {
                                            type: 'text',
                                            value,
                                            exact: current?.type === 'text' ? Boolean(current.exact) : false,
                                            emptyOnly: current?.type === 'text' ? Boolean(current.emptyOnly) : false,
                                            notBlankOnly: current?.type === 'text' ? Boolean((current as any).notBlankOnly) : false,
                                          })
                                        }}
                                        onKeyDown={(e) => {
                                          if (e.key === 'Enter') {
                                            e.preventDefault()
                                            setPage(1)
                                            fetchTruckingOperations(1)
                                          }
                                        }}
                                        placeholder="Type to filter (contains)"
                                        className="h-8 text-sm"
                                      />
                                      <div className="flex flex-col gap-2">
                                        <label className="flex items-center gap-2 text-xs text-gray-700">
                                          <Checkbox
                                            checked={current?.type === 'text' ? Boolean(current.exact) : false}
                                            onCheckedChange={(checked) => {
                                              const value = current?.type === 'text' ? current.value : ''
                                              setOrClearFilter(col.id, {
                                                type: 'text',
                                                value,
                                                exact: Boolean(checked),
                                                emptyOnly: current?.type === 'text' ? Boolean(current.emptyOnly) : false,
                                              })
                                            }}
                                          />
                                          Exact match
                                        </label>
                                        <label className="flex items-center gap-2 text-xs text-gray-700">
                                          <Checkbox
                                            checked={Boolean(current?.emptyOnly)}
                                            onCheckedChange={(checked) => {
                                              const value = current?.type === 'text' ? current.value : ''
                                              setOrClearFilter(col.id, {
                                                type: 'text',
                                                value,
                                                exact: current?.type === 'text' ? Boolean(current.exact) : false,
                                                emptyOnly: Boolean(checked),
                                                notBlankOnly: current?.type === 'text' ? Boolean((current as any).notBlankOnly) : false,
                                              })
                                            }}
                                          />
                                          Only blanks
                                        </label>
                                        <label className="flex items-center gap-2 text-xs text-gray-700">
                                          <Checkbox
                                            checked={Boolean((current as any)?.notBlankOnly)}
                                            onCheckedChange={(checked) => {
                                              const value = current?.type === 'text' ? current.value : ''
                                              setOrClearFilter(col.id, {
                                                type: 'text',
                                                value,
                                                exact: current?.type === 'text' ? Boolean(current.exact) : false,
                                                emptyOnly: current?.type === 'text' ? Boolean(current.emptyOnly) : false,
                                                notBlankOnly: Boolean(checked),
                                              })
                                            }}
                                          />
                                          Only not blanks
                                        </label>
                                      </div>
                                    </div>
                                  )}

                                  {/* Number filter */}
                                  {filterType === 'number' && (
                                    <div className="space-y-2">
                                      <div className="grid grid-cols-2 gap-2">
                                        <Input
                                          value={(current?.type === 'number' && current.min) ? current.min : ''}
                                          onChange={(e) => {
                                            const min = e.target.value
                                            const max = current?.type === 'number' ? current.max : ''
                                            setOrClearFilter(col.id, { type: 'number', min, max, emptyOnly: Boolean(current?.emptyOnly), notBlankOnly: Boolean((current as any)?.notBlankOnly) })
                                          }}
                                          onKeyDown={(e) => {
                                            if (e.key === 'Enter') {
                                              e.preventDefault()
                                              setPage(1)
                                              fetchTruckingOperations(1)
                                            }
                                          }}
                                          placeholder="Min"
                                          className="h-8 text-sm"
                                        />
                                        <Input
                                          value={(current?.type === 'number' && current.max) ? current.max : ''}
                                          onChange={(e) => {
                                            const max = e.target.value
                                            const min = current?.type === 'number' ? current.min : ''
                                            setOrClearFilter(col.id, { type: 'number', min, max, emptyOnly: Boolean(current?.emptyOnly), notBlankOnly: Boolean((current as any)?.notBlankOnly) })
                                          }}
                                          onKeyDown={(e) => {
                                            if (e.key === 'Enter') {
                                              e.preventDefault()
                                              setPage(1)
                                              fetchTruckingOperations(1)
                                            }
                                          }}
                                          placeholder="Max"
                                          className="h-8 text-sm"
                                        />
                                      </div>
                                      <label className="flex items-center gap-2 text-xs text-gray-700">
                                        <Checkbox
                                          checked={Boolean(current?.emptyOnly)}
                                          onCheckedChange={(checked) => {
                                            const min = current?.type === 'number' ? current.min : ''
                                            const max = current?.type === 'number' ? current.max : ''
                                            setOrClearFilter(col.id, { type: 'number', min, max, emptyOnly: Boolean(checked), notBlankOnly: Boolean((current as any)?.notBlankOnly) })
                                          }}
                                        />
                                        Only blanks
                                      </label>
                                      <label className="flex items-center gap-2 text-xs text-gray-700">
                                        <Checkbox
                                          checked={Boolean((current as any)?.notBlankOnly)}
                                          onCheckedChange={(checked) => {
                                            const min = current?.type === 'number' ? current.min : ''
                                            const max = current?.type === 'number' ? current.max : ''
                                            setOrClearFilter(col.id, { type: 'number', min, max, emptyOnly: Boolean(current?.emptyOnly), notBlankOnly: Boolean(checked) })
                                          }}
                                        />
                                        Only not blanks
                                      </label>
                                    </div>
                                  )}

                                  {/* Date filter */}
                                  {filterType === 'date' && (
                                    <div className="space-y-2">
                                      <div className="grid grid-cols-2 gap-2">
                                        <Input
                                          type="date"
                                          value={(current?.type === 'date' && current.from) ? current.from : ''}
                                          onChange={(e) => {
                                            const from = e.target.value
                                            const to = current?.type === 'date' ? current.to : ''
                                            setOrClearFilter(col.id, { type: 'date', from, to, emptyOnly: Boolean(current?.emptyOnly), notBlankOnly: Boolean((current as any)?.notBlankOnly) })
                                          }}
                                          onKeyDown={(e) => {
                                            if (e.key === 'Enter') {
                                              e.preventDefault()
                                              setPage(1)
                                              fetchTruckingOperations(1)
                                            }
                                          }}
                                          className="h-8 text-sm"
                                        />
                                        <Input
                                          type="date"
                                          value={(current?.type === 'date' && current.to) ? current.to : ''}
                                          onChange={(e) => {
                                            const to = e.target.value
                                            const from = current?.type === 'date' ? current.from : ''
                                            setOrClearFilter(col.id, { type: 'date', from, to, emptyOnly: Boolean(current?.emptyOnly), notBlankOnly: Boolean((current as any)?.notBlankOnly) })
                                          }}
                                          onKeyDown={(e) => {
                                            if (e.key === 'Enter') {
                                              e.preventDefault()
                                              setPage(1)
                                              fetchTruckingOperations(1)
                                            }
                                          }}
                                          className="h-8 text-sm"
                                        />
                                      </div>
                                      <label className="flex items-center gap-2 text-xs text-gray-700">
                                        <Checkbox
                                          checked={Boolean(current?.emptyOnly)}
                                          onCheckedChange={(checked) => {
                                            const from = current?.type === 'date' ? current.from : ''
                                            const to = current?.type === 'date' ? current.to : ''
                                            setOrClearFilter(col.id, { type: 'date', from, to, emptyOnly: Boolean(checked), notBlankOnly: Boolean((current as any)?.notBlankOnly) })
                                          }}
                                        />
                                        Only blanks
                                      </label>
                                      <label className="flex items-center gap-2 text-xs text-gray-700">
                                        <Checkbox
                                          checked={Boolean((current as any)?.notBlankOnly)}
                                          onCheckedChange={(checked) => {
                                            const from = current?.type === 'date' ? current.from : ''
                                            const to = current?.type === 'date' ? current.to : ''
                                            setOrClearFilter(col.id, { type: 'date', from, to, emptyOnly: Boolean(current?.emptyOnly), notBlankOnly: Boolean(checked) })
                                          }}
                                        />
                                        Only not blanks
                                      </label>
                                    </div>
                                  )}

                                  <div className="flex items-center justify-between mt-3 pt-2 border-t">
                                    <button
                                      type="button"
                                      className="text-xs text-gray-600 hover:text-gray-900"
                                      onClick={() => clearColumnFilter(col.id)}
                                      disabled={!filterActive}
                                    >
                                      Clear
                                    </button>
                                    <div className="text-[11px] text-gray-500">
                                      {filterActive ? 'Filtered' : 'No filter'}
                                    </div>
                                  </div>
                                </div>
                              )}
                            </th>
                          )
                        })}
                        <th
                          scope="col"
                          className="text-center align-bottom font-semibold sticky right-0 z-20 bg-gray-50 border-l border-gray-200 px-2 py-2"
                          style={{ width: TRUCKING_ACTIONS_COL_WIDTH }}
                        >
                          Actions
                        </th>
                      </tr>
                      </thead>

                      <tbody className="divide-y divide-gray-200">
                        {sortedOperations.length === 0 ? (
                          <tr className="bg-white">
                            <td colSpan={visibleColumns.length + 1} className="px-4 py-10 text-center text-gray-500">
                              <Truck className="h-16 w-16 text-gray-400 mx-auto mb-4" />
                              <p>No trucking operations found</p>
                              {searchTerm && <p className="text-sm mt-2">Try adjusting your search filters</p>}
                            </td>
                          </tr>
                        ) : sortedOperations.map((operation, idx) => {
                          const isEditing = editingId === operation.id
                          const stripeClass = idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'
                          return (
                              <tr key={operation.id} className={stripeClass}>
                                {visibleColumns.map(col => (
                                  <td key={col.id} className={`min-w-0 overflow-hidden px-3 py-2 align-middle ${stripeClass}`}>
                                    <div className="flex min-h-[40px] items-center">
                                      {col.id === 'status' && isEditing ? (
                                        operation.status === 'CANCELLED' ? (
                                          <Badge className={getStatusColor('CANCELLED')}>CANCELLED</Badge>
                                        ) : (
                                          <select
                                            value={editedData.status === 'CANCELLED' ? 'CANCELLED' : ''}
                                            onChange={(e) => handleFieldChange('status', e.target.value)}
                                            className="h-8 text-sm px-2 py-1 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 w-full bg-white"
                                          >
                                            <option value="">Select Status</option>
                                            <option value="CANCELLED">CANCELLED</option>
                                          </select>
                                        )
                                      ) : (
                                        col.render(operation)
                                      )}
                                    </div>
                                  </td>
                                ))}
                                <td
                                  className={`sticky right-0 z-10 border-l border-gray-200 px-2 py-2 align-middle ${stripeClass}`}
                                >
                                  <div className="flex items-center justify-end gap-2">
                                    {isEditing ? (
                                      <>
                                        <Button
                                          variant="outline"
                                          size="icon"
                                          onClick={handleCancelEdit}
                                          disabled={saving}
                                          title="Cancel"
                                        >
                                          <X className="h-4 w-4" />
                                        </Button>
                                        <Button
                                          size="icon"
                                          onClick={() => handleSave(operation.id)}
                                          disabled={saving}
                                          title="Save"
                                          className="bg-green-600 hover:bg-green-700 text-white"
                                        >
                                          {saving ? (
                                            <Loader2 className="h-4 w-4 animate-spin" />
                                          ) : (
                                            <Save className="h-4 w-4" />
                                          )}
                                        </Button>
                                      </>
                                    ) : (
                                      <>
                                        <Button
                                          variant="outline"
                                          size="icon"
                                          onClick={() => handleEdit(operation)}
                                          title="Edit"
                                          className="bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100"
                                        >
                                          <Pencil className="h-4 w-4" />
                                        </Button>
                                        <Button
                                          variant="outline"
                                          size="icon"
                                          onClick={() => handleViewDocuments(operation)}
                                          title="Documents"
                                          className="bg-violet-50 border-violet-200 text-violet-700 hover:bg-violet-100"
                                        >
                                          <FileText className="h-4 w-4" />
                                        </Button>
                                        <input
                                          id={`trucking-file-${operation.id}`}
                                          type="file"
                                          accept="application/pdf,image/png,image/jpeg"
                                          className="hidden"
                                          onChange={(e) => handleUploadFileChange(operation, e)}
                                        />
                                        <Button
                                          variant="outline"
                                          size="icon"
                                          onClick={() => document.getElementById(`trucking-file-${operation.id}`)?.click()}
                                          disabled={uploadingId === operation.id}
                                          title="Upload"
                                          className="bg-red-50 border-red-200 text-red-700 hover:bg-red-100"
                                        >
                                          {uploadingId === operation.id ? (
                                            <span className="h-4 w-4 inline-block border-2 border-red-600 border-t-transparent rounded-full animate-spin" />
                                          ) : (
                                            <Upload className="h-4 w-4" />
                                          )}
                                        </Button>
                                      </>
                                    )}
                                  </div>
                                </td>
                              </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Mobile card view */}
                <div className="lg:hidden space-y-4">
                  {sortedOperations.map((operation) => {
                  const isEditing = editingId === operation.id
                  const currentData = isEditing ? editedData : operation

                  return (
                    <div
                      key={operation.id}
                      className={`border rounded-lg transition-colors ${isEditing ? 'border-blue-300 bg-blue-50' : 'hover:bg-gray-50'}`}
                    >
                      <div className="p-4">
                        {/* Header Row */}
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-3">
                            <h3 className="font-semibold text-lg">{operation.operation_id}</h3>
                            {isEditing ? (
                              operation.status === 'CANCELLED' ? (
                                <Badge className={getStatusColor('CANCELLED')}>CANCELLED</Badge>
                              ) : (
                                <select
                                  value={editedData.status === 'CANCELLED' ? 'CANCELLED' : ''}
                                  onChange={(e) => handleFieldChange('status', e.target.value)}
                                  className="px-2 py-1 border border-gray-300 rounded text-sm"
                                >
                                  <option value="">Select Status</option>
                                  <option value="CANCELLED">Cancelled</option>
                                </select>
                              )
                            ) : (
                              <Badge className={getStatusColor(operation.status)}>
                                {operation.status}
                              </Badge>
                            )}
                          </div>
                          <div className="flex gap-2">
                            {isEditing ? (
                              <>
                                <Button variant="outline" size="icon" onClick={handleCancelEdit} disabled={saving} title="Cancel">
                                  <X className="h-4 w-4" />
                                </Button>
                                <Button
                                  size="icon"
                                  onClick={() => handleSave(operation.id)}
                                  disabled={saving}
                                  title="Save"
                                  className="bg-green-600 hover:bg-green-700 text-white"
                                >
                                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                                </Button>
                              </>
                            ) : (
                              <>
                                <Button
                                  variant="outline"
                                  size="icon"
                                  onClick={() => handleEdit(operation)}
                                  title="Edit"
                                  className="bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100"
                                >
                                  <Pencil className="h-4 w-4" />
                                </Button>
                                <Button
                                  variant="outline"
                                  size="icon"
                                  onClick={() => handleViewDocuments(operation)}
                                  title="Documents"
                                  className="bg-violet-50 border-violet-200 text-violet-700 hover:bg-violet-100"
                                >
                                  <FileText className="h-4 w-4" />
                                </Button>
                                <input
                                  id={`trucking-file-${operation.id}`}
                                  type="file"
                                  accept="application/pdf,image/png,image/jpeg"
                                  className="hidden"
                                  onChange={(e) => handleUploadFileChange(operation, e)}
                                />
                                <Button
                                  variant="outline"
                                  size="icon"
                                  onClick={() => document.getElementById(`trucking-file-${operation.id}`)?.click()}
                                  disabled={uploadingId === operation.id}
                                  title="Upload"
                                  className="bg-red-50 border-red-200 text-red-700 hover:bg-red-100"
                                >
                                  {uploadingId === operation.id ? (
                                    <span className="h-4 w-4 inline-block border-2 border-red-600 border-t-transparent rounded-full animate-spin" />
                                  ) : (
                                    <Upload className="h-4 w-4" />
                                  )}
                                </Button>
                              </>
                            )}
                          </div>
                        </div>

                        {/* Contract Info (Read-only) */}
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm mb-3 pb-3 border-b">
                          <div>
                            <div className="text-gray-500">Contract Number</div>
                            <div className="font-medium">{operation.contract_number || '-'}</div>
                          </div>
                          <div>
                            <div className="text-gray-500">Supplier</div>
                            <div className="font-medium">{operation.supplier || '-'}</div>
                          </div>
                          <div>
                            <div className="text-gray-500">Product</div>
                            <div className="font-medium">{operation.product || '-'}</div>
                          </div>
                          <div>
                            <div className="text-gray-500">Group</div>
                            <div className="font-medium">{operation.group_name || '-'}</div>
                          </div>
                        </div>

                        {/* Location & Owner (Editable) */}
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm mb-3">
                          <div>
                            <div className="text-gray-500 mb-1">Location</div>
                            {isEditing ? (
                              <Input
                                value={currentData.location || ''}
                                onChange={(e) => handleFieldChange('location', e.target.value)}
                                className="h-8 text-sm"
                              />
                            ) : (
                              <div className="font-medium">{operation.location || '-'}</div>
                            )}
                          </div>
                          <div>
                            <div className="text-gray-500 mb-1">Trucking Owner</div>
                            {isEditing ? (
                              <Input
                                value={currentData.trucking_owner || ''}
                                onChange={(e) => handleFieldChange('trucking_owner', e.target.value)}
                                className="h-8 text-sm"
                              />
                            ) : (
                              <div className="font-medium">{operation.trucking_owner || '-'}</div>
                            )}
                          </div>
                          <div>
                            <div className="text-gray-500 mb-1">Quantity Sent (Kg)</div>
                            {isEditing ? (
                              <Input
                                type="number"
                                step="0.01"
                                value={currentData.quantity_sent || ''}
                                onChange={(e) => handleFieldChange('quantity_sent', parseFloat(e.target.value))}
                                className="h-8 text-sm"
                              />
                            ) : (
                              <div className="font-medium">{formatNumber(operation.quantity_sent)}</div>
                            )}
                          </div>
                          <div>
                            <div className="text-gray-500 mb-1">Quantity Delivered (Kg)</div>
                            {isEditing ? (
                              <Input
                                type="number"
                                step="0.01"
                                value={currentData.quantity_delivered || ''}
                                onChange={(e) => handleFieldChange('quantity_delivered', parseFloat(e.target.value))}
                                className="h-8 text-sm"
                              />
                            ) : (
                              <div className="font-medium">{formatNumber(operation.quantity_delivered)}</div>
                            )}
                          </div>
                        </div>

                        {/* Additional Fields (Editable) */}
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm mb-3">
                          <div>
                            <div className="text-gray-500 mb-1">Gain/Loss %</div>
                            {isEditing ? (
                              <Input
                                type="number"
                                step="0.01"
                                value={currentData.gain_loss_percentage || ''}
                                onChange={(e) => handleFieldChange('gain_loss_percentage', parseFloat(e.target.value))}
                                className="h-8 text-sm"
                              />
                            ) : (
                              <div className="font-medium">{formatNumber(operation.gain_loss_percentage)}%</div>
                            )}
                          </div>
                          <div>
                            <div className="text-gray-500 mb-1">Gain/Loss Amount (Kg)</div>
                            {isEditing ? (
                              <Input
                                type="number"
                                step="0.01"
                                value={currentData.gain_loss_amount || ''}
                                onChange={(e) => handleFieldChange('gain_loss_amount', parseFloat(e.target.value))}
                                className="h-8 text-sm"
                              />
                            ) : (
                              <div className="font-medium">{formatNumber(operation.gain_loss_amount)}</div>
                            )}
                          </div>
                          <div>
                            <div className="text-gray-500 mb-1">OA Budget</div>
                            {isEditing ? (
                              <Input
                                type="number"
                                step="0.01"
                                value={currentData.oa_budget || ''}
                                onChange={(e) => handleFieldChange('oa_budget', parseFloat(e.target.value))}
                                className="h-8 text-sm"
                              />
                            ) : (
                              <div className="font-medium">{formatNumber(operation.oa_budget)}</div>
                            )}
                          </div>
                          <div>
                            <div className="text-gray-500 mb-1">OA Actual</div>
                            {isEditing ? (
                              <Input
                                type="number"
                                step="0.01"
                                value={currentData.oa_actual || ''}
                                onChange={(e) => handleFieldChange('oa_actual', parseFloat(e.target.value))}
                                className="h-8 text-sm"
                              />
                            ) : (
                              <div className="font-medium">{formatNumber(operation.oa_actual)}</div>
                            )}
                          </div>
                        </div>

                        {/* Dates */}
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm pt-3 border-t">
                          <div>
                            <div className="text-gray-500 mb-1">Cargo Readiness at Starting Location</div>
                            {isEditing ? (
                              <Input
                                type="date"
                                value={currentData.cargo_readiness_date ? currentData.cargo_readiness_date.split('T')[0] : ''}
                                onChange={(e) => handleFieldChange('cargo_readiness_date', e.target.value)}
                                className="h-8 text-sm"
                              />
                            ) : (
                              <div className="font-medium">{formatDate(operation.cargo_readiness_date)}</div>
                            )}
                          </div>
                          <div>
                            <div className="text-gray-500 mb-1">Trucking Last Receive Date</div>
                            <div className="font-medium">{formatDate(operation.trucking_completion_date)}</div>
                          </div>
                          <div>
                            <div className="text-gray-500 mb-1">Due Date Delivery Start</div>
                            <div className="font-medium">{formatDate(operation.delivery_start_date || '')}</div>
                          </div>
                          <div>
                            <div className="text-gray-500 mb-1">Due Date Delivery End</div>
                            <div className="font-medium">{formatDate(operation.delivery_end_date || '')}</div>
                          </div>
                        </div>

                        {/* ETA fields removed */}
                      </div>
                    </div>
                  )
                })}
              </div>

                {totalPages > 1 && (
                  <div className="flex items-center justify-between pt-4 border-t mt-2">
                    <div className="text-sm text-gray-700">
                      Showing page {page} of {totalPages} ({totalCount} total operations)
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handlePageChange(page - 1)}
                        disabled={page <= 1 || loading}
                      >
                        Previous
                      </Button>
                      <div className="flex items-center gap-1">
                        {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                          let pageNum: number
                          if (totalPages <= 5) {
                            pageNum = i + 1
                          } else if (page <= 3) {
                            pageNum = i + 1
                          } else if (page >= totalPages - 2) {
                            pageNum = totalPages - 4 + i
                          } else {
                            pageNum = page - 2 + i
                          }
                          return (
                            <Button
                              key={pageNum}
                              variant={page === pageNum ? 'default' : 'outline'}
                              size="sm"
                              onClick={() => handlePageChange(pageNum)}
                              disabled={loading}
                              className="min-w-[40px]"
                            >
                              {pageNum}
                            </Button>
                          )
                        })}
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handlePageChange(page + 1)}
                        disabled={page >= totalPages || loading}
                      >
                        Next
                      </Button>
                    </div>
                  </div>
                )}
                </>
            )}
          </CardContent>
        </Card>
        )}
      </div>

      {/* Documents Modal */}
      {showDocs && selectedOperation && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white w-full max-w-3xl rounded-lg shadow-lg max-h-[80vh] flex flex-col overflow-hidden">
            <div className="flex shrink-0 items-center justify-between border-b px-6 py-4">
              <h3 className="text-xl font-semibold">Documents — {selectedOperation.operation_id}</h3>
              <Button variant="ghost" size="icon" className="shrink-0" aria-label="Close" onClick={() => setShowDocs(false)}>
                <X className="h-5 w-5" />
              </Button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
            {docsLoading ? (
              <div className="text-sm text-gray-500 py-8 text-center">Loading documents...</div>
            ) : operationDocs.length === 0 ? (
              <div className="text-sm text-gray-500 py-8 text-center">No documents uploaded for this operation.</div>
            ) : (
              <div className="space-y-2">
                {operationDocs.map((doc) => (
                  <div key={doc.id} className="flex items-center justify-between px-4 py-3 border rounded hover:bg-gray-50">
                    <div>
                      <div className="text-sm font-medium">{doc.file_name}</div>
                      <div className="text-xs text-gray-500">
                        {(doc.document_type || 'FILE')} • {doc.created_at ? formatDateTimeDMY(doc.created_at) : ''}
                      </div>
                    </div>
                    <Button 
                      size="sm" 
                      variant="outline"
                      onClick={() => handleDownloadDocument(doc.id, doc.file_name)}
                    >
                      <Download className="h-4 w-4 mr-1" />
                      Download
                    </Button>
                  </div>
                ))}
              </div>
            )}
            </div>
          </div>
        </div>
      )}

      <CreateTruckingOperationModal open={showCreateForm} onClose={() => setShowCreateForm(false)} onCreated={handleCreated} />
    </Layout>
  )
}

export default function TruckingPage() {
  return (
    <Suspense fallback={<Layout><div className="flex items-center justify-center p-8"><div className="text-gray-500">Loading...</div></div></Layout>}>
      <TruckingPageContent />
    </Suspense>
  )
}
