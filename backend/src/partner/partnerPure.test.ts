import { describe, expect, it } from 'vitest';
import crypto from 'crypto';
import { assignRecordIds, newRecordId } from './identity';
import { mapCharterType, normalizeStage, isActiveStage, numberOrNull, stableStringify, toContractQuantity, wibIso } from './format';
import {
  buildPartnerRecord,
  contentHashOf,
  pairOf,
  partitionPartnerGroups,
  partnerIneligibleReason,
  type GroupRow,
  type LegRow,
  type LineRow,
  type PairRow,
  type PrimaryRow,
} from './recordBuilder';
import { decodeCursor, encodeCursor, parseCodeList, parseShipmentsQuery, PartnerQueryError } from './query';
import { buildListSql } from './shipmentsRoute';

const stored = (record_id: string, sto_key: string | null, member_ids: string[], first = '2026-11-01T00:00:00Z') => ({
  record_id,
  sto_key,
  member_ids,
  first_seen_at: first,
});

describe('record identity', () => {
  it('the same STO key keeps its record', () => {
    const r = assignRecordIds([{ stoKey: '1006000001', memberIds: ['a'] }], [stored('shp_1', '1006000001', ['a'])]);
    expect(r.keeps).toEqual(['shp_1']);
    expect(r.unclaimed).toEqual([]);
  });

  it('keeps the record when the key changes (OP- becomes an STO) because the shipments are the same', () => {
    const r = assignRecordIds([{ stoKey: '1006000001', memberIds: ['a', 'b'] }], [stored('shp_1', 'OP-1004000001-111', ['a', 'b'])]);
    expect(r.keeps).toEqual(['shp_1']);
  });

  it('a PO moved to its own operation: the group that keeps most of the shipments keeps the id, the other half gets a new one', () => {
    const r = assignRecordIds(
      [
        { stoKey: 'OP-NEW', memberIds: ['c'] },
        { stoKey: 'OP-OLD-2', memberIds: ['a', 'b'] },
      ],
      [stored('shp_1', 'OP-OLD', ['a', 'b', 'c'])],
    );
    expect(r.keeps).toEqual([null, 'shp_1']);
    expect(r.unclaimed).toEqual([]);
  });

  it('two records merged into one group: the one with the larger share keeps its id, the other is left unclaimed (retired)', () => {
    const r = assignRecordIds(
      [{ stoKey: 'K', memberIds: ['a', 'b', 'c'] }],
      [stored('shp_small', 'X', ['c']), stored('shp_big', 'Y', ['a', 'b'])],
    );
    expect(r.keeps).toEqual(['shp_big']);
    expect(r.unclaimed).toEqual(['shp_small']);
  });

  it('a tie on overlap goes to the older record', () => {
    const r = assignRecordIds(
      [{ stoKey: 'K', memberIds: ['a', 'b'] }],
      [stored('shp_new', 'X', ['a'], '2026-11-05T00:00:00Z'), stored('shp_old', 'Y', ['b'], '2026-11-01T00:00:00Z')],
    );
    expect(r.keeps).toEqual(['shp_old']);
  });

  it('a record never goes to two groups, and a group with no shared shipment is new', () => {
    const r = assignRecordIds(
      [
        { stoKey: 'K1', memberIds: ['a'] },
        { stoKey: 'K2', memberIds: ['a'] },
        { stoKey: 'K3', memberIds: ['z'] },
      ],
      [stored('shp_1', 'OLD', ['a'])],
    );
    expect(r.keeps.filter((k) => k === 'shp_1')).toHaveLength(1);
    expect(r.keeps[2]).toBeNull();
  });

  it('ids look like shp_ plus ten characters and do not repeat', () => {
    const ids = new Set(Array.from({ length: 500 }, () => newRecordId()));
    expect(ids.size).toBe(500);
    for (const id of ids) expect(id).toMatch(/^shp_[a-z0-9]{10}$/);
  });
});

