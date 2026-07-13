'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import Layout from '@/components/Layout'
import api from '@/lib/api'
import { buildCacheKey, cachedGet, peekCache } from '@/lib/clientDataCache'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Droplets, GripVertical, Loader2, Search, SlidersHorizontal, X } from 'lucide-react'
import { PerformanceScopeFilters } from '@/components/performance/PerformanceScopeFilters'
import { SearchableMultiSelect } from '@/components/SearchableMultiSelect'
import { FieldHelp } from '@/components/FieldHelp'
import { useUserScopeFilterDefaults } from '@/hooks/useUserScopeFilterDefaults'
import { FIELD_HELP } from '@/lib/fieldHelpText'
import { formatDateDMY } from '@/lib/dateFormat'
import { formatOperationalTableTextDisplay } from '@/lib/sapDisplayValue'
import {
  formatOilLossMtFromKg,
  formatOilLossPct,
  formatOilLossTotalMt,
  formatOilLossTotalPct,
} from '@/lib/oilLossFormat'
import {
  filterOilLossEligibleRows,
  OIL_LOSS_MODE_FILTER_OPTIONS,
} from '@/lib/oilLossEligibility'
import {
  buildOilLossSummaryForDateRange,
  type ROilLossKey,
} from '@/lib/oilLossSummary'
import {
  applyOilLossGlobalFilters,
  buildOilLossPeriodOptions,
  OIL_LOSS_GLOBAL_PRODUCT_OPTIONS,
  OIL_LOSS_GLOBAL_TOGGLE_BUTTON_BASE,
  OIL_LOSS_GLOBAL_TOGGLE_GROUP_CLASS,
  OIL_LOSS_GLOBAL_TRANSPORT_OPTIONS,
  oilLossGlobalToggleButtonClass,
  resolveOilLossPeriodDateRange,
  type OilLossGlobalPeriodKey,
  type OilLossGlobalProductFilter,
  type OilLossGlobalTransportFilter,
} from '@/lib/oilLossGlobalFilters'
import OilLossDrilldownSection from '@/components/oil-loss/OilLossDrilldownSection'
import {
  applyOilLossDrilldownFilters,
  EMPTY_OIL_LOSS_DRILLDOWN_FILTERS,
  formatOilLossDrilldownPath,
  hasOilLossDrilldownSelection,
  type OilLossDrilldownFilters,
} from '@/lib/oilLossDrilldown'
import {
  OIL_LOSS_COLUMN_PREFS_USER_KEY,
  parseOilLossColumnPrefsFromApiValue,
} from '@/lib/oilLossColumnPrefs'
import { cn, formatQtyMtFromKg } from '@/lib/utils'
import { ContractPerfTableSortHeader } from '@/components/performance/ContractPerfTableSortHeader'
import { TableInitialLoadPlaceholder } from '@/components/performance/TableInitialLoadPlaceholder'
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
import {
  OIL_LOSS_BY_SUPPLIER_COLUMN_LAYOUT_VERSION,
  OIL_LOSS_BY_SUPPLIER_COLUMN_LAYOUT_VERSION_KEY,
  OIL_LOSS_BY_SUPPLIER_DEFAULT_VISIBLE_COLUMN_IDS,
  aggregateOilLossBySupplier,
  buildOilLossBySupplierVisibleColumns,
  mergeOilLossBySupplierColumnOrder,
  oilLossBySupplierCompactColumnFallbackOrder,
  oilLossBySupplierDefaultVisibleColumnIds,
  type OilLossBySupplierRow,
} from '@/lib/oilLossBySupplierColumns'
import TransporterHistoryModal, {
  type OilLossGroupHistoryContractRow,
  type OilLossGroupHistoryModalSelection,
} from '@/components/oil-loss/TransporterHistoryModal'

interface OilLossRow extends OilLossSourceRow {
  transport_mode: 'LAND' | 'SEA'
  operation_id: string
  contract_number: string
}

type OilLossTableViewMode = 'all_contract' | 'by_transporter' | 'by_supplier'

