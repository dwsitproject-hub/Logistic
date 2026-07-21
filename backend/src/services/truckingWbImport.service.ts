import type { PoolClient, QueryResultRow } from 'pg';
import { query } from '../database/connection';
import {
  isContractDeliveryClosed,
  SQL_CONTRACT_IMPORT_STATUS,
} from '../utils/contractDeliveryStatus';
import { usesGrStoStatus } from '../utils/sapIncotermMetrics';
import { contractEffectiveIncotermExpr } from '../utils/truckingIncotermScope';
import {
  aggregateWbRekapTickets,
  parseWbRekapWorkbook,
  resolveWbActualQtyKg,
  type WbRekapAggregatedRow,
  type WbRekapParseFailure,
  type WbRekapWorkbookSheet,
} from '../utils/truckingWbRekapUpload';
import { SQL_RESOLVE_PO_FROM_STO } from '../utils/truckingPoStoIdentitySql';
import { toIsoDate10FromCell } from '../utils/planningSheetDate';
import {
  syncTruckingQuantityDeliveredFromDailyActuals,
} from './truckingRealization.service';

type Queryable = Pick<PoolClient, 'query'> | typeof query;

async function runQuery<T extends QueryResultRow = QueryResultRow>(
  db: Queryable,
  text: string,
  params?: unknown[],
): Promise<{ rows: T[] }> {
  if (typeof (db as PoolClient).query === 'function' && 'release' in (db as object)) {
    const result = await (db as PoolClient).query<T>(text, params);
    return { rows: result.rows };
  }
  const result = await query(text, params);
  return { rows: result.rows as T[] };
}

export type WbImportOperationFailure = {
  po_number: string;
  sto_numbers?: string[];
  progress_date?: string;
  reason: string;
  operation_ids?: string[];
};

export type WbImportApplyResult = {
  importId: string;
  status: 'completed' | 'partial' | 'failed';
  sheetsProcessed: string[];
  sheetsSkipped: Array<{ sheetName: string; reason: string }>;
  rawTicketRows: number;
  aggregatedPoDates: number;
  operationsUpdated: number;
  operationsFailed: number;
  rowsUpserted: number;
  rowParseFailures: WbRekapParseFailure[];
  operationFailures: WbImportOperationFailure[];
  operationWarnings: WbImportOperationFailure[];
};

type TruckingOpForWbRow = {
  id: string;
  operation_id: string | null;
  status: string | null;
  incoterm: string | null;
  /** SAP/contracts product for this PO — optional info, not a sheet-name gate. */
  product: string | null;
};

async function findTruckingOpsByPoForWbImport(
  db: Queryable,
  poNumber: string,
): Promise<TruckingOpForWbRow[]> {
  const incotermExpr = contractEffectiveIncotermExpr('c');
  const result = await runQuery<TruckingOpForWbRow>(
    db,
    `SELECT
       t.id,
       t.operation_id,
       t.status,
       ${incotermExpr} AS incoterm,
       NULLIF(TRIM(COALESCE(c.product::text, '')), '') AS product
     FROM trucking_operations t
     INNER JOIN contracts c ON c.id = t.contract_id
     WHERE COALESCE(t.status, '') <> 'CANCELLED'
       AND TRIM(COALESCE(c.po_number::text, '')) = TRIM($1::text)
       AND ${incotermExpr} IN ('FRC', 'LCO')
     ORDER BY
       CASE
         WHEN UPPER(COALESCE(t.status, '')) IN ('PLANNED', 'IN_PROGRESS') THEN 0
         WHEN UPPER(COALESCE(t.status, '')) = 'UNPLANNED' THEN 1
         ELSE 2
       END,
       t.updated_at DESC NULLS LAST,
       t.id ASC`,
    [poNumber],
  );
  return result.rows;
}

/** Resolve PO from STO key; returns null when not found. */
async function resolvePoNumberFromSto(
  db: Queryable,
  stoKey: string,
): Promise<string | null> {
  const result = await runQuery<{ po_number: string | null }>(
    db,
    SQL_RESOLVE_PO_FROM_STO,
    [stoKey],
  );
  const po = result.rows[0]?.po_number;
  return po && String(po).trim() ? String(po).trim() : null;
}

type WbB2bChildLookup = {
  poNumber: string;
  originPoNumber: string;
};

/**
 * B2B child = contract_type/B2B Flag is B2B AND Contract Reff PO is non-empty (points at origin).
 * Origins keep Reff empty and remain eligible for trucking / WB.
 */
