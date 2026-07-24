import { query } from '../database/connection';
import {
  INCOTERM_GR_PO_STATUS,
  INCOTERM_GR_STO_STATUS,
  sqlIncotermImportStatusFromJson,
} from './sapIncotermMetrics';
import { sapStoNumberKeyExpr } from './shipmentStoTypeSql';
import { shippingPerfStoMetricsKeyExpr } from './shippingPerformanceStoSql';

function sqlIncotermList(values: readonly string[]): string {
  return values.map((v) => `'${v}'`).join(', ');
}

/** Display-aligned contract delivery status: Open / Close / Cancelled (not legacy ACTIVE/COMPLETED). */
export function normalizeContractDeliveryStatusForDisplay(status: unknown): string {
  const raw = String(status ?? '').trim();
  if (!raw) return '';
  const u = raw.toUpperCase();
  if (u === 'ACTIVE' || u === 'OPEN') return 'Open';
  if (u === 'CLOSE' || u === 'CLOSED' || u === 'COMPLETED' || u === 'COMPLETE') return 'Close';
  if (u === 'CANCELLED' || u === 'CANCELED' || u === 'CANCEL') return 'Cancelled';
  if (raw === 'Open' || raw === 'Close' || raw === 'Cancelled') return raw;
  return raw;
}

/** SQL: map legacy/SAP status tokens to Open / Close / Cancelled for list + performance APIs. */
export function sqlNormalizeContractDeliveryStatusExpr(statusExpr: string): string {
  const u = `UPPER(TRIM(COALESCE(${statusExpr}, '')))`;
  return `CASE
    WHEN ${u} IN ('ACTIVE', 'OPEN') THEN 'Open'
    WHEN ${u} IN ('CLOSE', 'CLOSED', 'COMPLETED', 'COMPLETE') THEN 'Close'
    WHEN ${u} IN ('CANCELLED', 'CANCELED', 'CANCEL') THEN 'Cancelled'
    ELSE NULLIF(TRIM(${statusExpr}::text), '')
  END`;
}

export function isContractDeliveryClosed(status: unknown): boolean {
  const normalized = String(status ?? '').trim().toUpperCase();
  return (
    normalized === 'CLOSE' ||
    normalized === 'CLOSED' ||
    normalized === 'COMPLETED' ||
    normalized === 'COMPLETE'
  );
}

/**
 * SAP import status with incoterm matrix (GR PO vs GR STO) and PO-scoped rows.
 *
 * Important: do NOT take LIMIT 1 with per-row fallback to contracts.status.
 * A blank GR STO/PO on the newest row used to become COMPLETED/Close via that
 * fallback while sibling STO rows still had GR Open — Trucking then used Σ SAP
 * instead of WB. Aggregate: any Open wins; else any Close; else contract.status.
 *
 * Per SPD row, Open if the incoterm GR field is Open (stale Close in
 * `contract.gr_*` must not hide Open in raw). Do not use commercial Status.
 *
 * Optional `stoKeyExpr`: for LCO/FOB (GR STO), restrict SPD rows to that STO so a
 * Close STO is not held Open by a sibling STO under the same PO. CIF/CFR/FRC
 * (GR PO) ignore stoKey and stay PO-wide. Omit stoKey for Contracts list / Trucking.
 */
export function sqlContractImportStatusExpr(
  contractAlias = 'c',
  poNumberRef = `${contractAlias}.po_number`,
  stoKeyExpr?: string | null,
): string {
  // NULL when the GR field is blank — never inject contracts.status per SPD row.
  const sapStatusNorm = sqlNormalizeContractDeliveryStatusExpr(
    sqlIncotermImportStatusFromJson('spd.data', `${contractAlias}.incoterm`, 'NULL'),
  );
  const openNorm = (expr: string) =>
    `UPPER(TRIM(COALESCE(${sqlNormalizeContractDeliveryStatusExpr(expr)}, ''))) IN ('OPEN', 'ACTIVE')`;
  const inc = `UPPER(TRIM(COALESCE(${contractAlias}.incoterm, '')))`;
  const stoOpen = `(
    ${openNorm("spd.data->'raw'->>'GR STO Status'")}
    OR ${openNorm("spd.data->'contract'->>'gr_sto_status'")}
  )`;
  const poOpen = `(
    ${openNorm("spd.data->'raw'->>'GR PO Status'")}
    OR ${openNorm("spd.data->'contract'->>'gr_po_status'")}
  )`;
  // Incoterm-scoped: do not let commercial contract.status Open override Close GR STO on LCO.
  const rowOpenSignal = `(
    CASE
      WHEN ${inc} IN (${sqlIncotermList(INCOTERM_GR_STO_STATUS)}) THEN ${stoOpen}
      WHEN ${inc} IN (${sqlIncotermList(INCOTERM_GR_PO_STATUS)}) THEN ${poOpen}
      ELSE (${stoOpen} OR ${poOpen})
    END
  )`;

  const stoScope =
    stoKeyExpr && String(stoKeyExpr).trim()
      ? `
            AND (
              NULLIF(TRIM((${stoKeyExpr})::text), '') IS NULL
              OR TRIM((${stoKeyExpr})::text) ~ '^OP-'
              OR TRIM((${stoKeyExpr})::text) ~ '^(MNL-|MSEA-)'
              OR ${inc} IN (${sqlIncotermList(INCOTERM_GR_PO_STATUS)})
              OR ${sapStoNumberKeyExpr('spd')} = TRIM((${stoKeyExpr})::text)
            )`
      : '';

  return `
    COALESCE(
      (
        SELECT CASE
          WHEN BOOL_OR(s.row_open) OR BOOL_OR(UPPER(TRIM(COALESCE(s.st, ''))) IN ('OPEN', 'ACTIVE')) THEN 'Open'
          WHEN BOOL_OR(UPPER(TRIM(COALESCE(s.st, ''))) IN ('CLOSE', 'CLOSED', 'COMPLETED', 'COMPLETE')) THEN 'Close'
          WHEN BOOL_OR(UPPER(TRIM(COALESCE(s.st, ''))) IN ('CANCELLED', 'CANCELED', 'CANCEL')) THEN 'Cancelled'
          ELSE NULL
        END
        FROM (
          SELECT
            ${sapStatusNorm} AS st,
            ${rowOpenSignal} AS row_open
          FROM sap_processed_data spd
          WHERE spd.contract_number = ${contractAlias}.contract_id
            AND (
              NULLIF(TRIM(COALESCE(${poNumberRef}::text, '')), '') IS NULL
              OR NULLIF(TRIM(COALESCE(spd.po_number::text, '')), '') IS NULL
              OR NULLIF(TRIM(COALESCE(spd.po_number::text, '')), '') = NULLIF(TRIM(COALESCE(${poNumberRef}::text, '')), '')
            )${stoScope}
        ) s
        WHERE NULLIF(TRIM(COALESCE(s.st, '')), '') IS NOT NULL
          OR s.row_open
      ),
      ${sqlNormalizeContractDeliveryStatusExpr(`${contractAlias}.status`)}
    )`.trim();
}

