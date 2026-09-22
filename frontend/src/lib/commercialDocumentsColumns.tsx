import type { ReactNode } from 'react'
import {
  COMMERCIAL_DOCUMENT_LABELS,
  COMMERCIAL_DOCUMENT_TYPES,
  type CommercialDocumentRow,
  type CommercialDocumentType,
} from '@/lib/commercialDocumentsTypes'
import {
  formatCommercialDate,
  formatCommercialIdr,
  formatCommercialQtyKg,
  COMMERCIAL_TOTAL_PRICE_FORMULA_HELP,
} from '@/lib/commercialDocumentsFormat'
import { formatSapDisplayValue } from '@/lib/sapDisplayValue'
import { resolveCompactColumnWidthPx } from '@/lib/compactTableUi'
import { Check } from 'lucide-react'

const DOC_STATUS_COLUMN_IDS = new Set<CommercialDocsColumnId>([
  'doc_draft_contract',
  'doc_contract',
  'doc_addendum_contract',
  'doc_bea_cukai',
  'doc_delivery_order',
  'doc_invoice_fp_dp',
  'doc_invoice_fp_payoff',
  'doc_invoice_fp_full',
])

export const COMMERCIAL_DOCS_DEFAULT_VISIBLE_COLUMNS = [
  'contract_date',
  'contract_ext_no',
  'po_number',
  'supplier',
  'incoterm',
  'product',
  'payment_due_date',
  'dp_due_date',
  'payoff_date',
  'contract_qty',
  'unit_price',
  'total_price',
  'doc_draft_contract',
  'doc_contract',
  'doc_addendum_contract',
  'doc_bea_cukai',
  'doc_delivery_order',
  'doc_invoice_fp_dp',
  'doc_invoice_fp_payoff',
  'doc_invoice_fp_full',
] as const

export const COMMERCIAL_DOCS_HIDDEN_BY_DEFAULT_COLUMNS = [
  'buyer',
  'plant_site',
  'transport_mode',
  'b2b_flag',
] as const

export type CommercialDocsColumnId =
  | (typeof COMMERCIAL_DOCS_DEFAULT_VISIBLE_COLUMNS)[number]
  | (typeof COMMERCIAL_DOCS_HIDDEN_BY_DEFAULT_COLUMNS)[number]

export type CommercialDocsColumnMeta = {
  id: CommercialDocsColumnId
  label: string
  defaultVisible: boolean
  sortable?: boolean
  formulaHelp?: string
  centerCell?: boolean
  getSortValue?: (row: CommercialDocumentRow) => string | number
  render: (row: CommercialDocumentRow) => ReactNode
}

export function isCommercialDocStatusColumn(id: CommercialDocsColumnId): boolean {
  return DOC_STATUS_COLUMN_IDS.has(id)
}

function DocStatusCell({ checked }: { checked: boolean }) {
  if (checked) {
    return <Check className="h-4 w-4 text-green-600" aria-label="Checked" />
  }
  return <span className="text-sm text-gray-400">-</span>
}

const DOC_COL_MAP: Record<
  CommercialDocumentType,
  { id: CommercialDocsColumnId; field: keyof CommercialDocumentRow }
> = {
  draft_contract: { id: 'doc_draft_contract', field: 'doc_draft_contract' },
  contract: { id: 'doc_contract', field: 'doc_contract' },
  addendum_contract: { id: 'doc_addendum_contract', field: 'doc_addendum_contract' },
  bea_cukai: { id: 'doc_bea_cukai', field: 'doc_bea_cukai' },
  delivery_order: { id: 'doc_delivery_order', field: 'doc_delivery_order' },
  invoice_fp_dp: { id: 'doc_invoice_fp_dp', field: 'doc_invoice_fp_dp' },
  invoice_fp_payoff: { id: 'doc_invoice_fp_payoff', field: 'doc_invoice_fp_payoff' },
  invoice_fp_full: { id: 'doc_invoice_fp_full', field: 'doc_invoice_fp_full' },
}

