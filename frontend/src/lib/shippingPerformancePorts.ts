/**
 * Shipping Performance Section 3 — loading/discharge port display with SAP fallback.
 * Shipment operation names take precedence; SAP text names fill gaps.
 * Numeric codes (e.g. Vessel LOA mistaken for ZNEGO-INCO2 port id) are skipped.
 */

export type ShippingPerformancePortSource = {
  port_of_loading?: string | null
  port_of_discharge?: string | null
  loading_port?: string | null
  discharge_port?: string | null
  vlp_loading_port_name?: string | null
  vlp_discharge_port_name?: string | null
  sap_vessel_loading_port_1?: string | null
  sap_vessel_discharge_port?: string | null
}

const INVALID_PORT_VALUES = new Set(['', 'blank', '0.00', '-', '—'])

export function isEmptyShippingPortValue(value: unknown): boolean {
  const trimmed = String(value ?? '').trim()
  if (!trimmed) return true
  return INVALID_PORT_VALUES.has(trimmed.toLowerCase())
}

/** SAP ZNEGO-INCO2 / import sometimes stores Vessel LOA (e.g. 74.66) instead of port name. */
export function isPortCodeLike(value: unknown): boolean {
  const trimmed = String(value ?? '').trim()
  if (!trimmed) return false
  return /^\d+(\.\d+)?$/.test(trimmed)
}

function pickShippingPortName(...candidates: readonly (unknown)[]): string | null {
  for (const candidate of candidates) {
    if (isEmptyShippingPortValue(candidate)) continue
    if (isPortCodeLike(candidate)) continue
    return String(candidate).trim()
  }
  return null
}

/** Shipment operation loading port name, then SAP Vessel Loading Port 1 text. */
export function resolveShippingPerfLoadingPort(row: ShippingPerformancePortSource): string | null {
  return pickShippingPortName(
    row.vlp_loading_port_name,
    row.port_of_loading,
    row.sap_vessel_loading_port_1,
    row.loading_port,
  )
}

/** Shipment operation discharge port name, then SAP Vessel Discharge Port text. */
export function resolveShippingPerfDischargePort(row: ShippingPerformancePortSource): string | null {
  return pickShippingPortName(
    row.vlp_discharge_port_name,
    row.port_of_discharge,
    row.sap_vessel_discharge_port,
    row.discharge_port,
  )
}

/** Section 3 table rows — apply resolved port names for display and sort only. */
export function applySection3PortDisplay<T extends ShippingPerformancePortSource>(row: T): T {
  return {
    ...row,
    loading_port: resolveShippingPerfLoadingPort(row),
    discharge_port: resolveShippingPerfDischargePort(row),
  }
}
