import type { PoolClient, QueryResultRow } from 'pg';
import { query } from '../database/connection';

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

/** SAP STO / delivery id — numeric string (not KLIP manual ids). */
export function isSapSourcedShipmentId(shipmentId: unknown): boolean {
  const text = String(shipmentId ?? '').trim();
  if (!text) return false;
  if (text.startsWith('MNL-') || text.startsWith('MSEA-')) return false;
  return /^\d+$/.test(text);
}

export function isKlipManualShipmentId(shipmentId: unknown): boolean {
  const text = String(shipmentId ?? '').trim();
  return text.startsWith('MNL-') || text.startsWith('MSEA-');
}

/**
 * True when users have changed this shipment through KLIP (not SAP-only).
 * SAP re-import must not cancel or overwrite these rows.
 */
export async function hasKlipShipmentActivity(
  db: Queryable,
  shipmentUuid: string,
  contractUuid?: string,
): Promise<boolean> {
  const rowRes = await runQuery<{
    shipment_id: string | null;
    operation_id: string | null;
    daily_deliverables: unknown;
  }>(
    db,
    `SELECT shipment_id, operation_id, daily_deliverables
     FROM shipments WHERE id = $1::uuid LIMIT 1`,
    [shipmentUuid],
  );
  const row = rowRes.rows[0];
  if (!row) return false;

  if (isKlipManualShipmentId(row.shipment_id)) return true;
  if (row.operation_id && String(row.operation_id).trim()) return true;

  const daily = row.daily_deliverables;
  if (Array.isArray(daily) && daily.length > 0) return true;
  if (daily && typeof daily === 'object' && !Array.isArray(daily) && Object.keys(daily as object).length > 0) {
    return true;
  }

  const auditRes = await runQuery(
    db,
    `SELECT 1 FROM audit_logs
     WHERE entity_type = 'SHIPMENT' AND entity_id = $1::uuid AND action = 'UPDATE'
     LIMIT 1`,
    [shipmentUuid],
  );
  if (auditRes.rows.length > 0) return true;

  const docRes = await runQuery(
    db,
    `SELECT 1 FROM documents WHERE shipment_id = $1::uuid LIMIT 1`,
    [shipmentUuid],
  );
  if (docRes.rows.length > 0) return true;

  if (contractUuid && row.shipment_id) {
    const assignRes = await runQuery(
      db,
      `SELECT 1 FROM user_sto_contract_assignments u
       INNER JOIN contracts c ON c.contract_id = u.contract_number
       WHERE c.id = $1::uuid
         AND TRIM(u.sto_number::text) = TRIM($2::text)
       LIMIT 1`,
      [contractUuid, row.shipment_id],
    );
    if (assignRes.rows.length > 0) return true;
  }

  return false;
}

/** Pure guard: only KLIP placeholders / unassigned rows may be auto-cancelled during SAP STO reconcile. */
export function isPlaceholderShipmentEligibleForSapConsolidate(
  status: unknown,
  shipmentId: unknown,
): boolean {
  const statusUpper = String(status ?? '').trim().toUpperCase();
  if (statusUpper === 'CANCELLED') return false;

  const sid = String(shipmentId ?? '').trim();
  if (isSapSourcedShipmentId(sid)) return false;
  if (
    [
      'COMPLETED',
      'SAILED',
      'IN_TRANSIT',
      'ARRIVED_DP',
      'ARRIVED',
      'BERTHED_DP',
      'UNLOADING',
      'LOADING',
      'COMPLETED_LOADING',
      'BERTHED_LP',
      'ARRIVED_LP',
      'IN_PROGRESS',
    ].includes(statusUpper)
  ) {
    return false;
  }
  if (sid !== '' && !isKlipManualShipmentId(sid)) return false;
  return true;
}

/**
 * True when a shipment row may be cancelled/merged as SAP assigns the official STO on the same contract.
 * Unlike hasKlipShipmentActivity, an initial manual plan (operation_id / MNL shipment_id) does not block.
 */
