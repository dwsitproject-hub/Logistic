/**
 * Simulates post-fix validation against patterns from
 * docs/daily-trucking-ming-2026-08-06-failed.xlsx (SIT upload failures).
 */
import { describe, expect, it } from 'vitest';
import {
  prepareAuthoritativePlanningMerge,
  sumDailyDeliverablesKg,
} from './truckingDailyDeliverables';
import { validatePlanningTotalAgainstOutstandingKg } from './truckingUnplannedPlanningOsQty';

type FailedRowCase = {
  po: string;
  filePlanMt: number;
  outstandingMt: number;
  staleExistingKg: number;
  reason: string;
};

const EXCEEDS_CASES: FailedRowCase[] = [
  { po: '1001030196', filePlanMt: 165, outstandingMt: 165.32, staleExistingKg: 250000, reason: 'exceeds' },
  { po: '1001029782', filePlanMt: 500, outstandingMt: 500, staleExistingKg: 500000, reason: 'exceeds' },
  { po: '1001030678', filePlanMt: 1000, outstandingMt: 1000, staleExistingKg: 1000000, reason: 'exceeds' },
];

const ROUNDING_CASES: FailedRowCase[] = [
  { po: '1001031603', filePlanMt: 439, outstandingMt: 439.02, staleExistingKg: 0, reason: 'less' },
  { po: '1001031474', filePlanMt: 29, outstandingMt: 29.01, staleExistingKg: 0, reason: 'less' },
  { po: '1001031557', filePlanMt: 741, outstandingMt: 740.72, staleExistingKg: 0, reason: 'greater' },
];

const PARTIAL_PLAN_CASES: FailedRowCase[] = [
  { po: '1001031295', filePlanMt: 402, outstandingMt: 469.16, staleExistingKg: 0, reason: 'less' },
  { po: '1001031402', filePlanMt: 34, outstandingMt: 837.5, staleExistingKg: 0, reason: 'less' },
];

function simulateUpload(row: FailedRowCase) {
  const incoming = [{ date: '2026-08-07', quantity_delivered: row.filePlanMt * 1000 }];
  const staleExisting = row.staleExistingKg
    ? [{ date: '2026-07-01', quantity_delivered: row.staleExistingKg }]
    : [];
  const merged = prepareAuthoritativePlanningMerge(staleExisting, incoming, {
    lockedDates: new Set(),
  });
  const totalKg = sumDailyDeliverablesKg(merged);
  return validatePlanningTotalAgainstOutstandingKg(totalKg, row.outstandingMt * 1000);
}

describe('daily-trucking-ming-2026-08-06-failed.xlsx patterns after fix', () => {
  it('fixes exceeds cases when stale DB planning is stripped (authoritative merge)', () => {
    for (const row of EXCEEDS_CASES) {
      const result = simulateUpload(row);
      expect(result.ok, `PO ${row.po} should pass after authoritative merge`).toBe(true);
    }
  });

  it('fixes rounding cases within 1 MT tolerance', () => {
    for (const row of ROUNDING_CASES) {
      const result = simulateUpload(row);
      expect(result.ok, `PO ${row.po} rounding should pass`).toBe(true);
    }
  });

  it('still rejects intentional partial planning below OS', () => {
    for (const row of PARTIAL_PLAN_CASES) {
      const result = simulateUpload(row);
      expect(result.ok, `PO ${row.po} partial plan should still fail`).toBe(false);
      if (!result.ok) {
        expect(result.failureKind).toBe('less');
      }
    }
  });
});
