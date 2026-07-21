import { query } from '../database/connection';
import {
  buildContractQtyMoveSnapshotRefreshSql,
  buildContractQtyMoveSnapshotUpsertSql,
  buildQtyMoveCte,
  buildQtyMoveFromSnapshotCte,
} from '../utils/contractGlobalOutstandingSql';
import logger from '../utils/logger';

const STALE_REFRESH_DEBOUNCE_MS = 60_000;
let lastStaleRefreshAt = 0;

export async function isContractQtyMoveSnapshotFresh(): Promise<boolean> {
  const res = await query(
    `SELECT is_stale FROM contract_qty_move_snapshot_meta WHERE id = 'global' LIMIT 1`,
  );
  const row = res.rows[0] as { is_stale?: boolean } | undefined;
  return Boolean(row && !row.is_stale);
}

export async function markContractQtyMoveSnapshotStale(): Promise<void> {
  await query(`UPDATE contract_qty_move_snapshot_meta SET is_stale = TRUE WHERE id = 'global'`);
  scheduleContractQtyMoveSnapshotRefreshIfNeeded();
}

function scheduleContractQtyMoveSnapshotRefreshIfNeeded(): void {
  const now = Date.now();
  if (now - lastStaleRefreshAt < STALE_REFRESH_DEBOUNCE_MS) return;
  lastStaleRefreshAt = now;
  setImmediate(() => {
    ContractQtyMoveSnapshotService.refreshAll().catch((err) => {
      logger.warn('Background contract qty_move snapshot refresh failed', { err });
    });
  });
}

export class ContractQtyMoveSnapshotService {
  static async refreshAll(): Promise<number> {
    const start = Date.now();
    await query('TRUNCATE contract_qty_move_snapshot');
    const insertRes = await query(buildContractQtyMoveSnapshotRefreshSql());
    const rowCount = insertRes.rowCount ?? 0;
    const durationMs = Date.now() - start;
    await query(
      `UPDATE contract_qty_move_snapshot_meta
       SET refreshed_at = NOW(), is_stale = FALSE, row_count = $1, duration_ms = $2
       WHERE id = 'global'`,
      [rowCount, durationMs],
    );
    logger.info('Contract qty_move snapshot refreshed', { rowCount, durationMs });
    return rowCount;
  }

  static async refreshForContracts(contractNumbers: string[]): Promise<number> {
    const ids = contractNumbers.map((c) => String(c).trim()).filter(Boolean);
    if (ids.length === 0) return 0;
    const insertRes = await query(buildContractQtyMoveSnapshotUpsertSql(), [ids]);
    return insertRes.rowCount ?? 0;
  }

  static async refreshForTruckingOperationIds(truckingOperationIds: string[]): Promise<number> {
    const opIds = truckingOperationIds.map((id) => String(id).trim()).filter(Boolean);
    if (opIds.length === 0) return 0;
    const res = await query(
      `SELECT DISTINCT c.contract_id
       FROM trucking_operations t
       INNER JOIN contracts c ON c.id = t.contract_id
       WHERE t.id = ANY($1::uuid[])`,
      [opIds],
    );
    const contractNumbers = res.rows
      .map((r) => String((r as { contract_id?: string }).contract_id ?? '').trim())
      .filter(Boolean);
    return this.refreshForContracts(contractNumbers);
  }

  /** Refresh snapshot for contracts linked to the given shipment UUIDs (after KLIP qty edits). */
  static async refreshForShipmentIds(shipmentIds: string[]): Promise<number> {
    const ids = shipmentIds.map((id) => String(id).trim()).filter(Boolean);
    if (ids.length === 0) return 0;
    const res = await query(
      `SELECT DISTINCT c.contract_id
       FROM shipments s
       INNER JOIN contracts c ON c.id = s.contract_id
       WHERE s.id = ANY($1::uuid[])`,
      [ids],
    );
    const contractNumbers = res.rows
      .map((r) => String((r as { contract_id?: string }).contract_id ?? '').trim())
      .filter(Boolean);
    return this.refreshForContracts(contractNumbers);
  }
}

/**
 * Live qty_move CTE for Contracts / Contract Performance / dashboard reads.
 * Always live (scoped via contract_scope join) so Delivery/Received match Trucking WB
 * and never lag behind a stale contract_qty_move_snapshot.
 * Snapshot refresh remains available for tooling/regression only.
 */
export async function resolveContractsQtyMoveCte(scopeCteName = 'contract_scope'): Promise<string> {
  return buildQtyMoveCte({ kind: 'join_scope', scopeCteName });
}

export { buildQtyMoveFromSnapshotCte, buildQtyMoveCte };
