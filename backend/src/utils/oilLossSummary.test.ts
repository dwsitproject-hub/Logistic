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

  it('merges contracts that share one STO into one R4 sample', () => {
    const rows = [
      {
        incoterm: 'CIF',
        transport_mode: 'LAND',
        operation_id: 'OP-1',
        sto_number: 'STO-1',
        contract_number: 'CN-1',
        quantity_sent: 100_000,
        quantity_received: 90_000,
      },
      {
        incoterm: 'CFR',
        operation_id: 'OP-1',
        sto_number: 'STO-1',
        contract_number: 'CN-2',
        quantity_sent: 200_000,
        quantity_received: 190_000,
      },
    ];

    const summary = computeROilLossSummary(rows, 'r4');

    expect(summary.sampleCount).toBe(1);
    expect(summary.totalMt).toBe(-20);
  });

  it('counts two STOs that share an Operation ID as two R1 samples', () => {
    const summary = computeROilLossSummary(
      [
        {
          incoterm: 'CIF',
          operation_id: 'OP-1',
          sto_number: 'STO-1',
          contract_number: 'CN-1',
          quantity_sent: 100_000,
          quantity_sfal: 90_000,
        },
        {
          incoterm: 'CIF',
          operation_id: 'OP-1',
          sto_number: 'STO-2',
          contract_number: 'CN-2',
          quantity_sent: 200_000,
          quantity_sfal: 190_000,
        },
      ],
      'r1',
    );
    expect(summary.sampleCount).toBe(2);
    expect(summary.totalMt).toBe(-20);
  });

  it('merges vessel contracts that share an STO when Operation ID is empty', () => {
    const summary = computeROilLossSummary(
      [
        {
          incoterm: 'CIF',
          operation_id: null,
          sto_number: 'STO-9',
          contract_number: 'CN-1',
          quantity_sent: 100_000,
          quantity_received: 90_000,
        },
        {
          incoterm: 'FOB',
          sto_number: 'STO-9',
          contract_number: 'CN-2',
          quantity_sent: 200_000,
          quantity_received: 190_000,
        },
      ],
      'r4',
    );
    expect(summary.sampleCount).toBe(1);
    expect(summary.totalMt).toBe(-20);
  });

  it('counts a shared STO once even when each PO also has another STO', () => {
    const summary = computeROilLossSummary(
      [
        {
          incoterm: 'FOB',
          operation_id: null,
          sto_number: 'STO-9',
          contract_number: 'CN-1',
          quantity_sent: 100_000,
          quantity_received: 90_000,
        },
        {
          incoterm: 'FOB',
          operation_id: null,
          sto_number: 'STO-1',
          contract_number: 'CN-1',
          quantity_sent: 100_000,
          quantity_received: 90_000,
        },
        {
          incoterm: 'FOB',
          operation_id: null,
          sto_number: 'STO-9',
          contract_number: 'CN-2',
          quantity_sent: 200_000,
          quantity_received: 190_000,
        },
      ],
      'r4',
    );
    // STO-9 (both POs) and STO-1 (CN-1 only).
    expect(summary.sampleCount).toBe(2);
    expect(summary.totalMt).toBe(-30);
  });

  it('keeps trucking contracts ungrouped even when Operation ID happens to repeat', () => {
    const rows = [
      {
        incoterm: 'FRC',
        transport_mode: 'SEA',
        operation_id: 'TRK-1',
        contract_number: 'CN-1',
        quantity_sent: 100_000,
        quantity_received: 90_000,
      },
      {
        incoterm: 'LCO',
        operation_id: 'TRK-1',
        contract_number: 'CN-2',
        quantity_sent: 200_000,
        quantity_received: 190_000,
      },
    ];

    const summary = computeROilLossSummary(rows, 'r4');

    // Trucking stays per-contract — two distinct contracts, two samples.
    expect(summary.sampleCount).toBe(2);
    expect(summary.totalMt).toBe(-20);
  });
});
