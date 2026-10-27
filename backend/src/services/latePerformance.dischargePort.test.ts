import { describe, expect, it } from 'vitest';
import { query } from '../database/connection';
import { buildContractGrainDischargePortFilter } from '../utils/shipmentDischargePortSql';
import { parseLatePerformanceFilters } from './latePerformance.service';

const parse = (q: Record<string, unknown>) => parseLatePerformanceFilters({ query: q } as never, 'all');

/**
 * Contract Performance Discharge Port filter, cards + tree side: how the request is read, and that the row cache cannot serve one pick's rows for another.
 * ROW_CACHE is keyed by an explicit field list (buildCacheKey), so a filter left out of it returns another filter's rows for five minutes.
 */
describe('late-performance: the dischargePort param', () => {
  it('reads a single value or a repeated param, trimmed, and nothing when absent', () => {
    expect(parse({}).dischargePorts).toEqual([]);
    expect(parse({ dischargePort: 'PORT BONTANG' }).dischargePorts).toEqual(['PORT BONTANG']);
    expect(parse({ dischargePort: [' PORT BONTANG ', 'PORT BATAM', ''] }).dischargePorts).toEqual(['PORT BONTANG', 'PORT BATAM']);
  });

  it('applies whatever the scope is: unlike plants (scope=filtered only), like the supplier filters', () => {
    for (const scope of ['ytd', 'filtered', undefined]) {
      expect(parse({ scope, dischargePort: 'PORT BONTANG' }).dischargePorts).toEqual(['PORT BONTANG']);
    }
  });

  it('a pick changes the cache key; order, case and spacing of the same picks do not', () => {
    const none = parse({}).cacheKey;
    const bontang = parse({ dischargePort: 'PORT BONTANG' }).cacheKey;
    const batam = parse({ dischargePort: 'PORT BATAM' }).cacheKey;
    expect(bontang).not.toBe(none);
    expect(bontang).not.toBe(batam);
    expect(parse({ dischargePort: ['PORT BATAM', 'PORT BONTANG'] }).cacheKey).toBe(parse({ dischargePort: ['port bontang', ' PORT BATAM'] }).cacheKey);
  });
});

describe('the per-contract predicate RUNS against the database', () => {
  it('is valid SQL on contracts, for a real Master Port, and selects a subset of what is listed', async () => {
    const port = await query(`SELECT port FROM master_loading_ports WHERE port IS NOT NULL ORDER BY (port ILIKE 'PORT BONTANG') DESC, port LIMIT 1`);
    const label = String(port.rows[0]?.port ?? '');
    if (!label) return;
    const f = buildContractGrainDischargePortFilter([label], 1, 'c.contract_id');
    expect(f.sql).not.toBe('');
    const all = await query(`SELECT COUNT(*)::int AS n FROM (SELECT contract_id FROM contracts WHERE contract_id IS NOT NULL ORDER BY contract_id LIMIT 300) c`);
    const hit = await query(
      `SELECT COUNT(*)::int AS n FROM (SELECT contract_id FROM contracts WHERE contract_id IS NOT NULL ORDER BY contract_id LIMIT 300) c WHERE (${f.sql})`,
      f.params,
    );
    expect(hit.rows[0].n).toBeLessThanOrEqual(all.rows[0].n);
  }, 120_000);

  it('a label that is no Master Port matches nothing (and there is no Blank to pick)', async () => {
    const f = buildContractGrainDischargePortFilter(['NO SUCH PORT ZZ'], 1, 'c.contract_id');
    const hit = await query(
      `SELECT COUNT(*)::int AS n FROM (SELECT contract_id FROM contracts WHERE contract_id IS NOT NULL ORDER BY contract_id LIMIT 300) c WHERE (${f.sql})`,
      f.params,
    );
    expect(hit.rows[0].n).toBe(0);
  }, 120_000);
});
