import type { PoolClient } from 'pg';
import { query } from '../database/connection';

type Queryable = Pick<PoolClient, 'query'> | typeof query;

async function runQuery<T = unknown>(
  db: Queryable,
  text: string,
  params?: unknown[],
): Promise<{ rows: T[] }> {
  if (typeof (db as PoolClient).query === 'function' && 'release' in (db as object)) {
    return (db as PoolClient).query(text, params);
  }
  return query(text, params) as Promise<{ rows: T[] }>;
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
    `SELECT id FROM shipments WHERE shipment_id = $1 LIMIT 1`,
    [sto],
  );
  if (existingNew.rows.length > 0) return null;

  const candidates = await runQuery<{ id: string }>(
    db,
    `SELECT id FROM shipments
     WHERE contract_id = $1::uuid
       AND COALESCE(status, '') <> 'CANCELLED'
       AND shipment_id IS NOT NULL
       AND shipment_id NOT LIKE 'MNL-%'
       AND shipment_id NOT LIKE 'MSEA-%'
       AND TRIM(shipment_id) <> TRIM($2::text)
     ORDER BY created_at DESC`,
    [contractUuid, sto],
  );

  for (const candidate of candidates.rows) {
    if (!(await hasKlipShipmentActivity(db, candidate.id, contractUuid))) {
      return candidate.id;
    }
  }
  return null;
}

export type SapReconcileResult = {
  cancelledShipmentIds: string[];
  skippedShipmentIds: string[];
  cancelledTruckingIds: string[];
  skippedTruckingIds: string[];
};

/** Cancel older SAP-only shipment siblings after latest SAP row is applied. */
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
       AND COALESCE(status, '') <> 'CANCELLED'`,
    [contractUuid, keeperShipmentUuid],
  );

  for (const row of siblings.rows) {
    if (!isSapSourcedShipmentId(row.shipment_id)) {
      skippedShipmentIds.push(row.id);
      continue;
    }
    if (await hasKlipShipmentActivity(db, row.id, contractUuid)) {
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

/** Cancel duplicate active trucking rows on the same contract (SAP-only siblings). */
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
 * After SAP upsert on the keeper shipment: align shipment_id + contract STO,
 * cancel stale SAP-only duplicates (preserve KLIP-touched rows).
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
    const dupBySto = await runQuery<{ id: string }>(
      db,
      `SELECT id FROM shipments
       WHERE contract_id = $1::uuid
         AND TRIM(shipment_id) = TRIM($2::text)
         AND id <> $3::uuid
         AND COALESCE(status, '') <> 'CANCELLED'`,
      [contractUuid, sto, keeperShipmentUuid],
    );
    for (const row of dupBySto.rows) {
      if (await hasKlipShipmentActivity(db, row.id, contractUuid)) {
        result.skippedShipmentIds.push(row.id);
        continue;
      }
      await runQuery(
        db,
        `UPDATE shipments SET status = 'CANCELLED', updated_at = CURRENT_TIMESTAMP WHERE id = $1::uuid`,
        [row.id],
      );
      result.cancelledShipmentIds.push(row.id);
    }

    await runQuery(
      db,
      `UPDATE shipments SET shipment_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2::uuid`,
      [sto, keeperShipmentUuid],
    );
    await syncContractStoFromSapShipment(db, contractUuid, sto);
  }

  const siblingResult = await reconcileSupersededSapShipments(db, contractUuid, keeperShipmentUuid);
  result.cancelledShipmentIds.push(...siblingResult.cancelledShipmentIds);
  result.skippedShipmentIds.push(...siblingResult.skippedShipmentIds);
  return result;
}
