'use client'

import {
  compactTableHeaderMinWidthPx,
  longestHeaderWordLength,
} from '@/lib/compactTableUi'
import { formatOperationalTableTextDisplay } from '@/lib/sapDisplayValue'

export type OperationalColumnLayout = 'short' | 'token' | 'stack' | 'wrap' | 'truncate' | 'two_line'

export const COMPACT_TABLE_NOWRAP_CLASS = 'klip-compact-table-nowrap'
export const COMPACT_TABLE_STACK_CLASS = 'klip-compact-table-stack'

const SHIPMENT_COLUMN_LAYOUT: Readonly<Record<string, OperationalColumnLayout>> = {
  late_indicator: 'short',
  vessel_name: 'truncate',
  shipment_id: 'token',
  loading_port: 'truncate',
  discharge_port: 'truncate',
  supplier: 'truncate',
  status: 'short',
  contract_qty: 'short',
  outstanding_qty_planning: 'short',
  contract_date: 'short',
  product: 'truncate',
  incoterm: 'short',
  sto_quantity: 'short',
  quantity_delivered: 'short',
  quantity_receive: 'short',
  ata_vessel_completed_loading: 'short',
  ata_vessel_complete_discharge: 'short',
  contract_ext_no: 'truncate',
  po_numbers: 'truncate',
  operation_id: 'token',
  contract_numbers: 'truncate',
  contract_reference_po: 'truncate',
  delivery_start: 'short',
  delivery_end: 'short',
  b2b_flag: 'short',
  port_of_loading: 'truncate',
  port_of_discharge: 'truncate',
  vessel_code: 'token',
}

const CONTRACT_COLUMN_LAYOUT: Readonly<Record<string, OperationalColumnLayout>> = {
  contract_date: 'short',
  contract_id: 'token',
  contract_ext_no: 'truncate',
  po_number: 'token',
  product: 'truncate',
  incoterm: 'short',
  supplier: 'truncate',
  company_name: 'truncate',
  contract_qty: 'short',
  received_qty: 'short',
  delivery_qty: 'short',
  outstanding_qty: 'short',
  outstanding_qty_mt: 'short',
  status_overall: 'short',
  log_cycle_days: 'short',
  trade_cycle_days: 'short',
  cash_cycle_days: 'short',
  dp_cycle_days: 'short',
  over_under_delivery_status: 'truncate',
  group_name: 'truncate',
  lt_spot: 'short',
  source_type: 'truncate',
  sto_number: 'truncate',
  delivery_start: 'short',
  delivery_end: 'short',
  month_delivery_end: 'short',
  cargo_readiness_date: 'short',
  last_planning_delivery_date: 'short',
  vessel_name: 'truncate',
  eta_vessel_completed_loading: 'short',
  eta_vessel_complete_discharge: 'short',
  created_at: 'short',
  company_code: 'short',
  status: 'short',
}

const OIL_LOSS_BY_SUPPLIER_COLUMN_LAYOUT: Readonly<Record<string, OperationalColumnLayout>> = {
  supplier: 'token',
  quantity_contract: 'short',
  quantity_delivery: 'short',
  quantity_received: 'short',
  gain_loss_amount: 'short',
  gain_loss_percentage: 'short',
  loading_location: 'truncate',
  unloading_location: 'truncate',
  contract_ext_no: 'truncate',
  sto_number: 'stack',
  contract_date: 'short',
  po_number: 'stack',
  product: 'truncate',
  incoterm: 'truncate',
  status: 'short',
  transport_mode: 'short',
  group_name: 'truncate',
  transporter: 'truncate',
  buyer: 'truncate',
  plant_site: 'truncate',
  operation_id: 'token',
  contract_number: 'token',
  quantity_sfal: 'short',
  quantity_sfbd: 'short',
}

