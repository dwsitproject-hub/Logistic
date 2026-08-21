/**
 * Shipments list — loading/discharge port display.
 * Open (GR): KLIP → SAP → "" (UI shows "-").
 * Closed (GR): SAP → KLIP → "".
 */

import {
  isEmptyShippingPortValue,
  isGenericKlipPortPlaceholder,
  isPortCodeLike,
  resolveShippingPerfDischargePort,
  resolveShippingPerfLoadingPort,
  type ShippingPerformancePortSource,
} from '@/lib/shippingPerformancePorts'
import { isContractSapClosedFlag } from '@/lib/shipmentVesselCompare'

export type ShipmentListPortSource = ShippingPerformancePortSource & {
  loading_ports?: string | null
  discharge_ports?: string | null
  loading_ports_klip?: string | null
  discharge_ports_klip?: string | null
  sap_loading_ports?: string | null
  sap_discharge_ports?: string | null
  is_contract_sap_closed?: boolean | string | null
}

/** Align with vesselLoadingPortDedupe.normalizePortIdentity (PORT OF X ≡ X). */
export function normalizeListPortIdentity(name: unknown): string {
  return String(name ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
    .replace(/^(PORT|JETTY|TERMINAL|PELABUHAN|DERMAGA)(\s+OF)?\s+/, '')
    .replace(/\s+/g, ' ')
    .trim()
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
    const key = normalizeListPortIdentity(part) || part.toLowerCase()
    if (!key || seen.has(key)) continue
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

function pickPortByGrStatus(klip: string, sap: string, closed: boolean): string {
  if (closed) return sap || klip
  return klip || sap
}

/** Resolved loading ports for list table (comma-separated when multiple). */
export function resolveShipmentListLoadingPorts(row: ShipmentListPortSource): string {
  const closed = isContractSapClosedFlag(row.is_contract_sap_closed)
  return pickPortByGrStatus(resolveKlipLoadingPorts(row), resolveSapLoadingPorts(row), closed)
}

/** Resolved discharge ports for list table. */
export function resolveShipmentListDischargePorts(row: ShipmentListPortSource): string {
  const closed = isContractSapClosedFlag(row.is_contract_sap_closed)
  return pickPortByGrStatus(resolveKlipDischargePorts(row), resolveSapDischargePorts(row), closed)
}
