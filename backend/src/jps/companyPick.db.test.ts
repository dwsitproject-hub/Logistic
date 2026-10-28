import { describe, expect, it } from 'vitest';
import pool from '../database/connection';
import { COMPANY_PICK_LATERAL_SQL } from './eligibility';

/**
 * Which Master Company an STO's SAP Company Code resolves to, run against real rows (inside a transaction that is rolled back, so nothing is left behind).
 * The case that mattered on SIT (2026-10-28): SAP code "PM" is KLIP's company_code of the head office PMC GENERAL HO JAKARTA (ORG-0016, unknown to JPS), while DHM says
 * PT Prima Makmur Cakrawala (ORG-0006) has company_code_sap "PM" and JPS maps that one to Dumai.
 */
type Client = { query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> };

async function pick(client: Client, code: string) {
  const r = await client.query(
    `SELECT pick.code, pick.deleted FROM (SELECT ARRAY[$1::text] AS company_codes) x ${COMPANY_PICK_LATERAL_SQL}`,
    [code],
  );
  return r.rows[0] as { code: string | null; deleted: boolean };
}

describe('the Master Company a SAP Company Code resolves to', () => {
  it('prefers the organisation DHM says owns the SAP code over a KLIP company_code that merely equals it; falls back to company_code; a deleted row gives no code', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const add = (companyCode: string, codeDhm: string, sapCode: string | null, deleted = false) =>
        client.query(
          `INSERT INTO master_companies (company_code, company_name, code_dhm, dhm_is_deleted, dhm_payload)
           VALUES ($1, $1, $2, $3, $4::jsonb)`,
          [companyCode, codeDhm, deleted, JSON.stringify({ company_code_sap: sapCode })],
        );

      // the collision: KLIP's "ZZPM" is the head office, DHM's SAP code "ZZPM" belongs to the real company
      await add('ZZPM', 'ZZ-ORG-0016', null); // head office: company_code = SAP code, DHM has no SAP code on it
      await add('ZZPMC', 'ZZ-ORG-0006', 'ZZPM'); // the company DHM says answers to SAP code ZZPM
      expect((await pick(client, 'ZZPM')).code).toBe('ZZ-ORG-0006');

      // no collision: the KLIP company_code is the only match
      await add('ZZEOP', 'ZZ-ORG-0003', null);
      expect((await pick(client, 'ZZEOP')).code).toBe('ZZ-ORG-0003');

      // a SAP code only DHM knows (company_code is KLIP's own short code)
      await add('ZZSPC', 'ZZ-ORG-0010', 'ZZSC');
      expect((await pick(client, 'ZZSC')).code).toBe('ZZ-ORG-0010');

      // the one picked is deleted in DHM: no code, and it says deleted (the other row does not stand in for it)
      await add('ZZDEL', 'ZZ-ORG-0099', 'ZZGONE', true);
      await add('ZZGONE', 'ZZ-ORG-0098', null);
      expect(await pick(client, 'ZZGONE')).toEqual({ code: null, deleted: true });

      // nothing matches: no code, and not deleted (the caller reads the missing code as "no DHM code on Master Company")
      expect(await pick(client, 'ZZNOBODY')).toEqual({ code: null, deleted: null });
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  }, 60_000);
});
