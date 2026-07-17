import { describe, expect, it } from 'vitest';
import {
  buildTruckingExecutionDailySummaryInsertSql,
  buildTruckingStageSnapshotInsertSql,
} from './pipelineDailySummarySql';

describe('pipelineDailySummarySql', () => {
  it('buildTruckingExecutionDailySummaryInsertSql uses full SAP + WB-aware pipeline status', () => {
    const sql = buildTruckingExecutionDailySummaryInsertSql();
    expect(sql).toContain('trucking_daily_actuals');
    expect(sql).toContain("FILTER (WHERE status = 'IN_PROGRESS')");
    expect(sql).toContain('sap_processed_data');
    expect(sql).not.toContain('buildTruckingListSelectClause(true)');
  });

  it('buildTruckingStageSnapshotInsertSql uses PO-grain conflict on operation_id', () => {
    const sql = buildTruckingStageSnapshotInsertSql();
    expect(sql).toContain('INSERT INTO trucking_list_stage_snapshot');
    expect(sql).toContain('ON CONFLICT (operation_id) DO NOTHING');
    expect(sql).not.toContain('ON CONFLICT (operation_id, sto_line)');
  });
});
