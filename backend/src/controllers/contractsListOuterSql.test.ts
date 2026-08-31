import { describe, expect, it } from 'vitest';
import { buildContractsListOuterSql } from './contractsListOuterSql';

describe('buildContractsListOuterSql', () => {
  it('full projection includes payments-table fallbacks and logistics counts', () => {
    const sql = buildContractsListOuterSql(false, { compact: false });
    expect(sql).toContain('due_date_payment_fb');
    expect(sql).toContain('trucking_count');
    expect(sql).toContain('document_count');
    expect(sql).toContain('remarks_count');
    expect(sql).toContain('b2b_child_gr_sto_status');
  });

  it('compact projection keeps SAP qty and outstanding but skips payments table and counts', () => {
    const sql = buildContractsListOuterSql(false, { compact: true });
    expect(sql).toContain('outstanding_quantity');
    expect(sql).toContain('quantity_delivery');
    expect(sql).toContain('quantity_receive');
    expect(sql).toContain('dp_date_raw');
    expect(sql).toContain('payoff_date_raw');
    expect(sql).not.toContain('due_date_payment_fb');
    expect(sql).not.toContain('trucking_count');
    expect(sql).not.toContain('document_count');
    expect(sql).toContain('remarks_count');
  });

  it('outstanding uses incoterm Quantity Delivery, not vessel-first quantity_delivery_sap', () => {
    const sql = buildContractsListOuterSql(false, { compact: true });
    expect(sql).toContain("IN ('LCO', 'FOB') THEN base.quantity_delivery");
    expect(sql).not.toContain('quantity_delivery_sap');
  });
});
