import { describe, expect, it } from 'vitest'
import { compareVesselIdleRows, type VesselIdleListRow } from './VesselIdleModal'

const base = (overrides: Partial<VesselIdleListRow>): VesselIdleListRow => ({
  vessel_code: 'CODE',
  vessel_name: 'Vessel A',
  company: 'Other Co',
  capacity_mt: 1000,
  most_loading_port: null,
  most_discharge_port: null,
  ...overrides,
})

describe('compareVesselIdleRows', () => {
  it('puts LMI GROUP first then sorts other companies alphabetically', () => {
    const rows = [
      base({ company: 'Zeta Shipping', vessel_name: 'Z1' }),
      base({ company: 'LMI Group', vessel_name: 'L1' }),
      base({ company: 'Alpha Marine', vessel_name: 'A1' }),
    ]
    const sorted = [...rows].sort(compareVesselIdleRows)
    expect(sorted.map((r) => r.company)).toEqual(['LMI Group', 'Alpha Marine', 'Zeta Shipping'])
  })

  it('sorts by vessel name within the same company', () => {
    const rows = [
      base({ company: 'Alpha Marine', vessel_name: 'Bravo' }),
      base({ company: 'Alpha Marine', vessel_name: 'Alpha' }),
    ]
    const sorted = [...rows].sort(compareVesselIdleRows)
    expect(sorted.map((r) => r.vessel_name)).toEqual(['Alpha', 'Bravo'])
  })
})
