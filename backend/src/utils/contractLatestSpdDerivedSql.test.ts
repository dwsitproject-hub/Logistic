import { describe, expect, it } from 'vitest';
import {
  LATEST_SPD_DERIVED_COLUMNS,
  latestSpdDerivedExprs,
  latestSpdDerivedSelectList,
} from './contractLatestSpdDerivedSql';
import { buildUnplannedContractBacklogLatestSpdCte } from './shipmentUnplannedHybridSql';
import {
  buildContractLatestSpdSnapshotRefreshSql,
  buildContractLatestSpdSnapshotUpsertSql,
} from './contractLatestSpdSql';

/**
 * Migration 161 stores six derived values on contract_latest_spd_snapshot, and the live fallback
 * computes the same six. If the stored column and the expression behind it ever drift apart, the
 * page shows wrong data with nothing failing - so these tests assert both sides read one
 * definition, and that every column is actually written and actually read.
 */
describe('latest_spd derived columns', () => {
  it('has one expression per stored column, and no extras', () => {
    const exprs = latestSpdDerivedExprs('d', 's');
    expect(Object.keys(exprs).sort()).toEqual([...LATEST_SPD_DERIVED_COLUMNS].sort());
  });

  it('the select list aliases every column exactly once', () => {
    const sql = latestSpdDerivedSelectList('spd.data', 'spd.sto_number');
    for (const col of LATEST_SPD_DERIVED_COLUMNS) {
      expect(sql.split(` AS ${col}`).length - 1).toBe(1);
    }
  });

  it('effective_sto reads the sto_number column first, then the JSON arms', () => {
    const sql = latestSpdDerivedExprs('spd.data', 'spd.sto_number').effective_sto;
    expect(sql.indexOf('spd.sto_number')).toBeLessThan(sql.indexOf("->'raw'->>'STO No.'"));
  });

  it('the snapshot refresh writes every derived column', () => {
    for (const sql of [
      buildContractLatestSpdSnapshotRefreshSql(),
      buildContractLatestSpdSnapshotUpsertSql(),
    ]) {
      for (const col of LATEST_SPD_DERIVED_COLUMNS) {
        // once in the INSERT column list, once in the ON CONFLICT SET
        expect(sql).toContain(col);
        expect(sql).toContain(`${col} = EXCLUDED.${col}`);
      }
      // The refresh reads live SAP rows, so the real sto_number column is available there.
      expect(sql).toContain('spd.sto_number');
    }
  });

  it('the fresh-snapshot CTE reads the stored columns and touches no jsonb', () => {
    const sql = buildUnplannedContractBacklogLatestSpdCte(true);
    for (const col of LATEST_SPD_DERIVED_COLUMNS) {
      expect(sql).toContain(`lss.${col}`);
    }
    // The whole point: 26 `data->` accesses per row become none.
    expect(sql).not.toContain('->');
    expect(sql).not.toContain('sap_processed_data');
  });

  it('the live CTE computes the same columns from the shared expressions', () => {
    const sql = buildUnplannedContractBacklogLatestSpdCte(false);
    expect(sql).toContain('sap_processed_data spd');
    for (const col of LATEST_SPD_DERIVED_COLUMNS) {
      expect(sql).toContain(` AS ${col}`);
    }
    // Ties on created_at must be broken, or the two forms pick different SAP rows.
    expect(sql).toContain('spd.id DESC');
  });
});
