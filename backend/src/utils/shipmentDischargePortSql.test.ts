import { describe, expect, it } from 'vitest';
import {
  buildContractDischargePortFilter,
  buildDischargePortFilters,
  buildShipmentDischargePortFilter,
  buildShipmentDischargePortOptionsSql,
  buildShipmentMasterPortOptionsSql,
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

  it('Blank is no pick any more: a remembered one adds nothing and binds nothing', () => {
    expect(buildShipmentDischargePortFilter(['Blank'], 3)).toEqual({ sql: '', params: [], nextIndex: 3 });
    expect(buildContractDischargePortFilter(['blank'], 3)).toEqual({ sql: '', params: [], nextIndex: 3 });
    // next to a real pick it is ignored, not an extra arm
    const f = buildShipmentDischargePortFilter(['DUMAI', 'Blank'], 1);
    expect(f.params).toEqual([['DUMAI']]);
    // no arm for 'blank': the only bound array is the labels of the real picks, read through UNNEST
    expect(f.sql).not.toContain('ANY($1::text[])');
  });

  it('binds ONE text[] of the picked Master Port labels at the given index, however many ports are picked', () => {
    const f = buildShipmentDischargePortFilter(['Port Bontang', 'port bontang', 'DUMAI'], 4);
    expect(f.params).toEqual([['DUMAI', 'PORT BONTANG']]);
    expect(f.nextIndex).toBe(5);
    expect(f.sql).toContain('UNNEST($4::text[])');
    expect(f.sql).not.toMatch(/\$[5-9]/);
  });

  it('matches on Master Port ids: each picked label is resolved by klip_resolve_master_port_id, and the rows carry the id of their text', () => {
    const sql = buildShipmentDischargePortFilter(['BONTANG'], 1).sql.replace(/\s+/g, ' ');
    expect(sql).toContain('klip_resolve_master_port_id(pk.x)');
    // ANY((SELECT ...)) is read as ANY over a subquery's ROWS (uuid = uuid[] fails in Postgres); the cast makes it one array value
    expect(sql).toContain('AS pk(x))::uuid[]');
    expect(sql).toContain('vd.master_port_id = ANY(');
    expect(sql).toContain('s.discharge_master_port_id = ANY(');
    // the bound array is only ever read through UNNEST, to resolve the labels - no text of the rows is compared to it
    expect(sql).not.toContain('ANY($1::text[])');
    expect(sql).not.toContain('vd.port_name)) = ');
  });

  it('follows the table: the active discharge legs first, the shipment column only when it has no named leg', () => {
    const sql = buildShipmentDischargePortFilter(['BONTANG'], 1).sql.replace(/\s+/g, ' ');
    expect(sql).toContain('vd.shipment_id = s.id');
    expect(sql).toContain('COALESCE(vd.is_discharge_port, false) = true');
    expect(sql).toContain('COALESCE(vd.is_cancelled, false) = false');
    // the shipment's own id is consulted only behind a NOT EXISTS of a named leg
    expect(sql).toMatch(/\(NOT EXISTS \( SELECT 1 FROM vessel_loading_ports vd [^)]*\)[\s\S]*s\.discharge_master_port_id/);
  });

  it('a shipment with no Master Port (a text nobody mapped, or none) matches no pick: NULL = ANY is not true', () => {
    const sql = buildShipmentDischargePortFilter(['DUMAI'], 1).sql;
    expect(sql).toContain('s.discharge_master_port_id = ANY(');
    // the old Blank arm (a missing port counts as a match) is gone
    expect(sql).not.toContain('IS NULL THEN TRUE');
  });

  it('the regex reaches Postgres with single backslashes (String.raw), in the options', () => {
    expect(sqlDischargePortIdentity('x')).toContain(String.raw`(\s+OF)?\s+`);
    expect(sqlDischargePortIdentity('x')).not.toContain('\\\\');
  });

  it('uses the shipment alias it is given', () => {
    expect(buildShipmentDischargePortFilter(['A'], 1, 'sh').sql).toContain('vd.shipment_id = sh.id');
    expect(buildShipmentDischargePortFilter(['A'], 1, 'sh').sql).toContain('sh.discharge_master_port_id');
  });
});

