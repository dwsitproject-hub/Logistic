import { describe, it, expect } from 'vitest';
import {
  formatNumber,
  formatRupiah,
  toKgFromMt,
  formatKgFromMt,
  formatQtyMtFromKg,
  formatOutstandingQtyMtFromKg,
  outstandingQtyMtColorClass,
} from './utils';

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

describe('formatQtyMtFromKg', () => {
  it('formats kg as whole MT', () => {
    expect(formatQtyMtFromKg(1000)).toBe('1 MT');
    expect(formatQtyMtFromKg(1_500_000)).toBe('1,500 MT');
  });

  it('shows 0 MT for null, empty, or non-finite qty', () => {
    expect(formatQtyMtFromKg(null)).toBe('0 MT');
    expect(formatQtyMtFromKg(undefined)).toBe('0 MT');
    expect(formatQtyMtFromKg('')).toBe('0 MT');
    expect(formatQtyMtFromKg('abc')).toBe('0 MT');
  });
});

describe('formatOutstandingQtyMtFromKg', () => {
  it('shows +MT for over-delivery (negative kg), rounded to whole MT by default', () => {
    expect(formatOutstandingQtyMtFromKg(-2500)).toBe('+3 MT');
  });

  it('shows MT without minus for remaining outstanding (positive kg), rounded by default', () => {
    expect(formatOutstandingQtyMtFromKg(1500)).toBe('2 MT');
  });

  it('shows zero MT for fully delivered or missing qty', () => {
    expect(formatOutstandingQtyMtFromKg(0)).toBe('0 MT');
    expect(formatOutstandingQtyMtFromKg(null)).toBe('0 MT');
    expect(formatOutstandingQtyMtFromKg(undefined)).toBe('0 MT');
    expect(outstandingQtyMtColorClass(null)).toBe('text-gray-500');
  });

  it('supports decimal display when maxFractionDigits is passed', () => {
    expect(formatOutstandingQtyMtFromKg(1500, { maxFractionDigits: 2 })).toBe('1.5 MT');
    expect(formatOutstandingQtyMtFromKg(-2500, { maxFractionDigits: 2 })).toBe('+2.5 MT');
  });

  it('treats sub-MT residuals that round to 0 as plain 0 MT (no + / no green)', () => {
    // PO 1381002386 pattern: contract 112000 − receive 112060 = −60 kg → −0.06 MT
    expect(formatOutstandingQtyMtFromKg(-60)).toBe('0 MT');
    expect(formatOutstandingQtyMtFromKg(60)).toBe('0 MT');
    expect(outstandingQtyMtColorClass(-60)).toBe('text-gray-500');
    expect(outstandingQtyMtColorClass(60)).toBe('text-gray-500');
  });

  it('keeps green +MT when rounded whole MT is still non-zero over-delivery', () => {
    expect(formatOutstandingQtyMtFromKg(-1000)).toBe('+1 MT');
    expect(outstandingQtyMtColorClass(-1000)).toBe('text-green-600');
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
