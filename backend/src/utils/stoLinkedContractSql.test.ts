import { describe, expect, it } from 'vitest';
import {
  buildGroupedStoTrimExpr,
  buildStoLinkedContractNumbersSql,
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
});
