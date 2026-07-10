import { describe, expect, it } from 'vitest';
import {
  isKlipOnlyShipmentGroupEligible,
  isKlipSyntheticLogisticsKey,
  normalizeCancelShipmentRemark,
  resolveShipmentGroupLookupKey,
  KlipShipmentCancelError,
} from './cancelKlipShipment.service';

describe('isKlipSyntheticLogisticsKey', () => {
  it('recognizes KLIP synthetic prefixes', () => {
    expect(isKlipSyntheticLogisticsKey('OP-123')).toBe(true);
    expect(isKlipSyntheticLogisticsKey('MNL-1700000000-uuid')).toBe(true);
    expect(isKlipSyntheticLogisticsKey('MSEA-abc')).toBe(true);
  });

  it('rejects SAP numeric STO and empty values', () => {
    expect(isKlipSyntheticLogisticsKey('1006018854')).toBe(false);
    expect(isKlipSyntheticLogisticsKey('')).toBe(false);
    expect(isKlipSyntheticLogisticsKey(null)).toBe(false);
  });
});

describe('resolveShipmentGroupLookupKey', () => {
  it('prefers operation_id over shipment_id', () => {
    expect(
      resolveShipmentGroupLookupKey({
        operation_id: 'OP-1',
        shipment_id: 'MNL-2',
      }),
    ).toBe('OP-1');
  });

  it('falls back to shipment_id then sto_number', () => {
    expect(resolveShipmentGroupLookupKey({ shipment_id: 'MNL-2' })).toBe('MNL-2');
    expect(resolveShipmentGroupLookupKey({ sto_number: 'OP-9' })).toBe('OP-9');
  });
});

describe('isKlipOnlyShipmentGroupEligible', () => {
  it('allows KLIP synthetic keys', () => {
    expect(isKlipOnlyShipmentGroupEligible('OP-abc')).toBe(true);
    expect(isKlipOnlyShipmentGroupEligible('MNL-1700-contract')).toBe(true);
  });

  it('blocks official SAP numeric STO keys', () => {
    expect(isKlipOnlyShipmentGroupEligible('1006018854')).toBe(false);
  });

  it('blocks empty keys', () => {
    expect(isKlipOnlyShipmentGroupEligible('')).toBe(false);
    expect(isKlipOnlyShipmentGroupEligible('   ')).toBe(false);
  });
});

describe('normalizeCancelShipmentRemark', () => {
  it('trims and returns non-empty remark', () => {
    expect(normalizeCancelShipmentRemark('  duplicate plan  ')).toBe('duplicate plan');
  });

  it('rejects empty remark', () => {
    expect(() => normalizeCancelShipmentRemark('')).toThrow(KlipShipmentCancelError);
    expect(() => normalizeCancelShipmentRemark('   ')).toThrow('Cancellation remark is required');
  });
});
