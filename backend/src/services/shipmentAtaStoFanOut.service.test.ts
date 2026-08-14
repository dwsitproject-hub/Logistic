import { beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.fn();
const resolveIdsMock = vi.fn();
const upsertOverrideMock = vi.fn();

vi.mock('../database/connection', () => ({
  query: (...args: unknown[]) => queryMock(...args),
}));

vi.mock('../utils/shipmentStoGroupMembersSql', () => ({
  resolveStoGroupShipmentIds: (...args: unknown[]) => resolveIdsMock(...args),
}));

vi.mock('./shipmentAtaOverride.service', () => ({
  upsertShipmentAtaOverride: (...args: unknown[]) => upsertOverrideMock(...args),
}));

vi.mock('../utils/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  fanOutShipmentEtaToStoGroup,
  fanOutVesselLoadingPortAtaToStoGroup,
  upsertShipmentAtaOverrideForStoGroup,
} from './shipmentAtaStoFanOut.service';

const ANCHOR = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const SIBLING = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

describe('upsertShipmentAtaOverrideForStoGroup', () => {
  beforeEach(() => {
    queryMock.mockReset();
    resolveIdsMock.mockReset();
    upsertOverrideMock.mockReset();
  });

  it('writes the ATA payload to every shipment PO in the STO group', async () => {
    resolveIdsMock.mockResolvedValue([ANCHOR, SIBLING]);
    upsertOverrideMock
      .mockResolvedValueOnce({ shipment_id: ANCHOR, ata_sailed: '2026-07-15' })
      .mockResolvedValueOnce({ shipment_id: SIBLING, ata_sailed: '2026-07-15' });

    const payload = { ata_vessel_sailed_from_loading_port: '2026-07-15' };
    const row = await upsertShipmentAtaOverrideForStoGroup(ANCHOR, payload, 'user-1');

    expect(row?.shipment_id).toBe(ANCHOR);
    expect(upsertOverrideMock).toHaveBeenCalledTimes(2);
    expect(upsertOverrideMock.mock.calls[0][1]).toBe(ANCHOR);
    expect(upsertOverrideMock.mock.calls[0][2]).toEqual(payload);
    expect(upsertOverrideMock.mock.calls[1][1]).toBe(SIBLING);
    expect(upsertOverrideMock.mock.calls[1][2]).toEqual(payload);
  });
});

describe('fanOutVesselLoadingPortAtaToStoGroup', () => {
  beforeEach(() => {
    queryMock.mockReset();
    resolveIdsMock.mockReset();
  });

  it('copies ATA onto matching sibling ports', async () => {
    resolveIdsMock.mockResolvedValue([ANCHOR, SIBLING]);
    queryMock.mockResolvedValueOnce({ rows: [{ id: 'port-sibling' }] });

    const touched = await fanOutVesselLoadingPortAtaToStoGroup({
      anchorShipmentId: ANCHOR,
      sourcePortId: 'port-anchor',
      portSequence: 1,
      isDischargePort: false,
      portName: 'PORT SEBULU',
      ata: {
        ata_vessel_arrival: '2026-07-09',
        ata_vessel_berthed: '2026-07-11',
        ata_loading_start: '2026-07-11',
        ata_loading_completed: '2026-07-14',
        ata_vessel_sailed: '2026-07-15',
      },
    });

    expect(touched).toBe(1);
    expect(queryMock).toHaveBeenCalledTimes(1);
    expect(String(queryMock.mock.calls[0][0])).toContain('UPDATE vessel_loading_ports');
    expect(queryMock.mock.calls[0][1][0]).toBe(SIBLING);
    expect(queryMock.mock.calls[0][1][6]).toBe('2026-07-15');
  });

  it('inserts a sibling port when none exists', async () => {
    resolveIdsMock.mockResolvedValue([ANCHOR, SIBLING]);
    queryMock.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] });

    const touched = await fanOutVesselLoadingPortAtaToStoGroup({
      anchorShipmentId: ANCHOR,
      sourcePortId: 'port-anchor',
      portSequence: 999,
      isDischargePort: true,
      portName: 'PORT BONTANG',
      ata: {
        ata_vessel_arrival: '2026-07-17',
        ata_vessel_berthed: null,
        ata_loading_start: null,
        ata_loading_completed: '2026-07-20',
        ata_vessel_sailed: null,
      },
    });

    expect(touched).toBe(1);
    expect(String(queryMock.mock.calls[1][0])).toContain('INSERT INTO vessel_loading_ports');
    expect(queryMock.mock.calls[1][1][0]).toBe(SIBLING);
    expect(queryMock.mock.calls[1][1][3]).toBe(true);
  });

  it('is a no-op when the STO has a single shipment PO', async () => {
    resolveIdsMock.mockResolvedValue([ANCHOR]);
    const touched = await fanOutVesselLoadingPortAtaToStoGroup({
      anchorShipmentId: ANCHOR,
      sourcePortId: 'port-anchor',
      portSequence: 1,
      isDischargePort: false,
      portName: 'PORT SEBULU',
      ata: {
        ata_vessel_arrival: null,
        ata_vessel_berthed: null,
        ata_loading_start: null,
        ata_loading_completed: null,
        ata_vessel_sailed: '2026-07-15',
      },
    });
    expect(touched).toBe(0);
    expect(queryMock).not.toHaveBeenCalled();
  });
});

describe('fanOutShipmentEtaToStoGroup', () => {
  beforeEach(() => {
    queryMock.mockReset();
    resolveIdsMock.mockReset();
  });

  it('writes ETA onto every shipment PO and matching ports in the STO group', async () => {
    resolveIdsMock.mockResolvedValue([ANCHOR, SIBLING]);
    queryMock.mockResolvedValue({ rowCount: 2 });

    const touched = await fanOutShipmentEtaToStoGroup(ANCHOR, {
      eta_arrival: '2026-07-01',
      eta_berthed: '2026-07-02',
      eta_loading_start: '2026-07-03',
      eta_loading_complete: '2026-07-04',
      eta_sailed: '2026-07-05',
      eta_discharge_arrival: '2026-07-10',
      eta_discharge_berthed: '2026-07-11',
      eta_discharge_start: '2026-07-12',
      eta_discharge_complete: '2026-07-13',
    });

    expect(touched).toBe(2);
    expect(queryMock).toHaveBeenCalledTimes(3);
    const shipmentSql = String(queryMock.mock.calls[0][0]);
    expect(shipmentSql).toContain('eta_arrival = $2::date');
    expect(shipmentSql).toContain('WHERE id = ANY($1::uuid[])');
    expect(queryMock.mock.calls[0][1][0]).toEqual([ANCHOR, SIBLING]);
  });
});
