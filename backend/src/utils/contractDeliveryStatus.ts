import { query } from '../database/connection';
import { sqlIncotermImportStatusFromJson } from './sapIncotermMetrics';

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

/** SAP import status with incoterm matrix (GR PO vs GR STO) and PO-scoped row pick. */
export function sqlContractImportStatusExpr(
  contractAlias = 'c',
  poNumberRef = `${contractAlias}.po_number`,
): string {
  const sapPick = sqlNormalizeContractDeliveryStatusExpr(
    sqlIncotermImportStatusFromJson('spd.data', `${contractAlias}.incoterm`, `${contractAlias}.status::text`),
  );
  return `
    COALESCE(
      (
        SELECT ${sapPick}
        FROM sap_processed_data spd
        WHERE spd.contract_number = ${contractAlias}.contract_id
          AND (
            NULLIF(TRIM(COALESCE(${poNumberRef}::text, '')), '') IS NULL
            OR NULLIF(TRIM(COALESCE(spd.po_number::text, '')), '') IS NULL
            OR NULLIF(TRIM(COALESCE(spd.po_number::text, '')), '') = NULLIF(TRIM(COALESCE(${poNumberRef}::text, '')), '')
          )
        ORDER BY
          CASE
            WHEN NULLIF(TRIM(COALESCE(${poNumberRef}::text, '')), '') IS NOT NULL
              AND NULLIF(TRIM(COALESCE(spd.po_number::text, '')), '') = NULLIF(TRIM(COALESCE(${poNumberRef}::text, '')), '')
              THEN 0
            WHEN NULLIF(TRIM(COALESCE(spd.po_number::text, '')), '') IS NULL
              THEN 1
            ELSE 2
          END,
          spd.created_at DESC NULLS LAST
        LIMIT 1
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
  const result = await query(
    `SELECT ${SQL_CONTRACT_IMPORT_STATUS} AS import_status
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
