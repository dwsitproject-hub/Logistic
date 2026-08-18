import { describe, expect, it } from 'vitest'
import {
  buildTruckingOutstandingQtyExecutionAggregateQuery,
  buildTruckingUnplannedBacklogCombinedQuery,
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

  it('page KPI path (osStatus null) aggregates mixed card qty at PO grain', () => {
    const built = {
      preOuterQuery: 'WHERE 1=1',
      outerSql: '',
      innerParams: [],
      outerParams: [],
    }
    const allActive = buildTruckingOutstandingQtyExecutionAggregateQuery(built, null)
    expect(allActive.text).toContain("IN ('UNPLANNED', 'PLANNED', 'IN_PROGRESS')")
    expect(allActive.text).toContain('per_contract')
    expect(allActive.text).toContain('GREATEST(0')
    expect(allActive.text).toContain('card_total_kg')
    expect(allActive.text).not.toMatch(/pc\.status = \$/)
    expect(allActive.params).toEqual([])
  })

  it('helper still supports Planned card PLANNED + IN_PROGRESS (unused by page KPI)', () => {
    const built = {
      preOuterQuery: 'WHERE 1=1',
      outerSql: '',
      innerParams: [],
      outerParams: [],
    }
    const planned = buildTruckingOutstandingQtyExecutionAggregateQuery(built, 'PLANNED')
    expect(planned.text).toContain("IN ('PLANNED', 'IN_PROGRESS')")
    expect(planned.params).toEqual([])

    const inProg = buildTruckingOutstandingQtyExecutionAggregateQuery(built, 'IN_PROGRESS')
    expect(inProg.text).toMatch(/pc\.status = \$1/)
    expect(inProg.params).toEqual(['IN_PROGRESS'])
  })

  it('includes unplanned backlog only for ALL or UNPLANNED (helper; page KPI always merges backlog)', () => {
    expect(shouldIncludeTruckingUnplannedBacklogForOs(null)).toBe(true)
    expect(shouldIncludeTruckingUnplannedBacklogForOs('UNPLANNED')).toBe(true)
    expect(shouldIncludeTruckingUnplannedBacklogForOs('PLANNED')).toBe(false)
    expect(shouldIncludeTruckingUnplannedBacklogForOs('IN_PROGRESS')).toBe(false)
  })

  it('parses card_total_kg and keeps Other residual', () => {
    const a = parseTruckingOutstandingQtySummaryRow({
      third_party_frc_kg: 1000,
      third_party_lco_kg: 2000,
      interco_frc_kg: 3000,
      interco_lco_kg: 4000,
      card_total_kg: 12000,
    })
    expect(a.totalKg).toBe(12000)
    expect(a.otherKg).toBe(2000)
    const b = parseTruckingOutstandingQtySummaryRow({
      third_party_frc_kg: 500,
      third_party_lco_kg: 0,
      interco_frc_kg: 0,
      interco_lco_kg: 250,
    })
    expect(b.totalKg).toBe(750)
    const merged = mergeTruckingOutstandingQtySummaries(a, b)
    expect(merged.thirdParty.frcKg).toBe(1500)
    expect(merged.interco.lcoKg).toBe(4250)
    expect(merged.totalKg).toBe(12750)
    expect(merged.otherKg).toBe(2000)
  })

  it('builds source_type predicates matching Contract Performance rules', () => {
    expect(sqlTruckingSourceIsThirdParty('c.source_type')).toContain("'3RD'")
    expect(sqlTruckingSourceIsThirdParty('c.source_type')).toContain("'PARTY'")
    expect(sqlTruckingSourceIsInterco('c.source_type')).toContain('INTERCO')
    expect(sqlTruckingSourceIsInterco('c.source_type')).toContain('INHOUSE')
  })

  it('combined backlog query scans the backlog once for count + contract qty + OS aggregates', () => {
    const text = buildTruckingUnplannedBacklogCombinedQuery('AND c.contract_date >= $1', '')
    expect(text).toContain('backlog_rows')
    expect(text).toContain('latest_spd_contract')
    expect(text).toContain('COUNT(*)::bigint AS c')
    expect(text).toContain('AS contract_qty_kg')
    expect(text).toContain('AS card_total_kg')
    expect(text).toContain('quantity_ordered')
    expect(text).toContain('qty_move')
    expect(text).toContain('outstanding_quantity')
    expect(text).toContain('third_party_frc_kg')
    expect(text).toContain('interco_lco_kg')
    // Single FROM/backlog scan — not three separate SELECTs like the deprecated helpers.
    expect(text.match(/FROM backlog_rows/g)?.length).toBe(1)
    expect(text).toContain('b2b_end')
    expect(text).toContain('b2b_ending_child_snapshot')
  })
})
