import { describe, expect, it } from 'vitest';
import { PRODUCT_ALIASES, canonicalProductName } from './productAlias';

describe('canonicalProductName', () => {
  it('collapses WASTE OIL (POME) and the bracket-cut spelling into POME', () => {
    expect(canonicalProductName('WASTE OIL (POME)')).toBe('POME');
    expect(canonicalProductName('WASTE OIL (POME')).toBe('POME');
    expect(canonicalProductName('POME')).toBe('POME');
  });

  it('ignores case and surrounding spaces', () => {
    expect(canonicalProductName('  pome ')).toBe('POME');
    expect(canonicalProductName('Waste Oil (Pome)')).toBe('POME');
  });

  it('is idempotent', () => {
    const once = canonicalProductName('WASTE OIL (POME)');
    expect(canonicalProductName(once)).toBe(once);
    for (const target of Object.values(PRODUCT_ALIASES)) {
      expect(PRODUCT_ALIASES[target.toUpperCase()]).toBe(target);
    }
  });

  it('leaves other materials alone, including the ones that merely contain POME', () => {
    for (const other of ['CPO', 'PK', 'SHELL PALM', 'RPOME', 'INS POME', 'WASTE OIL (PFAD)', 'CRUDE POME']) {
      expect(canonicalProductName(other)).toBe(other);
    }
  });

  it('returns null, undefined and blank untouched so COALESCE(new, old) keeps working', () => {
    expect(canonicalProductName(null)).toBeNull();
    expect(canonicalProductName(undefined)).toBeUndefined();
    expect(canonicalProductName('')).toBe('');
    expect(canonicalProductName(42)).toBe(42);
  });
});
