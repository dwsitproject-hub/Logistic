export type CommercialDocumentType =
  | 'contract'
  | 'faktur_pajak'
  | 'dp'
  | 'invoice_dp'
  | 'ep_pelunasan'
  | 'invoice_pelunasan'

export const COMMERCIAL_DOCUMENT_TYPES: CommercialDocumentType[] = [
  'contract',
  'faktur_pajak',
  'dp',
  'invoice_dp',
  'ep_pelunasan',
  'invoice_pelunasan',
]

export const COMMERCIAL_DOCUMENTS_PAGE_PERMISSION = 'page.commercial_documents'
export const COMMERCIAL_DOCUMENTS_DATA_PERMISSION = 'data.commercial_documents'

export const COMMERCIAL_DOCUMENT_LABELS: Record<CommercialDocumentType, string> = {
  contract: 'Contract',
  faktur_pajak: 'Faktur Pajak',
  dp: 'DP',
  invoice_dp: 'Invoice DP',
  ep_pelunasan: 'EP Pelunasan',
  invoice_pelunasan: 'Invoice Pelunasan',
}

export type CommercialDocumentRow = {
  id: string
  contract_id: string
  contract_ext_no: string
  po_number: string | null
  buyer: string | null
  supplier: string | null
  product: string | null
  incoterm: string | null
  contract_date: string | null
  payment_due_date: string | null
  dp_due_date: string | null
  quantity_ordered: number
  unit_price: number
  total_price: number
  currency: string | null
  company_name: string | null
  plant_site: string | null
  transport_mode: string | null
  b2b_flag: string | null
  contract_reference_po: string | null
  import_status: string | null
  status: string | null
  is_open: boolean
  uploaded_count: number
  doc_contract: boolean
  doc_faktur_pajak: boolean
  doc_dp: boolean
  doc_invoice_dp: boolean
  doc_ep_pelunasan: boolean
  doc_invoice_pelunasan: boolean
}

export type CommercialDocSummaryCard = {
  openCount: number
  checkedCount: number
  checkedPct: number
  uncheckedPct: number
}

export type CommercialDocumentsSummary = Record<CommercialDocumentType, CommercialDocSummaryCard>

export type CommercialDocumentHistoryEntry = {
  id: string
  contract_ext_no: string
  document_type: CommercialDocumentType
  action_type: 'ADD' | 'EDIT'
  file_name: string | null
  user_name: string | null
  created_at: string
}

export type CommercialDocumentFileRecord = {
  id: string
  contract_ext_no: string
  document_type: CommercialDocumentType
  file_name: string
  file_path: string
  checked: boolean
  created_at: string
  updated_at: string
}

export function docCheckedField(type: CommercialDocumentType): keyof CommercialDocumentRow {
  const map: Record<CommercialDocumentType, keyof CommercialDocumentRow> = {
    contract: 'doc_contract',
    faktur_pajak: 'doc_faktur_pajak',
    dp: 'doc_dp',
    invoice_dp: 'doc_invoice_dp',
    ep_pelunasan: 'doc_ep_pelunasan',
    invoice_pelunasan: 'doc_invoice_pelunasan',
  }
  return map[type]
}

export function defaultCommercialDocsYtdRange(): { dateFrom: string; dateTo: string } {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return { dateFrom: `${y}-01-01`, dateTo: `${y}-${m}-${day}` }
}

export function isContractB2bOrigin(row: Pick<CommercialDocumentRow, 'b2b_flag' | 'contract_reference_po'>): boolean {
  const flag = String(row.b2b_flag || '').trim().toUpperCase()
  const isB2b = flag === 'B2B' || flag === 'YES' || flag === 'Y'
  return isB2b && !String(row.contract_reference_po || '').trim()
}
