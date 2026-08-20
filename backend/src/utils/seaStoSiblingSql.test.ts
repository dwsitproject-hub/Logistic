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
});
