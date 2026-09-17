import { describe, expect, it } from 'vitest';
import { computeShippingPerfDeltaFields } from './shippingPerformanceDeltas';

describe('computeShippingPerfDeltaFields', () => {
  it('matches SQL formulas for ETA and ATA loading segments', () => {
    const deltas = computeShippingPerfDeltaFields({
      cargo_readiness_date: '2026-01-01',
      loading_eta_arrival: '2026-01-08',
      loading_eta_berthed: '2026-01-09',
      loading_eta_completed: '2026-01-12',
      loading_ata_arrival: '2026-02-01',
      loading_ata_berthed: '2026-02-02',
      loading_ata_completed: '2026-02-05',
    });

    expect(deltas.loading_delta_eta_etr_days).toBe(7);
    expect(deltas.loading_delta_eta_etb_days).toBe(-1);
    expect(deltas.loading_delta_etb_etc_days).toBe(-3);
    expect(deltas.ata_loading_delta_eta_etr_days).toBe(31);
    expect(deltas.ata_loading_delta_eta_etb_days).toBe(-1);
    expect(deltas.ata_loading_delta_etb_etc_days).toBe(-3);
  });

  it('returns null totals when every segment is missing', () => {
    const deltas = computeShippingPerfDeltaFields({});
    expect(deltas.total_delta_days).toBeNull();
    expect(deltas.ata_total_delta_days).toBeNull();
    expect(deltas.ata_loading_delta_eta_etr_days).toBeNull();
  });
});
