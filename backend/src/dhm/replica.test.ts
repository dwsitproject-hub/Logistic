import { describe, expect, it } from 'vitest';
import { resolveDhmReplicaCode } from './replica';
import type { DhmRecord } from './types';

const record = (data: Record<string, unknown>): DhmRecord => ({
  id: '11111111-1111-1111-1111-111111111111',
  version: 1,
  isDeleted: false,
  data,
  updatedAt: '2026-09-15T02:00:00.000Z',
});

describe('resolveDhmReplicaCode', () => {
  it('prefers code inside record.data', () => {
    expect(resolveDhmReplicaCode(record({ code: 'VSL-0001' }), 'VSL-9999')).toBe('VSL-0001');
  });

  it('uses inbound envelope code when record.data is empty', () => {
    expect(resolveDhmReplicaCode(record({}), 'VSL-0123')).toBe('VSL-0123');
  });

  it('returns null when neither source has a code', () => {
    expect(resolveDhmReplicaCode(record({ Vessel_Name: 'ARCADIA' }))).toBeNull();
  });
});