type OilLossTableRow = OilLossAllContractRow | OilLossByTransporterRow | OilLossBySupplierRow

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
      label: 'Oil Loss',
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
      render: (r) => <span className="text-sm break-words">{formatOperationalTableTextDisplay(r.group_name, '—')}</span>,
    },
    {
      id: 'supplier',
      label: 'Supplier',
      defaultVisible: false,
      sortable: true,
      getSortValue: (r) => r.supplier || '',
      render: (r) => <span className="text-sm break-words">{formatOperationalTableTextDisplay(r.supplier, '—')}</span>,
    },
    {
      id: 'buyer',
      label: 'Buyer',
      defaultVisible: false,
      sortable: true,
      getSortValue: (r) => r.buyer || '',
      render: (r) => <span className="text-sm break-words">{formatOperationalTableTextDisplay(r.buyer, '—')}</span>,
    },
    {
      id: 'plant_site',
      label: 'Plant/Site',
      defaultVisible: false,
      sortable: true,
      getSortValue: (r) => r.plant_site || '',
      render: (r) => <span className="text-sm break-words">{formatOperationalTableTextDisplay(r.plant_site, '—')}</span>,
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
      label: 'Oil Loss',
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
          {formatOperationalTableTextDisplay('loading_location' in r ? r.loading_location : null, '—')}
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
          {formatOperationalTableTextDisplay('unloading_location' in r ? r.unloading_location : null, '—')}
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
      render: (r) => <span className="text-sm break-words">{formatOperationalTableTextDisplay('group_name' in r ? r.group_name : null, '—')}</span>,
    },
    {
      id: 'supplier',
      label: 'Supplier',
      defaultVisible: false,
      sortable: true,
      getSortValue: (r) => ('supplier' in r ? r.supplier : '') || '',
      render: (r) => <span className="text-sm break-words">{formatOperationalTableTextDisplay('supplier' in r ? r.supplier : null, '—')}</span>,
    },
    {
      id: 'buyer',
      label: 'Buyer',
      defaultVisible: false,
      sortable: true,
      getSortValue: (r) => ('buyer' in r ? r.buyer : '') || '',
      render: (r) => <span className="text-sm break-words">{formatOperationalTableTextDisplay('buyer' in r ? r.buyer : null, '—')}</span>,
    },
    {
      id: 'plant_site',
      label: 'Plant/Site',
      defaultVisible: false,
      sortable: true,
      getSortValue: (r) => ('plant_site' in r ? r.plant_site : '') || '',
      render: (r) => <span className="text-sm break-words">{formatOperationalTableTextDisplay('plant_site' in r ? r.plant_site : null, '—')}</span>,
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

function buildBySupplierCompactColumns(): CompactColumn[] {
  return [
    {
      id: 'supplier',
      label: 'Supplier',
      defaultVisible: true,
      sortable: true,
      getSortValue: (r) => ('supplier' in r ? r.supplier : '') || '',
      render: (r) => (
        <OperationalNowrapCell
          value={'supplier' in r ? r.supplier : null}
          title={('supplier' in r ? r.supplier : '') || ''}
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
      label: 'Oil Loss',
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
          {formatOperationalTableTextDisplay('loading_location' in r ? r.loading_location : null, '—')}
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
          {formatOperationalTableTextDisplay('unloading_location' in r ? r.unloading_location : null, '—')}
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
      render: (r) => <span className="text-sm break-words">{formatOperationalTableTextDisplay('group_name' in r ? r.group_name : null, '—')}</span>,
    },
    {
      id: 'transporter',
      label: 'Transporter',
      defaultVisible: false,
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
      id: 'buyer',
      label: 'Buyer',
      defaultVisible: false,
      sortable: true,
      getSortValue: (r) => ('buyer' in r ? r.buyer : '') || '',
      render: (r) => <span className="text-sm break-words">{formatOperationalTableTextDisplay('buyer' in r ? r.buyer : null, '—')}</span>,
    },
    {
      id: 'plant_site',
      label: 'Plant/Site',
      defaultVisible: false,
      sortable: true,
      getSortValue: (r) => ('plant_site' in r ? r.plant_site : '') || '',
      render: (r) => <span className="text-sm break-words">{formatOperationalTableTextDisplay('plant_site' in r ? r.plant_site : null, '—')}</span>,
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

const BY_SUPPLIER_COMPACT_COLUMNS = buildBySupplierCompactColumns()

function toGroupHistoryContractRow(row: OilLossSourceRow): OilLossGroupHistoryContractRow {
  return {
    id: row.id,
    transporter: row.transporter ?? null,
    supplier: row.supplier ?? null,
    contract_number: row.contract_number ?? null,
    contract_date: String(row.contract_date ?? row.operation_date ?? '').slice(0, 10) || null,
    contract_ext_no: row.contract_ext_no ?? null,
    po_number: row.po_number ?? null,
    sto_number: row.sto_number ?? null,
    quantity_delivery: row.quantity_delivery ?? row.quantity_sent ?? null,
    quantity_received: row.quantity_received ?? null,
    gain_loss_amount: row.gain_loss_amount ?? null,
    gain_loss_percentage: row.gain_loss_percentage ?? null,
    status: row.status ?? null,
    transport_mode: row.transport_mode ?? null,
    sto_type: row.sto_type ?? null,
  }
}

function readSavedOilLossColumns(
  visibleKey: string,
  orderKey: string,
  allIds: string[],
  defaultVisible: string[],
  mergeOrder: (saved: string[], allIds: string[]) => string[],
): { visibleIds: Set<string>; orderIds: string[] } {
  try {
    const savedVisible = JSON.parse(window.localStorage.getItem(visibleKey) || '[]') as string[]
    const savedOrder = JSON.parse(window.localStorage.getItem(orderKey) || '[]') as string[]
    const filteredVisible = savedVisible.filter((id) => allIds.includes(id))
    const visibleIds = new Set(filteredVisible.length > 0 ? filteredVisible : defaultVisible)
    return {
      visibleIds,
      orderIds: mergeOrder(savedOrder, allIds),
    }
  } catch {
    return {
      visibleIds: new Set(defaultVisible),
      orderIds: mergeOrder([], allIds),
    }
  }
}

function loadAllContractColumnPrefs(allIds: string[]): ViewColumnPrefs {
  const defaults: ViewColumnPrefs = {
    visibleIds: new Set(oilLossAllContractDefaultVisibleColumnIds(allIds)),
    orderIds: oilLossAllContractCompactColumnFallbackOrder(allIds),
    sortKey: 'contract_date',
    sortDir: 'desc',
  }
  if (typeof window === 'undefined') return defaults
  const loaded = readSavedOilLossColumns(
    'oil-loss.all-contract.visibleColumns',
    'oil-loss.all-contract.columnOrder',
    allIds,
    oilLossAllContractDefaultVisibleColumnIds(allIds),
    mergeOilLossAllContractColumnOrder,
  )
  if (loaded.visibleIds.size === 0) return defaults
  return { ...defaults, ...loaded }
}

function loadByTransporterColumnPrefs(allIds: string[]): ViewColumnPrefs {
  const defaults: ViewColumnPrefs = {
    visibleIds: new Set(oilLossByTransporterDefaultVisibleColumnIds(allIds)),
    orderIds: oilLossByTransporterCompactColumnFallbackOrder(allIds),
    sortKey: 'transporter',
    sortDir: 'asc',
  }
  if (typeof window === 'undefined') return defaults
  const loaded = readSavedOilLossColumns(
    'oil-loss.by-transporter.visibleColumns',
    'oil-loss.by-transporter.columnOrder',
    allIds,
    oilLossByTransporterDefaultVisibleColumnIds(allIds),
    mergeOilLossByTransporterColumnOrder,
  )
  if (loaded.visibleIds.size === 0) return defaults
  return { ...defaults, ...loaded }
}

function loadBySupplierColumnPrefs(allIds: string[]): ViewColumnPrefs {
  const defaults: ViewColumnPrefs = {
    visibleIds: new Set(oilLossBySupplierDefaultVisibleColumnIds(allIds)),
    orderIds: oilLossBySupplierCompactColumnFallbackOrder(allIds),
    sortKey: 'supplier',
    sortDir: 'asc',
  }
  if (typeof window === 'undefined') return defaults
  const loaded = readSavedOilLossColumns(
    'oil-loss.by-supplier.visibleColumns',
    'oil-loss.by-supplier.columnOrder',
    allIds,
    oilLossBySupplierDefaultVisibleColumnIds(allIds),
    mergeOilLossBySupplierColumnOrder,
  )
  if (loaded.visibleIds.size === 0) return defaults
  return { ...defaults, ...loaded }
}

export default function OilLossPage() {
  const allContractColumnIds = useMemo(() => ALL_CONTRACT_COMPACT_COLUMNS.map((c) => c.id), [])
  const transporterColumnIds = useMemo(() => BY_TRANSPORTER_COMPACT_COLUMNS.map((c) => c.id), [])
  const supplierColumnIds = useMemo(() => BY_SUPPLIER_COMPACT_COLUMNS.map((c) => c.id), [])
  const initialAllContractPrefs = useMemo(
    () => loadAllContractColumnPrefs(allContractColumnIds),
    [allContractColumnIds],
  )
  const initialTransporterPrefs = useMemo(
    () => loadByTransporterColumnPrefs(transporterColumnIds),
    [transporterColumnIds],
  )
  const initialSupplierPrefs = useMemo(
    () => loadBySupplierColumnPrefs(supplierColumnIds),
    [supplierColumnIds],
  )

  const [rows, setRows] = useState<OilLossRow[]>([])
  const [loading, setLoading] = useState(true)
  /** Background refresh while cached rows stay visible. */
  const [dataFetching, setDataFetching] = useState(false)
  const [viewTransitionLoading, setViewTransitionLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [showColumnsMenu, setShowColumnsMenu] = useState(false)
  const [columnPrefsByView, setColumnPrefsByView] = useState<Record<OilLossTableViewMode, ViewColumnPrefs>>({
    all_contract: initialAllContractPrefs,
    by_transporter: initialTransporterPrefs,
    by_supplier: initialSupplierPrefs,
  })
  const [dragColId, setDragColId] = useState<string | null>(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [viewMode, setViewMode] = useState<OilLossTableViewMode>('all_contract')
  const [groupModalOpen, setGroupModalOpen] = useState(false)
  const [selectedGroupData, setSelectedGroupData] = useState<OilLossGroupHistoryModalSelection | null>(null)
  const pageSize = 20

  const activePrefs = columnPrefsByView[viewMode]
  const visibleColumnIds = activePrefs.visibleIds
  const columnOrderIds = activePrefs.orderIds
  const sortKey = activePrefs.sortKey
  const sortDir = activePrefs.sortDir
  const activeCompactColumns =
    viewMode === 'all_contract'
      ? ALL_CONTRACT_COMPACT_COLUMNS
      : viewMode === 'by_transporter'
        ? BY_TRANSPORTER_COMPACT_COLUMNS
        : BY_SUPPLIER_COMPACT_COLUMNS
  const operationalTableType =
    viewMode === 'all_contract'
      ? 'oil_loss'
      : viewMode === 'by_transporter'
        ? 'oil_loss_transporter'
        : 'oil_loss_supplier'
  const tableLoading = (loading && rows.length === 0) || viewTransitionLoading

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
    userScopeReady,
  } = useUserScopeFilterDefaults('oil-loss')
  const showBlockingLoad = (loading && rows.length === 0) || !userScopeReady
  const [globalPeriod, setGlobalPeriod] = useState<OilLossGlobalPeriodKey>('MTD')
  const [globalTransport, setGlobalTransport] = useState<OilLossGlobalTransportFilter>('All')
  const [globalProduct, setGlobalProduct] = useState<OilLossGlobalProductFilter>('All')
  const [drilldownFilters, setDrilldownFilters] = useState<OilLossDrilldownFilters>(
    EMPTY_OIL_LOSS_DRILLDOWN_FILTERS,
  )
  const globalPeriodOptions = useMemo(() => buildOilLossPeriodOptions(), [])
  const globalPeriodMeta = useMemo(
    () => resolveOilLossPeriodDateRange(globalPeriod),
    [globalPeriod],
  )
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date()
    return `${d.getFullYear()}-01-01`
  })
  const [dateTo, setDateTo] = useState(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  })

  useEffect(() => {
    setDateFrom(globalPeriodMeta.dateFrom)
    setDateTo(globalPeriodMeta.dateTo)
  }, [globalPeriodMeta.dateFrom, globalPeriodMeta.dateTo])

  useEffect(() => {
    const cacheKey = buildCacheKey('GET', '/oil-loss')
    const cached = peekCache<{ data?: OilLossRow[] }>(cacheKey)
    if (cached) {
      const raw: OilLossRow[] = Array.isArray(cached.data) ? cached.data : []
      setRows(filterOilLossEligibleRows(raw))
      setLoading(false)
    }

    const applyOilLossEnvelope = (envelope: { data?: OilLossRow[] }) => {
      const raw: OilLossRow[] = Array.isArray(envelope?.data) ? envelope.data : []
      setRows(filterOilLossEligibleRows(raw))
    }

    const fetch = async () => {
      try {
        if (!cached) setLoading(true)
        setDataFetching(true)
        const { data, revalidating } = await cachedGet(cacheKey, () =>
          api.get('/oil-loss').then((r) => r.data),
          {
            onRevalidate: (fresh) => {
              applyOilLossEnvelope(fresh)
              setDataFetching(false)
            },
          },
        )
        applyOilLossEnvelope(data)
        if (!revalidating) setDataFetching(false)
      } catch (err) {
        console.error('Oil loss load error:', err)
        if (!cached) {
          setRows([])
        }
        setDataFetching(false)
      } finally {
        setLoading(false)
      }
    }
    void fetch()
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
    if (viewMode === 'by_transporter') {
      updateActivePrefs({
        visibleIds: new Set(oilLossByTransporterDefaultVisibleColumnIds(transporterColumnIds)),
        orderIds: oilLossByTransporterCompactColumnFallbackOrder(transporterColumnIds),
        sortKey: 'transporter',
        sortDir: 'asc',
      })
      return
    }
    updateActivePrefs({
      visibleIds: new Set(oilLossBySupplierDefaultVisibleColumnIds(supplierColumnIds)),
      orderIds: oilLossBySupplierCompactColumnFallbackOrder(supplierColumnIds),
      sortKey: 'supplier',
      sortDir: 'asc',
    })
  }, [viewMode, updateActivePrefs, allContractColumnIds, transporterColumnIds, supplierColumnIds])

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
    if (viewMode === 'by_transporter') {
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
      return
    }
    window.localStorage.setItem(
      OIL_LOSS_BY_SUPPLIER_COLUMN_LAYOUT_VERSION_KEY,
      OIL_LOSS_BY_SUPPLIER_COLUMN_LAYOUT_VERSION,
    )
    window.localStorage.setItem(
      'oil-loss.by-supplier.visibleColumns',
      JSON.stringify([...columnPrefsByView.by_supplier.visibleIds]),
    )
    window.localStorage.setItem(
      'oil-loss.by-supplier.columnOrder',
      JSON.stringify(columnPrefsByView.by_supplier.orderIds),
    )
  }, [columnPrefsByView, viewMode])

  // Load per-user column prefs when localStorage has no saved layout for a view.
  useEffect(() => {
    let cancelled = false
    const hadLocal = (visibleKey: string) => {
      try {
        const raw = localStorage.getItem(visibleKey)
        if (!raw) return false
        const parsed = JSON.parse(raw) as unknown
        return Array.isArray(parsed) && parsed.length > 0
      } catch {
        return Boolean(localStorage.getItem(visibleKey))
      }
    }
    ;(async () => {
      try {
        const res = await api.get(
          `/user-preferences/me?key=${encodeURIComponent(OIL_LOSS_COLUMN_PREFS_USER_KEY)}`,
        )
        const parsed = parseOilLossColumnPrefsFromApiValue(res.data?.data?.value)
        if (cancelled || !parsed) return
        setColumnPrefsByView((prev) => {
          const next = { ...prev }
          if (parsed.all_contract && !hadLocal('oil-loss.all-contract.visibleColumns')) {
            next.all_contract = {
              ...prev.all_contract,
              visibleIds: new Set(
                parsed.all_contract.visibleColumnIds.length > 0
                  ? parsed.all_contract.visibleColumnIds
                  : [...prev.all_contract.visibleIds],
              ),
              orderIds: mergeOilLossAllContractColumnOrder(
                parsed.all_contract.columnOrderIds,
                allContractColumnIds,
              ),
            }
          }
          if (parsed.by_transporter && !hadLocal('oil-loss.by-transporter.visibleColumns')) {
            next.by_transporter = {
              ...prev.by_transporter,
              visibleIds: new Set(
                parsed.by_transporter.visibleColumnIds.length > 0
                  ? parsed.by_transporter.visibleColumnIds
                  : [...prev.by_transporter.visibleIds],
              ),
              orderIds: mergeOilLossByTransporterColumnOrder(
                parsed.by_transporter.columnOrderIds,
                transporterColumnIds,
              ),
            }
          }
          if (parsed.by_supplier && !hadLocal('oil-loss.by-supplier.visibleColumns')) {
            next.by_supplier = {
              ...prev.by_supplier,
              visibleIds: new Set(
                parsed.by_supplier.visibleColumnIds.length > 0
                  ? parsed.by_supplier.visibleColumnIds
                  : [...prev.by_supplier.visibleIds],
              ),
              orderIds: mergeOilLossBySupplierColumnOrder(
                parsed.by_supplier.columnOrderIds,
                supplierColumnIds,
              ),
            }
          }
          return next
        })
      } catch {
        // keep localStorage bootstrap
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const saveOilLossViewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (saveOilLossViewTimerRef.current) clearTimeout(saveOilLossViewTimerRef.current)
    saveOilLossViewTimerRef.current = setTimeout(() => {
      void api
        .post('/user-preferences/me', {
          key: OIL_LOSS_COLUMN_PREFS_USER_KEY,
          value: {
            all_contract: {
              visibleColumnIds: [...columnPrefsByView.all_contract.visibleIds],
              columnOrderIds: columnPrefsByView.all_contract.orderIds,
            },
            by_transporter: {
              visibleColumnIds: [...columnPrefsByView.by_transporter.visibleIds],
              columnOrderIds: columnPrefsByView.by_transporter.orderIds,
            },
            by_supplier: {
              visibleColumnIds: [...columnPrefsByView.by_supplier.visibleIds],
              columnOrderIds: columnPrefsByView.by_supplier.orderIds,
            },
          },
        })
        .catch(() => {
          /* localStorage fallback */
        })
    }, 600)
    return () => {
      if (saveOilLossViewTimerRef.current) clearTimeout(saveOilLossViewTimerRef.current)
    }
  }, [columnPrefsByView])

  const hasActiveOilLossFilters =
    globalPeriod !== 'MTD' ||
    globalTransport !== 'All' ||
    globalProduct !== 'All' ||
    selectedModes.length > 0 ||
    selectedIncoterms.length > 0 ||
    selectedProducts.length > 0 ||
    selectedGroupPlants.length > 0

  const resetGlobalBarFilters = useCallback(() => {
    setGlobalPeriod('MTD')
    setGlobalTransport('All')
    setGlobalProduct('All')
    setDrilldownFilters(EMPTY_OIL_LOSS_DRILLDOWN_FILTERS)
    setCurrentPage(1)
  }, [])

  const resetOilLossDrilldown = useCallback(() => {
    setDrilldownFilters(EMPTY_OIL_LOSS_DRILLDOWN_FILTERS)
    setCurrentPage(1)
  }, [])

  const applyOilLossDrilldownChange = useCallback((next: OilLossDrilldownFilters) => {
    setDrilldownFilters(next)
    setCurrentPage(1)
  }, [])

  const clearOilLossFilters = useCallback(() => {
    setSelectedModes([])
    setSelectedIncoterms([])
    resetUserScopeFilters()
    resetGlobalBarFilters()
    resetOilLossDrilldown()
    const d = new Date()
    setDateFrom(`${d.getFullYear()}-01-01`)
    setDateTo(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
    )
    setCurrentPage(1)
  }, [resetUserScopeFilters, resetGlobalBarFilters, resetOilLossDrilldown])

  useEffect(() => {
    setDrilldownFilters(EMPTY_OIL_LOSS_DRILLDOWN_FILTERS)
    setCurrentPage(1)
  }, [
    globalPeriod,
    globalTransport,
    globalProduct,
    selectedModes,
    selectedIncoterms,
    selectedProducts,
    selectedGroupPlants,
  ])

  useEffect(() => {
    setCurrentPage(1)
  }, [globalPeriod, globalTransport, globalProduct])

  const globallyFilteredRows = useMemo(() => {
    return applyOilLossGlobalFilters({
      rows,
      period: globalPeriod,
      transport: globalTransport,
      product: globalProduct,
      selectedStaffProducts: selectedProducts,
      selectedStaffGroupPlants: selectedGroupPlants,
      selectedModes,
      selectedIncoterms,
    })
  }, [
    rows,
    globalPeriod,
    globalTransport,
    globalProduct,
    selectedProducts,
    selectedGroupPlants,
    selectedModes,
    selectedIncoterms,
  ])

  const periodSummary = useMemo(() => {
    if (!userScopeReady) return null
    return buildOilLossSummaryForDateRange(
      globallyFilteredRows,
      globalPeriodMeta.dateFrom,
      globalPeriodMeta.dateTo,
    )
  }, [userScopeReady, globallyFilteredRows, globalPeriodMeta.dateFrom, globalPeriodMeta.dateTo])

  const drilldownFilteredRows = useMemo(
    () => applyOilLossDrilldownFilters(globallyFilteredRows, drilldownFilters),
    [globallyFilteredRows, drilldownFilters],
  )

  const filteredByTopFilters = drilldownFilteredRows
  const drilldownPathLabel = useMemo(() => formatOilLossDrilldownPath(drilldownFilters), [drilldownFilters])
  const hasActiveDrilldown = hasOilLossDrilldownSelection(drilldownFilters)

  const aggregatedContractRows = useMemo(
    () => aggregateOilLossByContract(filteredByTopFilters),
    [filteredByTopFilters],
  )

  const aggregatedTransporterRows = useMemo(
    () => aggregateOilLossByTransporter(filteredByTopFilters),
    [filteredByTopFilters],
  )

  const aggregatedSupplierRows = useMemo(
    () => aggregateOilLossBySupplier(filteredByTopFilters),
    [filteredByTopFilters],
  )

  const groupHistorySourceRows = useMemo(
    () => filteredByTopFilters.map(toGroupHistoryContractRow),
    [filteredByTopFilters],
  )

  const openTransporterModal = useCallback((row: OilLossByTransporterRow) => {
    setSelectedGroupData({
      kind: 'transporter',
      entityName: formatOperationalTableTextDisplay(row.transporter),
      entityKey: row.id,
      loadingLocations: row.loading_location,
      unloadingLocations: row.unloading_location,
    })
    setGroupModalOpen(true)
  }, [])

  const openSupplierModal = useCallback((row: OilLossBySupplierRow) => {
    setSelectedGroupData({
      kind: 'supplier',
      entityName: formatOperationalTableTextDisplay(row.supplier),
      entityKey: row.id,
      loadingLocations: row.loading_location,
      unloadingLocations: row.unloading_location,
    })
    setGroupModalOpen(true)
  }, [])

  const aggregatedRows = useMemo(() => {
    if (viewMode === 'all_contract') return aggregatedContractRows
    if (viewMode === 'by_transporter') return aggregatedTransporterRows
    return aggregatedSupplierRows
  }, [viewMode, aggregatedContractRows, aggregatedTransporterRows, aggregatedSupplierRows])

  const visibleColumns = useMemo(() => {
    if (viewMode === 'all_contract') {
      return buildOilLossAllContractVisibleColumns(
        ALL_CONTRACT_COMPACT_COLUMNS,
        visibleColumnIds,
        columnOrderIds,
      )
    }
    if (viewMode === 'by_transporter') {
      return buildOilLossByTransporterVisibleColumns(
        BY_TRANSPORTER_COMPACT_COLUMNS,
        visibleColumnIds,
        columnOrderIds,
      )
    }
    return buildOilLossBySupplierVisibleColumns(
      BY_SUPPLIER_COMPACT_COLUMNS,
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
          if (viewMode === 'by_transporter') {
            const transporterRow = row as OilLossByTransporterRow
            return [transporterRow.transporter].some((v) => String(v || '').toLowerCase().includes(q))
          }
          const supplierRow = row as OilLossBySupplierRow
          return [supplierRow.supplier].some((v) => String(v || '').toLowerCase().includes(q))
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
          : viewMode === 'by_transporter'
            ? oilLossByTransporterCompactColumnFallbackOrder(transporterColumnIds)
            : oilLossBySupplierCompactColumnFallbackOrder(supplierColumnIds)
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
        : viewMode === 'by_transporter'
          ? oilLossByTransporterCompactColumnFallbackOrder(transporterColumnIds)
          : oilLossBySupplierCompactColumnFallbackOrder(supplierColumnIds)
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
    supplierColumnIds,
  ])

  const switchViewMode = (mode: OilLossTableViewMode) => {
    setViewMode(mode)
    setCurrentPage(1)
  }

  return (
    <Layout>
      <div className="space-y-6">
        <div className="space-y-3">
          <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-2">
            <span>Oil Loss</span>
            {dataFetching && rows.length > 0 ? (
              <Loader2 className="h-5 w-5 shrink-0 animate-spin text-gray-400" aria-hidden />
            ) : null}
          </h1>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-6 flex-wrap">
              <div className="flex items-center gap-3">
                <span className="text-sm font-medium text-gray-700 shrink-0">Period:</span>
                <select
                  value={globalPeriod}
                  onChange={(e) => setGlobalPeriod(e.target.value as OilLossGlobalPeriodKey)}
                  className="px-4 py-2 border rounded-lg text-sm text-gray-900 bg-white min-w-[140px]"
                >
                  {globalPeriodOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-3">
                <span className="text-sm font-medium text-gray-700 shrink-0">Transport:</span>
                <div className={OIL_LOSS_GLOBAL_TOGGLE_GROUP_CLASS}>
                  {OIL_LOSS_GLOBAL_TRANSPORT_OPTIONS.map((opt) => (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => setGlobalTransport(opt)}
                      className={`${OIL_LOSS_GLOBAL_TOGGLE_BUTTON_BASE} ${oilLossGlobalToggleButtonClass(globalTransport === opt)}`}
                    >
                      {opt}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-3">
                <span className="text-sm font-medium text-gray-700 shrink-0">Product:</span>
                <div className={OIL_LOSS_GLOBAL_TOGGLE_GROUP_CLASS}>
                  {OIL_LOSS_GLOBAL_PRODUCT_OPTIONS.map((opt) => (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => setGlobalProduct(opt)}
                      className={`${OIL_LOSS_GLOBAL_TOGGLE_BUTTON_BASE} ${oilLossGlobalToggleButtonClass(globalProduct === opt)}`}
                    >
                      {opt}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={resetGlobalBarFilters}
              className="text-sm text-blue-700 hover:underline shrink-0"
            >
              Reset selection
            </button>
          </div>

          <div
            className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 transition-opacity duration-200 ${
              dataFetching && rows.length > 0 ? 'opacity-65' : 'opacity-100'
            }`}
          >
          {R_OIL_LOSS_CARDS.map((card) => {
            const summary = periodSummary?.[card.key] ?? {
              avgMt: null,
              avgPct: null,
              totalMt: null,
              totalPct: null,
            }
            const totalMt = showBlockingLoad ? null : summary.totalMt
            const totalPct = showBlockingLoad ? null : summary.totalPct

            return (
              <div
                key={card.key}
                className="flex min-h-full flex-col rounded-lg border bg-white px-3 py-3 shadow-sm"
              >
                <div className="mb-2 flex items-center gap-1.5">
                  <span className="text-lg font-bold leading-none tracking-tight text-gray-900">
                    {card.label}
                  </span>
                  <FieldHelp text={`Formula: ${card.formula}`} />
                </div>

                <div className="grid flex-1 grid-cols-2 gap-x-3 gap-y-1">
                  <div className="min-w-0">
                    <div className="text-[10px] font-medium uppercase tracking-wide text-gray-500 leading-none">
                      Total (MT)
                    </div>
                    <div
                      className={`mt-1 text-lg font-semibold leading-tight tabular-nums ${
                        showBlockingLoad ? 'text-gray-400' : oilLossValueTone(totalMt, 'primary')
                      }`}
                    >
                      {showBlockingLoad ? '…' : formatOilLossTotalMt(totalMt)}
                    </div>
                  </div>
                  <div className="min-w-0">
                    <div className="text-[10px] font-medium uppercase tracking-wide text-gray-500 leading-none">
                      Total (%)
                    </div>
                    <div
                      className={`mt-1 text-lg font-semibold leading-tight tabular-nums ${
                        showBlockingLoad ? 'text-gray-400' : oilLossValueTone(totalPct, 'primary')
                      }`}
                    >
                      {showBlockingLoad ? '…' : formatOilLossTotalPct(totalPct)}
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
          </div>
        </div>

        <OilLossDrilldownSection
          rows={globallyFilteredRows}
          filters={drilldownFilters}
          onFiltersChange={applyOilLossDrilldownChange}
          onReset={resetOilLossDrilldown}
          drilldownScopedRowCount={drilldownFilteredRows.length}
          loading={showBlockingLoad}
          dataFetching={dataFetching}
        />

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
                          : viewMode === 'by_transporter'
                            ? 'Search transporter...'
                            : 'Search supplier...'
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
                <div className="flex flex-wrap items-center gap-2 text-sm text-gray-600">
                  <span className="font-medium text-gray-700">Period range:</span>
                  <span className="tabular-nums">
                    {formatShortDate(globalPeriodMeta.dateFrom)} — {formatShortDate(globalPeriodMeta.dateTo)}
                  </span>
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
          <CardHeader className="space-y-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                <span>
                  {viewMode === 'all_contract'
                    ? 'All Contract'
                    : viewMode === 'by_transporter'
                      ? 'By Transporter'
                      : 'By Supplier'}
                </span>
                {dataFetching ? (
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin text-gray-400" aria-hidden />
                ) : null}
              </CardTitle>
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
                {hasActiveDrilldown ? (
                  <>
                    <span className="text-gray-400" aria-hidden>
                      ·
                    </span>
                    <span className="whitespace-nowrap text-blue-700 font-medium">
                      Drilldown: {drilldownPathLabel}
                    </span>
                  </>
                ) : null}
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="inline-flex rounded-lg border bg-white p-1 shrink-0">
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
                <button
                  type="button"
                  onClick={() => switchViewMode('by_supplier')}
                  className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${viewMode === 'by_supplier' ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-100'}`}
                >
                  By Supplier
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-2 ml-auto shrink-0">
                <div ref={columnsMenuRef} className="relative">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowColumnsMenu((v) => !v)}
                    disabled={dataFetching || tableLoading}
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
                                  : viewMode === 'by_transporter'
                                    ? OIL_LOSS_BY_TRANSPORTER_DEFAULT_VISIBLE_COLUMN_IDS[0]
                                    : OIL_LOSS_BY_SUPPLIER_DEFAULT_VISIBLE_COLUMN_IDS[0],
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
                  <div className="flex flex-wrap items-center gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handlePageChange(currentPage - 1)}
                      disabled={currentPage <= 1 || dataFetching || tableLoading}
                    >
                      Previous
                    </Button>
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
                          disabled={dataFetching || tableLoading}
                          className="min-w-[40px]"
                        >
                          {pageNum}
                        </Button>
                      )
                    })}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handlePageChange(currentPage + 1)}
                      disabled={currentPage >= totalPages || dataFetching || tableLoading}
                    >
                      Next
                    </Button>
                    <span className="text-xs text-gray-500 ml-1 tabular-nums whitespace-nowrap">
                      Page {currentPage} of {totalPages}
                    </span>
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
                        COMPACT_OPERATIONAL_TABLE_ROW_VCENTER_CLASS,
                        (viewMode === 'by_transporter' || viewMode === 'by_supplier') &&
                          'klip-compact-table--intrinsic-token-cols',
                      )}
                    >
                      <thead>
                        <tr className={CONTRACT_PERF_TABLE_HEADER_ROW_OPERATIONAL_CLASS}>
                          {visibleColumns.map((col) => {
                            const active = sortKey === col.id
                            const opColClass = operationalTableColumnClass(
                              getOperationalColumnLayout(operationalTableType, col.id),
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
                        </tr>
                      </thead>
                      <tbody
                        className={`divide-y divide-gray-200 transition-opacity duration-200 ${
                          (dataFetching || viewTransitionLoading) && rows.length > 0 ? 'opacity-65' : 'opacity-100'
                        }`}
                      >
                        {(loading || dataFetching) && rows.length === 0 ? (
                          <TableInitialLoadPlaceholder
                            colSpan={visibleColumns.length || 1}
                            icon={Droplets}
                          />
                        ) : !dataFetching && !viewTransitionLoading && filteredRows.length === 0 ? (
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
                                            const name = formatOperationalTableTextDisplay(transporterRow.transporter)
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
                                        ) : col.id === 'supplier' && viewMode === 'by_supplier' ? (
                                          (() => {
                                            const supplierRow = row as OilLossBySupplierRow
                                            const name = formatOperationalTableTextDisplay(supplierRow.supplier)
                                            return (
                                              <button
                                                type="button"
                                                className="block w-max max-w-none whitespace-nowrap text-left text-sm font-medium text-blue-700 hover:text-blue-900 hover:underline"
                                                onClick={(e) => {
                                                  e.stopPropagation()
                                                  openSupplierModal(supplierRow)
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
                        disabled={currentPage <= 1 || dataFetching || tableLoading}
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
                            disabled={dataFetching || tableLoading}
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
                        disabled={currentPage >= totalPages || dataFetching || tableLoading}
                      >
                        Next
                      </Button>
                    </div>
                  </div>
                )}

                <p className="text-xs text-gray-500 mt-3">
                  {viewMode === 'all_contract'
                    ? 'Aggregated by contract. Qty Delivery & Qty Receive from SAP Data; SFAL/SFBD from SAP with shipment fallback. Quantities in MT (stored as Kg). Oil Loss (MT) = Qty Receive − Qty Delivery.'
                    : viewMode === 'by_transporter'
                      ? 'Aggregated by transporter. Qty Delivery & Qty Receive from SAP Data; SFAL/SFBD from SAP with shipment fallback. Quantities in MT (stored as Kg). Oil Loss (MT) = Qty Receive − Qty Delivery.'
                      : 'Aggregated by supplier. Qty Delivery & Qty Receive from SAP Data; SFAL/SFBD from SAP with shipment fallback. Quantities in MT (stored as Kg). Oil Loss (MT) = Qty Receive − Qty Delivery.'}
                </p>
              </div>
          </CardContent>
        </Card>

        <TransporterHistoryModal
          open={groupModalOpen}
          onClose={() => {
            setGroupModalOpen(false)
            setSelectedGroupData(null)
          }}
          selection={selectedGroupData}
          sourceRows={groupHistorySourceRows}
        />
      </div>
    </Layout>
  )
}
