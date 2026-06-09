'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import Layout from '@/components/Layout'
import api from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Droplets, GripVertical, Search, SlidersHorizontal, X } from 'lucide-react'
import { DateInputDdMmYyyy } from '@/components/DateInputDdMmYyyy'
import { PerformanceScopeFilters } from '@/components/performance/PerformanceScopeFilters'
import { SearchableMultiSelect } from '@/components/SearchableMultiSelect'
import { FieldHelp } from '@/components/FieldHelp'
import { useUserScopeFilterDefaults } from '@/hooks/useUserScopeFilterDefaults'
import { FIELD_HELP } from '@/lib/fieldHelpText'
import { formatDateDMY } from '@/lib/dateFormat'
import {
  formatOilLossAvgMt,
  formatOilLossAvgPct,
  formatOilLossMtFromKg,
  formatOilLossPct,
  formatOilLossTotalMt,
  formatOilLossTotalPct,
} from '@/lib/oilLossFormat'
import {
  filterOilLossEligibleRows,
  matchesOilLossModeFilter,
  OIL_LOSS_MODE_FILTER_OPTIONS,
} from '@/lib/oilLossEligibility'
import { cn, formatQtyMtFromKg } from '@/lib/utils'
import {
  ContractPerfTableSubtitleSkeleton,
  ContractTableBodySkeleton,
} from '@/components/performance/ContractPerfTableSkeleton'
import { ContractPerfTableSortHeader } from '@/components/performance/ContractPerfTableSortHeader'
import {
  CONTRACT_PERF_TABLE_CELL_PAD,
  CONTRACT_PERF_TABLE_HEADER_ROW_CLASS,
  CONTRACT_PERF_TABLE_ROW_MIN_H,
} from '@/lib/contractPerformanceColumns'
import {
  COMPACT_OPERATIONAL_TABLE_CELL_CLASS,
  COMPACT_OPERATIONAL_TABLE_CELL_INNER_CLASS,
  COMPACT_OPERATIONAL_TABLE_CLASS,
  COMPACT_OPERATIONAL_TABLE_SCROLL_CLASS,
} from '@/lib/compactTableUi'
import {
  OperationalNowrapCell,
  OperationalStackedCommaCell,
  OperationalTruncatedCell,
  getOperationalColumnLayout,
  operationalTableColumnClass,
} from '@/lib/operationalTableLayout'
import {
  OIL_LOSS_ALL_CONTRACT_COLUMN_LAYOUT_VERSION,
  OIL_LOSS_ALL_CONTRACT_COLUMN_LAYOUT_VERSION_KEY,
  OIL_LOSS_ALL_CONTRACT_DEFAULT_VISIBLE_COLUMN_IDS,
  aggregateOilLossByContract,
  buildOilLossAllContractVisibleColumns,
  mergeOilLossAllContractColumnOrder,
  oilLossAllContractCompactColumnFallbackOrder,
  oilLossAllContractDefaultVisibleColumnIds,
  type OilLossAllContractRow,
  type OilLossSourceRow,
} from '@/lib/oilLossAllContractColumns'
import {
  OIL_LOSS_BY_TRANSPORTER_COLUMN_LAYOUT_VERSION,
  OIL_LOSS_BY_TRANSPORTER_COLUMN_LAYOUT_VERSION_KEY,
  OIL_LOSS_BY_TRANSPORTER_DEFAULT_VISIBLE_COLUMN_IDS,
  aggregateOilLossByTransporter,
  buildOilLossByTransporterVisibleColumns,
  mergeOilLossByTransporterColumnOrder,
  oilLossByTransporterCompactColumnFallbackOrder,
  oilLossByTransporterDefaultVisibleColumnIds,
  type OilLossByTransporterRow,
} from '@/lib/oilLossByTransporterColumns'
import TransporterHistoryModal, {
  type TransporterHistoryContractRow,
  type TransporterHistoryModalSelection,
} from '@/components/oil-loss/TransporterHistoryModal'

interface OilLossRow extends OilLossSourceRow {
  transport_mode: 'LAND' | 'SEA'
  operation_id: string
  contract_number: string
}

type OilLossTableViewMode = 'all_contract' | 'by_transporter'

type ROilLossKey = 'r1' | 'r2' | 'r3' | 'r4'

type ROilLossSummary = {
  avgMt: number | null
  avgPct: number | null
  totalMt: number | null
  totalPct: number | null
  sampleCount?: number
}

type YtdOilLossSummary = {
  year: number
  dateFrom: string
  dateTo: string
  r1: ROilLossSummary
  r2: ROilLossSummary
  r3: ROilLossSummary
  r4: ROilLossSummary
}

type OilLossTableRow = OilLossAllContractRow | OilLossByTransporterRow

type CompactColumn = {
  id: string
  label: string
  defaultVisible: boolean
  sortable: boolean
  formulaHelp?: string
  getSortValue: (row: OilLossTableRow) => string | number
  render: (row: OilLossTableRow) => ReactNode
}

type ViewColumnPrefs = {
  visibleIds: Set<string>
  orderIds: string[]
  sortKey: string
  sortDir: 'asc' | 'desc'
}

const R_OIL_LOSS_CARDS: Array<{ key: ROilLossKey; label: string; formula: string }> = [
  { key: 'r1', label: 'R1', formula: 'Quantity SFAL - Quantity Delivery' },
  { key: 'r2', label: 'R2', formula: 'Quantity SFBD - Quantity SFAL' },
  { key: 'r3', label: 'R3', formula: 'Quantity Receive - Quantity SFBD' },
  { key: 'r4', label: 'R4', formula: 'Quantity Receive - Quantity Delivery' },
]

function oilLossValueTone(value: number | null, emphasis: 'primary' | 'secondary'): string {
  if (value == null) return emphasis === 'primary' ? 'text-gray-400' : 'text-gray-300'
  if (value < 0) return emphasis === 'primary' ? 'text-red-700' : 'text-red-600/90'
  if (value > 0) return emphasis === 'primary' ? 'text-green-700' : 'text-green-600/90'
  return emphasis === 'primary' ? 'text-gray-900' : 'text-gray-600'
}

function formatShortDate(dateStr: string) {
  return formatDateDMY(dateStr)
}

function getStatusColor(status: string) {
  const normalized = String(status || '').trim().toLowerCase()
  if (normalized === 'close' || normalized === 'closed' || normalized === 'completed') {
    return 'bg-green-100 text-green-800'
  }
  if (normalized === 'cancelled' || normalized === 'canceled') {
    return 'bg-red-100 text-red-800'
  }
  if (normalized === 'open' || normalized === 'in progress' || normalized === 'in_progress') {
    return 'bg-yellow-100 text-yellow-800'
  }
  return 'bg-gray-100 text-gray-800'
}