describe('formatting rules', () => {
  it('leg times get the Jakarta offset, never a Z, and junk is null', () => {
    expect(wibIso('2026-11-02T10:00:00')).toBe('2026-11-02T10:00:00.000+07:00');
    expect(wibIso(null)).toBeNull();
    expect(wibIso('2026-11-02')).toBeNull();
    expect(wibIso('garbage')).toBeNull();
  });

  it('charter type: T/C and V/C become TC and VC; blank, an incoterm and Mix are null', () => {
    expect(mapCharterType('T/C')).toBe('TC');
    expect(mapCharterType('V/C')).toBe('VC');
    expect(mapCharterType(' t/c ')).toBe('TC');
    expect(mapCharterType('TC')).toBe('TC');
    for (const bad of ['', null, undefined, 'CIF', 'Mix', 'MIX']) expect(mapCharterType(bad)).toBeNull();
  });

  it('quantities: kilograms and unknown units become MT, metric tons stay, kilolitres stay KL, a litre is divided', () => {
    expect(toContractQuantity('5000000', 'KG')).toEqual({ quantity: 5000, unit: 'MT' });
    expect(toContractQuantity(497100, 'kg')).toEqual({ quantity: 497.1, unit: 'MT' });
    expect(toContractQuantity(5000, 'MT')).toEqual({ quantity: 5000, unit: 'MT' });
    expect(toContractQuantity(100, 'KL')).toEqual({ quantity: 100, unit: 'KL' });
    expect(toContractQuantity(100000, 'L')).toEqual({ quantity: 100, unit: 'KL' });
    expect(toContractQuantity(5000000, null)).toEqual({ quantity: 5000, unit: 'MT' });
    expect(toContractQuantity(null, 'KG')).toEqual({ quantity: null, unit: 'MT' });
    expect(toContractQuantity('x', 'KG').quantity).toBeNull();
  });

  it('unknown numbers are null, never 0', () => {
    expect(numberOrNull(null)).toBeNull();
    expect(numberOrNull('')).toBeNull();
    expect(numberOrNull('12.5')).toBe(12.5);
    expect(numberOrNull('abc')).toBeNull();
  });

  it('stages: active ones before Completed / Cancelled; CANCELED spells like CANCELLED', () => {
    for (const s of ['PLANNED', 'LOADING', 'SAILED', 'UNLOADING']) expect(isActiveStage(s)).toBe(true);
    for (const s of ['COMPLETED', 'CANCELLED', 'UNPLANNED']) expect(isActiveStage(s)).toBe(false);
    expect(normalizeStage('canceled')).toBe('CANCELLED');
  });

  it('stableStringify does not depend on key order', () => {
    expect(stableStringify({ b: 1, a: { d: 2, c: [3, { z: 1, y: 2 }] } })).toBe(stableStringify({ a: { c: [3, { y: 2, z: 1 }], d: 2 }, b: 1 }));
  });
});

const group = (over: Partial<GroupRow> = {}): GroupRow => ({
  sto_key: '1006000001',
  primary_id: 'p1',
  member_ids: ['p1'],
  master_vessel_id: 'mv1',
  stage: 'SAILED',
  eta_loading_arrival: '2026-11-02',
  ata_loading_arrival: '2026-11-02',
  ...over,
});

const primary = (over: Partial<PrimaryRow> = {}): PrimaryRow => ({
  primary_id: 'p1',
  shipment_no: 'SHP-1',
  voyage_no: 'V-07',
  charter_type: 'V/C',
  shipment_vessel_name: 'BG. SHIP NAME',
  shipment_vessel_code: 'msap1',
  mv_id: 'mv1',
  mv_name: 'BG. MASTER NAME',
  vessel_dhm_code: 'VSL-0001',
  mv_role: 'BG',
  mv_vessel_code: 'MSAP1',
  mv_alias_codes: ['MSAP1', 'MSAP1B'],
  loading_port_name: 'LP',
  loading_port_code: 'PRT-1',
  discharge_port_name: 'DP',
  discharge_port_code: null,
  ...over,
});

