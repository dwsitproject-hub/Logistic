/**
 * Backfill KLIP shipments for FOB sea-leg STO rows (Type V) that SAP import skipped
 * because contracts.transport_mode = LAND.
 *
 * Run:
 *   npx ts-node src/scripts/backfillFobSeaStoShipments.ts
 *   npx ts-node src/scripts/backfillFobSeaStoShipments.ts --po 1011002812
 *   npx ts-node src/scripts/backfillFobSeaStoShipments.ts --dry-run
 */
import type { PoolClient } from 'pg';
import pool from '../database/connection';
import logger from '../utils/logger';
import {
  ensureSapStoShipmentsBatch,
  findSapStoCandidates,
  type SapStoCandidateRow,
} from '../services/ensureSapStoShipment.service';
import { sapStoNumberKeyExpr, sapStoTypeNormalizedExpr } from '../utils/shipmentStoTypeSql';

function parseArgs(): { po?: string; dryRun: boolean } {
  const poIdx = process.argv.indexOf('--po');
  const po = poIdx > -1 ? String(process.argv[poIdx + 1] ?? '').trim() : undefined;
  const dryRun = process.argv.includes('--dry-run');
  return { po: po || undefined, dryRun };
}

async function backfillContractStoTypes(client: PoolClient): Promise<number> {
  const res = await client.query(`
    UPDATE contract_stos cs
    SET sto_type = sub.sto_type,
        updated_at = CURRENT_TIMESTAMP
    FROM (
      SELECT DISTINCT ON (cs2.id)
        cs2.id AS contract_sto_id,
        ${sapStoTypeNormalizedExpr('spd')} AS sto_type
      FROM contract_stos cs2
      INNER JOIN contracts c ON c.id = cs2.contract_id
      INNER JOIN sap_processed_data spd
        ON TRIM(spd.contract_number) = TRIM(c.contract_id::text)
       AND TRIM(${sapStoNumberKeyExpr('spd')}) = TRIM(cs2.sto_number::text)
      WHERE NULLIF(TRIM(COALESCE(cs2.sto_type, '')), '') IS NULL
      ORDER BY cs2.id, spd.created_at DESC NULLS LAST
    ) sub
    WHERE cs.id = sub.contract_sto_id
      AND NULLIF(TRIM(sub.sto_type), '') IS NOT NULL
  `);
  return res.rowCount ?? 0;
}

async function main(): Promise<void> {
  const { po, dryRun } = parseArgs();
  const client = await pool.connect();

  try {
    logger.info('FOB sea-leg shipment backfill starting', { po: po ?? 'ALL', dryRun });

    const stoTypeUpdates = dryRun ? 0 : await backfillContractStoTypes(client);
    if (!dryRun) {
      logger.info(`Backfilled contract_stos.sto_type on ${stoTypeUpdates} row(s)`);
    }

    if (dryRun) {
      const candidates = await findSapStoCandidates(client, { po, fobOnly: true, limit: 500 });
      for (const row of candidates) {
        logger.info('[dry-run] Would ensure SAP STO shipment', {
          po: row.po_number,
          sto: row.sto_number,
          spdId: row.id,
        });
      }
      logger.info('FOB sea-leg shipment backfill dry-run finished', {
        candidates: candidates.length,
      });
      return;
    }

    const result = await ensureSapStoShipmentsBatch({
      po,
      fobOnly: true,
      limit: 500,
    });

    logger.info('FOB sea-leg shipment backfill finished', {
      ...result,
      stoTypeUpdates,
    });
  } finally {
    client.release();
    process.exit(0);
  }
}

main().catch((err) => {
  logger.error('FOB sea-leg shipment backfill failed', err);
  process.exit(1);
});

export { backfillContractStoTypes, findSapStoCandidates, main as backfillFobSeaStoShipments };
export type { SapStoCandidateRow };
