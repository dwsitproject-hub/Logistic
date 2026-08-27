import { describe, expect, it } from 'vitest';
import {
  applyCargoReadinessKlipEditFlag,
  classifyCargoReadinessExcelContract,
} from './cargoReadinessKlipProtect';

describe('applyCargoReadinessKlipEditFlag', () => {
  it('sets klip_edited when cargo_readiness_date is in the PUT body', () => {
    expect(
      applyCargoReadinessKlipEditFlag({ cargo_readiness_date: '2026-08-01' }),
    ).toEqual({
      cargo_readiness_date: '2026-08-01',
      cargo_readiness_klip_edited: true,
    });
  });

  it('does not set the flag for other field-only updates', () => {
    expect(applyCargoReadinessKlipEditFlag({ supplier: 'ACME' })).toEqual({
      supplier: 'ACME',
    });
  });

  it('strips a client-supplied unlock (false) and still locks when date is saved', () => {
    expect(
      applyCargoReadinessKlipEditFlag({
        cargo_readiness_date: '2026-09-15',
        cargo_readiness_klip_edited: false,
      }),
    ).toEqual({
      cargo_readiness_date: '2026-09-15',
      cargo_readiness_klip_edited: true,
    });
  });

  it('strips a lone client flag so Excel cannot be unlocked via PUT', () => {
    expect(applyCargoReadinessKlipEditFlag({ cargo_readiness_klip_edited: false })).toEqual({});
  });
});

describe('classifyCargoReadinessExcelContract', () => {
  it('returns not_found when the PO has no contract', () => {
    expect(classifyCargoReadinessExcelContract(null)).toBe('not_found');
    expect(classifyCargoReadinessExcelContract(undefined)).toBe('not_found');
  });

  it('skips Excel overwrite when KLIP already edited the date', () => {
    expect(classifyCargoReadinessExcelContract({ cargo_readiness_klip_edited: true })).toBe(
      'skipped',
    );
  });

  it('updates when the contract was never edited in KLIP', () => {
    expect(classifyCargoReadinessExcelContract({ cargo_readiness_klip_edited: false })).toBe(
      'update',
    );
    expect(classifyCargoReadinessExcelContract({})).toBe('update');
  });
});
