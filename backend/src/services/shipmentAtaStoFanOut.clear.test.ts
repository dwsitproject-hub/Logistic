import { beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.fn();
const membersMock = vi.fn();
vi.mock('../database/connection', () => ({ query: (...args: unknown[]) => queryMock(...args) }));
vi.mock('../utils/logger', () => ({ default: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('../utils/shipmentStoGroupMembersSql', () => ({ resolveStoGroupShipmentIds: (...args: unknown[]) => membersMock(...args) }));

import {
  clearedDischargeActualColumns,
  clearStoredDischargeActualsForStoGroup,
  DISCHARGE_ACTUAL_LAYERS,
} from './shipmentAtaStoFanOut.service';

describe('clearedDischargeActualColumns: which discharge actuals a save emptied', () => {
  it('lists the milestones sent with no value, whatever the empty looks like', () => {
    expect(
      clearedDischargeActualColumns({
        ata_vessel_arrive_at_discharge_port: null,
        ata_vessel_berthed_at_discharge_port: '',
        ata_vessel_start_discharging: '   ',
      }),
    ).toEqual(['ata_discharge_arrival', 'ata_discharge_berthed', 'ata_discharge_start']);
  });

  it('ignores a milestone that was left out of the payload or given a date', () => {
    expect(clearedDischargeActualColumns({ ata_vessel_arrive_at_discharge_port: '2026-11-17' })).toEqual([]);
    expect(clearedDischargeActualColumns({})).toEqual([]);
    expect(clearedDischargeActualColumns({ ata_vessel_complete_discharge: null })).toEqual(['ata_discharge_complete']);
  });

  it('never reports a loading-port milestone', () => {
    expect(
      clearedDischargeActualColumns({
        ata_vessel_arrival_at_loading_port: null,
        ata_vessel_completed_loading: null,
        ata_vessel_sailed_from_loading_port: null,
      }),
    ).toEqual([]);
  });
});

describe('clearStoredDischargeActualsForStoGroup', () => {
  beforeEach(() => {
    queryMock.mockReset();
    membersMock.mockReset();
  });

  it('does nothing, and asks nothing, when nothing was emptied', async () => {
    expect(await clearStoredDischargeActualsForStoGroup('s-1', [])).toEqual({ shipments: 0, ports: 0 });
    expect(queryMock).not.toHaveBeenCalled();
    expect(membersMock).not.toHaveBeenCalled();
  });

  it('clears the shipments column and the port row of every member, and keeps a date SAP reports itself', async () => {
    membersMock.mockResolvedValue(['s-1', 's-2', 's-3']);
    queryMock.mockResolvedValueOnce({ rowCount: 1 }).mockResolvedValueOnce({ rowCount: 3 });
    const result = await clearStoredDischargeActualsForStoGroup('s-1', ['ata_discharge_arrival']);

    expect(result).toEqual({ shipments: 1, ports: 3 });
    const [shipSql, shipParams] = queryMock.mock.calls[0] as [string, unknown[]];
    expect(shipSql).toContain('UPDATE shipments SET ata_discharge_arrival = NULL');
    expect(shipParams).toEqual([['s-1', 's-2', 's-3']]);

    const [portSql, portParams] = queryMock.mock.calls[1] as [string, unknown[]];
    expect(portSql).toContain('SET ata_vessel_arrival = NULL');
    expect(portSql).toContain("array_remove(COALESCE(klip_edited_fields, '{}'), 'ata_vessel_arrival')");
    expect(portSql).toContain('AND sap_ata_vessel_arrival IS NULL');
    expect(portSql).toContain('COALESCE(is_discharge_port, false) = true OR port_sequence = 999');
    expect(portParams).toEqual([['s-1', 's-2', 's-3']]);
  });

  it('works on the anchor alone when the group has no other member', async () => {
    membersMock.mockResolvedValue([]);
    queryMock.mockResolvedValue({ rowCount: 0 });
    await clearStoredDischargeActualsForStoGroup('s-9', ['ata_discharge_start']);
    expect((queryMock.mock.calls[0] as [string, unknown[]])[1]).toEqual([['s-9']]);
  });

  it('maps every milestone to its own port column and SAP mirror, and writes one pair of statements per milestone', async () => {
    membersMock.mockResolvedValue(['s-1']);
    queryMock.mockResolvedValue({ rowCount: 0 });
    await clearStoredDischargeActualsForStoGroup('s-1', ['ata_discharge_berthed', 'ata_discharge_start', 'ata_discharge_complete']);
    expect(queryMock).toHaveBeenCalledTimes(6);
    const sql = queryMock.mock.calls.map((c) => c[0] as string).join('\n');
    expect(sql).toContain('SET ata_vessel_berthed = NULL');
    expect(sql).toContain('sap_ata_loading_start IS NULL');
    expect(sql).toContain('SET ata_loading_completed = NULL');
    expect(DISCHARGE_ACTUAL_LAYERS.ata_discharge_complete.sap).toBe('sap_ata_loading_completed');
  });
});
