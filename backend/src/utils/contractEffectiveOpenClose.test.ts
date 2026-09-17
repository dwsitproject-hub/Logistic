import { describe, expect, it } from 'vitest';
import {
  isContractEffectivelyDone,
  resolveContractEffectiveStatusText,
  sqlContractEffectivelyDoneExpr,
  sqlContractImportStatusIsClosedExpr,
  sqlContractImportStatusIsOpenExpr,
} from './contractDeliveryStatus';
import { OUTSTANDING_QTY_ZERO_TOLERANCE_KG } from './qtyZeroTolerance';

/**
 * A contract whose GR PO/STO status still says Open counts as Close once it has effectively
 * finished - OS within the ±0 MT tolerance, or ATC at discharge filled. Requested 2026-09-07
 * for the Open|Close cards, the drilldown, their OS totals, and (confirmed separately) the
 * Trade Cycle / Late-OnTime maths, so one classifier backs all of them.
 */
describe('isContractEffectivelyDone', () => {
  it('treats OS at or below the ±0 MT tolerance as finished', () => {
    expect(isContractEffectivelyDone({ outstanding_quantity: 0 })).toBe(true);
    expect(isContractEffectivelyDone({ outstanding_quantity: OUTSTANDING_QTY_ZERO_TOLERANCE_KG })).toBe(true);
    expect(isContractEffectivelyDone({ outstanding_quantity: OUTSTANDING_QTY_ZERO_TOLERANCE_KG + 1 })).toBe(false);
  });

  it('treats over-delivery (negative OS) as finished, like the trucking rule', () => {
    expect(isContractEffectivelyDone({ outstanding_quantity: -3000 })).toBe(true);
  });

  it('accepts a filled ATC even while OS is still open', () => {
    expect(
      isContractEffectivelyDone({ outstanding_quantity: 50_000, last_ata_vessel_complete_discharge: '2026-08-01' }),
    ).toBe(true);
  });

  it('is false when neither condition holds, and when the row carries nothing', () => {
    expect(isContractEffectivelyDone({ outstanding_quantity: 50_000 })).toBe(false);
    expect(isContractEffectivelyDone({ outstanding_quantity: 50_000, last_ata_vessel_complete_discharge: '' })).toBe(false);
    expect(isContractEffectivelyDone({})).toBe(false);
    expect(isContractEffectivelyDone(null)).toBe(false);
  });
});

describe('resolveContractEffectiveStatusText', () => {
  it('overrides Open to CLOSE once the contract is effectively done', () => {
    expect(resolveContractEffectiveStatusText({ import_status: 'Open', outstanding_quantity: 100 })).toBe('CLOSE');
  });

  it('leaves a genuinely open contract alone', () => {
    expect(resolveContractEffectiveStatusText({ import_status: 'Open', outstanding_quantity: 50_000 })).toBe('OPEN');
  });

  it('never turns Cancelled into Close', () => {
    expect(
      resolveContractEffectiveStatusText({ import_status: 'Cancelled', outstanding_quantity: 0 }),
    ).toBe('CANCELLED');
  });

  it('falls back to contracts.status when import_status is unresolved', () => {
    expect(resolveContractEffectiveStatusText({ status: 'Open', outstanding_quantity: 50_000 })).toBe('OPEN');
  });
});

describe('Open / Close SQL predicates', () => {
  const done = sqlContractEffectivelyDoneExpr({
    outstandingKgExpr: 'base.outstanding_quantity',
    atcExpr: 'base.last_ata_vessel_complete_discharge',
  });

  it('uses the shared tolerance and the ATC column', () => {
    expect(done).toContain(String(OUTSTANDING_QTY_ZERO_TOLERANCE_KG));
    expect(done).toContain('base.last_ata_vessel_complete_discharge');
  });

  it('drops effectively-done rows out of Open', () => {
    const sql = sqlContractImportStatusIsOpenExpr('base.import_status', undefined, done);
    expect(sql).toContain('AND NOT');
    expect(sql).toContain(String(OUTSTANDING_QTY_ZERO_TOLERANCE_KG));
  });

  it('pulls effectively-done rows into Close, but never Cancelled ones', () => {
    const sql = sqlContractImportStatusIsClosedExpr('base.import_status', undefined, done);
    expect(sql).toContain(String(OUTSTANDING_QTY_ZERO_TOLERANCE_KG));
    expect(sql).toContain("'CANCELLED'");
    expect(sql).toContain('AND NOT');
  });

  it('is unchanged for callers that pass no effectively-done expression', () => {
    expect(sqlContractImportStatusIsOpenExpr('base.import_status')).not.toContain('AND NOT');
    expect(sqlContractImportStatusIsClosedExpr('base.import_status')).not.toContain('AND NOT');
  });
});
