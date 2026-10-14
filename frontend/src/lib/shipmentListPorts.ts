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
import { displayPortLabel, normalizeListPortIdentity } from '@/lib/portDisplay'

export { normalizeListPortIdentity }

export type ShipmentListPortSource = ShippingPerformancePortSource & {
  loading_ports?: string | null
  discharge_ports?: string | null
  loading_ports_klip?: string | null
  discharge_ports_klip?: string | null
  sap_loading_ports?: string | null
  sap_discharge_ports?: string | null
  is_contract_sap_closed?: boolean | string | null
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

/**
 * Resolved discharge ports for list table.
 *
 * A B2B origin (parent) is the company in the middle: the ending child's port replaces every other port (the server leaves `discharge_port_b2b_child` empty when a
 * user typed the shipment's port, and the typed port then follows the rule below).
 */
export function resolveShipmentListDischargePorts(row: ShipmentListPortSource): string {
  const child = splitCommaPorts(row.discharge_port_b2b_child)
  const text = child.length > 0
    ? joinUniquePorts(child)
    : pickPortByGrStatus(resolveKlipDischargePorts(row), resolveSapDischargePorts(row), isContractSapClosedFlag(row.is_contract_sap_closed))
  return asMasterPorts(text)
}

/** Each port of a list drawn as its Master Port when it has one, else as it is (the original SAP / KLIP text); two texts of one port become one. */
function asMasterPorts(text: string): string {
  if (!text) return text
  return joinUniquePorts(text.split(',').map((part) => displayPortLabel(part.trim())).filter(Boolean))
}