function buildAllContractCompactColumns(): CompactColumn[] {
  return [
    {
      id: 'contract_date',
      label: 'Contract Date',
      defaultVisible: true,
      sortable: true,
      getSortValue: (r) => r.contract_date || '',
      render: (r) => <span className="text-sm">{formatShortDate(r.contract_date || '')}</span>,
    },
    {
      id: 'contract_ext_no',
      label: 'Contract Ext No',
      defaultVisible: true,
      sortable: true,
      getSortValue: (r) => r.contract_ext_no || r.contract_number || '',
      render: (r) => (
        <OperationalStackedCommaCell
          value={r.contract_ext_no || r.contract_number}
          title={(r.contract_ext_no || r.contract_number || '') as string}
        />
      ),
    },
    {
      id: 'po_number',
      label: 'PO',
      defaultVisible: true,
      sortable: true,
      getSortValue: (r) => r.po_number || '',
      render: (r) => (
        <OperationalStackedCommaCell value={r.po_number} title={r.po_number || ''} />
      ),
    },
    {
      id: 'sto_number',
      label: 'STO',
      defaultVisible: true,
      sortable: true,
      getSortValue: (r) => r.sto_number || '',
      render: (r) => (
        <OperationalStackedCommaCell value={r.sto_number} title={r.sto_number || ''} />
      ),
    },
    {
      id: 'product',
      label: 'Product',
      defaultVisible: true,
      sortable: true,
      getSortValue: (r) => r.product || '',
      render: (r) => <OperationalTruncatedCell value={r.product} title={r.product || ''} />,
    },
    {
      id: 'incoterm',
      label: 'Incoterm',
      defaultVisible: true,
      sortable: true,
      getSortValue: (r) => r.incoterm || '',
      render: (r) => <OperationalTruncatedCell value={r.incoterm} title={r.incoterm || ''} />,
    },
    {
      id: 'quantity_contract',
      label: 'Qty Contract',
      defaultVisible: true,
      sortable: true,
      getSortValue: (r) => r.quantity_contract || 0,
      render: (r) => (
        <span className="text-sm tabular-nums">{formatQtyMtFromKg(r.quantity_contract)}</span>
      ),
    },
    {
      id: 'quantity_delivery',
      label: 'Qty Delivery',
      defaultVisible: true,
      sortable: true,
      getSortValue: (r) => r.quantity_delivery || 0,
      render: (r) => (
        <span className="text-sm tabular-nums">{formatQtyMtFromKg(r.quantity_delivery)}</span>
      ),
    },
    {
      id: 'quantity_received',
      label: 'Qty Received',
      defaultVisible: true,
      sortable: true,
      getSortValue: (r) => r.quantity_received || 0,
      render: (r) => (
        <span className="text-sm tabular-nums">{formatQtyMtFromKg(r.quantity_received)}</span>
      ),
    },
    {
      id: 'gain_loss_amount',
      label: 'Oil Loss (MT)',
      formulaHelp: FIELD_HELP.oilLossAmount,
      defaultVisible: true,
      sortable: true,
      getSortValue: (r) => r.gain_loss_amount || 0,
      render: (r) => {
        const kg = r.gain_loss_amount
        const tone =
          kg != null && kg < 0 ? 'text-red-600' : kg != null && kg > 0 ? 'text-green-600' : 'text-gray-900'
        return <span className={`text-sm tabular-nums ${tone}`}>{formatOilLossMtFromKg(kg)}</span>
      },
    },
    {
      id: 'gain_loss_percentage',
      label: 'Oil Loss %',
      formulaHelp: FIELD_HELP.oilLossPct,
      defaultVisible: true,
      sortable: true,
      getSortValue: (r) => r.gain_loss_percentage || 0,
      render: (r) => {
        const pct = r.gain_loss_percentage
        const tone =
          pct != null && pct < 0 ? 'text-red-600' : pct != null && pct > 0 ? 'text-green-600' : 'text-gray-900'
        return <span className={`text-sm tabular-nums ${tone}`}>{formatOilLossPct(pct)}</span>
      },
    },
    {
      id: 'status',
      label: 'Status',
      defaultVisible: true,
      sortable: true,
      getSortValue: (r) => r.status || '',
      render: (r) => (
        <Badge className={getStatusColor(r.status || '')}>{r.status || '—'}</Badge>
      ),
    },
    {
      id: 'transport_mode',
      label: 'Mode',
      defaultVisible: false,
      sortable: true,
      getSortValue: (r) => r.transport_mode || '',
      render: (r) => (
        <Badge
          className={
            r.transport_mode === 'SEA' ? 'bg-blue-100 text-blue-800' : 'bg-orange-100 text-orange-800'
          }
        >
          {r.transport_mode || '—'}
        </Badge>
      ),
    },
    {
      id: 'group_name',
      label: 'Group',
      defaultVisible: false,
      sortable: true,
      getSortValue: (r) => r.group_name || '',
      render: (r) => <span className="text-sm break-words">{r.group_name || '—'}</span>,
    },
    {
      id: 'supplier',
      label: 'Supplier',
      defaultVisible: false,
      sortable: true,
      getSortValue: (r) => r.supplier || '',
      render: (r) => <span className="text-sm break-words">{r.supplier || '—'}</span>,
    },
    {
      id: 'buyer',
      label: 'Buyer',
      defaultVisible: false,
      sortable: true,
      getSortValue: (r) => r.buyer || '',
      render: (r) => <span className="text-sm break-words">{r.buyer || '—'}</span>,
    },
    {
      id: 'plant_site',
      label: 'Plant/Site',
      defaultVisible: false,
      sortable: true,
      getSortValue: (r) => r.plant_site || '',
      render: (r) => <span className="text-sm break-words">{r.plant_site || '—'}</span>,
    },
    {
      id: 'operation_id',
      label: 'Operation ID',
      defaultVisible: false,
      sortable: true,
      getSortValue: (r) => r.operation_id || '',
      render: (r) => (
        <OperationalNowrapCell value={r.operation_id} title={r.operation_id || ''} />
      ),
    },
    {
      id: 'contract_number',
      label: 'Contract No',
      defaultVisible: false,
      sortable: true,
      getSortValue: (r) => r.contract_number || '',
      render: (r) => (
        <OperationalStackedCommaCell value={r.contract_number} title={r.contract_number || ''} />
      ),
    },
    {
      id: 'quantity_sfal',
      label: 'Qty SFAL',
      defaultVisible: false,
      sortable: true,
      getSortValue: (r) => r.quantity_sfal || 0,
      render: (r) => (
        <span className="text-sm tabular-nums">{formatQtyMtFromKg(r.quantity_sfal)}</span>
      ),
    },
    {
      id: 'quantity_sfbd',
      label: 'Qty SFBD',
      defaultVisible: false,
      sortable: true,
      getSortValue: (r) => r.quantity_sfbd || 0,
      render: (r) => (
        <span className="text-sm tabular-nums">{formatQtyMtFromKg(r.quantity_sfbd)}</span>
      ),
    },
  ]
}

const ALL_CONTRACT_COMPACT_COLUMNS = buildAllContractCompactColumns()

