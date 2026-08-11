/** Map master vessel terms (V/C | T/C) to Add Shipment charter type value. */
export function charterTypeFromMasterTerms(terms?: string | null): string {
  const t = String(terms ?? '').trim().toUpperCase()
  return t === 'V/C' || t === 'T/C' ? t : ''
}