const OIL_LOSS_BY_TRANSPORTER_COLUMN_LAYOUT: Readonly<Record<string, OperationalColumnLayout>> = {
  transporter: 'token',
  quantity_contract: 'short',
  quantity_delivery: 'short',
  quantity_received: 'short',
  gain_loss_amount: 'short',
  gain_loss_percentage: 'short',
  loading_location: 'truncate',
  unloading_location: 'truncate',
  contract_ext_no: 'truncate',
  sto_number: 'stack',
  contract_date: 'short',
  po_number: 'stack',
  product: 'truncate',
  incoterm: 'truncate',
  status: 'short',
  transport_mode: 'short',
  group_name: 'truncate',
  supplier: 'truncate',
  buyer: 'truncate',
  plant_site: 'truncate',
  operation_id: 'token',
  contract_number: 'token',
  quantity_sfal: 'short',
  quantity_sfbd: 'short',
}

const OIL_LOSS_ALL_CONTRACT_COLUMN_LAYOUT: Readonly<Record<string, OperationalColumnLayout>> = {
  contract_date: 'short',
  contract_ext_no: 'truncate',
  po_number: 'stack',
  sto_number: 'stack',
  product: 'truncate',
  incoterm: 'truncate',
  quantity_contract: 'short',
  quantity_delivery: 'short',
  quantity_received: 'short',
  gain_loss_amount: 'short',
  gain_loss_percentage: 'short',
  status: 'short',
  transport_mode: 'short',
  group_name: 'truncate',
  supplier: 'truncate',
  buyer: 'truncate',
  plant_site: 'truncate',
  operation_id: 'token',
  contract_number: 'token',
  quantity_sfal: 'short',
  quantity_sfbd: 'short',
}

const SHIPPING_PERF_COLUMN_LAYOUT: Readonly<Record<string, OperationalColumnLayout>> = {
  vessel_name: 'truncate',
  by_vessel_qty_contract: 'short',
  by_vessel_qty_delivery: 'short',
  by_vessel_qty_receive: 'short',
  contract_ext_no: 'stack',
  loading_port: 'wrap',
  discharge_port: 'wrap',
  incoterm: 'short',
  product: 'wrap',
  supplier: 'wrap',
  contract_qty: 'short',
  delivered_qty: 'short',
  group_name: 'wrap',
  shipment_count: 'short',
  status: 'short',
  po_number: 'stack',
  contract_number: 'token',
  sto_number: 'token',
  sto_qty: 'short',
  received_qty: 'short',
  planning_qty: 'short',
  outstanding_qty_actual: 'short',
  outstanding_qty_planning: 'short',
  outstanding_qty: 'short',
  loading_delta_eta_etr_days: 'short',
  loading_delta_eta_etb_days: 'short',
  loading_delta_etb_etc_days: 'short',
  discharge_delta_eta_etb_days: 'short',
  discharge_delta_etb_etc_days: 'short',
  total_delta_days: 'short',
}

const TRUCKING_COLUMN_LAYOUT: Readonly<Record<string, OperationalColumnLayout>> = {
  late_indicator: 'short',
  contract_date: 'short',
  contract_ext_no: 'truncate',
  po_number: 'token',
  supplier: 'truncate',
  status: 'short',
  sto_number: 'token',
  product: 'truncate',
  incoterm: 'short',
  contract_qty: 'short',
  sto_quantity: 'short',
  quantity_delivered: 'short',
  quantity_receive: 'short',
  trucking_start_date: 'short',
  trucking_completion_date: 'short',
  operation_id: 'token',
  location: 'truncate',
  loading_location: 'truncate',
  unloading_location: 'truncate',
  trucking_owner: 'truncate',
  quantity_sent: 'short',
  delivery_start_date: 'short',
  delivery_end_date: 'short',
  cargo_readiness_date: 'short',
}

const COMMERCIAL_DOCS_COLUMN_LAYOUT: Readonly<Record<string, OperationalColumnLayout>> = {
  contract_date: 'short',
  contract_ext_no: 'truncate',
  po_number: 'token',
  supplier: 'truncate',
  incoterm: 'short',
  product: 'truncate',
  payment_due_date: 'short',
  dp_due_date: 'short',
  contract_qty: 'short',
  unit_price: 'short',
  total_price: 'short',
  buyer: 'truncate',
  plant_site: 'truncate',
  transport_mode: 'short',
  b2b_flag: 'short',
  doc_contract: 'short',
  doc_addendum_contract: 'short',
  doc_invoice_fp_dp: 'short',
  doc_invoice_fp_payoff: 'short',
  doc_invoice_fp_full: 'short',
}

