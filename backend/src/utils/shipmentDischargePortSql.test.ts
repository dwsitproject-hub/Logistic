import { describe, expect, it } from 'vitest';
import {
  buildContractDischargePortFilter,
  buildDischargePortFilters,
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

describe('Shipments Discharge Port filter: shipments and backlog contracts share one parameter', () => {
  it('both predicates read the same $n, so the callers move their numbering by one, not two', () => {
    const f = buildDischargePortFilters(['BONTANG', 'DUMAI'], 5);
    expect(f.params).toEqual([['BONTANG', 'DUMAI']]);
    expect(f.nextIndex).toBe(6);
    expect(f.shipmentSql).toContain('= ANY($5::text[])');
    expect(f.contractSql).toContain('= ANY($5::text[])');
    expect(f.shipmentSql + f.contractSql).not.toMatch(/\$[6-9]/);
  });

  it('the contract predicate reads the newest SAP row\'s Vessel Discharge Port, once, the way the backlog rows are drawn', () => {
    const sql = buildContractDischargePortFilter(['BONTANG'], 1).sql.replace(/\s+/g, ' ');
    expect(sql).toContain("spd.data->'raw'->>'Vessel Discharge Port'");
    expect(sql).toContain('ORDER BY spd.created_at DESC NULLS LAST LIMIT 1');
    expect(sql).toContain('spd.contract_number = c.contract_id');
    // numeric SAP codes and blanks are no port, as in the table
    expect(sql).toContain("IN ('', '0', '0.00')");
    // one scalar subquery per contract: the SAP lookup is not repeated per arm
    expect(sql.match(/FROM sap_processed_data spd/g)?.length).toBe(1);
  });

  it('Blank finds a contract whose SAP row names no port; with a port too it is one more arm', () => {
    const blank = buildContractDischargePortFilter(['Blank'], 3);
    expect(blank.params).toEqual([]);
    expect(blank.nextIndex).toBe(3);
    const both = buildContractDischargePortFilter(['DUMAI', 'Blank'], 3);
    expect(both.sql).toContain('= ANY($3::text[])');
    expect(both.sql).toContain(' OR ');
  });

  it('is empty, and binds nothing, for no pick', () => {
    expect(buildContractDischargePortFilter([], 2)).toEqual({ sql: '', params: [], nextIndex: 2 });
    expect(buildDischargePortFilters(['74.66'], 2)).toEqual({ shipmentSql: '', contractSql: '', params: [], nextIndex: 2 });
  });

  it('uses the contract reference it is given', () => {
    expect(buildContractDischargePortFilter(['A'], 1, 'k.contract_id').sql).toContain('spd.contract_number = k.contract_id');
  });
});

describe('Shipments Discharge Port options SQL', () => {
  const sql = buildShipmentDischargePortOptionsSql(shipmentPageOptionsScopeSql()).replace(/\s+/g, ' ');

  it('lists the page\'s own shipments only: the incoterm scope, a contract SAP still carries, no B2B child', () => {
    expect(sql).toContain("IN ('CIF', 'FOB', 'CFR')");
    expect(sql).toContain("COALESCE(c.sap_presence, 'PRESENT') = 'PRESENT'");
    expect(sql).toContain("= 'B2B'");
  });

  it('offers the SAP port of the backlog contracts too: those with no shipment yet', () => {
    expect(sql).toContain('page_backlog AS');
    expect(sql).toContain('NOT EXISTS (SELECT 1 FROM shipments sx WHERE sx.contract_id = c.id)');
    expect(sql).toContain("spd.data->'raw'->>'Vessel Discharge Port'");
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
