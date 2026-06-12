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
import { Check } from 'lucide-react'

const DOC_STATUS_COLUMN_IDS = new Set<CommercialDocsColumnId>([
  'doc_contract',
  'doc_faktur_pajak',
  'doc_dp',
  'doc_invoice_dp',
  'doc_ep_pelunasan',
  'doc_invoice_pelunasan',
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
  'doc_faktur_pajak',
  'doc_dp',
  'doc_invoice_dp',
  'doc_ep_pelunasan',
  'doc_invoice_pelunasan',
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
    return (
      <div className="flex h-full w-full items-center justify-center">
        <Check className="h-4 w-4 text-green-600" aria-label="Checked" />
      </div>
    )
  }
  return (
    <div className="flex h-full w-full items-center justify-center">
      <span className="text-sm text-gray-400">-</span>
    </div>
  )
}

const DOC_COL_MAP: Record<
  CommercialDocumentType,
  { id: CommercialDocsColumnId; field: keyof CommercialDocumentRow }
> = {
  contract: { id: 'doc_contract', field: 'doc_contract' },
  faktur_pajak: { id: 'doc_faktur_pajak', field: 'doc_faktur_pajak' },
  dp: { id: 'doc_dp', field: 'doc_dp' },
  invoice_dp: { id: 'doc_invoice_dp', field: 'doc_invoice_dp' },
  ep_pelunasan: { id: 'doc_ep_pelunasan', field: 'doc_ep_pelunasan' },
  invoice_pelunasan: { id: 'doc_invoice_pelunasan', field: 'doc_invoice_pelunasan' },
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
      render: (r) => <span className="text-sm">{r.contract_ext_no || '-'}</span>,
    },
    {
      id: 'po_number',
      label: 'PO',
      defaultVisible: true,
      sortable: true,
      getSortValue: (r) => r.po_number || '',
      render: (r) => <span className="text-sm">{r.po_number || '-'}</span>,
    },
    {
      id: 'supplier',
      label: 'Supplier',
      defaultVisible: true,
      sortable: true,
      getSortValue: (r) => r.supplier || '',
      render: (r) => <span className="text-sm">{r.supplier || '-'}</span>,
    },
    {
      id: 'incoterm',
      label: 'Incoterm',
      defaultVisible: true,
      sortable: true,
      getSortValue: (r) => r.incoterm || '',
      render: (r) => <span className="text-sm">{r.incoterm || '-'}</span>,
    },
    {
      id: 'product',
      label: 'Product',
      defaultVisible: true,
      sortable: true,
      getSortValue: (r) => r.product || '',
      render: (r) => <span className="text-sm">{r.product || '-'}</span>,
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
      render: (r) => <span className="text-sm">{r.buyer || '-'}</span>,
    },
    {
      id: 'plant_site',
      label: 'Plant Name',
      defaultVisible: false,
      sortable: true,
      getSortValue: (r) => r.plant_site || '',
      render: (r) => <span className="text-sm">{r.plant_site || '-'}</span>,
    },
    {
      id: 'transport_mode',
      label: 'Sea/Land',
      defaultVisible: false,
      sortable: true,
      getSortValue: (r) => r.transport_mode || '',
      render: (r) => <span className="text-sm">{r.transport_mode || '-'}</span>,
    },
    {
      id: 'b2b_flag',
      label: 'B2B',
      defaultVisible: false,
      sortable: true,
      getSortValue: (r) => r.b2b_flag || '',
      render: (r) => <span className="text-sm">{r.b2b_flag || '-'}</span>,
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
