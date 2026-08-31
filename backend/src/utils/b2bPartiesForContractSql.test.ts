import { describe, expect, it } from 'vitest';
import { SQL_B2B_PARTIES_FOR_ORIGIN_PO } from './b2bPartiesForContractSql';

describe('SQL_B2B_PARTIES_FOR_ORIGIN_PO', () => {
  it('selects child buyer, supplier, and qty_move delivery/receive', () => {
    expect(SQL_B2B_PARTIES_FOR_ORIGIN_PO).toContain('c.buyer');
    expect(SQL_B2B_PARTIES_FOR_ORIGIN_PO).toContain("->>'Buyer'");
    expect(SQL_B2B_PARTIES_FOR_ORIGIN_PO).toContain('AS buyer');
    expect(SQL_B2B_PARTIES_FOR_ORIGIN_PO).toContain('MAX(c.supplier) AS supplier');
    expect(SQL_B2B_PARTIES_FOR_ORIGIN_PO).toContain('contract_qty_move_snapshot');
    expect(SQL_B2B_PARTIES_FOR_ORIGIN_PO).toContain('qm.quantity_delivery');
    expect(SQL_B2B_PARTIES_FOR_ORIGIN_PO).toContain('qm.quantity_receive');
    expect(SQL_B2B_PARTIES_FOR_ORIGIN_PO).toContain('Contract Reff PO Ini');
  });
});
