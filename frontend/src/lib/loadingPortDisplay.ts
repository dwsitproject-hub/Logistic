/**
 * Loading / discharge port labels in Edit Shipment modal.
 * Priority: SAP (human-readable) → KLIP input → "—".
 * Numeric SAP codes (e.g. 67.30) are treated as invalid port names.
 */

export function isValidHumanPortName(value: unknown): boolean {
  if (value === null || value === undefined) return false
  const text = String(value).trim()
  if (!text || text === '0.00') return false
  if (/^\d+(\.\d+)?$/.test(text)) return false
  return true
}

export function resolveLoadingPortDisplayLabel(opts: {
  sapPortName?: unknown
  klipPortName?: unknown
}): string {
  if (isValidHumanPortName(opts.sapPortName)) {
    return String(opts.sapPortName).trim()
  }
  if (isValidHumanPortName(opts.klipPortName)) {
    return String(opts.klipPortName).trim()
  }
  return '—'
}

export function resolveKlipPortInputValue(value: unknown): string {
  return isValidHumanPortName(value) ? String(value).trim() : ''
}

export function resolveLoadingPortDisplayFromRow(
  portRow: { port_name?: unknown; sap_port_name?: unknown } | null | undefined,
  shipmentInfo?: Record<string, unknown> | null,
  sequence?: number,
): string {
  const sapFromInfo =
    sequence != null && shipmentInfo
      ? shipmentInfo[`sap_vessel_loading_port_${sequence}`]
      : undefined
  const sapDischarge =
    portRow && Boolean((portRow as { is_discharge_port?: boolean }).is_discharge_port)
      ? shipmentInfo?.sap_vessel_discharge_port_1
      : undefined

  return resolveLoadingPortDisplayLabel({
    sapPortName: portRow?.sap_port_name ?? sapFromInfo ?? sapDischarge,
    klipPortName: portRow?.port_name,
  })
}
