import { describe, expect, it } from 'vitest';
import { sapDischargeDestinationFromJson } from './sapTruckingLoadingLocationSql';
import {
  appendRegionSiteFilter,
  filterRegionSiteOptionValues,
  REGION_SITE_FILTER_OPTIONS_SQL,
  regionSiteDisplayExpr,
  sapDischargeDestinationFromAlias,
  sqlRegionSiteDisplayFromJsonAndB2b,
  sqlRegionSiteRawFromJsonAndB2b,
} from './regionSiteSql';

describe('regionSiteSql', () => {
  it('reads Discharge Destination from shipment, raw, and top-level JSON paths', () => {
    const sql = sapDischargeDestinationFromJson('spd.data');
    expect(sql).toContain("shipment'->>'discharge_destination'");
    expect(sql).toContain("'Discharge Destination'");
    expect(sql).toContain("->>'discharge_destination'");
    expect(sapDischargeDestinationFromAlias('l')).toContain('l.data');
  });

  it('trims empty dest to display Blank', () => {
    expect(regionSiteDisplayExpr("spd.dest")).toContain("'Blank'");
    expect(regionSiteDisplayExpr("spd.dest")).toContain('NULLIF(TRIM(spd.dest), \'\')');
  });

  it('overlays B2B child destinasi on origin JSON dest', () => {
    const raw = sqlRegionSiteRawFromJsonAndB2b('l.data');
    expect(raw).toContain('b2b_end.discharge_destination');
    expect(raw).toContain('l.data');
    expect(sqlRegionSiteDisplayFromJsonAndB2b('l.data')).toContain("'Blank'");
  });

  it('filter options SQL is DISTINCT destinasi and excludes Blank/empty', () => {
    expect(REGION_SITE_FILTER_OPTIONS_SQL).toContain('sap_processed_data');
    expect(REGION_SITE_FILTER_OPTIONS_SQL).toContain('GROUP BY UPPER(dest)');
    expect(REGION_SITE_FILTER_OPTIONS_SQL).not.toContain('master_plants');
    expect(REGION_SITE_FILTER_OPTIONS_SQL).not.toContain("'Blank'");
  });

  it('strips Blank, empty, and whitespace from option values and collapses case', () => {
    expect(filterRegionSiteOptionValues(['BONTANG', 'Blank', '', '  ', 'bontang', 'Tarakan'])).toEqual([
      'BONTANG',
      'Tarakan',
    ]);
  });

  it('matches BONTANG dest and does not match empty dest or unselected sites', () => {
    const { sql, params, nextIndex } = appendRegionSiteFilter(['BONTANG', 'Blank'], 3, 'base.plant_site');
    expect(sql).toContain('UPPER(NULLIF(TRIM(base.plant_site), \'Blank\'))');
    expect(sql).toContain('UPPER($3)');
    expect(params).toEqual(['BONTANG']);
    expect(params).not.toContain('Blank');
    expect(nextIndex).toBe(4);
  });

  it('empty filter returns all rows including destinasi kosong', () => {
    const empty = appendRegionSiteFilter([], 1, 'base.plant_site');
    expect(empty.sql).toBe('');
    expect(empty.params).toEqual([]);
    expect(empty.nextIndex).toBe(1);
  });
});