export async function canAutoConsolidateShipmentForSap(
  db: Queryable,
  shipmentUuid: string,
  contractUuid?: string,
): Promise<boolean> {
  const rowRes = await runQuery<{
    status: string | null;
    shipment_id: string | null;
    daily_deliverables: unknown;
  }>(
    db,
    `SELECT status, shipment_id, daily_deliverables
     FROM shipments WHERE id = $1::uuid LIMIT 1`,
    [shipmentUuid],
  );
  const row = rowRes.rows[0];
  if (!row) return false;
  if (!isPlaceholderShipmentEligibleForSapConsolidate(row.status, row.shipment_id)) return false;

  const daily = row.daily_deliverables;
  if (Array.isArray(daily) && daily.length > 0) return false;
  if (
    daily &&
    typeof daily === 'object' &&
    !Array.isArray(daily) &&
    Object.keys(daily as object).length > 0
  ) {
    return false;
  }

  const auditRes = await runQuery(
    db,
    `SELECT 1 FROM audit_logs
     WHERE entity_type = 'SHIPMENT' AND entity_id = $1::uuid AND action = 'UPDATE'
     LIMIT 1`,
    [shipmentUuid],
  );
  if (auditRes.rows.length > 0) return false;

  const docRes = await runQuery(
    db,
    `SELECT 1 FROM documents WHERE shipment_id = $1::uuid LIMIT 1`,
    [shipmentUuid],
  );
  if (docRes.rows.length > 0) return false;

  if (contractUuid && row.shipment_id) {
    const assignRes = await runQuery(
      db,
      `SELECT 1 FROM user_sto_contract_assignments u
       INNER JOIN contracts c ON c.contract_id = u.contract_number
       WHERE c.id = $1::uuid
         AND TRIM(u.sto_number::text) = TRIM($2::text)
       LIMIT 1`,
      [contractUuid, row.shipment_id],
    );
    if (assignRes.rows.length > 0) return false;
  }

  return true;
}

/** True when users have planned/edited trucking through KLIP. */
export async function hasKlipTruckingActivity(db: Queryable, truckingUuid: string): Promise<boolean> {
  const rowRes = await runQuery<{
    operation_id: string | null;
    daily_deliverables: unknown;
    eta_delivery_start_date: string | null;
    eta_delivery_end_date: string | null;
    eta_trucking_start_date: string | null;
    eta_trucking_completion_date: string | null;
  }>(
    db,
    `SELECT operation_id, daily_deliverables,
            eta_delivery_start_date,
            eta_delivery_end_date,
            eta_trucking_start_date,
            eta_trucking_completion_date
     FROM trucking_operations WHERE id = $1::uuid LIMIT 1`,
    [truckingUuid],
  );
  const row = rowRes.rows[0];
  if (!row) return false;

  if (row.operation_id && String(row.operation_id).trim()) return true;

  const daily = row.daily_deliverables;
  if (Array.isArray(daily) && daily.length > 0) return true;

  if (
    row.eta_delivery_start_date ||
    row.eta_delivery_end_date ||
    row.eta_trucking_start_date ||
    row.eta_trucking_completion_date
  ) {
    return true;
  }

  const auditRes = await runQuery(
    db,
    `SELECT 1 FROM audit_logs
     WHERE entity_type = 'TRUCKING_OPERATION' AND entity_id = $1::uuid AND action = 'UPDATE'
     LIMIT 1`,
    [truckingUuid],
  );
  return auditRes.rows.length > 0;
}

/**
 * When SAP assigns a new STO/shipment_id for a contract, reuse an existing SAP-only row
 * instead of inserting a duplicate (latest SAP upload is source of truth).
 */
export async function findSapShipmentSupersedeCandidate(
  db: Queryable,
  contractUuid: string,
  newSapShipmentId: string,
): Promise<string | null> {
  const sto = String(newSapShipmentId ?? '').trim();
  if (!sto) return null;

  const existingNew = await runQuery(
    db,
    `SELECT id FROM shipments
     WHERE TRIM(shipment_id) = TRIM($1::text)
       AND COALESCE(status, '') <> 'CANCELLED'
     LIMIT 1`,
    [sto],
  );
  if (existingNew.rows.length > 0) return null;

  const candidates = await runQuery<{ id: string }>(
    db,
    `SELECT id FROM shipments
     WHERE contract_id = $1::uuid
       AND COALESCE(status, '') <> 'CANCELLED'
       AND TRIM(COALESCE(shipment_id, '')) <> TRIM($2::text)
     ORDER BY
       CASE
         WHEN shipment_id LIKE 'MNL-%' OR shipment_id LIKE 'MSEA-%' THEN 0
         WHEN TRIM(shipment_id) ~ '^[0-9]+$' THEN 1
         ELSE 2
       END,
       created_at DESC`,
    [contractUuid, sto],
  );

  for (const candidate of candidates.rows) {
    if (await canAutoConsolidateShipmentForSap(db, candidate.id, contractUuid)) {
      return candidate.id;
    }
  }
  return null;
}