export function formatWbB2bChildRejectReason(poNumber: string, originPoNumber: string): string {
  const po = String(poNumber ?? '').trim() || '-';
  const origin = String(originPoNumber ?? '').trim();
  if (origin) {
    return `PO "${po}" is a B2B child PO (Contract Reff PO → origin "${origin}"). Upload WB applies to the origin PO only — use PO ${origin} on the trucking operation / WB file.`;
  }
  return `PO "${po}" is a B2B child PO. Upload WB applies to the origin (parent) PO only — child POs are excluded from trucking.`;
}

async function lookupWbB2bChildPo(
  db: Queryable,
  poNumber: string,
): Promise<WbB2bChildLookup | null> {
  const po = String(poNumber ?? '').trim();
  if (!po) return null;
  const result = await runQuery<{ po_number: string; origin_po: string | null }>(
    db,
    `SELECT
       TRIM(COALESCE(c.po_number::text, '')) AS po_number,
       NULLIF(TRIM(COALESCE(
         l.data->'contract'->>'contract_reference_po',
         l.data->>'CONTRACT REFF PO',
         l.data->>'Contract Reff PO Ini',
         l.data->'raw'->>'Contract Reff PO Ini',
         l.data->'raw'->>'CONTRACT REFF PO',
         ''
       )), '') AS origin_po
     FROM contracts c
     LEFT JOIN LATERAL (
       SELECT spd.data
       FROM sap_processed_data spd
       WHERE spd.contract_number = c.contract_id
       ORDER BY spd.created_at DESC NULLS LAST
       LIMIT 1
     ) l ON true
     WHERE TRIM(COALESCE(c.po_number::text, '')) = TRIM($1::text)
       AND UPPER(NULLIF(TRIM(COALESCE(
         l.data->'contract'->>'contract_type',
         l.data->>'B2B Flag',
         l.data->'raw'->>'B2B Flag',
         c.contract_type::text,
         ''
       )), '')) = 'B2B'
       AND NULLIF(TRIM(COALESCE(
         l.data->'contract'->>'contract_reference_po',
         l.data->>'CONTRACT REFF PO',
         l.data->>'Contract Reff PO Ini',
         l.data->'raw'->>'Contract Reff PO Ini',
         l.data->'raw'->>'CONTRACT REFF PO',
         ''
       )), '') IS NOT NULL
     LIMIT 1`,
    [po],
  );
  const row = result.rows[0];
  if (!row?.po_number) return null;
  return {
    poNumber: String(row.po_number).trim(),
    originPoNumber: String(row.origin_po ?? '').trim(),
  };
}

async function buildWbNoOpsFailureReason(
  db: Queryable,
  candidates: string[],
  fallbackLabel: string,
): Promise<string> {
  for (const key of candidates) {
    const asPo = await lookupWbB2bChildPo(db, key);
    if (asPo) {
      return formatWbB2bChildRejectReason(asPo.poNumber, asPo.originPoNumber);
    }
    const resolvedPo = await resolvePoNumberFromSto(db, key);
    if (resolvedPo) {
      const asResolved = await lookupWbB2bChildPo(db, resolvedPo);
      if (asResolved) {
        return formatWbB2bChildRejectReason(asResolved.poNumber, asResolved.originPoNumber);
      }
    }
  }
  return `No active FRC/LCO trucking operation found for PO/STO "${fallbackLabel}"`;
}

/**
 * Resolve WB aggregate identity to a PO number:
 * 1) Use poNumber as PO
 * 2) If no ops / blank, try stoNumbers / poNumber as STO → PO
 */
async function resolveWbAggregatePoNumber(
  db: Queryable,
  row: WbRekapAggregatedRow,
): Promise<{ poNumber: string; ops: TruckingOpForWbRow[] } | { error: string }> {
  const candidates: string[] = [];
  const push = (v: string | undefined | null) => {
    const s = String(v ?? '').trim();
    if (s && !candidates.includes(s)) candidates.push(s);
  };
  push(row.poNumber);
  for (const sto of row.stoNumbers ?? []) push(sto);

  let lastOps: TruckingOpForWbRow[] = [];
  for (const key of candidates) {
    let ops = await findTruckingOpsByPoForWbImport(db, key);
    if (ops.length > 0) {
      return { poNumber: key, ops };
    }
    const resolvedPo = await resolvePoNumberFromSto(db, key);
    if (resolvedPo) {
      ops = await findTruckingOpsByPoForWbImport(db, resolvedPo);
      if (ops.length > 0) {
        return { poNumber: resolvedPo, ops };
      }
      lastOps = ops;
    } else {
      lastOps = ops;
    }
  }

  const label = candidates.join(' / ') || row.poNumber || '-';
  if (lastOps.length === 0) {
    return {
      error: await buildWbNoOpsFailureReason(db, candidates, label),
    };
  }
  return { poNumber: candidates[0] || row.poNumber, ops: lastOps };
}

