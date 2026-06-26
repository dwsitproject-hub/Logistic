import { describe, expect, it } from 'vitest';
import { buildContractDetailsForStoSql } from './contractDetailsForStoSql';

describe('buildContractDetailsForStoSql', () => {
  it('discovers contracts by sto_number and returns one row per PO line', () => {
    const sql = buildContractDetailsForStoSql();
    expect(sql).toContain('c.sto_number::text');
    expect(sql).toContain('s.operation_id::text');
    expect(sql).toContain('po_lines');
    expect(sql).toContain('pl.po_number');
    expect(sql).toContain('COALESCE(u.po_number');
    expect(sql).toContain('UNION ALL');
  });
});
