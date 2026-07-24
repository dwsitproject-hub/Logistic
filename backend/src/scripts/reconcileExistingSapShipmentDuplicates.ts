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
import { sqlSpdPoNumberExpr } from '../utils/contractLogisticsStoDetailSql';
import { sapStoNumberKeyExpr } from '../utils/shipmentStoTypeSql';

const apply = process.argv.includes('--apply');

async function resolveLatestSapStoForPo(
  client: Awaited<ReturnType<typeof getClient>>,
  poNumber: string | null,
): Promise<string | null> {
  const po = String(poNumber ?? '').trim();
  if (!po) return null;

  const poExpr = sqlSpdPoNumberExpr('spd');
  const stoExpr = sapStoNumberKeyExpr('spd');
  const res = await client.query<{ sto_key: string }>(
    `SELECT TRIM((${stoExpr})::text) AS sto_key
     FROM sap_processed_data spd
     WHERE ${poExpr} = TRIM($1::text)
       AND NULLIF(TRIM((${stoExpr})::text), '') IS NOT NULL
     ORDER BY spd.created_at DESC NULLS LAST
     LIMIT 1`,
    [po],
  );
  return res.rows[0]?.sto_key?.trim() || null;
}

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
        operation_id: string | null;
        status: string;
        created_at: string;
      }>(
        `SELECT id, shipment_id, operation_id, status, created_at
         FROM shipments
         WHERE contract_id = $1::uuid AND COALESCE(status, '') <> 'CANCELLED'
         ORDER BY created_at DESC`,
        [group.contract_id],
      );

      const latestSapSto = await resolveLatestSapStoForPo(client, group.po_number);

      const keeper =
        shipments.rows.find((r) => r.operation_id && String(r.operation_id).trim()) ??
        shipments.rows.find(
          (r) => latestSapSto && trimText(r.shipment_id) === latestSapSto && isSapSourcedShipmentId(r.shipment_id),
        ) ??
        shipments.rows.find((r) => isSapSourcedShipmentId(r.shipment_id)) ??
        shipments.rows[0];

      const keeperSto = latestSapSto ?? keeper.shipment_id?.trim() ?? null;

      console.log(
        `\nPO ${group.po_number ?? '—'} / contract ${group.contract_number}: keeper ${keeper.shipment_id ?? keeper.id} → STO ${keeperSto ?? '—'} (${shipments.rows.length} rows)`,
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
        group.po_number,
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

function trimText(value: string | null | undefined): string {
  return String(value ?? '').trim();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
