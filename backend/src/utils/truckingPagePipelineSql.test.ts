import { describe, expect, it } from 'vitest';
import {
  normalizeTruckingPagePipelineStageParam,
  sqlTruckingPageHasEtaOrPlanning,
  sqlTruckingPagePipelineStageExpr,
  sqlTruckingPageUnplannedPredicate,
} from './truckingPagePipelineSql';

describe('truckingPagePipelineSql', () => {
  it('normalizes pipeline stage params', () => {
    expect(normalizeTruckingPagePipelineStageParam('planned')).toBe('PLANNED');
    expect(normalizeTruckingPagePipelineStageParam('ALL')).toBeNull();
    expect(normalizeTruckingPagePipelineStageParam('LOADING')).toBeNull();
  });

  it('includes ETA and daily planning in hasEtaOrPlanning', () => {
    const sql = sqlTruckingPageHasEtaOrPlanning('t');
    expect(sql).toContain('daily_deliverables');
    expect(sql).toContain('eta_trucking_start_date');
    expect(sql).not.toContain('t.trucking_start_date');
    expect(sql).not.toContain('t.trucking_completion_date');
  });

  it('uses SAP receive dates for completion before UNPLANNED', () => {
    const sql = sqlTruckingPagePipelineStageExpr('c', 'sto.sto');
    expect(sql).toContain('Trucking Last Receive Date');
    expect(sql).toContain("'COMPLETED'");
    expect(sql).toMatch(/WHEN.*COMPLETED.*WHEN.*UNPLANNED/s);
  });

  it('builds pipeline stage with IN_PROGRESS daily planning + start receive', () => {
    const sql = sqlTruckingPagePipelineStageExpr('c', 'sto.sto');
    expect(sql).toContain("'IN_PROGRESS'");
    expect(sql).toContain('realization_start_date');
    expect(sql).toContain("'PLANNED'");
    expect(sql).toContain("'UNPLANNED'");
    expect(sql).toContain("'CANCELLED'");
  });

  it('does not classify closed contracts as UNPLANNED in the fallback branch', () => {
    const sql = sqlTruckingPagePipelineStageExpr('c', 'sto.sto');
    expect(sql).not.toMatch(/ELSE 'UNPLANNED'/);
    expect(sql).not.toMatch(/ELSE CASE[\s\S]*'UNPLANNED'/);
    expect(sql).toContain("ELSE 'COMPLETED'");
  });

  it('requires open SAP contract/PO for Unplanned predicate (STO not required)', () => {
    const sql = sqlTruckingPageUnplannedPredicate('c', 'sto.sto');
    expect(sql).toContain('NOT (');
    expect(sql).toContain("'CLOSE'");
    expect(sql).not.toContain('sto.sto IS NOT NULL');
    expect(sql).toContain('eta_trucking_start_date');
  });
});
