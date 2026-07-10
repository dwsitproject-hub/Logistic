import { describe, expect, it } from 'vitest';
import {
  extractToolbarScopeFromColumnFilters,
  hasNonToolbarColumnFilters,
} from './pipelineDailySummaryToolbarScope';

describe('pipelineDailySummaryToolbarScope', () => {
  it('extracts product and incoterm multi filters', () => {
    const scope = extractToolbarScopeFromColumnFilters({
      product: { type: 'multi', values: ['CPO', 'Blank'], includeBlank: true },
      incoterm: { type: 'multi', values: ['frc', 'LCO'] },
    });
    expect(scope.products).toEqual(['CPO']);
    expect(scope.includeBlankProduct).toBe(true);
    expect(scope.incoterms).toEqual(['FRC', 'LCO']);
  });

  it('allows only toolbar scope column filters for daily path', () => {
    expect(
      hasNonToolbarColumnFilters({
        product: { type: 'multi', values: ['CPO'] },
        incoterm: { type: 'multi', values: ['FRC'] },
      }),
    ).toBe(false);
    expect(
      hasNonToolbarColumnFilters({
        supplier: { type: 'multi', values: ['ACME'] },
      }),
    ).toBe(true);
  });
});
