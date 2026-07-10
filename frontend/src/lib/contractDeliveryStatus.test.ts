import { describe, expect, it } from 'vitest';
import { formatContractDeliveryStatusLabel, isContractRecordClosed } from './contractDeliveryStatus';

describe('formatContractDeliveryStatusLabel', () => {
  it('maps legacy ACTIVE to Open for display', () => {
    expect(formatContractDeliveryStatusLabel('ACTIVE')).toBe('Open');
    expect(formatContractDeliveryStatusLabel('COMPLETED')).toBe('Close');
  });
});

describe('isContractRecordClosed', () => {
  it('detects closed contract from import_status', () => {
    expect(isContractRecordClosed({ import_status: 'Close' })).toBe(true);
    expect(isContractRecordClosed({ contract_import_status: 'CLOSED' })).toBe(true);
  });

  it('falls back to status field', () => {
    expect(isContractRecordClosed({ status: 'COMPLETED' })).toBe(true);
    expect(isContractRecordClosed({ status: 'Open' })).toBe(false);
  });
});
