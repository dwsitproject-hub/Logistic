import { describe, expect, it } from 'vitest';
import {
  DISCHARGE_DESTINATION_ALIASES,
  normalizeDischargeDestination,
  sqlNormalizeDischargeDestination,
} from './dischargeDestinationAlias';
import { sapDischargeDestinationFromJson } from './sapTruckingLoadingLocationSql';
import {
  filterRegionSiteOptionValues,
  sqlRegionSiteRawFromJsonAndB2b,
} from './regionSiteSql';
import { sqlB2bEndingDischargeDestExpr } from './b2bOriginEndingSql';

/**
 * SAP's Discharge Destination `KIJING` is the port for the Tanjung Pura plants, which
 * master_plants already groups as 'Tanjung Pura'. Requested 2026-09-08 as a *normalisation*, not
 * a display rename: SAP is expected to start emitting TANJUNG PURA itself, and both must then
 * collapse into one Region/Site rather than splitting the volume across two filter entries.
 */
describe('normalizeDischargeDestination', () => {
  it('maps KIJING to TANJUNG PURA regardless of case or padding', () => {
    expect(normalizeDischargeDestination('KIJING')).toBe('TANJUNG PURA');
    expect(normalizeDischargeDestination('kijing')).toBe('TANJUNG PURA');
    expect(normalizeDischargeDestination('  Kijing  ')).toBe('TANJUNG PURA');
  });

  it('is idempotent, so a future SAP-supplied TANJUNG PURA merges instead of splitting', () => {
    expect(normalizeDischargeDestination('TANJUNG PURA')).toBe('TANJUNG PURA');
    expect(normalizeDischargeDestination(normalizeDischargeDestination('KIJING'))).toBe('TANJUNG PURA');
  });

  it('leaves every other destination untouched', () => {
    for (const other of ['BONTANG', 'LUBUK GAUNG', 'KARAWANG', 'TANJUNG MORAWA', 'TANJUNG BUTON']) {
      expect(normalizeDischargeDestination(other)).toBe(other);
    }
  });

  it('passes empty and missing values straight through', () => {
    expect(normalizeDischargeDestination('')).toBe('');
    expect(normalizeDischargeDestination('   ')).toBe('');
    expect(normalizeDischargeDestination(null)).toBe('');
    expect(normalizeDischargeDestination(undefined)).toBe('');
  });
});

describe('sqlNormalizeDischargeDestination', () => {
  it('emits a plain CASE, not a per-row subquery', () => {
    const sql = sqlNormalizeDischargeDestination('col');
    expect(sql).toContain("WHEN UPPER(TRIM(col)) = 'KIJING' THEN 'TANJUNG PURA'");
    expect(sql).toContain('ELSE col');
    expect(sql).not.toContain('SELECT');
  });

  it('does not emit a WHEN for a value that already maps to itself', () => {
    const sql = sqlNormalizeDischargeDestination('col');
    expect((sql.match(/WHEN /g) || []).length).toBe(
      Object.entries(DISCHARGE_DESTINATION_ALIASES).filter(([f, t]) => f !== t.toUpperCase()).length,
    );
  });
});

describe('the alias reaches every Region/Site path', () => {
  it('applies where the value is extracted from SAP JSON', () => {
    expect(sapDischargeDestinationFromJson('l.data')).toContain("'TANJUNG PURA'");
  });

  it('applies to the stored b2b_ending_child copy as well as the SAP JSON', () => {
    const raw = sqlRegionSiteRawFromJsonAndB2b('l.data');
    expect((raw.match(/TANJUNG PURA/g) || []).length).toBeGreaterThanOrEqual(2);
    expect(sqlB2bEndingDischargeDestExpr("'x'")).toContain("'TANJUNG PURA'");
  });

  it('collapses KIJING and TANJUNG PURA to one filter option', () => {
    expect(filterRegionSiteOptionValues(['KIJING', 'TANJUNG PURA', 'BONTANG'])).toEqual([
      'TANJUNG PURA',
      'BONTANG',
    ]);
  });

  it('still resolves a bookmarked plant=KIJING to the Tanjung Pura group', () => {
    expect(filterRegionSiteOptionValues(['KIJING'])).toEqual(['TANJUNG PURA']);
  });

  it('keeps dropping the Blank sentinel', () => {
    expect(filterRegionSiteOptionValues(['Blank', 'blank', '', 'KIJING'])).toEqual(['TANJUNG PURA']);
  });
});
