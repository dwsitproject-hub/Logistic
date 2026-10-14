/**
 * Shipping Performance Section 3 — loading/discharge port display.
 * Priority: SAP port name first; if SAP is null/invalid, fall back to KLIP shipment input
 * (port_of_loading/discharge on shipments or vessel_loading_ports.port_name).
 * Numeric codes (e.g. Vessel LOA mistaken for ZNEGO-INCO2 port id) are skipped.
 */

import { masterPortOf } from '@/lib/portDisplay'

export type ShippingPerformancePortSource = {
  port_of_loading?: string | null
  port_of_discharge?: string | null
  loading_port?: string | null
  discharge_port?: string | null
  vlp_loading_port_name?: string | null
  vlp_discharge_port_name?: string | null
  sap_vessel_loading_port_1?: string | null
  sap_vessel_discharge_port?: string | null
  /**
   * The ending B2B child's discharge port. A B2B origin (parent) is the company in the middle, so where this is set it replaces every other port of the row;
   * the server leaves it empty when a user typed the shipment's port (a typed port wins) and when the contract has no B2B child.
   */
  discharge_port_b2b_child?: string | null
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

/** Legacy KLIP generic labels — not real master port names. */
export function isGenericKlipPortPlaceholder(value: unknown): boolean {
  const text = String(value ?? '').trim()
  if (!text) return false
  return /^Loading Port \d+$/i.test(text) || /^Discharge Port$/i.test(text)
}

function pickShippingPortName(...candidates: readonly (unknown)[]): string | null {
  for (const candidate of candidates) {
    if (isEmptyShippingPortValue(candidate)) continue
    if (isPortCodeLike(candidate)) continue
    if (isGenericKlipPortPlaceholder(candidate)) continue
    return String(candidate).trim()
  }
  return null
}

/** SAP Vessel Loading Port, then KLIP shipment loading port (add/edit shipment). */
export function resolveShippingPerfLoadingPort(row: ShippingPerformancePortSource): string | null {
  return pickShippingPortName(
    row.sap_vessel_loading_port_1,
    row.port_of_loading,
    row.vlp_loading_port_name,
    row.loading_port,
  )
}

/** Every usable loading port text of a row, in the order the table prefers them: the SAP Vessel Loading Port, then the KLIP shipment's. */
export function loadingPortCandidates(row: ShippingPerformancePortSource): string[] {
  return [row.sap_vessel_loading_port_1, row.port_of_loading, row.vlp_loading_port_name, row.loading_port].flatMap((candidate) => {
    const name = pickShippingPortName(candidate)
    return name ? [name] : []
  })
}

/** The first text that has a Master Port, drawn as that Master Port; when none has one, the first text as it is (the original SAP / KLIP value). */
function drawnPort(candidates: string[]): string | null {
  const master = candidates.map((text) => masterPortOf(text)).find((label): label is string => label !== null)
  return master ?? candidates[0] ?? null
}

/** The loading port the table DRAWS: its Master Port when it has one, else the original text. */
export function displayShippingPerfLoadingPort(row: ShippingPerformancePortSource): string | null {
  return drawnPort(loadingPortCandidates(row))
}

/** The discharge port the table DRAWS: its Master Port when it has one (the first text that does, the one the filter reads), else the original text. */
export function displayShippingPerfDischargePort(row: ShippingPerformancePortSource): string | null {
  return drawnPort(dischargePortCandidates(row))
}

/** Every usable discharge port text of a row, in the order the table prefers them: the ending B2B child's, the SAP Vessel Discharge Port, the KLIP shipment's. */
export function dischargePortCandidates(row: ShippingPerformancePortSource): string[] {
  return [
    row.discharge_port_b2b_child,
    row.sap_vessel_discharge_port,
    row.port_of_discharge,
    row.vlp_discharge_port_name,
    row.discharge_port,
  ].flatMap((candidate) => {
    const name = pickShippingPortName(candidate)
    return name ? [name] : []
  })
}

/** The ending B2B child's port, then SAP Vessel Discharge Port, then KLIP shipment discharge port (add/edit shipment). */
export function resolveShippingPerfDischargePort(row: ShippingPerformancePortSource): string | null {
  return dischargePortCandidates(row)[0] ?? null
}

/** Section 3 table rows — apply resolved port names for display and sort only. */
export function applySection3PortDisplay<T extends ShippingPerformancePortSource>(row: T): T {
  // drawn as the Master Port of the first text that has one (the same text the Discharge Port filter reads), else the text the table always showed
  return {
    ...row,
    loading_port: displayShippingPerfLoadingPort(row),
    discharge_port: displayShippingPerfDischargePort(row),
  }
}
