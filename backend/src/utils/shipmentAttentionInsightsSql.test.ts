import { describe, expect, it } from 'vitest'
import {
  buildShipmentCarryOverInsightsQuery,
  buildShipmentOverdueBacklogAggregateQuery,
  buildShipmentOverdueExecutionAggregateQuery,
  buildShipmentOverdueTopVesselsQuery,
  parseShipmentAttentionInsights,
  sqlShipmentHybridRowKey,
} from './shipmentAttentionInsightsSql'
import { unplannedContractBacklogBaseWhereSql } from './shipmentUnplannedHybridSql'

describe('shipmentAttentionInsightsSql', () => {
  it('uses hybrid row key coalesce for execution overdue', () => {
    expect(sqlShipmentHybridRowKey('sp.sto_number', 'sp.operation_id', 'sp.sto_key')).toBe(
      "COALESCE(NULLIF(TRIM(sp.sto_number), ''), NULLIF(TRIM(sp.operation_id), ''), sp.sto_key)",
    )
    const q = buildShipmentOverdueExecutionAggregateQuery(
      'WITH shipment_base AS (SELECT 1 AS x)',
      ' AND TRUE',
    )
    expect(q).toContain('COALESCE(NULLIF(TRIM(sp.sto_number)')
    expect(q).toContain('sp.sto_key')
    expect(q).toContain('overdue_contract_parts')
    expect(q).toContain('GROUP BY row_key')
  })

  it('backlog overdue uses unplanned base where and sea FOB/CIF scope', () => {
    const q = buildShipmentOverdueBacklogAggregateQuery('', '')
    expect(q).toContain(unplannedContractBacklogBaseWhereSql('c', 'l').trim())
    expect(q).toContain("('contract:' || c.id::text) AS row_key")
    expect(q).toContain("delivery_end_date::date < CURRENT_DATE")
    expect(q).toContain("IN ('FOB', 'CIF')")
    expect(q).toContain('bucket_1_7_kg')
  })

  it('execution overdue applies unplanned predicate and vessel_name column', () => {
    const q = buildShipmentOverdueExecutionAggregateQuery(
      'WITH shipment_base AS (SELECT 1)',
      ' AND sb.product = $1',
    )
    expect(q).toContain('is_contract_sap_closed')
    expect(q).toContain('sp.vessel_name')
    expect(q).toContain('filtered_shipments')
    expect(q).toContain("IN ('FOB', 'CIF')")
    expect(q).toContain('CIF')
  })

  it('top vessels query groups by vessel on execution rows only', () => {
    const q = buildShipmentOverdueTopVesselsQuery(
      'WITH shipment_base AS (SELECT 1)',
      ' AND TRUE',
    )
    expect(q).toContain('SELECT vessel_name AS vessel, COALESCE(SUM(outstanding_kg), 0)')
    expect(q).toContain('sp.vessel_name')
    expect(q).toContain('GROUP BY vessel_name')
    expect(q).toContain('ORDER BY os_kg DESC')
    expect(q).toContain('LIMIT 3')
  })

  it('carry-over excludes preplanned via backlog where', () => {
    const q = buildShipmentCarryOverInsightsQuery('', '')
    expect(q).toContain('carry_backlog')
    expect(q).toContain(unplannedContractBacklogBaseWhereSql('c', 'l').trim())
    expect(q).toContain('carry_label_month')
    expect(
      q.split("delivery_end_date::date < date_trunc('month', CURRENT_DATE)::date").length - 1,
    ).toBe(2)
    expect(q).not.toContain('delivery_end_date::date < CURRENT_DATE')
  })

  it('parseShipmentAttentionInsights merges backlog and execution aggregates', () => {
    const parsed = parseShipmentAttentionInsights({
      backlogAggregateRow: {
        row_count: 2,
        total_os_kg: 1000,
        fob_os_kg: 600,
        cif_os_kg: 400,
        bucket_1_7_kg: 100,
        bucket_8_30_kg: 200,
        bucket_gt_30_kg: 700,
        os_gt_30_kg: 700,
      },
      executionAggregateRow: {
        row_count: 3,
        total_os_kg: 2000,
        fob_os_kg: 1500,
        cif_os_kg: 500,
        bucket_1_7_kg: 50,
        bucket_8_30_kg: 150,
        bucket_gt_30_kg: 1800,
        os_gt_30_kg: 1800,
      },
      backlogTopSupplierRows: [{ supplier: 'A', os_kg: 800 }],
      executionTopSupplierRows: [{ supplier: 'B', os_kg: 1200 }, { supplier: 'A', os_kg: 300 }],
      topVesselRows: [{ vessel: 'MV Alpha', os_kg: 900 }],
      carryRow: { carry_total_kg: 500, carry_unplanned_late_kg: 100, carry_label_month: 'Jun 2026' },
      lossRows: [],
      totalOutstandingKg: 10000,
    })
    expect(parsed.vesselCount).toBe(5)
    expect(parsed.totalOsKg).toBe(3000)
    expect(parsed.lossAboveThreshold).toEqual([])
  })
})
