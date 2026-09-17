import { describe, expect, it } from 'vitest'
import { compareVesselIdleRows, compareVesselWillFreeRows, type VesselIdleListRow, type VesselWillFreeListRow } from './VesselIdleModal'

const base = (overrides: Partial<VesselIdleListRow>): VesselIdleListRow => ({
  vessel_code: 'CODE',
  vessel_name: 'Vessel A',
  company: 'Owner Co',
  company_group: 'Other Group',
  terms: 'T/C',
  capacity_mt: 1000,
  most_loading_port: null,
  most_discharge_port: null,
  ...overrides,
})

describe('compareVesselIdleRows', () => {
  it('puts LMI GROUP first then sorts other company groups alphabetically', () => {
    const rows = [
      base({ company_group: 'Zeta Shipping', vessel_name: 'Z1' }),
      base({ company_group: 'LMI Group', vessel_name: 'L1' }),
      base({ company_group: 'Alpha Marine', vessel_name: 'A1' }),
    ]
    const sorted = [...rows].sort(compareVesselIdleRows)
    expect(sorted.map((r) => r.company_group)).toEqual(['LMI Group', 'Alpha Marine', 'Zeta Shipping'])
  })

  it('sorts by vessel name within the same company group', () => {
    const rows = [
      base({ company_group: 'Alpha Marine', vessel_name: 'Bravo' }),
      base({ company_group: 'Alpha Marine', vessel_name: 'Alpha' }),
    ]
    const sorted = [...rows].sort(compareVesselIdleRows)
    expect(sorted.map((r) => r.vessel_name)).toEqual(['Alpha', 'Bravo'])
  })

  it('sorts will free rows by ETC at discharge then company group priority', () => {
    const rows: VesselWillFreeListRow[] = [
      { ...base({ company_group: 'Other Co', vessel_name: 'B' }), etc_at_discharge: '2026-08-10' },
      { ...base({ company_group: 'LMI Group', vessel_name: 'A' }), etc_at_discharge: '2026-08-08' },
      { ...base({ company_group: 'Other Co', vessel_name: 'C' }), etc_at_discharge: '2026-08-08' },
    ]
    const sorted = [...rows].sort(compareVesselWillFreeRows)
    expect(sorted.map((r) => `${r.etc_at_discharge}:${r.vessel_name}`)).toEqual([
      '2026-08-08:A',
      '2026-08-08:C',
      '2026-08-10:B',
    ])
  })
})
