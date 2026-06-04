import { describe, it, expect } from 'vitest';
import {
  parseColumnFiltersQuery,
  appendGlobalSearchBase,
  appendColumnFiltersBase,
} from './contractListFilters';

describe('parseColumnFiltersQuery', () => {
  it('empty inputs', () => {
    expect(parseColumnFiltersQuery(null)).toEqual({});
    expect(parseColumnFiltersQuery(undefined)).toEqual({});
    expect(parseColumnFiltersQuery('')).toEqual({});
  });

  it('object passthrough', () => {
    const o = { product: { type: 'text', value: 'foo' } };
    expect(parseColumnFiltersQuery(o)).toBe(o);
  });

  it('JSON string ok', () => {
    const json = JSON.stringify({ supplier: { type: 'text', value: 'ACME' } });
    expect(parseColumnFiltersQuery(json)).toEqual({
      supplier: { type: 'text', value: 'ACME' },
    });
  });

  it('bad JSON', () => {
    expect(parseColumnFiltersQuery('{bad')).toEqual({});
  });
});

describe('appendGlobalSearchBase', () => {
  it('short search no sql', () => {
    expect(appendGlobalSearchBase('a', 1).sql).toBe('');
  });

  it('param not inlined', () => {
    const r = appendGlobalSearchBase('ab', 5);
    expect(r.params).toEqual(['ab']);
    expect(r.sql).toContain('$5::text');
    expect(r.sql).not.toContain('ab');
  });

  it('injection as param', () => {
    const m = "x' OR 1=1; --";
    const r = appendGlobalSearchBase(m, 1);
    expect(r.params[0]).toBe(m);
    expect(r.sql).not.toContain('OR 1=1');
  });
});

describe('appendColumnFiltersBase', () => {
  it('unknown col ignored', () => {
    const r = appendColumnFiltersBase(
      { z: { type: 'text', value: 'v' } } as import('./contractListFilters').ColumnFilterPayload,
      1
    );
    expect(r.sql).toBe('');
  });

  it('supplier ILIKE', () => {
    const r = appendColumnFiltersBase({ supplier: { type: 'text', value: 'ACME' } }, 2);
    expect(r.params).toEqual(['%ACME%']);
    expect(r.nextIndex).toBe(3);
  });

  it('number min max', () => {
    const r = appendColumnFiltersBase(
      { contract_qty: { type: 'number', min: '10', max: '20' } },
      1
    );
    expect(r.params).toEqual([10, 20]);
  });

  it('chain indices', () => {
    const s = appendGlobalSearchBase('xx', 1);
    const c = appendColumnFiltersBase({ product: { type: 'text', value: 'p' } }, s.nextIndex);
    expect(c.sql).toContain('$2');
  });
});
