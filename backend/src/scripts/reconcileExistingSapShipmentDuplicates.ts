/**
 * One-off: reconcile existing SAP shipment duplicates (latest STO wins; preserve KLIP activity).
 *
 *   npx ts-node src/scripts/reconcileExistingSapShipmentDuplicates.ts          # dry-run
 *   npx ts-node src/scripts/reconcileExistingSapShipmentDuplicates.ts --apply  # cancel superseded rows
 */
import { getClient } from '../database/connection';
import {
  finalizeSapShipmentAfterUpsert,
  hasKlipShipmentActivity,
  isSapSourcedShipmentId,
} from '../utils/klipLogisticsActivity';

const apply = process.argv.includes('--apply');

async function main() {
  const client = await getClient();
  try {
    const groups = await client.query<{
      contract_id: string;
      contract_number: string;
      po_number: string | null;
      shipment_count: string;
    }>(`
      SELECT c.id AS contract_id, c.contract_id AS contract_number, c.po_number,
        COUNT(*)::text AS shipment_count
      FROM shipments s
      JOIN contracts c ON c.id = s.contract_id
      WHERE COALESCE(s.status, '') <> 'CANCELLED'
      GROUP BY c.id, c.contract_id, c.po_number
      HAVING COUNT(*) > 1
      ORDER BY COUNT(*) DESC, c.po_number NULLS LAST
    `);

    console.log(`Found ${groups.rows.length} contract(s) with multiple active shipment rows.`);

    let totalCancelled = 0;
    let totalSkipped = 0;

    for (const group of groups.rows) {
      const shipments = await client.query<{
        id: string;
        shipment_id: string | null;
        status: string;
        created_at: string;
      }>(
        `SELECT id, shipment_id, status, created_at
         FROM shipments
         WHERE contract_id = $1::uuid AND COALESCE(status, '') <> 'CANCELLED'
         ORDER BY created_at DESC`,
        [group.contract_id],
      );

      const keeper =
        shipments.rows.find((r) => isSapSourcedShipmentId(r.shipment_id)) ?? shipments.rows[0];
      const keeperSto = keeper.shipment_id?.trim() || null;

      console.log(
        `\nPO ${group.po_number ?? '—'} / contract ${group.contract_number}: keeper ${keeper.shipment_id ?? keeper.id} (${shipments.rows.length} rows)`,
      );

      if (!apply) {
        for (const row of shipments.rows) {
          if (row.id === keeper.id) continue;
          const klip = await hasKlipShipmentActivity(client, row.id, group.contract_id);
          console.log(
            `  would ${klip ? 'SKIP (KLIP activity)' : 'CANCEL'}: ${row.shipment_id ?? row.id} [${row.status}]`,
          );
        }
        continue;
      }

      const result = await finalizeSapShipmentAfterUpsert(
        client,
        group.contract_id,
        keeper.id,
        keeperSto,
      );
      totalCancelled += result.cancelledShipmentIds.length;
      totalSkipped += result.skippedShipmentIds.length;
      if (result.cancelledShipmentIds.length) {
        console.log(`  cancelled: ${result.cancelledShipmentIds.join(', ')}`);
      }
      if (result.skippedShipmentIds.length) {
        console.log(`  skipped (KLIP): ${result.skippedShipmentIds.join(', ')}`);
      }
    }

    if (apply) {
      console.log(`\nDone. Cancelled ${totalCancelled} row(s); skipped ${totalSkipped} with KLIP activity.`);
    } else {
      console.log('\nDry-run only. Re-run with --apply to cancel superseded SAP-only rows.');
    }
  } finally {
    client.release();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
