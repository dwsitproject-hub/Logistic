import { describe, expect, it } from 'vitest';
import {
  buildGroupedStoTrimExpr,
  buildStoLinkedContractNumbersSql,
  buildStoLinkedPoNumbersSql,
  buildStoLinkedSuppliersSql,
  contractIdOnStoSql,
  contractsOnStoSubquery,
  sqlMergedPoNumbers,
} from './stoLinkedContractSql';

describe('stoLinkedContractSql', () => {
  it('buildGroupedStoTrimExpr trims sto key sql', () => {
    expect(buildGroupedStoTrimExpr('sb.sto_key')).toContain('sb.sto_key');
    expect(buildGroupedStoTrimExpr('sb.sto_key')).toContain('NULLIF');
  });

  it('buildStoLinkedContractNumbersSql uses contract_stos', () => {
    const grouped = buildGroupedStoTrimExpr('sb.sto_key');
    const sql = buildStoLinkedContractNumbersSql(grouped, 'c');
    expect(sql).toContain('contract_stos');
    expect(sql).toContain('sap_processed_data');
  });

  it('contractsOnStoSubquery resolves KLIP operation_id siblings', () => {
    const grouped = buildGroupedStoTrimExpr('sb.sto_key');
    const sql = contractsOnStoSubquery(grouped);
    expect(sql).toContain('sh_op.operation_id');
    expect(sql).toContain('sh_id.shipment_id');
    expect(sql).toContain('COALESCE');
  });

  it('contractsOnStoSubquery gathers candidates by index instead of scanning contracts', () => {
    // The four EXISTS branches used to sit in one OR over `contracts`, which no index can serve:
    // EXPLAIN showed `Seq Scan on contracts cc_2, Rows Removed by Filter: 18749, loops=463`.
    // Candidates are now collected from each source and looked up by id. Keep all five branches,
    // keep them UNIONed, and keep the sto_number predicate in its index-matching form.
    const grouped = buildGroupedStoTrimExpr('sb.sto_key');
    const sql = contractsOnStoSubquery(grouped);
    // = ANY(ARRAY(...)), not IN (...): the IN form hashed the whole contracts table once per row (6 x 996 Seq Scans, 33.3 s on the summary).
    expect(sql).toContain('WHERE cc.id = ANY(ARRAY(');
    expect(sql).not.toContain('WHERE cc.id IN (');
    expect(sql).not.toContain('EXISTS (');
    expect(sql.split('UNION').length - 1).toBe(4);
    for (const branch of [
      'FROM contract_stos cs_k',
      'FROM contracts c_sto',
      'FROM contracts c_spd',
      'FROM shipments sh_op',
      'FROM shipments sh_id',
    ]) {
      expect(sql).toContain(branch);
    }
    // Index-matching form: idx_contracts_sto_number_trim is on NULLIF(btrim(sto_number::text),'').
    expect(sql).toContain("NULLIF(TRIM(c_sto.sto_number::text), '') = ");
    expect(sql).not.toContain("TRIM(COALESCE(cc.sto_number::text, '')) = ");
  });

  it('contractsOnStoSubquery maps B2B child contracts to origin (does not list child PO)', () => {
    const grouped = buildGroupedStoTrimExpr('sb.sto_key');
    const sql = contractsOnStoSubquery(grouped);
    expect(sql).toContain("= 'B2B'");
    expect(sql).toContain('contract_reference_po');
    expect(sql).toContain('COALESCE(b2b_o.contract_id, cc.contract_id)');
    expect(sql).toContain('TRIM(b2b_o.po_number::text) = ch_spd.reff');
  });

  it('buildStoLinkedPoNumbersSql falls back to join aggregation when STO lookup empty', () => {
    const grouped = buildGroupedStoTrimExpr('sb.sto_key');
    const sql = buildStoLinkedPoNumbersSql(grouped, 'c', 'g.po_numbers_from_join');
    expect(sql).toContain('COALESCE');
    expect(sql).toContain('g.po_numbers_from_join');
  });

  it('buildStoLinkedSuppliersSql aggregates suppliers from STO-linked contracts', () => {
    const grouped = buildGroupedStoTrimExpr('sb.sto_key');
    const sql = buildStoLinkedSuppliersSql(grouped, 'c', 'g.suppliers');
    expect(sql).toContain('STRING_AGG(DISTINCT cc.supplier');
    expect(sql).toContain('contract_stos');
    expect(sql).toContain('g.suppliers');
  });
});

describe('contractIdOnStoSql', () => {
  it('tests a contract number against the STO contracts as an array, so they are evaluated once and read by index', () => {
    const grouped = buildGroupedStoTrimExpr('g.sto_key');
    const sql = contractIdOnStoSql('cc.contract_id', grouped);
    expect(sql.startsWith('cc.contract_id = ANY(ARRAY(')).toBe(true);
    expect(sql).toContain(contractsOnStoSubquery(grouped));
    expect(sql).not.toContain('COALESCE(NULLIF(TRIM(pna')
  });

  it('every aggregate over the STO contracts uses it, none the IN form', () => {
    const grouped = buildGroupedStoTrimExpr('g.sto_key');
    for (const sql of [buildStoLinkedPoNumbersSql(grouped), buildStoLinkedSuppliersSql(grouped)]) {
      expect(sql).toContain(contractIdOnStoSql('cc.contract_id', grouped));
      expect(sql).not.toMatch(/cc\.contract_id IN \(/);
    }
  });
});

describe('sqlMergedPoNumbers', () => {
  it('unions the SAP-keyed and the contract-linked PO lists instead of letting SAP replace the contracts', () => {
    const sql = sqlMergedPoNumbers('pna', 'sp').replace(/\s+/g, ' ');
    expect(sql).toContain("CONCAT_WS(',', pna.po_numbers, sp.po_numbers)");
    expect(sql).toContain("STRING_AGG(DISTINCT po.v, ', ' ORDER BY po.v)");
    expect(sql).toContain("po.v <> ''");
    // no COALESCE(pna, sp): that is what dropped a PO whose SAP line carries no contract
    expect(sql).not.toContain('COALESCE(NULLIF(TRIM(pna');
  });

  it('uses the aliases it is given', () => {
    expect(sqlMergedPoNumbers('a', 'b')).toContain('a.po_numbers, b.po_numbers');
  });
});
