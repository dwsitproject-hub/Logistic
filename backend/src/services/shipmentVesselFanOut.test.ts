import { beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.fn();
const resolveIdsMock = vi.fn();

vi.mock('../database/connection', () => ({
  query: (...args: unknown[]) => queryMock(...args),
}));

vi.mock('../utils/shipmentStoGroupMembersSql', () => ({
  resolveStoGroupShipmentIds: (...args: unknown[]) => resolveIdsMock(...args),
}));

vi.mock('../utils/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  fanOutVesselIdentityToStoGroup,
  hasVesselIdentityUpdate,
} from './shipmentVesselFromSap.service';

const ANCHOR = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const SIBLING = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

const vessel = {
  vessel_name: 'VESSEL B',
  vessel_code: 'VB01',
  vessel_owner: 'Owner B',
  vessel_capacity: 5000,
  vessel_hull_type: 'BARGE',
  charter_type: 'TC',
  master_vessel_id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
};

describe('hasVesselIdentityUpdate', () => {
  it('is true when any voyage-level vessel field is present', () => {
    expect(hasVesselIdentityUpdate({ vessel_name: 'VESSEL B' })).toBe(true);
    expect(hasVesselIdentityUpdate({ master_vessel_id: ANCHOR })).toBe(true);
    expect(hasVesselIdentityUpdate({ eta_arrival: '2026-07-01' })).toBe(false);
  });
});

describe('fanOutVesselIdentityToStoGroup', () => {
  beforeEach(() => {
    queryMock.mockReset();
    resolveIdsMock.mockReset();
  });

  it('writes the edited vessel onto every shipment PO in the STO group', async () => {
    resolveIdsMock.mockResolvedValue([ANCHOR, SIBLING]);
    queryMock.mockResolvedValue({ rowCount: 2 });

    const touched = await fanOutVesselIdentityToStoGroup(ANCHOR, vessel);

    expect(touched).toBe(2);
    expect(queryMock).toHaveBeenCalledTimes(1);
    const [sql, params] = queryMock.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('vessel_name = $1');
    expect(sql).toContain('WHERE id = ANY($8::uuid[])');
    expect(params[0]).toBe('VESSEL B');
    expect(params[7]).toEqual([ANCHOR, SIBLING]);
  });

  it('still persists when the STO group has a single PO', async () => {
    resolveIdsMock.mockResolvedValue([ANCHOR]);
    queryMock.mockResolvedValue({ rowCount: 1 });
    const touched = await fanOutVesselIdentityToStoGroup(ANCHOR, {
      ...vessel,
      vessel_code: null,
      vessel_owner: null,
      vessel_capacity: null,
      vessel_hull_type: null,
      charter_type: null,
      master_vessel_id: null,
    });
    expect(touched).toBe(1);
    const params = queryMock.mock.calls[0][1] as unknown[];
    expect(params[7]).toEqual([ANCHOR]);
  });
});
