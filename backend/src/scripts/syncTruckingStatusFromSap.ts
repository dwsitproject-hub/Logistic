/**
 * One-time sync: copy SAP Trucking Last/Start Receive into trucking_operations
 * and set status PLANNED | IN_PROGRESS | COMPLETED.
 *
 * Usage: npx ts-node src/scripts/syncTruckingStatusFromSap.ts
 */
import { query } from '../database/connection';
import logger from '../utils/logger';
import { SQL_RECONCILE_TRUCKING_STATUS_FROM_SAP } from '../utils/truckingEffectiveStatus';

async function main() {
  const result = await query(`${SQL_RECONCILE_TRUCKING_STATUS_FROM_SAP} RETURNING t.id`);
  logger.info(`Synced ${result.rowCount ?? 0} trucking operation(s) from SAP receive dates.`);
  process.exit(0);
}

main().catch((err) => {
  logger.error(err);
  process.exit(1);
});
