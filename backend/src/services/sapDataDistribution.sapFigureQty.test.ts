import { describe, expect, it } from 'vitest';
import { SapDataDistributionService } from './sapDataDistribution.service';

const parse = (...values: unknown[]): number | null => (SapDataDistributionService as any).parseSapFigureQtyKg(...values);

describe('a SFAL / SFBD quantity from SAP: zero is "no figure"', () => {
  it('a real quantity is read, with the thousands separators of the formatted sheet', () => {
    expect(parse('497,100.000')).toBe(497100);
    expect(parse('4,000,871.000')).toBe(4000871);
    expect(parse(500000)).toBe(500000);
    expect(parse('482950')).toBe(482950);
  });

  it('the zero the Phase 3 template sends on a row without a figure is none, whatever shape it arrives in (it was the text "0.000", and parseNumber made that 0)', () => {
    for (const zero of ['0.000', '0', '0.0', 0, null, undefined, '', ' - ']) {
      expect(parse(zero)).toBeNull();
    }
  });

  it('below zero is none too', () => {
    expect(parse('-5.000')).toBeNull();
    expect(parse(-1)).toBeNull();
  });

  it('with two candidates (the old long header, then the new key) a zero in the first does not hide a figure in the second', () => {
    expect(parse('0.000', '497,100.000')).toBe(497100);
    expect(parse(null, '0.000')).toBeNull();
    expect(parse('1,000.000', '2,000.000')).toBe(1000);
  });
});
