/**
 * Auto-provision KLIP shipment rows from SAP STO data (idempotent).
 * Used by Preplanned list/summary load, SAP import fallback, and admin backfill scripts.
 */
import type { PoolClient } from 'pg';
import pool from '../database/connection';
import logger from '../utils/logger';
import { SapDataDistributionService } from './sapDataDistribution.service';
import { invalidateShipmentsListCache } from './shipmentList.service';
import { isSeaSapRowEligibleForShipmentCreation } from '../utils/seaShipmentEligibility';
import { isSapSeaStoLegForIncoterm, resolveSapStoTypeFromParsedData } from '../utils/sapSeaStoLeg';
import { buildShipmentPageSeaIncotermScopeSql } from '../utils/shipmentIncotermScope';
import { contractEffectiveIncotermExpr } from '../utils/truckingIncotermScope';
import {
  sapStoNumberKeyExpr,
  sapStoTypeNormalizedExpr,
  sqlIsSapSeaStoRowForIncotermExpr,
} from '../utils/shipmentStoTypeSql';
import { buildUnplannedContractToolbarScope } from '../utils/shipmentUnplannedHybridSql';
import { sqlShipmentMatchesSapStoExpr } from '../utils/klipLogisticsActivity';

export const DEFAULT_ENSURE_SAP_STO_BATCH_CAP = 50;

export interface EnsureSapStoShipmentBatchResult {
  processed: number;
  created: number;
  skipped: number;
  failed: number;
}

export interface SapStoCandidateRow {
  id: string;
  po_number: string | null;
  sto_number: string | null;
  contract_number: string | null;
  data: Record<string, unknown>;
}

export function isSapStoCandidateEligible(parsedData: unknown): boolean {
  if (!isSeaSapRowEligibleForShipmentCreation(parsedData)) return false;
  const inc = String(
    (parsedData as { contract?: { incoterm?: string } })?.contract?.incoterm ??
      (parsedData as { raw?: Record<string, unknown> })?.raw?.Incoterm ??
      '',
  )
    .trim()
    .toUpperCase();
  if (inc === 'FOB' && resolveSapStoTypeFromParsedData(parsedData) === 'T') return false;
  return isSapSeaStoLegForIncoterm(parsedData, inc || undefined);
}

export async function hasActiveShipmentForSto(
  client: PoolClient,
  contractNumber: string,
  stoNumber: string,
): Promise<boolean> {
  const res = await client.query(
    `SELECT 1
     FROM shipments s
     INNER JOIN contracts c ON c.id = s.contract_id
     WHERE TRIM(c.contract_id) = TRIM($1::text)
       AND ${sqlShipmentMatchesSapStoExpr('s', '$2')}
       AND UPPER(COALESCE(s.status, '')) NOT IN ('CANCELLED')
     LIMIT 1`,
    [contractNumber, stoNumber],
  );
  return res.rows.length > 0;
}

export function buildSapStoCandidateQuery(
  contractScopeSql: string,
  limit: number,
): { sql: string; params: unknown[] } {
  const inc = contractEffectiveIncotermExpr('c');
  const stoKey = sapStoNumberKeyExpr('spd');
  const sql = `
    SELECT DISTINCT ON (TRIM(spd.contract_number), TRIM(COALESCE(spd.po_number, '')), TRIM(${stoKey}))
      spd.id,
      spd.po_number,
      spd.sto_number,
      spd.contract_number,
      spd.data
    FROM sap_processed_data spd
    INNER JOIN contracts c
      ON TRIM(c.contract_id) = TRIM(spd.contract_number)
     AND TRIM(COALESCE(c.po_number, '')) = TRIM(COALESCE(spd.po_number, ''))
    WHERE ${stoKey} IS NOT NULL
      AND ${buildShipmentPageSeaIncotermScopeSql('c')}
      AND ${sqlIsSapSeaStoRowForIncotermExpr('spd', 'c')}
      AND ((${inc}) <> 'FOB' OR ${sapStoTypeNormalizedExpr('spd')} IS DISTINCT FROM 'T')
      AND NOT EXISTS (
        SELECT 1
        FROM shipments s
        WHERE s.contract_id = c.id
          AND ${sqlShipmentMatchesSapStoExpr('s', stoKey)}
          AND UPPER(COALESCE(s.status, '')) NOT IN ('CANCELLED')
      )
      ${contractScopeSql}
    ORDER BY TRIM(spd.contract_number),
             TRIM(COALESCE(spd.po_number, '')),
             TRIM(${stoKey}),
             spd.created_at DESC NULLS LAST
    LIMIT ${Math.max(1, Math.min(500, limit))}`;
  return { sql, params: [] };
}

