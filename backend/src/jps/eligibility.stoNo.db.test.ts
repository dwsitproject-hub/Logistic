import { describe, expect, it } from 'vitest';
import { findEligibleStos } from './eligibility';

/**
 * The whole eligibility query RUNS against the database with the cargo-line sto_no column (both arms of the cargo lateral, and the JSON it builds). The other tests
 * in eligibility.test.ts mock the database and only read the SQL text: a column one arm lacks, or a type the two arms disagree on, would pass them and fail here.
 */
describe('findEligibleStos RUNS with the cargo-line sto_no (real database)', () => {
  it('is valid SQL for a named STO (loaded by key, so no tracker or date conditions) and returns nothing for one that does not exist', async () => {
    const rows = await findEligibleStos('BONTANG', 1, { stoKeys: ['NO-SUCH-STO-ZZ'], dischargePort: 'ALL' });
    expect(rows).toEqual([]);
  }, 120_000);

  it('for an STO that exists, any line it returns has sto_no as a trimmed string or null', async () => {
    const { query } = await import('../database/connection');
    const pick = await query(`SELECT TRIM(sto_number) AS sto FROM contract_stos WHERE NULLIF(TRIM(sto_number), '') IS NOT NULL LIMIT 5`);
    const keys = pick.rows.map((r) => String(r.sto));
    if (keys.length === 0) return;
    const rows = await findEligibleStos('BONTANG', 5, { stoKeys: keys, dischargePort: 'ALL' });
    for (const sto of rows) {
      for (const line of sto.cargo) {
        expect(line.sto_no === null || (typeof line.sto_no === 'string' && line.sto_no === line.sto_no.trim() && line.sto_no !== '')).toBe(true);
      }
    }
  }, 180_000);
});
