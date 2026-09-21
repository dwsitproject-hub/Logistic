import { describe, expect, it } from 'vitest';
import {
  buildShippingPerformanceBacklogSql,
  buildShippingPerformanceSql,
} from './shippingPerformance.service';
import { sqlRegionSiteDisplayForContract } from '../utils/regionSiteSql';
import { query } from '../database/connection';

/**
 * Region/Site is one dimension with one definition, and this page kept its own spelling of it.
 *
 * The chain it used - b2b_end, then a per-shipment SAP aggregate, then the latest-SPD CTE - was
 * argued to be branch-for-branch equivalent to sqlRegionSiteRawForContract, and it measured as
 * equivalent. "Equivalent today" is exactly how two spellings of one rule drift: the per-shipment
 * branch put five contracts under a destination their own SAP rows contradict, and the backlog arm
 * shipped with no B2B overlay at all, filing contract 9114100050 at TANJUNG PURA while every other
 * surface in KLIP said BATAM.
 *
 * So the assertion is not "it normalises" or "it mentions b2b_end". It is that both arms emit the
 * SAME EXPRESSION the shared helper emits - the one Shipments, Trucking, Pipeline and both
 * unplanned hybrids already call. That cannot drift without failing here.
 */
/*
 * The aliases are the CTE's, not the row query's: the helper is evaluated once per CONTRACT in
 * perf_region_site rather than once per row. Splicing it into the row projection instead ran it
 * 2,213 times for a value that varies per contract and took the page from 52s to 96.8s.
 */
const SHARED = sqlRegionSiteDisplayForContract('c_rs.contract_id', 'c_rs.po_number');

describe('Shipping Performance files a contract under the same site as every other page', () => {
  it('uses the shared helper verbatim on the main query', async () => {
    const sql = await buildShippingPerformanceSql();
    expect(sql).toContain(SHARED);
    // ...and reads it from the CTE, so it is paid once per contract, not once per row.
    expect(sql).toContain('perf_region_site AS MATERIALIZED');
    expect(sql).toContain("COALESCE(rs.plant_site, 'Blank') AS plant_site");
  });

  it('uses the shared helper verbatim on the backlog arm', async () => {
    const sql = await buildShippingPerformanceBacklogSql();
    expect(sql).toContain(SHARED);
    expect(sql).toContain("COALESCE(rs.plant_site, 'Blank') AS plant_site");
  });

  /*
   * The per-shipment source, gone for good. A shipment's STO can belong to several contracts that
   * SAP gives different discharge destinations (96 STOs database-wide; 1016010337 is KARAWANG on
   * four contracts and BEKASI on two), and rows are grouped by STO afterwards, so one row's value
   * survived for all of them.
   */
  it('never takes the destination from a per-shipment aggregate', async () => {
    expect(await buildShippingPerformanceSql()).not.toContain('sa.discharge_destination');
  });

  /* The KIJING -> TANJUNG PURA map must still reach both arms - now via the helper. */
  it('still carries the alias into both arms', async () => {
    expect(await buildShippingPerformanceSql()).toContain('KIJING');
    expect(await buildShippingPerformanceBacklogSql()).toContain('KIJING');
  });

  /*
   * A correct string proves nothing about whether the query runs - this page went down once on
   * exactly that gap. EXPLAIN plans without executing: the real query takes ~52s and has OOMed
   * the database.
   */
  it('still plans - the SQL is valid, not just correctly spelled', async () => {
    const sql = await buildShippingPerformanceSql();
    await expect(query(`EXPLAIN ${sql}`)).resolves.toBeTruthy();
  }, 120_000);

  it('the backlog arm still runs', async () => {
    const sql = await buildShippingPerformanceBacklogSql();
    await expect(query(`SELECT COUNT(*)::int AS n FROM (${sql}) q`)).resolves.toBeTruthy();
  }, 120_000);
});
