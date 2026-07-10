import { describe, expect, it } from 'vitest';
import { truckingOperationIdIsAssigned } from './truckingOperationUniqueness';

describe('truckingOperationIdIsAssigned', () => {
  it('returns false for null, empty, or whitespace operation_id', () => {
    expect(truckingOperationIdIsAssigned(null)).toBe(false);
    expect(truckingOperationIdIsAssigned('')).toBe(false);
    expect(truckingOperationIdIsAssigned('   ')).toBe(false);
  });

  it('returns true when operation_id is set', () => {
    expect(truckingOperationIdIsAssigned('OP-LAND-01012026001')).toBe(true);
  });
});