export async function findSapStoCandidates(
  client: PoolClient,
  opts: {
    limit?: number;
    contractScope?: {
      dateFrom?: unknown;
      dateTo?: unknown;
      contract?: unknown;
      plants: string[];
    };
    po?: string;
    fobOnly?: boolean;
  } = {},
): Promise<SapStoCandidateRow[]> {
  const scope = opts.contractScope
    ? buildUnplannedContractToolbarScope(opts.contractScope)
    : { sql: '', params: [] as unknown[] };
  let extraSql = scope.sql ? ` AND ${scope.sql.replace(/^ AND /, '')}` : '';
  const params = [...scope.params];

  if (opts.po) {
    params.push(opts.po);
    extraSql += ` AND TRIM(spd.po_number::text) = TRIM($${params.length}::text)`;
  }
  if (opts.fobOnly) {
    extraSql += ` AND (${contractEffectiveIncotermExpr('c')}) = 'FOB'`;
    extraSql += ` AND ${sapStoTypeNormalizedExpr('spd')} = 'V'`;
  }

  const limit = opts.limit ?? DEFAULT_ENSURE_SAP_STO_BATCH_CAP;
  const { sql } = buildSapStoCandidateQuery(extraSql, limit);
  const res = await client.query(sql, params);
  const rows = res.rows as SapStoCandidateRow[];
  return rows.filter((row) => isSapStoCandidateEligible(row.data));
}

export async function ensureSapStoShipmentFromRow(
  client: PoolClient,
  row: SapStoCandidateRow,
  userId?: string,
): Promise<'created' | 'skipped' | 'failed'> {
  const stoNumber = String(row.sto_number ?? '').trim();
  const contractNumber = String(row.contract_number ?? '').trim();
  if (!stoNumber || !contractNumber) return 'skipped';

  if (!isSapStoCandidateEligible(row.data)) return 'skipped';

  if (await hasActiveShipmentForSto(client, contractNumber, stoNumber)) {
    return 'skipped';
  }

  try {
    await client.query('BEGIN');
    const result = await SapDataDistributionService.distributeData(client, row.data, userId);
    if (!result.shipmentId) {
      const fallbackId = await SapDataDistributionService.ensureSeaShipmentIfEligible(
        client,
        row.data,
        result.contractId,
        userId,
      );
      if (!fallbackId) {
        await client.query('ROLLBACK');
        return 'skipped';
      }
    }
    await client.query('COMMIT');
    return 'created';
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('ensureSapStoShipmentFromRow failed', {
      po: row.po_number,
      sto: stoNumber,
      spdId: row.id,
      err,
    });
    return 'failed';
  }
}

export interface ParallelStoOperationIdCollision {
  shipmentUuid: string;
  shipmentId: string;
  operationId: string;
  poNumber: string | null;
}

/**
 * Clear operation_id when it points at a different parallel SAP STO than shipment_id
 * on the same PO (both STOs still present in sap_processed_data).
 * Example SIT: shipment_id=1586004929, operation_id=1586004927 blocked materialize of 4927.
 */
