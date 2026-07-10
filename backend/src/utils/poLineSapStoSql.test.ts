import { describe, expect, it } from 'vitest';
import { poLineHasSapStoSql } from './poLineSapStoSql';

describe('poLineHasSapStoSql', () => {
  it('checks contracts.sto_number, contract_stos, and sap_processed_data', () => {
    const sql = poLineHasSapStoSql('c');
    expect(sql).toContain('c.sto_number');
    expect(sql).toContain('contract_stos cs');
    expect(sql).toContain('sap_processed_data spd');
    expect(sql).toContain('STO No.');
  });
});
