/**
 * Deduplicate active shipment rows for a STO + PO pair (SAP is source of truth).
 *
 *   npx ts-node src/scripts/dedupeShipmentStoPo.ts <sto> <po>           # dry-run
 *   npx ts-node src/scripts/dedupeShipmentStoPo.ts <sto> <po> --apply   # cancel duplicate
 */
import { getClient } from '../database/connection';
import {
  canAutoConsolidateShipmentForSap,
  finalizeSapShipmentAfterUpsert,
  isSapSourcedShipmentId,
} from '../utils/klipLogisticsActivity';
import { invalidateShipmentsListCache } from '../services/shipmentList.service';

const stoFilter = process.argv[2]?.trim() || '';
const poFilter = process.argv[3]?.trim() || '';
const apply = process.argv.includes('--apply');

async function main() {
  if (!stoFilter || !poFilter) {
    console.error('Usage: npx ts-node src/scripts/dedupeShipmentStoPo.ts <sto> <po> [--apply]');
    process.exit(1);
  }

  const client = await getClient();
  try {
    const rows = await client.query<{
      shipment_uuid: string;
      shipment_id: string | null;
      operation_id: string | null;
      vessel_name: string | null;
      status: string;
      created_at: string;
      contract_uuid: string;
      contract_number: string;
      po_number: string | null;
      sto_number: string | null;
    }>(
      `SELECT
        s.id AS shipment_uuid,
        s.shipment_id,
        s.operation_id,
        s.vessel_name,
        s.status,
        s.created_at,
        c.id AS contract_uuid,
        c.contract_id AS contract_number,
        c.po_number,
        c.sto_number
      FROM shipments s
      JOIN contracts c ON c.id = s.contract_id
      WHERE COALESCE(s.status, '') <> 'CANCELLED'
        AND TRIM(COALESCE(c.po_number, '')) = TRIM($1::text)
        AND (
          TRIM(COALESCE(c.sto_number::text, '')) = TRIM($2::text)
          OR TRIM(COALESCE(s.shipment_id::text, '')) = TRIM($2::text)
        )
      ORDER BY s.created_at DESC`,
      [poFilter, stoFilter],
    );

    if (rows.rows.length === 0) {
      console.log(`No active shipment rows found for STO ${stoFilter} / PO ${poFilter}.`);
      return;
    }

    console.log(`Found ${rows.rows.length} active row(s) for STO ${stoFilter} / PO ${poFilter}:`);
    console.table(
      rows.rows.map((row) => ({
        shipment_uuid: row.shipment_uuid,
        shipment_id: row.shipment_id,
        operation_id: row.operation_id,
        vessel_name: row.vessel_name,
        status: row.status,
        contract_number: row.contract_number,
        created_at: row.created_at,
      })),
    );

    if (rows.rows.length === 1) {
      console.log('Only one active row — nothing to dedupe.');
      return;
    }

    const keeper =
      rows.rows.find((row) => trimText(row.shipment_id) === stoFilter && isSapSourcedShipmentId(row.shipment_id)) ??
      rows.rows.find((row) => isSapSourcedShipmentId(row.shipment_id)) ??
      rows.rows[0];

    console.log(`\nKeeper: ${keeper.shipment_id ?? keeper.shipment_uuid} (${keeper.shipment_uuid})`);

    const duplicates = rows.rows.filter((row) => row.shipment_uuid !== keeper.shipment_uuid);
    for (const dup of duplicates) {
      const canCancel = await canAutoConsolidateShipmentForSap(client, dup.shipment_uuid, dup.contract_uuid);
      console.log(
        `  ${apply ? 'will' : 'would'} ${canCancel ? 'CANCEL' : 'SKIP (KLIP activity)'}: ${dup.shipment_id ?? dup.shipment_uuid} [${dup.status}]`,
      );
    }

    if (!apply) {
      console.log('\nDry-run only. Re-run with --apply to cancel consolidatable duplicates.');
      return;
    }

    const result = await finalizeSapShipmentAfterUpsert(
      client,
      keeper.contract_uuid,
      keeper.shipment_uuid,
      stoFilter,
    );

    console.log('\nReconcile result:');
    console.log(`  cancelled: ${result.cancelledShipmentIds.join(', ') || '—'}`);
    console.log(`  skipped:   ${result.skippedShipmentIds.join(', ') || '—'}`);

    invalidateShipmentsListCache();
    console.log('\nDone. Shipments list cache invalidated.');
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