async function upsertDailyActualWithWbImport(
  db: Queryable,
  truckingOperationId: string,
  progressDate: string,
  quantityKg: number,
  wbImportId: string,
  quantityDeliveryKg: number,
  quantityReceiveKg: number,
  stoNumber = '',
): Promise<void> {
  await runQuery(
    db,
    `INSERT INTO trucking_daily_actuals (
       trucking_operation_id,
       progress_date,
       quantity_kg,
       quantity_delivery_kg,
       quantity_receive_kg,
       source,
       wb_import_id,
       sto_number
     )
     VALUES ($1, $2::date, $3::numeric, $5::numeric, $6::numeric, 'wb_rekap', $4::uuid, $7)
     ON CONFLICT (trucking_operation_id, progress_date, sto_number) DO UPDATE SET
       quantity_kg = EXCLUDED.quantity_kg,
       quantity_delivery_kg = EXCLUDED.quantity_delivery_kg,
       quantity_receive_kg = EXCLUDED.quantity_receive_kg,
       source = EXCLUDED.source,
       wb_import_id = EXCLUDED.wb_import_id,
       updated_at = CURRENT_TIMESTAMP`,
    [
      truckingOperationId,
      progressDate,
      quantityKg,
      wbImportId,
      quantityDeliveryKg,
      quantityReceiveKg,
      String(stoNumber ?? '').trim(),
    ],
  );
}

async function promoteOperationToInProgress(
  db: Queryable,
  truckingOperationId: string,
  earliestActualDate: string,
): Promise<void> {
  await runQuery(
    db,
    `UPDATE trucking_operations
     SET status = CASE
           WHEN UPPER(COALESCE(status, '')) IN ('CANCELLED', 'COMPLETED') THEN status
           ELSE 'IN_PROGRESS'
         END,
         trucking_start_date = CASE
           WHEN UPPER(COALESCE(status, '')) IN ('CANCELLED', 'COMPLETED') THEN trucking_start_date
           ELSE COALESCE(trucking_start_date, $2::date)
         END,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $1::uuid`,
    [truckingOperationId, earliestActualDate],
  );
  // Persist earliest WB actual date for Start Receive fallback when SAP AV is null.
  await runQuery(
    db,
    `INSERT INTO trucking_realizations (
       trucking_operation_id,
       realization_start_date,
       source,
       updated_at
     ) VALUES ($1::uuid, $2::date, 'wb_rekap', CURRENT_TIMESTAMP)
     ON CONFLICT (trucking_operation_id) DO UPDATE SET
       realization_start_date = CASE
         WHEN trucking_realizations.realization_start_date IS NULL THEN EXCLUDED.realization_start_date
         WHEN EXCLUDED.realization_start_date IS NULL THEN trucking_realizations.realization_start_date
         ELSE LEAST(trucking_realizations.realization_start_date, EXCLUDED.realization_start_date)
       END,
       source = CASE
         WHEN trucking_realizations.realization_start_date IS NULL
           OR EXCLUDED.realization_start_date IS NOT NULL
         THEN EXCLUDED.source
         ELSE trucking_realizations.source
       END,
       updated_at = CURRENT_TIMESTAMP`,
    [truckingOperationId, earliestActualDate],
  );
}

async function createWbImportBatch(
  db: Queryable,
  args: {
    originalFilename: string;
    uploadedBy: string | null;
    status: string;
    sheetsProcessed: string[];
    sheetsSkipped: Array<{ sheetName: string; reason: string }>;
    rawTicketRows: number;
    aggregatedPoDates: number;
    operationsUpdated: number;
    operationsFailed: number;
    rowsUpserted: number;
    rowParseFailures: WbRekapParseFailure[];
    operationFailures: WbImportOperationFailure[];
  },
): Promise<string> {
  const result = await runQuery<{ id: string }>(
    db,
    `INSERT INTO trucking_wb_imports (
       original_filename,
       uploaded_by,
       status,
       sheets_processed,
       sheets_skipped,
       raw_ticket_rows,
       aggregated_po_dates,
       operations_updated,
       operations_failed,
       rows_upserted,
       row_parse_failures,
       operation_failures
     ) VALUES (
       $1, $2::uuid, $3,
       $4::jsonb, $5::jsonb,
       $6, $7, $8, $9, $10,
       $11::jsonb, $12::jsonb
     )
     RETURNING id`,
    [
      args.originalFilename,
      args.uploadedBy,
      args.status,
      JSON.stringify(args.sheetsProcessed),
      JSON.stringify(args.sheetsSkipped),
      args.rawTicketRows,
      args.aggregatedPoDates,
      args.operationsUpdated,
      args.operationsFailed,
      args.rowsUpserted,
      JSON.stringify(args.rowParseFailures),
      JSON.stringify(args.operationFailures),
    ],
  );
  return String(result.rows[0]?.id);
}

