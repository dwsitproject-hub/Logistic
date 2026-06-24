import { query } from '../database/connection';

export function isContractDeliveryClosed(status: unknown): boolean {
  const normalized = String(status ?? '').trim().toUpperCase();
  return (
    normalized === 'CLOSE' ||
    normalized === 'CLOSED' ||
    normalized === 'COMPLETED' ||
    normalized === 'COMPLETE'
  );
}

/** SAP import status with contracts.status fallback — same signal as Contract Performance Open/Close. */
export function sqlContractImportStatusExpr(contractAlias = 'c'): string {
  return `
    COALESCE(
      (
        SELECT COALESCE(spd.data->'contract'->>'status', spd.data->>'status')
        FROM sap_processed_data spd
        WHERE spd.contract_number = ${contractAlias}.contract_id
        ORDER BY spd.created_at DESC NULLS LAST
        LIMIT 1
      ),
      ${contractAlias}.status
    )`.trim();
}

export const SQL_CONTRACT_IMPORT_STATUS = sqlContractImportStatusExpr('c');

/** SQL predicate: true when SAP import status (or contracts.status fallback) is Close/Completed. */
export function sqlIsContractSapClosedExpr(contractAlias = 'c'): string {
  return `UPPER(TRIM(COALESCE((${sqlContractImportStatusExpr(contractAlias)}), ''))) IN ('CLOSE', 'CLOSED', 'COMPLETED', 'COMPLETE')`;
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
