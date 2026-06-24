import type { ReactNode } from 'react'
import {
  COMMERCIAL_DOCUMENT_LABELS,
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
import { Check } from 'lucide-react'

const DOC_STATUS_COLUMN_IDS = new Set<CommercialDocsColumnId>([
  'doc_contract',
  'doc_addendum_contract',
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
  'contract_qty',
  'unit_price',
  'total_price',
  'doc_contract',
  'doc_addendum_contract',
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
  contract: { id: 'doc_contract', field: 'doc_contract' },
  addendum_contract: { id: 'doc_addendum_contract', field: 'doc_addendum_contract' },
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
      label: 'DP Due Date',
      defaultVisible: true,
      sortable: true,
      getSortValue: (r) => r.dp_due_date || '',
      render: (r) => <span className="text-sm whitespace-nowrap">{formatCommercialDate(r.dp_due_date)}</span>,
    },
    {
      id: 'contract_qty',
      label: 'Contract Qty',
      defaultVisible: true,
      sortable: true,
      getSortValue: (r) => r.quantity_ordered,
      render: (r) => <span className="text-sm tabular-nums">{formatCommercialQtyKg(r.quantity_ordered)}</span>,
    },
    {
      id: 'unit_price',
      label: 'Unit Price',
      defaultVisible: true,
      sortable: true,
      getSortValue: (r) => r.unit_price,
      render: (r) => <span className="text-sm tabular-nums">{formatCommercialIdr(r.unit_price)}</span>,
    },
    {
      id: 'total_price',
      label: 'Total Price',
      defaultVisible: true,
      sortable: true,
      formulaHelp: COMMERCIAL_TOTAL_PRICE_FORMULA_HELP,
      getSortValue: (r) => r.total_price,
      render: (r) => (
        <span className="text-sm tabular-nums">{formatCommercialIdr(r.total_price)}</span>
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
      label: 'Plant Name',
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

  const docCols: CommercialDocsColumnMeta[] = (Object.keys(DOC_COL_MAP) as CommercialDocumentType[]).map(
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
