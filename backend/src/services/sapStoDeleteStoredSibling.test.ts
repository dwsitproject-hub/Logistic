import { describe, expect, it } from 'vitest';
import { getClient, query } from '../database/connection';
import { sqlSpdHasDeletePoFlagFromRow, sqlSpdHasDeleteStoFlagFromRow } from '../utils/sapMasterV2UatFormat';
import { SapDataDistributionService } from './sapDataDistribution.service';
import { isStoDeletedWithLiveSibling, sapDeleteForcesContractCancel } from '../utils/sapDeletedPoLines';

/**
 * A per-period export can hold ONLY the deleted STO of a PO whose other STOs an earlier import stored (local copy: 1004029583, live STOs from June and July,
 * the deleted one alone in the September file). The file-scope rule sees no live sibling there, so the contract was still cancelled. The distribution now
 * looks for a live sibling among the stored rows. The query is run here against the database; a correct string would prove nothing.
 */
const markFromStored = (client: unknown, parsedData: object) =>
  (SapDataDistributionService as unknown as {
    markStoDeleteWithStoredLiveSibling: (c: unknown, p: object) => Promise<void>;
  }).markStoDeleteWithStoredLiveSibling(client, parsedData);

const LIVE = `NOT (${sqlSpdHasDeletePoFlagFromRow('o')}) AND NOT (${sqlSpdHasDeleteStoFlagFromRow('o')})`;

describe('a Delete STO line with no live sibling in the file looks for one among the stored rows', () => {
  it('flags it when another STO of the PO is stored live; leaves it alone when the PO has no other STO', async () => {
    const two = await query(
      `SELECT o.po_number, MIN(TRIM(o.sto_number::text)) AS sto
         FROM sap_processed_data o
        WHERE NULLIF(TRIM(o.sto_number::text), '') IS NOT NULL AND NULLIF(TRIM(o.po_number), '') IS NOT NULL AND ${LIVE}
        GROUP BY o.po_number HAVING COUNT(DISTINCT TRIM(o.sto_number::text)) >= 2 LIMIT 1`,
    );
    const one = await query(
      `SELECT o.po_number, MIN(TRIM(o.sto_number::text)) AS sto
         FROM sap_processed_data o
        WHERE NULLIF(TRIM(o.sto_number::text), '') IS NOT NULL AND NULLIF(TRIM(o.po_number), '') IS NOT NULL
        GROUP BY o.po_number HAVING COUNT(DISTINCT TRIM(o.sto_number::text)) = 1 LIMIT 1`,
    );
    if (two.rows.length === 0 || one.rows.length === 0) return; // nothing to test against on this database

    const client = await getClient();
    try {
      // two live STOs stored: the file deletes one of them, the other is the live sibling
      const withSibling = { contract: { po_no: two.rows[0].po_number, delete_sto_status: 'L' }, shipment: { sto_no: two.rows[0].sto } };
      await markFromStored(client, withSibling);
      expect(isStoDeletedWithLiveSibling(withSibling)).toBe(true);
      expect(sapDeleteForcesContractCancel(withSibling)).toBe(false);

      // one STO stored: deleting it leaves no sibling, so the contract is cancelled as before
      const alone = { contract: { po_no: one.rows[0].po_number, delete_sto_status: 'L' }, shipment: { sto_no: one.rows[0].sto } };
      await markFromStored(client, alone);
      expect(isStoDeletedWithLiveSibling(alone)).toBe(false);
      expect(sapDeleteForcesContractCancel(alone)).toBe(true);

      // a Delete PO line is never softened, and a line without an STO is never looked up
      const poDeleted = { contract: { po_no: two.rows[0].po_number, delete_po_status: 'S' }, shipment: { sto_no: two.rows[0].sto } };
      await markFromStored(client, poDeleted);
      expect(sapDeleteForcesContractCancel(poDeleted)).toBe(true);
      const noSto = { contract: { po_no: two.rows[0].po_number, delete_sto_status: 'L' } };
      await markFromStored(client, noSto);
      expect(isStoDeletedWithLiveSibling(noSto)).toBe(false);
    } finally {
      client.release();
    }
  }, 120_000);
});
