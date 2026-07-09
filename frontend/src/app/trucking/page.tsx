'use client'

import { useEffect, useState, useMemo, useRef, useCallback, Suspense, memo } from 'react'
import { useSearchParams } from 'next/navigation'
import Layout from '@/components/Layout'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Search, Filter, X, Truck, Save, Loader2, Download, Upload, Plus, SlidersHorizontal, Check, ArrowLeft, ArrowRight, FileText, Pencil, GripVertical } from 'lucide-react'
import { DateInputDdMmYyyy } from '@/components/DateInputDdMmYyyy'
import api from '@/lib/api'
import { buildCacheKey, cachedGet, invalidateLogisticsListCaches } from '@/lib/clientDataCache'
import { Checkbox } from '@/components/ui/checkbox'
import { FieldHelp } from '@/components/FieldHelp'
import { FIELD_HELP } from '@/lib/fieldHelpText'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { formatDateDMY, formatDateTimeDMY } from '@/lib/dateFormat'
import { formatOperationalTableTextDisplay, formatSapDisplayValue } from '@/lib/sapDisplayValue'
import { computeLateIndicatorDisplay } from '@/lib/calendarDays'
import { format } from 'date-fns'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { TruckingOutstandingQtyWithTooltip } from '@/components/trucking/TruckingOutstandingQtyWithTooltip'
import { CreateTruckingOperationModal } from '@/components/trucking/CreateTruckingOperationModal'
import { isContractRecordClosed } from '@/lib/contractDeliveryStatus'
import { SearchableMultiSelect } from '@/components/SearchableMultiSelect'
import { PerformanceScopeFilters } from '@/components/performance/PerformanceScopeFilters'
import { useUserScopeFilterDefaults } from '@/hooks/useUserScopeFilterDefaults'
import { markUserScopeFiltersCleared } from '@/lib/userScopeFilters'
import { ContractPerfTableSortHeader } from '@/components/performance/ContractPerfTableSortHeader'
import {
  compareSapStoListRowPriority,
  shouldPrioritizeSapStoRows,
} from '@/lib/listSapStoPriority'
import {
  TableInitialLoadPlaceholder,
  TableInitialLoadPlaceholderContent,
} from '@/components/performance/TableInitialLoadPlaceholder'
import {
  COMPACT_TABLE_ACTIONS_HEADER_STICKY_CLASS,
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
} from '@/lib/compactTableUi'
import { formatQtyMtFromKg } from '@/lib/utils'
import {
  applyHPlusOnePlanningPromotions,
  getHPlusOneIsoDate,
  isDateInDueWindow,
  resolveCalendarCellQtyKg,
} from '@/lib/truckingCalendarActuals'
import {
  buildTruckingActualsTemplateXlsxBlob,
  DOWNLOAD_TEMPLATE_DISABLED_TOOLTIP,
  isActualsTemplateDownloadEnabled,
  isPlannedPlanningTemplateMode,
  isUnplannedPlanningTemplateMode,
  isWidePlanningTemplateFile,
  triggerFailedUnplannedUploadRetemplateDownload,
  type TruckingActualsTemplateRow,
} from '@/lib/truckingActualsTemplate'
import { buildTruckingPlanningTemplateFilename } from '@/lib/truckingTemplateFilename'
import {
  TRUCKING_COLUMN_LAYOUT_VERSION,
  TRUCKING_COLUMN_LAYOUT_VERSION_KEY,
  buildTruckingVisibleColumns,
  mergeTruckingColumnOrder,
  truckingCompactColumnFallbackOrder,
  truckingDefaultVisibleColumnIds,
} from '@/lib/truckingColumns'
import {
  OperationalNowrapCell,
  OperationalStackedCommaCell,
  getOperationalColumnLayout,
  operationalTableColumnClass,
} from '@/lib/operationalTableLayout'
import { appendToolbarMultiToColumnFilters } from '@/lib/globalScopeFilters'

const TRUCKING_ACTIONS_COL_WIDTH = 140

/** Hide header Upload CSV + Create New above Global Filters — set true to restore. */
const TRUCKING_HEADER_CREATE_UPLOAD_UI_ENABLED = false

const TRUCKING_STATUS_LABELS: Record<string, string> = {
  UNPLANNED: 'Unplanned',
  PLANNED: 'Planned',
  IN_PROGRESS: 'In Progress',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
}

/** Parse API qty (kg) — handles numeric strings with commas. */
function parseTruckingQtyKg(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  const n = Number(String(value).replace(/,/g, '').replace(/\s+/g, '').trim())
  return Number.isFinite(n) ? n : null
}

/** Display trucking qty stored in kg as MT (table, calendar, mobile). */
function formatTruckingQtyMt(value: unknown): string {
  const kg = parseTruckingQtyKg(value)
  if (kg === null) return '—'
  if (kg === 0) return '0 MT'
  return formatQtyMtFromKg(kg)
}

/** API daily_deliverables.quantity_delivered is kg; calendar drafts/edits are MT. */
function kgToDailyPlanningMtDraft(kg: number): string {
  if (!Number.isFinite(kg) || kg <= 0) return ''
  const mt = kg / 1000
  const rounded = Math.round(mt * 100) / 100
  return String(rounded)
}

function dailyPlanningMtToKg(mt: number): number {
  return Math.round(mt * 1000 * 100) / 100
}

/** Parse MT qty from calendar cell draft (user input). */
function parseDailyPlanningMtDraft(raw: string): number | 'invalid' {
  const trimmed = raw.trim()
  if (trimmed === '') return 0
  const n = Number(String(raw).replace(/,/g, ''))
  if (!Number.isFinite(n) || n < 0) return 'invalid'
  return n
}

/** Format MT draft for display (no unit suffix — legend above table). */
function formatDailyPlanningQtyMtDisplay(value: unknown): string {
  if (value === null || value === undefined || value === '') return '0.00'
  const n = Number(String(value).replace(/,/g, '').trim())
  if (!Number.isFinite(n)) return '—'
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/** Aligns with list `formatNumber` / `formatKg`: comma thousands, period decimals. */
function formatTruckingQtyPlain(n: number): string {
  if (!Number.isFinite(n)) return '—'
  if (n === 0) return '0'
  return n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2, useGrouping: true })
}

function truckingDbStatus(operation: Pick<TruckingOperation, 'status' | 'status_db'>): string {
  return String(operation.status_db ?? operation.status ?? '').trim().toUpperCase()
}

function truckingStatusLabel(status: string | undefined | null): string {
  const key = String(status ?? '').trim().toUpperCase()
  return TRUCKING_STATUS_LABELS[key] ?? key
}

function isTruckingPlanningEditLocked(status: string | undefined | null): boolean {
  return String(status ?? '').trim().toUpperCase() === 'CANCELLED'
}

function isTruckingEditDisabled(operation: TruckingOperation): boolean {
  return isTruckingPlanningEditLocked(truckingDbStatus(operation))
}

function truckingEditDisabledReason(operation: TruckingOperation): string {
  if (isTruckingPlanningEditLocked(truckingDbStatus(operation))) {
    return 'Edit trucking is not available for cancelled operations'
  }
  return 'Edit Trucking'
}

function truckingEditTooltip(operation: TruckingOperation): string {
  if (isTruckingEditDisabled(operation)) {
    return truckingEditDisabledReason(operation)
  }
  if (isContractRecordClosed(operation)) {
    return 'View Trucking (read-only)'
  }
  return 'Edit Trucking'
}

function isTruckingUnplanned(operation: Pick<TruckingOperation, 'status'>): boolean {
  return String(operation.status ?? '').trim().toUpperCase() === 'UNPLANNED'
}

function isTruckingContractBacklogRow(
  operation: Pick<TruckingOperation, 'row_kind'>,
): boolean {
  return String(operation.row_kind ?? '').trim() === 'contract_backlog'
}

function resolveTruckingDocumentContractId(
  operation: Pick<TruckingOperation, 'contract_id'>,
): string {
  return String(operation.contract_id ?? '').trim()
}

function truckingDocumentScopeLabel(operation: TruckingOperation): string {
  if (isTruckingContractBacklogRow(operation)) {
    const po = String(operation.po_number ?? '').trim()
    const contractNo = String(operation.contract_number ?? '').trim()
    return po ? `PO ${po}` : contractNo || 'Contract'
  }
  return String(operation.operation_id ?? '').trim() || 'Operation'
}

function TruckTableAddTruckingButton({ onAdd }: { onAdd: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          onClick={onAdd}
          className="bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100"
          aria-label="Add Trucking"
        >
          <span className="relative inline-flex h-4 w-4 items-center justify-center">
            <Truck className="h-4 w-4" />
            <Plus className="absolute -bottom-0.5 -right-1 h-2.5 w-2.5 rounded-[1px] bg-white" />
          </span>
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top">Add Trucking</TooltipContent>
    </Tooltip>
  )
}

function TruckTableEditTruckingButton({
  onEdit,
  disabled = false,
  disabledReason = 'Edit Trucking',
  tooltip,
}: {
  onEdit: () => void
  disabled?: boolean
  disabledReason?: string
  tooltip?: string
}) {
  const button = (
    <Button
      variant="outline"
      size="icon"
      onClick={onEdit}
      disabled={disabled}
      className={
        disabled
          ? 'bg-gray-50 border-gray-200 text-gray-400 cursor-not-allowed hover:bg-gray-50'
          : 'bg-amber-50 border-amber-200 text-amber-700 hover:bg-amber-100'
      }
      aria-label={tooltip ?? (disabled ? disabledReason : 'Edit Trucking')}
    >
      <span className="relative inline-flex h-4 w-4 items-center justify-center">
        <Truck className="h-4 w-4" />
        <Pencil className="absolute -bottom-0.5 -right-1 h-2.5 w-2.5 rounded-[1px] bg-white" />
      </span>
    </Button>
  )

  const tooltipText = tooltip ?? (disabled ? disabledReason : 'Edit Trucking')

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {disabled ? <span className="inline-flex">{button}</span> : button}
      </TooltipTrigger>
      <TooltipContent side="top">
        {tooltipText}
      </TooltipContent>
    </Tooltip>
  )
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
  contract_date?: string
  delivery_start_date?: string
  delivery_end_date?: string
  location: string
  loading_location?: string
  unloading_location?: string
  trucking_owner: string
  cargo_readiness_date: string
  planning_start_date?: string
  planning_end_date?: string
  trucking_start_date: string
  trucking_completion_date: string
  eta_trucking_completion_date?: string | null
  quantity_sent: number
  quantity_delivered: number
  quantity_receive?: number
  outstanding_quantity?: number
  gain_loss_percentage: number
  gain_loss_amount: number
  oa_budget: number
  oa_actual: number
  estimated_km?: number
  status: string
  /** Raw DB status — use for edit lock (CANCELLED) when effective status differs. */
  status_db?: string
  // ETA dates removed from UI (kept in DB/backend)
  created_at: string
  supplier: string
  buyer: string
  product: string
  incoterm?: string
  group_name: string
  source_type?: string
  contract_ext_no?: string
  contract_import_status?: string
  sto_numbers?: string | null
  daily_deliverables?: Array<{ date: string; quantity_delivered: number }>
  /** contract_backlog = open PO without trucking op; execution = normal trucking row */
  row_kind?: 'contract_backlog' | string
}

function mergeTruckingSapFields(
  base: TruckingOperation[],
  hydrated: TruckingOperation[],
): TruckingOperation[] {
  if (!hydrated.length) return base
  const byId = new Map<string, TruckingOperation>()
  for (const row of hydrated) {
    if (row.id) byId.set(String(row.id), row)
  }
  return base.map((row) => {
    const match = row.id ? byId.get(String(row.id)) : undefined
    if (!match) return row
    return {
      ...row,
      status: match.status ?? row.status,
      status_db: match.status_db ?? row.status_db,
      contract_ext_no: match.contract_ext_no ?? row.contract_ext_no,
      sto_number: match.sto_number ?? row.sto_number,
      sto_numbers: match.sto_numbers ?? row.sto_numbers,
      quantity_sent: match.quantity_sent ?? row.quantity_sent,
      quantity_delivered: match.quantity_delivered ?? row.quantity_delivered,
      quantity_receive: match.quantity_receive ?? row.quantity_receive,
      outstanding_quantity: match.outstanding_quantity ?? row.outstanding_quantity,
    }
  })
}

