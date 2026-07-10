import { describe, expect, it } from 'vitest';
import { buildTruckingExecutionDailySummaryInsertSql } from './pipelineDailySummarySql';

describe('pipelineDailySummarySql', () => {
  it('buildTruckingExecutionDailySummaryInsertSql uses full SAP + WB-aware pipeline status', () => {
    const sql = buildTruckingExecutionDailySummaryInsertSql();
    expect(sql).toContain('trucking_daily_actuals');
    expect(sql).toContain("FILTER (WHERE status = 'IN_PROGRESS')");
    expect(sql).toContain('sap_processed_data');
    expect(sql).not.toContain('buildTruckingListSelectClause(true)');
  });
});
