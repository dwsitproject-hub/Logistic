import { describe, expect, it } from 'vitest';
import {
  sqlRelevantContractNumbersWithB2bOrigins,
  sqlShipmentListB2bOriginContractJoins,
  sqlShipmentListExecutionCsStoJoin,
} from './shipmentB2bOriginSql';

describe('shipmentB2bOriginSql', () => {
  it('remaps B2B child shipment contract to origin (never parent+child)', () => {
    const sql = sqlShipmentListB2bOriginContractJoins();
    expect(sql).toContain('c_link ON s.contract_id = c_link.id');
    expect(sql).toContain('TRIM(o.po_number::text) = TRIM(l_link.contract_reference_po_raw)');
    expect(sql).toContain('COALESCE(c_origin.id, c_link.id)');
    expect(sql).not.toContain('c_origin.id +');
    expect(sql).toContain("= 'B2B'");
  });

  it('joins contract_stos on the execution contract, not the origin', () => {
    const sql = sqlShipmentListExecutionCsStoJoin('sto_key');
    expect(sql).toContain('cs_sto.contract_id = c_link.id');
    expect(sql).not.toContain('cs_sto.contract_id = c.id');
  });

  it('expands relevant_contract_numbers with origin POs of shipped children', () => {
    const sql = sqlRelevantContractNumbersWithB2bOrigins("c.incoterm IN ('CIF', 'FOB', 'CFR')");
    expect(sql).toContain('relevant_shipment_contracts');
    expect(sql).toContain('UNION');
    expect(sql).toContain('TRIM(o.po_number::text) = ch_reff.reff');
    expect(sql).toContain("data->'contract'->>'contract_reference_po'");
  });
});
