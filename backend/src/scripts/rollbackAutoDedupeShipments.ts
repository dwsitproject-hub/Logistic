/**
 * Roll back auto-dedupe damage: restore shipments wrongly set to CANCELLED by SAP reconcile.
 * Skips rows manually cancelled via UI (audit_logs after_data.status = CANCELLED).
 *
 *   npx ts-node src/scripts/rollbackAutoDedupeShipments.ts
 *   npx ts-node src/scripts/rollbackAutoDedupeShipments.ts --apply
 *   npm run rollback:auto-dedupe-shipments:prod -- --apply
 */
import { getClient } from '../database/connection';
import { deriveShipmentStatus } from '../utils/shipmentStatus';
import { invalidateShipmentsListCache } from '../services/shipmentList.service';
import { invalidateShippingPerformanceRowCache } from '../services/shippingPerformance.service';

const apply = process.argv.includes('--apply');

interface ShipmentRow {
  id: string;
  po_number: string | null;
  shipment_id: string | null;
  status: string;
  contract_import_status: string | null;
  eta_arrival: string | null;
  eta_berthed: string | null;
  eta_loading_start: string | null;
  eta_loading_complete: string | null;
  eta_sailed: string | null;
  eta_discharge_arrival: string | null;
  eta_discharge_berthed: string | null;
  eta_discharge_start: string | null;
  eta_discharge_complete: string | null;
  ata_arrival: string | null;
  ata_berthed: string | null;
  ata_loading_start: string | null;
  ata_loading_complete: string | null;
  ata_sailed: string | null;
  ata_discharge_arrival: string | null;
  ata_discharge_berthed: string | null;
  ata_discharge_start: string | null;
  ata_discharge_complete: string | null;
}

function wasManuallyCancelledSql(): string {
  return `
    EXISTS (
      SELECT 1 FROM audit_logs al
      WHERE al.entity_type = 'SHIPMENT'
        AND al.entity_id = s.id
        AND al.action = 'UPDATE'
        AND UPPER(TRIM(COALESCE(al.after_data->>'status', ''))) IN ('CANCELLED', 'CANCELED')
    )
  `;
}

async function loadCandidates(client: Awaited<ReturnType<typeof getClient>>): Promise<ShipmentRow[]> {
  const res = await client.query<ShipmentRow>(`
    SELECT
      s.id,
      c.po_number,
      s.shipment_id,
      s.status,
      COALESCE(
        NULLIF(TRIM(latest.data->'contract'->>'status'), ''),
        NULLIF(TRIM(c.status), '')
      ) AS contract_import_status,
      s.eta_arrival::text,
      s.eta_berthed::text,
      s.eta_loading_start::text,
      s.eta_loading_complete::text,
      s.eta_sailed::text,
      s.eta_discharge_arrival::text,
      s.eta_discharge_berthed::text,
      s.eta_discharge_start::text,
      s.eta_discharge_complete::text,
      s.ata_arrival::text,
      s.ata_berthed::text,
      s.ata_loading_start::text,
      s.ata_loading_complete::text,
      s.ata_sailed::text,
      s.ata_discharge_arrival::text,
      s.ata_discharge_berthed::text,
      s.ata_discharge_start::text,
      s.ata_discharge_complete::text
    FROM shipments s
    INNER JOIN contracts c ON c.id = s.contract_id
    LEFT JOIN LATERAL (
      SELECT spd.data
      FROM sap_processed_data spd
      WHERE TRIM(spd.contract_number) = TRIM(c.contract_id)
      ORDER BY spd.created_at DESC NULLS LAST, spd.id DESC
      LIMIT 1
    ) latest ON true
    WHERE UPPER(TRIM(COALESCE(s.status, ''))) IN ('CANCELLED', 'CANCELED')
      AND NOT ${wasManuallyCancelledSql()}
    ORDER BY c.po_number NULLS LAST, s.shipment_id NULLS LAST
  `);
  return res.rows;
}

function deriveRestoredStatus(row: ShipmentRow): string {
  return deriveShipmentStatus({
    contract_import_status: row.contract_import_status,
    eta_arrival_at_loading_port: row.eta_arrival,
    eta_berthed_at_loading_port: row.eta_berthed,
    eta_start_loading: row.eta_loading_start,
    eta_completed_loading: row.eta_loading_complete,
    eta_sailed_from_loading_port: row.eta_sailed,
    eta_arrive_at_discharge_port: row.eta_discharge_arrival,
    eta_berthed_at_discharge_port: row.eta_discharge_berthed,
    eta_start_discharging: row.eta_discharge_start,
    eta_complete_discharge: row.eta_discharge_complete,
    ata_arrival_at_loading_port: row.ata_arrival,
    ata_berthed_at_loading_port: row.ata_berthed,
    ata_start_loading: row.ata_loading_start,
    ata_completed_loading: row.ata_loading_complete,
    ata_sailed_from_loading_port: row.ata_sailed,
    ata_arrive_at_discharge_port: row.ata_discharge_arrival,
    ata_berthed_at_discharge_port: row.ata_discharge_berthed,
    ata_start_discharging: row.ata_discharge_start,
    ata_complete_discharge: row.ata_discharge_complete,
  });
}

async function main() {
  const client = await getClient();
  try {
    const candidates = await loadCandidates(client);
    console.log(`Mode: ${apply ? 'APPLY' : 'DRY-RUN'}`);
    console.log(`Shipments to restore (auto-cancelled, not manual): ${candidates.length}`);

    const byNewStatus: Record<string, number> = {};
    for (const row of candidates) {
      const newStatus = deriveRestoredStatus(row);
      byNewStatus[newStatus] = (byNewStatus[newStatus] || 0) + 1;
    }
    console.log('Restored status distribution:', byNewStatus);

    if (candidates.length > 0) {
      console.log('\nSample (first 15):');
      for (const row of candidates.slice(0, 15)) {
        const newStatus = deriveRestoredStatus(row);
        console.log(
          `  PO ${row.po_number ?? '—'} | ${row.shipment_id ?? row.id} | CANCELLED → ${newStatus}`,
        );
      }
    }

    if (!apply) {
      console.log('\nDry-run only. Re-run with --apply to commit.');
      return;
    }

    await client.query('BEGIN');
    let updated = 0;
    for (const row of candidates) {
      const newStatus = deriveRestoredStatus(row);
      await client.query(
        `UPDATE shipments SET status = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1::uuid`,
        [row.id, newStatus],
      );
      updated += 1;
    }
    await client.query('COMMIT');

    invalidateShipmentsListCache();
    invalidateShippingPerformanceRowCache();

    console.log(`\nRollback complete. Restored ${updated} shipment row(s).`);
    console.log('Restart backend or wait ~5 min for Shipping Performance cache.');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
