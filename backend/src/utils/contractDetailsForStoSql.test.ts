import { describe, expect, it } from 'vitest';
import { buildContractDetailsForStoSql } from './contractDetailsForStoSql';

describe('buildContractDetailsForStoSql', () => {
  it('discovers contracts by sto_number and returns one row per PO line', () => {
    const sql = buildContractDetailsForStoSql();
    expect(sql).toContain('contract_stos');
    expect(sql).toContain('c.sto_number::text');
    expect(sql).toContain('qty_move');
    expect(sql).toContain('s.shipment_id::text');
    expect(sql).toContain('po_lines');
    expect(sql).toContain('pl.po_number');
    expect(sql).toContain('pl.incoterm');
    expect(sql).toContain('po_number::text');
    expect(sql).toContain('UNION ALL');
    expect(sql).toContain("IN ('SEA', 'MIXED', 'MIX')");
  });
});
