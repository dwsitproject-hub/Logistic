import { describe, expect, it } from 'vitest';
import {
  sqlContractDischargePortWithB2bChild,
  sqlShipmentB2bChildDischargePort,
  sqlShipmentDischargePortTypedByUser,
} from './b2bChildDischargePortSql';

const flat = (s: string) => s.replace(/\s+/g, ' ');

describe('a shipment\'s discharge port typed by a KLIP user (klip_edited_fields, migration 167)', () => {
  const sql = flat(sqlShipmentDischargePortTypedByUser('s'));

  it('is the shipment column, or the name of an ACTIVE discharge leg', () => {
    expect(sql).toContain("'port_of_discharge' = ANY(s.klip_edited_fields)");
    expect(sql).toContain('vt.shipment_id = s.id');
    expect(sql).toContain('COALESCE(vt.is_discharge_port, false) = true');
    expect(sql).toContain('COALESCE(vt.is_cancelled, false) = false');
    expect(sql).toContain("'port_name' = ANY(vt.klip_edited_fields)");
  });

  it('never infers: no comparison with SAP or with the child\'s port', () => {
    expect(sql).not.toContain('b2b_ending_child_snapshot');
    expect(sql).not.toContain('sap_processed_data');
  });

  it('follows the shipment alias it is given', () => {
    expect(flat(sqlShipmentDischargePortTypedByUser('sh'))).toContain("'port_of_discharge' = ANY(sh.klip_edited_fields)");
  });
});

describe('the ending child\'s port for a shipment', () => {
  const sql = flat(sqlShipmentB2bChildDischargePort('s', 'c'));

  it('is looked up by the contract\'s po_number, once, and only when nobody typed the shipment\'s port', () => {
    expect(sql).toContain("m.origin_po = NULLIF(TRIM(c.po_number), '')");
    expect(sql.match(/FROM b2b_ending_child_snapshot m/g)?.length).toBe(1);
    expect(sql).toContain('WHERE b2bc.p IS NOT NULL');
    expect(sql).toContain("AND NOT ( 'port_of_discharge' = ANY(s.klip_edited_fields)");
  });

  it('is NULL (no row) without a child port, so callers fall back to the shipment\'s own port', () => {
    expect(sql.startsWith('( SELECT b2bc.p FROM (SELECT')).toBe(true);
  });

  it('uses the aliases it is given', () => {
    const other = flat(sqlShipmentB2bChildDischargePort('sh', 'ct'));
    expect(other).toContain("m.origin_po = NULLIF(TRIM(ct.po_number), '')");
    expect(other).toContain('sh.klip_edited_fields');
  });
});

describe('a contract with no shipment', () => {
  it('is at its ending child\'s port, else its own', () => {
    const sql = flat(sqlContractDischargePortWithB2bChild('c.po_number', '(OWN PORT)'));
    expect(sql.startsWith('COALESCE(')).toBe(true);
    expect(sql.indexOf('b2b_ending_child_snapshot')).toBeLessThan(sql.indexOf('(OWN PORT)'));
    expect(sql.endsWith(', (OWN PORT))')).toBe(true);
  });
});
