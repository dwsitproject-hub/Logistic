import { describe, expect, it } from 'vitest';
import {
  normalizePrePlannedCancelToUnplannedRemark,
  prePlannedCancelToUnplannedBlockedReason,
} from './prePlannedGroup.service';

describe('prePlannedCancelToUnplannedBlockedReason', () => {
  it('allows ACCEPTED groups with no shipment', () => {
    expect(
      prePlannedCancelToUnplannedBlockedReason({
        status: 'ACCEPTED',
        shipment_id: null,
      }),
    ).toBeNull();
  });

  it('blocks missing groups', () => {
    expect(prePlannedCancelToUnplannedBlockedReason(null)).toMatch(/not found/i);
  });

  it('blocks groups already linked to a shipment', () => {
    expect(
      prePlannedCancelToUnplannedBlockedReason({
        status: 'ACCEPTED',
        shipment_id: '11111111-1111-1111-1111-111111111111',
      }),
    ).toMatch(/Planned/i);
  });

  it('blocks SUGGESTED and DISMISSED groups', () => {
    expect(
      prePlannedCancelToUnplannedBlockedReason({ status: 'SUGGESTED', shipment_id: null }),
    ).toMatch(/Only Preplanned/i);
    expect(
      prePlannedCancelToUnplannedBlockedReason({ status: 'DISMISSED', shipment_id: null }),
    ).toMatch(/Only Preplanned/i);
  });
});

describe('normalizePrePlannedCancelToUnplannedRemark', () => {
  it('trims a non-empty remark', () => {
    expect(normalizePrePlannedCancelToUnplannedRemark('  regroup later  ')).toBe('regroup later');
  });

  it('rejects empty remarks', () => {
    expect(() => normalizePrePlannedCancelToUnplannedRemark('')).toThrow(/required/i);
    expect(() => normalizePrePlannedCancelToUnplannedRemark('   ')).toThrow(/required/i);
    expect(() => normalizePrePlannedCancelToUnplannedRemark(undefined)).toThrow(/required/i);
  });
});