async function applyAggregatedRow(
  db: Queryable,
  row: WbRekapAggregatedRow,
  wbImportId: string,
  operationFailures: WbImportOperationFailure[],
  operationWarnings: WbImportOperationFailure[],
): Promise<{ updated: boolean; upserted: number; operationId?: string }> {
  const resolved = await resolveWbAggregatePoNumber(db, row);
  if ('error' in resolved) {
    operationFailures.push({
      po_number: row.poNumber,
      sto_numbers: row.stoNumbers,
      progress_date: row.progressDateIso,
      reason: resolved.error,
    });
    return { updated: false, upserted: 0 };
  }

  const { poNumber, ops } = resolved;
  if (ops.length === 0) {
    operationFailures.push({
      po_number: poNumber,
      sto_numbers: row.stoNumbers,
      progress_date: row.progressDateIso,
      reason: 'No active FRC/LCO trucking operation found for this PO',
    });
    return { updated: false, upserted: 0 };
  }
  if (ops.length > 1) {
    const labels = ops
      .map((o) => {
        const id = (o.operation_id && String(o.operation_id).trim()) || o.id;
        const prod = o.product ? ` / ${o.product}` : '';
        return `${id}${prod}`;
      })
      .join(', ');
    operationFailures.push({
      po_number: poNumber,
      sto_numbers: row.stoNumbers,
      progress_date: row.progressDateIso,
      reason: `Multiple FRC/LCO trucking operations share PO "${poNumber}" (${labels})`,
      operation_ids: ops.map((o) => String(o.operation_id ?? o.id)),
    });
    return { updated: false, upserted: 0 };
  }

  const op = ops[0];
  const statusRes = await runQuery<{ import_status: string | null }>(
    db,
    `SELECT ${SQL_CONTRACT_IMPORT_STATUS} AS import_status
     FROM trucking_operations t
     LEFT JOIN contracts c ON t.contract_id = c.id
     WHERE t.id = $1::uuid
     LIMIT 1`,
    [op.id],
  );
  const importStatus = statusRes.rows[0]?.import_status ?? null;
  if (isContractDeliveryClosed(importStatus)) {
    const grLabel = usesGrStoStatus(op.incoterm) ? 'GR STO Status' : 'GR PO Status';
    operationFailures.push({
      po_number: poNumber,
      sto_numbers: row.stoNumbers,
      progress_date: row.progressDateIso,
      reason: `Cannot update quantity from WB: ${grLabel} is Close — quantity delivery/receive remain from SAP`,
      operation_ids: [String(op.operation_id ?? op.id)],
    });
    return { updated: false, upserted: 0 };
  }

  const qtyResult = resolveWbActualQtyKg(
    String(op.incoterm ?? ''),
    row.sumNettoPksKg,
    row.sumNettoEupKg,
  );
  if (!qtyResult.ok) {
    operationFailures.push({
      po_number: poNumber,
      sto_numbers: row.stoNumbers,
      progress_date: row.progressDateIso,
      reason: qtyResult.reason,
      operation_ids: [String(op.operation_id ?? op.id)],
    });
    return { updated: false, upserted: 0 };
  }

  // Always persist Delivery → quantity_delivery_kg and Receive → quantity_receive_kg.
  const stoForRow =
    String(row.stoNumber ?? '').trim() ||
    (row.stoNumbers?.length === 1 ? String(row.stoNumbers[0]).trim() : '');
  await upsertDailyActualWithWbImport(
    db,
    op.id,
    row.progressDateIso,
    qtyResult.quantityKg,
    wbImportId,
    row.sumNettoPksKg,
    row.sumNettoEupKg,
    stoForRow,
  );
  await syncTruckingQuantityDeliveredFromDailyActuals(db, op.id);
  await promoteOperationToInProgress(db, op.id, row.progressDateIso);

  if (qtyResult.softWarning) {
    const sapProductNote = op.product ? ` (SAP product: ${op.product})` : '';
    operationWarnings.push({
      po_number: poNumber,
      sto_numbers: row.stoNumbers,
      progress_date: row.progressDateIso,
      reason: `${qtyResult.softWarning}${sapProductNote}`,
      operation_ids: [String(op.operation_id ?? op.id)],
    });
  }

  return { updated: true, upserted: 1, operationId: op.id };
}

