import { describe, expect, it } from 'vitest';
import { resolveSeaTradeCycleCompletionDate } from './latePerformance.service';

/*
 * Local components, not toISOString: due() builds local midnight, so reading it as UTC shifts a
 * day in any positive-offset zone. Writing this test the naive way made all six cases look broken.
 */
const key = (d: Date | null) =>
  d
    ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    : null;

const TODAY = new Date(2026, 8, 15);

describe('SEA Trade Cycle completion date: ATC -> ETC -> ETA at LP', () => {
  it('prefers the actual over either estimate', () => {
    expect(
      key(
        resolveSeaTradeCycleCompletionDate(
          {
            last_ata_vessel_complete_discharge: '2026-08-20',
            last_eta_vessel_complete_discharge: '2026-09-30',
            open_standard_eta_vessel_loading: '2026-07-01',
          },
          TODAY,
        ),
      ),
    ).toBe('2026-08-20');
  });

  it('uses ETC when ATC is still null - the reported case (PO 1001031296, 1001031455)', () => {
    expect(
      key(
        resolveSeaTradeCycleCompletionDate(
          { last_eta_vessel_complete_discharge: '2026-09-30', open_standard_eta_vessel_loading: null },
          TODAY,
        ),
      ),
    ).toBe('2026-09-30');
  });

  it('puts ETC ahead of ETA at LP - one estimates completion, the other the start of the voyage', () => {
    expect(
      key(
        resolveSeaTradeCycleCompletionDate(
          {
            last_eta_vessel_complete_discharge: '2026-09-30',
            open_standard_eta_vessel_loading: '2026-07-01',
          },
          TODAY,
        ),
      ),
    ).toBe('2026-09-30');
  });

  it('keeps ETA at LP as the last resort so nothing that shows a value today loses one', () => {
    expect(
      key(resolveSeaTradeCycleCompletionDate({ open_standard_eta_vessel_loading: '2026-09-20' }, TODAY)),
    ).toBe('2026-09-20');
  });

  it('clamps an estimate already in the past to today', () => {
    expect(
      key(resolveSeaTradeCycleCompletionDate({ last_eta_vessel_complete_discharge: '2026-08-01' }, TODAY)),
    ).toBe('2026-09-15');
  });

  it('stays null with no date at all, so the UI keeps showing "-"', () => {
    expect(resolveSeaTradeCycleCompletionDate({}, TODAY)).toBeNull();
  });
});