function buildByTransporterCompactColumns(): CompactColumn[] {
  return [
    {
      id: 'transporter',
      label: 'Transporter',
      defaultVisible: true,
      sortable: true,
      getSortValue: (r) => ('transporter' in r ? r.transporter : '') || '',
      render: (r) => (
        <OperationalNowrapCell
          value={'transporter' in r ? r.transporter : null}
          title={('transporter' in r ? r.transporter : '') || ''}
          className="text-sm"
        />
      ),
    },
    {
      id: 'quantity_contract',
      label: 'Qty Contract',
      defaultVisible: true,
      sortable: true,
      getSortValue: (r) => ('quantity_contract' in r ? r.quantity_contract : 0) || 0,
      render: (r) => (
        <span className="text-sm tabular-nums">
          {formatQtyMtFromKg('quantity_contract' in r ? r.quantity_contract : null)}
        </span>
      ),
    },
    {
      id: 'quantity_delivery',
      label: 'Qty Delivery',
      defaultVisible: true,
      sortable: true,
      getSortValue: (r) => r.quantity_delivery || 0,
      render: (r) => (
        <span className="text-sm tabular-nums">{formatQtyMtFromKg(r.quantity_delivery)}</span>
      ),
    },
    {
      id: 'quantity_received',
      label: 'Qty Receive',
      defaultVisible: true,
      sortable: true,
      getSortValue: (r) => r.quantity_received || 0,
      render: (r) => (
        <span className="text-sm tabular-nums">{formatQtyMtFromKg(r.quantity_received)}</span>
      ),
    },
    {
      id: 'gain_loss_amount',
      label: 'Oil Loss (MT)',
      formulaHelp: FIELD_HELP.oilLossAmount,
      defaultVisible: true,
      sortable: true,
      getSortValue: (r) => r.gain_loss_amount || 0,
      render: (r) => {
        const kg = r.gain_loss_amount
        const tone =
          kg != null && kg < 0 ? 'text-red-600' : kg != null && kg > 0 ? 'text-green-600' : 'text-gray-900'
        return <span className={`text-sm tabular-nums ${tone}`}>{formatOilLossMtFromKg(kg)}</span>
      },
    },
    {
      id: 'gain_loss_percentage',
      label: 'Oil Loss %',
      formulaHelp: FIELD_HELP.oilLossPct,
      defaultVisible: true,
      sortable: true,
      getSortValue: (r) => r.gain_loss_percentage || 0,
      render: (r) => {
        const pct = r.gain_loss_percentage
        const tone =
          pct != null && pct < 0 ? 'text-red-600' : pct != null && pct > 0 ? 'text-green-600' : 'text-gray-900'
        return <span className={`text-sm tabular-nums ${tone}`}>{formatOilLossPct(pct)}</span>
      },
    },
    {
      id: 'loading_location',
      label: 'Loading Location',
      defaultVisible: false,
      sortable: true,
      getSortValue: (r) => ('loading_location' in r ? r.loading_location : '') || '',
      render: (r) => (
        <span className="text-sm break-words">
          {('loading_location' in r && r.loading_location) || '—'}
        </span>
      ),
    },
    {
      id: 'unloading_location',
      label: 'Unloading Location',
      defaultVisible: false,
      sortable: true,
      getSortValue: (r) => ('unloading_location' in r ? r.unloading_location : '') || '',
      render: (r) => (
        <span className="text-sm break-words">
          {('unloading_location' in r && r.unloading_location) || '—'}
        </span>
      ),
    },
    {
      id: 'contract_ext_no',
      label: 'Contract Ext No',
      defaultVisible: false,
      sortable: true,
      getSortValue: (r) => r.contract_ext_no || ('contract_number' in r ? r.contract_number : '') || '',
      render: (r) => (
        <OperationalStackedCommaCell
          value={r.contract_ext_no || ('contract_number' in r ? r.contract_number : null)}
          title={(r.contract_ext_no || ('contract_number' in r ? r.contract_number : '') || '') as string}
        />
      ),
    },
    {
      id: 'sto_number',
      label: 'STO',
      defaultVisible: false,
      sortable: true,
      getSortValue: (r) => r.sto_number || '',
      render: (r) => (
        <OperationalStackedCommaCell value={r.sto_number} title={r.sto_number || ''} />
      ),
    },
    {
      id: 'contract_date',
      label: 'Contract Date',
      defaultVisible: false,
      sortable: true,
      getSortValue: (r) => ('contract_date' in r ? r.contract_date : '') || '',
      render: (r) => (
        <span className="text-sm">{formatShortDate(('contract_date' in r && r.contract_date) || '')}</span>
      ),
    },
    {
      id: 'po_number',
      label: 'PO',
      defaultVisible: false,
      sortable: true,
      getSortValue: (r) => ('po_number' in r ? r.po_number : '') || '',
      render: (r) => (
        <OperationalStackedCommaCell
          value={'po_number' in r ? r.po_number : null}
          title={('po_number' in r ? r.po_number : '') || ''}
        />
      ),
    },
    {
      id: 'product',
      label: 'Product',
      defaultVisible: false,
      sortable: true,
      getSortValue: (r) => ('product' in r ? r.product : '') || '',
      render: (r) => (
        <OperationalTruncatedCell
          value={'product' in r ? r.product : null}
          title={('product' in r ? r.product : '') || ''}
        />
      ),
    },
    {
      id: 'incoterm',
      label: 'Incoterm',
      defaultVisible: false,
      sortable: true,
      getSortValue: (r) => ('incoterm' in r ? r.incoterm : '') || '',
      render: (r) => (
        <OperationalTruncatedCell
          value={'incoterm' in r ? r.incoterm : null}
          title={('incoterm' in r ? r.incoterm : '') || ''}
        />
      ),
    },
    {
      id: 'status',
      label: 'Status',
      defaultVisible: false,
      sortable: true,
      getSortValue: (r) => ('status' in r ? r.status : '') || '',
      render: (r) => (
        <Badge className={getStatusColor(('status' in r && r.status) || '')}>
          {('status' in r && r.status) || '—'}
        </Badge>
      ),
    },
    {
      id: 'transport_mode',
      label: 'Mode',
      defaultVisible: false,
      sortable: true,
      getSortValue: (r) => ('transport_mode' in r ? r.transport_mode : '') || '',
      render: (r) => (
        <Badge
          className={
            'transport_mode' in r && r.transport_mode === 'SEA'
              ? 'bg-blue-100 text-blue-800'
              : 'bg-orange-100 text-orange-800'
          }
        >
          {('transport_mode' in r && r.transport_mode) || '—'}
        </Badge>
      ),
    },
    {
      id: 'group_name',
      label: 'Group',
      defaultVisible: false,
      sortable: true,
      getSortValue: (r) => ('group_name' in r ? r.group_name : '') || '',
      render: (r) => <span className="text-sm break-words">{('group_name' in r && r.group_name) || '—'}</span>,
    },
    {
      id: 'supplier',
      label: 'Supplier',
      defaultVisible: false,
      sortable: true,
      getSortValue: (r) => ('supplier' in r ? r.supplier : '') || '',
      render: (r) => <span className="text-sm break-words">{('supplier' in r && r.supplier) || '—'}</span>,
    },
    {
      id: 'buyer',
      label: 'Buyer',
      defaultVisible: false,
      sortable: true,
      getSortValue: (r) => ('buyer' in r ? r.buyer : '') || '',
      render: (r) => <span className="text-sm break-words">{('buyer' in r && r.buyer) || '—'}</span>,
    },
    {
      id: 'plant_site',
      label: 'Plant/Site',
      defaultVisible: false,
      sortable: true,
      getSortValue: (r) => ('plant_site' in r ? r.plant_site : '') || '',
      render: (r) => <span className="text-sm break-words">{('plant_site' in r && r.plant_site) || '—'}</span>,
    },
    {
      id: 'operation_id',
      label: 'Operation ID',
      defaultVisible: false,
      sortable: true,
      getSortValue: (r) => ('operation_id' in r ? r.operation_id : '') || '',
      render: (r) => (
        <OperationalNowrapCell
          value={'operation_id' in r ? r.operation_id : null}
          title={('operation_id' in r ? r.operation_id : '') || ''}
        />
      ),
    },
    {
      id: 'contract_number',
      label: 'Contract No',
      defaultVisible: false,
      sortable: true,
      getSortValue: (r) => ('contract_number' in r ? r.contract_number : '') || '',
      render: (r) => (
        <OperationalStackedCommaCell
          value={'contract_number' in r ? r.contract_number : null}
          title={('contract_number' in r ? r.contract_number : '') || ''}
        />
      ),
    },
    {
      id: 'quantity_sfal',
      label: 'Qty SFAL',
      defaultVisible: false,
      sortable: true,
      getSortValue: (r) => ('quantity_sfal' in r ? r.quantity_sfal : 0) || 0,
      render: (r) => (
        <span className="text-sm tabular-nums">
          {formatQtyMtFromKg('quantity_sfal' in r ? r.quantity_sfal : null)}
        </span>
      ),
    },
    {
      id: 'quantity_sfbd',
      label: 'Qty SFBD',
      defaultVisible: false,
      sortable: true,
      getSortValue: (r) => ('quantity_sfbd' in r ? r.quantity_sfbd : 0) || 0,
      render: (r) => (
        <span className="text-sm tabular-nums">
          {formatQtyMtFromKg('quantity_sfbd' in r ? r.quantity_sfbd : null)}
        </span>
      ),
    },
  ]
}

