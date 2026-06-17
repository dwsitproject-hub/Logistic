import { describe, expect, it } from 'vitest';
import { computeROilLossSummary } from './oilLossSummary';

describe('computeROilLossSummary', () => {
  it('computes avg and total metrics for R4', () => {
    const rows = [
      {
        contract_number: 'CN-1',
        quantity_sent: 100_000,
        quantity_received: 95_000,
      },
      {
        contract_number: 'CN-2',
        quantity_sent: 200_000,
        quantity_received: 190_000,
      },
    ];

    const summary = computeROilLossSummary(rows, 'r4');

    expect(summary.sampleCount).toBe(2);
    expect(summary.totalMt).toBe(-15);
    expect(summary.totalPct).toBeCloseTo(-10, 4);
    expect(summary.avgMt).toBeCloseTo(-7.5, 4);
    expect(summary.avgPct).toBeCloseTo(-5, 4);
  });

  it('returns null totals when no eligible samples', () => {
    const summary = computeROilLossSummary(
      [{ quantity_sent: 100_000, quantity_received: null }],
      'r4',
    );

    expect(summary).toEqual({
      avgMt: null,
      avgPct: null,
      totalMt: null,
      totalPct: null,
      sampleCount: 0,
    });
  });
});
