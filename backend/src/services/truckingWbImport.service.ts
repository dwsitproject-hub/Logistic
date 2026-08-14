import type { PoolClient, QueryResultRow } from 'pg';
import { getClient, query } from '../database/connection';
import {
  isContractDeliveryClosed,
  SQL_CONTRACT_IMPORT_STATUS,
} from '../utils/contractDeliveryStatus';
import { usesGrStoStatus } from '../utils/sapIncotermMetrics';
import { contractEffectiveIncotermExpr } from '../utils/truckingIncotermScope';
import {
  aggregateWbRekapTickets,
  filterWbRekapUserFacingRowParseFailures,
  parseWbRekapWorkbook,
  resolveWbActualQtyKg,
  type WbRekapAggregatedRow,
  type WbRekapParseFailure,
  type WbRekapWorkbookSheet,
} from '../utils/truckingWbRekapUpload';
import { SQL_RESOLVE_PO_FROM_STO_BATCH } from '../utils/truckingPoStoIdentitySql';
import { toIsoDate10FromCell } from '../utils/planningSheetDate';
import { syncTruckingQuantityDeliveredFromDailyActuals } from './truckingRealization.service';
import {
  allocateNextSyntheticSequence,
  buildSyntheticOperationId,
  formatDDMMYYYY,
} from '../utils/operationId';
import {
  findActiveTruckingOpsByContractId,
  SQL_TRUCKING_KEEPER_ORDER_BY_WB_COMPLETE,
  sqlTruckingOpIsActiveForMatchingSql,
} from '../utils/truckingOperationUniqueness';
import { invalidateTruckingListCache } from './truckingList.service';
import {
  dedupeActiveTruckingOpsForPo,
  scheduleTruckingPipelineRefresh,
} from './truckingDedupe.service';

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
  operationDeduped: WbImportOperationFailure[];
};

type TruckingOpForWbRow = {
  id: string;
  operation_id: string | null;
  status: string | null;
  incoterm: string | null;
  /** SAP/contracts product for this PO — optional info, not a sheet-name gate. */
  product: string | null;
};

/**
 * Contract-level diagnostic used both to build precise "no active operation" failure
 * reasons and to decide auto-create eligibility — fetched once per distinct PO candidate
 * across the whole workbook instead of per aggregated row.
 */