describe('Shipments Discharge Port filter: shipments and backlog contracts share one parameter', () => {
  it('both predicates read the same $n, so the callers move their numbering by one, not two', () => {
    const f = buildDischargePortFilters(['BONTANG', 'DUMAI'], 5);
    expect(f.params).toEqual([['BONTANG', 'DUMAI']]);
    expect(f.nextIndex).toBe(6);
    expect(f.shipmentSql).toContain('UNNEST($5::text[])');
    expect(f.contractSql).toContain('UNNEST($5::text[])');
    expect(f.shipmentSql + f.contractSql).not.toMatch(/\$[6-9]/);
  });

  it('the contract predicate reads the newest SAP row\'s Vessel Discharge Port, once, the way the backlog rows are drawn, and resolves it to a Master Port', () => {
    const sql = buildContractDischargePortFilter(['BONTANG'], 1).sql.replace(/\s+/g, ' ');
    expect(sql).toContain("spd.data->'raw'->>'Vessel Discharge Port'");
    expect(sql).toContain('ORDER BY spd.created_at DESC NULLS LAST LIMIT 1');
    expect(sql).toContain('spd.contract_number = c.contract_id');
    expect(sql).toContain('klip_resolve_master_port_id(bp.p)');
    // numeric SAP codes and blanks are no port, as in the table
    expect(sql).toContain("IN ('', '0', '0.00')");
    // one scalar subquery per contract: the SAP lookup is not repeated
    expect(sql.match(/FROM sap_processed_data spd/g)?.length).toBe(1);
  });

  it('a contract whose text has no Master Port matches no pick (COALESCE(..., FALSE))', () => {
    const sql = buildContractDischargePortFilter(['DUMAI'], 3).sql.replace(/\s+/g, ' ');
    expect(sql.startsWith('COALESCE(')).toBe(true);
    expect(sql.endsWith(', FALSE)')).toBe(true);
  });

  it('is empty, and binds nothing, for no pick', () => {
    expect(buildContractDischargePortFilter([], 2)).toEqual({ sql: '', params: [], nextIndex: 2 });
    expect(buildDischargePortFilters(['74.66'], 2)).toEqual({ shipmentSql: '', contractSql: '', params: [], nextIndex: 2 });
  });

  it('uses the contract reference it is given', () => {
    expect(buildContractDischargePortFilter(['A'], 1, 'k.contract_id').sql).toContain('spd.contract_number = k.contract_id');
  });
});

describe('Shipments Discharge Port filter: a B2B parent is at its ending child\'s port', () => {
  const sql = (ports: string[]) => buildShipmentDischargePortFilter(ports, 1).sql.replace(/\s+/g, ' ');

  it('reads the child\'s port from the snapshot by the contract\'s po_number, behind the fresh guard', () => {
    const s = sql(['PORT BATAM']);
    expect(s).toContain('FROM b2b_ending_child_snapshot m');
    expect(s).toContain('m.origin_po = NULLIF(TRIM(c.po_number), \'\')');
    expect(s).toContain('b2b_ending_child_snapshot_meta');
    expect(s).toContain('is_stale IS TRUE');
  });

  it('the child\'s port, resolved to a Master Port, decides when there is one, and only otherwise do the shipment\'s own ports', () => {
    const s = sql(['BATAM']);
    // COALESCE(<verdict of the child port, NULL without one>, <the own-port arms>)
    expect(s.startsWith('COALESCE( (SELECT CASE WHEN bc.p IS NULL THEN NULL ELSE')).toBe(true);
    expect(s).toContain('klip_resolve_master_port_id(bc.p) = ANY(');
    expect(s.indexOf('b2b_ending_child_snapshot')).toBeLessThan(s.indexOf('vessel_loading_ports vd'));
  });

  it('a port a KLIP user typed beats the child\'s: on the shipment or on an active discharge leg (klip_edited_fields)', () => {
    const s = sql(['BATAM']);
    expect(s).toContain("'port_of_discharge' = ANY(s.klip_edited_fields)");
    expect(s).toContain("'port_name' = ANY(vt.klip_edited_fields)");
    expect(s).toContain('COALESCE(vt.is_cancelled, false) = false');
    expect(s).toContain('NOT (');
  });

  it('the child lookup is evaluated once per shipment (one scalar subquery), not once per arm', () => {
    expect(sql(['BATAM', 'DUMAI']).match(/FROM b2b_ending_child_snapshot m/g)?.length).toBe(1);
  });

  it('a contract with no shipment gets the child\'s port too, else its own SAP port', () => {
    const c = buildContractDischargePortFilter(['PORT BATAM'], 1).sql.replace(/\s+/g, ' ');
    expect(c).toContain('FROM b2b_ending_child_snapshot m');
    expect(c).toContain('m.origin_po = NULLIF(TRIM(c.po_number), \'\')');
    expect(c).toContain("spd.data->'raw'->>'Vessel Discharge Port'");
    expect(c.indexOf('b2b_ending_child_snapshot')).toBeLessThan(c.indexOf('sap_processed_data'));
    // the contract's own text is read once
    expect(c.match(/FROM sap_processed_data spd/g)?.length).toBe(1);
  });

  it('the contract reference follows the id reference it is given', () => {
    const c = buildContractDischargePortFilter(['A'], 1, 'k.contract_id').sql.replace(/\s+/g, ' ');
    expect(c).toContain('m.origin_po = NULLIF(TRIM(k.po_number), \'\')');
  });
});

describe('Shipments Discharge Port options as Master Ports', () => {
  const sql = buildShipmentMasterPortOptionsSql(shipmentPageOptionsScopeSql()).replace(/\s+/g, ' ');

  it('lists each text of the page resolved to its Master Port, once, and drops a text with no Master Port (the join)', () => {
    expect(sql).toContain('JOIN master_loading_ports mp ON mp.id = klip_resolve_master_port_id(l.label)');
    expect(sql).toContain('SELECT DISTINCT UPPER(BTRIM(mp.port)) AS label');
  });

  it('is built on the same page scope and sources as the raw options', () => {
    expect(sql).toContain("IN ('CIF', 'FOB', 'CFR')");
    expect(sql).toContain('WITH page_shipments AS');
    expect(sql).toContain('page_backlog');
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