function dedupeTruckingOperationsForTemplate(ops: TruckingOperation[]): TruckingOperation[] {
  const seen = new Set<string>()
  return ops.filter((op) => {
    const key = op.id || `${op.contract_number}|${op.po_number ?? ''}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
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
  incoterm?: string
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
  daily_actuals?: Array<{ date: string; quantity_delivered: number }>
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

function buildCalendarCellDrafts(
  rows: TruckingCalendarRow[],
  month: Date,
): Record<string, string> {
  const yyyy = month.getFullYear()
  const mm = month.getMonth()
  const daysInMonth = new Date(yyyy, mm + 1, 0).getDate()
  const tomorrowIso = getHPlusOneIsoDate()
  const drafts: Record<string, string> = {}
  for (const r of rows) {
    for (let d = 1; d <= daysInMonth; d++) {
      const date = `${yyyy}-${String(mm + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
      const qtyKg = resolveCalendarCellQtyKg(r, date, tomorrowIso)
      drafts[`${r.id}:${date}`] = kgToDailyPlanningMtDraft(qtyKg)
    }
  }
  return drafts
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

function buildRowDeliverablesFromDrafts(
  row: TruckingCalendarRow,
  month: Date,
  drafts: Record<string, string>,
): Array<{ date: string; quantity_delivered: number }> {
  const yyyy = month.getFullYear()
  const mm = month.getMonth()
  const daysInMonth = new Date(yyyy, mm + 1, 0).getDate()
  const existing = row.daily_actuals || []
  const outsideMonth = existing.filter(
    (x) => !isDateInCalendarMonth((x?.date || '').slice(0, 10), month),
  )
  const inMonth: Array<{ date: string; quantity_delivered: number }> = []
  for (let d = 1; d <= daysInMonth; d++) {
    const date = `${yyyy}-${String(mm + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    const key = `${row.id}:${date}`
    const qtyMt = parseDailyPlanningMtDraft(drafts[key] ?? '')
    if (qtyMt === 'invalid') throw new Error(`Invalid quantity on ${date}`)
    if (qtyMt > 0) {
      if (!isDateInDueWindow(row, date)) {
        const bounds = getRowDueDateBounds(row)
        throw new Error(
          bounds
            ? `Date ${date} is outside Due Start (${bounds.start}) – Due End (${bounds.end})`
            : `Date ${date} is outside the allowed due delivery window`,
        )
      }
      inMonth.push({ date, quantity_delivered: dailyPlanningMtToKg(qtyMt) })
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

function calendarRowPlannedQtyKg(r: TruckingCalendarRow): number {
  return (r.daily_deliverables || []).reduce((s, x) => s + Number(x?.quantity_delivered || 0), 0)
}

const CALENDAR_STICKY_CONTRACT_COL_IDS = ['contract_ext_no', 'sto_number', 'supplier'] as const

const CALENDAR_STICKY_CONTRACT_COL_WIDTHS: Record<string, number> = {
  contract_ext_no: 140,
  sto_number: 96,
  supplier: 120,
}

const CALENDAR_META_COL_LABELS: Record<string, string> = {
  contract_ext_no: 'Contract Ext No',
  sto_number: 'STO',
  supplier: 'Supplier',
  owner: 'Owner',
  due_start: 'Due Start',
  due_end: 'Due End',
  source_type: 'Source Type',
  lt_spot: 'LT/SPOT',
  product: 'Product',
  group_name: 'Group Name',
  outstanding_quantity: 'Outstanding Qty (MT)',
  qty_sent: 'Qty Sent (MT)',
  qty_sent_planning: 'Qty Sent planning (MT)',
  qty_delivered: 'Delivery Qty (MT)',
  qty_received: 'Received Qty (MT)',
}

const CALENDAR_NUMERIC_SORT_COLS = new Set([
  'outstanding_quantity',
  'qty_sent',
  'qty_sent_planning',
  'qty_delivered',
  'qty_received',
])

function getTruckingCalendarSortValue(
  row: TruckingCalendarRow,
  sortKey: string,
  cellDrafts: Record<string, string>,
): string | number {
  if (sortKey.startsWith('day:')) {
    const date = sortKey.slice(4)
    const qtyMt = parseDailyPlanningMtDraft(cellDrafts[`${row.id}:${date}`] ?? '')
    return qtyMt === 'invalid' ? 0 : qtyMt
  }

  switch (sortKey) {
    case 'operation_id':
      return row.operation_id || ''
    case 'contract_ext_no':
      return row.contract_ext_no || row.contract_number || ''
    case 'sto_number':
      return row.sto_number || ''
    case 'supplier':
      return row.supplier || ''
    case 'owner':
      return row.trucking_owner || ''
    case 'due_start':
      return row.delivery_start_date || ''
    case 'due_end':
      return row.delivery_end_date || ''
    case 'source_type':
      return row.source_type || ''
    case 'lt_spot':
      return row.lt_spot || ''
    case 'product':
      return row.product || ''
    case 'group_name':
      return row.group_name || ''
    case 'outstanding_quantity':
      return Number(row.outstanding_quantity ?? 0)
    case 'qty_sent':
      return Number(row.quantity_sent || 0)
    case 'qty_sent_planning':
      return calendarRowPlannedQtyKg(row)
    case 'qty_delivered':
      return Number(row.quantity_delivered || 0)
    case 'qty_received':
      return Number(row.quantity_receive ?? 0)
    default:
      return ''
  }
}

function compareCalendarSortValues(
  a: string | number,
  b: string | number,
  dir: 'asc' | 'desc',
): number {
  const dirMul = dir === 'asc' ? 1 : -1
  if (typeof a === 'number' && typeof b === 'number') {
    return (a - b) * dirMul
  }
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' }) * dirMul
}

function migrateCalendarVisibleMetaCols(cols: string[]): string[] {
  const next = new Set(cols.map(String))
  if (next.has('contract_block')) {
    next.delete('contract_block')
    next.add('contract_ext_no')
    next.add('sto_number')
    next.add('supplier')
  }
  return Array.from(next)
}

function migrateCalendarMetaOrderIds(order: string[]): string[] {
  const expanded = order.flatMap((id) =>
    id === 'contract_block' ? ['contract_ext_no', 'sto_number', 'supplier'] : [id],
  )
  const seen = new Set<string>()
  const out: string[] = []
  for (const id of expanded) {
    if (id === 'contract_block' || seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
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
  const opShown = visibleMetaCols.has('operation_id')
  const stickyContractCols = CALENDAR_STICKY_CONTRACT_COL_IDS.filter((id) => visibleMetaCols.has(id))
  const stickyLeftByCol = useMemo(() => {
    const positions: Record<string, number> = {}
    let left = 0
    if (opShown) {
      positions.operation_id = 0
      left += operationColW
    }
    for (const id of stickyContractCols) {
      positions[id] = left
      left += CALENDAR_STICKY_CONTRACT_COL_WIDTHS[id] ?? 120
    }
    return positions
  }, [opShown, stickyContractCols])
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
  const sumPlannedQty = (r: TruckingCalendarRow) => calendarRowPlannedQtyKg(r)

  const [sortKey, setSortKey] = useState<string>('operation_id')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  const onSortHeaderClick = useCallback((key: string) => {
    setSortDir((prevDir) => (sortKey === key ? (prevDir === 'asc' ? 'desc' : 'asc') : 'asc'))
    setSortKey(key)
  }, [sortKey])

  const sortedRows = useMemo(() => {
    if (!rows.length) return rows
    return [...rows].sort((a, b) =>
      compareCalendarSortValues(
        getTruckingCalendarSortValue(a, sortKey, cellDrafts),
        getTruckingCalendarSortValue(b, sortKey, cellDrafts),
        sortDir,
      ),
    )
  }, [rows, sortKey, sortDir, cellDrafts])

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
  }, [rows.length, daysInMonth, opShown, stickyContractCols, visibleMetaCols])

  return (
    <div>
      {loading ? (
        <div className="text-center py-10 text-gray-500">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="text-center py-10 text-gray-500">No trucking operations in this month window</div>
      ) : (
        <>
        <p className="text-xs text-gray-500 mb-2">Daily quantity values are in MT.</p>
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
                  <ContractPerfTableSortHeader
                    label="Operation ID"
                    sortable
                    activeSort={sortKey === 'operation_id'}
                    sortDir={sortDir}
                    onSortClick={() => onSortHeaderClick('operation_id')}
                  />
                </th>
              ) : null}
              {stickyContractCols.map((id) => {
                const colW = CALENDAR_STICKY_CONTRACT_COL_WIDTHS[id] ?? 120
                const left = stickyLeftByCol[id] ?? 0
                const label = CALENDAR_META_COL_LABELS[id] ?? id
                return (
                  <th
                    key={id}
                    className="sticky z-20 bg-gray-100 px-3 py-2 text-left font-semibold text-gray-700 border-b border-gray-200"
                    style={{ left, minWidth: colW, maxWidth: colW }}
                  >
                    <ContractPerfTableSortHeader
                      label={label}
                      sortable
                      activeSort={sortKey === id}
                      sortDir={sortDir}
                      onSortClick={() => onSortHeaderClick(id)}
                    />
                  </th>
                )
              })}
              {orderedMetaCols.map((id) => {
                const label = CALENDAR_META_COL_LABELS[id] ?? id
                const alignRight = CALENDAR_NUMERIC_SORT_COLS.has(id)
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
                    <div className={alignRight ? 'flex justify-end' : ''}>
                      <ContractPerfTableSortHeader
                        label={label}
                        sortable
                        activeSort={sortKey === id}
                        sortDir={sortDir}
                        onSortClick={() => onSortHeaderClick(id)}
                      />
                    </div>
                  </th>
                )
              })}
              {days.map((d) => {
                const date = dayIso(d)
                return (
                  <th key={d} className="px-2 py-2 text-right font-semibold text-gray-700 border-b border-gray-200 tabular-nums">
                    <div className="flex justify-end">
                      <ContractPerfTableSortHeader
                        label={d}
                        sortable
                        activeSort={sortKey === `day:${date}`}
                        sortDir={sortDir}
                        onSortClick={() => onSortHeaderClick(`day:${date}`)}
                      />
                    </div>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody className="bg-white">
            {sortedRows.map((r) => {
              const opLabel = formatOperationalTableTextDisplay(r.operation_id)
              const contractExtLabel = formatOperationalTableTextDisplay(r.contract_ext_no || r.contract_number)
              const stoLabel = formatOperationalTableTextDisplay(r.sto_number)
              const supplierLabel = formatOperationalTableTextDisplay(r.supplier)
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
                        {formatOperationalTableTextDisplay(r.loading_location)} → {formatOperationalTableTextDisplay(r.unloading_location)}
                      </div>
                    </td>
                  ) : null}
                  {stickyContractCols.map((id) => {
                    const colW = CALENDAR_STICKY_CONTRACT_COL_WIDTHS[id] ?? 120
                    const left = stickyLeftByCol[id] ?? 0
                    const label =
                      id === 'contract_ext_no'
                        ? contractExtLabel
                        : id === 'sto_number'
                          ? stoLabel
                          : supplierLabel
                    return (
                      <td
                        key={id}
                        className="sticky z-10 bg-white px-3 py-2 border-b border-gray-100 align-top"
                        style={{ left, minWidth: colW, maxWidth: colW }}
                      >
                        <div
                          className="font-medium text-gray-900 whitespace-normal break-words leading-snug"
                          title={label}
                        >
                          {label}
                        </div>
                      </td>
                    )
                  })}
                  {orderedMetaCols.map((id) => {
                    const alignRight = new Set(['outstanding_quantity', 'qty_sent', 'qty_sent_planning', 'qty_delivered', 'qty_received']).has(id)
                    const val = (() => {
                      switch (id) {
                        case 'owner':
                          return formatOperationalTableTextDisplay(r.trucking_owner)
                        case 'due_start':
                          return dueStart
                        case 'due_end':
                          return dueEnd
                        case 'source_type':
                          return formatOperationalTableTextDisplay((r as any).source_type)
                        case 'lt_spot':
                          return formatSapDisplayValue((r as any).lt_spot)
                        case 'product':
                          return formatOperationalTableTextDisplay(r.product)
                        case 'group_name':
                          return formatOperationalTableTextDisplay(r.group_name)
                        case 'outstanding_quantity':
                          return (
                            <TruckingOutstandingQtyWithTooltip
                              outstandingKg={outQty}
                              incoterm={r.incoterm}
                            />
                          )
                        case 'qty_sent':
                          return formatTruckingQtyMt(qtySent)
                        case 'qty_sent_planning':
                          return formatTruckingQtyMt(plannedSum)
                        case 'qty_delivered':
                          return formatTruckingQtyMt(qtyDel)
                        case 'qty_received':
                          return formatTruckingQtyMt(qtyRecv)
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
                            {draftValue
                              ? formatDailyPlanningQtyMtDisplay(draftValue)
                              : '0.00'}
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
  /** Stale-while-revalidate: true while list API is in flight; never clears existing rows. */
  const [listFetching, setListFetching] = useState(false)
  /** True while table scope filters change — shows loading shell without stale rows. */
  const [tableScopeLoading, setTableScopeLoading] = useState(false)
  // Search should apply only on Enter / Apply (not per keystroke)
  const [searchDraft, setSearchDraft] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editedData, setEditedData] = useState<Partial<TruckingOperation>>({})
  const [statusFilter, setStatusFilter] = useState<string>('ALL')
  const [lateIndicatorFilter, setLateIndicatorFilter] = useState<string>('ALL')
  const [loadingLocationFilter, setLoadingLocationFilter] = useState('')
  const [unloadingLocationFilter, setUnloadingLocationFilter] = useState('')
  type ColumnFilter =
    | { type: 'text'; value: string; exact?: boolean; emptyOnly?: boolean; notBlankOnly?: boolean }
    | { type: 'number'; min?: string; max?: string; emptyOnly?: boolean; notBlankOnly?: boolean }
    | { type: 'date'; from?: string; to?: string; emptyOnly?: boolean; notBlankOnly?: boolean }
  const [columnFilters, setColumnFilters] = useState<Record<string, ColumnFilter>>({})
  const {
    selectedProducts,
    setSelectedProducts,
    selectedGroupPlants,
    setSelectedGroupPlants,
    userScopeReady,
    resetUserScopeFilters,
    handleProductsChange,
    handleGroupPlantsChange,
  } = useUserScopeFilterDefaults('trucking')
  const scopeSummaryRequestKey = useMemo(
    () => JSON.stringify({ p: [...selectedProducts].sort(), g: [...selectedGroupPlants].sort() }),
    [selectedProducts, selectedGroupPlants],
  )
  const [availableGroupPlants, setAvailableGroupPlants] = useState<string[]>([])
  const [selectedIncoterms, setSelectedIncoterms] = useState<string[]>([])
  const [availableIncoterms, setAvailableIncoterms] = useState<string[]>([])
  const [availableProducts, setAvailableProducts] = useState<string[]>([])
  const [selectedSuppliers, setSelectedSuppliers] = useState<string[]>([])
  const [availableSuppliers, setAvailableSuppliers] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [templateDownloading, setTemplateDownloading] = useState(false)
  const onSuppliersChange = useCallback((values: string[]) => {
    setPage(1)
    setHasMore(true)
    setSelectedSuppliers(values)
  }, [])

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
  /** Section 1 status circles — toolbar scope only (excludes status card filter). */
  const [truckingSection1Summary, setTruckingSection1Summary] = useState<any>(null)
  /** Stale-while-revalidate: true while summary API is in flight; keeps prior card counts. */
  const [summaryFetching, setSummaryFetching] = useState(false)
  /** UI-only: active status card count from view-table pagination.total (summary API still authoritative for other cards). */
  const [statusCardTotalFromList, setStatusCardTotalFromList] = useState<{
    status: string
    total: number
  } | null>(null)
  const truckingSummaryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const listFetchGenRef = useRef(0)
  const summaryFetchGenRef = useRef(0)
  const section1SummaryForceNextFetchRef = useRef(true)

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

  const [wbUploadOpen, setWbUploadOpen] = useState(false)
  const [wbUploading, setWbUploading] = useState(false)
  const [wbUploadSummary, setWbUploadSummary] = useState<{
    importId: string
    status: string
    sheetsProcessed: string[]
    sheetsSkipped: Array<{ sheetName: string; reason: string }>
    rawTicketRows: number
    aggregatedPoDates: number
    operationsUpdated: number
    operationsFailed: number
    rowsUpserted: number
    rowParseFailures: Array<{ sheetName?: string; rowNumber: number; po_number: string; reason: string }>
    operationFailures: Array<{ po_number: string; progress_date?: string; reason: string; operation_ids?: string[] }>
  } | null>(null)

  const [bulkCreateUploadOpen, setBulkCreateUploadOpen] = useState(false)
  const [bulkCreateUploading, setBulkCreateUploading] = useState(false)
  const [bulkCreateSummary, setBulkCreateSummary] = useState<{
    processedRows: number
    operationsCreated: number
    operationsUpdated?: number
    operationsFailed: number
    succeededRows: number
    rowParseFailures: { rowNumber: number; contract_ext_no: string; reason: string }[]
    operationFailures: {
      contract_ext_no: string
      rowNumbers: number[]
      reason: string
      operation_ids?: string[]
    }[]
    operationWarnings?: {
      contract_ext_no: string
      rowNumbers: number[]
      reason: string
      operation_ids?: string[]
    }[]
    failedRetemplateRows?: Array<{
      rowNumber: number
      po_number: string
      contract_ext_no: string
      cells: string[]
      reason: string
    }>
    uploadHeaderRow?: string[]
  } | null>(null)
  const [actualsUploadOpen, setActualsUploadOpen] = useState(false)
  const [actualsUploadSummary, setActualsUploadSummary] = useState<{
    processedRows: number
    operationsUpdated: number
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
        'contract_ext_no',
        'sto_number',
        'supplier',
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
        if (Array.isArray(cols) && cols.length > 0) {
          setCalendarVisibleMetaCols(new Set(migrateCalendarVisibleMetaCols(cols.map((x: any) => String(x)))))
        }
        if (Array.isArray(order) && order.length > 0) {
          setCalendarMetaOrderIds(migrateCalendarMetaOrderIds(order.map((x: any) => String(x))))
        }
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
      const mergedColumnFilters = appendToolbarMultiToColumnFilters(columnFilters as Record<string, unknown>, {
        selectedIncoterms,
        selectedProducts,
        selectedSuppliers,
      })
      if (Object.keys(mergedColumnFilters).length > 0) {
        params.set('columnFilters', JSON.stringify(mergedColumnFilters))
      }
      const stoParam = searchParams.get('sto')
      if (stoParam) params.set('sto', stoParam)
      const contractParam = searchParams.get('contract')
      if (contractParam) params.set('contract', contractParam)
      if (selectedGroupPlants.length > 0) {
        selectedGroupPlants.forEach((p) => params.append('plant', p))
      }

      const res = await api.get(`/trucking/daily-planning-deliverables?${params.toString()}`)
      const rawRows = (res.data?.data || []) as TruckingCalendarRow[]
      const tomorrowIso = getHPlusOneIsoDate()
      const rows = await applyHPlusOnePlanningPromotions(rawRows, async (rowId, progressDate, quantityKg) => {
        try {
          const saveRes = await api.put(`/trucking/${rowId}/daily-actuals`, {
            daily_actuals: [{ progress_date: progressDate, quantity_kg: quantityKg }],
            replace: false,
          })
          return saveRes.data?.data?.daily_actuals as
            | Array<{ date: string; quantity_delivered: number }>
            | undefined
        } catch {
          return undefined
        }
      }, tomorrowIso)
      setCalendarRows(rows)
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
    columnFilters,
    selectedIncoterms,
    selectedProducts,
    selectedSuppliers,
    selectedGroupPlants,
    searchParams,
  ])

  useEffect(() => {
    if (activeTab !== 'calendar') return
    if (!userScopeReady) return
    fetchCalendarRows()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    activeTab,
    userScopeReady,
    calendarMonth,
    searchTerm,
    statusFilter,
    loadingLocationFilter,
    unloadingLocationFilter,
    dateFrom,
    dateTo,
    lateIndicatorFilter,
    columnFilters,
    selectedIncoterms,
    selectedProducts,
    selectedSuppliers,
    selectedGroupPlants,
    searchParams,
  ])

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
        const qtyMt = parseDailyPlanningMtDraft(raw)
        if (qtyMt === 'invalid') {
          alert(`Invalid quantity for ${r.operation_id || r.id} on ${formatDateDMY(date)}. Use numbers >= 0.`)
          return
        }
        if (qtyMt > 0 && bounds && !isDateInDueWindow(r, date)) {
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
          const res = await api.put(`/trucking/${id}/daily-actuals`, {
            daily_actuals: next.map((x) => ({
              progress_date: x.date,
              quantity_kg: x.quantity_delivered,
            })),
            replace: true,
          })
          if (res.data?.success) {
            updates.set(id, res.data.data.daily_actuals || next)
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
            updates.has(r.id) ? { ...r, daily_actuals: updates.get(r.id)! } : r,
          ),
        )
      }

      if (failed === 0) {
        if (saved > 0) {
          alert(`Saved daily actual delivery for ${saved} operation(s).`)
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
      const res = await api.get('/trucking/daily-actuals/template', { responseType: 'blob' })
      const url = URL.createObjectURL(new Blob([res.data], { type: 'text/csv;charset=utf-8' }))
      const a = document.createElement('a')
      a.href = url
      a.download = 'daily_actuals_template.csv'
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
      const res = await api.post('/trucking/daily-actuals/bulk-upload', fd)
      const data = res.data?.data
      if (data) {
        const opFailures = data.operationFailures ?? []
        setPlanningUploadSummary({
          processedRows: Number(data.processedRows ?? 0),
          succeededOperations: Number(data.operationsUpdated ?? data.contractsUpdated ?? data.succeededOperations ?? 0),
          failedOperations: Number(data.failedOperations ?? opFailures.length),
          succeededRows: Number(data.succeededRows ?? 0),
          rowLevelIssues: Number(data.rowLevelIssues ?? (data.rowParseFailures?.length ?? 0)),
          operationLevelFailures: Number(data.operationLevelFailures ?? opFailures.length),
          rowParseFailures: data.rowParseFailures ?? [],
          operationFailures: opFailures,
        })
        setPlanningUploadOpen(true)
      }
      await fetchCalendarRows()
    } catch (err: any) {
      alert(err?.response?.data?.error?.message || err?.message || 'Upload failed')
    } finally {
      setPlanningUploading(false)
    }
  }

  const handleWbRekapFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setWbUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await api.post('/trucking/wb-rekap/bulk-upload', fd)
      const data = res.data?.data
      if (data) {
        setWbUploadSummary({
          importId: String(data.importId ?? ''),
          status: String(data.status ?? ''),
          sheetsProcessed: data.sheetsProcessed ?? [],
          sheetsSkipped: data.sheetsSkipped ?? [],
          rawTicketRows: Number(data.rawTicketRows ?? 0),
          aggregatedPoDates: Number(data.aggregatedPoDates ?? 0),
          operationsUpdated: Number(data.operationsUpdated ?? 0),
          operationsFailed: Number(data.operationsFailed ?? 0),
          rowsUpserted: Number(data.rowsUpserted ?? 0),
          rowParseFailures: data.rowParseFailures ?? [],
          operationFailures: data.operationFailures ?? [],
        })
        setWbUploadOpen(true)
      }
      invalidateLogisticsListCaches()
      section1SummaryForceNextFetchRef.current = true
      await fetchTruckingOperations(page, undefined, { force: true })
      if (activeTab === 'calendar') {
        await fetchCalendarRows()
      }
    } catch (err: unknown) {
      const message =
        (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error
          ?.message ||
        (err as Error)?.message ||
        'WB upload failed'
      alert(message)
    } finally {
      setWbUploading(false)
    }
  }

  const isListActualsTemplateDownloadEnabled = isActualsTemplateDownloadEnabled(statusFilter)

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
  const [editTruckingFromTable, setEditTruckingFromTable] = useState<{
    operationId: string
    contractId: string
    contractExtNo?: string
    poNumber?: string
  } | null>(null)
  const [plotTruckingFromTable, setPlotTruckingFromTable] = useState<{
    operationId: string
    contractId: string
    contractExtNo?: string
    poNumber?: string
  } | null>(null)
  const [createTruckingPrefill, setCreateTruckingPrefill] = useState<{
    contractId: string
    contractExtNo?: string
    poNumber?: string
  } | null>(null)
  const [unplannedBreakdown, setUnplannedBreakdown] = useState<{
    contractRows: number
    executionRows: number
    totalTableRows: number
  } | null>(null)

  const [showColumnsMenu, setShowColumnsMenu] = useState(false)
  const [sortKey, setSortKey] = useState<string>('supplier')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  const buildTruckingListSearchParams = useCallback(
    (opts?: {
      page?: number
      limit?: number
      includeSummary?: boolean
      summaryOnly?: boolean
      searchOverride?: string
      /** Full SAP join for exports (accurate contract ext no, qty, dates). */
      skipSapJoin?: boolean
    }) => {
      const params = new URLSearchParams()
      params.append('skipSapJoin', opts?.skipSapJoin === false ? 'false' : 'true')
      params.append('limit', String(opts?.limit ?? pageSize))
      params.append('page', String(opts?.page ?? page))
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
      const searchTrim = (opts?.searchOverride ?? searchTerm).trim()
      if (searchTrim.length >= 2) {
        params.append('search', searchTrim)
      }
      const mergedColumnFilters = appendToolbarMultiToColumnFilters(columnFilters as Record<string, unknown>, {
        selectedIncoterms,
        selectedProducts,
        selectedSuppliers,
      })
      const cfKeys = Object.keys(mergedColumnFilters)
      if (cfKeys.length > 0) {
        params.append('columnFilters', JSON.stringify(mergedColumnFilters))
      }
      if (lateIndicatorFilter && lateIndicatorFilter !== 'ALL') {
        params.append('lateIndicator', lateIndicatorFilter)
      }
      const stoParam = searchParams.get('sto')
      if (stoParam) {
        params.append('sto', stoParam)
      }
      const contractParam = searchParams.get('contract')
      if (contractParam) {
        params.append('contract', contractParam)
      }
      if (selectedGroupPlants.length > 0) {
        selectedGroupPlants.forEach((p) => params.append('plant', p))
      }
      if (opts?.summaryOnly) {
        params.delete('status')
        params.set('summaryOnly', 'true')
      } else if (opts?.includeSummary === false) {
        params.append('includeSummary', 'false')
      }
      return params
    },
    [
      page,
      pageSize,
      sortKey,
      sortDir,
      statusFilter,
      loadingLocationFilter,
      unloadingLocationFilter,
      dateFrom,
      dateTo,
      searchTerm,
      columnFilters,
      selectedIncoterms,
      selectedProducts,
      selectedSuppliers,
      lateIndicatorFilter,
      searchParams,
      selectedGroupPlants,
    ],
  )

  const downloadFilteredActualsTemplate = useCallback(async () => {
    const unplannedMode = isUnplannedPlanningTemplateMode(statusFilter)
    const plannedMode = isPlannedPlanningTemplateMode(statusFilter)
    const exportPageSize = 500

    setTemplateDownloading(true)
    try {
      const collected: TruckingOperation[] = []
      let exportPage = 1
      let exportTotalPages = 1

      while (exportPage <= exportTotalPages) {
        const params = buildTruckingListSearchParams({
          page: exportPage,
          limit: exportPageSize,
          includeSummary: false,
          skipSapJoin: false,
        })
        const response = await api.get(`/trucking?${params.toString()}`)
        const envelope = response.data as {
          data?: {
            truckingOperations?: TruckingOperation[]
            pagination?: { totalPages?: number }
          }
        }
        const items = envelope?.data?.truckingOperations || []
        collected.push(...items)
        exportTotalPages = Number(envelope?.data?.pagination?.totalPages || 1)
        exportPage += 1
      }

      const deduped = dedupeTruckingOperationsForTemplate(collected)
      const rows: TruckingActualsTemplateRow[] = deduped
        .filter((op) => {
          const osKg = parseTruckingQtyKg(op.outstanding_quantity) ?? 0
          if (osKg <= 0) return false
          if (unplannedMode) return op.status === 'UNPLANNED'
          if (plannedMode) return op.status === 'PLANNED' || op.status === 'IN_PROGRESS'
          return false
        })
        .map((op) =>
          unplannedMode || plannedMode
            ? {
                contract_ext_no: op.contract_ext_no,
                contract_number: op.contract_number,
                po_number: op.po_number,
                group_name: op.group_name,
                supplier: op.supplier,
                source_type: op.source_type,
                contract_date: op.contract_date,
                outstanding_quantity: op.outstanding_quantity,
                daily_deliverables: op.daily_deliverables,
                templateKind: unplannedMode ? ('unplanned' as const) : ('planned' as const),
              }
            : {
                contract_ext_no: op.contract_ext_no,
                contract_number: op.contract_number,
                po_number: op.po_number,
                planning_start_date: op.planning_start_date,
                planning_end_date: op.planning_end_date,
                daily_deliverables: op.daily_deliverables,
              },
        )

      if (rows.length === 0) {
        alert(
          unplannedMode
            ? 'No Unplanned operations with outstanding qty match the current filters.'
            : 'No Planned or In Progress operations with outstanding qty match the current filters.',
        )
        return
      }

      const blob = buildTruckingActualsTemplateXlsxBlob(rows)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = buildTruckingPlanningTemplateFilename(unplannedMode ? 'unplanned' : 'planned')
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (error) {
      console.error('Failed to download trucking template:', error)
      alert('Failed to download template. Please try again.')
    } finally {
      setTemplateDownloading(false)
    }
  }, [buildTruckingListSearchParams, statusFilter])

  const columnStorageKey = 'trucking.compact.visibleColumns'
  const [visibleColumnIds, setVisibleColumnIds] = useState<Set<string>>(() => {
    if (typeof window === 'undefined') return new Set()
    try {
      const stored = localStorage.getItem(columnStorageKey)
      if (stored) {
        const parsed = JSON.parse(stored)
        return new Set(Array.isArray(parsed) ? parsed.map(String) : [])
      }
    } catch {}
    return new Set()
  })
  const columnOrderStorageKey = 'trucking.compact.columnOrder'
  const userViewPrefKey = 'trucking.compact.view.v2'
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
    setHasMore(true)
  }, [searchParams])

  useEffect(() => {
    if (!userScopeReady) return
    section1SummaryForceNextFetchRef.current = true
  }, [userScopeReady, scopeSummaryRequestKey])

  useEffect(() => {
    if (!userScopeReady) return
    fetchTruckingOperations()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userScopeReady, page, statusFilter, loadingLocationFilter, unloadingLocationFilter, searchParams, sortKey, sortDir, selectedGroupPlants, selectedIncoterms, selectedProducts, selectedSuppliers, dateFrom, dateTo, searchTerm, columnFilters])

  useEffect(() => {
    let cancelled = false
    Promise.all([
      api.get('/contracts/filter-options/group-plants'),
      api.get('/contracts/filter-options/incoterms'),
      api.get('/dashboard/filter-options/products'),
      api.get('/dashboard/filter-options/suppliers'),
    ])
      .then(([plantRes, incRes, productRes, supplierRes]) => {
        if (cancelled) return
        const plants = (plantRes.data?.data?.groupPlants || []) as string[]
        const incs = (incRes.data?.data?.incoterms || []) as string[]
        const productPayload = productRes.data?.data
        const products = (Array.isArray(productPayload)
          ? productPayload
          : productPayload && typeof productPayload === 'object' && 'products' in productPayload
            ? (productPayload as { products?: string[] }).products
            : []) as string[]
        const supplierPayload = supplierRes.data?.data
        const suppliers = (Array.isArray(supplierPayload) ? supplierPayload : []) as string[]
        setAvailableGroupPlants(Array.isArray(plants) ? plants : [])
        setAvailableIncoterms(Array.isArray(incs) ? incs : [])
        setAvailableProducts(Array.isArray(products) ? products : [])
        setAvailableSuppliers(Array.isArray(suppliers) ? suppliers : [])
      })
      .catch((e) => {
        if (cancelled) return
        console.error('Failed to fetch filter options:', e)
        setAvailableGroupPlants([])
        setAvailableIncoterms([])
        setAvailableProducts([])
        setAvailableSuppliers([])
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
    setHasMore(true)
    setSearchTerm(searchDraft)
    fetchTruckingOperations(1, searchDraft)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchDraft])

  // Column header filters apply only when user presses Enter inside the filter popover.

  /** Reset visible rows so Section 3 shows loading when table scope filters change. */
  const beginTableScopeRefresh = useCallback(() => {
    setTruckingOperations([])
    setTableScopeLoading(true)
    setStatusCardTotalFromList(null)
    setTotalCount(0)
    setTotalPages(1)
  }, [])

  const fetchTruckingOperations = async (
    forcedPage?: number,
    searchOverride?: string,
    options?: { force?: boolean },
  ) => {
    const listGen = ++listFetchGenRef.current
    const fetchStatusFilter = statusFilter
    setListFetching(true)
    setSummaryFetching(true)
    try {
      const effectivePage = forcedPage ?? page
      const params = buildTruckingListSearchParams({
        page: effectivePage,
        limit: pageSize,
        includeSummary: false,
        searchOverride,
      })

      const listUrl = `/trucking?${params.toString()}`
      const listCacheKey = buildCacheKey('GET', listUrl)

      const summaryParams = new URLSearchParams(params.toString())
      summaryParams.delete('status')
      summaryParams.delete('includeSummary')
      summaryParams.set('summaryOnly', 'true')
      summaryParams.set('page', '1')
      summaryParams.set('limit', '1')
      const summaryUrl = `/trucking?${summaryParams.toString()}`
      const summaryCacheKey = buildCacheKey('GET', summaryUrl)
      const summaryForce = options?.force || section1SummaryForceNextFetchRef.current

      const applySummaryEnvelope = (envelope: {
        data?: {
          summary?: typeof truckingSection1Summary
        }
      }) => {
        if (envelope?.data?.summary) {
          setTruckingSection1Summary(envelope.data.summary)
        }
        setSummaryFetching(false)
      }

      const applyListEnvelope = (envelope: {
        data?: {
          truckingOperations?: TruckingOperation[]
          pagination?: { total?: number; totalPages?: number }
          unplannedBreakdown?: {
            contractRows?: number
            executionRows?: number
            totalTableRows?: number
          }
          summary?: {
            status?: {
              planned?: number
              inProgress?: number
              completed?: number
              cancelled?: number
            }
          }
        }
      }) => {
        const items = envelope?.data?.truckingOperations || []
        setTruckingOperations(items)
        const total = Number(envelope?.data?.pagination?.total ?? 0)
        const pages = Number(envelope?.data?.pagination?.totalPages || 1)
        setTotalCount(total)
        setTotalPages(pages)
        setHasMore(effectivePage < pages)
        setTableScopeLoading(false)
        const breakdown = envelope?.data?.unplannedBreakdown
        if (breakdown) {
          setUnplannedBreakdown({
            contractRows: Number(breakdown.contractRows ?? 0),
            executionRows: Number(breakdown.executionRows ?? 0),
            totalTableRows: Number(breakdown.totalTableRows ?? 0),
          })
        } else {
          setUnplannedBreakdown(null)
        }
        const activeStage = String(fetchStatusFilter ?? '').trim().toUpperCase()
        if (activeStage && activeStage !== 'ALL') {
          const listTotal =
            activeStage === 'UNPLANNED'
              ? Number(breakdown?.totalTableRows ?? total)
              : total
          setStatusCardTotalFromList({ status: activeStage, total: listTotal })
        } else {
          setStatusCardTotalFromList(null)
        }
      }

      const { data: listEnvelope, revalidating: listRevalidating } = await cachedGet(
        listCacheKey,
        () => api.get(listUrl).then((r) => r.data),
        {
          force: options?.force,
          onRevalidate: (fresh) => {
            if (listGen !== listFetchGenRef.current) return
            applyListEnvelope(fresh)
            setListFetching(false)
          },
        },
      )
      section1SummaryForceNextFetchRef.current = false
      if (listGen !== listFetchGenRef.current) return
      applyListEnvelope(listEnvelope)
      if (!listRevalidating) setListFetching(false)

      /** Section 1 summary after table shell — avoids competing with list query on DB/CPU. */
      const scheduleSummaryFetches = () => {
        if (listGen !== listFetchGenRef.current) return
        const summaryGen = ++summaryFetchGenRef.current
        void cachedGet(summaryCacheKey, () => api.get(summaryUrl).then((r) => r.data), {
          force: summaryForce,
          onRevalidate: (fresh) => {
            if (summaryGen !== summaryFetchGenRef.current) return
            applySummaryEnvelope(fresh)
          },
        })
          .then(({ data }) => {
            if (summaryGen !== summaryFetchGenRef.current) return
            applySummaryEnvelope(data)
          })
          .catch(() => {
            if (summaryGen === summaryFetchGenRef.current) setSummaryFetching(false)
          })
      }
      if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
        window.requestIdleCallback(() => scheduleSummaryFetches(), { timeout: 2000 })
      } else {
        setTimeout(scheduleSummaryFetches, 250)
      }

      // SAP hydrate after table paint — avoids competing with shell query on DB/CPU.
      const scheduleHydrate = () => {
        const hydrateParams = new URLSearchParams(params.toString())
        hydrateParams.delete('includeSummary')
        hydrateParams.set('skipSapJoin', 'false')
        const hydrateUrl = `/trucking?${hydrateParams.toString()}`
        const hydrateCacheKey = buildCacheKey('GET', hydrateUrl)
        void cachedGet(hydrateCacheKey, () => api.get(hydrateUrl).then((r) => r.data), {
          force: options?.force,
          onRevalidate: (fresh) => {
            if (listGen !== listFetchGenRef.current) return
            const hydrated = fresh?.data?.truckingOperations || []
            if (hydrated.length) {
              setTruckingOperations((prev) => mergeTruckingSapFields(prev, hydrated))
            }
          },
        })
          .then(({ data }) => {
            if (listGen !== listFetchGenRef.current) return
            const hydrated = data?.data?.truckingOperations || []
            if (hydrated.length) {
              setTruckingOperations((prev) => mergeTruckingSapFields(prev, hydrated))
            }
          })
          .catch((err) => {
            console.warn('Trucking SAP hydrate failed (table shows shell data):', err)
          })
      }
      if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
        window.requestIdleCallback(() => scheduleHydrate(), { timeout: 2000 })
      } else {
        setTimeout(scheduleHydrate, 250)
      }
    } catch (error) {
      if (listGen !== listFetchGenRef.current) return
      console.error('Failed to fetch trucking operations:', error)
      alert('Failed to load trucking operations. Please refresh the page.')
      setListFetching(false)
      setSummaryFetching(false)
    }
  }

  const uploadUnplannedPlanningFromWideTemplate = useCallback(async (file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    const res = await api.post('/trucking/unplanned-planning/bulk-upload', fd)
    const data = res.data?.data
    if (data) {
      setBulkCreateSummary({
        processedRows: Number(data.processedRows ?? 0),
        operationsCreated: Number(data.operationsCreated ?? 0),
        operationsUpdated: Number(data.operationsUpdated ?? 0),
        operationsFailed: Number(data.operationsFailed ?? 0),
        succeededRows: Number(data.succeededRows ?? 0),
        rowParseFailures: data.rowParseFailures ?? [],
        operationFailures: data.operationFailures ?? [],
        operationWarnings: data.operationWarnings ?? [],
        failedRetemplateRows: data.failedRetemplateRows ?? [],
        uploadHeaderRow: data.uploadHeaderRow ?? [],
      })
      setBulkCreateUploadOpen(true)
    }
    invalidateLogisticsListCaches()
    section1SummaryForceNextFetchRef.current = true
    await fetchTruckingOperations(page, undefined, { force: true })
  }, [fetchTruckingOperations, page])

  const uploadPlannedPlanningFromWideTemplate = useCallback(async (file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    const res = await api.post('/trucking/planned-planning/bulk-upload', fd)
    const data = res.data?.data
    if (data) {
      setBulkCreateSummary({
        processedRows: Number(data.processedRows ?? 0),
        operationsCreated: Number(data.operationsCreated ?? 0),
        operationsUpdated: Number(data.operationsUpdated ?? 0),
        operationsFailed: Number(data.operationsFailed ?? 0),
        succeededRows: Number(data.succeededRows ?? 0),
        rowParseFailures: data.rowParseFailures ?? [],
        operationFailures: data.operationFailures ?? [],
        operationWarnings: data.operationWarnings ?? [],
        failedRetemplateRows: data.failedRetemplateRows ?? [],
        uploadHeaderRow: data.uploadHeaderRow ?? [],
      })
      setBulkCreateUploadOpen(true)
    }
    invalidateLogisticsListCaches()
    section1SummaryForceNextFetchRef.current = true
    await fetchTruckingOperations(page, undefined, { force: true })
  }, [fetchTruckingOperations, page])

  const handleBulkCreateFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return

    setBulkCreateUploading(true)
    try {
      if (isUnplannedPlanningTemplateMode(statusFilter)) {
        await uploadUnplannedPlanningFromWideTemplate(file)
        return
      }

      if (isPlannedPlanningTemplateMode(statusFilter)) {
        const isPlanningTemplate = await isWidePlanningTemplateFile(file)
        if (!isPlanningTemplate) {
          alert(
            'Invalid file. Upload the Planned daily trucking template (Group, Supplier, …, date columns).',
          )
          return
        }
        await uploadPlannedPlanningFromWideTemplate(file)
        return
      }

      const fd = new FormData()
      fd.append('file', file)

      const res = await api.post('/trucking/bulk-create', fd)
      const data = res.data?.data
      if (data) {
        setBulkCreateSummary(data)
        setBulkCreateUploadOpen(true)
      }
      await fetchTruckingOperations(1, undefined, { force: true })
    } catch (err: any) {
      alert(err?.response?.data?.error?.message || err?.message || 'Upload failed')
    } finally {
      setBulkCreateUploading(false)
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

  const handleOpenEditTruckingModal = (operation: TruckingOperation) => {
    if (isTruckingEditDisabled(operation)) {
      return
    }
    const contractId = (operation.contract_number || operation.contract_ext_no || '').trim()
    const poNumber = operation.po_number?.trim()
    if (!contractId && !poNumber) {
      alert('PO Number or Contract ID is required to edit this trucking operation.')
      return
    }
    setPlotTruckingFromTable(null)
    setEditTruckingFromTable({
      operationId: operation.id,
      contractId,
      contractExtNo: operation.contract_ext_no || operation.contract_number,
      poNumber,
    })
  }

  const handleOpenAddTruckingModal = (operation: TruckingOperation) => {
    const contractId = (operation.contract_number || operation.contract_ext_no || '').trim()
    const poNumber = operation.po_number?.trim()
    if (!contractId && !poNumber) {
      alert('PO Number or Contract ID is required to add trucking planning.')
      return
    }
    setEditTruckingFromTable(null)
    if (isTruckingContractBacklogRow(operation)) {
      setPlotTruckingFromTable(null)
      setCreateTruckingPrefill({
        contractId,
        contractExtNo: operation.contract_ext_no || operation.contract_number,
        poNumber,
      })
      setShowCreateForm(true)
      return
    }
    setShowCreateForm(false)
    setCreateTruckingPrefill(null)
    setPlotTruckingFromTable({
      operationId: operation.id,
      contractId,
      contractExtNo: operation.contract_ext_no || operation.contract_number,
      poNumber,
    })
  }

  const handleCloseTruckingModal = () => {
    setShowCreateForm(false)
    setEditTruckingFromTable(null)
    setPlotTruckingFromTable(null)
    setCreateTruckingPrefill(null)
  }

  const handleCreated = () => {
    handleCloseTruckingModal()
    setPage(1)
    setHasMore(true)
    invalidateLogisticsListCaches()
    section1SummaryForceNextFetchRef.current = true
    void fetchTruckingOperations(1, undefined, { force: true })
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
      case 'UNPLANNED': return 'bg-slate-100 text-slate-800'
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
  const fetchOperationDocuments = async (operation: TruckingOperation) => {
    try {
      setDocsLoading(true)
      const merged: DocumentItem[] = []
      const seen = new Set<string>()

      const appendDocs = (rows: DocumentItem[] | undefined) => {
        for (const doc of rows ?? []) {
          const docId = String(doc.id ?? '').trim()
          if (!docId || seen.has(docId)) continue
          seen.add(docId)
          merged.push(doc)
        }
      }

      if (isTruckingContractBacklogRow(operation)) {
        const contractId = resolveTruckingDocumentContractId(operation)
        if (!contractId) {
          setOperationDocs([])
          return
        }
        const res = await api.get('/documents', { params: { contractId } })
        appendDocs(res.data?.data)
      } else {
        const res = await api.get('/documents', { params: { truckingOperationId: operation.id } })
        appendDocs(res.data?.data)
        const contractId = resolveTruckingDocumentContractId(operation)
        if (contractId) {
          const contractRes = await api.get('/documents', { params: { contractId } })
          appendDocs(contractRes.data?.data)
        }
      }

      setOperationDocs(merged)
    } catch (err) {
      console.error('Fetch documents error:', err)
      setOperationDocs([])
    } finally {
      setDocsLoading(false)
    }
  }

  const handleUploadFileChange = async (operation: TruckingOperation, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    
    const allowed = ['application/pdf', 'image/png', 'image/jpeg']
    if (!allowed.includes(file.type)) {
      alert('Only PDF, PNG, or JPEG files are allowed.')
      e.target.value = ''
      return
    }

    const backlogRow = isTruckingContractBacklogRow(operation)
    const contractId = resolveTruckingDocumentContractId(operation)
    if (backlogRow && !contractId) {
      alert('Contract reference is missing; cannot upload document.')
      e.target.value = ''
      return
    }

    setUploadingId(operation.id)
    try {
      const form = new FormData()
      form.append('file', file)
      form.append('document_type', 'OTHER')
      if (backlogRow) {
        form.append('contract_id', contractId)
      } else {
        form.append('trucking_operation_id', operation.id)
      }

      const res = await api.post('/documents/upload', form, {
        headers: { 'Content-Type': 'multipart/form-data' }
      })
      if (res.data?.success) {
        alert('Document uploaded successfully!')
        if (selectedOperation && selectedOperation.id === operation.id) {
          await fetchOperationDocuments(operation)
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
    await fetchOperationDocuments(operation)
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
      selectedSuppliers.length > 0 ||
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
    selectedSuppliers,
    columnFilters,
    dateFrom,
    dateTo,
    defaultContractDateRange,
  ])

  const clearTruckingFilters = useCallback(() => {
    markUserScopeFiltersCleared('trucking')
    setSearchDraft('')
    setSearchTerm('')
    setStatusFilter('ALL')
    setLateIndicatorFilter('ALL')
    setLoadingLocationFilter('')
    setUnloadingLocationFilter('')
    resetUserScopeFilters()
    setSelectedIncoterms([])
    setSelectedSuppliers([])
    setColumnFilters({})
    setDateFrom(defaultContractDateRange.from)
    setDateTo(defaultContractDateRange.to)
    setPage(1)
    setHasMore(true)
  }, [defaultContractDateRange, resetUserScopeFilters])

  /** Section 1 status circles — toggles Section 2 dropdown + Section 3 API `status` param. */
  const handleStatusCardClick = useCallback((status: string) => {
    beginTableScopeRefresh()
    setPage(1)
    setHasMore(true)
    setStatusFilter((prev) => (prev === status ? 'ALL' : status))
  }, [beginTableScopeRefresh])

  const truckingActiveFilterScopeLabel = useMemo(() => {
    const parts: string[] = []
    if (statusFilter !== 'ALL') {
      parts.push(TRUCKING_STATUS_LABELS[statusFilter] ?? statusFilter)
    }
    if (lateIndicatorFilter !== 'ALL') {
      const lateLabels: Record<string, string> = { ON_TIME: 'On Time', LATE: 'Late', NA: 'N/A' }
      parts.push(`Late: ${lateLabels[lateIndicatorFilter] ?? lateIndicatorFilter}`)
    }
    if (searchTerm.trim().length >= 2) {
      parts.push(`Search "${searchTerm.trim()}"`)
    }
    if (selectedIncoterms.length > 0) {
      parts.push(
        `Incoterm${selectedIncoterms.length > 1 ? 's' : ''}: ${selectedIncoterms.slice(0, 2).join(', ')}${selectedIncoterms.length > 2 ? '…' : ''}`,
      )
    }
    if (selectedProducts.length > 0) {
      parts.push(
        `Product${selectedProducts.length > 1 ? 's' : ''}: ${selectedProducts.slice(0, 2).join(', ')}${selectedProducts.length > 2 ? '…' : ''}`,
      )
    }
    if (selectedSuppliers.length > 0) {
      parts.push(
        `Supplier${selectedSuppliers.length > 1 ? 's' : ''}: ${selectedSuppliers.slice(0, 2).join(', ')}${selectedSuppliers.length > 2 ? '…' : ''}`,
      )
    }
    if (selectedGroupPlants.length > 0) {
      parts.push(
        `Plant${selectedGroupPlants.length > 1 ? 's' : ''}: ${selectedGroupPlants.slice(0, 2).join(', ')}${selectedGroupPlants.length > 2 ? '…' : ''}`,
      )
    }
    if (Object.keys(columnFilters).length > 0) {
      parts.push(`${Object.keys(columnFilters).length} column filter(s)`)
    }
    if (dateFrom !== defaultContractDateRange.from || dateTo !== defaultContractDateRange.to) {
      parts.push('Contract date filtered')
    }
    const stoParam = searchParams.get('sto')
    if (stoParam) parts.push(`STO ${stoParam}`)
    const contractParam = searchParams.get('contract')
    if (contractParam) parts.push(`Contract ${contractParam}`)
    return parts.length > 0 ? parts.join(' · ') : null
  }, [
    statusFilter,
    lateIndicatorFilter,
    searchTerm,
    selectedIncoterms,
    selectedProducts,
    selectedSuppliers,
    selectedGroupPlants,
    columnFilters,
    dateFrom,
    dateTo,
    defaultContractDateRange,
    searchParams,
  ])

  // Excel-like filtering helpers
  const getFilterTypeForColumn = (colId: string): ColumnFilter['type'] => {
    if (colId === 'contract_qty' || colId === 'sto_quantity' || colId === 'quantity_sent' || colId === 'quantity_delivered' || colId === 'quantity_receive' || colId === 'outstanding_qty_mt' || colId === 'oa_budget' || colId === 'oa_actual' || colId === 'estimated_km' || colId === 'gain_loss_percentage' || colId === 'gain_loss_amount') return 'number'
    if (colId === 'cargo_readiness_date' || colId === 'contract_date' || colId === 'trucking_start_date' || colId === 'trucking_completion_date' || colId === 'delivery_start_date' || colId === 'delivery_end_date' || colId === 'created_at') return 'date'
    return 'text'
  }

  const getColumnRawValue = (o: TruckingOperation, colId: string): string | number | null => {
    switch (colId) {
      case 'operation_id': return o.operation_id || ''
      case 'contract_number':
      case 'contract_ext_no': return o.contract_ext_no || o.contract_number || ''
      case 'contract_date': return o.contract_date || ''
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
      case 'quantity_delivered': return parseTruckingQtyKg(o.quantity_delivered)
      case 'quantity_receive': return parseTruckingQtyKg(o.quantity_receive ?? o.quantity_delivered)
      case 'outstanding_qty_mt': return typeof o.outstanding_quantity === 'number' ? o.outstanding_quantity : null
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
  const filteredOperations = useMemo(() => {
    if (!statusFilter || statusFilter === 'ALL') return truckingOperations
    const stage = statusFilter.trim().toUpperCase()
    return truckingOperations.filter(
      (op) => String(op.status ?? '').trim().toUpperCase() === stage,
    )
  }, [truckingOperations, statusFilter])

  /** Unplanned view table: headline and Section 2 card both use hybrid table row total. */
  const unplannedTableBreakdown = useMemo(() => {
    if (unplannedBreakdown) return unplannedBreakdown
    const fromSummary = truckingSection1Summary?.unplannedTable
    if (!fromSummary) return null
    return {
      contractRows: Number(fromSummary.contractRows ?? 0),
      executionRows: Number(fromSummary.executionRows ?? 0),
      totalTableRows: Number(fromSummary.totalTableRows ?? 0),
    }
  }, [unplannedBreakdown, truckingSection1Summary?.unplannedTable])

  /** Section 2 card counts — summary SQL + instant patch for the active status from view-table total. */
  const truckingStatusCardCounts = useMemo(() => {
    const s = truckingSection1Summary?.status
    const counts: Record<string, number> = {
      UNPLANNED: Number(
        unplannedTableBreakdown?.totalTableRows ??
          truckingSection1Summary?.unplannedTable?.totalTableRows ??
          s?.unplanned ??
          0,
      ),
      PLANNED: Number(s?.planned ?? 0),
      IN_PROGRESS: Number(s?.inProgress ?? 0),
      COMPLETED: Number(s?.completed ?? 0),
      CANCELLED: Number(s?.cancelled ?? 0),
    }
    if (
      statusCardTotalFromList &&
      summaryFetching &&
      Object.prototype.hasOwnProperty.call(counts, statusCardTotalFromList.status)
    ) {
      counts[statusCardTotalFromList.status] = statusCardTotalFromList.total
    }
    return counts
  }, [
    truckingSection1Summary,
    unplannedTableBreakdown?.totalTableRows,
    statusCardTotalFromList,
    summaryFetching,
  ])

  const tableHeaderCount = useMemo(() => {
    if (statusFilter === 'UNPLANNED') {
      const rowTotal =
        unplannedTableBreakdown?.totalTableRows ??
        (truckingSection1Summary?.status?.unplanned != null
          ? Number(truckingSection1Summary.status.unplanned)
          : totalCount)
      return {
        value: rowTotal,
        noun: 'rows' as const,
      }
    }
    if (
      statusFilter === 'PLANNED' ||
      statusFilter === 'IN_PROGRESS' ||
      statusFilter === 'COMPLETED' ||
      statusFilter === 'CANCELLED'
    ) {
      return {
        value: totalCount,
        noun: 'trucking' as const,
      }
    }
    return {
      value: totalCount,
      noun: 'operations' as const,
    }
  }, [
    statusFilter,
    unplannedTableBreakdown?.totalTableRows,
    truckingSection1Summary?.status?.unplanned,
    totalCount,
  ])

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
      label: 'Late Indicators',
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
      id: 'sto_number',
      label: 'STO',
      defaultVisible: true,
      sortable: true,
      getSortValue: (o) => (isTruckingContractBacklogRow(o) ? '' : o.sto_number || ''),
      render: (o) => (
        <OperationalNowrapCell
          value={isTruckingContractBacklogRow(o) ? '—' : o.sto_number}
          title={isTruckingContractBacklogRow(o) ? '—' : o.sto_number || ''}
        />
      )
    },
    {
      id: 'contract_date',
      label: 'Contract Date',
      defaultVisible: true,
      sortable: true,
      getSortValue: (o) => o.contract_date || '',
      render: (o) => <span className="text-sm">{formatShortDate(o.contract_date || '')}</span>
    },
    {
      id: 'contract_ext_no',
      label: 'Contract Ext No',
      defaultVisible: true,
      sortable: true,
      getSortValue: (o) => o.contract_ext_no || o.contract_number || '',
      render: (o) => (
        <OperationalStackedCommaCell
          value={o.contract_ext_no || o.contract_number}
          title={(o.contract_ext_no || o.contract_number || '') as string}
        />
      )
    },
    {
      id: 'po_number',
      label: 'PO',
      defaultVisible: true,
      sortable: true,
      getSortValue: (o) => o.po_number || '',
      render: (o) => <OperationalNowrapCell value={o.po_number} title={o.po_number || ''} />
    },
    {
      id: 'supplier',
      label: 'Supplier',
      defaultVisible: true,
      sortable: true,
      getSortValue: (o) => o.supplier || '',
      render: (o) => <span className="text-sm break-words">{formatOperationalTableTextDisplay(o.supplier)}</span>
    },
    {
      id: 'status',
      label: 'Status',
      defaultVisible: true,
      sortable: true,
      getSortValue: (o) => o.status || '',
      render: (o) => (
        <Badge className={getStatusColor(o.status)}>
          {truckingStatusLabel(o.status)}
        </Badge>
      )
    },
    {
      id: 'product',
      label: 'Product',
      defaultVisible: true,
      sortable: true,
      getSortValue: (o) => o.product || '',
      render: (o) => <span className="text-sm break-words">{formatOperationalTableTextDisplay(o.product)}</span>
    },
    {
      id: 'incoterm',
      label: 'Incoterm',
      defaultVisible: true,
      sortable: true,
      getSortValue: (o) => o.incoterm || '',
      render: (o) => <span className="text-sm break-words">{formatOperationalTableTextDisplay(o.incoterm)}</span>
    },
    {
      id: 'contract_qty',
      label: 'Contract Qty (MT)',
      defaultVisible: true,
      sortable: true,
      getSortValue: (o) => o.contract_qty || 0,
      render: (o) => (
        <span className="text-sm break-words tabular-nums">
          {formatQtyMtFromKg(o.contract_qty)}
        </span>
      )
    },
    {
      id: 'sto_quantity',
      label: 'STO Qty (MT)',
      defaultVisible: true,
      sortable: true,
      getSortValue: (o) => o.sto_quantity || 0,
      render: (o) => (
        <span className="text-sm break-words tabular-nums">
          {formatQtyMtFromKg(o.sto_quantity)}
        </span>
      )
    },
    {
      id: 'quantity_delivered',
      label: 'Delivery Qty (MT)',
      defaultVisible: true,
      sortable: true,
      getSortValue: (o) => parseTruckingQtyKg(o.quantity_delivered) ?? 0,
      render: (o) => (
        <span className="text-sm break-words tabular-nums">
          {formatTruckingQtyMt(o.quantity_delivered)}
        </span>
      )
    },
    {
      id: 'quantity_receive',
      label: 'Received Qty (MT)',
      defaultVisible: true,
      sortable: true,
      getSortValue: (o) => parseTruckingQtyKg(o.quantity_receive ?? o.quantity_delivered) ?? 0,
      render: (o) => (
        <span className="text-sm break-words tabular-nums">
          {formatTruckingQtyMt(o.quantity_receive ?? o.quantity_delivered)}
        </span>
      )
    },
    {
      id: 'outstanding_qty_mt',
      label: 'Outstanding Qty (MT)',
      formulaHelp: FIELD_HELP.truckingOutstandingQtyMt,
      defaultVisible: true,
      sortable: true,
      getSortValue: (o) => typeof o.outstanding_quantity === 'number' ? o.outstanding_quantity : 0,
      render: (o) => (
        <TruckingOutstandingQtyWithTooltip
          outstandingKg={o.outstanding_quantity}
          incoterm={o.incoterm}
        />
      )
    },
    {
      id: 'trucking_start_date',
      label: 'Start Receive Date',
      defaultVisible: true,
      sortable: true,
      getSortValue: (o) => o.trucking_start_date || '',
      render: (o) => <span className="text-sm">{formatShortDate(o.trucking_start_date)}</span>
    },
    {
      id: 'trucking_completion_date',
      label: 'Last Receive Date',
      defaultVisible: true,
      sortable: true,
      getSortValue: (o) => o.trucking_completion_date || '',
      render: (o) => <span className="text-sm">{formatShortDate(o.trucking_completion_date)}</span>
    },
    {
      id: 'operation_id',
      label: 'Operation ID',
      defaultVisible: false,
      sortable: true,
      getSortValue: (o) => o.operation_id || '',
      render: (o) => (
        <span className="text-sm break-words block" title={o.operation_id || ''}>
          {formatOperationalTableTextDisplay(o.operation_id)}
        </span>
      )
    },
    {
      id: 'location',
      label: 'Location',
      defaultVisible: false,
      sortable: true,
      getSortValue: (o) => o.location || '',
      render: (o) => <span className="text-sm break-words">{formatOperationalTableTextDisplay(o.location)}</span>
    },
    {
      id: 'loading_location',
      label: 'Truck Loading Location',
      defaultVisible: false,
      sortable: true,
      getSortValue: (o) => o.loading_location || o.location || '',
      render: (o) => <span className="text-sm break-words">{formatOperationalTableTextDisplay(o.loading_location || o.location)}</span>
    },
    {
      id: 'unloading_location',
      label: 'Truck Discharge Location',
      defaultVisible: false,
      sortable: true,
      getSortValue: (o) => o.unloading_location || '',
      render: (o) => <span className="text-sm break-words">{formatOperationalTableTextDisplay(o.unloading_location)}</span>
    },
    {
      id: 'trucking_owner',
      label: 'Trucking Owner',
      defaultVisible: false,
      sortable: true,
      getSortValue: (o) => o.trucking_owner || '',
      render: (o) => <span className="text-sm break-words">{formatOperationalTableTextDisplay(o.trucking_owner)}</span>
    },
    {
      id: 'quantity_sent',
      label: 'Qty Sent (Kg)',
      defaultVisible: false,
      sortable: true,
      getSortValue: (o) => o.quantity_sent || 0,
      render: (o) => (
        <span className="text-sm break-words">
          {formatKg(o.quantity_sent)}
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
      defaultVisible: false,
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
      defaultVisible: false,
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
      defaultVisible: false,
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
      id: 'delivery_start_date',
      label: 'Due Date Delivery Start',
      formulaHelp: FIELD_HELP.etaVsDueDelivery,
      defaultVisible: false,
      sortable: true,
      getSortValue: (o) => o.delivery_start_date || '',
      render: (o) => <span className="text-sm">{formatShortDate(o.delivery_start_date || '')}</span>
    },
    {
      id: 'delivery_end_date',
      label: 'Due Date Delivery End',
      formulaHelp: FIELD_HELP.etaVsDueDelivery,
      defaultVisible: false,
      sortable: true,
      getSortValue: (o) => o.delivery_end_date || '',
      render: (o) => <span className="text-sm">{formatShortDate(o.delivery_end_date || '')}</span>
    },
    {
      id: 'buyer',
      label: 'Buyer',
      defaultVisible: false,
      sortable: true,
      getSortValue: (o) => o.buyer || '',
      render: (o) => <span className="text-sm break-words">{formatOperationalTableTextDisplay(o.buyer)}</span>
    },
    {
      id: 'group_name',
      label: 'Group',
      defaultVisible: false,
      sortable: true,
      getSortValue: (o) => o.group_name || '',
      render: (o) => <span className="text-sm break-words">{formatOperationalTableTextDisplay(o.group_name)}</span>
    }
  ], [])

  const defaultVisibleColumnIds = useMemo(() => {
    return compactColumns
      .filter(c => c.defaultVisible && c.render)
      .map(c => c.id)
  }, [compactColumns])

  const compactColumnIdsKey = useMemo(() => compactColumns.map((c) => c.id).join('|'), [compactColumns])

  useEffect(() => {
    if (visibleColumnIds.size === 0) {
      setVisibleColumnIds(new Set(defaultVisibleColumnIds))
    }
  }, [defaultVisibleColumnIds, visibleColumnIds.size])

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (visibleColumnIds.size > 0) {
      try {
        localStorage.setItem(columnStorageKey, JSON.stringify(Array.from(visibleColumnIds)))
      } catch {}
    }
  }, [visibleColumnIds])

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (columnOrderIds.length > 0) {
      try {
        localStorage.setItem(columnOrderStorageKey, JSON.stringify(columnOrderIds))
      } catch {}
    }
  }, [columnOrderIds])

  useEffect(() => {
    const allIds = compactColumns.map((c) => c.id)
    const canonical = truckingCompactColumnFallbackOrder(allIds)
    let forceLayoutReset = false
    if (typeof window !== 'undefined') {
      try {
        if (localStorage.getItem(TRUCKING_COLUMN_LAYOUT_VERSION_KEY) !== TRUCKING_COLUMN_LAYOUT_VERSION) {
          forceLayoutReset = true
          localStorage.setItem(TRUCKING_COLUMN_LAYOUT_VERSION_KEY, TRUCKING_COLUMN_LAYOUT_VERSION)
          localStorage.setItem(columnOrderStorageKey, JSON.stringify(canonical))
          localStorage.setItem(columnStorageKey, JSON.stringify(truckingDefaultVisibleColumnIds(allIds)))
        }
      } catch {
        forceLayoutReset = true
      }
    }

    if (forceLayoutReset) {
      const defaultVis = truckingDefaultVisibleColumnIds(allIds)
      setVisibleColumnIds(new Set(defaultVis))
      setColumnOrderIds(canonical)
      void api
        .post('/user-preferences/me', {
          key: userViewPrefKey,
          value: {
            visibleColumnIds: defaultVis,
            columnOrderIds: canonical,
          },
        })
        .catch(() => {
          /* localStorage already updated */
        })
      return
    }

    setColumnOrderIds((prev) => {
      const next = mergeTruckingColumnOrder(prev, allIds)
      if (prev.length === next.length && prev.every((v, i) => v === next[i])) return prev
      return next
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compactColumnIdsKey])

  useEffect(() => {
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
  }, [])

  const visibleColumns = useMemo(
    () => buildTruckingVisibleColumns(compactColumns, visibleColumnIds, columnOrderIds),
    [columnOrderIds, compactColumns, visibleColumnIds],
  )

  const resetCompactColumnView = useCallback(() => {
    const allIds = compactColumns.map((c) => c.id)
    const vis = new Set(truckingDefaultVisibleColumnIds(allIds))
    const order = truckingCompactColumnFallbackOrder(allIds)
    setVisibleColumnIds(vis)
    setColumnOrderIds(order)
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem(columnStorageKey, JSON.stringify(Array.from(vis)))
        localStorage.setItem(columnOrderStorageKey, JSON.stringify(order))
      } catch {
        // ignore
      }
    }
  }, [compactColumns])

  const handlePageChange = (newPage: number) => {
    if (newPage < 1 || newPage > totalPages || listFetching) return
    setPage(newPage)
    fetchTruckingOperations(newPage)
  }

  const reorderColumnByDrag = (dragId: string, dropId: string) => {
    if (dragId === dropId) return
    setColumnOrderIds((prev) => {
      const allIds = compactColumns.map((c) => c.id)
      const ids = prev.length > 0 ? [...prev] : truckingCompactColumnFallbackOrder(allIds)
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
    const prioritizeSapSto = shouldPrioritizeSapStoRows(statusFilter)
    if (!prioritizeSapSto) return filteredOperations
    return [...filteredOperations].sort((a, b) => compareSapStoListRowPriority(a, b))
  }, [filteredOperations, statusFilter])

  const section3TableLoading =
    tableScopeLoading || (listFetching && truckingOperations.length === 0)

  const onSortHeaderClick = (col: CompactColumn) => {
    if (!col.sortable) return
    const nextDir: 'asc' | 'desc' =
      sortKey === col.id ? (sortDir === 'asc' ? 'desc' : 'asc') : 'asc'
    setSortDir(nextDir)
    setSortKey(col.id)
    setPage(1)
    fetchTruckingOperations(1)
  }

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
  }, [visibleColumns, sortedOperations, editingId])

  const truckingViewToggle = (
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
  )

  return (
    <Layout>
      <div className="space-y-6">
        <input
          type="file"
          accept=".csv,.xlsx,.xls"
          className="hidden"
          id="bulk-create-trucking-input"
          onChange={handleBulkCreateFileChange}
          disabled={bulkCreateUploading}
        />
        <input
          type="file"
          accept=".xlsx,.xls"
          className="hidden"
          id="wb-rekap-upload-input"
          onChange={handleWbRekapFileChange}
          disabled={wbUploading}
        />
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Trucking Operations</h1>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="border-indigo-600 text-indigo-700 hover:bg-indigo-50"
              onClick={() => document.getElementById('wb-rekap-upload-input')?.click()}
              disabled={wbUploading}
            >
              {wbUploading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Uploading...
                </>
              ) : (
                <>
                  <Upload className="h-4 w-4 mr-2" />
                  Upload WB
                </>
              )}
            </Button>
            {(isUnplannedPlanningTemplateMode(statusFilter) ||
              isPlannedPlanningTemplateMode(statusFilter)) ? (
              <Button
                size="sm"
                variant="outline"
                className="border-blue-600 text-blue-700 hover:bg-blue-50 disabled:opacity-50 disabled:pointer-events-none"
                onClick={() => document.getElementById('bulk-create-trucking-input')?.click()}
                disabled={bulkCreateUploading || listFetching}
              >
                {bulkCreateUploading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Uploading...
                  </>
                ) : (
                  <>
                    <Upload className="h-4 w-4 mr-2" />
                    Upload Daily Planning
                  </>
                )}
              </Button>
            ) : null}
            {TRUCKING_HEADER_CREATE_UPLOAD_UI_ENABLED ? (
              <>
                {!isUnplannedPlanningTemplateMode(statusFilter) ? (
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
                ) : null}
                <Button
                  size="sm"
                  onClick={() => {
                    setPlotTruckingFromTable(null)
                    setEditTruckingFromTable(null)
                    setShowCreateForm(true)
                  }}
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Create New
                </Button>
              </>
            ) : null}
          </div>
        </div>

        {/* Section 1: Global Filters */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Global Filters</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex flex-wrap gap-4">
                <div className="relative min-w-[12rem] flex-1">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 transform text-gray-400" />
                  <Input
                    placeholder="Search by Contract Ext No, Contract No, PO No, or STO No..."
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
                  onChange={(e) => {
                    beginTableScopeRefresh()
                    setPage(1)
                    setHasMore(true)
                    setStatusFilter(e.target.value)
                  }}
                  className="rounded-lg border px-4 py-2"
                >
                  <option value="ALL">All Status</option>
                  <option value="UNPLANNED">Unplanned</option>
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
              </div>

              <PerformanceScopeFilters
                hideGroupPlantFilter={false}
                incotermOptions={availableIncoterms}
                selectedIncoterms={selectedIncoterms}
                onIncotermsChange={setSelectedIncoterms}
                showProductFilter
                productOptions={availableProducts}
                selectedProducts={selectedProducts}
                onProductsChange={handleProductsChange}
                showSupplierFilter
                supplierOptions={availableSuppliers}
                selectedSuppliers={selectedSuppliers}
                onSuppliersChange={onSuppliersChange}
                groupPlantOptions={availableGroupPlants}
                selectedGroupPlants={selectedGroupPlants}
                onGroupPlantsChange={handleGroupPlantsChange}
                dateFrom={dateFrom}
                dateTo={dateTo}
                onDateFromChange={setDateFrom}
                onDateToChange={setDateTo}
                showDateRange={false}
                incotermEmptyMessage="Loading incoterms..."
                productEmptyMessage="Loading products..."
                supplierEmptyMessage="Loading suppliers..."
                groupPlantPlaceholder="Select group plant(s)"
                groupPlantEmptyMessage="No group plants"
              />

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

        {/* Section 2: Summary Trucking Status */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Summary Trucking Status
              {summaryFetching ? (
                <Loader2 className="h-4 w-4 shrink-0 animate-spin text-gray-400" aria-hidden />
              ) : null}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-center gap-3 md:gap-6 overflow-x-auto py-4 px-4">
              {[
                {
                  status: 'UNPLANNED',
                  label: 'Unplanned',
                  color: 'bg-slate-100',
                  textColor: 'text-slate-800',
                  badgeColor: 'bg-slate-600',
                  help: FIELD_HELP.truckingStatusUnplanned,
                },
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
                const isStatusActive = statusFilter === statusInfo.status
                const count = truckingStatusCardCounts[statusInfo.status] ?? 0
                return (
                  <div key={statusInfo.status} className="flex items-center flex-shrink-0">
                    <div className="relative">
                      <button
                        type="button"
                        title={statusInfo.help}
                        onClick={() => handleStatusCardClick(statusInfo.status)}
                        className={`relative w-24 h-24 md:w-28 md:h-28 rounded-full ${statusInfo.color} flex items-center justify-center border-2 border-white shadow-lg transition-all cursor-pointer hover:shadow-xl hover:scale-[1.02] ${
                          isStatusActive ? 'ring-4 ring-blue-400 ring-offset-2' : ''
                        }`}
                      >
                        <div className={`absolute -top-3 -right-3 ${statusInfo.badgeColor} text-white text-xs md:text-sm font-bold rounded-full w-8 h-8 md:w-9 md:h-9 flex items-center justify-center shadow-lg z-10`}>
                          {count}
                        </div>
                        <span className={`text-xs md:text-sm font-semibold ${statusInfo.textColor} text-center px-2 leading-tight ${isStatusActive ? 'font-bold' : ''}`}>
                          {statusInfo.label}
                        </span>
                      </button>
                    </div>
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

        {/* Section 3: Main View Table — calendar or list tab below */}

        {activeTab === 'calendar' && (
          <>
          <Card>
            <CardHeader className="space-y-3">
              <div>
                <CardTitle className="text-base flex flex-wrap items-center gap-2">
                  Daily Planning Deliverables — Calendar
                  {calendarLoading ? (
                    <Loader2 className="h-4 w-4 shrink-0 animate-spin text-gray-400" aria-hidden />
                  ) : null}
                  <Badge variant="outline" className="text-[10px]">Daily qty: MT</Badge>
                </CardTitle>
                <p className="text-xs text-gray-500 mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0 max-w-full">
                  <span className="whitespace-nowrap tabular-nums text-gray-700">
                    <span className="font-semibold">{calendarRows.length.toLocaleString('en-US')}</span> operations
                  </span>
                  {truckingActiveFilterScopeLabel ? (
                    <>
                      <span className="text-gray-400" aria-hidden>
                        ·
                      </span>
                      <span className="whitespace-nowrap font-medium text-blue-700">
                        {truckingActiveFilterScopeLabel}
                      </span>
                    </>
                  ) : null}
                </p>
                <div className="text-xs text-gray-600 mt-1 max-w-xl">
                  Planned qty from Add Trucking is shown until actual qty is recorded via cell edit, CSV upload, or auto-conversion on H+1 (tomorrow).
                  Edit cells or upload CSV/Excel — qty saved as actual delivery (validation: due date range, quantity caps).
                  {' '}
                  Enter qty only on days within each row&apos;s Due Start – Due End (gray days are blocked). Amber = unsaved; click Save.
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                {truckingViewToggle}
                <div className="flex flex-wrap items-center gap-2 ml-auto">
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
                            { id: 'contract_ext_no', label: 'Contract Ext No' },
                            { id: 'sto_number', label: 'STO' },
                            { id: 'supplier', label: 'Supplier' },
                            { id: 'owner', label: 'Owner' },
                            { id: 'due_start', label: 'Due Start' },
                            { id: 'due_end', label: 'Due End' },
                            { id: 'qty_sent', label: 'Qty Sent' },
                            { id: 'qty_sent_planning', label: 'Qty Sent (planning)' },
                            { id: 'qty_delivered', label: 'Delivery Qty (MT)' },
                            { id: 'qty_received', label: 'Received Qty (MT)' },
                            { id: 'source_type', label: 'Source Type' },
                            { id: 'lt_spot', label: 'LT/SPOT' },
                            { id: 'product', label: 'Product' },
                            { id: 'group_name', label: 'Group Name' },
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
            <DialogContent className="max-w-2xl max-h-[88vh]" aria-describedby={undefined}>
              <DialogHeader>
                <DialogTitle>Daily actuals upload result</DialogTitle>
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
        <Dialog open={wbUploadOpen} onOpenChange={setWbUploadOpen}>
          <DialogContent className="max-w-2xl max-h-[88vh] overflow-y-auto" aria-describedby={undefined}>
            <DialogHeader>
              <DialogTitle>WB rekap upload result</DialogTitle>
            </DialogHeader>
            {wbUploadSummary ? (
              <div className="space-y-4 text-sm">
                <div className="rounded-md border bg-slate-50 px-3 py-2 text-xs text-muted-foreground">
                  Import ID: <span className="font-mono text-slate-800">{wbUploadSummary.importId}</span>
                  {' · '}
                  Status:{' '}
                  <span className="font-semibold uppercase text-slate-800">{wbUploadSummary.status}</span>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  <div className="rounded-md border bg-slate-50 px-3 py-2">
                    <div className="text-xs text-muted-foreground">WB tickets parsed</div>
                    <div className="text-lg font-semibold tabular-nums">{wbUploadSummary.rawTicketRows}</div>
                  </div>
                  <div className="rounded-md border bg-slate-50 px-3 py-2">
                    <div className="text-xs text-muted-foreground">PO × date aggregates</div>
                    <div className="text-lg font-semibold tabular-nums">{wbUploadSummary.aggregatedPoDates}</div>
                  </div>
                  <div className="rounded-md border bg-green-50 px-3 py-2">
                    <div className="text-xs text-muted-foreground">Operations updated</div>
                    <div className="text-lg font-semibold tabular-nums text-green-800">
                      {wbUploadSummary.operationsUpdated}
                    </div>
                  </div>
                  <div className="rounded-md border bg-blue-50 px-3 py-2">
                    <div className="text-xs text-muted-foreground">Daily actual rows upserted</div>
                    <div className="text-lg font-semibold tabular-nums text-blue-800">
                      {wbUploadSummary.rowsUpserted}
                    </div>
                  </div>
                  <div className="rounded-md border bg-red-50 px-3 py-2">
                    <div className="text-xs text-muted-foreground">Failed PO/date rows</div>
                    <div className="text-lg font-semibold tabular-nums text-red-800">
                      {wbUploadSummary.operationsFailed}
                    </div>
                  </div>
                </div>
                {wbUploadSummary.sheetsProcessed.length > 0 ? (
                  <div>
                    <div className="font-medium text-gray-900 mb-1">Sheets processed</div>
                    <p className="text-xs text-gray-700">{wbUploadSummary.sheetsProcessed.join(', ')}</p>
                  </div>
                ) : null}
                {(wbUploadSummary.sheetsSkipped?.length ?? 0) > 0 ? (
                  <div>
                    <div className="font-medium text-amber-900 mb-2">Sheets skipped</div>
                    <ul className="max-h-32 overflow-auto rounded border border-amber-200 bg-amber-50 text-xs space-y-1 p-2">
                      {wbUploadSummary.sheetsSkipped.map((s, i) => (
                        <li key={`wbs-${i}`} className="text-amber-950">
                          <span className="font-semibold">{s.sheetName}</span>: {s.reason}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {(wbUploadSummary.rowParseFailures?.length ?? 0) > 0 ? (
                  <div>
                    <div className="font-medium text-gray-900 mb-2">Row parse issues</div>
                    <ul className="max-h-40 overflow-auto rounded border bg-white text-xs space-y-1 p-2">
                      {wbUploadSummary.rowParseFailures.map((f, i) => (
                        <li key={`wb-rpf-${i}`} className="text-gray-800">
                          {f.sheetName ? `${f.sheetName} · ` : ''}
                          <span className="font-mono">Line {f.rowNumber}</span>
                          {f.po_number ? ` · PO ${f.po_number}` : ''}: {f.reason}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {(wbUploadSummary.operationFailures?.length ?? 0) > 0 ? (
                  <div>
                    <div className="font-medium text-gray-900 mb-2">Failed PO / date (skipped)</div>
                    <ul className="max-h-48 overflow-auto rounded border bg-white text-xs space-y-2 p-2">
                      {wbUploadSummary.operationFailures.map((f, i) => (
                        <li key={`wb-of-${i}`} className="text-gray-800">
                          <span className="font-semibold">PO {f.po_number}</span>
                          {f.progress_date ? ` · ${f.progress_date}` : ''}: {f.reason}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : null}
          </DialogContent>
        </Dialog>

        <Dialog open={bulkCreateUploadOpen} onOpenChange={setBulkCreateUploadOpen}>
          <DialogContent className="max-w-2xl max-h-[88vh]" aria-describedby={undefined}>
            <DialogHeader>
              <DialogTitle>
                {isUnplannedPlanningTemplateMode(statusFilter)
                  ? 'Unplanned planning upload result'
                  : isPlannedPlanningTemplateMode(statusFilter)
                    ? 'Planned planning upload result'
                    : 'Bulk create trucking upload result'}
              </DialogTitle>
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
                  <div className="rounded-md border bg-blue-50 px-3 py-2">
                    <div className="text-xs text-muted-foreground">Operations updated</div>
                    <div className="text-lg font-semibold tabular-nums text-blue-800">
                      {bulkCreateSummary.operationsUpdated ?? 0}
                    </div>
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
                          {f.operation_ids?.length ? (
                            <span className="text-gray-500"> [{f.operation_ids.join(', ')}]</span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {(bulkCreateSummary.operationWarnings?.length ?? 0) > 0 && (
                  <div>
                    <div className="font-medium text-amber-900 mb-2">Warnings</div>
                    <ul className="max-h-40 overflow-auto rounded border border-amber-200 bg-amber-50 text-xs space-y-2 p-2">
                      {bulkCreateSummary.operationWarnings!.map((f, i) => (
                        <li key={`ow-${i}`} className="text-amber-950">
                          <span className="font-semibold">{f.contract_ext_no}</span>
                          {f.rowNumbers?.length ? (
                            <span className="text-amber-800"> (rows {f.rowNumbers.join(', ')})</span>
                          ) : null}
                          : {f.reason}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {(isUnplannedPlanningTemplateMode(statusFilter) ||
                  isPlannedPlanningTemplateMode(statusFilter)) &&
                (bulkCreateSummary.failedRetemplateRows?.length ?? 0) > 0 &&
                (bulkCreateSummary.uploadHeaderRow?.length ?? 0) > 0 ? (
                  <div className="rounded-md border border-red-200 bg-red-50/70 p-3">
                    <div className="font-medium text-red-900 mb-1">
                      {bulkCreateSummary.failedRetemplateRows!.length} PO row(s) rejected — total planning qty ≠
                      Outstanding Qty
                    </div>
                    <p className="text-xs text-red-800 mb-3">
                      Download the corrected template with failure reasons, adjust daily qty (MT) so the row total
                      matches OS Qty (MT), then upload the failed rows file again.
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="border-red-300 bg-white text-red-800 hover:bg-red-100"
                      onClick={() =>
                        triggerFailedUnplannedUploadRetemplateDownload({
                          uploadHeaderRow: bulkCreateSummary.uploadHeaderRow!,
                          failedRows: bulkCreateSummary.failedRetemplateRows!.map((row) => ({
                            cells: row.cells,
                            reason: row.reason,
                          })),
                          filename: buildTruckingPlanningTemplateFilename(
                            isUnplannedPlanningTemplateMode(statusFilter) ? 'unplanned' : 'planned',
                          ).replace('.xlsx', '-failed.xlsx'),
                        })
                      }
                    >
                      <Download className="mr-2 h-4 w-4" />
                      Download failed PO template
                    </Button>
                  </div>
                ) : null}
              </div>
            ) : null}
          </DialogContent>
        </Dialog>

        <Dialog open={actualsUploadOpen} onOpenChange={setActualsUploadOpen}>
          <DialogContent className="max-w-2xl max-h-[88vh]" aria-describedby={undefined}>
            <DialogHeader>
              <DialogTitle>Daily actuals upload result</DialogTitle>
            </DialogHeader>
            {actualsUploadSummary ? (
              <div className="space-y-4 text-sm">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  <div className="rounded-md border bg-slate-50 px-3 py-2">
                    <div className="text-xs text-muted-foreground">Rows processed</div>
                    <div className="text-lg font-semibold tabular-nums">{actualsUploadSummary.processedRows}</div>
                  </div>
                  <div className="rounded-md border bg-green-50 px-3 py-2">
                    <div className="text-xs text-muted-foreground">Operations updated</div>
                    <div className="text-lg font-semibold tabular-nums text-green-800">
                      {actualsUploadSummary.operationsUpdated}
                    </div>
                  </div>
                  <div className="rounded-md border bg-red-50 px-3 py-2">
                    <div className="text-xs text-muted-foreground">Operations failed</div>
                    <div className="text-lg font-semibold tabular-nums text-red-800">
                      {actualsUploadSummary.operationsFailed}
                    </div>
                  </div>
                  <div className="rounded-md border bg-slate-50 px-3 py-2">
                    <div className="text-xs text-muted-foreground">Rows applied (success)</div>
                    <div className="text-lg font-semibold tabular-nums">{actualsUploadSummary.succeededRows}</div>
                  </div>
                </div>
                {(actualsUploadSummary.rowParseFailures?.length ?? 0) > 0 ? (
                  <div>
                    <div className="font-medium text-gray-900 mb-2">Row issues (file line #)</div>
                    <ul className="max-h-40 overflow-auto rounded border bg-white text-xs space-y-1 p-2">
                      {actualsUploadSummary.rowParseFailures.map((f, i) => (
                        <li key={`aurpf-${i}`} className="text-gray-800">
                          <span className="font-mono">Line {f.rowNumber}</span>
                          {f.contract_ext_no ? ` · ${f.contract_ext_no}` : ''}: {f.reason}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {(actualsUploadSummary.operationFailures?.length ?? 0) > 0 ? (
                  <div>
                    <div className="font-medium text-gray-900 mb-2">Operation failures</div>
                    <ul className="max-h-48 overflow-auto rounded border bg-white text-xs space-y-2 p-2">
                      {actualsUploadSummary.operationFailures.map((f, i) => (
                        <li key={`auof-${i}`} className="text-gray-800">
                          <span className="font-semibold">{f.contract_ext_no}</span>
                          {f.rowNumbers?.length ? (
                            <span className="text-gray-600"> (rows {f.rowNumbers.join(', ')})</span>
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

        {/* Trucking Operations List */}
        {activeTab === 'list' && (
        <Card>
          <CardHeader className="space-y-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                All Trucking Operations
                {listFetching ? (
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin text-gray-400" aria-hidden />
                ) : null}
              </CardTitle>
              <p className="text-xs text-gray-500 mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0 max-w-full">
                <span className="whitespace-nowrap tabular-nums text-gray-700">
                  <span className="font-semibold">{tableHeaderCount.value.toLocaleString('en-US')}</span>{' '}
                  {tableHeaderCount.noun}
                </span>
                <span className="text-gray-400" aria-hidden>
                  ·
                </span>
                <span className="whitespace-nowrap tabular-nums">
                  Page {page}/{totalPages}
                  {statusFilter === 'UNPLANNED' && unplannedTableBreakdown ? (
                    <>
                      {' · '}
                      ({unplannedTableBreakdown.contractRows.toLocaleString('en-US')} without trucking ·{' '}
                      {unplannedTableBreakdown.executionRows.toLocaleString('en-US')} ops)
                    </>
                  ) : statusFilter !== 'UNPLANNED' ? (
                    <> · {totalCount.toLocaleString('en-US')} rows</>
                  ) : null}
                </span>
                {truckingActiveFilterScopeLabel ? (
                  <>
                    <span className="text-gray-400" aria-hidden>
                      ·
                    </span>
                    <span className="whitespace-nowrap font-medium text-blue-700">
                      {truckingActiveFilterScopeLabel}
                    </span>
                  </>
                ) : null}
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              {truckingViewToggle}
              <div className="flex flex-wrap items-center gap-2 ml-auto">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex">
                      <Button
                        variant="outline"
                        size="sm"
                        className="border-green-600 text-green-700 hover:bg-green-50 disabled:opacity-50 disabled:pointer-events-none"
                        onClick={downloadFilteredActualsTemplate}
                        disabled={
                          !isListActualsTemplateDownloadEnabled || listFetching || templateDownloading
                        }
                      >
                        {templateDownloading ? (
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        ) : (
                          <Download className="h-4 w-4 mr-2" />
                        )}
                        Download Template
                      </Button>
                    </span>
                  </TooltipTrigger>
                  {!isListActualsTemplateDownloadEnabled ? (
                    <TooltipContent side="top">{DOWNLOAD_TEMPLATE_DISABLED_TOOLTIP}</TooltipContent>
                  ) : null}
                </Tooltip>
                <div className="relative">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowColumnsMenu(v => !v)}
                    disabled={listFetching}
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
                          onClick={() => setVisibleColumnIds(new Set())}
                        >
                          Unselect All
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="flex-1 text-xs h-7"
                          onClick={() => resetCompactColumnView()}
                        >
                          Reset
                        </Button>
                      </div>
                      <div className="border-t pt-2 space-y-1 max-h-72 overflow-auto pr-1">
                        {(() => {
                          const visibleIds = new Set(visibleColumns.map((c) => c.id))
                          const byId = new Map(compactColumns.map((c) => [c.id, c] as const))
                          const orderedIds =
                            columnOrderIds.length > 0
                              ? columnOrderIds
                              : truckingCompactColumnFallbackOrder(compactColumns.map((c) => c.id))
                          const hiddenCols = orderedIds
                            .map((id) => byId.get(id))
                            .filter((c): c is typeof compactColumns[0] => !!c && !visibleIds.has(c.id))
                            .sort((a, b) => a.label.localeCompare(b.label))
                          return [...visibleColumns, ...hiddenCols]
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
                      disabled={page <= 1 || listFetching}
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
                            disabled={listFetching}
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
                      disabled={page >= totalPages || listFetching}
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
            ) : (
              <div className="min-h-[480px]">
                {/* Desktop compact table */}
                <div className="hidden lg:block border rounded-lg overflow-hidden">
                  {/* Top scrollbar (synced) */}
                  <div
                    ref={topScrollRef}
                    className={`${COMPACT_OPERATIONAL_TABLE_SCROLL_CLASS} border-b bg-white`}
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
                      data-trucking-list-table
                      className={`${COMPACT_OPERATIONAL_TABLE_CLASS} ${COMPACT_OPERATIONAL_TABLE_ROW_VCENTER_CLASS}`}
                    >
                      <thead>
                      <tr className={CONTRACT_PERF_TABLE_HEADER_ROW_OPERATIONAL_CLASS}>
                        {visibleColumns.map(col => {
                          const active = sortKey === col.id
                          const opColClass = operationalTableColumnClass(
                            getOperationalColumnLayout('trucking', col.id),
                          )

                          return (
                            <th
                              key={col.id}
                              scope="col"
                              className={`relative text-left align-top font-semibold cursor-move sticky top-0 z-20 bg-gray-50 ${CONTRACT_PERF_TABLE_CELL_PAD} ${opColClass} ${dragColId === col.id ? 'opacity-60' : ''}`}
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
                              <ContractPerfTableSortHeader
                                label={col.label}
                                formulaHelp={col.formulaHelp}
                                sortable={col.sortable}
                                activeSort={active}
                                sortDir={sortDir}
                                onSortClick={() => onSortHeaderClick(col)}
                              />


                            </th>
                          )
                        })}
                        <th
                          scope="col"
                          className={`${COMPACT_TABLE_ACTIONS_HEADER_STICKY_CLASS} text-center align-bottom font-semibold border-l border-gray-200 ${CONTRACT_PERF_TABLE_CELL_PAD}`}
                          style={{ width: TRUCKING_ACTIONS_COL_WIDTH }}
                        >
                          Actions
                        </th>
                      </tr>
                      </thead>

                      <tbody
                        className={`divide-y divide-gray-200 transition-opacity duration-200 ${
                          (listFetching || tableScopeLoading) && truckingOperations.length > 0 ? 'opacity-65' : 'opacity-100'
                        }`}
                      >
                        {section3TableLoading ? (
                          <TableInitialLoadPlaceholder
                            colSpan={visibleColumns.length + 1}
                            icon={Truck}
                          />
                        ) : !section3TableLoading && sortedOperations.length === 0 ? (
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
                                {visibleColumns.map(col => {
                                  const opColClass = operationalTableColumnClass(
                                    getOperationalColumnLayout('trucking', col.id),
                                  )
                                  return (
                                  <td key={col.id} className={`${COMPACT_OPERATIONAL_TABLE_CELL_CLASS} ${opColClass} align-middle ${CONTRACT_PERF_TABLE_CELL_PAD} ${stripeClass}`}>
                                    <div className={`${COMPACT_OPERATIONAL_TABLE_CELL_INNER_CLASS} ${CONTRACT_PERF_TABLE_ROW_MIN_H}`}>
                                      {col.id === 'status' && isEditing ? (
                                        truckingDbStatus(operation) === 'CANCELLED' ? (
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
                                  )
                                })}
                                <td
                                  className={`sticky right-0 z-10 border-l border-gray-200 align-middle ${CONTRACT_PERF_TABLE_CELL_PAD} ${stripeClass}`}
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
                                        <div className="hidden">
                                          <Button
                                            variant="outline"
                                            size="icon"
                                            onClick={() => handleEdit(operation)}
                                            title="Edit"
                                            className="bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100"
                                          >
                                            <Pencil className="h-4 w-4" />
                                          </Button>
                                        </div>
                                        {isTruckingUnplanned(operation) ? (
                                          <TruckTableAddTruckingButton
                                            onAdd={() => handleOpenAddTruckingModal(operation)}
                                          />
                                        ) : (
                                          <TruckTableEditTruckingButton
                                            onEdit={() => handleOpenEditTruckingModal(operation)}
                                            disabled={isTruckingEditDisabled(operation)}
                                            disabledReason={truckingEditDisabledReason(operation)}
                                            tooltip={truckingEditTooltip(operation)}
                                          />
                                        )}
                                        <Button
                                          variant="outline"
                                          size="icon"
                                          onClick={() => handleViewDocuments(operation)}
                                          title={
                                            isTruckingContractBacklogRow(operation)
                                              ? 'Contract documents'
                                              : 'Documents'
                                          }
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
                                          title={
                                            isTruckingContractBacklogRow(operation)
                                              ? 'Upload contract document'
                                              : 'Upload'
                                          }
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
                <div
                  className={`lg:hidden space-y-4 min-h-[480px] transition-opacity duration-200 ${
                    (listFetching || tableScopeLoading) && truckingOperations.length > 0 ? 'opacity-65' : 'opacity-100'
                  }`}
                >
                  {section3TableLoading ? (
                    <div className="border rounded-lg bg-white">
                      <TableInitialLoadPlaceholderContent icon={Truck} />
                    </div>
                  ) : !section3TableLoading && sortedOperations.length === 0 ? (
                    <div className="text-center py-10 text-gray-500 border rounded-lg bg-white">
                      <Truck className="h-12 w-12 text-gray-400 mx-auto mb-3" />
                      <p>No trucking operations found</p>
                      {searchTerm ? <p className="text-sm mt-2">Try adjusting your search filters</p> : null}
                    </div>
                  ) : sortedOperations.map((operation) => {
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
                              truckingDbStatus(operation) === 'CANCELLED' ? (
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
                                {truckingStatusLabel(operation.status)}
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
                                <div className="hidden">
                                  <Button
                                    variant="outline"
                                    size="icon"
                                    onClick={() => handleEdit(operation)}
                                    title="Edit"
                                    className="bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100"
                                  >
                                    <Pencil className="h-4 w-4" />
                                  </Button>
                                </div>
                                {isTruckingUnplanned(operation) ? (
                                  <TruckTableAddTruckingButton
                                    onAdd={() => handleOpenAddTruckingModal(operation)}
                                  />
                                ) : (
                                  <TruckTableEditTruckingButton
                                    onEdit={() => handleOpenEditTruckingModal(operation)}
                                    disabled={isTruckingEditDisabled(operation)}
                                    disabledReason={truckingEditDisabledReason(operation)}
                                    tooltip={truckingEditTooltip(operation)}
                                  />
                                )}
                                <Button
                                  variant="outline"
                                  size="icon"
                                  onClick={() => handleViewDocuments(operation)}
                                  title={
                                    isTruckingContractBacklogRow(operation)
                                      ? 'Contract documents'
                                      : 'Documents'
                                  }
                                  className="bg-violet-50 border-violet-200 text-violet-700 hover:bg-violet-100"
                                >
                                  <FileText className="h-4 w-4" />
                                </Button>
                                <input
                                  id={`trucking-file-mobile-${operation.id}`}
                                  type="file"
                                  accept="application/pdf,image/png,image/jpeg"
                                  className="hidden"
                                  onChange={(e) => handleUploadFileChange(operation, e)}
                                />
                                <Button
                                  variant="outline"
                                  size="icon"
                                  onClick={() => document.getElementById(`trucking-file-mobile-${operation.id}`)?.click()}
                                  disabled={uploadingId === operation.id}
                                  title={
                                    isTruckingContractBacklogRow(operation)
                                      ? 'Upload contract document'
                                      : 'Upload'
                                  }
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
                            <div className="font-medium">{formatSapDisplayValue(operation.contract_number)}</div>
                          </div>
                          <div>
                            <div className="text-gray-500">Supplier</div>
                            <div className="font-medium">{formatSapDisplayValue(operation.supplier)}</div>
                          </div>
                          <div>
                            <div className="text-gray-500">Product</div>
                            <div className="font-medium">{formatSapDisplayValue(operation.product)}</div>
                          </div>
                          <div>
                            <div className="text-gray-500">Group</div>
                            <div className="font-medium">{formatSapDisplayValue(operation.group_name)}</div>
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
                              <div className="font-medium">{formatSapDisplayValue(operation.location)}</div>
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
                              <div className="font-medium">{formatSapDisplayValue(operation.trucking_owner)}</div>
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
                            <div className="text-gray-500 mb-1">Delivery Qty (MT)</div>
                            {isEditing ? (
                              <Input
                                type="number"
                                step="0.01"
                                value={currentData.quantity_delivered || ''}
                                onChange={(e) => handleFieldChange('quantity_delivered', parseFloat(e.target.value))}
                                className="h-8 text-sm"
                              />
                            ) : (
                              <div className="font-medium">{formatTruckingQtyMt(operation.quantity_delivered)}</div>
                            )}
                          </div>
                          <div>
                            <div className="text-gray-500 mb-1">Received Qty (MT)</div>
                            <div className="font-medium">
                              {formatTruckingQtyMt(operation.quantity_receive ?? operation.quantity_delivered)}
                            </div>
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
                      Showing page {page} of {totalPages} ({tableHeaderCount.value.toLocaleString('en-US')} total {tableHeaderCount.noun})
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handlePageChange(page - 1)}
                        disabled={page <= 1 || listFetching}
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
                              disabled={listFetching}
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
                        disabled={page >= totalPages || listFetching}
                      >
                        Next
                      </Button>
                    </div>
                  </div>
                )}
              </div>
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
              <h3 className="text-xl font-semibold">
                Documents — {truckingDocumentScopeLabel(selectedOperation)}
              </h3>
              <Button variant="ghost" size="icon" className="shrink-0" aria-label="Close" onClick={() => setShowDocs(false)}>
                <X className="h-5 w-5" />
              </Button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
            {docsLoading ? (
              <div className="text-sm text-gray-500 py-8 text-center">Loading documents...</div>
            ) : operationDocs.length === 0 ? (
              <div className="text-sm text-gray-500 py-8 text-center">
                {isTruckingContractBacklogRow(selectedOperation)
                  ? 'No documents uploaded for this contract yet.'
                  : 'No documents uploaded for this operation.'}
              </div>
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

      <CreateTruckingOperationModal
        open={showCreateForm || editTruckingFromTable != null || plotTruckingFromTable != null}
        mode={editTruckingFromTable ? 'edit' : 'add'}
        plotOperationId={plotTruckingFromTable?.operationId ?? null}
        editTruckingOperationId={editTruckingFromTable?.operationId ?? null}
        initialContractId={
          plotTruckingFromTable?.contractId ??
          editTruckingFromTable?.contractId ??
          createTruckingPrefill?.contractId ??
          null
        }
        initialContractExtNo={
          plotTruckingFromTable?.contractExtNo ??
          editTruckingFromTable?.contractExtNo ??
          createTruckingPrefill?.contractExtNo ??
          null
        }
        initialPoNumber={
          plotTruckingFromTable?.poNumber ??
          editTruckingFromTable?.poNumber ??
          createTruckingPrefill?.poNumber ??
          null
        }
        onClose={handleCloseTruckingModal}
        onCreated={handleCreated}
      />
    </Layout>
  )
}

export default function TruckingPage() {
  return (
    <Suspense
      fallback={
        <Layout>
          <div className="space-y-6">
            <h1 className="text-3xl font-bold">Trucking Operations</h1>
            <p className="text-sm text-gray-400">Loading…</p>
          </div>
        </Layout>
      }
    >
      <TruckingPageContent />
    </Suspense>
  )
}
