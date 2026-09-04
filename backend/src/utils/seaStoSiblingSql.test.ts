import { describe, expect, it } from 'vitest';
import {
  sqlActiveSeaStoSiblingContractIdsCte,
  sqlContractSharesNumericStoWithActiveSeaShipmentExpr,
} from './seaStoSiblingSql';

describe('seaStoSiblingSql', () => {
  it('matches sibling STOs from this contract outward (no nested SAP JSON scan)', () => {
    const sql = sqlContractSharesNumericStoWithActiveSeaShipmentExpr('c.id');
    expect(sql).toContain('contract_stos');
    expect(sql).toContain('s_link');
    expect(sql).toContain('cs_self.contract_id = c.id');
    expect(sql).toContain("NOT IN ('CANCELLED', 'CANCELED')");
    expect(sql).toContain('IS DISTINCT FROM');
    expect(sql).toContain('shipment_id');
    expect(sql).toContain('operation_id');
    expect(sql).not.toContain('sap_processed_data');
  });

  it('builds a once-per-query CTE of sibling contract UUIDs', () => {
    const sql = sqlActiveSeaStoSiblingContractIdsCte();
    expect(sql.startsWith('active_sea_sto_sibling_ids AS')).toBe(true);
    expect(sql).toContain('UNION');
    expect(sql).not.toContain('sap_processed_data');
  });

  /**
   * Regression guard for the 2026-09-04 rewrite: both contract_stos branches used predicates the
   * planner cannot hash or merge, so it evaluated a join filter over the full cross product
   * (~73M and ~32M rows). Measured against real data: 136.6s -> 1.5s, identical 1,628-id result.
   * Reintroducing either shape silently restores a ~90x regression, so assert the join keys.
   */
  it('keeps sibling join keys hashable (no IS NOT DISTINCT FROM key, no OR-ed key pair)', () => {
    const sql = sqlActiveSeaStoSiblingContractIdsCte();

    // sto_number is NOT NULL on contract_stos, so '=' is equivalent - and unlike the
    // non-hashable variant it can drive a hash/merge join. Match the predicate shape, not the
    // bare phrase: the explanatory SQL comments in the builder mention it in prose.
    expect(sql).toContain('ON cs_sib.sto_number = cs_self.sto_number');
    expect(sql).not.toMatch(/ON\s+cs_sib\.sto_number\s+IS NOT DISTINCT FROM/);

    // The shipment_id / operation_id match must stay split across two UNION branches; an OR of two
    // different key pairs cannot be a join key.
    expect(sql).toContain('ON TRIM(s_link.shipment_id::text) = TRIM(cs_self.sto_number::text)');
    expect(sql).toContain('ON TRIM(s_link.operation_id::text) = TRIM(cs_self.sto_number::text)');
    expect(sql).not.toMatch(/TRIM\(s_link\.shipment_id::text\)[\s\S]*?OR\s+TRIM\(s_link\.operation_id::text\)/);

    // shipments.contract_id is NULLABLE - '<>' would drop rows the original kept.
    expect(sql).toContain('s_link.contract_id IS DISTINCT FROM cs_self.contract_id');
  });
});
