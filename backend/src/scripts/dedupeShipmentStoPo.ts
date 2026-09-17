/**
 * Deduplicate / rename active shipment rows for a STO + PO pair (SAP is source of truth).
 *
 *   npx ts-node src/scripts/dedupeShipmentStoPo.ts <sto> <po>                      # dry-run
 *   npx ts-node src/scripts/dedupeShipmentStoPo.ts <sto> <po> --apply              # rename/cancel
 *   npx ts-node src/scripts/dedupeShipmentStoPo.ts <sto> <po> --apply --force
 *   npx ts-node src/scripts/dedupeShipmentStoPo.ts <sto> <po> --apply --force-sto-change
 *
 * `--force-sto-change` bypasses isStoReplacedInLatestSap when renaming a planned keeper
 * whose shipment_id differs from <sto> (operator-confirmed SAP STO replacement).
 */
import { getClient } from '../database/connection';
import {
  cancelDuplicateShipmentsForPoAndSto,
  canAutoConsolidateShipmentForSap,
  finalizeSapShipmentAfterUpsert,
  isSapSourcedShipmentId,
  isStoReplacedInLatestSap,
} from '../utils/klipLogisticsActivity';
import { invalidateShipmentsListCache } from '../services/shipmentList.service';
import { invalidateShippingPerformanceRowCache } from '../services/shippingPerformance.service';

const stoFilter = process.argv[2]?.trim() || '';
const poFilter = process.argv[3]?.trim() || '';
const apply = process.argv.includes('--apply');
const force = process.argv.includes('--force');
const forceStoChange = process.argv.includes('--force-sto-change');

async function main() {
  if (!stoFilter || !poFilter) {
    console.error(
      'Usage: npx ts-node src/scripts/dedupeShipmentStoPo.ts <sto> <po> [--apply] [--force] [--force-sto-change]',
    );
    process.exit(1);
  }

  const client = await getClient();
  try {
    // Include planned numeric SAP rows on this PO even when shipment_id is still the old STO,
    // so STO-change rename (976 → 973) can find the keeper with operation_id.
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
          OR (
            NULLIF(TRIM(COALESCE(s.operation_id, '')), '') IS NOT NULL
            AND TRIM(COALESCE(s.shipment_id::text, '')) ~ '^[0-9]+$'
          )
          OR TRIM(COALESCE(s.shipment_id::text, '')) IN (
            SELECT TRIM(COALESCE(cs.sto_number::text, ''))
            FROM contract_stos cs
            WHERE cs.contract_id = c.id
          )
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

    const keeper =
      rows.rows.find((row) => row.operation_id && String(row.operation_id).trim()) ??
      rows.rows.find((row) => trimText(row.shipment_id) === stoFilter && isSapSourcedShipmentId(row.shipment_id)) ??
      rows.rows.find((row) => isSapSourcedShipmentId(row.shipment_id)) ??
      rows.rows[0];

    const currentSto = trimText(keeper.shipment_id);
    if (currentSto !== stoFilter) {
      const replaced =
        forceStoChange || (await isStoReplacedInLatestSap(client, poFilter, currentSto, stoFilter));
      if (!replaced) {
        console.log(
          `Keeper shipment_id=${currentSto}; latest SEA SAP does not show STO change to ${stoFilter} — no rename.`,
        );
        console.log('Re-run with --force-sto-change if business confirms the replacement.');
        return;
      }
      console.log(
        `Keeper ${currentSto} (${keeper.shipment_uuid}) will rename to ${stoFilter}` +
          (forceStoChange ? ' [--force-sto-change]' : ' [SEA SAP replacement confirmed]') +
          '.',
      );
    } else {
      console.log(`\nKeeper already on ${stoFilter}: ${keeper.shipment_uuid}`);
    }

    const duplicates = rows.rows.filter((row) => row.shipment_uuid !== keeper.shipment_uuid);
    for (const dup of duplicates) {
      const canCancel =
        force || (await canAutoConsolidateShipmentForSap(client, dup.shipment_uuid, dup.contract_uuid));
      console.log(
        `  ${apply ? 'will' : 'would'} ${canCancel ? 'CANCEL' : 'SKIP (KLIP activity — use --force)'}: ${dup.shipment_id ?? dup.shipment_uuid} [${dup.status}]`,
      );
    }

    if (!apply) {
      console.log('\nDry-run only. Re-run with --apply to rename / cancel.');
      if (!force) console.log('Add --force to cancel rows even when KLIP activity is detected.');
      if (!forceStoChange) {
        console.log('Add --force-sto-change to rename even when SEA SAP guard is inconclusive.');
      }
      return;
    }

    await client.query('BEGIN');
    try {
      const { cancelled, skipped } = await cancelDuplicateShipmentsForPoAndSto(
        client,
        poFilter,
        stoFilter,
        keeper.shipment_uuid,
        { force },
      );

      const reconcile = await finalizeSapShipmentAfterUpsert(
        client,
        keeper.contract_uuid,
        keeper.shipment_uuid,
        stoFilter,
        poFilter,
      );

      await client.query('COMMIT');

      console.log('\nCancelled:', [...cancelled, ...reconcile.cancelledShipmentIds].join(', ') || '—');
      console.log('Skipped:  ', [...skipped, ...reconcile.skippedShipmentIds].join(', ') || '—');

      invalidateShipmentsListCache();
      invalidateShippingPerformanceRowCache();
      console.log('\nDone. Shipments + shipping performance caches invalidated.');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
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
