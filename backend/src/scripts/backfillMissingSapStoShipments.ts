/**
 * Materialize missing KLIP shipment rows for SAP sea STO lines that exist in
 * sap_processed_data but have no active shipments.shipment_id / operation_id.
 *
 * Fixes multi-STO POs collapsed to one shipment (e.g. search 1586004927 / 4928
 * finds nothing on SIT while SAP has three STO lines).
 *
 * Run (from backend, with DB env loaded):
 *   npx ts-node --transpile-only src/scripts/backfillMissingSapStoShipments.ts --dry-run
 *   npx ts-node --transpile-only src/scripts/backfillMissingSapStoShipments.ts --po 1581000931
 *   npx ts-node --transpile-only src/scripts/backfillMissingSapStoShipments.ts --limit 200
 *
 * Docker production image (after rebuild — script lives under dist/):
 *   docker exec -w /app klip-backend node dist/scripts/backfillMissingSapStoShipments.js --po 1581000931
 */
import pool from '../database/connection';
import logger from '../utils/logger';
import {
  ensureSapStoShipmentsBatch,
  findSapStoCandidates,
} from '../services/ensureSapStoShipment.service';

function parseArgs(): { po?: string; dryRun: boolean; limit: number } {
  const poIdx = process.argv.indexOf('--po');
  const limitIdx = process.argv.indexOf('--limit');
  const po = poIdx > -1 ? String(process.argv[poIdx + 1] ?? '').trim() : undefined;
  const limitRaw = limitIdx > -1 ? Number(process.argv[limitIdx + 1]) : 200;
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(500, limitRaw)) : 200;
  const dryRun = process.argv.includes('--dry-run');
  return { po: po || undefined, dryRun, limit };
}

async function main(): Promise<void> {
  const { po, dryRun, limit } = parseArgs();
  logger.info('Missing SAP STO shipment backfill starting', {
    po: po ?? 'ALL (capped)',
    dryRun,
    limit,
  });

  if (dryRun) {
    const client = await pool.connect();
    try {
      const candidates = await findSapStoCandidates(client, { po, limit });
      for (const row of candidates) {
        logger.info('[dry-run] Would ensure SAP STO shipment', {
          po: row.po_number,
          sto: row.sto_number,
          contract: row.contract_number,
          spdId: row.id,
        });
      }
      logger.info('Missing SAP STO shipment backfill dry-run finished', {
        candidates: candidates.length,
      });
    } finally {
      client.release();
    }
    process.exit(0);
    return;
  }

  const result = await ensureSapStoShipmentsBatch({
    po,
    limit,
    invalidateCache: true,
  });

  logger.info('Missing SAP STO shipment backfill finished', result);
  process.exit(result.failed > 0 ? 1 : 0);
}

main().catch((err) => {
  logger.error('Missing SAP STO shipment backfill failed', err);
  process.exit(1);
});
