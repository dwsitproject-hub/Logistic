import { describe, expect, it } from 'vitest';
import {
  buildShipmentDischargePortFilter,
  buildShipmentDischargePortOptionsSql,
  normalizeDischargePortIdentity,
  parseDischargePortParam,
  resolveDischargePortSelection,
  resolveDischargePortSelectionKey,
  sqlDischargePortIdentity,
} from './shipmentDischargePortSql';
import { buildShipmentListCacheKey } from '../services/shipmentList.service';
import { shipmentPageOptionsScopeSql } from './shipmentProductOptionsSql';

describe('Shipments Discharge Port filter: which spellings are one port', () => {
  it('PORT / PORT OF / JETTY ... prefixes, case and punctuation do not make another port (same rule as the Shipments list)', () => {
    const same = ['BONTANG', 'Port Bontang', 'PORT OF BONTANG', 'port  of  bontang', 'Pelabuhan Bontang', 'PORT-BONTANG'];
    expect(new Set(same.map(normalizeDischargePortIdentity))).toEqual(new Set(['BONTANG']));
    expect(normalizeDischargePortIdentity('PORT DUMAI')).toBe('DUMAI');
    expect(normalizeDischargePortIdentity('DUMAI')).not.toBe(normalizeDischargePortIdentity('BONTANG'));
    // a plant name is NOT folded onto a port in phase 1 (that is the Master Port mapping, queued)
    expect(normalizeDischargePortIdentity('EUP EDIBLE OIL BONTANG')).toBe('EUP EDIBLE OIL BONTANG');
  });

  it('a name that merely starts with OF-something is not cut', () => {
    expect(normalizeDischargePortIdentity('PORT OFFSHORE TERMINAL 1')).toBe('OFFSHORE TERMINAL 1');
  });
});

describe('Shipments Discharge Port filter: the selection', () => {
  it('reads one value or a repeated param, trimmed and without blanks', () => {
    expect(parseDischargePortParam('BONTANG')).toEqual(['BONTANG']);
    expect(parseDischargePortParam([' A ', '', 'B'])).toEqual(['A', 'B']);
    expect(parseDischargePortParam(undefined)).toEqual([]);
    expect(parseDischargePortParam('')).toEqual([]);
  });

  it('turns picks into identities, Blank into a flag, and drops values that are not ports', () => {
    expect(resolveDischargePortSelection(['Port Bontang', 'BONTANG', 'blank', '74.66', '0.00', 'Discharge Port'])).toEqual({
      identities: ['BONTANG'],
      includeBlank: true,
    });
    expect(resolveDischargePortSelection([])).toEqual({ identities: [], includeBlank: false });
  });

  it('two spellings of one pick share a cache key; Blank is part of it', () => {
    expect(resolveDischargePortSelectionKey(['PORT BONTANG'])).toEqual(resolveDischargePortSelectionKey(['bontang']));
    expect(resolveDischargePortSelectionKey(['BONTANG', 'Blank'])).toEqual(['BONTANG', 'blank']);
  });
});

