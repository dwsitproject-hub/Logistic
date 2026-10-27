import { describe, expect, it } from 'vitest';
import pool from '../database/connection';
import { SHIPMENT_LIST_JPS_JOIN_SQL, SHIPMENT_LIST_JPS_SELECT_SQL } from './shipmentListStoJoinSql';

/**
 * The Jetty columns of the Shipments list must tell "KLIP never tried" (Not Sent) from "KLIP tried and JPS refused it" (FAILED) and "KLIP is holding it
 * back" (HELD). They all used to read Not Sent, because the lateral only took SUBMITTED rows.
 *
 * Runs the real SQL against rows written inside a transaction that is rolled back, so nothing is left behind.
 */
async function jettyRowFor(client: { query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> }, stoKey: string) {
  const r = await client.query(
    `SELECT ${SHIPMENT_LIST_JPS_SELECT_SQL}
       FROM (SELECT $1::text AS sto_key) sp
       ${SHIPMENT_LIST_JPS_JOIN_SQL}`,
    [stoKey],
  );
  return r.rows[0] as {
    jetty_status: string | null;
    jetty_send_state: string | null;
    jetty_send_error: string | null;
    jetty_send_at: string | null;
  };
}

describe('Shipments list: Jetty send state', () => {
  it('reads FAILED, HELD, a JPS status, or nothing, by what the tracker holds for the STO', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const ins = (sto: string, revision: number, state: string, extra: { status?: string; error?: string } = {}) =>
        client.query(
          `INSERT INTO jps_shipping_instructions (sto_key, external_reference, revision, state, jps_status, last_error)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [sto, `KLIP-${sto}-R${revision}`, revision, state, extra.status ?? null, extra.error ?? null],
        );

      // never tried: no row at all, and a go-live seed (a deliberate "do not send") both stay Not Sent
      const none = await jettyRowFor(client, 'ZZ-NEVER-TRIED');
      expect(none.jetty_status).toBeNull();
      expect(none.jetty_send_state).toBeNull();

      await ins('ZZ-SEEDED', 1, 'SKIPPED_PRE_EXISTING');
      expect((await jettyRowFor(client, 'ZZ-SEEDED')).jetty_send_state).toBeNull();

      // tried and refused
      await ins('ZZ-FAILED', 1, 'FAILED', { error: 'VALIDATION_ERROR: vessel_name: Master LOA must be a positive number' });
      const failed = await jettyRowFor(client, 'ZZ-FAILED');
      expect(failed.jetty_status).toBeNull();
      expect(failed.jetty_send_state).toBe('FAILED');
      expect(failed.jetty_send_error).toContain('Master LOA must be a positive number');
      expect(failed.jetty_send_at).not.toBeNull();

      // held back by KLIP
      await ins('ZZ-HELD', 1, 'SKIPPED_NO_CARGO', { error: 'product POME has no JPS cargo_hub_code' });
      const held = await jettyRowFor(client, 'ZZ-HELD');
      expect(held.jetty_send_state).toBe('HELD');
      expect(held.jetty_send_error).toContain('POME');

      // an instruction JPS holds shows JPS's own status, and no send state
      await ins('ZZ-SUBMITTED', 1, 'SUBMITTED', { status: 'Pending' });
      const sent = await jettyRowFor(client, 'ZZ-SUBMITTED');
      expect(sent.jetty_status).toBe('Pending');
      expect(sent.jetty_send_state).toBeNull();
      expect(sent.jetty_send_error).toBeNull();

      // a replacement that FAILED does not hide the instruction JPS holds (the SUBMITTED row wins over a newer FAILED one)
      await ins('ZZ-BOTH', 1, 'SUBMITTED', { status: 'Approved' });
      await ins('ZZ-BOTH', 2, 'FAILED', { error: 'VALIDATION_ERROR: later replacement refused' });
      const both = await jettyRowFor(client, 'ZZ-BOTH');
      expect(both.jetty_status).toBe('Approved');
      expect(both.jetty_send_state).toBeNull();

      // among failed rows the newest revision describes the STO
      await ins('ZZ-NEWEST', 1, 'FAILED', { error: 'first error' });
      await ins('ZZ-NEWEST', 2, 'FAILED', { error: 'second error' });
      expect((await jettyRowFor(client, 'ZZ-NEWEST')).jetty_send_error).toBe('second error');
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  }, 60_000);
});