/** Active shipment for a SAP PO + STO pair (any contract). Used to prevent duplicate rows. */
export async function findShipmentByPoAndSto(
  db: Queryable,
  poNumber: unknown,
  stoNumber: unknown,
): Promise<{ id: string; contractUuid: string } | null> {
  const po = String(poNumber ?? '').trim();
  const sto = String(stoNumber ?? '').trim();
  if (!po || !sto) return null;

  const rows = await runQuery<{ id: string; contract_uuid: string }>(
    db,
    `SELECT s.id, c.id::text AS contract_uuid
     FROM shipments s
     INNER JOIN contracts c ON c.id = s.contract_id
     WHERE COALESCE(s.status, '') <> 'CANCELLED'
       AND TRIM(COALESCE(c.po_number, '')) = TRIM($1::text)
       AND (
         TRIM(COALESCE(c.sto_number::text, '')) = TRIM($2::text)
         OR TRIM(COALESCE(s.shipment_id::text, '')) = TRIM($2::text)
       )
     ORDER BY
       CASE WHEN TRIM(COALESCE(s.shipment_id::text, '')) = TRIM($2::text) THEN 0 ELSE 1 END,
       s.created_at ASC
     LIMIT 1`,
    [po, sto],
  );
  const row = rows.rows[0];
  if (!row) return null;
  return { id: row.id, contractUuid: row.contract_uuid };
}

/** Cancel duplicate shipment rows for a PO + STO (cross-contract). Returns cancelled UUIDs. */
export async function cancelDuplicateShipmentsForPoAndSto(
  db: Queryable,
  poNumber: unknown,
  stoNumber: unknown,
  keeperShipmentUuid: string,
  options?: { force?: boolean },
): Promise<{ cancelled: string[]; skipped: string[] }> {
  const po = String(poNumber ?? '').trim();
  const sto = String(stoNumber ?? '').trim();
  const cancelled: string[] = [];
  const skipped: string[] = [];
  if (!po || !sto || !keeperShipmentUuid) return { cancelled, skipped };

  const rows = await runQuery<{ id: string; contract_uuid: string }>(
    db,
    `SELECT s.id, c.id::text AS contract_uuid
     FROM shipments s
     INNER JOIN contracts c ON c.id = s.contract_id
     WHERE COALESCE(s.status, '') <> 'CANCELLED'
       AND TRIM(COALESCE(c.po_number, '')) = TRIM($1::text)
       AND (
         TRIM(COALESCE(c.sto_number::text, '')) = TRIM($2::text)
         OR TRIM(COALESCE(s.shipment_id::text, '')) = TRIM($2::text)
       )
       AND s.id <> $3::uuid`,
    [po, sto, keeperShipmentUuid],
  );

  for (const row of rows.rows) {
    const canCancel =
      options?.force === true ||
      (await canAutoConsolidateShipmentForSap(db, row.id, row.contract_uuid));
    if (!canCancel) {
      skipped.push(row.id);
      continue;
    }
    await runQuery(
      db,
      `UPDATE shipments SET status = 'CANCELLED', updated_at = CURRENT_TIMESTAMP WHERE id = $1::uuid`,
      [row.id],
    );
    cancelled.push(row.id);
  }

  return { cancelled, skipped };
}

export type SapReconcileResult = {
  cancelledShipmentIds: string[];
  skippedShipmentIds: string[];
  cancelledTruckingIds: string[];
  skippedTruckingIds: string[];
};

