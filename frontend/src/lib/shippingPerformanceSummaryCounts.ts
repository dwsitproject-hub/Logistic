/**
 * Shipping Performance Section 1–2 summary counts.
 * API rows are STO-aggregated; contract_number may be CSV of many contracts.
 */

import { isEmptySapDisplayValue } from '@/lib/sapDisplayValue'

export function collectContractIdsFromValue(value: unknown): string[] {
  const out: string[] = []
  for (const part of String(value ?? '').split(',')) {
    const id = part.trim()
    if (id) out.push(id)
  }
  return out
}

export function addDistinctContractIds(contracts: Set<string>, contractNumberField: unknown): void {
  for (const id of collectContractIdsFromValue(contractNumberField)) {
    contracts.add(id)
  }
}

export function countUniqueContractsFromField(rows: ReadonlyArray<{ contract_number?: string | null }>): number {
  const ids = new Set<string>()
  for (const row of rows) {
    addDistinctContractIds(ids, row.contract_number)
  }
  return ids.size
}

/** True when vessel_name should contribute to Total Vessels (exclude null / Unknown placeholders). */
export function isCountableShippingPerfVessel(vesselName: unknown): boolean {
  return !isEmptySapDisplayValue(vesselName)
}

export function countUniqueShippingPerfVessels(
  rows: ReadonlyArray<{ vessel_name?: string | null }>,
  normalizeVesselKey: (value: unknown) => string,
): number {
  const vessels = new Set<string>()
  for (const row of rows) {
    if (!isCountableShippingPerfVessel(row.vessel_name)) continue
    vessels.add(normalizeVesselKey(row.vessel_name))
  }
  return vessels.size
}

export function addDistinctShippingPerfVessel(
  vessels: Set<string>,
  vesselName: unknown,
  normalizeVesselKey: (value: unknown) => string,
): void {
  if (!isCountableShippingPerfVessel(vesselName)) return
  vessels.add(normalizeVesselKey(vesselName))
}
