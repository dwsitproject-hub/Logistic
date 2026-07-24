import { describe, expect, it } from 'vitest'
import {
  buildShipmentOutstandingQtyExecutionAggregateQuery,
  isShipmentOsStatusOutsideActiveScope,
  mergeShipmentOutstandingQtySummaries,
  normalizeShipmentOsStatusParam,
  parseShipmentOutstandingQtySummaryRow,
  shouldIncludeShipmentUnplannedBacklogForOs,
  sqlShipmentOutstandingActiveStagePredicate,
  sqlShipmentSourceIsInterco,
  sqlShipmentSourceIsThirdParty,
} from './shipmentOutstandingQtySummarySql'

describe('shipmentOutstandingQtySummarySql', () => {
  it('normalizes osStatus and treats ALL as null', () => {
    expect(normalizeShipmentOsStatusParam('PLANNED')).toBe('PLANNED')
    expect(normalizeShipmentOsStatusParam('AT_LOADING_PORT')).toBe('AT_LOADING_PORT')
    expect(normalizeShipmentOsStatusParam('ALL')).toBeNull()
    expect(normalizeShipmentOsStatusParam(undefined)).toBeNull()
  })

  it('marks Completed/Cancelled outside active OS scope', () => {
    expect(isShipmentOsStatusOutsideActiveScope('COMPLETED')).toBe(true)
    expect(isShipmentOsStatusOutsideActiveScope('CANCELLED')).toBe(true)
    expect(isShipmentOsStatusOutsideActiveScope('PLANNED')).toBe(false)
    expect(isShipmentOsStatusOutsideActiveScope('SAILED')).toBe(false)
    expect(isShipmentOsStatusOutsideActiveScope(null)).toBe(false)
  })

  it('includes unplanned backlog only for ALL or UNPLANNED (helper; page KPI always uses null)', () => {
    expect(shouldIncludeShipmentUnplannedBacklogForOs(null)).toBe(true)
    expect(shouldIncludeShipmentUnplannedBacklogForOs('UNPLANNED')).toBe(true)
    expect(shouldIncludeShipmentUnplannedBacklogForOs('PLANNED')).toBe(false)
    expect(shouldIncludeShipmentUnplannedBacklogForOs('SAILED')).toBe(false)
  })

  it('page KPI path (osStatus null) has no per-card stage filter beyond active predicate', () => {
    const q = buildShipmentOutstandingQtyExecutionAggregateQuery(
      'WITH shipment_base AS (SELECT 1)',
      ' AND TRUE',
      [],
      null,
    )
    expect(q.text).toContain('PLANNED')
    expect(q.text).toContain('SAILED')
    expect(q.text).toContain('sp.sto_key')
    expect(q.text).toContain('NOT (')
    expect(q.text).toContain("'CLOSE'")
    // No bound stage param when osStatus is null
    expect(q.params).toEqual([])
  })

  it('parses and merges bucket rows', () => {
    const a = parseShipmentOutstandingQtySummaryRow({
      third_party_fob_kg: 1000,
      third_party_cif_kg: 2000,
      interco_fob_kg: 3000,
      interco_cif_kg: 4000,
    })
    expect(a.totalKg).toBe(10000)
    const b = parseShipmentOutstandingQtySummaryRow({
      third_party_fob_kg: 500,
      third_party_cif_kg: 0,
      interco_fob_kg: 0,
      interco_cif_kg: 250,
    })
    const merged = mergeShipmentOutstandingQtySummaries(a, b)
    expect(merged.thirdParty.fobKg).toBe(1500)
    expect(merged.interco.cifKg).toBe(4250)
    expect(merged.totalKg).toBe(10750)
  })

  it('builds source_type predicates matching Contract Performance rules', () => {
    expect(sqlShipmentSourceIsThirdParty('c.source_type')).toContain("'3RD'")
    expect(sqlShipmentSourceIsThirdParty('c.source_type')).toContain("'PARTY'")
    expect(sqlShipmentSourceIsInterco('c.source_type')).toContain('INTERCO')
    expect(sqlShipmentSourceIsInterco('c.source_type')).toContain('INHOUSE')
  })

  it('active stage predicate includes planned/sailed loading groups', () => {
    const sql = sqlShipmentOutstandingActiveStagePredicate('f')
    expect(sql).toContain('PLANNED')
    expect(sql).toContain('SAILED')
    expect(sql).toContain('ARRIVED_LP')
    expect(sql).toContain('ARRIVED_DP')
  })
})