const pair = (over: Partial<PairRow> = {}): PairRow => ({
  pair_code: 'TBG-001',
  last_contract_date: '2026-10-01',
  bg_id: 'mv1',
  bg_name: 'BG. MASTER NAME',
  bg_code: 'VSL-0001',
  tb_id: 'mv2',
  tb_name: 'TB. TUG',
  tb_code: 'VSL-0002',
  ...over,
});

describe('record builder', () => {
  const build = (g = group(), p: PrimaryRow | undefined = primary(), pairs: PairRow[] = [pair()]) =>
    buildPartnerRecord({ group: g, primary: p, legs: [], lines: [], pairs });

  it('vessel: the DHM code, the SAP code (upper case) and every SAP code of the vessel for matching, the master name, TC/VC and the tug as pair', () => {
    const r = build();
    expect(r.vesselDhmCode).toBe('VSL-0001');
    expect(r.vesselSapCodes).toEqual(['MSAP1', 'MSAP1B']);
    expect(r.payload.vessel).toEqual({
      code: 'VSL-0001',
      sapCode: 'msap1',
      name: 'BG. MASTER NAME',
      role: 'BARGE',
      pair: { code: 'VSL-0002', name: 'TB. TUG', role: 'TUG' },
      charterType: 'VC',
    });
  });

  it('a vessel without a DHM code is sent with code null; a port without one keeps its name', () => {
    const r = build(group(), primary({ vessel_dhm_code: null, discharge_port_code: null }));
    expect((r.payload.vessel as { code: unknown }).code).toBeNull();
    expect(r.payload.dischargePort).toEqual({ dhmCode: null, name: 'DP' });
    expect(build(group(), primary({ loading_port_code: null, loading_port_name: null })).payload.loadingPort).toBeNull();
  });

  it('active follows the stage, and the hash changes when the stage does', () => {
    const live = build(group({ stage: 'LOADING' }));
    const done = build(group({ stage: 'COMPLETED' }));
    expect(live.active).toBe(true);
    expect(done.active).toBe(false);
    expect(live.contentHash).not.toBe(done.contentHash);
  });

  it('the same input always gives the same hash, and any visible change gives another', () => {
    expect(build().contentHash).toBe(build().contentHash);
    expect(build(group({ eta_loading_arrival: '2026-11-03' })).contentHash).not.toBe(build().contentHash);
    expect(contentHashOf({ a: 1 }, true)).toBe(crypto.createHash('sha256').update(stableStringify({ payload: { a: 1 }, active: true })).digest('hex'));
  });

  it('stoNumber is the key when it is a number, else the contract STO, else null', () => {
    expect(build().payload.stoNumber).toBe('1006000001');
    expect(build(group({ sto_key: 'OP-1004000001-1' })).payload.stoNumber).toBeNull();
    const withLine = buildPartnerRecord({
      group: group({ sto_key: 'OP-1' }),
      primary: primary(),
      legs: [],
      pairs: [],
      lines: [{ contract_sto_number: '1006555555', contract_uuid: 'c1', transport_mode: 'MIX' } as never],
    });
    expect(withLine.payload.stoNumber).toBe('1006555555');
    expect(withLine.payload.transportMode).toBe('MIX');
  });

  it('several member shipments of one contract are ONE line; the STO quantity wins over the contract quantity; price is only what is stored', () => {
    const r = buildPartnerRecord({
      group: group(),
      primary: primary(),
      legs: [],
      pairs: [],
      lines: [
        { contract_uuid: 'c1', contract_no: 'C-1', po_number: 'PO-1', product: 'CPO', product_code: 'CMD-6', supplier: 'S', unit: 'KG', quantity_ordered: '5000000', sto_quantity: '1500000', quantity_delivered: '0', unit_price: '12850', currency: 'IDR', contract_value: null } as never,
        { contract_uuid: 'c1', contract_no: 'C-1', po_number: 'PO-1', product: 'CPO', product_code: 'CMD-6', supplier: 'S', unit: 'KG', quantity_ordered: '5000000', sto_quantity: '1500000', quantity_delivered: '1000000', unit_price: '12850', currency: 'IDR', contract_value: null } as never,
      ],
    });
    const lines = r.payload.lines as Array<Record<string, any>>;
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ contractNo: 'C-1', quantity: 1500, unit: 'MT', quantityDelivered: 1000, quantityShipped: null });
    expect(lines[0].commercial).toEqual({ unitPrice: 12850, currency: 'IDR', contractValue: null });
    expect(lines[0].product).toEqual({ dhmCode: 'CMD-6', name: 'CPO' });
  });

  it('legs: loading calls first then discharge, numbered in that order, cancelled ones are already left out by the query', () => {
    const r = buildPartnerRecord({
      group: group(),
      primary: primary(),
      pairs: [],
      lines: [],
      legs: [
        { primary_id: 'p1', port_sequence: 3, is_discharge: true, port_name: 'D', master_port_name: null, port_code: 'PRT-D', eta_local: '2026-11-09T08:00:00', ata_local: null },
        { primary_id: 'p1', port_sequence: 2, is_discharge: false, port_name: 'L2', master_port_name: null, port_code: null, eta_local: null, ata_local: null },
        { primary_id: 'p1', port_sequence: 1, is_discharge: false, port_name: 'L1', master_port_name: 'Master L1', port_code: 'PRT-L1', eta_local: '2026-11-02T10:00:00', ata_local: '2026-11-02T10:30:00' },
      ],
    });
    const legs = r.payload.legs as Array<Record<string, any>>;
    expect(legs.map((l) => [l.role, l.sequence, l.port.name])).toEqual([
      ['loading', 1, 'Master L1'],
      ['loading', 2, 'L2'],
      ['discharge', 3, 'D'],
    ]);
    expect(legs[0].ata).toBe('2026-11-02T10:30:00.000+07:00');
  });

  it('pairOf: the pair with the latest contract date wins, then the higher code; a tug sees its barge', () => {
    const pairs = [pair({ pair_code: 'TBG-001', last_contract_date: '2026-01-01' }), pair({ pair_code: 'TBG-002', last_contract_date: '2026-09-01', tb_id: 'mv3', tb_code: 'VSL-0003', tb_name: 'TB. B' })];
    expect(pairOf('mv1', pairs)?.pairCode).toBe('TBG-002');
    expect(pairOf('mv3', pairs)).toMatchObject({ pairCode: 'TBG-002', other: { code: 'VSL-0001', role: 'BARGE' } });
    expect(pairOf('mvX', pairs)).toBeNull();
    expect(pairOf(null, pairs)).toBeNull();
  });
});