/** Cancel KLIP placeholder shipment siblings (MNL-/MSEA-) after SAP STO is applied — not live SAP rows. */
export async function reconcileSupersededSapShipments(
  db: Queryable,
  contractUuid: string,
  keeperShipmentUuid: string,
): Promise<Pick<SapReconcileResult, 'cancelledShipmentIds' | 'skippedShipmentIds'>> {
  const cancelledShipmentIds: string[] = [];
  const skippedShipmentIds: string[] = [];

  if (!contractUuid || !keeperShipmentUuid) {
    return { cancelledShipmentIds, skippedShipmentIds };
  }

  const siblings = await runQuery<{ id: string; shipment_id: string | null }>(
    db,
    `SELECT id, shipment_id FROM shipments
     WHERE contract_id = $1::uuid
       AND id <> $2::uuid
       AND COALESCE(status, '') <> 'CANCELLED'
       AND (
         shipment_id LIKE 'MNL-%'
         OR shipment_id LIKE 'MSEA-%'
         OR NULLIF(TRIM(COALESCE(shipment_id, '')), '') IS NULL
       )`,
    [contractUuid, keeperShipmentUuid],
  );

  for (const row of siblings.rows) {
    if (!(await canAutoConsolidateShipmentForSap(db, row.id, contractUuid))) {
      skippedShipmentIds.push(row.id);
      continue;
    }
    await runQuery(
      db,
      `UPDATE shipments SET status = 'CANCELLED', updated_at = CURRENT_TIMESTAMP WHERE id = $1::uuid`,
      [row.id],
    );
    cancelledShipmentIds.push(row.id);
  }

  return { cancelledShipmentIds, skippedShipmentIds };
}

/**
 * After SAP upsert on the keeper trucking op: no auto-cancel of sibling rows.
 * SAP import reuses/updates the keeper in place (same philosophy as finalizeSapShipmentAfterUpsert).
 */
export async function finalizeSapTruckingAfterUpsert(
  _db: Queryable,
  _contractUuid: string,
  _keeperTruckingUuid: string,
): Promise<Pick<SapReconcileResult, 'cancelledTruckingIds' | 'skippedTruckingIds'>> {
  return { cancelledTruckingIds: [], skippedTruckingIds: [] };
}

/**
 * @deprecated SAP import no longer mass-cancels trucking siblings — use finalizeSapTruckingAfterUpsert.
 * Retained for one-off maintenance; prefer cleanup scripts for explicit dedupe.
 */
export async function reconcileSupersededSapTrucking(
  db: Queryable,
  contractUuid: string,
  keeperTruckingUuid: string,
): Promise<Pick<SapReconcileResult, 'cancelledTruckingIds' | 'skippedTruckingIds'>> {
  const cancelledTruckingIds: string[] = [];
  const skippedTruckingIds: string[] = [];

  if (!contractUuid || !keeperTruckingUuid) return { cancelledTruckingIds, skippedTruckingIds };

  const siblings = await runQuery<{ id: string }>(
    db,
    `SELECT id FROM trucking_operations
     WHERE contract_id = $1::uuid
       AND id <> $2::uuid
       AND COALESCE(status, '') <> 'CANCELLED'`,
    [contractUuid, keeperTruckingUuid],
  );

  for (const row of siblings.rows) {
    if (await hasKlipTruckingActivity(db, row.id)) {
      skippedTruckingIds.push(row.id);
      continue;
    }
    await runQuery(
      db,
      `UPDATE trucking_operations SET status = 'CANCELLED', updated_at = CURRENT_TIMESTAMP WHERE id = $1::uuid`,
      [row.id],
    );
    cancelledTruckingIds.push(row.id);
  }

  return { cancelledTruckingIds, skippedTruckingIds };
}

/** Point contract.sto_number at the latest SAP STO for this shipment upsert. */
export async function syncContractStoFromSapShipment(
  db: Queryable,
  contractUuid: string,
  sapShipmentId: string | null | undefined,
): Promise<void> {
  const sto = String(sapShipmentId ?? '').trim();
  if (!contractUuid || !sto) return;
  await runQuery(
    db,
    `UPDATE contracts SET sto_number = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2::uuid`,
    [sto, contractUuid],
  );
}

/**
 * After SAP upsert on the keeper shipment: align shipment_id + contract STO only.
 * Does NOT auto-cancel sibling rows — SAP import must upsert in place, not mass-cancel live STOs.
 */
export async function finalizeSapShipmentAfterUpsert(
  db: Queryable,
  contractUuid: string,
  keeperShipmentUuid: string,
  sapShipmentId: string | null | undefined,
): Promise<SapReconcileResult> {
  const sto = String(sapShipmentId ?? '').trim();
  const result: SapReconcileResult = {
    cancelledShipmentIds: [],
    skippedShipmentIds: [],
    cancelledTruckingIds: [],
    skippedTruckingIds: [],
  };

  if (!contractUuid || !keeperShipmentUuid) return result;

  if (sto) {
    await runQuery(
      db,
      `UPDATE shipments SET shipment_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2::uuid`,
      [sto, keeperShipmentUuid],
    );
    await syncContractStoFromSapShipment(db, contractUuid, sto);
  }

  return result;
}
