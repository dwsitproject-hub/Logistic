import { describe, expect, it } from 'vitest';
import {
  FILTER_OPTION_SCOPES,
  incotermsForScope,
  parseFilterOptionScope,
} from './filterOptionScopes';

describe('filter option scopes', () => {
  it('gives each page only the incoterms its filter should offer', () => {
    expect(FILTER_OPTION_SCOPES.trucking).toEqual(['FRC', 'LCO']);
    expect(FILTER_OPTION_SCOPES.shipment).toEqual(['FOB', 'CIF', 'CFR']);
  });

  it('falls back to no restriction for an absent or unrecognised scope', () => {
    // Contracts and Contract Performance pass none and must keep every incoterm; a typo must not
    // silently empty a page's filter either.
    expect(parseFilterOptionScope(undefined)).toBeNull();
    expect(parseFilterOptionScope('')).toBeNull();
    expect(parseFilterOptionScope('nonsense')).toBeNull();
    expect(incotermsForScope(null)).toBeNull();
  });

  it('accepts the scope regardless of case or padding', () => {
    expect(parseFilterOptionScope(' Trucking ')).toBe('trucking');
    expect(parseFilterOptionScope('SHIPMENT')).toBe('shipment');
  });

  it('keeps the two page sets disjoint', () => {
    const overlap = FILTER_OPTION_SCOPES.trucking.filter((i) =>
      (FILTER_OPTION_SCOPES.shipment as readonly string[]).includes(i),
    );
    expect(overlap).toEqual([]);
  });
});
