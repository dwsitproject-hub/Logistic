import { describe, expect, it } from 'vitest';
import {
  buildTruckingBacklogDailySummaryUpsertSql,
  buildTruckingExecutionDailySummaryInsertSql,
  buildTruckingStageSnapshotInsertSql,
} from './pipelineDailySummarySql';

describe('pipelineDailySummarySql', () => {
  it('buildTruckingExecutionDailySummaryInsertSql uses full SAP + WB-aware pipeline status', async () => {
    const sql = buildTruckingExecutionDailySummaryInsertSql();
    expect(sql).toContain('trucking_daily_actuals');
    expect(sql).toContain("FILTER (WHERE status = 'IN_PROGRESS')");
    expect(sql).toContain('sap_processed_data');
    expect(sql).toContain('cancelled_count = EXCLUDED.cancelled_count');
    expect(sql).toContain('completed_gr_closed_contract_qty');
    expect(sql).toContain('cancelled_gr_closed_contract_qty');
    expect(sql).toContain('is_contract_sap_closed');
    expect(sql).toContain('BOOL_OR(is_contract_sap_closed)');
    expect(sql).toContain('ON CONFLICT (group_plant, contract_date, product, incoterm)');
    expect(sql).not.toContain("NULLIF(TRIM(b2b_end.plant_code), '')");
    expect(sql).not.toContain('buildTruckingListSelectClause(true)');
  });

  it('buildTruckingStageSnapshotInsertSql uses PO-grain conflict on operation_id', async () => {
    const sql = buildTruckingStageSnapshotInsertSql();
    expect(sql).toContain('INSERT INTO trucking_list_stage_snapshot');
    expect(sql).toContain('ON CONFLICT (operation_id) DO NOTHING');
    expect(sql).not.toContain('ON CONFLICT (operation_id, sto_line)');
  });

  /**
   * The refresh builds into a staging copy so the published tables are only touched inside the
   * short swap transaction - the builders have to be aimable at that copy, and the ON CONFLICT
   * clauses must stay target-agnostic (EXCLUDED only, never a hardcoded table qualifier).
   */
  it('aims the execution upsert at a caller-supplied target table', async () => {
    const sql = buildTruckingExecutionDailySummaryInsertSql('stage_tbl');
    expect(sql).toContain('INSERT INTO stage_tbl (');
    expect(sql).not.toContain('INSERT INTO trucking_pipeline_daily_summary');
    expect(sql).toContain('ON CONFLICT (group_plant, contract_date, product, incoterm)');
    expect(sql).not.toContain('trucking_pipeline_daily_summary.');
  });

  it('aims the backlog upsert at a caller-supplied target table', async () => {
    const sql = await buildTruckingBacklogDailySummaryUpsertSql('stage_tbl');
    expect(sql).toContain('INSERT INTO stage_tbl (');
    expect(sql).not.toContain('INSERT INTO trucking_pipeline_daily_summary');
    expect(sql).toContain('unplanned_contract_backlog = EXCLUDED.unplanned_contract_backlog');
  });

  it('aims the stage snapshot insert at a caller-supplied target table', async () => {
    const sql = buildTruckingStageSnapshotInsertSql('stage_tbl');
    expect(sql).toContain('INSERT INTO stage_tbl (');
    expect(sql).not.toContain('INSERT INTO trucking_list_stage_snapshot');
    expect(sql).toContain('ON CONFLICT (operation_id) DO NOTHING');
  });
});