const MASTER_VESSEL_COLUMN_LAYOUT: Readonly<Record<string, OperationalColumnLayout>> = {
  vessel_code: 'token',
  vessel_name: 'truncate',
  vessel_capacity_mt: 'short',
  vessel_owner: 'truncate',
  vessel_owner_group: 'truncate',
  sap_vendor_code: 'token',
  vessel_type: 'short',
  year_of_creation: 'short',
  heating: 'short',
  lambung_type: 'short',
  terms: 'short',
}

export function getOperationalColumnLayout(
  table:
    | 'shipments'
    | 'trucking'
    | 'contracts'
    | 'commercial_documents'
    | 'oil_loss'
    | 'oil_loss_transporter'
    | 'oil_loss_supplier'
    | 'shipping_performance'
    | 'master_vessel',
  colId: string,
): OperationalColumnLayout {
  const map =
    table === 'shipments'
      ? SHIPMENT_COLUMN_LAYOUT
      : table === 'trucking'
        ? TRUCKING_COLUMN_LAYOUT
        : table === 'commercial_documents'
          ? COMMERCIAL_DOCS_COLUMN_LAYOUT
          : table === 'master_vessel'
            ? MASTER_VESSEL_COLUMN_LAYOUT
          : table === 'oil_loss'
          ? OIL_LOSS_ALL_CONTRACT_COLUMN_LAYOUT
          : table === 'oil_loss_transporter'
            ? OIL_LOSS_BY_TRANSPORTER_COLUMN_LAYOUT
            : table === 'oil_loss_supplier'
              ? OIL_LOSS_BY_SUPPLIER_COLUMN_LAYOUT
            : table === 'shipping_performance'
              ? SHIPPING_PERF_COLUMN_LAYOUT
              : CONTRACT_COLUMN_LAYOUT
  return map[colId] ?? 'wrap'
}

export function operationalTableColumnClass(layout: OperationalColumnLayout): string {
  switch (layout) {
    case 'short':
      return 'klip-op-col--short'
    case 'token':
      return 'klip-op-col--token'
    case 'stack':
      return 'klip-op-col--stack'
    case 'truncate':
      return 'klip-op-col--truncate'
    case 'two_line':
      return 'klip-op-col--two-line'
    default:
      return 'klip-op-col--wrap'
  }
}

/** Default max width for truncated operational cells (matches Tailwind max-w-[200px]). */
export const OPERATIONAL_TRUNCATE_MAX_WIDTH_CLASS = 'max-w-[200px]'

/** Longest single token — commas split first when stacking contract ext values. */
export function longestUnbrokenTokenLength(text: string, splitCommas = false): number {
  const raw = String(text ?? '').trim()
  if (!raw) return 0
  const segments = splitCommas
    ? raw.split(',').map((s) => s.trim()).filter(Boolean)
    : [raw]
  let max = 0
  for (const seg of segments) {
    if (!seg.includes(' ')) {
      max = Math.max(max, seg.length)
      continue
    }
    const parts = seg.split(/\s+/).filter(Boolean)
    max = Math.max(max, ...parts.map((p) => p.length))
  }
  return max
}

const CELL_CHAR_PX = 7.5
const CELL_PAD_PX = 16

export function estimateTokenWidthPx(charLen: number): number {
  if (charLen <= 0) return 0
  return Math.ceil(charLen * CELL_CHAR_PX) + CELL_PAD_PX
}