type WbContractDiagnostic = {
  poNumber: string;
  contractUuid: string;
  transportMode: string | null;
  incoterm: string | null;
  importStatus: string | null;
  /** Non-null when this PO is itself a B2B child pointing at an origin PO. */
  b2bOriginPo: string | null;
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

/**
 * Batch-resolve trucking operations (active, FRC/LCO only) for a whole set of PO candidates
 * in one round trip — replaces the old per-row `findTruckingOpsByPoForWbImport` query.
 */
async function findTruckingOpsByPoForWbImportBatch(
  db: Queryable,
  poNumbers: string[],
): Promise<Map<string, TruckingOpForWbRow[]>> {
  const map = new Map<string, TruckingOpForWbRow[]>();
  if (poNumbers.length === 0) return map;
  const incotermExpr = contractEffectiveIncotermExpr('c');
  const result = await runQuery<TruckingOpForWbRow & { po_number: string }>(
    db,
    `SELECT
       t.id,
       t.operation_id,
       t.status,
       ${incotermExpr} AS incoterm,
       NULLIF(TRIM(COALESCE(c.product::text, '')), '') AS product,
       TRIM(COALESCE(c.po_number::text, '')) AS po_number
     FROM trucking_operations t
     INNER JOIN contracts c ON c.id = t.contract_id
     WHERE ${sqlTruckingOpIsActiveForMatchingSql('t')}
       AND TRIM(COALESCE(c.po_number::text, '')) = ANY($1::text[])
       AND ${incotermExpr} IN ('FRC', 'LCO')
     ORDER BY
       TRIM(COALESCE(c.po_number::text, '')),
       CASE
         WHEN UPPER(COALESCE(t.status, '')) IN ('PLANNED', 'IN_PROGRESS') THEN 0
         WHEN UPPER(COALESCE(t.status, '')) = 'UNPLANNED' THEN 1
         ELSE 2
       END,
       t.updated_at DESC NULLS LAST,
       t.id ASC`,
    [poNumbers],
  );
  for (const row of result.rows) {
    const list = map.get(row.po_number) ?? [];
    list.push(row);
    map.set(row.po_number, list);
  }
  return map;
}

/** Batch-resolve PO numbers for a whole set of STO keys in one round trip. */
async function batchResolvePoFromSto(
  db: Queryable,
  stoKeys: string[],
): Promise<Map<string, string | null>> {
  const map = new Map<string, string | null>();
  if (stoKeys.length === 0) return map;
  const result = await runQuery<{ sto_key: string; po_number: string | null }>(
    db,
    SQL_RESOLVE_PO_FROM_STO_BATCH,
    [stoKeys],
  );
  for (const row of result.rows) {
    const po = row.po_number && String(row.po_number).trim() ? String(row.po_number).trim() : null;
    map.set(row.sto_key, po);
  }
  return map;
}

/**
 * Batch-fetch contract-level diagnostics (existence in SAP, transport mode, effective
 * incoterm, GR import status, B2B child status) for a whole set of PO candidates in one
 * round trip. Feeds both the detailed "no active operation" failure reasons and the
 * auto-create eligibility check.
 */
async function batchFetchContractDiagnostics(
  db: Queryable,
  poNumbers: string[],
): Promise<Map<string, WbContractDiagnostic>> {
  const map = new Map<string, WbContractDiagnostic>();
  if (poNumbers.length === 0) return map;
  const incotermExpr = contractEffectiveIncotermExpr('c');
  const result = await runQuery<{
    po_number: string;
    contract_uuid: string;
    transport_mode: string | null;
    incoterm: string | null;
    import_status: string | null;
    b2b_origin_po: string | null;
    contract_type_norm: string | null;
  }>(
    db,
    `SELECT x.po_number, x.contract_uuid, x.transport_mode, x.incoterm, x.import_status,
            x.b2b_origin_po, x.contract_type_norm
     FROM (
       SELECT
         TRIM(COALESCE(c.po_number::text, '')) AS po_number,
         c.id::text AS contract_uuid,
         NULLIF(TRIM(COALESCE(c.transport_mode::text, '')), '') AS transport_mode,
         ${incotermExpr} AS incoterm,
         ${SQL_CONTRACT_IMPORT_STATUS} AS import_status,
         NULLIF(TRIM(COALESCE(
           l.data->'contract'->>'contract_reference_po',
           l.data->>'CONTRACT REFF PO',
           l.data->>'Contract Reff PO Ini',
           l.data->'raw'->>'Contract Reff PO Ini',
           l.data->'raw'->>'CONTRACT REFF PO',
           ''
         )), '') AS b2b_origin_po,
         UPPER(NULLIF(TRIM(COALESCE(
           l.data->'contract'->>'contract_type',
           l.data->>'B2B Flag',
           l.data->'raw'->>'B2B Flag',
           c.contract_type::text,
           ''
         )), '')) AS contract_type_norm,
         ROW_NUMBER() OVER (
           PARTITION BY TRIM(COALESCE(c.po_number::text, ''))
           ORDER BY c.updated_at DESC NULLS LAST, c.created_at DESC
         ) AS rn
       FROM contracts c
       LEFT JOIN LATERAL (
         SELECT spd.data
         FROM sap_processed_data spd
         WHERE spd.contract_number = c.contract_id
         ORDER BY spd.created_at DESC NULLS LAST
         LIMIT 1
       ) l ON true
       WHERE TRIM(COALESCE(c.po_number::text, '')) = ANY($1::text[])
     ) x
     WHERE x.rn = 1`,
    [poNumbers],
  );
  for (const row of result.rows) {
    const isB2bChild = row.contract_type_norm === 'B2B' && Boolean(row.b2b_origin_po);
    map.set(row.po_number, {
      poNumber: row.po_number,
      contractUuid: row.contract_uuid,
      transportMode: row.transport_mode,
      incoterm: row.incoterm,
      importStatus: row.import_status,
      b2bOriginPo: isB2bChild ? row.b2b_origin_po : null,
    });
  }
  return map;
}

/**
 * Batch-fetch trucking_operations counts (any status vs non-cancelled) per PO — lets the
 * "no active op" failure path distinguish "all cancelled" from "none created yet" without
 * a per-row query (the FRC/LCO-only lookup above never returns CANCELLED rows at all).
 */
async function batchFetchAnyStatusOpsCounts(
  db: Queryable,
  poNumbers: string[],
): Promise<Map<string, { total: number; active: number }>> {
  const map = new Map<string, { total: number; active: number }>();
  if (poNumbers.length === 0) return map;
  const result = await runQuery<{ po_number: string; total: string; active: string }>(
    db,
    `SELECT
       TRIM(COALESCE(c.po_number::text, '')) AS po_number,
       COUNT(*)::text AS total,
       COUNT(*) FILTER (WHERE ${sqlTruckingOpIsActiveForMatchingSql('t')})::text AS active
     FROM trucking_operations t
     INNER JOIN contracts c ON c.id = t.contract_id
     WHERE TRIM(COALESCE(c.po_number::text, '')) = ANY($1::text[])
     GROUP BY TRIM(COALESCE(c.po_number::text, ''))`,
    [poNumbers],
  );
  for (const row of result.rows) {
    map.set(row.po_number, { total: Number(row.total) || 0, active: Number(row.active) || 0 });
  }
  return map;
}

/** Prefer non-COMPLETED ops when multiple active rows share a PO (WB import match). */
function narrowOpsForWbImport(ops: TruckingOpForWbRow[]): TruckingOpForWbRow[] {
  if (ops.length <= 1) return ops;
  const nonCompleted = ops.filter(
    (o) => String(o.status ?? '').trim().toUpperCase() !== 'COMPLETED',
  );
  return nonCompleted.length > 0 ? nonCompleted : ops;
}

function normalizeOpsByPoMap(map: Map<string, TruckingOpForWbRow[]>): void {
  for (const [po, ops] of map) {
    map.set(po, narrowOpsForWbImport(ops));
  }
}

async function pickWbImportKeeperOp(
  db: Queryable,
  ops: TruckingOpForWbRow[],
): Promise<{ keeper: TruckingOpForWbRow; siblings: TruckingOpForWbRow[] }> {
  if (ops.length === 0) {
    throw new Error('pickWbImportKeeperOp: empty ops');
  }
  if (ops.length === 1) {
    return { keeper: ops[0], siblings: [] };
  }
  const result = await runQuery<{ id: string }>(
    db,
    `SELECT t.id
     FROM trucking_operations t
     WHERE t.id = ANY($1::uuid[])
     ORDER BY ${SQL_TRUCKING_KEEPER_ORDER_BY_WB_COMPLETE}
     LIMIT 1`,
    [ops.map((o) => o.id)],
  );
  const keeperId = String(result.rows[0]?.id ?? ops[0].id);
  const keeper = ops.find((o) => o.id === keeperId) ?? ops[0];
  return { keeper, siblings: ops.filter((o) => o.id !== keeper.id) };
}

function formatOpLabel(o: TruckingOpForWbRow): string {
  const id = (o.operation_id && String(o.operation_id).trim()) || o.id;
  const prod = o.product ? ` / ${o.product}` : '';
  return `${id}${prod}`;
}

function formatWbAutoDedupeInfo(
  poNumber: string,
  keeper: TruckingOpForWbRow,
  siblings: TruckingOpForWbRow[],
): string {
  const siblingLabels = siblings.map(formatOpLabel).join(', ');
  return (
    `PO "${poNumber}": merged duplicate operation(s) ${siblingLabels} into keeper ` +
    `${formatOpLabel(keeper)} (KLIP soft dedupe — hidden from list, not Cancelled).`
  );
}

/** Distinct PO/STO candidates to try for one aggregated row (PO first, then its STOs). */
function buildWbRowCandidates(row: WbRekapAggregatedRow): string[] {
  const candidates: string[] = [];
  const push = (v: string | undefined | null) => {
    const s = String(v ?? '').trim();
    if (s && !candidates.includes(s)) candidates.push(s);
  };
  push(row.poNumber);
  for (const sto of row.stoNumbers ?? []) push(sto);
  return candidates;
}

/** Resolve a row's candidates to a PO + its active FRC/LCO ops using precomputed batch maps. */
function resolveRowOps(
  candidates: string[],
  opsByPo: Map<string, TruckingOpForWbRow[]>,
  poFromSto: Map<string, string | null>,
): { poNumber: string; ops: TruckingOpForWbRow[] } {
  let lastPo = candidates[0] ?? '';
  for (const key of candidates) {
    const direct = opsByPo.get(key);
    if (direct && direct.length > 0) return { poNumber: key, ops: direct };
    const resolvedPo = poFromSto.get(key);
    if (resolvedPo) {
      lastPo = resolvedPo;
      const ops = opsByPo.get(resolvedPo);
      if (ops && ops.length > 0) return { poNumber: resolvedPo, ops };
    }
  }
  return { poNumber: lastPo || candidates[0] || '', ops: [] };
}

/** Pick the best candidate (found in SAP takes priority) to report/act on when ops.length === 0. */
function pickDiagnosticForCandidates(
  candidates: string[],
  poFromSto: Map<string, string | null>,
  diagnostics: Map<string, WbContractDiagnostic>,
): { poNumber: string; diag?: WbContractDiagnostic } {
  for (const key of candidates) {
    if (diagnostics.has(key)) return { poNumber: key, diag: diagnostics.get(key) };
  }
  for (const key of candidates) {
    const resolvedPo = poFromSto.get(key);
    if (resolvedPo && diagnostics.has(resolvedPo)) {
      return { poNumber: resolvedPo, diag: diagnostics.get(resolvedPo) };
    }
  }
  // No diagnostic matched any candidate — report the row's primary identity only
  // (row.poNumber is always pushed first by buildWbRowCandidates), not a joined
  // "PO / STO" string.
  return { poNumber: candidates[0] || '-' };
}

type NoOpsOutcome =
  | { kind: 'failure'; poNumber: string; reason: string }
  | { kind: 'auto-create'; poNumber: string; diag: WbContractDiagnostic };

/**
 * Classify why a PO/STO has zero active FRC/LCO trucking operations, using only the
 * already-batched diagnostic data (no extra per-row query). Distinguishes: not found in
 * SAP, B2B child, all-cancelled operations, SEA transport, GR-Close, wrong incoterm — or,
 * when none of those apply, the "clean" case that now auto-creates an operation instead
 * of failing the row.
 */
function classifyNoOpsOutcome(
  candidates: string[],
  poFromSto: Map<string, string | null>,
  diagnostics: Map<string, WbContractDiagnostic>,
  anyStatusCounts: Map<string, { total: number; active: number }>,
): NoOpsOutcome {
  const { poNumber, diag } = pickDiagnosticForCandidates(candidates, poFromSto, diagnostics);
  if (!diag) {
    return {
      kind: 'failure',
      poNumber,
      reason: `PO "${poNumber}" not found in SAP — verify the PO in the WB file matches an existing contract`,
    };
  }
  if (diag.b2bOriginPo) {
    return {
      kind: 'failure',
      poNumber,
      reason: formatWbB2bChildRejectReason(poNumber, diag.b2bOriginPo),
    };
  }
  const counts = anyStatusCounts.get(poNumber) ?? { total: 0, active: 0 };
  if (counts.total > 0 && counts.active === 0) {
    return {
      kind: 'failure',
      poNumber,
      reason: `Trucking operation(s) for PO "${poNumber}" are CANCELLED — WB not applied`,
    };
  }
  if (String(diag.transportMode ?? '').trim().toUpperCase() === 'SEA') {
    return {
      kind: 'failure',
      poNumber,
      reason: `Contract for PO "${poNumber}" is SEA transport — WB import only applies to LAND trucking operations`,
    };
  }
  if (isContractDeliveryClosed(diag.importStatus)) {
    const grLabel = usesGrStoStatus(diag.incoterm) ? 'GR STO Status' : 'GR PO Status';
    return {
      kind: 'failure',
      poNumber,
      reason: `Cannot create trucking from WB: ${grLabel} is Close for PO "${poNumber}"`,
    };
  }
  const inc = String(diag.incoterm ?? '').trim().toUpperCase();
  if (inc !== 'FRC' && inc !== 'LCO') {
    return {
      kind: 'failure',
      poNumber,
      reason: `Trucking operation for PO "${poNumber}" has incoterm "${diag.incoterm || 'unknown'}" — WB import only applies to FRC/LCO shipments`,
    };
  }
  return { kind: 'auto-create', poNumber, diag };
}

/**
 * Auto-create a minimal UNPLANNED trucking_operations row (mirrors
 * truckingEnsureUnplannedOps.service's pattern) so WB data is not lost while a contract
 * has zero operations yet. Daily Planning stays empty until it is actually uploaded —
 * findTruckingOpForUnplannedPlanningUpload matches by PO regardless of status, so a later
 * Daily Planning upload attaches to this same operation instead of creating a duplicate.
 */
async function getOrCreateAutoUnplannedOp(
  client: PoolClient,
  contractUuid: string,
  incoterm: string | null,
  cache: Map<string, TruckingOpForWbRow>,
): Promise<TruckingOpForWbRow> {
  const cached = cache.get(contractUuid);
  if (cached) return cached;

  // Race guard against another request creating an op for this contract concurrently.
  // Uses the pooled connection (not this transaction's client) — matches the existing
  // truckingEnsureUnplannedOps.service precedent; within this batch, same-contract
  // dedup is already handled by `cache` above.
  const existingActive = await findActiveTruckingOpsByContractId(contractUuid);
  if (existingActive.length > 0) {
    const first = existingActive[0];
    const resolvedOp: TruckingOpForWbRow = {
      id: first.id,
      operation_id: first.operation_id,
      status: first.status,
      incoterm,
      product: null,
    };
    cache.set(contractUuid, resolvedOp);
    return resolvedOp;
  }

  const dmy = formatDDMMYYYY(new Date());
  const seq = await allocateNextSyntheticSequence(
    (text: string, params?: unknown[]) => client.query(text, params),
    'trucking_operations',
    'LAND',
    dmy,
  );
  const operationId = buildSyntheticOperationId('LAND', dmy, seq);
  const insertRes = await client.query<{ id: string }>(
    `INSERT INTO trucking_operations (
       contract_id, operation_id, status, daily_deliverables
     ) VALUES ($1::uuid, $2, 'UNPLANNED', '[]'::jsonb)
     RETURNING id`,
    [contractUuid, operationId],
  );
  const newOp: TruckingOpForWbRow = {
    id: String(insertRes.rows[0]?.id),
    operation_id: operationId,
    status: 'UNPLANNED',
    incoterm,
    product: null,
  };
  cache.set(contractUuid, newOp);
  return newOp;
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
  // A given (operation, progress_date) holds EITHER one PO-level row (blank sto_number)
  // OR per-STO rows — never both, or every sum counts the same weighbridge day twice
  // (migration 124 cleaned historical duplicates). WB uploads now always write PO-level
  // (blank STO) rows — this also cleans up any still-existing legacy per-STO rows for a
  // date the moment that date is re-uploaded.
  const stoTrimmed = String(stoNumber ?? '').trim();
  if (stoTrimmed) {
    await runQuery(
      db,
      `DELETE FROM trucking_daily_actuals
       WHERE trucking_operation_id = $1 AND progress_date = $2::date
         AND NULLIF(TRIM(COALESCE(sto_number::text, '')), '') IS NULL`,
      [truckingOperationId, progressDate],
    );
  } else {
    await runQuery(
      db,
      `DELETE FROM trucking_daily_actuals
       WHERE trucking_operation_id = $1 AND progress_date = $2::date
         AND NULLIF(TRIM(COALESCE(sto_number::text, '')), '') IS NOT NULL`,
      [truckingOperationId, progressDate],
    );
  }
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

/**
 * Apply one aggregated PO+date row against its already-resolved operation(s). GR-Close
 * contracts are allowed through here — sqlTruckingResolvedDeliveryQty /
 * sqlTruckingResolvedReceiveQty always use the SAP quantity once GR is Close regardless
 * of trucking_daily_actuals, so storing the WB row has no effect on displayed quantity
 * but avoids a confusing upload failure for legitimately closed contracts.
 */
async function applyResolvedRow(
  db: Queryable,
  row: WbRekapAggregatedRow,
  poNumber: string,
  ops: TruckingOpForWbRow[],
  wbImportId: string,
  operationFailures: WbImportOperationFailure[],
  operationWarnings: WbImportOperationFailure[],
  posNeedingDedupe: Set<string>,
  duplicateKeeperByPo: Map<string, TruckingOpForWbRow>,
  duplicateSiblingsByPo: Map<string, TruckingOpForWbRow[]>,
): Promise<{ updated: boolean; upserted: number; operationId?: string }> {
  let targetOps = ops;
  if (ops.length > 1) {
    const { keeper, siblings } = await pickWbImportKeeperOp(db, ops);
    posNeedingDedupe.add(poNumber);
    duplicateKeeperByPo.set(poNumber, keeper);
    duplicateSiblingsByPo.set(poNumber, siblings);
    targetOps = [keeper];
  }

  const op = targetOps[0];
  if (!op) {
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
  // PO-level only (blank STO) — WB no longer splits daily actuals per STO; multiple
  // STOs for the same PO+date are already summed at aggregation time.
  await upsertDailyActualWithWbImport(
    db,
    op.id,
    row.progressDateIso,
    qtyResult.quantityKg,
    wbImportId,
    row.sumNettoPksKg,
    row.sumNettoEupKg,
    '',
  );

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
  const userFacingRowParseFailures = filterWbRekapUserFacingRowParseFailures(
    parsed.rowParseFailures,
  );

  // Batch-resolve STO → PO on tickets that lack PO so multi-STO same-date rows merge
  // before apply (one round trip for every distinct STO, instead of one per ticket).
  const blankPoStos = [
    ...new Set(
      parsed.tickets
        .filter((t) => !t.poNumber && t.stoNumber)
        .map((t) => String(t.stoNumber).trim())
        .filter(Boolean),
    ),
  ];
  const ticketStoPoMap = await batchResolvePoFromSto(query, blankPoStos);
  for (const ticket of parsed.tickets) {
    if (ticket.poNumber) continue;
    const sto = String(ticket.stoNumber ?? '').trim();
    if (!sto) continue;
    const resolved = ticketStoPoMap.get(sto);
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
    rowParseFailures: userFacingRowParseFailures,
    operationFailures: [],
  });

  const operationFailures: WbImportOperationFailure[] = [];
  const operationWarnings: WbImportOperationFailure[] = [];
  const operationDeduped: WbImportOperationFailure[] = [];
  let rowsUpserted = 0;
  // operationId -> earliest applied progress date (for the one-time promote-to-IN_PROGRESS call).
  const touchedOps = new Map<string, string>();
  let autoCreatedAny = false;
  const posNeedingDedupe = new Set<string>();
  const duplicateKeeperByPo = new Map<string, TruckingOpForWbRow>();
  const duplicateSiblingsByPo = new Map<string, TruckingOpForWbRow[]>();

  let dedupedAny = false;
  const client = await getClient();
  try {
    await client.query('BEGIN');

    // --- Batch pre-resolution: once per distinct PO/STO candidate in the whole file,
    // not once per aggregated PO+date row. ---
    const allCandidates = new Set<string>();
    for (const row of aggregated) {
      for (const c of buildWbRowCandidates(row)) allCandidates.add(c);
    }
    const candidateList = [...allCandidates];

    const opsByPo = await findTruckingOpsByPoForWbImportBatch(client, candidateList);
    normalizeOpsByPoMap(opsByPo);
    const poFromSto = await batchResolvePoFromSto(client, candidateList);

    // Candidates that were actually STO keys resolving to a PO not already covered above.
    const secondaryPos = new Set<string>();
    for (const cand of candidateList) {
      const resolvedPo = poFromSto.get(cand);
      if (resolvedPo && !opsByPo.has(resolvedPo)) secondaryPos.add(resolvedPo);
    }
    if (secondaryPos.size > 0) {
      const secondaryOps = await findTruckingOpsByPoForWbImportBatch(client, [...secondaryPos]);
      normalizeOpsByPoMap(secondaryOps);
      for (const [po, list] of secondaryOps) opsByPo.set(po, list);
    }

    const diagnosticPoSet = new Set<string>([...candidateList, ...secondaryPos]);
    const diagnostics = await batchFetchContractDiagnostics(client, [...diagnosticPoSet]);
    const anyStatusCounts = await batchFetchAnyStatusOpsCounts(client, [...diagnosticPoSet]);

    // Dedupe auto-create across multiple aggregated rows for the same contract in this file.
    const autoCreateCache = new Map<string, TruckingOpForWbRow>();

    for (const row of aggregated) {
      const candidates = buildWbRowCandidates(row);
      let resolved = resolveRowOps(candidates, opsByPo, poFromSto);

      if (resolved.ops.length === 0) {
        const outcome = classifyNoOpsOutcome(candidates, poFromSto, diagnostics, anyStatusCounts);
        if (outcome.kind === 'failure') {
          operationFailures.push({
            po_number: outcome.poNumber || resolved.poNumber || row.poNumber,
            sto_numbers: row.stoNumbers,
            progress_date: row.progressDateIso,
            reason: outcome.reason,
          });
          continue;
        }
        // Clean case: contract is FRC/LCO, open, non-SEA, non-B2B-child, zero ops yet —
        // auto-create a minimal UNPLANNED operation instead of failing the WB row.
        const autoOp = await getOrCreateAutoUnplannedOp(
          client,
          outcome.diag.contractUuid,
          outcome.diag.incoterm,
          autoCreateCache,
        );
        opsByPo.set(outcome.poNumber, [autoOp]);
        autoCreatedAny = true;
        resolved = { poNumber: outcome.poNumber, ops: [autoOp] };
      }

      const result = await applyResolvedRow(
        client,
        row,
        resolved.poNumber,
        resolved.ops,
        importId,
        operationFailures,
        operationWarnings,
        posNeedingDedupe,
        duplicateKeeperByPo,
        duplicateSiblingsByPo,
      );
      if (result.updated && result.operationId) {
        rowsUpserted += result.upserted;
        const existingEarliest = touchedOps.get(result.operationId);
        if (!existingEarliest || row.progressDateIso < existingEarliest) {
          touchedOps.set(result.operationId, row.progressDateIso);
        }
      }
    }

    // Deferred: sync quantity_delivered + promote status exactly once per touched
    // operation (previously re-ran in full for every date row of the same operation).
    for (const [operationId, earliestDate] of touchedOps) {
      await syncTruckingQuantityDeliveredFromDailyActuals(client, operationId);
      await promoteOperationToInProgress(client, operationId, earliestDate);
    }

    for (const po of posNeedingDedupe) {
      const dedupeResult = await dedupeActiveTruckingOpsForPo(client, po, {
        mode: 'soft_dedupe',
        dedupedReason: 'wb_import_auto',
        skipPipelineRefresh: true,
      });
      if ((dedupeResult.dedupedIds?.length ?? 0) > 0) {
        dedupedAny = true;
        const keeper = duplicateKeeperByPo.get(po);
        const siblings = duplicateSiblingsByPo.get(po) ?? [];
        if (keeper) {
          operationDeduped.push({
            po_number: po,
            reason: formatWbAutoDedupeInfo(po, keeper, siblings),
            operation_ids: [
              String(keeper.operation_id ?? keeper.id),
              ...siblings.map((o) => String(o.operation_id ?? o.id)),
            ],
          });
        }
      }
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }

  if (autoCreatedAny || dedupedAny || rowsUpserted > 0 || touchedOps.size > 0) {
    invalidateTruckingListCache();
  }
  if (dedupedAny) {
    scheduleTruckingPipelineRefresh();
  }

  const operationsUpdated = touchedOps.size;
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
  if (touchedOps.size > 0) {
    const opIds = [...touchedOps.keys()];
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
    rowParseFailures: userFacingRowParseFailures,
    operationFailures,
    operationWarnings,
    operationDeduped,
  };
}

export { parseWbRekapWorkbook, aggregateWbRekapTickets };
