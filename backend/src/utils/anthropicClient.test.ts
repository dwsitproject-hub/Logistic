import { describe, expect, it } from 'vitest';
import { extractJsonObject, normalizePatternKey, shiftIsoDate } from './anthropicClient';

describe('anthropicClient', () => {
  it('extractJsonObject parses raw JSON', () => {
    expect(extractJsonObject('{"avg_transit_days":12}')).toEqual({ avg_transit_days: 12 });
  });

  it('extractJsonObject parses fenced JSON', () => {
    expect(extractJsonObject('```json\n{"suggested_vessel_name":"MV TEST"}\n```')).toEqual({
      suggested_vessel_name: 'MV TEST',
    });
  });

  it('normalizePatternKey uppercases trimmed text', () => {
    expect(normalizePatternKey('  cpo  ')).toBe('CPO');
  });

  it('shiftIsoDate adds calendar days', () => {
    expect(shiftIsoDate('2026-01-01', 3)).toBe('2026-01-04');
  });
});
