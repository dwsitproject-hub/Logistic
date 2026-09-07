import { getClient, query } from '../database/connection';
import {
  buildContractQtyMoveSnapshotRefreshSql,
  buildContractQtyMoveSnapshotUpsertSql,
  buildQtyMoveCte,
  buildQtyMoveFromSnapshotCte,
  type QtyMoveContractFilter,
} from '../utils/contractGlobalOutstandingSql';
import logger from '../utils/logger';

const STALE_REFRESH_DEBOUNCE_MS = 60_000;
let lastStaleRefreshAt = 0;

/**
 * Freshness is probed once per builder, and a page builds several queries - measured at 1.3s per
 * probe under load, enough to blow a 5s budget on its own. Cache it for a beat so all builders in
 * one request share a single probe, and invalidate explicitly whenever the flag actually moves
 * (mark-stale / refresh completion) so the TTL can never straddle an import boundary.
 */
const FRESHNESS_TTL_MS = 2_000;
let freshnessCache: { value: boolean; at: number } | null = null;

export function invalidateContractQtyMoveSnapshotFreshness(): void {
  freshnessCache = null;
}

export async function isContractQtyMoveSnapshotFresh(): Promise<boolean> {
  const now = Date.now();
  if (freshnessCache && now - freshnessCache.at < FRESHNESS_TTL_MS) {
    return freshnessCache.value;
  }
  try {
    const res = await query(
      `SELECT is_stale FROM contract_qty_move_snapshot_meta WHERE id = 'global' LIMIT 1`,
    );
    const row = res.rows[0] as { is_stale?: boolean } | undefined;
    const value = Boolean(row && !row.is_stale);
    freshnessCache = { value, at: now };
    return value;
  } catch (err) {
    /** A probe failure must not fail the caller's page query - degrade to the live CTE. */
    logger.warn('contract_qty_move snapshot freshness probe failed; using live qty_move', {
      error: err instanceof Error ? err.message : String(err),
    });
    freshnessCache = { value: false, at: now };
    return false;
  }
}

export async function markContractQtyMoveSnapshotStale(): Promise<void> {
  await query(`UPDATE contract_qty_move_snapshot_meta SET is_stale = TRUE WHERE id = 'global'`);
  invalidateContractQtyMoveSnapshotFreshness();
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
  /**
   * Rebuild the whole snapshot.
   *
   * This used to `TRUNCATE` and then `INSERT` as two separate autocommit statements while
   * `is_stale` still said FALSE - and it failed exactly the way that invites. Found 2026-09-04:
   * the table held **0 rows** while its meta claimed 18,583 and `is_stale = false`. A refresh had
   * truncated it and then died (most likely a backend restart mid-rebuild), and the caller's
   * `.catch(() => {})` swallowed the error, so nothing surfaced.
   *
   * The damage was not theoretical: every consumer read an empty snapshot for "eligible"
   * contracts, so their delivery / receive came back as nothing. 15,394 of 15,593 Close contracts
   * (98.7%) showed quantity_delivery = 0, quantity_receive = 0 and outstanding = the full contract
   * quantity - i.e. as though nothing had ever shipped.
   *
   * So: mark stale BEFORE touching the data (readers fall back to live while the rebuild runs),
   * do the delete and the insert in ONE transaction (readers never observe an empty or partial
   * table), and on failure log loudly and leave `is_stale = TRUE` so the system degrades to slow
   * rather than silently wrong. DELETE rather than TRUNCATE so readers keep seeing the previous
   * contents until the swap commits instead of blocking on an ACCESS EXCLUSIVE lock.
   */
  static async refreshAll(): Promise<number> {
    const start = Date.now();
    await query(
      `UPDATE contract_qty_move_snapshot_meta SET is_stale = TRUE WHERE id = 'global'`,
    );
    invalidateContractQtyMoveSnapshotFreshness();

    const client = await getClient();
    let rowCount = 0;
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM contract_qty_move_snapshot');
      const insertRes = await client.query(buildContractQtyMoveSnapshotRefreshSql());
      rowCount = insertRes.rowCount ?? 0;
      await client.query('COMMIT');
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // connection may already be unusable
      }
      logger.error('Contract qty_move snapshot refresh failed - snapshot left stale', {
        err,
        durationMs: Date.now() - start,
      });
      throw err;
    } finally {
      client.release();
    }

    const durationMs = Date.now() - start;
    await query(
      `UPDATE contract_qty_move_snapshot_meta
       SET refreshed_at = NOW(), is_stale = FALSE, row_count = $1, duration_ms = $2
       WHERE id = 'global'`,
      [rowCount, durationMs],
    );
    invalidateContractQtyMoveSnapshotFreshness();
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
 * qty_move CTE for Contracts / Contract Performance / dashboard reads.
 * Fast path: when contract_qty_move_snapshot is fresh, Close and prior-year-Open contracts
 * read straight from the snapshot while only current-year Open contracts stay fully live
 * (buildQtyMoveHybridCte) — this is what cuts Contract Performance / Contracts list load
 * times from tens-to-hundreds of seconds down to low seconds for the majority of rows.
 * Defensive fallback: if the snapshot is stale (e.g. mid SAP import / refreshAll running),
 * fall back to the fully-live computation for every contract, same as the sto_agg/latest_spd
 * snapshots do, so numbers never lag behind a stale snapshot.
 */
export async function resolveContractsQtyMoveCte(
  filter: QtyMoveContractFilter | string = 'contract_scope',
): Promise<string> {
  const resolved: QtyMoveContractFilter =
    typeof filter === 'string' ? { kind: 'join_scope', scopeCteName: filter } : filter;
  if (!(await isContractQtyMoveSnapshotFresh())) {
    return buildQtyMoveCte(resolved);
  }
  /**
   * A fresh snapshot is read directly - no live branch. The hybrid kept current-year Open
   * contracts on the live path so same-day WB / shipment edits showed up, but every one of
   * those mutation paths now fires a targeted refresh (shipment edit and cancel, trucking
   * realization, WB import, SAP import), so the live branch only cost time: measured 0 value
   * differences across all 7,751 rows the YTD scope returns, and 0 across the 947 contracts
   * the old eligibility rule had been refusing.
   */
  return buildQtyMoveFromSnapshotCte(resolved);
}

export { buildQtyMoveFromSnapshotCte, buildQtyMoveCte };
