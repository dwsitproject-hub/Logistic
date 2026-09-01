import { query } from '../database/connection';
import { ensureUserStoContractAssignmentsTable } from '../database/ensureUserStoContractAssignments';
import { isSapSourcedShipmentId } from '../utils/klipLogisticsActivity';
import { invalidateShipmentsListCache } from './shipmentList.service';

const SPD_EFFECTIVE_STO = `NULLIF(TRIM(COALESCE(
  spd.sto_number::text,
  spd.data->'raw'->>'STO No.',
  spd.data->'raw'->>'STO Number',
  spd.data->'shipment'->>'sto_no',
  spd.data->'contract'->>'sto_no'
)), '')`;

export class KlipShipmentCancelError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number = 400,
  ) {
    super(message);
    this.name = 'KlipShipmentCancelError';
  }
}

export const SHIPMENT_CANCEL_REMARK_CATEGORY = 'CANCEL_SHIPMENT';

export function normalizeCancelShipmentRemark(value: unknown): string {
  const remark = String(value ?? '').trim();
  if (!remark) {
    throw new KlipShipmentCancelError('Cancellation remark is required', 400);
  }
  return remark;
}

/** KLIP manual grouping keys — not official SAP STO numbers. */
export function isKlipSyntheticLogisticsKey(value: unknown): boolean {
  const text = String(value ?? '').trim();
  return text.startsWith('OP-') || text.startsWith('MNL-') || text.startsWith('MSEA-');
}

export function resolveShipmentGroupLookupKey(row: {
  operation_id?: string | null;
  shipment_id?: string | null;
  sto_number?: string | null;
}): string {
  const op = String(row.operation_id ?? '').trim();
  if (op) return op;
  const shipmentId = String(row.shipment_id ?? '').trim();
  if (shipmentId) return shipmentId;
  return String(row.sto_number ?? '').trim();
}

async function sapStoExistsInSpd(stoKey: string): Promise<boolean> {
  const sto = String(stoKey ?? '').trim();
  if (!sto) return false;
  const result = await query(
    `
    SELECT 1
    FROM sap_processed_data spd
    WHERE ${SPD_EFFECTIVE_STO} = TRIM($1::text)
    LIMIT 1
    `,
    [sto],
  );
  return result.rows.length > 0;
}

export function isKlipOnlyShipmentGroupEligible(lookupKey: string): boolean {
  const key = String(lookupKey ?? '').trim();
  if (!key) return false;
  if (isKlipSyntheticLogisticsKey(key)) return true;
  if (isSapSourcedShipmentId(key)) return false;
  if (/^\d+$/.test(key)) return false;
  return true;
}

export interface CancelKlipShipmentResult {
  lookup_key: string;
  cancelled_shipment_ids: string[];
  cleared_assignment_rows: number;
  remark_ids: string[];
}

/**
 * Cancel a KLIP-created shipment group (no official SAP STO).
 * Clears Shipment Plan Qty assignments (user_sto_contract_assignments) for the group key.
 */
async function insertShipmentCancelRemarks(
  shipmentIds: string[],
  remark: string,
  userId: string,
): Promise<string[]> {
  const remarkIds: string[] = [];
  for (const shipmentId of shipmentIds) {
    const insertRes = await query(
      `
      INSERT INTO remarks (text, category, related_entity_type, related_entity_id, created_by)
      VALUES ($1, $2, 'SHIPMENT', $3::uuid, $4::uuid)
      RETURNING id
      `,
      [remark, SHIPMENT_CANCEL_REMARK_CATEGORY, shipmentId, userId],
    );
    const id = insertRes.rows[0]?.id;
    if (id) remarkIds.push(String(id));
  }
  return remarkIds;
}

export async function cancelKlipShipmentGroup(
  anchorShipmentUuid: string,
  remark: string,
  userId: string,
): Promise<CancelKlipShipmentResult> {
  const normalizedRemark = normalizeCancelShipmentRemark(remark);
  const actorId = String(userId ?? '').trim();
  if (!actorId) {
    throw new KlipShipmentCancelError('Unauthorized', 401);
  }
  const anchorRes = await query(
    `
    SELECT
      s.id,
      s.status,
      s.operation_id,
      s.shipment_id,
      c.sto_number
    FROM shipments s
    LEFT JOIN contracts c ON c.id = s.contract_id
    WHERE s.id = $1::uuid
    LIMIT 1
    `,
    [anchorShipmentUuid],
  );

  const anchor = anchorRes.rows[0] as {
    id: string;
    status: string | null;
    operation_id: string | null;
    shipment_id: string | null;
    sto_number: string | null;
  } | undefined;
  if (!anchor) {
    throw new KlipShipmentCancelError('Shipment not found', 404);
  }

  const status = String(anchor.status ?? '').trim().toUpperCase();
  if (status === 'CANCELLED') {
    throw new KlipShipmentCancelError('Shipment is already cancelled', 409);
  }

  const lookupKey = resolveShipmentGroupLookupKey(anchor);
  if (!lookupKey) {
    throw new KlipShipmentCancelError('Cannot resolve shipment group key', 400);
  }

  if (!isKlipOnlyShipmentGroupEligible(lookupKey)) {
    throw new KlipShipmentCancelError(
      'Only KLIP-created shipments without an official SAP STO number can be cancelled',
      403,
    );
  }

  if (await sapStoExistsInSpd(lookupKey)) {
    throw new KlipShipmentCancelError(
      'This shipment is linked to SAP STO data and cannot be cancelled from KLIP',
      403,
    );
  }

  const cancelRes = await query(
    `
    UPDATE shipments s
    SET status = 'CANCELLED', updated_at = CURRENT_TIMESTAMP
    WHERE COALESCE(s.status, '') <> 'CANCELLED'
      AND (
        (TRIM(COALESCE(s.operation_id, '')) <> '' AND TRIM(s.operation_id) = TRIM($1::text))
        OR (
          TRIM(COALESCE(s.operation_id, '')) = ''
          AND TRIM(COALESCE(s.shipment_id, '')) <> ''
          AND TRIM(s.shipment_id) = TRIM($1::text)
        )
        OR s.id = $2::uuid
      )
    RETURNING s.id
    `,
    [lookupKey, anchorShipmentUuid],
  );

  const cancelledIds = cancelRes.rows.map((r) => String((r as { id: string }).id));

  await ensureUserStoContractAssignmentsTable();
  const deleteAssignments = await query(
    `
    DELETE FROM user_sto_contract_assignments
    WHERE TRIM(sto_number::text) = TRIM($1::text)
    `,
    [lookupKey],
  );

  if (isKlipSyntheticLogisticsKey(lookupKey)) {
    await query(
      `
      UPDATE contracts
      SET sto_number = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE TRIM(COALESCE(sto_number::text, '')) = TRIM($1::text)
      `,
      [lookupKey],
    );
  }

  const remarkIds = await insertShipmentCancelRemarks(cancelledIds, normalizedRemark, actorId);

  invalidateShipmentsListCache();
  if (cancelledIds.length > 0) {
    try {
      const { ContractQtyMoveSnapshotService } = await import('./contractQtyMoveSnapshot.service');
      await ContractQtyMoveSnapshotService.refreshForShipmentIds(cancelledIds);
    } catch {
      // best-effort; snapshot fallback (is_stale) covers correctness if this fails
    }
  }

  return {
    lookup_key: lookupKey,
    cancelled_shipment_ids: cancelledIds,
    cleared_assignment_rows: deleteAssignments.rowCount ?? 0,
    remark_ids: remarkIds,
  };
}
