'use client'

import {
  compactTableHeaderMinWidthPx,
  longestHeaderWordLength,
} from '@/lib/compactTableUi'

export type OperationalColumnLayout = 'short' | 'token' | 'stack' | 'wrap' | 'truncate'

export const COMPACT_TABLE_NOWRAP_CLASS = 'klip-compact-table-nowrap'
export const COMPACT_TABLE_STACK_CLASS = 'klip-compact-table-stack'

const SHIPMENT_COLUMN_LAYOUT: Readonly<Record<string, OperationalColumnLayout>> = {
  late_indicator: 'short',
  contract_date: 'short',
  contract_ext_no: 'stack',
  po_numbers: 'token',
  vessel_name: 'wrap',
  status: 'short',
  shipment_id: 'token',
  product: 'wrap',
  incoterm: 'short',
  sto_quantity: 'short',
  quantity_delivered: 'short',
  quantity_receive: 'short',
  ata_vessel_completed_loading: 'short',
  ata_vessel_complete_discharge: 'short',
  operation_id: 'token',
  contract_numbers: 'token',
  contract_reference_po: 'token',
  delivery_start: 'short',
  delivery_end: 'short',
  b2b_flag: 'short',
  port_of_loading: 'wrap',
  port_of_discharge: 'wrap',
  vessel_code: 'token',
}

const CONTRACT_COLUMN_LAYOUT: Readonly<Record<string, OperationalColumnLayout>> = {
  contract_date: 'short',
  contract_id: 'token',
  contract_ext_no: 'stack',
  po_number: 'token',
  product: 'wrap',
  incoterm: 'short',
  supplier: 'wrap',
  company_name: 'wrap',
  contract_qty: 'short',
  received_qty: 'short',
  outstanding_qty: 'short',
  outstanding_qty_mt: 'short',
  contract_aging: 'short',
  delivery_status: 'short',
  status_overall: 'short',
  unusual_status: 'short',
  log_cycle_days: 'short',
  trade_cycle_days: 'short',
  cash_cycle_days: 'short',
  dp_cycle_days: 'short',
  over_under_delivery_status: 'wrap',
  group_name: 'wrap',
  lt_spot: 'short',
  source_type: 'short',
  sto_number: 'token',
  delivery_start: 'short',
  delivery_end: 'short',
  month_delivery_end: 'short',
  cargo_readiness_date: 'short',
  vessel_name: 'wrap',
  eta_vessel_completed_loading: 'short',
  eta_vessel_complete_discharge: 'short',
  created_at: 'short',
  company_code: 'short',
  status: 'short',
}

const OIL_LOSS_BY_TRANSPORTER_COLUMN_LAYOUT: Readonly<Record<string, OperationalColumnLayout>> = {
  transporter: 'truncate',
  quantity_contract: 'short',
  quantity_delivery: 'short',
  quantity_received: 'short',
  gain_loss_amount: 'short',
  gain_loss_percentage: 'short',
  loading_location: 'truncate',
  unloading_location: 'truncate',
  contract_ext_no: 'stack',
  sto_number: 'stack',
  contract_date: 'short',
  po_number: 'stack',
  product: 'truncate',
  incoterm: 'truncate',
  status: 'short',
  transport_mode: 'short',
  group_name: 'wrap',
  supplier: 'wrap',
  buyer: 'wrap',
  plant_site: 'wrap',
  operation_id: 'token',
  contract_number: 'token',
  quantity_sfal: 'short',
  quantity_sfbd: 'short',
}

const OIL_LOSS_ALL_CONTRACT_COLUMN_LAYOUT: Readonly<Record<string, OperationalColumnLayout>> = {
  contract_date: 'short',
  contract_ext_no: 'stack',
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
  group_name: 'wrap',
  supplier: 'wrap',
  buyer: 'wrap',
  plant_site: 'wrap',
  operation_id: 'token',
  contract_number: 'token',
  quantity_sfal: 'short',
  quantity_sfbd: 'short',
}

const TRUCKING_COLUMN_LAYOUT: Readonly<Record<string, OperationalColumnLayout>> = {
  late_indicator: 'short',
  contract_date: 'short',
  contract_ext_no: 'stack',
  po_number: 'token',
  supplier: 'wrap',
  status: 'short',
  sto_number: 'token',
  product: 'wrap',
  incoterm: 'short',
  contract_qty: 'short',
  sto_quantity: 'short',
  quantity_delivered: 'short',
  quantity_receive: 'short',
  trucking_start_date: 'short',
  trucking_completion_date: 'short',
  operation_id: 'token',
  location: 'wrap',
  loading_location: 'wrap',
  unloading_location: 'wrap',
  trucking_owner: 'wrap',
  quantity_sent: 'short',
  delivery_start_date: 'short',
  delivery_end_date: 'short',
  cargo_readiness_date: 'short',
}

export function getOperationalColumnLayout(
  table: 'shipments' | 'trucking' | 'contracts' | 'oil_loss' | 'oil_loss_transporter',
  colId: string,
): OperationalColumnLayout {
  const map =
    table === 'shipments'
      ? SHIPMENT_COLUMN_LAYOUT
      : table === 'trucking'
        ? TRUCKING_COLUMN_LAYOUT
        : table === 'oil_loss'
          ? OIL_LOSS_ALL_CONTRACT_COLUMN_LAYOUT
          : table === 'oil_loss_transporter'
            ? OIL_LOSS_BY_TRANSPORTER_COLUMN_LAYOUT
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
}: {
  value?: string | null
  className?: string
  title?: string
}) {
  const raw = String(value ?? '').trim()
  if (!raw || raw === '-') {
    return <span className={className}>-</span>
  }
  const parts = raw.split(',').map((s) => s.trim()).filter(Boolean)
  if (parts.length <= 1) {
    return (
      <span className={`${className} ${COMPACT_TABLE_NOWRAP_CLASS} block`} title={title ?? raw}>
        {parts[0] ?? raw}
      </span>
    )
  }
  return (
    <span className={`${COMPACT_TABLE_STACK_CLASS} ${className}`} title={title ?? raw}>
      {parts.map((part, i) => (
        <span key={`${part}-${i}`} className={`${COMPACT_TABLE_NOWRAP_CLASS} block`}>
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
  const raw = String(value ?? '').trim()
  const display = raw || fallback
  return (
    <span className={`${className} ${COMPACT_TABLE_NOWRAP_CLASS} block`} title={title ?? (raw || undefined)}>
      {display}
    </span>
  )
}

/** Single-line ellipsis for long names/addresses; full value on hover via native title. */
export function OperationalTruncatedCell({
  value,
  className = 'text-sm',
  title,
  fallback = '—',
  maxWidthClass = OPERATIONAL_TRUNCATE_MAX_WIDTH_CLASS,
}: {
  value?: string | null
  className?: string
  title?: string
  fallback?: string
  maxWidthClass?: string
}) {
  const raw = String(value ?? '').trim()
  if (!raw) {
    return <span className={className}>{fallback}</span>
  }
  return (
    <span
      className={`${className} truncate block ${maxWidthClass}`}
      title={title ?? raw}
    >
      {raw}
    </span>
  )
}
