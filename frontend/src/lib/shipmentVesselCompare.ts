/** KLIP vs SAP vessel-name compare for Edit / View Shipment. */

export function trimVesselName(value: unknown): string {
  if (value === null || value === undefined) return ''
  return String(value).replace(/\r/g, '').trim()
}

export function normalizeVesselNameKey(value: unknown): string {
  return trimVesselName(value).toUpperCase()
}

/** True when KLIP stored a vessel that differs from SAP (user override). */
export function hasKlipVesselNameOverride(klipName: unknown, sapName: unknown): boolean {
  const klip = normalizeVesselNameKey(klipName)
  if (!klip) return false
  const sap = normalizeVesselNameKey(sapName)
  if (!sap) return true
  return klip !== sap
}

export interface ShipmentVesselPrimaryNameOptions {
  masterName?: unknown
  /** GR Close → Master/SAP first (same as list). Open → KLIP then SAP. */
  contractSapClosed?: boolean
}

/**
 * Editable / primary vessel name — aligned with list hydrate:
 * Open: KLIP → SAP → Master. Closed: Master → SAP → KLIP.
 */
export function shipmentVesselPrimaryName(
  klipName: unknown,
  sapName: unknown,
  options?: ShipmentVesselPrimaryNameOptions,
): string {
  const closed = options?.contractSapClosed === true
  const klip = trimVesselName(klipName)
  const sap = trimVesselName(sapName)
  const master = trimVesselName(options?.masterName)
  if (!closed) {
    return klip || sap || master
  }
  return master || sap || klip
}

/** pg / JSON flags — Boolean('false') is true, so parse explicitly. */
export function isContractSapClosedFlag(value: unknown): boolean {
  if (value === true || value === 1) return true
  if (value === false || value === 0 || value == null) return false
  const s = String(value).trim().toLowerCase()
  if (!s || s === 'false' || s === 'f' || s === '0' || s === 'no' || s === 'open') return false
  return s === 'true' || s === 't' || s === '1' || s === 'yes' || s === 'close' || s === 'closed'
}

/**
 * Table / SAP-hydrate vessel: GR Open → stored KLIP (user edit); GR Close → API overlay (Master/SAP).
 */
export function shipmentListHydrateVesselName(
  baseName: unknown,
  hydrated: {
    vessel_name?: unknown
    vessel_name_klip?: unknown
    is_contract_sap_closed?: unknown
  },
  baseClosed?: unknown,
): string {
  const closed = isContractSapClosedFlag(hydrated.is_contract_sap_closed ?? baseClosed)
  if (!closed) {
    const klip = trimVesselName(hydrated.vessel_name_klip) || trimVesselName(hydrated.vessel_name)
    if (klip) return klip
  }
  const overlay = trimVesselName(hydrated.vessel_name)
  return overlay || trimVesselName(baseName)
}

/** First non-empty trimmed string among candidates. */
export function firstNonEmptyVesselField(...values: unknown[]): string {
  for (const v of values) {
    const t = trimVesselName(v)
    if (t) return t
  }
  return ''
}
