import { beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.fn();
const groupIdsMock = vi.fn();

vi.mock('../database/connection', () => ({
  query: (...args: unknown[]) => queryMock(...args),
  getClient: vi.fn(),
}));

vi.mock('../utils/shipmentStoGroupMembersSql', () => ({
  resolveStoGroupShipmentIds: (...args: unknown[]) => groupIdsMock(...args),
}));

import { resolveSapLoadingPortNameMapForShipment } from './vesselLoadingPortsFromSap.service';

/**
 * A shipment made in KLIP on unplanned POs has no SAP STO row pointing at it, but SAP still carries the PO - with its
 * loading and discharge port - on rows that have no STO. Add New Shipment prefilled the ports FROM those rows, and the Edit
 * modal then badged them KLIP because it found no SAP port to compare against.
 */
describe('resolveSapLoadingPortNameMapForShipment - contract-level fallback', () => {
  const SAP_ROW = {
    data: {
      shipment: {
        vessel_loading_port_1: 'POM KENDAWANGAN',
        vessel_discharge_port: 'PRC PALM & LAURIC KARAWANG',
      },
    },
  };

  beforeEach(() => {
    queryMock.mockReset();
    groupIdsMock.mockReset();
    groupIdsMock.mockResolvedValue(['shipment-1']);
  });

  it('reads the ports from the contracts\' SAP rows when no STO row matches the shipment', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [] }) // STO / operation lookup finds nothing
      .mockResolvedValueOnce({ rows: [SAP_ROW] }); // contract-level fallback

    const map = await resolveSapLoadingPortNameMapForShipment('shipment-1', null);

    expect(map.bySequence.get(1)).toBe('POM KENDAWANGAN');
    expect(map.discharge).toBe('PRC PALM & LAURIC KARAWANG');
    expect(map.allLoadingNames).toEqual(['POM KENDAWANGAN']);
    expect(groupIdsMock).toHaveBeenCalledWith('shipment-1');
    const fallbackSql = String(queryMock.mock.calls[1][0]);
    expect(fallbackSql).toContain('spd.contract_number IN');
    expect(queryMock.mock.calls[1][1]).toEqual([['shipment-1']]);
  });

  it('does not touch the fallback when the STO lookup already found SAP rows', async () => {
    queryMock.mockResolvedValueOnce({ rows: [SAP_ROW] });

    const map = await resolveSapLoadingPortNameMapForShipment('shipment-1', '1016010976');

    expect(map.bySequence.get(1)).toBe('POM KENDAWANGAN');
    expect(queryMock).toHaveBeenCalledTimes(1);
    expect(groupIdsMock).not.toHaveBeenCalled();
  });

  it('stays empty when neither lookup finds anything', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] });

    const map = await resolveSapLoadingPortNameMapForShipment('shipment-1', null);

    expect(map.bySequence.size).toBe(0);
    expect(map.discharge).toBeNull();
    expect(map.allLoadingNames).toEqual([]);
  });
});
