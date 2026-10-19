import { describe, expect, it } from 'vitest';
import { sqlSapQtySharedAcrossShipments } from './shipmentSapQtyShared';

describe('sqlSapQtySharedAcrossShipments', () => {
  const sql = sqlSapQtySharedAcrossShipments('sp.sto_key', 'sp.contract_numbers').replace(/\s+/g, ' ');

  it('only KLIP-identified groups are candidates: a real SAP STO key (digits) is never flagged', () => {
    expect(sql).toContain("~ '^(OP-|MNL-|MSEA-)'");
  });

  it('flags a group when one of its contracts sits in another ACTIVE group, told apart by operation id / shipment id, not by STO', () => {
    expect(sql).toContain("UPPER(TRIM(COALESCE(sq_o.status, ''))) NOT IN ('CANCELLED', 'CANCELED')");
    expect(sql).toContain("COALESCE(NULLIF(TRIM(sq_o.operation_id::text), ''), NULLIF(TRIM(sq_o.shipment_id::text), ''))");
    expect(sql).toContain('IS DISTINCT FROM TRIM((sp.sto_key)::text)');
    // the group's own shipments (same key) never count as "another"
    expect(sql).not.toContain('sto_number');
  });

  it('reads the contract list of the group, comma separated, whitespace removed', () => {
    expect(sql).toContain("string_to_array(regexp_replace(COALESCE((sp.contract_numbers)::text, ''), '\\s', '', 'g'), ',')");
  });

  it('takes the two expressions it is given (the Edit Shipment payload passes bind parameters)', () => {
    const edit = sqlSapQtySharedAcrossShipments('$1::text', '$2::text').replace(/\s+/g, ' ');
    expect(edit).toContain('($1::text)::text');
    expect(edit).toContain('($2::text)::text');
  });
});
