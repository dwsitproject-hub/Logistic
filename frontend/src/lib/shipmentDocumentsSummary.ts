/**
 * The one-line summary in the header of the Documents section of Edit Shipment ("Contract 2 · SI 1 · Loading 3"): what the shipment already has, so nobody has to scroll the
 * six cards to see it. A type with no file is left out; with no file at all it says so. The Contract count includes the Contracts uploaded in Commercial Documents (one per PO).
 */

const SHORT_LABEL: Record<string, string> = {
  CONTRACT: 'Contract',
  SI: 'SI',
  BL: 'BL',
  SLD: 'Loading',
  SDD: 'Discharge',
  OTHER: 'Others',
}

/** The types in the order of the cards. */
export const SHIPMENT_DOCUMENT_SUMMARY_ORDER = ['CONTRACT', 'SI', 'BL', 'SLD', 'SDD', 'OTHER'] as const

export function shipmentDocumentsSummary(docs: Array<{ document_type?: string | null }>, codContractCount = 0): string {
  const counts = new Map<string, number>()
  for (const d of docs) {
    const type = String(d.document_type ?? '').trim().toUpperCase()
    if (type) counts.set(type, (counts.get(type) ?? 0) + 1)
  }
  if (codContractCount > 0) counts.set('CONTRACT', (counts.get('CONTRACT') ?? 0) + codContractCount)
  const parts = SHIPMENT_DOCUMENT_SUMMARY_ORDER.filter((t) => (counts.get(t) ?? 0) > 0).map((t) => `${SHORT_LABEL[t]} ${counts.get(t)}`)
  return parts.length > 0 ? parts.join(' · ') : 'No documents yet'
}
