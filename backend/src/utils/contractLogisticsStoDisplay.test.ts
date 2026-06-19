import { describe, expect, it } from 'vitest';
import {
  resolveContractLogisticsOperationId,
  resolveContractLogisticsStoNumber,
} from './contractLogisticsStoDisplay';

describe('contractLogisticsStoDisplay', () => {
  it('returns dash when STO is missing', () => {
    expect(resolveContractLogisticsStoNumber(null)).toBe('-');
    expect(resolveContractLogisticsStoNumber('')).toBe('-');
  });

  it('does not show Operation ID as STO No', () => {
    expect(resolveContractLogisticsStoNumber('OP-SEA-030620260001')).toBe('-');
    expect(resolveContractLogisticsStoNumber('MNL-12345678-1004030411')).toBe('-');
  });

  it('shows numeric SAP STO', () => {
    expect(resolveContractLogisticsStoNumber('1586004692')).toBe('1586004692');
  });

  it('resolves operation id from row or synthetic sto_key', () => {
    expect(resolveContractLogisticsOperationId('OP-SEA-030620260001', null)).toBe(
      'OP-SEA-030620260001',
    );
    expect(
      resolveContractLogisticsOperationId(null, 'OP-SEA-030620260001'),
    ).toBe('OP-SEA-030620260001');
    expect(resolveContractLogisticsOperationId(null, '1586004692')).toBeNull();
  });
});