export function resolveOperationalColumnMinWidthPx(opts: {
  colId: string
  label: string
  basePx: number
  cellSamples: string[]
  layout: OperationalColumnLayout
  hasFormulaHelp?: boolean
}): number {
  const headerMin = compactTableHeaderMinWidthPx(opts.label, {
    hasFormulaHelp: opts.hasFormulaHelp,
    hasSort: true,
  })

  let cellTokenMax = 0
  for (const sample of opts.cellSamples) {
    cellTokenMax = Math.max(
      cellTokenMax,
      longestUnbrokenTokenLength(sample, opts.layout === 'stack'),
    )
  }
  const cellPx = estimateTokenWidthPx(cellTokenMax)

  switch (opts.layout) {
    case 'short': {
      if (cellTokenMax > 0) {
        const headerWordPx = estimateTokenWidthPx(longestHeaderWordLength(opts.label))
        return Math.max(cellPx, Math.min(headerMin, headerWordPx))
      }
      return Math.min(headerMin, opts.basePx)
    }
    case 'truncate':
      return Math.max(headerMin, Math.min(estimateTokenWidthPx(24), 200 + CELL_PAD_PX), opts.basePx)
    case 'two_line':
      // Width fits ~half a long name so long values wrap to at most two lines.
      return Math.max(headerMin, Math.min(Math.max(cellPx, opts.basePx), 168 + CELL_PAD_PX))
    case 'token':
    case 'stack':
      return Math.max(headerMin, cellPx, opts.basePx)
    default:
      return Math.max(headerMin, cellPx, opts.basePx)
  }
}

export function OperationalStackedCommaCell({
  value,
  className = 'text-sm',
  title,
  truncateLongParts = false,
}: {
  value?: string | null
  className?: string
  title?: string
  /** Ellipsis each stacked value when longer than the column width. */
  truncateLongParts?: boolean
}) {
  const raw = String(value ?? '').trim()
  if (!raw || raw === '-') {
    return <span className={className}>-</span>
  }
  const parts = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((part) => formatOperationalTableTextDisplay(part))
    .filter((part) => part !== '-')
  if (parts.length === 0) {
    return <span className={className}>-</span>
  }
  const partClass = truncateLongParts
    ? 'block min-w-0 max-w-full truncate'
    : `${COMPACT_TABLE_NOWRAP_CLASS} block`
  if (parts.length <= 1) {
    const display = parts[0]
    return (
      <span
        className={
          truncateLongParts
            ? `${className} block min-w-0 max-w-full truncate`
            : `${className} ${COMPACT_TABLE_NOWRAP_CLASS} block`
        }
        title={title ?? display}
      >
        {display}
      </span>
    )
  }
  return (
    <span
      className={
        truncateLongParts
          ? `${className} flex w-full min-w-0 max-w-full flex-col gap-0.5`
          : `${COMPACT_TABLE_STACK_CLASS} ${className}`
      }
      title={title ?? parts.join(', ')}
    >
      {parts.map((part, i) => (
        <span key={`${part}-${i}`} className={partClass} title={part}>
          {part}
        </span>
      ))}
    </span>
  )
}

export function OperationalNowrapCell({
  value,
  className = 'text-sm',
  title,
  fallback = '-',
}: {
  value?: string | null
  className?: string
  title?: string
  fallback?: string
}) {
  const display = formatOperationalTableTextDisplay(value, fallback)
  return (
    <span
      className={`${className} ${COMPACT_TABLE_NOWRAP_CLASS} block`}
      title={title ?? (display === fallback ? undefined : display)}
    >
      {display}
    </span>
  )
}

/** Single-line ellipsis for long names/addresses; full value on hover via native title. */
export function OperationalTruncatedCell({
  value,
  className = 'text-sm',
  title,
  fallback = '-',
  maxWidthClass = OPERATIONAL_TRUNCATE_MAX_WIDTH_CLASS,
}: {
  value?: string | null
  className?: string
  title?: string
  fallback?: string
  maxWidthClass?: string
}) {
  const display = formatOperationalTableTextDisplay(value, fallback)
  if (display === fallback) {
    return <span className={className}>{fallback}</span>
  }
  return (
    <span
      className={`${className} truncate block ${maxWidthClass}`}
      title={title ?? display}
    >
      {display}
    </span>
  )
}

/** Wrap long names to at most two lines; full value on hover via native title. */
export function OperationalTwoLineCell({
  value,
  className = 'text-sm',
  title,
  fallback = '-',
}: {
  value?: string | null
  className?: string
  title?: string
  fallback?: string
}) {
  const display = formatOperationalTableTextDisplay(value, fallback)
  if (display === fallback) {
    return <span className={className}>{fallback}</span>
  }
  return (
    <span className={`${className} klip-two-line-clamp block`} title={title ?? display}>
      {display}
    </span>
  )
}