const BY_TRANSPORTER_COMPACT_COLUMNS = buildByTransporterCompactColumns()

function toTransporterHistoryContractRow(row: OilLossRow): TransporterHistoryContractRow {
  return {
    id: row.id,
    transporter: row.transporter ?? null,
    contract_date: String(row.contract_date ?? row.operation_date ?? '').slice(0, 10) || null,
    contract_ext_no: row.contract_ext_no ?? null,
    po_number: row.po_number ?? null,
    sto_number: row.sto_number ?? null,
    quantity_delivery: row.quantity_delivery ?? row.quantity_sent ?? null,
    quantity_received: row.quantity_received ?? null,
    gain_loss_amount: row.gain_loss_amount ?? null,
    gain_loss_percentage: row.gain_loss_percentage ?? null,
    status: row.status ?? null,
  }
}

function loadAllContractColumnPrefs(allIds: string[]): ViewColumnPrefs {
  if (typeof window === 'undefined') {
    return {
      visibleIds: new Set(oilLossAllContractDefaultVisibleColumnIds(allIds)),
      orderIds: oilLossAllContractCompactColumnFallbackOrder(allIds),
      sortKey: 'contract_date',
      sortDir: 'desc',
    }
  }
  const version = window.localStorage.getItem(OIL_LOSS_ALL_CONTRACT_COLUMN_LAYOUT_VERSION_KEY)
  if (version !== OIL_LOSS_ALL_CONTRACT_COLUMN_LAYOUT_VERSION) {
    return {
      visibleIds: new Set(oilLossAllContractDefaultVisibleColumnIds(allIds)),
      orderIds: oilLossAllContractCompactColumnFallbackOrder(allIds),
      sortKey: 'contract_date',
      sortDir: 'desc',
    }
  }
  try {
    const savedVisible = JSON.parse(window.localStorage.getItem('oil-loss.all-contract.visibleColumns') || '[]') as string[]
    const savedOrder = JSON.parse(window.localStorage.getItem('oil-loss.all-contract.columnOrder') || '[]') as string[]
    const visibleIds = new Set(
      savedVisible.filter((id) => allIds.includes(id)).length > 0
        ? savedVisible.filter((id) => allIds.includes(id))
        : oilLossAllContractDefaultVisibleColumnIds(allIds),
    )
    return {
      visibleIds,
      orderIds: mergeOilLossAllContractColumnOrder(savedOrder, allIds),
      sortKey: 'contract_date',
      sortDir: 'desc',
    }
  } catch {
    return {
      visibleIds: new Set(oilLossAllContractDefaultVisibleColumnIds(allIds)),
      orderIds: oilLossAllContractCompactColumnFallbackOrder(allIds),
      sortKey: 'contract_date',
      sortDir: 'desc',
    }
  }
}

function loadByTransporterColumnPrefs(allIds: string[]): ViewColumnPrefs {
  if (typeof window === 'undefined') {
    return {
      visibleIds: new Set(oilLossByTransporterDefaultVisibleColumnIds(allIds)),
      orderIds: oilLossByTransporterCompactColumnFallbackOrder(allIds),
      sortKey: 'transporter',
      sortDir: 'asc',
    }
  }
  const version = window.localStorage.getItem(OIL_LOSS_BY_TRANSPORTER_COLUMN_LAYOUT_VERSION_KEY)
  if (version !== OIL_LOSS_BY_TRANSPORTER_COLUMN_LAYOUT_VERSION) {
    return {
      visibleIds: new Set(oilLossByTransporterDefaultVisibleColumnIds(allIds)),
      orderIds: oilLossByTransporterCompactColumnFallbackOrder(allIds),
      sortKey: 'transporter',
      sortDir: 'asc',
    }
  }
  try {
    const savedVisible = JSON.parse(
      window.localStorage.getItem('oil-loss.by-transporter.visibleColumns') || '[]',
    ) as string[]
    const savedOrder = JSON.parse(
      window.localStorage.getItem('oil-loss.by-transporter.columnOrder') || '[]',
    ) as string[]
    const visibleIds = new Set(
      savedVisible.filter((id) => allIds.includes(id)).length > 0
        ? savedVisible.filter((id) => allIds.includes(id))
        : oilLossByTransporterDefaultVisibleColumnIds(allIds),
    )
    return {
      visibleIds,
      orderIds: mergeOilLossByTransporterColumnOrder(savedOrder, allIds),
      sortKey: 'transporter',
      sortDir: 'asc',
    }
  } catch {
    return {
      visibleIds: new Set(oilLossByTransporterDefaultVisibleColumnIds(allIds)),
      orderIds: oilLossByTransporterCompactColumnFallbackOrder(allIds),
      sortKey: 'transporter',
      sortDir: 'asc',
    }
  }
}

