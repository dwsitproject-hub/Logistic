import { describe, expect, it } from 'vitest';
import {
  TRUCKING_SECTION1_AGGREGATE_CTES,
  buildTruckingSection1FilteredCteFromExpansion,
  buildTruckingSection1FromSnapshotQuery,
  buildTruckingSection1Sql,
  buildTruckingStatusSummaryCombinedQuery,
} from './truckingStatusSummaryCombinedSql';

/**
 * Section 1 has two sources now - the live STO expansion (~35s) and the precomputed rows in
 * trucking_list_stage_snapshot (70ms). They agreed exactly when measured, 0 of 22 figures
 * differing, but only because everything above `filtered` is one shared string.
 *
 * The first attempt at this precomputed *aggregates* per dimension row instead, and the dedup key
 * broke: `contract_number` in the trucking expansion is a STRING_AGG of every LAND contract
 * sharing the STO, so MAX(contract_qty) has to be taken over the whole group. Grouping finer put
 * 7 of 13 figures wrong - completed contract qty by +2,018,490 kg - while every status count
 * stayed correct, because counting rows is additive at any grain and quantities are not. Nothing
 * failed; the numbers were simply wrong.
 *
 * These tests exist so that cannot come back quietly.
 */
const BUILT = {
  preOuterQuery: 'SELECT 1 AS x',
  outerSql: '',
  innerParams: ['a'],
  outerParams: [],
  skipSapJoin: false,
};

describe('Section 1 shares its aggregates across both sources', () => {
  it('the snapshot query embeds the shared aggregate block verbatim', () => {
    const sql = buildTruckingSection1FromSnapshotQuery({
      tableName: 'trucking_list_stage_snapshot',
      whereSql: 'WHERE contract_date >= $1',
    });
    expect(sql).toContain(TRUCKING_SECTION1_AGGREGATE_CTES);
  });

  it('the live query embeds the same block, so neither can drift', () => {
    const { text } = buildTruckingStatusSummaryCombinedQuery(BUILT, { includeCounts: false });
    expect(text).toContain(TRUCKING_SECTION1_AGGREGATE_CTES);
  });

  it('both sources produce the identical outer SELECT', () => {
    /* Same CTE block name in, same projection out - the parsers read these by name. */
    const a = buildTruckingSection1Sql('filtered AS (SELECT 1)', false);
    const b = buildTruckingSection1Sql('filtered AS (SELECT 2)', false);
    const strip = (s: string) => s.replace(/filtered AS \(SELECT \d\)/, 'X');
    expect(strip(a)).toBe(strip(b));
  });

  it('the two filtered CTEs expose the same columns, in the same order', () => {
    const fromExpansion = buildTruckingSection1FilteredCteFromExpansion(BUILT);
    const fromSnapshot = buildTruckingSection1FromSnapshotQuery({
      tableName: 't',
      whereSql: 'WHERE TRUE',
    });
    /*
     * The aggregate block reads these by name, so a missing or renamed one is a runtime error at
     * best and a silently wrong figure at worst.
     */
    for (const col of [
      'status',
      'status_db',
      'contract_number',
      'contract_qty',
      'outstanding_quantity',
      'source_type',
      'incoterm',
    ]) {
      expect(fromExpansion, `expansion filtered is missing ${col}`).toContain(col);
      expect(fromSnapshot, `snapshot filtered is missing ${col}`).toContain(col);
    }
  });

  it('the snapshot source dedups on the whole contract_number, never per dimension', () => {
    const sql = buildTruckingSection1FromSnapshotQuery({ tableName: 't', whereSql: 'WHERE TRUE' });
    // The grouping that makes the quantities right.
    expect(sql).toContain('GROUP BY status, contract_number');
    // And never a dimension in that grouping - that is precisely what inflated the totals.
    expect(sql).not.toContain('GROUP BY group_plant');
    expect(sql).not.toContain('contract_date, product, incoterm, status, contract_number');
  });

  it('the snapshot source applies the same sap_presence predicate as live', () => {
    const fromSnapshot = buildTruckingSection1FromSnapshotQuery({
      tableName: 't',
      whereSql: 'WHERE TRUE',
    });
    const fromExpansion = buildTruckingSection1FilteredCteFromExpansion(BUILT);
    /*
     * A cancelled or deleted PO must not count towards the cards even though the list still shows
     * it. The live form reads it off the expanded row, so the snapshot stores that column rather
     * than approximating it from the contract.
     */
    expect(fromExpansion).toContain("sap_presence, 'PRESENT') = 'PRESENT'");
    expect(fromSnapshot).toContain("sap_presence, 'PRESENT') = 'PRESENT'");
  });
});