/**
 * Which shipments KMAPS is sent (Ryan, 2026-11-11). STO 1006020770 reached KMAPS as an active Planned record: vessel BG. AS MARINA 12, no ETA, no ATA, no port,
 * no leg, nothing delivered - an SAP-imported shell that the Shipments page calls Planned because every row with an STO is.
 */
describe('eligibility: a vessel AND some schedule', () => {
  const noDates: Partial<GroupRow> = {
    eta_loading_arrival: null,
    ata_loading_arrival: null,
  };
  const noPorts: Partial<PrimaryRow> = {
    loading_port_name: null,
    loading_port_code: null,
    discharge_port_name: null,
    discharge_port_code: null,
  };
  const shellPrimary = (over: Partial<PrimaryRow> = {}) => primary({ ...noPorts, ...over });
  const leg = (): LegRow => ({
    primary_id: 'p1',
    port_sequence: 1,
    is_discharge: false,
    port_name: 'LP',
    master_port_name: null,
    port_code: null,
    eta_local: null,
    ata_local: null,
  });
  const line = (over: Partial<LineRow> = {}): LineRow =>
    ({ sto_key: '1006000001', shipment_uuid: 'p1', contract_uuid: 'c1', quantity_delivered: null, ...over }) as LineRow;
  const reason = (g: GroupRow, p: PrimaryRow | undefined, legs: LegRow[] = [], lines: LineRow[] = []) => partnerIneligibleReason({ group: g, primary: p, legs, lines });

  it('the empty SAP shell of STO 1006020770 (vessel named, nothing else) is not sent', () => {
    expect(reason(group(noDates), shellPrimary(), [], [line()])).toBe('no_schedule');
  });

  it('a vessel and any one date is sent, ETA or ATA, at either end of the voyage', () => {
    expect(reason(group({ ...noDates, eta_loading_arrival: '2026-11-20' }), shellPrimary())).toBeNull();
    expect(reason(group({ ...noDates, ata_loading_end: '2026-11-02' }), shellPrimary())).toBeNull();
    expect(reason(group({ ...noDates, eta_discharge_end: '2026-11-25' }), shellPrimary())).toBeNull();
  });

  it('a port, a planned leg or a delivered quantity each count as a schedule; a zero or empty quantity does not', () => {
    expect(reason(group(noDates), shellPrimary({ loading_port_name: 'LP' }))).toBeNull();
    expect(reason(group(noDates), shellPrimary({ discharge_port_code: 'PRT-2' }))).toBeNull();
    expect(reason(group(noDates), shellPrimary(), [leg()])).toBeNull();
    expect(reason(group(noDates), shellPrimary(), [], [line({ quantity_delivered: '1500' })])).toBeNull();
    expect(reason(group(noDates), shellPrimary(), [], [line({ quantity_delivered: 0 }), line({ quantity_delivered: '' })])).toBe('no_schedule');
  });

  it('dates but no vessel at all is not sent; a vessel KLIP can only name, or only code by SAP, is (KMAPS lists it as unmapped)', () => {
    const noVessel = shellPrimary({
      shipment_vessel_name: null,
      shipment_vessel_code: null,
      mv_id: null,
      mv_name: null,
      vessel_dhm_code: null,
      mv_vessel_code: null,
    });
    expect(reason(group(), noVessel)).toBe('no_vessel');
    expect(reason(group(), { ...noVessel, shipment_vessel_name: 'MV NAME ONLY' })).toBeNull();
    expect(reason(group(), { ...noVessel, shipment_vessel_code: 'SAP9' })).toBeNull();
    expect(reason(group(), { ...noVessel, vessel_dhm_code: null, mv_id: 'mv9' })).toBeNull();
  });

  it('neither a vessel nor a schedule says both; blank strings are as empty as null', () => {
    const blank = shellPrimary({ shipment_vessel_name: '  ', shipment_vessel_code: '', mv_id: null, mv_name: null, vessel_dhm_code: null, mv_vessel_code: null });
    expect(reason(group({ ...noDates, eta_sailed: '  ' }), blank)).toBe('no_vessel_no_schedule');
  });

  it('a group whose primary shipment the read did not return is not judged: it keeps its record rather than retiring a real shipment on a missing read', () => {
    expect(reason(group(noDates), undefined)).toBeNull();
  });

  it('partition: eligible groups are built, the others only give their member ids and a count per reason', () => {
    const real = group({ sto_key: 'A', primary_id: 'pa', member_ids: ['pa', 'pa2'] });
    const shell = group({ ...noDates, sto_key: 'B', primary_id: 'pb', member_ids: ['pb'] });
    const noVesselDated = group({ sto_key: 'C', primary_id: 'pc', member_ids: ['pc'] });
    const primaryById = new Map<string, PrimaryRow>([
      ['pa', primary({ primary_id: 'pa' })],
      ['pb', shellPrimary({ primary_id: 'pb' })],
      [
        'pc',
        shellPrimary({
          primary_id: 'pc',
          shipment_vessel_name: null,
          shipment_vessel_code: null,
          mv_id: null,
          mv_name: null,
          vessel_dhm_code: null,
          mv_vessel_code: null,
        }),
      ],
    ]);
    const out = partitionPartnerGroups({ groups: [real, shell, noVesselDated], primaryById, legsById: new Map(), linesByKey: new Map() });
    expect(out.eligible.map((g) => g.sto_key)).toEqual(['A']);
    expect([...out.ineligibleMemberIds].sort()).toEqual(['pb', 'pc']);
    expect(out.ineligibleByReason).toEqual({ no_vessel: 1, no_schedule: 1, no_vessel_no_schedule: 0 });
  });
});