/** Contracts list / performance — PO-aware SAP status (not latest_spd-only). */
export function sqlContractListImportStatusAggExpr(contractAlias = 'c'): string {
  const inner = sqlContractImportStatusExpr(contractAlias);
  return `(array_agg((${inner}) ORDER BY ${contractAlias}.created_at DESC NULLS LAST))[1]`;
}

export const SQL_CONTRACT_IMPORT_STATUS = sqlContractImportStatusExpr('c');

/** SQL predicate: contract row matches Open import status (UAT GR PO/STO matrix). */
export function sqlContractImportStatusIsOpenExpr(
  importStatusExpr: string,
  fallbackWhenNoSapExpr?: string,
): string {
  const open = `UPPER(TRIM(COALESCE((${importStatusExpr}), ''))) IN ('OPEN', 'ACTIVE')`;
  if (!fallbackWhenNoSapExpr) return open;
  return `(${open} OR (${fallbackWhenNoSapExpr}))`;
}

/** SQL predicate: contract row matches Close import status (UAT GR PO/STO matrix). */
export function sqlContractImportStatusIsClosedExpr(
  importStatusExpr: string,
  fallbackWhenNoSapExpr?: string,
): string {
  const closed = `UPPER(TRIM(COALESCE((${importStatusExpr}), ''))) IN ('CLOSE', 'CLOSED', 'COMPLETED', 'COMPLETE')`;
  if (!fallbackWhenNoSapExpr) return closed;
  return `(${closed} OR (${fallbackWhenNoSapExpr}))`;
}

/** SQL predicate: true when SAP import status (or contracts.status fallback) is Close/Completed. */
export function sqlIsContractSapClosedExpr(contractAlias = 'c'): string {
  return sqlContractImportStatusIsClosedExpr(sqlContractImportStatusExpr(contractAlias));
}

/**
 * SEA shipment / Shipping Performance: GR Close scoped to sto_key for LCO/FOB.
 * Use for is_contract_sap_closed and Perf import_status so sibling STOs do not block Completed.
 */
export function sqlIsContractSapClosedForStoExpr(
  contractAlias = 'c',
  stoKeyExpr: string,
): string {
  return sqlContractImportStatusIsClosedExpr(
    sqlContractImportStatusExpr(contractAlias, `${contractAlias}.po_number`, stoKeyExpr),
  );
}

/** STO-scoped import status expression (Shipments / Perf / Contract Detail STO rows). */
export function sqlContractImportStatusForStoExpr(
  contractAlias = 'c',
  stoKeyExpr: string,
  poNumberRef = `${contractAlias}.po_number`,
): string {
  return sqlContractImportStatusExpr(contractAlias, poNumberRef, stoKeyExpr);
}

export async function getContractImportStatusForTruckingOperation(
  truckingOperationId: string,
): Promise<string | null> {
  const result = await query(
    `SELECT ${SQL_CONTRACT_IMPORT_STATUS} AS import_status
     FROM trucking_operations t
     LEFT JOIN contracts c ON t.contract_id = c.id
     WHERE t.id = $1::uuid
     LIMIT 1`,
    [truckingOperationId],
  );
  return (result.rows[0] as { import_status?: string | null } | undefined)?.import_status ?? null;
}

export async function assertTruckingOperationContractOpen(
  truckingOperationId: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const status = await getContractImportStatusForTruckingOperation(truckingOperationId);
  if (isContractDeliveryClosed(status)) {
    return {
      ok: false,
      message: 'Cannot edit trucking: contract status is Close.',
    };
  }
  return { ok: true };
}

export async function getContractImportStatusForShipment(
  shipmentId: string,
): Promise<string | null> {
  const stoKey = shippingPerfStoMetricsKeyExpr('c', 's');
  const result = await query(
    `SELECT ${sqlContractImportStatusForStoExpr('c', stoKey)} AS import_status
     FROM shipments s
     LEFT JOIN contracts c ON s.contract_id = c.id
     WHERE s.id = $1::uuid
     LIMIT 1`,
    [shipmentId],
  );
  return (result.rows[0] as { import_status?: string | null } | undefined)?.import_status ?? null;
}

export async function assertShipmentContractOpen(
  shipmentId: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const status = await getContractImportStatusForShipment(shipmentId);
  if (isContractDeliveryClosed(status)) {
    return {
      ok: false,
      message: 'Cannot edit shipment: contract status is Close.',
    };
  }
  return { ok: true };
}
