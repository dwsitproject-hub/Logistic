import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  buildStoLinkedContractCountSql,
  buildStoLinkedPoNumbersSql,
  contractIdOnStoSql,
  contractsOnStoSubquery,
} from './stoLinkedContractSql';

const KEY = "NULLIF(TRIM(g.sto_key::text), '')";
const OWN = { memberShipmentIdsExpr: 'g.member_shipment_ids' };
const flat = (s: string) => s.replace(/\s+/g, ' ');

describe('contractsOnStoSubquery - a KLIP operation row takes the contracts of its own shipments', () => {
  it('without the option the shipments branches are unchanged (Shipping Performance and Oil Loss keep the operation-wide lookup)', () => {
    const sql = flat(contractsOnStoSubquery(KEY));
    expect(sql).not.toContain('member_shipment_ids');
    expect(sql).toContain("NULLIF(TRIM(sh_op.operation_id::text), '') = NULLIF(TRIM(g.sto_key::text), '')");
  });

  it('with the option both shipments branches are limited to the members, for OP- keys only', () => {
    const sql = flat(contractsOnStoSubquery(KEY, OWN));
    const gate = "COALESCE(NULLIF(TRIM(g.sto_key::text), ''), '') !~ '^OP-' OR sh_op.id = ANY(g.member_shipment_ids)";
    expect(sql).toContain(gate);
    expect(sql).toContain(gate.replace('sh_op', 'sh_id'));
    // a real SAP STO key (digits) keeps every source: the gate is open for it
    expect(sql.split('!~ \'^OP-\'').length - 1).toBe(2);
  });

  it('keeps the other sources (contract_stos, contracts.sto_number, SAP rows)', () => {
    const sql = flat(contractsOnStoSubquery(KEY, OWN));
    expect(sql).toContain('FROM contract_stos cs_k');
    expect(sql).toContain('FROM contracts c_sto');
    expect(sql).toContain('FROM sap_processed_data spd_k');
  });

  it('is threaded through contractIdOnStoSql and the PO builder', () => {
    expect(flat(contractIdOnStoSql('cc.contract_id', KEY, OWN))).toContain('sh_op.id = ANY(g.member_shipment_ids)');
    expect(flat(buildStoLinkedPoNumbersSql(KEY, 'c', 'g.po_numbers_from_join', OWN))).toContain('sh_id.id = ANY(g.member_shipment_ids)');
  });

  it('the contract COUNT falls back to the grouped count when the lookup finds nothing (COUNT is never NULL: 0 would have won)', () => {
    const sql = flat(buildStoLinkedContractCountSql(KEY, 'c', 'g.contract_count_from_join', OWN));
    expect(sql).toContain('NULLIF((SELECT COUNT(DISTINCT cid.contract_id)::int');
    expect(sql).toContain(', 0), g.contract_count_from_join');
  });
});

describe('the Shipments list controller', () => {
  const src = readFileSync(resolve(__dirname, '../controllers/shipment.controller.ts'), 'utf8');

  it('asks the grouped query for the member shipments and uses them', () => {
    expect(src).toContain('ARRAY_AGG(DISTINCT s.id) FILTER (WHERE s.id IS NOT NULL) AS member_shipment_ids');
    expect(src).toContain("memberShipmentIdsExpr: 'g.member_shipment_ids'");
  });

  it("swaps the enrich CTEs with a replacer FUNCTION: the SQL holds `$'` (the incoterm normalisation) and a replacement STRING would expand it", () => {
    expect(src).toContain('() => shipmentBaseShellEnrichCte');
    expect(src).toContain('() => shellEnrichWithStoLink');
    expect(src).not.toMatch(/\.replace\(\s*shipmentBaseEnrichCte,\s*shipmentBaseShellEnrichCte\s*,?\s*\)/);
  });
});
