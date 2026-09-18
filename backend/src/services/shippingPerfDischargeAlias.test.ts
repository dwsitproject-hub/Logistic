import { describe, expect, it } from 'vitest';
import {
  buildShippingPerformanceBacklogSql,
  buildShippingPerformanceSql,
} from './shippingPerformance.service';
import { query } from '../database/connection';

/**
 * Region/Site normalises KIJING -> TANJUNG PURA. The rule (dischargeDestinationAlias.ts) is that
 * it is applied at the single SAP-JSON extraction point AND at every read of a STORED copy.
 * Shipping Performance read two stored copies raw - b2b_ending_child_snapshot on the main query
 * and contract_latest_spd_snapshot on the backlog arm - while the Shipments Region/Site filter
 * wraps the same column. Latent rather than harmless: the data holds 0 KIJING rows today only
 * because migrations 158/161 backfilled them, so the next row written by a path that does not
 * normalise would split one site into two on this page and not on Shipments.
 */
const wrapped = (expr: string) => `UPPER(TRIM(${expr})) = 'KIJING'`;

describe('Shipping Performance normalises the discharge destination it stores and reads', () => {
  it('wraps the stored b2b_ending_child copy on the main query', async () => {
    const sql = await buildShippingPerformanceSql();
    expect(sql).toContain(wrapped("NULLIF(TRIM(b2b_end.discharge_destination), '')"));
  });

  it('wraps the stored contract_latest_spd copy on the backlog arm', async () => {
    const sql = await buildShippingPerformanceBacklogSql();
    expect(sql).toContain(wrapped("NULLIF(TRIM(l.discharge_destination), '')"));
  });

  /*
   * Deliberately NOT wrapped, and the reason is cost rather than oversight: both come from
   * sapDischargeDestinationFromJson, which already applies the map. The alias compiles to a CASE
   * that reads its input TWICE, latest_spd_contract is NOT MATERIALIZED, and an inlined
   * l.discharge_destination is a jsonb extraction - doubling those is what took Contract
   * Performance 1,360ms -> 3,342ms. If this ever fails because someone wrapped them, check the
   * timing before accepting it.
   */
  it('does not wrap the two expressions that already normalise', async () => {
    const sql = await buildShippingPerformanceSql();
    expect(sql).not.toContain(wrapped("NULLIF(TRIM(sa.discharge_destination), '')"));
    expect(sql).not.toContain(wrapped("NULLIF(TRIM(l.discharge_destination), '')"));
  });

  /*
   * A correct string proves nothing about whether the query runs - this page went down once on
   * exactly that gap. EXPLAIN parses and plans without executing, which matters here: the real
   * query takes ~52s cold and has OOMed the database.
   */
  it('still plans - the SQL is valid, not just correctly spelled', async () => {
    const sql = await buildShippingPerformanceSql();
    await expect(query(`EXPLAIN ${sql}`)).resolves.toBeTruthy();
  }, 120_000);
});
