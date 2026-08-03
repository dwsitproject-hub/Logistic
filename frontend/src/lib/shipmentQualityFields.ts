/** Quality metrics stored on vessel_loading_ports rows. */
export type ShipmentQualityFields = {
  quality_ffa: number | null
  quality_mi: number | null
  quality_dobi: number | null
  quality_red: number | null
  quality_ds: number | null
  quality_stone: number | null
}

export const SHIPMENT_QUALITY_FIELD_KEYS: (keyof ShipmentQualityFields)[] = [
  'quality_ffa',
  'quality_mi',
  'quality_dobi',
  'quality_red',
  'quality_ds',
  'quality_stone',
]

export const DISCHARGE_QUALITY_PORT_KEY = 'discharge'

export function emptyShipmentQualityFields(): ShipmentQualityFields {
  return {
    quality_ffa: null,
    quality_mi: null,
    quality_dobi: null,
    quality_red: null,
    quality_ds: null,
    quality_stone: null,
  }
}

function parseQualityNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  const normalized = String(value).replace(/,/g, '').trim()
  if (!normalized) return null
  const parsed = parseFloat(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

/** Resolve quality from port row with optional shipmentInfo fallback key prefix. */
export function shipmentQualityFieldsFromPort(
  portRow: Record<string, unknown> | undefined,
  info: Record<string, unknown>,
  infoPrefix: string,
): ShipmentQualityFields {
  const out = emptyShipmentQualityFields()
  for (const key of SHIPMENT_QUALITY_FIELD_KEYS) {
    const fromPort = parseQualityNumber(portRow?.[key])
    if (fromPort != null) {
      out[key] = fromPort
      continue
    }
    const suffix = key.replace('quality_', '')
    out[key] = parseQualityNumber(info[`${infoPrefix}_${suffix}`])
  }
  return out
}

export function shipmentQualityFieldsEqual(
  a: ShipmentQualityFields,
  b: ShipmentQualityFields,
): boolean {
  return SHIPMENT_QUALITY_FIELD_KEYS.every((key) => {
    const av = a[key]
    const bv = b[key]
    if (av == null && bv == null) return true
    if (av == null || bv == null) return false
    return Math.abs(av - bv) < 1e-9
  })
}

/** SAP snapshot quality from port row (vessel_loading_ports.sap_quality_*). */
export function qualitySapReferenceFromPort(
  portRow: Record<string, unknown> | undefined,
): ShipmentQualityFields {
  const out = emptyShipmentQualityFields()
  if (!portRow) return out
  out.quality_ffa = parseQualityNumber(portRow.sap_quality_ffa)
  out.quality_mi = parseQualityNumber(portRow.sap_quality_mi)
  out.quality_dobi = parseQualityNumber(portRow.sap_quality_dobi)
  out.quality_red = parseQualityNumber(portRow.sap_quality_red)
  out.quality_ds = parseQualityNumber(portRow.sap_quality_ds)
  out.quality_stone = parseQualityNumber(portRow.sap_quality_stone)
  return out
}
