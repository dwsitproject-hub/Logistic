export type CommercialDocumentType =
  | 'contract'
  | 'addendum_contract'
  | 'invoice_fp_dp'
  | 'invoice_fp_payoff'
  | 'invoice_fp_full'

export const COMMERCIAL_DOCUMENT_TYPES: CommercialDocumentType[] = [
  'contract',
  'addendum_contract',
  'invoice_fp_dp',
  'invoice_fp_payoff',
  'invoice_fp_full',
]

export const COMMERCIAL_DOCUMENTS_PAGE_PERMISSION = 'page.commercial_documents'
export const COMMERCIAL_DOCUMENTS_DATA_PERMISSION = 'data.commercial_documents'

/** Section 1 summary cards (Contract → Invoice + FP Full Receive). Set false to hide UI and skip summary SQL. */
export const COMMERCIAL_DOCUMENTS_SHOW_SUMMARY_SECTION = false

export const COMMERCIAL_DOCUMENT_LABELS: Record<CommercialDocumentType, string> = {
  contract: 'Contract',
  addendum_contract: 'Addendum Contract',
  invoice_fp_dp: 'Invoice + FP Down Payment (DP)',
  invoice_fp_payoff: 'Invoice + FP Payoff (PO)',
  invoice_fp_full: 'Invoice + FP (Full Receive)',
}

/** Legacy DB document_type values mapped to current checklist categories. */
const LEGACY_TYPE_TO_CANONICAL: Record<string, CommercialDocumentType> = {
  dp: 'invoice_fp_dp',
  invoice_dp: 'invoice_fp_dp',
  ep_pelunasan: 'invoice_fp_payoff',
  invoice_pelunasan: 'invoice_fp_full',
}

export function documentTypesForCategory(type: CommercialDocumentType): string[] {
  switch (type) {
    case 'invoice_fp_dp':
      return ['invoice_fp_dp', 'dp', 'invoice_dp']
    case 'invoice_fp_payoff':
      return ['invoice_fp_payoff', 'ep_pelunasan']
    case 'invoice_fp_full':
      return ['invoice_fp_full', 'invoice_pelunasan']
    default:
      return [type]
  }
}

export function canonicalCommercialDocumentType(value: string): CommercialDocumentType | null {
  if ((COMMERCIAL_DOCUMENT_TYPES as readonly string[]).includes(value)) {
    return value as CommercialDocumentType
  }
  return LEGACY_TYPE_TO_CANONICAL[value] ?? null
}

export function commercialDocumentTypeLabel(value: string): string {
  if ((COMMERCIAL_DOCUMENT_TYPES as readonly string[]).includes(value)) {
    return COMMERCIAL_DOCUMENT_LABELS[value as CommercialDocumentType]
  }
  const canonical = LEGACY_TYPE_TO_CANONICAL[value]
  if (canonical) return COMMERCIAL_DOCUMENT_LABELS[canonical]
  return value
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
  doc_addendum_contract: boolean
  doc_invoice_fp_dp: boolean
  doc_invoice_fp_payoff: boolean
  doc_invoice_fp_full: boolean
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
  document_type: string
  document_type_label?: string
  action_type: 'ADD' | 'EDIT'
  file_name: string | null
  user_name: string | null
  created_at: string
}

export type CommercialDocumentFileRecord = {
  id: string
  contract_ext_no: string
  document_type: string
  document_type_label?: string
  file_name: string
  file_path: string
  checked: boolean
  created_at: string
  updated_at: string
}

export function docCheckedField(type: CommercialDocumentType): keyof CommercialDocumentRow {
  const map: Record<CommercialDocumentType, keyof CommercialDocumentRow> = {
    contract: 'doc_contract',
    addendum_contract: 'doc_addendum_contract',
    invoice_fp_dp: 'doc_invoice_fp_dp',
    invoice_fp_payoff: 'doc_invoice_fp_payoff',
    invoice_fp_full: 'doc_invoice_fp_full',
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

export function filesForDocumentCategory(
  files: CommercialDocumentFileRecord[],
  type: CommercialDocumentType,
): CommercialDocumentFileRecord[] {
  const allowed = new Set(documentTypesForCategory(type))
  return files
    .filter((f) => allowed.has(f.document_type))
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
}

export function documentVersionLabel(type: CommercialDocumentType, versionIndex: number): string {
  const base = COMMERCIAL_DOCUMENT_LABELS[type]
  return versionIndex > 0 ? `${base} (${versionIndex + 1})` : base
}