export default function OilLossPage() {
  const allContractColumnIds = useMemo(() => ALL_CONTRACT_COMPACT_COLUMNS.map((c) => c.id), [])
  const transporterColumnIds = useMemo(() => BY_TRANSPORTER_COMPACT_COLUMNS.map((c) => c.id), [])
  const initialAllContractPrefs = useMemo(
    () => loadAllContractColumnPrefs(allContractColumnIds),
    [allContractColumnIds],
  )
  const initialTransporterPrefs = useMemo(
    () => loadByTransporterColumnPrefs(transporterColumnIds),
    [transporterColumnIds],
  )

  const [rows, setRows] = useState<OilLossRow[]>([])
  const [ytdSummary, setYtdSummary] = useState<YtdOilLossSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [viewTransitionLoading, setViewTransitionLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [showColumnsMenu, setShowColumnsMenu] = useState(false)
  const [columnPrefsByView, setColumnPrefsByView] = useState<Record<OilLossTableViewMode, ViewColumnPrefs>>({
    all_contract: initialAllContractPrefs,
    by_transporter: initialTransporterPrefs,
  })
  const [dragColId, setDragColId] = useState<string | null>(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [viewMode, setViewMode] = useState<OilLossTableViewMode>('all_contract')
  const [transporterModalOpen, setTransporterModalOpen] = useState(false)
  const [selectedTransporterData, setSelectedTransporterData] =
    useState<TransporterHistoryModalSelection | null>(null)
  const pageSize = 20

  const activePrefs = columnPrefsByView[viewMode]
  const visibleColumnIds = activePrefs.visibleIds
  const columnOrderIds = activePrefs.orderIds
  const sortKey = activePrefs.sortKey
  const sortDir = activePrefs.sortDir
  const activeCompactColumns =
    viewMode === 'all_contract' ? ALL_CONTRACT_COMPACT_COLUMNS : BY_TRANSPORTER_COMPACT_COLUMNS
  const operationalTableType =
    viewMode === 'all_contract' ? 'oil_loss' : 'oil_loss_transporter'
  const tableLoading = loading || viewTransitionLoading

  const columnsMenuRef = useRef<HTMLDivElement | null>(null)
  const topScrollRef = useRef<HTMLDivElement | null>(null)
  const bottomScrollRef = useRef<HTMLDivElement | null>(null)
  const isSyncingScroll = useRef(false)
  const [tableScrollWidth, setTableScrollWidth] = useState(0)

  const [selectedModes, setSelectedModes] = useState<string[]>([])
  const [selectedIncoterms, setSelectedIncoterms] = useState<string[]>([])
  const [availableIncoterms, setAvailableIncoterms] = useState<string[]>([])
  const [availableGroupPlants, setAvailableGroupPlants] = useState<string[]>([])
  const [availableProducts, setAvailableProducts] = useState<string[]>([])
  const {
    selectedProducts,
    selectedGroupPlants,
    handleProductsChange,
    handleGroupPlantsChange,
    resetUserScopeFilters,
  } = useUserScopeFilterDefaults('oil-loss')
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date()
    return `${d.getFullYear()}-01-01`
  })
  const [dateTo, setDateTo] = useState(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  })

  useEffect(() => {
    const fetch = async () => {
      try {
        setLoading(true)
        const res = await api.get('/oil-loss')
        const raw: OilLossRow[] = Array.isArray(res.data?.data)
          ? (res.data.data as OilLossRow[])
          : []
        setRows(filterOilLossEligibleRows(raw))
        setYtdSummary(res.data?.ytdSummary ?? null)
      } catch (err) {
        console.error('Oil loss load error:', err)
        setRows([])
        setYtdSummary(null)
      } finally {
        setLoading(false)
      }
    }
    fetch()
  }, [])

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
        console.error('Failed to fetch oil loss filter options:', e)
        setAvailableGroupPlants([])
        setAvailableIncoterms([])
        setAvailableProducts([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const handler = (ev: MouseEvent) => {
      const t = ev.target as Node
      if (showColumnsMenu && columnsMenuRef.current && !columnsMenuRef.current.contains(t)) {
        setShowColumnsMenu(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showColumnsMenu])

  const updateActivePrefs = useCallback(
    (patch: Partial<ViewColumnPrefs>) => {
      setColumnPrefsByView((prev) => ({
        ...prev,
        [viewMode]: { ...prev[viewMode], ...patch },
      }))
    },
    [viewMode],
  )

  const setVisibleColumnIds = useCallback(
    (next: Set<string> | ((prev: Set<string>) => Set<string>)) => {
      setColumnPrefsByView((prev) => {
        const current = prev[viewMode].visibleIds
        const resolved = typeof next === 'function' ? next(current) : next
        return { ...prev, [viewMode]: { ...prev[viewMode], visibleIds: resolved } }
      })
    },
    [viewMode],
  )

  const setColumnOrderIds = useCallback(
    (next: string[] | ((prev: string[]) => string[])) => {
      setColumnPrefsByView((prev) => {
        const current = prev[viewMode].orderIds
        const resolved = typeof next === 'function' ? next(current) : next
        return { ...prev, [viewMode]: { ...prev[viewMode], orderIds: resolved } }
      })
    },
    [viewMode],
  )

  const resetActiveColumnView = useCallback(() => {
    if (viewMode === 'all_contract') {
      updateActivePrefs({
        visibleIds: new Set(oilLossAllContractDefaultVisibleColumnIds(allContractColumnIds)),
        orderIds: oilLossAllContractCompactColumnFallbackOrder(allContractColumnIds),
        sortKey: 'contract_date',
        sortDir: 'desc',
      })
      return
    }
    updateActivePrefs({
      visibleIds: new Set(oilLossByTransporterDefaultVisibleColumnIds(transporterColumnIds)),
      orderIds: oilLossByTransporterCompactColumnFallbackOrder(transporterColumnIds),
      sortKey: 'transporter',
      sortDir: 'asc',
    })
  }, [viewMode, updateActivePrefs, allContractColumnIds, transporterColumnIds])

  useEffect(() => {
    setViewTransitionLoading(true)
    setShowColumnsMenu(false)
    setCurrentPage(1)
    const timer = window.setTimeout(() => setViewTransitionLoading(false), 180)
    return () => window.clearTimeout(timer)
  }, [viewMode])

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (viewMode === 'all_contract') {
      window.localStorage.setItem(
        OIL_LOSS_ALL_CONTRACT_COLUMN_LAYOUT_VERSION_KEY,
        OIL_LOSS_ALL_CONTRACT_COLUMN_LAYOUT_VERSION,
      )
      window.localStorage.setItem(
        'oil-loss.all-contract.visibleColumns',
        JSON.stringify([...columnPrefsByView.all_contract.visibleIds]),
      )
      window.localStorage.setItem(
        'oil-loss.all-contract.columnOrder',
        JSON.stringify(columnPrefsByView.all_contract.orderIds),
      )
      return
    }
    window.localStorage.setItem(
      OIL_LOSS_BY_TRANSPORTER_COLUMN_LAYOUT_VERSION_KEY,
      OIL_LOSS_BY_TRANSPORTER_COLUMN_LAYOUT_VERSION,
    )
    window.localStorage.setItem(
      'oil-loss.by-transporter.visibleColumns',
      JSON.stringify([...columnPrefsByView.by_transporter.visibleIds]),
    )
    window.localStorage.setItem(
      'oil-loss.by-transporter.columnOrder',
      JSON.stringify(columnPrefsByView.by_transporter.orderIds),
    )
  }, [columnPrefsByView])

  const hasActiveOilLossFilters =
    selectedModes.length > 0 ||
    selectedIncoterms.length > 0 ||
    selectedProducts.length > 0 ||
    selectedGroupPlants.length > 0 ||
    Boolean(dateFrom) ||
    Boolean(dateTo)

  const clearOilLossFilters = useCallback(() => {
    setSelectedModes([])
    setSelectedIncoterms([])
    resetUserScopeFilters()
    const d = new Date()
    setDateFrom(`${d.getFullYear()}-01-01`)
    setDateTo(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
    )
    setCurrentPage(1)
  }, [resetUserScopeFilters])

  const filteredByTopFilters = useMemo(() => {
    return rows.filter((row) => {
      if (!matchesOilLossModeFilter(row.transport_mode, selectedModes)) return false
      const incoterm = String(row.incoterm || '').trim() || 'Blank'
      if (selectedIncoterms.length > 0 && !selectedIncoterms.includes(incoterm)) return false
      const product = String(row.product || '').trim() || 'Blank'
      if (selectedProducts.length > 0 && !selectedProducts.includes(product)) return false
      const groupPlant = String(row.group_plant || '').trim() || 'Blank'
      if (selectedGroupPlants.length > 0 && !selectedGroupPlants.includes(groupPlant)) return false
      const d = String(row.contract_date ?? row.operation_date ?? '').slice(0, 10)
      if (dateFrom && d && d < dateFrom) return false
      if (dateTo && d && d > dateTo) return false
      return true
    })
  }, [
    rows,
    selectedModes,
    selectedIncoterms,
    selectedProducts,
    selectedGroupPlants,
    dateFrom,
    dateTo,
  ])

  const aggregatedContractRows = useMemo(
    () => aggregateOilLossByContract(filteredByTopFilters),
    [filteredByTopFilters],
  )

  const aggregatedTransporterRows = useMemo(
    () => aggregateOilLossByTransporter(filteredByTopFilters),
    [filteredByTopFilters],
  )

  const transporterHistorySourceRows = useMemo(
    () => filteredByTopFilters.map(toTransporterHistoryContractRow),
    [filteredByTopFilters],
  )

  const openTransporterModal = useCallback((row: OilLossByTransporterRow) => {
    setSelectedTransporterData({
      transporterName: row.transporter || 'Unknown',
      transporterKey: row.id,
      loadingLocations: row.loading_location,
      unloadingLocations: row.unloading_location,
      oilLossMtKg: row.gain_loss_amount,
      oilLossPct: row.gain_loss_percentage,
    })
    setTransporterModalOpen(true)
  }, [])

  const aggregatedRows = useMemo(
    () => (viewMode === 'all_contract' ? aggregatedContractRows : aggregatedTransporterRows),
    [viewMode, aggregatedContractRows, aggregatedTransporterRows],
  )

  const visibleColumns = useMemo(() => {
    if (viewMode === 'all_contract') {
      return buildOilLossAllContractVisibleColumns(
        ALL_CONTRACT_COMPACT_COLUMNS,
        visibleColumnIds,
        columnOrderIds,
      )
    }
    return buildOilLossByTransporterVisibleColumns(
      BY_TRANSPORTER_COMPACT_COLUMNS,
      visibleColumnIds,
      columnOrderIds,
    )
  }, [viewMode, visibleColumnIds, columnOrderIds])

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase()
    const searched = !q
      ? aggregatedRows
      : aggregatedRows.filter((row) => {
          if (viewMode === 'all_contract') {
            const contractRow = row as OilLossAllContractRow
            return [
              contractRow.contract_ext_no,
              contractRow.contract_number,
              contractRow.po_number,
              contractRow.sto_number,
              contractRow.product,
              contractRow.supplier,
              contractRow.incoterm,
            ].some((v) => String(v || '').toLowerCase().includes(q))
          }
          const transporterRow = row as OilLossByTransporterRow
          return [transporterRow.transporter].some((v) => String(v || '').toLowerCase().includes(q))
        })

    const sortCol = activeCompactColumns.find((c) => c.id === sortKey)
    if (!sortCol) return searched

    return [...searched].sort((a, b) => {
      const aVal = sortCol.getSortValue(a)
      const bVal = sortCol.getSortValue(b)
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return sortDir === 'asc' ? aVal - bVal : bVal - aVal
      }
      const aS = String(aVal).toLowerCase()
      const bS = String(bVal).toLowerCase()
      return sortDir === 'asc' ? aS.localeCompare(bS) : bS.localeCompare(aS)
    })
  }, [aggregatedRows, search, sortKey, sortDir, viewMode, activeCompactColumns])

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize))
  const paginatedRows = useMemo(
    () => filteredRows.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [filteredRows, currentPage, pageSize],
  )

  const rangeStart = filteredRows.length === 0 ? 0 : (currentPage - 1) * pageSize + 1
  const rangeEnd = Math.min(currentPage * pageSize, filteredRows.length)

  useEffect(() => {
    setCurrentPage(1)
  }, [
    filteredRows.length,
    search,
    selectedModes,
    selectedIncoterms,
    selectedProducts,
    selectedGroupPlants,
    dateFrom,
    dateTo,
  ])

  useEffect(() => {
    const calc = () => {
      if (bottomScrollRef.current) setTableScrollWidth(bottomScrollRef.current.scrollWidth)
    }
    calc()
    window.addEventListener('resize', calc)
    return () => window.removeEventListener('resize', calc)
  }, [visibleColumns, paginatedRows.length, tableLoading])

  const handlePageChange = (p: number) => {
    if (p >= 1 && p <= totalPages) {
      setCurrentPage(p)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }

  const toggleColumn = (id: string) => {
    setVisibleColumnIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        if (next.size <= 1) return prev
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const onSortHeaderClick = (col: CompactColumn) => {
    if (!col.sortable) return
    if (sortKey === col.id) {
      updateActivePrefs({ sortDir: sortDir === 'asc' ? 'desc' : 'asc' })
      return
    }
    updateActivePrefs({ sortKey: col.id, sortDir: 'asc' })
  }

  const reorderColumnByDrag = (fromId: string, toId: string) => {
    if (!fromId || !toId || fromId === toId) return
    setColumnOrderIds((prev) => {
      const fallback =
        viewMode === 'all_contract'
          ? oilLossAllContractCompactColumnFallbackOrder(allContractColumnIds)
          : oilLossByTransporterCompactColumnFallbackOrder(transporterColumnIds)
      const order = prev.length > 0 ? [...prev] : fallback
      const fromIdx = order.indexOf(fromId)
      const toIdx = order.indexOf(toId)
      if (fromIdx < 0 || toIdx < 0) return prev
      const next = [...order]
      const [moved] = next.splice(fromIdx, 1)
      next.splice(toIdx, 0, moved)
      return next
    })
  }

  const columnsMenuItems = useMemo(() => {
    const visibleIds = new Set(visibleColumns.map((c) => c.id))
    const byId = new Map(activeCompactColumns.map((c) => [c.id, c] as const))
    const fallback =
      viewMode === 'all_contract'
        ? oilLossAllContractCompactColumnFallbackOrder(allContractColumnIds)
        : oilLossByTransporterCompactColumnFallbackOrder(transporterColumnIds)
    const orderedIds = columnOrderIds.length > 0 ? columnOrderIds : fallback
    const hiddenCols = orderedIds
      .map((id) => byId.get(id))
      .filter((c): c is CompactColumn => !!c && !visibleIds.has(c.id))
      .sort((a, b) => a.label.localeCompare(b.label))
    return [...visibleColumns, ...hiddenCols]
  }, [
    visibleColumns,
    columnOrderIds,
    activeCompactColumns,
    viewMode,
    allContractColumnIds,
    transporterColumnIds,
  ])

  const switchViewMode = (mode: OilLossTableViewMode) => {
    setViewMode(mode)
    setCurrentPage(1)
  }

  return (
    <Layout>
      <div className="space-y-6">
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-gray-800">
            Year-to-Date (YTD) Oil Loss Summary
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {R_OIL_LOSS_CARDS.map((card) => {
            const summary = ytdSummary?.[card.key] ?? {
              avgMt: null,
              avgPct: null,
              totalMt: null,
              totalPct: null,
            }
            const totalMt = loading ? null : summary.totalMt
            const totalPct = loading ? null : summary.totalPct
            const avgMt = loading ? null : summary.avgMt
            const avgPct = loading ? null : summary.avgPct

            return (
              <div
                key={card.key}
                className="flex min-h-full flex-col rounded-xl border bg-white p-4 sm:p-5 shadow-sm"
              >
                <div className="mb-4 flex items-start gap-2">
                  <span className="text-3xl font-bold leading-none tracking-tight text-gray-900">
                    {card.label}
                  </span>
                  <FieldHelp text={`Formula: ${card.formula}`} />
                </div>

                <div className="space-y-3">
                  <div>
                    <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                      Total
                    </div>
                    <div className="grid grid-cols-2 gap-x-3 gap-y-2">
                      <div className="min-w-0">
                        <div className="text-[11px] font-medium uppercase tracking-wide text-gray-500 leading-snug">
                          Total Oil Loss (MT)
                        </div>
                        <div
                          className={`mt-0.5 text-lg font-semibold leading-tight tabular-nums ${
                            loading ? 'text-gray-400' : oilLossValueTone(totalMt, 'primary')
                          }`}
                        >
                          {loading ? '…' : formatOilLossTotalMt(totalMt)}
                        </div>
                      </div>
                      <div className="min-w-0">
                        <div className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
                          Total Oil Loss (%)
                        </div>
                        <div
                          className={`mt-0.5 text-lg font-semibold leading-tight tabular-nums ${
                            loading ? 'text-gray-400' : oilLossValueTone(totalPct, 'primary')
                          }`}
                        >
                          {loading ? '…' : formatOilLossTotalPct(totalPct)}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="border-t border-gray-100 pt-3">
                    <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                      Average
                    </div>
                    <div className="grid grid-cols-2 gap-x-3 gap-y-2">
                      <div className="min-w-0">
                        <div className="text-[10px] font-medium uppercase tracking-wide text-gray-400 leading-snug">
                          Avg Oil Loss (MT)
                        </div>
                        <div
                          className={`mt-0.5 text-sm font-medium leading-tight tabular-nums ${
                            loading ? 'text-gray-300' : oilLossValueTone(avgMt, 'secondary')
                          }`}
                        >
                          {loading ? '…' : formatOilLossAvgMt(avgMt)}
                        </div>
                      </div>
                      <div className="min-w-0">
                        <div className="text-[10px] font-medium uppercase tracking-wide text-gray-400">
                          Avg Oil Loss (%)
                        </div>
                        <div
                          className={`mt-0.5 text-sm font-medium leading-tight tabular-nums ${
                            loading ? 'text-gray-300' : oilLossValueTone(avgPct, 'secondary')
                          }`}
                        >
                          {loading ? '…' : formatOilLossAvgPct(avgPct)}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
          </div>
        </div>

        <Card>
          <CardContent className="pt-6">
            <div className="space-y-4">
              <div className="flex flex-wrap items-end gap-4">
                <div className="flex-1 min-w-[200px]">
                  <label className="text-sm font-medium text-gray-700 mb-1 block">Search</label>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                    <Input
                      placeholder={
                        viewMode === 'all_contract'
                          ? 'Search contract, PO, STO, product, supplier...'
                          : 'Search transporter...'
                      }
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      className="pl-10 h-10"
                    />
                  </div>
                </div>
                <div className="w-52 min-w-[180px]">
                  <SearchableMultiSelect
                    label="Mode"
                    options={[...OIL_LOSS_MODE_FILTER_OPTIONS]}
                    selected={selectedModes}
                    onChange={setSelectedModes}
                    placeholder="All modes"
                    emptyMessage="SEA, LAND, MIX"
                  />
                </div>
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
                groupPlantPlaceholder="Select group plant(s)"
                groupPlantEmptyMessage="No group plants"
              />

              <div className="flex flex-wrap items-center gap-4">
                <div className="flex flex-wrap items-center gap-2">
                  <label className="text-sm font-medium text-gray-700">Contract Date:</label>
                  <DateInputDdMmYyyy valueIso={dateFrom} onChangeIso={setDateFrom} className="w-40" />
                  <span className="text-gray-500">to</span>
                  <DateInputDdMmYyyy valueIso={dateTo} onChangeIso={setDateTo} className="w-40" />
                  {hasActiveOilLossFilters ? (
                    <Button
                      type="button"
                      onClick={clearOilLossFilters}
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

        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle>{viewMode === 'all_contract' ? 'All Contract' : 'By Transporter'}</CardTitle>
                {tableLoading ? (
                  <ContractPerfTableSubtitleSkeleton />
                ) : (
                  <p className="text-xs text-gray-500 mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0">
                    <span className="whitespace-nowrap tabular-nums text-gray-700">
                      Showing{' '}
                      <span className="font-semibold">
                        {rangeStart.toLocaleString('en-US')} to {rangeEnd.toLocaleString('en-US')}
                      </span>{' '}
                      of <span className="font-semibold">{filteredRows.length.toLocaleString('en-US')}</span>{' '}
                      entries
                    </span>
                    {totalPages > 1 ? (
                      <>
                        <span className="text-gray-400" aria-hidden>
                          ·
                        </span>
                        <span className="whitespace-nowrap tabular-nums">
                          Page {currentPage}/{totalPages}
                        </span>
                      </>
                    ) : null}
                  </p>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="inline-flex rounded-lg border bg-white p-1">
                  <button
                    type="button"
                    onClick={() => switchViewMode('all_contract')}
                    className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${viewMode === 'all_contract' ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-100'}`}
                  >
                    All Contract
                  </button>
                  <button
                    type="button"
                    onClick={() => switchViewMode('by_transporter')}
                    className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${viewMode === 'by_transporter' ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-100'}`}
                  >
                    By Transporter
                  </button>
                </div>
                <div ref={columnsMenuRef} className="relative">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowColumnsMenu((v) => !v)}
                    disabled={tableLoading}
                  >
                      <SlidersHorizontal className="h-4 w-4 mr-2" />
                      Columns
                    </Button>
                    {showColumnsMenu && (
                      <div className="absolute right-0 mt-2 w-64 rounded-md border bg-white shadow-md z-50 p-3">
                        <div className="flex items-center justify-between gap-2 mb-2">
                          <div className="text-xs font-semibold text-gray-600">Visible columns</div>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            onClick={() => setShowColumnsMenu(false)}
                          >
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                        <div className="flex items-center gap-1 mb-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="flex-1 text-xs h-7"
                            onClick={() =>
                              setVisibleColumnIds(new Set(activeCompactColumns.map((c) => c.id)))
                            }
                          >
                            Select All
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="flex-1 text-xs h-7"
                            onClick={() =>
                              setVisibleColumnIds(
                                new Set([
                                  viewMode === 'all_contract'
                                    ? OIL_LOSS_ALL_CONTRACT_DEFAULT_VISIBLE_COLUMN_IDS[0]
                                    : OIL_LOSS_BY_TRANSPORTER_DEFAULT_VISIBLE_COLUMN_IDS[0],
                                ]),
                              )
                            }
                          >
                            Unselect All
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="flex-1 text-xs h-7"
                            onClick={resetActiveColumnView}
                          >
                            Reset
                          </Button>
                        </div>
                        <div className="border-t pt-2 space-y-1 max-h-72 overflow-auto pr-1">
                          {columnsMenuItems.map((col) => (
                            <div
                              key={col.id}
                              draggable
                              onDragStart={() => setDragColId(col.id)}
                              onDragEnd={() => setDragColId(null)}
                              onDragOver={(e) => e.preventDefault()}
                              onDrop={() => {
                                if (dragColId && dragColId !== col.id) reorderColumnByDrag(dragColId, col.id)
                              }}
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
                        onClick={() => handlePageChange(currentPage - 1)}
                        disabled={currentPage <= 1 || tableLoading}
                      >
                        Previous
                      </Button>
                      <div className="flex items-center gap-1">
                        {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                          let pageNum: number
                          if (totalPages <= 5) pageNum = i + 1
                          else if (currentPage <= 3) pageNum = i + 1
                          else if (currentPage >= totalPages - 2) pageNum = totalPages - 4 + i
                          else pageNum = currentPage - 2 + i
                          return (
                            <Button
                              key={pageNum}
                              variant={currentPage === pageNum ? 'default' : 'outline'}
                              size="sm"
                              onClick={() => handlePageChange(pageNum)}
                              disabled={tableLoading}
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
                        onClick={() => handlePageChange(currentPage + 1)}
                        disabled={currentPage >= totalPages || tableLoading}
                      >
                        Next
                      </Button>
                    </div>
                  )}
                </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className={tableLoading ? 'min-h-[480px]' : undefined}>
                <div className="hidden lg:block border rounded-lg overflow-hidden">
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
                      data-oil-loss-table={viewMode}
                      className={cn(
                        COMPACT_OPERATIONAL_TABLE_CLASS,
                        viewMode === 'by_transporter' && 'klip-compact-table--intrinsic-token-cols',
                      )}
                    >
                      <thead>
                        <tr className={CONTRACT_PERF_TABLE_HEADER_ROW_CLASS}>
                          {visibleColumns.map((col) => {
                            const active = sortKey === col.id
                            const opColClass = operationalTableColumnClass(
                              getOperationalColumnLayout(operationalTableType, col.id),
                            )
                            return (
                              <th
                                key={col.id}
                                scope="col"
                                className={`relative text-left align-top font-semibold cursor-move ${CONTRACT_PERF_TABLE_CELL_PAD} ${opColClass} ${dragColId === col.id ? 'opacity-60' : ''}`}
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
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200">
                        {tableLoading ? (
                          <ContractTableBodySkeleton
                            columnCount={visibleColumns.length}
                            rowCount={8}
                            showActionsColumn={false}
                          />
                        ) : filteredRows.length === 0 ? (
                          <tr className="bg-white">
                            <td
                              colSpan={visibleColumns.length || 1}
                              className="px-4 py-10 text-center text-gray-500"
                            >
                              <Droplets className="h-16 w-16 text-gray-400 mx-auto mb-4" />
                              <p className="font-medium text-gray-700">No Data Available</p>
                              {search && (
                                <p className="text-sm mt-2">Try adjusting your search or filter criteria</p>
                              )}
                            </td>
                          </tr>
                        ) : (
                          paginatedRows.map((row, idx) => {
                            const stripeClass = idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'
                            return (
                              <tr key={row.id} className={stripeClass}>
                                {visibleColumns.map((col) => {
                                  const opColClass = operationalTableColumnClass(
                                    getOperationalColumnLayout(operationalTableType, col.id),
                                  )
                                  return (
                                    <td
                                      key={col.id}
                                      className={`${COMPACT_OPERATIONAL_TABLE_CELL_CLASS} ${opColClass} align-middle ${CONTRACT_PERF_TABLE_CELL_PAD} ${stripeClass}`}
                                    >
                                      <div
                                        className={`${COMPACT_OPERATIONAL_TABLE_CELL_INNER_CLASS} ${CONTRACT_PERF_TABLE_ROW_MIN_H}`}
                                      >
                                        {col.id === 'transporter' && viewMode === 'by_transporter' ? (
                                          (() => {
                                            const transporterRow = row as OilLossByTransporterRow
                                            const name = transporterRow.transporter || 'Unknown'
                                            return (
                                              <button
                                                type="button"
                                                className="block w-max max-w-none whitespace-nowrap text-left text-sm font-medium text-blue-700 hover:text-blue-900 hover:underline"
                                                onClick={(e) => {
                                                  e.stopPropagation()
                                                  openTransporterModal(transporterRow)
                                                }}
                                              >
                                                {name}
                                              </button>
                                            )
                                          })()
                                        ) : (
                                          col.render(row)
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

                {totalPages > 1 && (
                  <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-4">
                    <div className="text-sm text-gray-700 tabular-nums">
                      Showing {rangeStart.toLocaleString('en-US')} to {rangeEnd.toLocaleString('en-US')} of{' '}
                      {filteredRows.length.toLocaleString('en-US')} entries
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handlePageChange(currentPage - 1)}
                        disabled={currentPage <= 1 || tableLoading}
                      >
                        Previous
                      </Button>
                      {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                        let p: number
                        if (totalPages <= 5) p = i + 1
                        else if (currentPage <= 3) p = i + 1
                        else if (currentPage >= totalPages - 2) p = totalPages - 4 + i
                        else p = currentPage - 2 + i
                        return (
                          <Button
                            key={p}
                            variant={currentPage === p ? 'default' : 'outline'}
                            size="sm"
                            onClick={() => handlePageChange(p)}
                            disabled={tableLoading}
                            className="min-w-[36px]"
                          >
                            {p}
                          </Button>
                        )
                      })}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handlePageChange(currentPage + 1)}
                        disabled={currentPage >= totalPages || tableLoading}
                      >
                        Next
                      </Button>
                    </div>
                  </div>
                )}

                <p className="text-xs text-gray-500 mt-3">
                  {viewMode === 'all_contract'
                    ? 'Aggregated by contract. Qty Delivery & Qty Receive from SAP Data; SFAL/SFBD from SAP with shipment fallback. Quantities in MT (stored as Kg). Oil Loss (MT) = Qty Receive − Qty Delivery.'
                    : 'Aggregated by transporter. Qty Delivery & Qty Receive from SAP Data; SFAL/SFBD from SAP with shipment fallback. Quantities in MT (stored as Kg). Oil Loss (MT) = Qty Receive − Qty Delivery.'}
                </p>
              </div>
          </CardContent>
        </Card>

        <TransporterHistoryModal
          open={transporterModalOpen}
          onClose={() => {
            setTransporterModalOpen(false)
            setSelectedTransporterData(null)
          }}
          selection={selectedTransporterData}
          sourceRows={transporterHistorySourceRows}
        />
      </div>
    </Layout>
  )
}
