import { describe, expect, it } from 'vitest';
import { buildTruckingStatusSummaryCombinedQuery } from './truckingStatusSummaryCombinedSql';

describe('truckingStatusSummaryCombinedSql', () => {
  const built = {
    preOuterQuery: 'WITH base AS (SELECT 1 AS x)',
    outerSql: '',
    innerParams: [] as unknown[],
    outerParams: [] as unknown[],
    skipSapJoin: true,
  };

  it('buildTruckingStatusSummaryCombinedQuery uses one STO expansion', () => {
    const { text } = buildTruckingStatusSummaryCombinedQuery(built);
    expect(text.match(/per_contract AS/g)?.length).toBe(1);
    expect(text.match(/os_execution AS/g)?.length).toBe(1);
    expect(text).toContain('unplanned_contract_qty');
    expect(text).toContain('unplanned_outstanding_qty');
    expect(text).toContain('planned_outstanding_qty');
    expect(text).toContain('third_party_frc_kg');
    expect(text).toContain('total_count');
  });

  it('buildTruckingStatusSummaryCombinedQuery can omit counts for daily fast path', () => {
    const { text } = buildTruckingStatusSummaryCombinedQuery(built, { includeCounts: false });
    expect(text).not.toContain('sc.total_count');
    expect(text).not.toContain('CROSS JOIN status_counts sc');
    expect(text).toContain('unplanned_contract_qty');
    expect(text).toContain('third_party_frc_kg');
  });

  it('buildTruckingStatusSummaryCombinedQuery grOpenOnly excludes GR-Close POs from live expansion', () => {
    const { text } = buildTruckingStatusSummaryCombinedQuery(built, { grOpenOnly: true });
    expect(text).toContain('is_contract_sap_closed');
    expect(text).toContain('COALESCE(trucking_source.is_contract_sap_closed, FALSE) = FALSE');
  });
});