describe('Shipments Discharge Port filter: the SQL', () => {
  it('adds nothing when no port is picked, and moves no parameter index', () => {
    expect(buildShipmentDischargePortFilter([], 7)).toEqual({ sql: '', params: [], nextIndex: 7 });
    expect(buildShipmentDischargePortFilter(['0.00'], 7).sql).toBe('');
  });

  it('binds ONE text[] of identities at the given index, however many ports are picked', () => {
    const f = buildShipmentDischargePortFilter(['PORT BONTANG', 'bontang', 'DUMAI'], 4);
    expect(f.params).toEqual([['BONTANG', 'DUMAI']]);
    expect(f.nextIndex).toBe(5);
    expect(f.sql).toContain('= ANY($4::text[])');
    expect(f.sql).not.toMatch(/\$[5-9]/);
  });

  it('follows the table: the active discharge legs first, the shipment column only when it has no named leg', () => {
    const sql = buildShipmentDischargePortFilter(['BONTANG'], 1).sql.replace(/\s+/g, ' ');
    expect(sql).toContain('vd.shipment_id = s.id');
    expect(sql).toContain('COALESCE(vd.is_discharge_port, false) = true');
    expect(sql).toContain('COALESCE(vd.is_cancelled, false) = false');
    // the shipment's own column is consulted only behind a NOT EXISTS of a named leg
    expect(sql).toMatch(/\(NOT EXISTS \( SELECT 1 FROM vessel_loading_ports vd [^)]*\)[\s\S]*s\.port_of_discharge/);
  });

  it('Blank alone binds nothing and finds shipments with no named port (NULL counts as none)', () => {
    const f = buildShipmentDischargePortFilter(['Blank'], 3);
    expect(f.params).toEqual([]);
    expect(f.nextIndex).toBe(3);
    expect(f.sql).toContain('COALESCE(');
    expect(f.sql).toContain(', TRUE)');
    expect(f.sql).not.toContain('ANY(');
  });

  it('Blank together with ports adds an arm instead of replacing them', () => {
    const f = buildShipmentDischargePortFilter(['DUMAI', 'Blank'], 1);
    expect(f.sql).toContain('= ANY($1::text[])');
    expect(f.sql).toContain(', TRUE)');
  });

  it('the regex reaches Postgres with single backslashes (String.raw), in the filter and the options', () => {
    expect(sqlDischargePortIdentity('x')).toContain(String.raw`(\s+OF)?\s+`);
    expect(sqlDischargePortIdentity('x')).not.toContain('\\\\');
    expect(buildShipmentDischargePortFilter(['A'], 1).sql).toContain(String.raw`(\s+OF)?\s+`);
  });

  it('uses the shipment alias it is given', () => {
    expect(buildShipmentDischargePortFilter(['A'], 1, 'sh').sql).toContain('vd.shipment_id = sh.id');
    expect(buildShipmentDischargePortFilter(['A'], 1, 'sh').sql).toContain('sh.port_of_discharge');
  });
});

describe('Shipments Discharge Port options SQL', () => {
  const sql = buildShipmentDischargePortOptionsSql(shipmentPageOptionsScopeSql()).replace(/\s+/g, ' ');

  it('lists the page\'s own shipments only: the incoterm scope, a contract SAP still carries, no B2B child', () => {
    expect(sql).toContain("IN ('CIF', 'FOB', 'CFR')");
    expect(sql).toContain("COALESCE(c.sap_presence, 'PRESENT') = 'PRESENT'");
    expect(sql).toContain("= 'B2B'");
  });

  it('reads both places a port lives, active legs only, and leaves out blanks and codes', () => {
    expect(sql).toContain('port_of_discharge');
    expect(sql).toContain('vd.port_name');
    expect(sql).toContain('COALESCE(vd.is_cancelled, false) = false');
    expect(sql).toContain('WHERE NOT COALESCE(');
    // a list query binds nothing
    expect(sql).not.toMatch(/\$\d/);
  });
});

describe('Discharge Port in the Shipments list cache key', () => {
  const base = { plants: [] as string[], globalSearch: '', colFilters: {}, skipSapJoin: false };

  it('leaves every existing key unchanged when no port is picked', () => {
    expect(buildShipmentListCacheKey({ ...base })).toBe(buildShipmentListCacheKey({ ...base, dischargePorts: [] }));
    expect(buildShipmentListCacheKey({ ...base })).not.toContain('dischargePorts');
  });

  it('differs per pick, and is the same for two spellings of one pick', () => {
    const a = buildShipmentListCacheKey({ ...base, dischargePorts: ['PORT BONTANG'] });
    expect(a).not.toBe(buildShipmentListCacheKey({ ...base }));
    expect(a).toBe(buildShipmentListCacheKey({ ...base, dischargePorts: ['bontang'] }));
    expect(a).not.toBe(buildShipmentListCacheKey({ ...base, dischargePorts: ['DUMAI'] }));
  });
});
