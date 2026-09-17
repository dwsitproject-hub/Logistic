import { describe, expect, it } from 'vitest';
import { filterContractUpdatesForRole } from './contractUpdateFields';

describe('filterContractUpdatesForRole', () => {
  it('allows TRADING to update any contract field', () => {
    const result = filterContractUpdatesForRole('TRADING', {
      cargo_readiness_date: '2026-08-01',
      supplier: 'ACME',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.updates).toEqual({
        cargo_readiness_date: '2026-08-01',
        supplier: 'ACME',
      });
    }
  });

  it('restricts LOGISTICS to cargo_readiness_date only', () => {
    const denied = filterContractUpdatesForRole('LOGISTICS', {
      cargo_readiness_date: '2026-08-01',
      supplier: 'ACME',
    });
    expect(denied.ok).toBe(false);

    const allowed = filterContractUpdatesForRole('LOGISTICS', {
      cargo_readiness_date: '2026-08-01',
    });
    expect(allowed.ok).toBe(true);
    if (allowed.ok) {
      expect(allowed.updates).toEqual({ cargo_readiness_date: '2026-08-01' });
    }
  });
});
