import { beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.hoisted(() => vi.fn());
const invalidateMock = vi.hoisted(() => vi.fn());
vi.mock('../database/connection', () => ({ query: queryMock, pool: {} }));
vi.mock('../services/shipmentWriteInvalidation.service', () => ({ invalidateAfterShipmentWrite: invalidateMock }));

import { applyJpsAtaLane, JPS_ATA_LANE, planJpsAtaLane, toJakartaDate } from './applyActuals';
import { JPS_SCHEDULE_ATA_FIELDS } from './scheduleAtaSql';

describe('toJakartaDate', () => {
  it('takes the calendar date at the port, not the UTC date', () => {
    expect(toJakartaDate('2026-09-28T07:45:00.000Z')).toBe('2026-09-28');
    // 22:00Z on the 1st is 05:00 on the 2nd in Jakarta - cutting the UTC string would put it a day early
    expect(toJakartaDate('2026-09-30T22:00:00.000Z')).toBe('2026-10-01');
    expect(toJakartaDate('2026-12-31T17:00:00Z')).toBe('2027-01-01');
    expect(toJakartaDate('2026-09-30T16:59:59Z')).toBe('2026-09-30');
  });

  it('is null for anything that is not a time', () => {
    for (const v of [null, undefined, '', '  ', 'abc']) expect(toJakartaDate(v)).toBeNull();
  });
});

describe('the lane follows the one mapping', () => {
  it('ta, tb, cargo_ops_start_at (Hose On) and cargo_ops_end_at (Hose Off) feed ATA at DP, ATB, ATS and ATC Discharge', () => {
    expect(JPS_SCHEDULE_ATA_FIELDS.map((f) => [f.scheduleKey, f.ataField])).toEqual([
      ['ta', 'ata_vessel_arrive_at_discharge_port'],
      ['tb', 'ata_vessel_berthed_at_discharge_port'],
      ['cargo_ops_start_at', 'ata_vessel_start_discharging'],
      ['cargo_ops_end_at', 'ata_vessel_complete_discharge'],
    ]);
    expect(JPS_ATA_LANE.map((l) => l.column)).toEqual([
      'jps_ata_discharge_arrival',
      'jps_ata_discharge_berthed',
      'jps_ata_discharge_start',
      'jps_ata_discharge_complete',
    ]);
  });

  it('does not take tc, cast_off_at or sailed_at: sign-off and departure are not Hose Off', () => {
    const plan = planJpsAtaLane({
      tc: '2026-09-28T10:00:00Z',
      cast_off_at: '2026-09-28T11:00:00Z',
      sailed_at: '2026-09-29T16:30:00Z',
    });
    expect(plan).toEqual({});
  });
});

describe('planJpsAtaLane', () => {
  it('turns the four actuals into WIB dates', () => {
    expect(
      planJpsAtaLane({
        ta: '2026-09-27T20:00:00Z',
        tb: '2026-09-28T03:00:00Z',
        cargo_ops_start_at: '2026-09-28T07:45:00Z',
        cargo_ops_end_at: '2026-09-29T16:30:00Z',
      }),
    ).toEqual({
      jps_ata_discharge_arrival: '2026-09-28',
      jps_ata_discharge_berthed: '2026-09-28',
      jps_ata_discharge_start: '2026-09-28',
      jps_ata_discharge_complete: '2026-09-29',
    });
  });

  it('leaves a field JPS did not send alone, and clears one JPS sent as null', () => {
    // a v5.3 response has no cargo_ops_start_at at all
    expect(planJpsAtaLane({ ta: '2026-09-28T01:00:00Z' })).toEqual({ jps_ata_discharge_arrival: '2026-09-28' });
    // null is "not logged (any more)"
    expect(planJpsAtaLane({ ta: '2026-09-28T01:00:00Z', tb: null })).toEqual({
      jps_ata_discharge_arrival: '2026-09-28',
      jps_ata_discharge_berthed: null,
    });
    expect(planJpsAtaLane(undefined)).toEqual({});
    expect(planJpsAtaLane(null)).toEqual({});
  });
});

describe('applyJpsAtaLane', () => {
  beforeEach(() => {
    queryMock.mockReset();
    invalidateMock.mockReset();
  });

  /** shipments of the STO, then what the lane holds now; every later call is a write. */
  function mockDb(shipmentIds: string[], lane: Array<Record<string, string | null>>) {
    queryMock.mockImplementation(async (sql: string) => {
      if (/FROM shipments s/.test(sql)) return { rows: shipmentIds.map((id) => ({ id })) };
      if (/FROM shipment_ata_overrides/.test(sql) && /SELECT/.test(sql)) return { rows: lane };
      return { rows: [] };
    });
  }
  const writes = () => queryMock.mock.calls.filter((c) => /INSERT INTO shipment_ata_overrides/.test(String(c[0])));

  it('writes the lane for every shipment of the STO and refreshes them', async () => {
    mockDb(['a', 'b'], []);
    const result = await applyJpsAtaLane('1006019026', { ta: '2026-09-28T01:00:00Z', cargo_ops_end_at: '2026-09-29T16:30:00Z' });
    expect(result.changedShipmentIds).toEqual(['a', 'b']);
    expect(writes()).toHaveLength(2);
    const [sql, params] = writes()[0] as [string, unknown[]];
    expect(sql).toContain('jps_ata_discharge_arrival');
    expect(sql).toContain('jps_ata_discharge_complete');
    expect(sql).not.toContain('jps_ata_discharge_berthed');
    // a KLIP edit already on the row is not touched: only the jps_* columns are in the UPDATE
    expect(sql).not.toMatch(/\bata_discharge_arrival = EXCLUDED/);
    expect(params).toEqual(['a', '2026-09-28', '2026-09-29']);
    expect(invalidateMock).toHaveBeenCalledWith(['a', 'b']);
  });

  it('writes only the shipments whose lane differs, and nothing at all when JPS repeats itself', async () => {
    mockDb(['a', 'b'], [
      { shipment_id: 'a', jps_ata_discharge_arrival: '2026-09-28' },
      { shipment_id: 'b', jps_ata_discharge_arrival: '2026-09-20' },
    ]);
    const result = await applyJpsAtaLane('1006019026', { ta: '2026-09-28T01:00:00Z' });
    expect(result.changedShipmentIds).toEqual(['b']);
    expect(invalidateMock).toHaveBeenCalledWith(['b']);

    queryMock.mockClear();
    invalidateMock.mockClear();
    mockDb(['a'], [{ shipment_id: 'a', jps_ata_discharge_arrival: '2026-09-28' }]);
    const again = await applyJpsAtaLane('1006019026', { ta: '2026-09-28T01:00:00Z' });
    expect(again.changedShipmentIds).toEqual([]);
    expect(writes()).toHaveLength(0);
    expect(invalidateMock).not.toHaveBeenCalled();
  });

  it('clears a milestone JPS took back, but never creates an empty row to say so', async () => {
    mockDb(['a'], [{ shipment_id: 'a', jps_ata_discharge_arrival: '2026-09-28' }]);
    const cleared = await applyJpsAtaLane('1006019026', { ta: null });
    expect(cleared.changedShipmentIds).toEqual(['a']);
    expect((writes()[0] as [string, unknown[]])[1]).toEqual(['a', null]);

    queryMock.mockClear();
    mockDb(['b'], []);
    const nothing = await applyJpsAtaLane('1006019026', { ta: null });
    expect(nothing.changedShipmentIds).toEqual([]);
    expect(writes()).toHaveLength(0);
  });

  it('a dry run reports what would change and writes and refreshes nothing', async () => {
    mockDb(['a', 'b'], [{ shipment_id: 'a', jps_ata_discharge_arrival: '2026-09-28' }]);
    const result = await applyJpsAtaLane('1006019026', { ta: '2026-09-28T01:00:00Z' }, { dryRun: true });
    expect(result.changedShipmentIds).toEqual(['b']);
    expect(writes()).toHaveLength(0);
    expect(invalidateMock).not.toHaveBeenCalled();
  });

  it('does nothing for a response with no schedule, or an STO with no shipments', async () => {
    mockDb(['a'], []);
    expect((await applyJpsAtaLane('1006019026', undefined)).changedShipmentIds).toEqual([]);
    expect(queryMock).not.toHaveBeenCalled();
    mockDb([], []);
    expect((await applyJpsAtaLane('NOPE', { ta: '2026-09-28T01:00:00Z' })).changedShipmentIds).toEqual([]);
    expect(writes()).toHaveLength(0);
  });
});
