import { isGenericKlipPortPlaceholder } from '@/lib/shippingPerformancePorts'
import { isContractSapClosedFlag } from '@/lib/shipmentVesselCompare'

/**
 * Loading / discharge port labels in Edit Shipment modal & list.
 * Open (GR): KLIP → SAP → "-".
 * Closed (GR): SAP → KLIP → "-".
 * Numeric SAP codes and generic KLIP placeholders are invalid.
 */

export const EMPTY_PORT_DISPLAY = '-'

export function isValidHumanPortName(value: unknown): boolean {
  if (value === null || value === undefined) return false
  const text = String(value).trim()
  if (!text || text === '0.00') return false
  if (/^\d+(\.\d+)?$/.test(text)) return false
  if (isGenericKlipPortPlaceholder(text)) return false
  return true
}

function validPortOrEmpty(value: unknown): string {
  return isValidHumanPortName(value) ? String(value).trim() : ''
}

/**
 * Primary port label by GR open/closed.
 * Default (closed omitted/false) = Open: KLIP → SAP → "-".
 */
export function resolveLoadingPortDisplayLabel(opts: {
  sapPortName?: unknown
  klipPortName?: unknown
  /** GR Close → SAP first. Open / unset → KLIP first. */
  contractSapClosed?: unknown
}): string {
  const klip = validPortOrEmpty(opts.klipPortName)
  const sap = validPortOrEmpty(opts.sapPortName)
  const closed = isContractSapClosedFlag(opts.contractSapClosed)
  if (closed) {
    return sap || klip || EMPTY_PORT_DISPLAY
  }
  return klip || sap || EMPTY_PORT_DISPLAY
}

export function resolveKlipPortInputValue(value: unknown): string {
  return isValidHumanPortName(value) ? String(value).trim() : ''
}

export function resolveKlipPortNameFromRow(
  portRow: { port_name?: unknown; is_discharge_port?: unknown } | null | undefined,
  shipmentInfo?: Record<string, unknown> | null,
  sequence?: number,
): string {
  const isDischarge = Boolean(portRow?.is_discharge_port)
  const rawSeq = sequence ?? (portRow?.is_discharge_port ? undefined : 1)
  const seqNum = Number(rawSeq)
  const seq = seqNum === 2 || seqNum === 3 ? seqNum : isDischarge ? undefined : 1

  let klipShipmentFallback: unknown
  if (isDischarge) {
    klipShipmentFallback = shipmentInfo?.vessel_discharge_port_1
  } else if (seq == null || seq === 1) {
    klipShipmentFallback = shipmentInfo?.vessel_loading_port_1
  }

  const klipFromRow = isValidHumanPortName(portRow?.port_name) ? portRow?.port_name : undefined
  const klipFromShipment = isValidHumanPortName(klipShipmentFallback)
    ? klipShipmentFallback
    : undefined
  const klip = klipFromRow ?? klipFromShipment
  return isValidHumanPortName(klip) ? String(klip).trim() : ''
}

/** SAP port name only — empty string when SAP is missing/invalid (no KLIP fallback). */
export function resolveSapPortNameFromRow(
  portRow: { sap_port_name?: unknown; is_discharge_port?: unknown } | null | undefined,
  shipmentInfo?: Record<string, unknown> | null,
  sequence?: number,
): string {
  const isDischarge = Boolean(portRow?.is_discharge_port)
  const rawSeq = sequence ?? (portRow?.is_discharge_port ? undefined : 1)
  const seqNum = Number(rawSeq)
  const seq = seqNum === 2 || seqNum === 3 ? seqNum : isDischarge ? undefined : 1
  const sapFromInfo =
    !isDischarge && seq != null && shipmentInfo
      ? shipmentInfo[`sap_vessel_loading_port_${seq}`]
      : undefined
  const sapDischarge = isDischarge ? shipmentInfo?.sap_vessel_discharge_port_1 : undefined
  const sap = portRow?.sap_port_name ?? sapFromInfo ?? sapDischarge
  return isValidHumanPortName(sap) ? String(sap).trim() : ''
}

export function resolveLoadingPortDisplayFromRow(
  portRow: { port_name?: unknown; sap_port_name?: unknown; is_discharge_port?: unknown } | null | undefined,
  shipmentInfo?: Record<string, unknown> | null,
  sequence?: number,
  contractSapClosed?: unknown,
): string {
  const isDischarge = Boolean(portRow?.is_discharge_port)
  const rawSeq = sequence ?? (portRow?.is_discharge_port ? undefined : 1)
  const seqNum = Number(rawSeq)
  const seq = seqNum === 2 || seqNum === 3 ? seqNum : isDischarge ? undefined : 1
  const sapFromInfo =
    !isDischarge && seq != null && shipmentInfo
      ? shipmentInfo[`sap_vessel_loading_port_${seq}`]
      : undefined
  const sapDischarge = isDischarge ? shipmentInfo?.sap_vessel_discharge_port_1 : undefined

  let klipShipmentFallback: unknown
  if (isDischarge) {
    klipShipmentFallback = shipmentInfo?.vessel_discharge_port_1
  } else if (seq == null || seq === 1) {
    klipShipmentFallback = shipmentInfo?.vessel_loading_port_1
  }

  const klipFromRow = isValidHumanPortName(portRow?.port_name) ? portRow?.port_name : undefined
  const klipFromShipment = isValidHumanPortName(klipShipmentFallback)
    ? klipShipmentFallback
    : undefined

  const closed =
    contractSapClosed ??
    shipmentInfo?.is_contract_sap_closed ??
    shipmentInfo?.contract_sap_closed

  return resolveLoadingPortDisplayLabel({
    sapPortName: portRow?.sap_port_name ?? sapFromInfo ?? sapDischarge,
    klipPortName: klipFromRow ?? klipFromShipment,
    contractSapClosed: closed,
  })
}