export async function processWbRekapWorkbookUpload(args: {
  originalFilename: string;
  uploadedBy: string | null;
  sheets: WbRekapWorkbookSheet[];
}): Promise<WbImportApplyResult> {
  const parsed = parseWbRekapWorkbook(args.sheets, toIsoDate10FromCell);
  const operationFailures: WbImportOperationFailure[] = [];
  const operationWarnings: WbImportOperationFailure[] = [];
  let operationsUpdated = 0;
  let rowsUpserted = 0;

  const touchedOpIds = new Set<string>();

  // Resolve STO → PO on tickets that lack PO so multi-STO same-date rows merge before apply.
  const stoPoCache = new Map<string, string | null>();
  for (const ticket of parsed.tickets) {
    if (ticket.poNumber) continue;
    const sto = String(ticket.stoNumber ?? '').trim();
    if (!sto) continue;
    let resolved = stoPoCache.get(sto);
    if (resolved === undefined) {
      resolved = await resolvePoNumberFromSto(query, sto);
      stoPoCache.set(sto, resolved);
    }
    if (resolved) ticket.poNumber = resolved;
  }
  const aggregated = aggregateWbRekapTickets(parsed.tickets);

  const importId = await createWbImportBatch(query, {
    originalFilename: args.originalFilename,
    uploadedBy: args.uploadedBy,
    status: 'completed',
    sheetsProcessed: parsed.sheetsProcessed,
    sheetsSkipped: parsed.sheetsSkipped,
    rawTicketRows: parsed.rawTicketRows,
    aggregatedPoDates: aggregated.length,
    operationsUpdated: 0,
    operationsFailed: 0,
    rowsUpserted: 0,
    rowParseFailures: parsed.rowParseFailures,
    operationFailures: [],
  });

  for (const agg of aggregated) {
    const result = await applyAggregatedRow(
      query,
      agg,
      importId,
      operationFailures,
      operationWarnings,
    );
    if (result.updated) {
      rowsUpserted += result.upserted;
      if (result.operationId) touchedOpIds.add(result.operationId);
    }
  }

  operationsUpdated = touchedOpIds.size;

  const status: WbImportApplyResult['status'] =
    rowsUpserted === 0 && operationFailures.length > 0
      ? 'failed'
      : operationFailures.length > 0
        ? 'partial'
        : 'completed';

  await runQuery(
    query,
    `UPDATE trucking_wb_imports
     SET status = $2,
         operations_updated = $3,
         operations_failed = $4,
         rows_upserted = $5,
         operation_failures = $6::jsonb,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $1::uuid`,
    [
      importId,
      status,
      operationsUpdated,
      operationFailures.length,
      rowsUpserted,
      JSON.stringify(operationFailures),
    ],
  );

  // Keep Contracts / Contract Performance Delivery & Received Qty in sync with WB
  // (list uses contract_qty_move_snapshot when fresh).
  if (touchedOpIds.size > 0) {
    const opIds = [...touchedOpIds];
    setImmediate(() => {
      import('./contractQtyMoveSnapshot.service')
        .then(({ ContractQtyMoveSnapshotService }) =>
          ContractQtyMoveSnapshotService.refreshForTruckingOperationIds(opIds),
        )
        .catch((err) => {
          // eslint-disable-next-line no-console
          console.error('[WB import] contract_qty_move_snapshot refresh failed', err);
        });
    });
  }

  return {
    importId,
    status,
    sheetsProcessed: parsed.sheetsProcessed,
    sheetsSkipped: parsed.sheetsSkipped,
    rawTicketRows: parsed.rawTicketRows,
    aggregatedPoDates: parsed.aggregated.length,
    operationsUpdated,
    operationsFailed: operationFailures.length,
    rowsUpserted,
    rowParseFailures: parsed.rowParseFailures,
    operationFailures,
    operationWarnings,
  };
}

export { parseWbRekapWorkbook, aggregateWbRekapTickets };
