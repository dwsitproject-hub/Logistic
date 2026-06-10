import { describe, expect, it } from 'vitest';
import {
  formatDuplicateTruckingMessage,
  isActiveTruckingStatus,
} from './truckingOperationUniqueness';

describe('truckingOperationUniqueness', () => {
  it('treats CANCELLED as inactive', () => {
    expect(isActiveTruckingStatus('CANCELLED')).toBe(false);
    expect(isActiveTruckingStatus('cancelled')).toBe(false);
    expect(isActiveTruckingStatus('PLANNED')).toBe(true);
    expect(isActiveTruckingStatus(null)).toBe(true);
  });

  it('formats duplicate message with operation ids', () => {
    const msg = formatDuplicateTruckingMessage([
      { id: 'uuid-1', operation_id: 'OP-LAND-030620260001' },
      { id: 'uuid-2', operation_id: null },
    ]);
    expect(msg).toContain('OP-LAND-030620260001');
    expect(msg).toContain('uuid-2');
    expect(msg).toContain('Edit the existing operation');
  });
});
