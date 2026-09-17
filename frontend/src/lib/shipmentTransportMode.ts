/**
 * Normalize contract transport_mode for Add Shipment ETA visibility.
 * SEA / MIX show Estimation (ETA); LAND hides it (trucking module).
 */
export function classifyShipmentTransportMode(
  raw: string | null | undefined,
): 'land' | 'sea' | 'mixed' | null {
  const m = String(raw ?? '').trim().toUpperCase()
  if (!m) return null
  // Check MIX before substring "land"/"sea" so values like MIX / MIXED stay mixed.
  if (m === 'MIX' || m === 'MIXED' || m.startsWith('MIX')) return 'mixed'
  if (m.includes('SEA') && m.includes('LAND')) return 'mixed'
  if (m === 'LAND' || m.startsWith('LAND') || m.includes('TRUCK')) return 'land'
  if (m === 'SEA' || m.startsWith('SEA') || m.includes('VESSEL') || m.includes('SHIP')) return 'sea'
  return 'mixed'
}
