import { describe, expect, it } from 'vitest';
import {
  buildGroupedStoTrimExpr,
  buildStoLinkedContractNumbersSql,
  buildStoLinkedPoNumbersSql,
  buildStoLinkedSuppliersSql,
  contractsOnStoSubquery,
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
    expect(sql).toContain('sh.operation_id');
    expect(sql).toContain('COALESCE');
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
