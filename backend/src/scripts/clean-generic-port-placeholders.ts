/**
 * Remove legacy generic KLIP port placeholders from vessel_loading_ports and shipments.
 *
 * Usage:
 *   npx ts-node src/scripts/clean-generic-port-placeholders.ts
 *   npx ts-node src/scripts/clean-generic-port-placeholders.ts --sto 1586004914
 *   npx ts-node src/scripts/clean-generic-port-placeholders.ts --dry-run
 */

import { query } from '../database/connection';
import logger from '../utils/logger';

const PLACEHOLDER_VLP_SQL = `
  port_name IN ('Loading Port 1', 'Discharge Port')
  OR port_name ~ '^Loading Port [0-9]+$'
`;

const PLACEHOLDER_SHIPMENT_COL_SQL = `
  port_of_loading IN ('Loading Port 1', 'Discharge Port')
  OR port_of_loading ~ '^Loading Port [0-9]+$'
  OR port_of_discharge = 'Discharge Port'
`;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const stoIdx = args.indexOf('--sto');
  const stoFilter = stoIdx >= 0 ? String(args[stoIdx + 1] ?? '').trim() : '';

  if (stoIdx >= 0 && !stoFilter) {
    throw new Error('--sto requires a STO number');
  }

  const shipmentScopeSql = stoFilter
    ? `AND EXISTS (
        SELECT 1 FROM shipments s
        LEFT JOIN contracts c ON c.id = s.contract_id
        WHERE s.id = vlp.shipment_id
          AND TRIM(COALESCE(c.sto_number::text, s.operation_id, s.shipment_id::text)) = $1
      )`
    : '';

  const vlpParams = stoFilter ? [stoFilter] : [];

  const vlpPreview = await query(
    `SELECT vlp.id, vlp.shipment_id, vlp.port_name, vlp.port_sequence, vlp.is_discharge_port
     FROM vessel_loading_ports vlp
     WHERE (${PLACEHOLDER_VLP_SQL})
     ${shipmentScopeSql}
     ORDER BY vlp.shipment_id, vlp.port_sequence`,
    vlpParams,
  );

  logger.info(`Found ${vlpPreview.rows.length} placeholder vessel_loading_ports row(s)`, {
    dryRun,
    stoFilter: stoFilter || 'ALL',
  });

  if (!dryRun && vlpPreview.rows.length > 0) {
    await query(
      `DELETE FROM vessel_loading_ports vlp
       WHERE (${PLACEHOLDER_VLP_SQL})
       ${shipmentScopeSql}`,
      vlpParams,
    );
  }

  const shipScopeSql = stoFilter
    ? `AND TRIM(COALESCE(c.sto_number::text, s.operation_id, s.shipment_id::text)) = $1`
    : '';
  const shipParams = stoFilter ? [stoFilter] : [];

  const shipPreview = await query(
    `SELECT s.id, s.shipment_id, c.sto_number, s.port_of_loading, s.port_of_discharge
     FROM shipments s
     LEFT JOIN contracts c ON c.id = s.contract_id
     WHERE (${PLACEHOLDER_SHIPMENT_COL_SQL})
     ${shipScopeSql}`,
    shipParams,
  );

  logger.info(`Found ${shipPreview.rows.length} shipment(s) with placeholder port_of_* values`, {
    dryRun,
    stoFilter: stoFilter || 'ALL',
  });

  if (!dryRun && shipPreview.rows.length > 0) {
    await query(
      `UPDATE shipments s
       SET
         port_of_loading = CASE
           WHEN port_of_loading IN ('Loading Port 1', 'Discharge Port')
             OR port_of_loading ~ '^Loading Port [0-9]+$'
           THEN NULL
           ELSE port_of_loading
         END,
         port_of_discharge = CASE
           WHEN port_of_discharge = 'Discharge Port' THEN NULL
           ELSE port_of_discharge
         END,
         updated_at = CURRENT_TIMESTAMP
       FROM contracts c
       WHERE c.id = s.contract_id
         AND (${PLACEHOLDER_SHIPMENT_COL_SQL})
         ${shipScopeSql}`,
      shipParams,
    );
  }

  if (dryRun) {
    logger.info('Dry run — no rows modified', {
      sampleVlp: vlpPreview.rows.slice(0, 5),
      sampleShipments: shipPreview.rows.slice(0, 5),
    });
  } else {
    logger.info('Cleanup complete', {
      deletedVlpRows: vlpPreview.rows.length,
      updatedShipments: shipPreview.rows.length,
    });
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    logger.error('clean-generic-port-placeholders failed', error);
    process.exit(1);
  });
