import { describe, expect, it } from 'vitest';
import { matchGroupPlantInText } from './agentGroupPlant.service';

// Mirrors the real Master Plant List values.
const GROUPS = [
  'Bekasi',
  'Bontang',
  'Bulking Batam',
  'Bulking Belawan',
  'Bulking Kumai',
  'Bulking Lubuk Gaung',
  'Bulking Palembang',
  'Bulking Sintang',
  'Cisadane',
  'EOP Tj Morawa',
  'Karawang',
  'Tanjung Pura',
  'Trading',
];

describe('matchGroupPlantInText', () => {
  it('finds the area in the reported question', () => {
    expect(
      matchGroupPlantInText('share the contract performance for Bontang based on product as of today', GROUPS),
    ).toBe('Bontang');
  });

  it('is case-insensitive and survives punctuation', () => {
    expect(matchGroupPlantInText('BONTANG performance?', GROUPS)).toBe('Bontang');
    expect(matchGroupPlantInText('what about karawang, by product', GROUPS)).toBe('Karawang');
  });

  it('matches multi-word areas', () => {
    expect(matchGroupPlantInText('outstanding for Tanjung Pura', GROUPS)).toBe('Tanjung Pura');
    expect(matchGroupPlantInText('EOP Tj Morawa contracts', GROUPS)).toBe('EOP Tj Morawa');
  });

  it('prefers the longest match so a qualified area beats a bare one', () => {
    // "Bulking Batam" must win even though a bare "Batam" substring is present.
    expect(matchGroupPlantInText('contract performance for Bulking Batam', GROUPS)).toBe('Bulking Batam');
  });

  it('returns null when no area is named', () => {
    expect(matchGroupPlantInText('what is the outstanding quantity for CPO?', GROUPS)).toBeNull();
    expect(matchGroupPlantInText('', GROUPS)).toBeNull();
  });

  it('does not match an area name embedded inside another word', () => {
    // Guards against substring false positives like "Trading" inside "Tradings"/"contrading".
    expect(matchGroupPlantInText('bontangese supplier review', GROUPS)).toBeNull();
  });

  it('matches a whole-word area even when adjacent to punctuation', () => {
    expect(matchGroupPlantInText('performance (Bontang) by product', GROUPS)).toBe('Bontang');
  });
});
