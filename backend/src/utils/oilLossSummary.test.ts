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
    expect(summary.totalPct).toBeCloseTo(-5, 4);
    expect(summary.avgMt).toBeCloseTo(-7.5, 4);
    expect(summary.avgPct).toBeCloseTo(-5, 4);
  });

  it('computes weighted totalPct by Qty Delivery when contract loss % differ', () => {
    const rows = [
      {
        contract_number: 'CN-1',
        quantity_sent: 100_000,
        quantity_received: 90_000,
      },
      {
        contract_number: 'CN-2',
        quantity_sent: 300_000,
        quantity_received: 294_000,
      },
    ];

    const summary = computeROilLossSummary(rows, 'r4');

    expect(summary.totalMt).toBe(-16);
    // (-10% * 100k + -2% * 300k) / 400k = -4%
    expect(summary.totalPct).toBeCloseTo(-4, 4);
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

  it('skips R1 when SFAL is null', () => {
    const summary = computeROilLossSummary(
      [
        {
          contract_number: 'CN-1',
          quantity_sent: 100_000,
          quantity_received: 90_000,
          quantity_sfal: null,
        },
      ],
      'r1',
    );
    expect(summary.sampleCount).toBe(0);
    expect(summary.totalMt).toBeNull();
  });

  it('computes R1 when SFAL is genuine zero', () => {
    const summary = computeROilLossSummary(
      [
        {
          contract_number: 'CN-1',
          quantity_sent: 100_000,
          quantity_received: 90_000,
          quantity_sfal: 0,
        },
      ],
      'r1',
    );
    expect(summary.sampleCount).toBe(1);
    expect(summary.totalMt).toBe(-100);
  });

  it('merges a SEA voyage spanning multiple contracts into one sample (summed)', () => {
    const rows = [
      {
        transport_mode: 'SEA',
        operation_id: 'OP-1',
        contract_number: 'CN-1',
        quantity_sent: 100_000,
        quantity_received: 90_000,
      },
      {
        transport_mode: 'SEA',
        operation_id: 'OP-1',
        contract_number: 'CN-2',
        quantity_sent: 200_000,
        quantity_received: 190_000,
      },
    ];

    const summary = computeROilLossSummary(rows, 'r4');

    // One merged voyage sample, not two per-contract samples.
    expect(summary.sampleCount).toBe(1);
    expect(summary.totalMt).toBe(-20);
  });

  it('keeps LAND contracts ungrouped even when Operation ID happens to repeat', () => {
    const rows = [
      {
        transport_mode: 'LAND',
        operation_id: 'TRK-1',
        contract_number: 'CN-1',
        quantity_sent: 100_000,
        quantity_received: 90_000,
      },
      {
        transport_mode: 'LAND',
        operation_id: 'TRK-1',
        contract_number: 'CN-2',
        quantity_sent: 200_000,
        quantity_received: 190_000,
      },
    ];

    const summary = computeROilLossSummary(rows, 'r4');

    // LAND stays per-contract — two distinct contracts, two samples.
    expect(summary.sampleCount).toBe(2);
    expect(summary.totalMt).toBe(-20);
  });
});