export function buildCommercialDocsColumns(): CommercialDocsColumnMeta[] {
  const base: CommercialDocsColumnMeta[] = [
    {
      id: 'contract_date',
      label: 'Contract Date',
      defaultVisible: true,
      sortable: true,
      getSortValue: (r) => r.contract_date || '',
      render: (r) => <span className="text-sm whitespace-nowrap">{formatCommercialDate(r.contract_date)}</span>,
    },
    {
      id: 'contract_ext_no',
      label: 'Contract Ext No',
      defaultVisible: true,
      sortable: true,
      getSortValue: (r) => r.contract_ext_no || '',
      render: (r) => <span className="text-sm">{formatSapDisplayValue(r.contract_ext_no)}</span>,
    },
    {
      id: 'po_number',
      label: 'PO',
      defaultVisible: true,
      sortable: true,
      getSortValue: (r) => r.po_number || '',
      render: (r) => <span className="text-sm">{formatSapDisplayValue(r.po_number)}</span>,
    },
    {
      id: 'supplier',
      label: 'Supplier',
      defaultVisible: true,
      sortable: true,
      getSortValue: (r) => r.supplier || '',
      render: (r) => <span className="text-sm">{formatSapDisplayValue(r.supplier)}</span>,
    },
    {
      id: 'incoterm',
      label: 'Incoterm',
      defaultVisible: true,
      sortable: true,
      getSortValue: (r) => r.incoterm || '',
      render: (r) => <span className="text-sm">{formatSapDisplayValue(r.incoterm)}</span>,
    },
    {
      id: 'product',
      label: 'Product',
      defaultVisible: true,
      sortable: true,
      getSortValue: (r) => r.product || '',
      render: (r) => <span className="text-sm">{formatSapDisplayValue(r.product)}</span>,
    },
    {
      id: 'payment_due_date',
      label: 'Payment Due Date',
      defaultVisible: true,
      sortable: true,
      getSortValue: (r) => r.payment_due_date || '',
      render: (r) => <span className="text-sm whitespace-nowrap">{formatCommercialDate(r.payment_due_date)}</span>,
    },
    {
      id: 'dp_due_date',
      label: 'DP Date',
      defaultVisible: true,
      sortable: true,
      getSortValue: (r) => r.dp_due_date || '',
      render: (r) => <span className="text-sm whitespace-nowrap">{formatCommercialDate(r.dp_due_date)}</span>,
    },
    {
      id: 'payoff_date',
      label: 'Payoff Date',
      defaultVisible: true,
      sortable: true,
      getSortValue: (r) => r.payoff_date || '',
      render: (r) => <span className="text-sm whitespace-nowrap">{formatCommercialDate(r.payoff_date)}</span>,
    },
    {
      id: 'contract_qty',
      label: 'Contract Qty',
      defaultVisible: true,
      sortable: true,
      getSortValue: (r) => r.quantity_ordered,
      render: (r) => (
        <span className="text-sm tabular-nums whitespace-nowrap">
          {formatCommercialQtyKg(r.quantity_ordered)}
        </span>
      ),
    },
    {
      id: 'unit_price',
      label: 'Unit Price',
      defaultVisible: true,
      sortable: true,
      getSortValue: (r) => r.unit_price,
      render: (r) => (
        <span className="text-sm tabular-nums whitespace-nowrap">
          {formatCommercialIdr(r.unit_price, r.currency)}
        </span>
      ),
    },
    {
      id: 'total_price',
      label: 'Total Price',
      defaultVisible: true,
      sortable: true,
      formulaHelp: COMMERCIAL_TOTAL_PRICE_FORMULA_HELP,
      getSortValue: (r) => r.total_price,
      render: (r) => (
        <span className="text-sm tabular-nums whitespace-nowrap">
          {formatCommercialIdr(r.total_price, r.currency)}
        </span>
      ),
    },
    {
      id: 'buyer',
      label: 'Buyer',
      defaultVisible: false,
      sortable: true,
      getSortValue: (r) => r.buyer || '',
      render: (r) => <span className="text-sm">{formatSapDisplayValue(r.buyer)}</span>,
    },
    {
      id: 'plant_site',
      label: 'Region/Plant',
      defaultVisible: false,
      sortable: true,
      getSortValue: (r) => r.plant_site || '',
      render: (r) => <span className="text-sm">{formatSapDisplayValue(r.plant_site)}</span>,
    },
    {
      id: 'transport_mode',
      label: 'Sea/Land',
      defaultVisible: false,
      sortable: true,
      getSortValue: (r) => r.transport_mode || '',
      render: (r) => <span className="text-sm">{formatSapDisplayValue(r.transport_mode)}</span>,
    },
    {
      id: 'b2b_flag',
      label: 'B2B',
      defaultVisible: false,
      sortable: true,
      getSortValue: (r) => r.b2b_flag || '',
      render: (r) => <span className="text-sm">{formatSapDisplayValue(r.b2b_flag)}</span>,
    },
  ]

  const docCols: CommercialDocsColumnMeta[] = COMMERCIAL_DOCUMENT_TYPES.map(
    (type) => {
      const { id, field } = DOC_COL_MAP[type]
      return {
        id,
        label: COMMERCIAL_DOCUMENT_LABELS[type],
        defaultVisible: true,
        sortable: true,
        centerCell: true,
        getSortValue: (r) => (r[field] ? 1 : 0),
        render: (r) => <DocStatusCell checked={Boolean(r[field])} />,
      }
    },
  )

  return [...base, ...docCols]
}

