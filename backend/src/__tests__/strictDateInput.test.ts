import { describe, it, expect } from 'vitest';
import {
  InvalidDateInputError,
  escapeIlikePattern,
  likeContainsPattern,
  parseEventAtInput,
  parseOptionalStrictDateOnly,
  parseOptionalStrictDateRange,
  sqlIlikeParam,
} from '../utils/strictDateInput';
import { appendGlobalSearchBase, appendColumnFiltersBase } from '../utils/contractListFilters';

describe('strictDateInput', () => {
  it('accepts valid YYYY-MM-DD', () => {
    expect(parseOptionalStrictDateOnly('2026-08-06', 'dateTo')).toBe('2026-08-06');
  });

  it('rejects ZAP-style dateTo suffix %', () => {
    expect(() => parseOptionalStrictDateOnly('2026-08-06%', 'dateTo')).toThrow(InvalidDateInputError);
  });

  it('rejects non-calendar dates', () => {
    expect(() => parseOptionalStrictDateOnly('2026-02-31', 'dateTo')).toThrow(InvalidDateInputError);
  });

  it('treats empty as undefined', () => {
    expect(parseOptionalStrictDateOnly('', 'dateFrom')).toBeUndefined();
    expect(parseOptionalStrictDateOnly(undefined, 'dateFrom')).toBeUndefined();
  });

  it('parses date range from query-like object', () => {
    expect(
      parseOptionalStrictDateRange({ dateFrom: '2026-01-01', dateTo: '2026-08-06' }),
    ).toEqual({ dateFrom: '2026-01-01', dateTo: '2026-08-06' });
  });
});

describe('parseEventAtInput', () => {
  it('accepts ISO timestamps', () => {
    const r = parseEventAtInput('2026-08-06T03:50:35.138Z');
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') {
      expect(Date.parse(r.value)).not.toBeNaN();
    }
  });

  it('rejects ZAP-style eventAt with %', () => {
    expect(parseEventAtInput('2026-08-06T03:50:35.138Z%').kind).toBe('invalid');
  });

  it('omits empty', () => {
    expect(parseEventAtInput(null).kind).toBe('omit');
    expect(parseEventAtInput('').kind).toBe('omit');
  });
});

describe('ILIKE escape', () => {
  it('escapes metacharacters', () => {
    expect(escapeIlikePattern('a%b_c\\d')).toBe('a\\%b\\_c\\\\d');
    expect(likeContainsPattern('100%')).toBe('%100\\%%');
  });

  it('sqlIlikeParam includes ESCAPE clause', () => {
    expect(sqlIlikeParam(3)).toContain('ILIKE $3');
    expect(sqlIlikeParam(3)).toMatch(/ESCAPE/);
  });

  it('global search uses escaped contains pattern', () => {
    const r = appendGlobalSearchBase('acme%', 1);
    expect(r.params).toEqual([likeContainsPattern('acme%')]);
    expect(r.sql).toMatch(/ESCAPE/);
  });

  it('column text filter wraps escaped ILIKE value', () => {
    const p = "acme' OR supplier IS NOT NULL OR '";
    const r = appendColumnFiltersBase({ supplier: { type: 'text', value: p } }, 3);
    expect(r.params).toEqual([likeContainsPattern(p)]);
    expect(r.sql).not.toContain('OR supplier');
    expect(r.sql).toMatch(/ESCAPE/);
  });
});
