import { describe, expect, it } from 'vitest';
import {
  appendTruckingPipelineStageFilter,
  buildTruckingExpandedStatusFilterWhere,
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

  it('completes from GR Close or OS tolerance', () => {
    const sql = sqlTruckingPagePipelineStageExpr('c', 'sto.sto');
    expect(sql).not.toContain('Trucking Last Receive Date');
    expect(sql).toContain("'COMPLETED'");
    expect(sql).toContain(' OR ');
    expect(sql).toMatch(/WHEN.*COMPLETED.*WHEN.*UNPLANNED/s);
  });

  it('builds pipeline stage: Start Receive alone → IN_PROGRESS (no daily planning required)', () => {
    const sql = sqlTruckingPagePipelineStageExpr('c', 'sto.sto');
    expect(sql).toContain("'IN_PROGRESS'");
    expect(sql).toContain('realization_start_date');
    expect(sql).toContain("'PLANNED'");
    expect(sql).toContain("'UNPLANNED'");
    expect(sql).toContain("'CANCELLED'");
    // IN_PROGRESS is gated on realization start, not daily_deliverables AND start.
    const inProgressWhen = sql.match(
      /WHEN\s+([\s\S]*?)\s+THEN\s+'IN_PROGRESS'/,
    );
    expect(inProgressWhen?.[1] ?? '').toContain('realization_start_date');
    expect(inProgressWhen?.[1] ?? '').not.toContain('daily_deliverables');
  });

  it('does not classify non-completed closed rows as UNPLANNED in the fallback branch', () => {
    const sql = sqlTruckingPagePipelineStageExpr('c', 'sto.sto');
    expect(sql).not.toMatch(/ELSE 'COMPLETED'/);
    expect(sql).toContain("ELSE CASE");
    expect(sql).toContain("'IN_PROGRESS'");
  });

  it('requires open SAP contract/PO for Unplanned predicate (STO not required; excludes Start Receive)', () => {
    const sql = sqlTruckingPageUnplannedPredicate('c', 'sto.sto');
    expect(sql).toContain('NOT (');
    expect(sql).toContain("'CLOSE'");
    expect(sql).not.toContain('sto.sto IS NOT NULL');
    expect(sql).toContain('eta_trucking_start_date');
    expect(sql).toContain('realization_start_date');
  });

  it('Planned card list filter includes PLANNED and IN_PROGRESS', () => {
    const planned = appendTruckingPipelineStageFilter('PLANNED', 'sto.sto', 5);
    expect(planned.sql).toContain("IN ('PLANNED', 'IN_PROGRESS')");
    expect(planned.params).toEqual([]);
    expect(planned.nextIndex).toBe(5);

    const inProg = appendTruckingPipelineStageFilter('IN_PROGRESS', 'sto.sto', 5);
    expect(inProg.sql).toMatch(/=\s*\$5/);
    expect(inProg.params).toEqual(['IN_PROGRESS']);
    expect(inProg.nextIndex).toBe(6);

    const scoped = buildTruckingExpandedStatusFilterWhere('tf.status', 'PLANNED', 3);
    expect(scoped.sql).toContain("IN ('PLANNED', 'IN_PROGRESS')");
    expect(scoped.params).toEqual([]);
  });
});
