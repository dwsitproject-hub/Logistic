import { describe, expect, it } from 'vitest';
import {
  sqlCoalesceSourceType,
  sqlSapIncotermFromJsonb,
  sqlSapSourceTypeFromJsonb,
} from './sapSourceTypeSql';

describe('sapSourceTypeSql', () => {
  it('reads Source and Source_Type from contract JSON and raw Excel', () => {
    const sql = sqlSapSourceTypeFromJsonb('spd.data');
    expect(sql).toContain("spd.data->'contract'->>'source_type'");
    expect(sql).toContain("spd.data->>'Source'");
    expect(sql).toContain("spd.data->'raw'->>'Source'");
    expect(sql).toContain("spd.data->>'Source_Type'");
    expect(sql).toContain("spd.data->'raw'->>'Source_Type'");
  });

  it('reads Incoterm from contract JSON and raw Excel', () => {
    const sql = sqlSapIncotermFromJsonb('sk.data');
    expect(sql).toContain("sk.data->'contract'->>'incoterm'");
    expect(sql).toContain("sk.data->'raw'->>'Incoterm'");
    expect(sql).toContain("sk.data->>'Incoterm'");
  });

  it('coalesces contract source then SAP source', () => {
    const sql = sqlCoalesceSourceType('c.source_type', 'l.source_type_raw');
    expect(sql).toContain('c.source_type');
    expect(sql).toContain('l.source_type_raw');
    expect(sql.startsWith('COALESCE(')).toBe(true);
  });
});
