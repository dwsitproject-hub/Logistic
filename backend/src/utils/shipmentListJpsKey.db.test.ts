import { afterAll, describe, expect, it } from 'vitest';
import pool from '../database/connection';
import { SHIPMENT_LIST_JPS_JOIN_SQL, SHIPMENT_LIST_JPS_SELECT_SQL } from './shipmentListStoJoinSql';
import { shipmentListSeaStoKeyExpr, shipmentListStoKeyExpr } from './shipmentStoTypeSql';
import { SHIPMENT_JETTY_STATUS_FILTER_SQL } from './shipmentListFilters';

/**
 * Production STO 1006021140 (2026-11-19): the Edit Shipment modal said Approved, the Shipments table "Not Sent". One tracker row, filed under the STO number 1006021140. The list groups its rows
 * by shipmentListSeaStoKeyExpr, which for a FOB shipment with a vessel and an Operation ID made by KLIP (OP-1004033205-40057190) is that OP- id, so the lookup by the row's key found nothing.
 * JPS, the tracker and the modal use shipmentListStoKeyExpr. The list join and the Jetty Status filter must find the row under either key.
 *
 * Runs the real SQL against a tracker row written inside a transaction that is rolled back. The case is found in the data (a shipment whose list key differs from its JPS key) and the test
 * is skipped when the database has none.
 */
describe('the Shipments list finds the JPS tracker row under the key JPS used (against the database)', () => {
  afterAll(async () => {
    await pool.end();
  });

  it('shows the status for a row whose list key is not the STO key, and the filter reads the same', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const pick = await client.query(
        `SELECT s.id::text AS id, ${shipmentListSeaStoKeyExpr('c', 'l', 's')} AS list_key, ${shipmentListStoKeyExpr('c', 'l', 's')} AS jps_key
           FROM shipments s JOIN contracts c ON c.id = s.contract_id LEFT JOIN contract_latest_spd_snapshot l ON l.contract_number = c.contract_id
          WHERE ${shipmentListSeaStoKeyExpr('c', 'l', 's')} IS DISTINCT FROM ${shipmentListStoKeyExpr('c', 'l', 's')}
          ORDER BY s.created_at DESC LIMIT 1`,
      );
      if (pick.rows.length === 0) {
        await client.query('ROLLBACK');
        return; // nothing of this shape in this database
      }
      const { id, list_key: listKey, jps_key: jpsKey } = pick.rows[0] as { id: string; list_key: string; jps_key: string };
      await client.query(
        `INSERT INTO jps_shipping_instructions (sto_key, revision, external_reference, state, jps_status) VALUES ($1, 1, $2, 'SUBMITTED', 'Approved')`,
        [jpsKey, `ZZ-KEYTEST-${jpsKey}`],
      );

      const row = async (join: string) =>
        (
          await client.query(`SELECT ${SHIPMENT_LIST_JPS_SELECT_SQL} FROM (SELECT $1::text AS sto_key, $2::uuid AS id) sp ${join}`, [listKey, id])
        ).rows[0] as { jetty_status: string | null };

      // the join as it was, looking by the list key alone, finds nothing
      const onlyListKey = SHIPMENT_LIST_JPS_JOIN_SQL.replace(/ANY\(ARRAY\[sp\.sto_key::text, [\s\S]*?\]\)/, () => 'ANY(ARRAY[sp.sto_key::text])');
      expect((await row(onlyListKey)).jetty_status).toBeNull();
      // now it is found
      expect((await row(SHIPMENT_LIST_JPS_JOIN_SQL)).jetty_status).toBe('Approved');

      const shown = await client.query(`SELECT ${SHIPMENT_JETTY_STATUS_FILTER_SQL} AS shown FROM (SELECT $1::text AS sto_key, $2::uuid AS id) sb`, [listKey, id]);
      expect(shown.rows[0].shown).toBe('Approved');
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
    }
  });
});
