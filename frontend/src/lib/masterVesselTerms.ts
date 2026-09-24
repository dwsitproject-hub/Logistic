/** Map master vessel charter type (T/C, V/C, CIF) onto a shipment charter type. */
export function charterTypeFromMasterTerms(terms?: string | null): string {
  const t = String(terms ?? '').trim().toUpperCase()
  return t === 'T/C' || t === 'V/C' || t === 'CIF' ? t : ''
}
