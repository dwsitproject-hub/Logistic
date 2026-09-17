/**
 * Materialize missing KLIP shipment rows for SAP sea STO lines that exist in
 * sap_processed_data but have no active shipments.shipment_id identity.
 *
 * Also repairs parallel multi-STO collapse where operation_id holds another SAP STO
 * (e.g. shipment_id=1586004929, operation_id=1586004927) which blocked backfill.
 *
 * Run:
 *   npx ts-node --transpile-only src/scripts/backfillMissingSapStoShipments.ts --dry-run --po 1581000931
 *   npx ts-node --transpile-only src/scripts/backfillMissingSapStoShipments.ts --repair-operation-id --po 1581000931
 *   npx ts-node --transpile-only src/scripts/backfillMissingSapStoShipments.ts --diagnose --po 1581000931
 *
 * Docker (after rebuild):
 *   docker exec -w /app klip-backend node dist/scripts/backfillMissingSapStoShipments.js --repair-operation-id --po 1581000931
 */
import pool from '../database/connection';
import logger from '../utils/logger';
import {
  clearParallelSapStoOperationIdCollisions,
  ensureSapStoShipmentsBatch,
  findSapStoCandidates,
  isSapStoCandidateEligible,
} from '../services/ensureSapStoShipment.service';
import { sapStoNumberKeyExpr } from '../utils/shipmentStoTypeSql';
import { sqlShipmentMatchesSapStoExpr } from '../utils/klipLogisticsActivity';

function parseArgs(): {
  po?: string;
  dryRun: boolean;
  diagnose: boolean;
  repairOperationId: boolean;
  limit: number;
} {
  const poIdx = process.argv.indexOf('--po');
  const limitIdx = process.argv.indexOf('--limit');
  const po = poIdx > -1 ? String(process.argv[poIdx + 1] ?? '').trim() : undefined;
  const limitRaw = limitIdx > -1 ? Number(process.argv[limitIdx + 1]) : 200;
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(500, limitRaw)) : 200;
  return {
    po: po || undefined,
    dryRun: process.argv.includes('--dry-run'),
    diagnose: process.argv.includes('--diagnose'),
    repairOperationId: process.argv.includes('--repair-operation-id'),
    limit,
  };
}

async function runDiagnose(po: string): Promise<void> {
  const client = await pool.connect();
  const stoKey = sapStoNumberKeyExpr('spd');
  try {
    const dbInfo = await client.query(
      `SELECT current_database() AS db, inet_server_addr()::text AS host, current_user AS usr`,
    );
    logger.info('DB connection', dbInfo.rows[0]);

    const contract = await client.query(
      `SELECT id, contract_id, po_number, sto_number, incoterm, transport_mode, status
       FROM contracts
       WHERE TRIM(po_number::text) = TRIM($1::text)
       ORDER BY updated_at DESC NULLS LAST
       LIMIT 5`,
      [po],
    );
    logger.info('contracts for PO', { count: contract.rows.length, rows: contract.rows });

    const collisions = await clearParallelSapStoOperationIdCollisions(client, {
      po,
      dryRun: true,
    });
    logger.info('parallel operation_id collisions (dry)', { count: collisions.length, rows: collisions });

    const sapWithData = await client.query(
      `SELECT DISTINCT ON (TRIM(${stoKey}))
         spd.id,
         TRIM(${stoKey}) AS sto_key,
         spd.data->'raw'->>'STO Type' AS sto_type,
         spd.data->'contract'->>'sto_quantity' AS sto_qty,
         spd.data,
         EXISTS (
           SELECT 1
           FROM shipments s
           INNER JOIN contracts c ON c.id = s.contract_id
           WHERE TRIM(c.contract_id) = TRIM(spd.contract_number)
             AND ${sqlShipmentMatchesSapStoExpr('s', stoKey)}
             AND UPPER(COALESCE(s.status, '')) NOT IN ('CANCELLED')
         ) AS has_active_shipment
       FROM sap_processed_data spd
       WHERE TRIM(COALESCE(spd.po_number::text, '')) = TRIM($1::text)
         AND ${stoKey} IS NOT NULL
       ORDER BY TRIM(${stoKey}), spd.created_at DESC NULLS LAST`,
      [po],
    );

    const gaps: string[] = [];
    const ineligible: string[] = [];
    for (const row of sapWithData.rows) {
      const sto = String(row.sto_key ?? '');
      const eligible = isSapStoCandidateEligible(row.data);
      logger.info('[diagnose] SAP STO', {
        sto,
        hasShipment: row.has_active_shipment,
        stoType: row.sto_type,
        stoQty: row.sto_qty,
        eligible,
      });
      if (!row.has_active_shipment && eligible) gaps.push(sto);
      if (!row.has_active_shipment && !eligible) ineligible.push(sto);
    }

    const ships = await client.query(
      `SELECT s.shipment_id, s.operation_id, s.status, c.contract_id, c.po_number, c.incoterm
       FROM shipments s
       JOIN contracts c ON c.id = s.contract_id
       WHERE TRIM(c.po_number::text) = TRIM($1::text)
       ORDER BY s.shipment_id NULLS LAST, s.status`,
      [po],
    );
    logger.info('shipments for PO', { count: ships.rows.length, rows: ships.rows });

    const candidates = await findSapStoCandidates(client, { po, limit: 200 });
    logger.info('Missing SAP STO shipment diagnose finished', {
      po,
      sapStoCount: sapWithData.rows.length,
      shipmentCount: ships.rows.length,
      gapEligibleMissingShipment: gaps,
      missingButIneligible: ineligible,
      findSapStoCandidates: candidates.map((r) => r.sto_number),
      dbHostEnv: process.env.DB_HOST ?? null,
    });
  } finally {
    client.release();
  }
}

async function main(): Promise<void> {
  const { po, dryRun, diagnose, repairOperationId, limit } = parseArgs();
  logger.info('Missing SAP STO shipment backfill starting', {
    po: po ?? 'ALL (capped)',
    dryRun,
    diagnose,
    repairOperationId,
    limit,
    dbHostEnv: process.env.DB_HOST ?? null,
  });

  if (diagnose) {
    if (!po) {
      logger.error('--diagnose requires --po <po_number>');
      process.exit(1);
      return;
    }
    await runDiagnose(po);
    process.exit(0);
    return;
  }

  if (dryRun) {
    const client = await pool.connect();
    try {
      const collisions = await clearParallelSapStoOperationIdCollisions(client, {
        po,
        dryRun: true,
      });
      for (const row of collisions) {
        logger.info('[dry-run] Would clear colliding operation_id', row);
      }
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
        operationIdCollisions: collisions.length,
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
    repairOperationIdCollisions: repairOperationId,
  });

  logger.info('Missing SAP STO shipment backfill finished', result);
  process.exit(result.failed > 0 ? 1 : 0);
}

main().catch((err) => {
  logger.error('Missing SAP STO shipment backfill failed', err);
  process.exit(1);
});
