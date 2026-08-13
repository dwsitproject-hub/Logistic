import { describe, expect, it } from 'vitest'
import {
  alignShipmentOutstandingQtyTotalToCardSum,
  buildShipmentOutstandingQtyBacklogAggregateQuery,
  buildShipmentOutstandingQtyExecutionAggregateQuery,
  isShipmentOsStatusOutsideActiveScope,
  mergeShipmentOutstandingQtySummaries,
  normalizeShipmentOsStatusParam,
  parseShipmentOutstandingQtySummaryRow,
  reconcileShipmentOutstandingQtySummary,
  shouldIncludeShipmentPreplannedBacklogForOs,
  shouldIncludeShipmentUnplannedBacklogForOs,
  sqlShipmentIncotermIsCfr,
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
    expect(isShipmentOsStatusOutsideActiveScope('PREPLANNED')).toBe(false)
    expect(isShipmentOsStatusOutsideActiveScope('SAILED')).toBe(false)
    expect(isShipmentOsStatusOutsideActiveScope(null)).toBe(false)
  })

  it('includes unplanned backlog only for ALL or UNPLANNED (helper; page KPI always uses null)', () => {
    expect(shouldIncludeShipmentUnplannedBacklogForOs(null)).toBe(true)
    expect(shouldIncludeShipmentUnplannedBacklogForOs('UNPLANNED')).toBe(true)
    expect(shouldIncludeShipmentUnplannedBacklogForOs('PLANNED')).toBe(false)
    expect(shouldIncludeShipmentUnplannedBacklogForOs('SAILED')).toBe(false)
  })

  it('includes preplanned backlog only for ALL or PREPLANNED', () => {
    expect(shouldIncludeShipmentPreplannedBacklogForOs(null)).toBe(true)
    expect(shouldIncludeShipmentPreplannedBacklogForOs('PREPLANNED')).toBe(true)
    expect(shouldIncludeShipmentPreplannedBacklogForOs('UNPLANNED')).toBe(false)
    expect(shouldIncludeShipmentPreplannedBacklogForOs('PLANNED')).toBe(false)
  })

  it('page KPI path (osStatus null) uses row-level outstanding_quantity enriched CTE aligned with status cards', () => {
    const q = buildShipmentOutstandingQtyExecutionAggregateQuery(
      'WITH shipment_base AS (SELECT 1)',
      ' AND TRUE',
      [],
      null,
    )
    expect(q.text).toContain('outstanding_quantity')
    expect(q.text).not.toContain('active_shipments')
    expect(q.text).toContain('card_total_kg')
    expect(q.text).toContain('is_unplanned_execution')
    expect(q.text).toContain('sto_metrics')
    expect(q.text).toContain('contract_source_type')
    expect(q.text).toContain("sk.data->'raw'->>'Source'")
    expect(q.text).not.toContain('active_shipments')
    // Buckets must exclude COMPLETED / CANCELLED so strip breakdown stays active-stage scoped.
    expect(q.text).toContain(sqlShipmentOutstandingActiveStagePredicate('sb').trim().slice(0, 40))
    expect(q.params).toEqual([])
  })

  it('backlog aggregate uses the same Unplanned/Preplanned rows and card OS, sliced by SAP-aware source × effective incoterm', () => {
    const sql = buildShipmentOutstandingQtyBacklogAggregateQuery('', '')
    expect(sql).toContain('UNION ALL')
    expect(sql).toContain("'CFR'")
    expect(sql).toContain('qty_move')
    expect(sql).toContain('third_party_cfr_kg')
    expect(sql).toContain('pre_planned_group')
    expect(sql).toContain('source_type_raw')
    expect(sql).toContain('GREATEST(0')
    expect(sql).toContain('> 1000')
    expect(sql).toContain("spd.data->'raw'->>'Incoterm'")
    expect(sql).toContain("spd.data->'raw'->>'Source'")
    // Sea scope stays on effective incoterm (cards), not a second filter on blank contracts.incoterm.
    expect(sql).not.toMatch(
      /UPPER\(TRIM\(COALESCE\(c\.incoterm, ''\)\)\) IN \('CIF', 'FOB', 'CFR'\)/,
    )
  })

  it('parses and merges bucket rows; totalKg uses card_total_kg when present', () => {
    const a = parseShipmentOutstandingQtySummaryRow({
      third_party_fob_kg: 1000,
      third_party_cif_kg: 2000,
      third_party_cfr_kg: 500,
      interco_fob_kg: 3000,
      interco_cif_kg: 4000,
      interco_cfr_kg: 250,
      card_total_kg: 12000,
    })
    expect(a.totalKg).toBe(12000)
    expect(a.thirdParty.cfrKg).toBe(500)
    const b = parseShipmentOutstandingQtySummaryRow({
      third_party_fob_kg: 500,
      third_party_cif_kg: 0,
      third_party_cfr_kg: 100,
      interco_fob_kg: 0,
      interco_cif_kg: 250,
      interco_cfr_kg: 0,
      card_total_kg: 900,
    })
    const merged = mergeShipmentOutstandingQtySummaries(a, b)
    expect(merged.thirdParty.fobKg).toBe(1500)
    expect(merged.thirdParty.cfrKg).toBe(600)
    expect(merged.interco.cifKg).toBe(4250)
    expect(merged.totalKg).toBe(12900)
  })

  it('falls back to bucket sum for totalKg when card_total_kg is absent', () => {
    const row = parseShipmentOutstandingQtySummaryRow({
      third_party_fob_kg: 100,
      third_party_cif_kg: 0,
      third_party_cfr_kg: 0,
      interco_fob_kg: 0,
      interco_cif_kg: 0,
      interco_cfr_kg: 0,
    })
    expect(row.totalKg).toBe(100)
  })

  it('alignShipmentOutstandingQtyTotalToCardSum sets Other residual so buckets + Other = total', () => {
    const aligned = alignShipmentOutstandingQtyTotalToCardSum(
      {
        totalKg: 999,
        thirdParty: { fobKg: 10, cifKg: 20, cfrKg: 30 },
        interco: { fobKg: 40, cifKg: 50, cfrKg: 60 },
      },
      21000,
    )
    expect(aligned.totalKg).toBe(21000)
    expect(aligned.thirdParty.fobKg).toBe(10)
    expect(aligned.interco.cfrKg).toBe(60)
    // classified = 210; Other = 21000 - 210
    expect(aligned.otherKg).toBe(21000 - 210)
  })

  it('reconcileShipmentOutstandingQtySummary keeps identity 3rd+Interco+Other = total', () => {
    const row = reconcileShipmentOutstandingQtySummary(
      {
        totalKg: 1000,
        thirdParty: { fobKg: 100, cifKg: 0, cfrKg: 0 },
        interco: { fobKg: 0, cifKg: 200, cfrKg: 0 },
      },
      1000,
    )
    expect(row.otherKg).toBe(700)
    expect(
      row.thirdParty.fobKg +
        row.thirdParty.cifKg +
        row.thirdParty.cfrKg +
        row.interco.fobKg +
        row.interco.cifKg +
        row.interco.cfrKg +
        (row.otherKg ?? 0),
    ).toBe(row.totalKg)
  })

  it('builds source_type predicates matching Contract Performance rules', () => {
    expect(sqlShipmentSourceIsThirdParty('c.source_type')).toContain("'3RD'")
    expect(sqlShipmentSourceIsThirdParty('c.source_type')).toContain("'PARTY'")
    expect(sqlShipmentSourceIsInterco('c.source_type')).toContain('INTERCO')
    expect(sqlShipmentSourceIsInterco('c.source_type')).toContain('INHOUSE')
    expect(sqlShipmentIncotermIsCfr('c.incoterm')).toContain("'CFR'")
  })

  it('active stage predicate includes planned/sailed loading groups', () => {
    const sql = sqlShipmentOutstandingActiveStagePredicate('f')
    expect(sql).toContain('PLANNED')
    expect(sql).toContain('SAILED')
    expect(sql).toContain('ARRIVED_LP')
    expect(sql).toContain('ARRIVED_DP')
  })
})
