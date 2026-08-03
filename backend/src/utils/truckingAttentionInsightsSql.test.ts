import { describe, expect, it } from 'vitest'
import {
  buildTruckingCarryOverInsightsQuery,
  buildTruckingOverdueInsightsAggregateQuery,
  parseTruckingAttentionInsights,
  truckingOpenLandContractBaseWhereSql,
} from './truckingAttentionInsightsSql'

describe('truckingAttentionInsightsSql', () => {
  it('overdue aggregate uses qty_move and aging buckets', () => {
    const q = buildTruckingOverdueInsightsAggregateQuery('', '')
    expect(q).toContain('latest_spd_contract')
    expect(q).toContain('qty_move AS')
    expect(q).toContain('bucket_1_7_kg')
    expect(q).toContain('delivery_end_date::date < CURRENT_DATE')
    expect(q).toContain(truckingOpenLandContractBaseWhereSql('c', 'l').trim())
  })

  it('carry-over backlog uses same month cutoff as carry total', () => {
    const q = buildTruckingCarryOverInsightsQuery('', '')
    expect(q).toContain('carry_backlog')
    expect(
      q.split("delivery_end_date::date < date_trunc('month', CURRENT_DATE)::date").length - 1,
    ).toBe(2)
    expect(q).not.toContain('delivery_end_date::date < CURRENT_DATE')
  })

  it('parseTruckingAttentionInsights maps overdue and carry-over', () => {
    const parsed = parseTruckingAttentionInsights({
      aggregateRow: {
        contract_count: 5,
        total_os_kg: 3000,
        third_party_os_kg: 2000,
        interco_os_kg: 1000,
        bucket_1_7_kg: 100,
        bucket_8_30_kg: 200,
        bucket_gt_30_kg: 2700,
        os_gt_30_kg: 2700,
      },
      topSupplierRows: [{ supplier: 'Supplier A', os_kg: 1200 }],
      carryRow: { carry_total_kg: 500, carry_unplanned_late_kg: 100, carry_label_month: 'Jun 2026' },
      lossRows: [],
      totalOutstandingKg: 10000,
    })
    expect(parsed.contractCount).toBe(5)
    expect(parsed.carryOver?.totalKg).toBe(500)
    expect(parsed.lossAboveThreshold).toEqual([])
  })

  it('parseTruckingAttentionInsights returns null carryOver when zero kg', () => {
    const parsed = parseTruckingAttentionInsights({
      aggregateRow: {},
      topSupplierRows: [],
      carryRow: {},
      lossRows: [],
      totalOutstandingKg: 0,
    })
    expect(parsed.carryOver).toBeNull()
  })
})
