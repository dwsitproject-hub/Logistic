import { describe, expect, it } from 'vitest'
import {
  isTruckingOsStatusOutsideActiveScope,
  mergeTruckingOutstandingQtySummaries,
  normalizeTruckingOsStatusParam,
  parseTruckingOutstandingQtySummaryRow,
  shouldIncludeTruckingUnplannedBacklogForOs,
  sqlTruckingSourceIsInterco,
  sqlTruckingSourceIsThirdParty,
} from './truckingOutstandingQtySummarySql'

describe('truckingOutstandingQtySummarySql', () => {
  it('normalizes osStatus and treats ALL as null', () => {
    expect(normalizeTruckingOsStatusParam('PLANNED')).toBe('PLANNED')
    expect(normalizeTruckingOsStatusParam('ALL')).toBeNull()
    expect(normalizeTruckingOsStatusParam(undefined)).toBeNull()
  })

  it('marks Completed/Cancelled outside active OS scope', () => {
    expect(isTruckingOsStatusOutsideActiveScope('COMPLETED')).toBe(true)
    expect(isTruckingOsStatusOutsideActiveScope('CANCELLED')).toBe(true)
    expect(isTruckingOsStatusOutsideActiveScope('PLANNED')).toBe(false)
    expect(isTruckingOsStatusOutsideActiveScope(null)).toBe(false)
  })

  it('includes unplanned backlog only for ALL or UNPLANNED', () => {
    expect(shouldIncludeTruckingUnplannedBacklogForOs(null)).toBe(true)
    expect(shouldIncludeTruckingUnplannedBacklogForOs('UNPLANNED')).toBe(true)
    expect(shouldIncludeTruckingUnplannedBacklogForOs('PLANNED')).toBe(false)
    expect(shouldIncludeTruckingUnplannedBacklogForOs('IN_PROGRESS')).toBe(false)
  })

  it('parses and merges bucket rows', () => {
    const a = parseTruckingOutstandingQtySummaryRow({
      third_party_frc_kg: 1000,
      third_party_lco_kg: 2000,
      interco_frc_kg: 3000,
      interco_lco_kg: 4000,
    })
    expect(a.totalKg).toBe(10000)
    const b = parseTruckingOutstandingQtySummaryRow({
      third_party_frc_kg: 500,
      third_party_lco_kg: 0,
      interco_frc_kg: 0,
      interco_lco_kg: 250,
    })
    const merged = mergeTruckingOutstandingQtySummaries(a, b)
    expect(merged.thirdParty.frcKg).toBe(1500)
    expect(merged.interco.lcoKg).toBe(4250)
    expect(merged.totalKg).toBe(10750)
  })

  it('builds source_type predicates matching Contract Performance rules', () => {
    expect(sqlTruckingSourceIsThirdParty('c.source_type')).toContain("'3RD'")
    expect(sqlTruckingSourceIsThirdParty('c.source_type')).toContain("'PARTY'")
    expect(sqlTruckingSourceIsInterco('c.source_type')).toContain('INTERCO')
    expect(sqlTruckingSourceIsInterco('c.source_type')).toContain('INHOUSE')
  })
})
