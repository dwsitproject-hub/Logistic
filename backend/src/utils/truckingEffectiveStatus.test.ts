import { describe, expect, it } from 'vitest';
import { deriveTruckingEffectiveStatus } from './truckingEffectiveStatus';

describe('truckingEffectiveStatus', () => {
  it('deriveTruckingEffectiveStatus mirrors SQL date partition', () => {
    expect(deriveTruckingEffectiveStatus('CANCELLED', null, null)).toBe('CANCELLED');
    expect(deriveTruckingEffectiveStatus('PLANNED', null, null)).toBe('PLANNED');
    expect(deriveTruckingEffectiveStatus('PLANNED', '2026-06-01', null)).toBe('IN_PROGRESS');
    expect(deriveTruckingEffectiveStatus('PLANNED', '2026-06-01', '2026-06-30')).toBe('COMPLETED');
    expect(deriveTruckingEffectiveStatus('IN_TRANSIT', '2025-01-01', '2025-01-10')).toBe('COMPLETED');
  });
});
