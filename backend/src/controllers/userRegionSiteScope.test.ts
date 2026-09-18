import { describe, expect, it } from 'vitest';
import { query } from '../database/connection';
import { canonicalizeUserRegionSites } from '../utils/userRegionSite';
import { buildMissingEtaAlertScopeClause } from '../utils/missingEtaAlertScopeSql';
import type { SessionUserPayload } from '../services/sessionAuth.service';

/**
 * The Users page picker has always listed SAP Discharge Destination - it reads
 * /contracts/filter-options/group-plants, which is REGION_SITE_FILTER_OPTIONS_SQL, the same list
 * the Region/Site dropdown on Shipments uses. The SAVE path then looked that choice up in
 * master_plants.group_plant, and those are two dimensions sharing 4 labels out of 14.
 *
 * The consequence was silent in both directions: LUBUK GAUNG, BATAM, KUMAI, PALEMBANG, BELAWAN,
 * TANJUNG MORAWA and TANGERANG matched nothing and were dropped with only a logger.warn, so that
 * user opened Shipments scoped to nothing; and BONTANG matched, stored the plant-dimension
 * spelling, and hid the Bontang plants' real work at MERAUKE, KUMAI and TRADING TRANSIT HO.
 */
describe('user Region/Site is stored in the dimension it is filtered in', () => {
  it('keeps a destination that master_plants has no group_plant for', () => {
    // The exact values the old save path dropped. canonicalizeUserRegionSites is all that stands
    // between the picker and the table now, so it must not filter on the plant dimension.
    const picked = ['LUBUK GAUNG', 'BATAM', 'KUMAI', 'PALEMBANG', 'TANJUNG MORAWA', 'TANGERANG'];
    expect(canonicalizeUserRegionSites(picked)).toEqual(picked);
  });

  it('still collapses case, duplicates and the KIJING alias', () => {
    expect(canonicalizeUserRegionSites(['Bontang', 'BONTANG', ' bontang '])).toEqual(['Bontang']);
    expect(canonicalizeUserRegionSites(['KIJING'])).toEqual(['TANJUNG PURA']);
    expect(canonicalizeUserRegionSites(['Blank', '', null])).toEqual([]);
  });

  it('has somewhere to store a value master_plants cannot represent', async () => {
    // Proves migration 177 ran and the column is text, not a foreign key. A string test would pass
    // against a table that does not exist.
    const cols = await query(
      `SELECT column_name, data_type FROM information_schema.columns
       WHERE table_name = 'user_region_sites' ORDER BY ordinal_position`,
    );
    const byName = new Map(cols.rows.map((r) => [String(r.column_name), String(r.data_type)]));
    expect(byName.get('region_site')).toBe('text');
    expect(byName.has('user_id')).toBe(true);
  });

  /*
   * The alert scope compared the user's labels against groupPlantExpr(c.plant_code, ...) - the
   * plant dimension - which was consistent only while the stored scope came from there too. Left
   * behind, it would have matched nothing and Staff would have silently stopped getting alerts.
   */
  it('scopes missing-ETA alerts by Region/Site, not by plant code', async () => {
    const user = {
      level: 'Staff',
      group_plants: ['LUBUK GAUNG'],
      products: [],
    } as unknown as SessionUserPayload;
    const clause = buildMissingEtaAlertScopeClause(user);

    expect(clause.sql).not.toContain('plant_code');
    expect(clause.params).toEqual(['LUBUK GAUNG']);

    // And it has to RUN against contracts, where c is the alias it assumes.
    await expect(
      query(`SELECT COUNT(*)::int AS n FROM contracts c WHERE TRUE${clause.sql}`, clause.params),
    ).resolves.toBeTruthy();
  }, 60_000);

  it('adds no clause for a non-Staff user', () => {
    const user = { level: 'Dept Head', group_plants: ['BONTANG'] } as unknown as SessionUserPayload;
    expect(buildMissingEtaAlertScopeClause(user)).toEqual({ sql: '', params: [] });
  });
});
