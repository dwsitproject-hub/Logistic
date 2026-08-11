/**
 * Shipments list — loading/discharge port display.
 * Priority: SAP Vessel Loading Port / Vessel Discharge Port first;
 * if SAP is null/invalid, fall back to KLIP Shipment operation input
 * (shipments.port_of_loading/discharge + vessel_loading_ports.port_name).
 */

import {
  isEmptyShippingPortValue,
  isGenericKlipPortPlaceholder,
  isPortCodeLike,
  resolveShippingPerfDischargePort,
  resolveShippingPerfLoadingPort,
  type ShippingPerformancePortSource,
} from '@/lib/shippingPerformancePorts'

export type ShipmentListPortSource = ShippingPerformancePortSource & {
  loading_ports?: string | null
  discharge_ports?: string | null
  loading_ports_klip?: string | null
  discharge_ports_klip?: string | null
  sap_loading_ports?: string | null
  sap_discharge_ports?: string | null
}

function splitCommaPorts(value: unknown): string[] {
  const raw = String(value ?? '').trim()
  if (!raw) return []
  return raw
    .split(',')
    .map((part) => part.trim())
    .filter(
      (part) =>
        part &&
        !isEmptyShippingPortValue(part) &&
        !isPortCodeLike(part) &&
        !isGenericKlipPortPlaceholder(part),
    )
}

function joinUniquePorts(parts: string[]): string {
  const seen = new Set<string>()
  const out: string[] = []
  for (const part of parts) {
    const key = part.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(part)
  }
  return out.join(', ')
}

function resolveSapLoadingPorts(row: ShipmentListPortSource): string {
  return joinUniquePorts([
    ...splitCommaPorts(row.sap_loading_ports),
    ...splitCommaPorts(row.sap_vessel_loading_port_1),
  ])
}

function resolveSapDischargePorts(row: ShipmentListPortSource): string {
  return joinUniquePorts([
    ...splitCommaPorts(row.sap_discharge_ports),
    ...splitCommaPorts(row.sap_vessel_discharge_port),
  ])
}

function resolveKlipLoadingPorts(row: ShipmentListPortSource): string {
  const fromKlipAgg = joinUniquePorts([...splitCommaPorts(row.loading_ports_klip)])
  if (fromKlipAgg) return fromKlipAgg
  return (
    resolveShippingPerfLoadingPort({
      port_of_loading: row.port_of_loading,
      vlp_loading_port_name: row.vlp_loading_port_name,
      loading_port: row.loading_port,
    }) ?? ''
  )
}

function resolveKlipDischargePorts(row: ShipmentListPortSource): string {
  const fromKlipAgg = joinUniquePorts([...splitCommaPorts(row.discharge_ports_klip)])
  if (fromKlipAgg) return fromKlipAgg
  return (
    resolveShippingPerfDischargePort({
      port_of_discharge: row.port_of_discharge,
      vlp_discharge_port_name: row.vlp_discharge_port_name,
      discharge_port: row.discharge_port,
    }) ?? ''
  )
}

/** Resolved loading ports for list table (comma-separated when multiple SAP ports). */
export function resolveShipmentListLoadingPorts(row: ShipmentListPortSource): string {
  const sap = resolveSapLoadingPorts(row)
  if (sap) return sap
  return resolveKlipLoadingPorts(row)
}

/** Resolved discharge ports for list table. */
export function resolveShipmentListDischargePorts(row: ShipmentListPortSource): string {
  const sap = resolveSapDischargePorts(row)
  if (sap) return sap
  return resolveKlipDischargePorts(row)
}
