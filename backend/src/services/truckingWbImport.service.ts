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
};

type TruckingOpForWbRow = {
  id: string;
  operation_id: string | null;
  status: string | null;
  incoterm: string | null;
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
       ${incotermExpr} AS incoterm
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

async function upsertDailyActualWithWbImport(
  db: Queryable,
  truckingOperationId: string,
  progressDate: string,
  quantityKg: number,
  wbImportId: string,
): Promise<void> {
  await runQuery(
    db,
    `INSERT INTO trucking_daily_actuals (trucking_operation_id, progress_date, quantity_kg, source, wb_import_id)
     VALUES ($1, $2::date, $3::numeric, 'wb_rekap', $4::uuid)
     ON CONFLICT (trucking_operation_id, progress_date) DO UPDATE SET
       quantity_kg = EXCLUDED.quantity_kg,
       source = EXCLUDED.source,
       wb_import_id = EXCLUDED.wb_import_id,
       updated_at = CURRENT_TIMESTAMP`,
    [truckingOperationId, progressDate, quantityKg, wbImportId],
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
): Promise<{ updated: boolean; upserted: number; operationId?: string }> {
  const ops = await findTruckingOpsByPoForWbImport(db, row.poNumber);
  if (ops.length === 0) {
    operationFailures.push({
      po_number: row.poNumber,
      progress_date: row.progressDateIso,
      reason: 'No active FRC/LCO trucking operation found for this PO',
    });
    return { updated: false, upserted: 0 };
  }
  if (ops.length > 1) {
    const labels = ops
      .map((o) => (o.operation_id && String(o.operation_id).trim()) || o.id)
      .join(', ');
    operationFailures.push({
      po_number: row.poNumber,
      progress_date: row.progressDateIso,
      reason: `Multiple FRC/LCO trucking operations share PO "${row.poNumber}" (${labels})`,
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
      po_number: row.poNumber,
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
      po_number: row.poNumber,
      progress_date: row.progressDateIso,
      reason: qtyResult.reason,
      operation_ids: [String(op.operation_id ?? op.id)],
    });
    return { updated: false, upserted: 0 };
  }

  await upsertDailyActualWithWbImport(
    db,
    op.id,
    row.progressDateIso,
    qtyResult.quantityKg,
    wbImportId,
  );
  await syncTruckingQuantityDeliveredFromDailyActuals(db, op.id);
  await promoteOperationToInProgress(db, op.id, row.progressDateIso);
  return { updated: true, upserted: 1, operationId: op.id };
}

export async function processWbRekapWorkbookUpload(args: {
  originalFilename: string;
  uploadedBy: string | null;
  sheets: WbRekapWorkbookSheet[];
}): Promise<WbImportApplyResult> {
  const parsed = parseWbRekapWorkbook(args.sheets, toIsoDate10FromCell);
  const operationFailures: WbImportOperationFailure[] = [];
  let operationsUpdated = 0;
  let rowsUpserted = 0;

  const touchedOpIds = new Set<string>();

  const importId = await createWbImportBatch(query, {
    originalFilename: args.originalFilename,
    uploadedBy: args.uploadedBy,
    status: 'completed',
    sheetsProcessed: parsed.sheetsProcessed,
    sheetsSkipped: parsed.sheetsSkipped,
    rawTicketRows: parsed.rawTicketRows,
    aggregatedPoDates: parsed.aggregated.length,
    operationsUpdated: 0,
    operationsFailed: 0,
    rowsUpserted: 0,
    rowParseFailures: parsed.rowParseFailures,
    operationFailures: [],
  });

  for (const agg of parsed.aggregated) {
    const result = await applyAggregatedRow(query, agg, importId, operationFailures);
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
  };
}

export { parseWbRekapWorkbook, aggregateWbRekapTickets };
