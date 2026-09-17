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
 * Table / SAP-hydrate vessel name: always the API's resolved name.
 *
 * A vessel *name* is never free text - it is mapped from KLIP's Master Vessel by the effective
 * vessel code (SAP's code, or the code the operator picked when editing). The API already applies
 * that rule: `vessel_name` comes from `resolveShipmentDisplayVesselName`, which runs every
 * candidate through `canonicalVesselName` (it strips the SAP tug prefix and normalises), so an
 * Open row already carries the master form.
 *
 * This function used to prefer `vessel_name_klip` while the contract was Open. That field holds
 * the value **as stored**, uncanonicalised - and `shipments.vessel_name` is written by the SAP
 * import as well as by KLIP, so what surfaced was often SAP's free text rather than an operator
 * choice. Measured on the dev database: 551 rows store a name that differs from the master name
 * for their code, and 545 of those names do not exist in Master Vessel at all - they came from
 * SAP's `Vessel Name` field, e.g. `TEBAR/BG.TIGA JAYA 58` against master `BG.TIGA JAYA 58`, and
 * `Prima Samudra IX` against `PRIMA SAMUDRA IX`. The frontend's `trimVesselName` only trims, so
 * preferring that field bypassed the backend's canonicalisation and displayed the raw SAP string.
 *
 * It also made the same row render differently depending on the view: the status-filtered list
 * carried the raw text in `vessel_name_klip` while the unfiltered list carried the master form.
 *
 * `vessel_name_klip` is still the right field for the KLIP-vs-SAP comparison badge in the edit
 * modal, which is what it exists for - it is just not a display name.
 */
export function shipmentListHydrateVesselName(
  baseName: unknown,
  hydrated: {
    vessel_name?: unknown
    vessel_name_klip?: unknown
    is_contract_sap_closed?: unknown
  },
  _baseClosed?: unknown,
): string {
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
