import pool from '../database/connection';
import logger from '../utils/logger';
import { SapDataDistributionService } from '../services/sapDataDistribution.service';

async function main() {
  const client = await pool.connect();
  try {
    logger.info('Starting reprocess/backfill for latest SAP import...');

    // Optional target by contract_number
    const contractNumber = process.env.CONTRACT_NUMBER || process.argv[2];

    let rowsRes;
    if (contractNumber) {
      logger.info(`Reprocessing by contract_number ${contractNumber} across all imports...`);
      rowsRes = await client.query(
        `SELECT id, data
         FROM sap_processed_data
         WHERE contract_number = $1
         ORDER BY created_at ASC`,
        [contractNumber]
      );
    } else {
      // Find latest import
      const importRes = await client.query(
        `SELECT id, import_timestamp, total_records
         FROM sap_data_imports
         ORDER BY import_timestamp DESC
         LIMIT 1`
      );
      if (importRes.rows.length === 0) {
        logger.warn('No sap_data_imports found. Nothing to reprocess.');
        return;
      }
  
      const latestImport = importRes.rows[0];
      const importId: string = latestImport.id;
      logger.info('Latest import selected', latestImport);
  
      // Get processed rows for that import
      rowsRes = await client.query(
        `SELECT id, data
         FROM sap_processed_data
         WHERE import_id = $1
         ORDER BY created_at ASC`,
        [importId]
      );
    }

    const total = rowsRes.rows.length;
    logger.info(`Found ${total} processed rows to re-distribute`);

    let success = 0;
    let failed = 0;

    // Process sequentially to avoid excessive DB contention
    for (const row of rowsRes.rows) {
      const parsedData = row.data; // Should already be the structured object with contract/shipment/etc
      try {
        await client.query('BEGIN');
        await SapDataDistributionService.distributeData(client, parsedData, undefined);
        await client.query('COMMIT');
        success++;
      } catch (err) {
        await client.query('ROLLBACK');
        failed++;
        logger.error(`Failed to distribute processed row ${row.id}`, err);
      }
    }

    logger.info(`Backfill completed. Success: ${success}, Failed: ${failed}, Total: ${total}`);
  } catch (error) {
    logger.error('Reprocess script failed', error);
  } finally {
    client.release();
    // End process to exit when run via ts-node
    process.exit(0);
  }
}

main();