describe('query parameters', () => {
  it('defaults: a full read of 500', () => {
    expect(parseShipmentsQuery({})).toMatchObject({ limit: 500, mode: 'full', includeDeleted: false, vesselCodes: [], sapCodes: [], updatedSince: null });
  });

  it('modes: vessel codes or SAP codes make a vessel read; updatedSince an incremental one; codes win over updatedSince', () => {
    expect(parseShipmentsQuery({ vesselCode: 'VSL-1' }).mode).toBe('vessel');
    expect(parseShipmentsQuery({ sapCode: 'm1' }).mode).toBe('vessel');
    expect(parseShipmentsQuery({ updatedSince: '2026-11-01T00:00:00Z' }).mode).toBe('incremental');
    expect(parseShipmentsQuery({ vesselCode: 'VSL-1', updatedSince: '2026-11-01T00:00:00Z' }).mode).toBe('vessel');
  });

  it('code lists: trimmed, de-duplicated, SAP codes upper-cased; 100 is fine and 101 is an error', () => {
    expect(parseCodeList(' a, b ,,a ', 'x')).toEqual(['a', 'b']);
    expect(parseShipmentsQuery({ sapCode: 'ab, cd' }).sapCodes).toEqual(['AB', 'CD']);
    expect(parseCodeList(Array.from({ length: 100 }, (_, i) => `c${i}`).join(','), 'x')).toHaveLength(100);
    expect(() => parseCodeList(Array.from({ length: 101 }, (_, i) => `c${i}`).join(','), 'vesselCode')).toThrow(PartnerQueryError);
  });

  it('limit, includeDeleted, updatedSince and cursor are validated', () => {
    for (const bad of [{ limit: '0' }, { limit: '501' }, { limit: 'x' }, { limit: '1.5' }, { includeDeleted: 'yes' }, { updatedSince: 'yesterday' }, { cursor: '!!' }]) {
      expect(() => parseShipmentsQuery(bad)).toThrow(PartnerQueryError);
    }
    expect(parseShipmentsQuery({ limit: '1', includeDeleted: 'true' })).toMatchObject({ limit: 1, includeDeleted: true });
  });

  it('a cursor carries its mode and wins over updatedSince; a vessel cursor needs the vessel codes again', () => {
    const cursor = encodeCursor('incremental', '2026-11-06 06:30:00.123456+00', 'shp_abcdefghij');
    expect(decodeCursor(cursor)).toEqual({ mode: 'incremental', updatedAt: '2026-11-06 06:30:00.123456+00', recordId: 'shp_abcdefghij' });
    const parsed = parseShipmentsQuery({ cursor, updatedSince: '2020-01-01T00:00:00Z' });
    expect(parsed).toMatchObject({ mode: 'incremental', updatedSince: null, after: { recordId: 'shp_abcdefghij' } });
    expect(() => parseShipmentsQuery({ cursor: encodeCursor('vessel', '2026-11-06T00:00:00Z', 'shp_abcdefghij') })).toThrow(PartnerQueryError);
  });
});

describe('list SQL', () => {
  const sql = (q: Record<string, unknown>) => buildListSql(parseShipmentsQuery(q)).text;

  it('a vessel read shows live active records only unless updatedSince is given; the full read never shows tombstones', () => {
    expect(sql({ vesselCode: 'V' })).toContain('(NOT r.deleted AND r.active)');
    expect(sql({ vesselCode: 'V', updatedSince: '2026-01-01T00:00:00Z' })).toContain('r.left_active_at');
    expect(sql({ includeDeleted: 'true' })).not.toContain('r.deleted AND r.deleted_at');
    expect(sql({ vesselCode: 'V', includeDeleted: 'true' })).toContain('r.deleted AND r.deleted_at');
  });

  it('every request is ordered by (updatedAt, id) and asks for one more than the page to know whether there is more', () => {
    const built = buildListSql(parseShipmentsQuery({ limit: '7', vesselCode: 'V' }));
    expect(built.text).toContain('ORDER BY r.updated_at, r.record_id');
    expect(built.params[built.params.length - 1]).toBe(8);
  });
});
