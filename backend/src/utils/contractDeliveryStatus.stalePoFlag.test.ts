import { describe, expect, it } from 'vitest';
import { getClient } from '../database/connection';
import { sqlContractImportStatusExpr } from './contractDeliveryStatus';

/**
 * A Delete PO Status row of a PO, in any import, used to make EVERY STO of the PO read Cancelled. Production 2026-10-20, KARAWANG: B2B child 1014003154 held a header row from the
 * 30 Sep import with Delete PO Status 'S' while its STO lines of the 19 Oct import were live - the STO group 1016011366 read Cancelled instead of Close and Shipping Performance kept
 * 112.1 MT open that Contract Performance and Shipments had finished. A flag older than a live STO line of the same PO no longer cancels the PO; a flag as new as the lines (the PO
 * deleted in SAP and exported again with its lines flagged) still does. Run in a transaction that is rolled back, on rows of a real PO.
 */
describe('a Delete PO Status row older than a live STO line of the same PO no longer cancels the PO', () => {
  it('reads not Cancelled when the flagged row is older, Cancelled when it is the newest', async () => {
    const client = await getClient();
    try {
      await client.query('BEGIN');
      // a PO with two stored rows on two different real STOs and a contract that carries it
      const pick = await client.query(
        `SELECT a.id::text AS live_id, b.id::text AS flagged_id, c.id::text AS contract_uuid, c.contract_id
           FROM sap_processed_data a
           JOIN sap_processed_data b ON b.po_number = a.po_number AND b.id <> a.id
            AND TRIM(b.sto_number::text) <> TRIM(a.sto_number::text)
           JOIN contracts c ON c.contract_id = a.contract_number AND c.po_number = a.po_number
          WHERE NULLIF(TRIM(a.sto_number::text), '') IS NOT NULL AND NULLIF(TRIM(b.sto_number::text), '') IS NOT NULL
            AND a.contract_number IS NOT NULL AND a.contract_number = b.contract_number
            AND a.sto_number !~ '^(OP-|MNL-|MSEA-)' AND b.sto_number !~ '^(OP-|MNL-|MSEA-)'
          LIMIT 1`,
      );
      if (pick.rows.length === 0) {
        await client.query('ROLLBACK');
        return; // nothing to test against on this database
      }
      const { live_id, flagged_id, contract_uuid } = pick.rows[0];
      // clear any flag the pair already carries, then flag B with Delete PO Status and give both a known import and age
      await client.query(
        `UPDATE sap_processed_data
            SET data = jsonb_set(jsonb_set(jsonb_set(data, '{raw}', COALESCE(data->'raw', '{}'::jsonb) - 'Delete PO Status' - 'Delete STO Status'), '{contract}', COALESCE(data->'contract', '{}'::jsonb) - 'delete_po_status' - 'delete_sto_status'), '{shipment}', COALESCE(data->'shipment', '{}'::jsonb) - 'delete_po_status' - 'delete_sto_status')
          WHERE id = ANY($1::uuid[])`,
        [[live_id, flagged_id]],
      );
      await client.query(
        `UPDATE sap_processed_data SET data = jsonb_set(data, '{raw,Delete PO Status}', '"S"'::jsonb, true) WHERE id = $1::uuid`,
        [flagged_id],
      );
      const status = async () =>
        (await client.query(`SELECT ${sqlContractImportStatusExpr('c')} AS s FROM contracts c WHERE c.id = $1::uuid`, [contract_uuid])).rows[0].s as string | null;
      const seen = (liveAt: string, flaggedAt: string) =>
        client.query(
          `UPDATE sap_processed_data SET last_seen_at = CASE WHEN id = $1::uuid THEN $2::timestamp ELSE $3::timestamp END WHERE id = ANY($4::uuid[])`,
          [live_id, liveAt, flaggedAt, [live_id, flagged_id]],
        );

      await seen('2026-10-19 00:00:00', '2026-09-30 00:00:00'); // the flag is OLDER than the live STO line
      expect(String(await status() ?? '').toUpperCase()).not.toBe('CANCELLED');

      await seen('2026-09-30 00:00:00', '2026-10-19 00:00:00'); // the flag is the NEWEST row: the PO was deleted and exported again
      expect(String(await status() ?? '').toUpperCase()).toBe('CANCELLED');
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
    }
  }, 120_000);
});
