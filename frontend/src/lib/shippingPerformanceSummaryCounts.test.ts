import { describe, expect, it } from 'vitest'
import {
  addDistinctContractIds,
  addDistinctShippingPerfVessel,
  countUniqueContractsFromField,
  countUniqueShippingPerfVessels,
  isCountableShippingPerfVessel,
} from './shippingPerformanceSummaryCounts'

function normalizeVesselKey(value: unknown): string {
  const trimmed = String(value ?? '').trim()
  return trimmed || 'Unknown'
}

describe('shippingPerformanceSummaryCounts', () => {
  it('counts unique contracts after splitting CSV contract_number', () => {
    const rows = [
      { contract_number: 'A, B, C' },
      { contract_number: 'B, D' },
      { contract_number: 'E' },
    ]
    expect(countUniqueContractsFromField(rows)).toBe(5)
  })

  it('excludes null/Unknown vessels from vessel totals', () => {
    const rows = [
      { vessel_name: 'MV ONE' },
      { vessel_name: 'MV TWO' },
      { vessel_name: null },
      { vessel_name: '' },
      { vessel_name: 'Unknown' },
      { vessel_name: 'MV ONE' },
    ]
    expect(countUniqueShippingPerfVessels(rows, normalizeVesselKey)).toBe(2)
    expect(isCountableShippingPerfVessel(null)).toBe(false)
    expect(isCountableShippingPerfVessel('Unknown')).toBe(false)
    expect(isCountableShippingPerfVessel('MV ONE')).toBe(true)
  })

  it('addDistinct helpers match set-based totals', () => {
    const contracts = new Set<string>()
    addDistinctContractIds(contracts, '1001, 1002')
    addDistinctContractIds(contracts, '1002')
    expect(contracts.size).toBe(2)

    const vessels = new Set<string>()
    addDistinctShippingPerfVessel(vessels, 'MV A', normalizeVesselKey)
    addDistinctShippingPerfVessel(vessels, null, normalizeVesselKey)
    addDistinctShippingPerfVessel(vessels, 'Unknown', normalizeVesselKey)
    expect(vessels.size).toBe(1)
  })
})
