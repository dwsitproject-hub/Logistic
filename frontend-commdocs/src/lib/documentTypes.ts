import type { DocumentFile, DocumentRow } from './types'

/** The nine checklist types, in checklist order. Same keys and labels as the backend (utils/commercialDocumentsConstants.ts). */
export const DOCUMENT_TYPES = [
  'draft_contract',
  'contract',
  'addendum_contract',
  'berita_acara',
  'bea_cukai',
  'delivery_order',
  'invoice_fp_dp',
  'invoice_fp_payoff',
  'invoice_fp_full',
] as const

export type DocumentType = (typeof DOCUMENT_TYPES)[number]

export const DOCUMENT_LABELS: Record<DocumentType, string> = {
  draft_contract: 'Draft Contract',
  contract: 'Contract',
  addendum_contract: 'Addendum Contract',
  berita_acara: 'Berita Acara (BA)',
  bea_cukai: 'Bea Cukai',
  delivery_order: 'DO',
  invoice_fp_dp: 'Invoice + FP Down Payment (DP)',
  invoice_fp_payoff: 'Invoice + FP Payoff (PO)',
  invoice_fp_full: 'Invoice + FP (Full Receive)',
}

/** Older stored document_type values and the checklist type they now count as. */
const LEGACY: Record<string, DocumentType> = {
  dp: 'invoice_fp_dp',
  invoice_dp: 'invoice_fp_dp',
  ep_pelunasan: 'invoice_fp_payoff',
  invoice_pelunasan: 'invoice_fp_full',
}

export function isDocumentType(value: unknown): value is DocumentType {
  return typeof value === 'string' && (DOCUMENT_TYPES as readonly string[]).includes(value)
}

export function canonicalType(value: string): DocumentType | null {
  if (isDocumentType(value)) return value
  return LEGACY[value] ?? null
}

export function typeLabel(value: string): string {
  const t = canonicalType(value)
  return t ? DOCUMENT_LABELS[t] : value
}

export function hasType(row: DocumentRow, type: DocumentType): boolean {
  return Boolean(row[`doc_${type}` as keyof DocumentRow])
}

export function typesDone(row: DocumentRow): number {
  return DOCUMENT_TYPES.filter((t) => hasType(row, t)).length
}

/** Versions of one checklist type, oldest first (the API returns files ordered by created_at). */
export function versionsOf(files: DocumentFile[], type: DocumentType): DocumentFile[] {
  return files.filter((f) => canonicalType(f.document_type) === type)
}

/** Images are accepted only for Invoice + FP (Full Receive); everything else is PDF. Mirrors the backend upload filter. */
export function acceptsImages(type: DocumentType): boolean {
  return type === 'invoice_fp_full'
}

export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024

/** Client-side check before uploading, so the user is told at once. The server checks again. */
export function uploadProblem(type: DocumentType, file: { name: string; type: string; size: number }): string | null {
  if (file.size > MAX_UPLOAD_BYTES) return 'The file is larger than 15 MB.'
  const name = file.name.toLowerCase()
  const isPdf = file.type === 'application/pdf' || name.endsWith('.pdf')
  const isImage = /^image\/(png|jpe?g|webp)$/.test(file.type) || /\.(png|jpe?g|webp)$/.test(name)
  if (isPdf) return null
  if (isImage && acceptsImages(type)) return null
  return acceptsImages(type) ? 'Only PDF, PNG, JPG or WEBP files can be uploaded here.' : 'Only PDF files can be uploaded here.'
}

/** The key the backend files a PO's documents under: the PO, or the contract id when SAP sent no PO. */
export function documentKey(row: Pick<DocumentRow, 'po_number' | 'contract_id'>): string {
  return String(row.po_number || row.contract_id || '').trim()
}

/** A B2B origin contract (its children are listed in the drawer). Same rule as KLIP. */
export function isB2bOrigin(row: Pick<DocumentRow, 'b2b_flag' | 'contract_reference_po'>): boolean {
  const flag = String(row.b2b_flag || '').trim().toUpperCase()
  return (flag === 'B2B' || flag === 'YES' || flag === 'Y') && !String(row.contract_reference_po || '').trim()
}