export async function clearParallelSapStoOperationIdCollisions(
  client: PoolClient,
  opts: { po?: string; dryRun?: boolean } = {},
): Promise<ParallelStoOperationIdCollision[]> {
  const params: unknown[] = [];
  let poFilter = '';
  if (opts.po) {
    params.push(opts.po);
    poFilter = ` AND TRIM(c.po_number::text) = TRIM($${params.length}::text)`;
  }

  const selectSql = `
    SELECT s.id::text AS shipment_uuid,
           TRIM(s.shipment_id::text) AS shipment_id,
           TRIM(s.operation_id::text) AS operation_id,
           c.po_number
    FROM shipments s
    INNER JOIN contracts c ON c.id = s.contract_id
    WHERE COALESCE(s.status, '') <> 'CANCELLED'
      AND TRIM(COALESCE(s.shipment_id::text, '')) ~ '^[0-9]+$'
      AND TRIM(COALESCE(s.operation_id::text, '')) ~ '^[0-9]+$'
      AND TRIM(s.shipment_id::text) <> TRIM(s.operation_id::text)
      AND EXISTS (
        SELECT 1 FROM sap_processed_data spd
        WHERE TRIM(COALESCE(spd.po_number::text, '')) = TRIM(COALESCE(c.po_number::text, ''))
          AND TRIM(COALESCE(spd.sto_number::text, '')) = TRIM(s.operation_id::text)
      )
      AND EXISTS (
        SELECT 1 FROM sap_processed_data spd2
        WHERE TRIM(COALESCE(spd2.po_number::text, '')) = TRIM(COALESCE(c.po_number::text, ''))
          AND TRIM(COALESCE(spd2.sto_number::text, '')) = TRIM(s.shipment_id::text)
      )
      ${poFilter}
    ORDER BY c.po_number, s.shipment_id`;

  const found = await client.query(selectSql, params);
  const rows = found.rows.map((r) => ({
    shipmentUuid: String(r.shipment_uuid),
    shipmentId: String(r.shipment_id),
    operationId: String(r.operation_id),
    poNumber: r.po_number != null ? String(r.po_number) : null,
  }));

  if (opts.dryRun || rows.length === 0) return rows;

  await client.query(
    `UPDATE shipments s
     SET operation_id = NULL, updated_at = CURRENT_TIMESTAMP
     FROM contracts c
     WHERE s.contract_id = c.id
       AND s.id = ANY($1::uuid[])`,
    [rows.map((r) => r.shipmentUuid)],
  );

  return rows;
}

export async function ensureSapStoShipmentsBatch(
  opts: {
    limit?: number;
    contractScope?: {
      dateFrom?: unknown;
      dateTo?: unknown;
      contract?: unknown;
      plants: string[];
    };
    po?: string;
    fobOnly?: boolean;
    userId?: string;
    invalidateCache?: boolean;
    /** Clear parallel STO operation_id collisions before materializing missing rows. */
    repairOperationIdCollisions?: boolean;
  } = {},
): Promise<EnsureSapStoShipmentBatchResult & { repairedOperationIds: number }> {
  const client = await pool.connect();
  const result: EnsureSapStoShipmentBatchResult & { repairedOperationIds: number } = {
    processed: 0,
    created: 0,
    skipped: 0,
    failed: 0,
    repairedOperationIds: 0,
  };

  try {
    if (opts.repairOperationIdCollisions) {
      const cleared = await clearParallelSapStoOperationIdCollisions(client, {
        po: opts.po,
        dryRun: false,
      });
      result.repairedOperationIds = cleared.length;
      if (cleared.length > 0) {
        logger.info('Cleared parallel SAP STO operation_id collisions', {
          count: cleared.length,
          samples: cleared.slice(0, 10),
        });
      }
    }

    const candidates = await findSapStoCandidates(client, {
      limit: opts.limit ?? DEFAULT_ENSURE_SAP_STO_BATCH_CAP,
      contractScope: opts.contractScope,
      po: opts.po,
      fobOnly: opts.fobOnly,
    });

    for (const row of candidates) {
      result.processed += 1;
      const status = await ensureSapStoShipmentFromRow(client, row, opts.userId);
      if (status === 'created') result.created += 1;
      else if (status === 'failed') result.failed += 1;
      else result.skipped += 1;
    }

    if (
      (result.created > 0 || result.repairedOperationIds > 0) &&
      opts.invalidateCache !== false
    ) {
      invalidateShipmentsListCache();
    }

    if (result.created > 0 || result.repairedOperationIds > 0) {
      logger.info('ensureSapStoShipmentsBatch finished', result);
    }
  } finally {
    client.release();
  }

  return result;
}
