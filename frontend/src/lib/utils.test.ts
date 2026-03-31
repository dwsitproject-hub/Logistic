import { describe, it, expect } from 'vitest';
import { formatNumber, formatRupiah, toKgFromMt, formatKgFromMt } from './utils';

describe('formatNumber', () => {
  it('formats integers with grouping (positive)', () => {
    expect(formatNumber(1234567)).toBe('1,234,567');
  });

  it('respects maxFractionDigits', () => {
    expect(formatNumber(1.2345, { maxFractionDigits: 2 })).toBe('1.23');
  });

  it('null/empty/NaN returns 0 (negative edge)', () => {
    expect(formatNumber(null)).toBe('0');
    expect(formatNumber('')).toBe('0');
    expect(formatNumber('abc')).toBe('0');
  });
});

describe('formatRupiah', () => {
  it('prefixes Rp. and uses formatNumber (positive)', () => {
    expect(formatRupiah(1000)).toBe('Rp. 1,000');
  });

  it('non-finite becomes zero (negative)', () => {
    expect(formatRupiah(Number.NaN)).toBe('Rp. 0');
  });
});

describe('toKgFromMt and formatKgFromMt', () => {
  it('passes through numeric MT as display kg label (per current app semantics)', () => {
    expect(toKgFromMt(12.5)).toBe(12.5);
    expect(formatKgFromMt(12.5)).toBe('12.5 Kg');
  });

  it('invalid string becomes 0 (negative)', () => {
    expect(toKgFromMt('x')).toBe(0);
    expect(formatKgFromMt('x')).toBe('0 Kg');
  });
});