export const COMMERCIAL_DOCS_ALL_COLUMNS = buildCommercialDocsColumns()
export const COMMERCIAL_DOCS_COLUMN_BY_ID = Object.fromEntries(
  COMMERCIAL_DOCS_ALL_COLUMNS.map((c) => [c.id, c]),
) as Record<CommercialDocsColumnId, CommercialDocsColumnMeta>

/** Compact fixed px widths — header longest-word logic may expand via resolveCompactColumnWidthPx. */
export const COMMERCIAL_DOCS_COLUMN_WIDTH_PX: Readonly<Record<string, number>> = {
  contract_date: 100,
  contract_ext_no: 120,
  po_number: 88,
  supplier: 112,
  incoterm: 72,
  product: 96,
  payment_due_date: 108,
  dp_due_date: 96,
  payoff_date: 96,
  contract_qty: 96,
  unit_price: 96,
  total_price: 104,
  doc_draft_contract: 96,
  doc_contract: 88,
  doc_addendum_contract: 104,
  doc_bea_cukai: 88,
  doc_delivery_order: 64,
  doc_invoice_fp_dp: 104,
  doc_invoice_fp_payoff: 112,
  doc_invoice_fp_full: 104,
  buyer: 88,
  plant_site: 96,
  transport_mode: 88,
  b2b_flag: 64,
}

export const COMMERCIAL_DOCS_ACTIONS_COL_WIDTH_PX = 148

const COMMERCIAL_DOCS_DEFAULT_COLUMN_WIDTH_PX = 96

/** Match Contract/Shipping Performance: base map + header longest-word floor. */
export function commercialDocsTableColumnWidthPx(
  colId: string,
  headerLabel?: string,
  options?: { hasFormulaHelp?: boolean },
): number {
  const base = COMMERCIAL_DOCS_COLUMN_WIDTH_PX[colId] ?? COMMERCIAL_DOCS_DEFAULT_COLUMN_WIDTH_PX
  return resolveCompactColumnWidthPx(base, headerLabel, {
    hasFormulaHelp: options?.hasFormulaHelp,
    hasSort: true,
  })
}

/** Money/qty cells size to the longest formatted value so digits are not clipped. */
export const COMMERCIAL_DOCS_DYNAMIC_WIDTH_COLUMN_IDS = new Set<CommercialDocsColumnId>([
  'contract_qty',
  'unit_price',
  'total_price',
])

export function isCommercialDocsDynamicWidthColumn(colId: string): boolean {
  return COMMERCIAL_DOCS_DYNAMIC_WIDTH_COLUMN_IDS.has(colId as CommercialDocsColumnId)
}

/** text-sm tabular-nums — slightly wider than header text-xs estimate. */
const DYNAMIC_CELL_CHAR_PX = 8.5
const DYNAMIC_CELL_PAD_PX = 16
const DYNAMIC_CELL_BUFFER_PX = 8

export function formatCommercialDocsDynamicCell(
  colId: string,
  row: Pick<CommercialDocumentRow, 'quantity_ordered' | 'unit_price' | 'total_price' | 'currency'>,
): string {
  if (colId === 'contract_qty') return formatCommercialQtyKg(row.quantity_ordered)
  if (colId === 'unit_price') return formatCommercialIdr(row.unit_price, row.currency)
  if (colId === 'total_price') return formatCommercialIdr(row.total_price, row.currency)
  return ''
}

export function estimateCommercialDocsDynamicValueWidthPx(formatted: string): number {
  const text = String(formatted ?? '')
  if (!text) return 0
  return Math.ceil(text.length * DYNAMIC_CELL_CHAR_PX) + DYNAMIC_CELL_PAD_PX + DYNAMIC_CELL_BUFFER_PX
}

export function commercialDocsDynamicColumnWidthPx(
  colId: string,
  headerLabel: string,
  formattedValues: readonly string[],
  options?: { hasFormulaHelp?: boolean },
): number {
  const headerPx = commercialDocsTableColumnWidthPx(colId, headerLabel, options)
  let contentPx = 0
  for (const value of formattedValues) {
    contentPx = Math.max(contentPx, estimateCommercialDocsDynamicValueWidthPx(value))
  }
  return Math.max(headerPx, contentPx)
}
