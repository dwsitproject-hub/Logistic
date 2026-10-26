import type { ReactNode } from 'react'
import { DOCUMENT_TYPES, hasType, typesDone } from '@/lib/documentTypes'
import { ddmmyy, num, priceCell } from '@/lib/format'
import type { DocumentRow } from '@/lib/types'

export type Column = {
  id: string
  label: string
  /** Always shown; cannot be hidden in the Columns menu. */
  fixed?: boolean
  /** Shown until the user hides it. */
  visibleByDefault: boolean
  /** The API's sortKey (backend utils/commercialDocumentsListSort.ts). */
  sortKey?: string
  numeric?: boolean
  cell: (row: DocumentRow) => ReactNode
  /** Plain value for the CSV export. */
  csv: (row: DocumentRow) => string | number | null
}

export function statusOf(row: DocumentRow): { label: string; tone: 'ok' | 'warn' | 'bad' } {
  const done = typesDone(row)
  if (done === DOCUMENT_TYPES.length) return { label: 'Complete', tone: 'ok' }
  if (done === 0) return { label: 'Nothing yet', tone: 'bad' }
  return { label: 'In progress', tone: 'warn' }
}

/** Dates here are dd/mm/yy - the only place in the app that uses that format (Ryan, 2026-10-26). */
export const COLUMNS: Column[] = [
  {
    id: 'po',
    label: 'PO',
    fixed: true,
    visibleByDefault: true,
    sortKey: 'po_number',
    cell: (r) => <span className="mono">{r.po_number || '-'}</span>,
    csv: (r) => r.po_number,
  },
  {
    id: 'ext',
    label: 'Contract Ext No',
    visibleByDefault: true,
    sortKey: 'contract_ext_no',
    cell: (r) => (
      <span className="mono" style={{ fontSize: 12 }}>
        {r.contract_ext_no}
      </span>
    ),
    csv: (r) => r.contract_ext_no,
  },
  {
    id: 'date',
    label: 'Contract Date',
    visibleByDefault: true,
    sortKey: 'contract_date',
    numeric: true,
    cell: (r) => ddmmyy(r.contract_date),
    csv: (r) => ddmmyy(r.contract_date),
  },
  { id: 'supplier', label: 'Supplier', visibleByDefault: true, sortKey: 'supplier', cell: (r) => r.supplier || '-', csv: (r) => r.supplier },
  { id: 'buyer', label: 'Buyer', visibleByDefault: false, sortKey: 'buyer', cell: (r) => r.buyer || '-', csv: (r) => r.buyer },
  { id: 'product', label: 'Product', visibleByDefault: true, sortKey: 'product', cell: (r) => r.product || '-', csv: (r) => r.product },
  { id: 'incoterm', label: 'Incoterm', visibleByDefault: true, sortKey: 'incoterm', cell: (r) => r.incoterm || '-', csv: (r) => r.incoterm },
  {
    id: 'plant',
    label: 'Region/Plant',
    visibleByDefault: true,
    sortKey: 'plant_site',
    cell: (r) => r.plant_site || '-',
    csv: (r) => r.plant_site,
  },
  {
    id: 'qty',
    label: 'Contract Qty (kg)',
    visibleByDefault: true,
    sortKey: 'contract_qty',
    numeric: true,
    cell: (r) => num(r.quantity_ordered),
    csv: (r) => r.quantity_ordered,
  },
  {
    id: 'payDue',
    label: 'Payment Due Date',
    visibleByDefault: false,
    sortKey: 'payment_due_date',
    numeric: true,
    cell: (r) => ddmmyy(r.payment_due_date),
    csv: (r) => ddmmyy(r.payment_due_date),
  },
  {
    id: 'dp',
    label: 'DP Date',
    visibleByDefault: false,
    sortKey: 'dp_due_date',
    numeric: true,
    cell: (r) => ddmmyy(r.dp_due_date),
    csv: (r) => ddmmyy(r.dp_due_date),
  },
  {
    id: 'payoff',
    label: 'Payoff Date',
    visibleByDefault: false,
    sortKey: 'payoff_date',
    numeric: true,
    cell: (r) => ddmmyy(r.payoff_date),
    csv: (r) => ddmmyy(r.payoff_date),
  },
  {
    id: 'unitPrice',
    label: 'Unit Price (IDR)',
    visibleByDefault: false,
    sortKey: 'unit_price',
    numeric: true,
    cell: (r) => priceCell(r.unit_price, r.currency),
    csv: (r) => r.unit_price,
  },
  {
    id: 'totalPrice',
    label: 'Total Price (IDR)',
    visibleByDefault: false,
    sortKey: 'total_price',
    numeric: true,
    cell: (r) => priceCell(r.total_price, r.currency),
    csv: (r) => r.total_price,
  },
  { id: 'b2b', label: 'B2B', visibleByDefault: false, sortKey: 'b2b_flag', cell: (r) => r.b2b_flag || '-', csv: (r) => r.b2b_flag },
  {
    id: 'docs',
    label: 'Documents',
    fixed: true,
    visibleByDefault: true,
    cell: (r) => (
      <div className="prog">
        <div className="dots" aria-hidden>
          {DOCUMENT_TYPES.map((t) => (
            <span key={t} className={`dot${hasType(r, t) ? ' on' : ''}`} />
          ))}
        </div>
        <span className="num" style={{ fontSize: 12.5, color: 'var(--ink-2)' }}>
          {typesDone(r)}/9
        </span>
      </div>
    ),
    csv: (r) => `${typesDone(r)}/9`,
  },
  {
    id: 'status',
    label: 'Status',
    visibleByDefault: true,
    cell: (r) => {
      const s = statusOf(r)
      return <span className={`pill ${s.tone}`}>{s.label}</span>
    },
    csv: (r) => statusOf(r).label,
  },
]

export const DEFAULT_VISIBLE: Record<string, boolean> = Object.fromEntries(COLUMNS.map((c) => [c.id, c.visibleByDefault]))
