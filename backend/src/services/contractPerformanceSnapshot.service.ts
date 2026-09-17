import { getClient, query } from '../database/connection';
import logger from '../utils/logger';
import { buildContractPerformanceSnapshotRefreshSql } from '../utils/contractPerformanceSnapshotSql';

export const CONTRACT_PERFORMANCE_SNAPSHOT_TABLE = 'contract_performance_snapshot';

export async function isContractPerformanceSnapshotFresh(): Promise<boolean> {
  const res = await query(
    `SELECT is_stale FROM contract_performance_snapshot_meta WHERE id = 'global' LIMIT 1`,
  );
  const row = res.rows[0] as { is_stale?: boolean } | undefined;
  return Boolean(row && !row.is_stale);
}

export async function markContractPerformanceSnapshotStale(): Promise<void> {
  await query(
    `UPDATE contract_performance_snapshot_meta SET is_stale = TRUE WHERE id = 'global'`,
  );
}

/**
 * Fire-and-forget targeted refresh after a KLIP edit, for the write paths that already refresh
 * the qty_move snapshot.
 *
 * Not awaited on purpose. A targeted recompute measures ~3s (mostly fixed CTE setup, near enough
 * the same for one contract or three), and those call sites sit on the user's save request, which
 * already awaits the qty_move refresh. Blocking the save for another 3s to close a window that
 * short is the worse trade: the view table converges within a few seconds, which is well inside
 * the time it takes to navigate to it.
 *
 * The consequence to be honest about: for those few seconds the Contract Performance view table
 * can still show the pre-edit delivery/receive quantity or status. Failures are logged, and the
 * next SAP import rebuilds the whole snapshot regardless.
 */
export function scheduleContractPerformanceRefreshForShipments(shipmentIds: string[]): void {
  if (shipmentIds.length === 0) return;
  setImmediate(() => {
    void ContractPerformanceSnapshotService.refreshForShipmentIds(shipmentIds).catch((err) =>
      logger.error('Contract performance snapshot refresh after shipment edit failed', {
        shipmentIds,
        err,
      }),
    );
  });
}

export function scheduleContractPerformanceRefreshForTruckingOps(opIds: string[]): void {
  if (opIds.length === 0) return;
  setImmediate(() => {
    void ContractPerformanceSnapshotService.refreshForTruckingOperationIds(opIds).catch((err) =>
      logger.error('Contract performance snapshot refresh after trucking edit failed', {
        opIds,
        err,
      }),
    );
  });
}

export class ContractPerformanceSnapshotService {
  /**
   * Rebuild the whole snapshot.
   *
   * Three things this does deliberately differently from the older snapshot services, because
   * Contract Performance has no affordable live fallback (recomputing costs minutes, so a reader
   * that distrusts the snapshot cannot just fall back per request):
   *
   * 1. Marks the snapshot stale BEFORE touching it, and fresh only after a successful commit.
   *    The older services only ever set is_stale = FALSE at the end, and nothing ever set it to
   *    TRUE (markStale existed but had no callers), so the documented "fall back when stale" path
   *    was effectively dead and readers trusted the table even mid-rebuild.
   * 2. Does the delete and the re-insert in ONE transaction. The older services TRUNCATE and
   *    INSERT as separate autocommit statements, which leaves the table empty or half-filled -
   *    and visible as such - for the whole rebuild (measured ~60s for qty_move). DELETE rather
   *    than TRUNCATE so readers keep seeing the previous contents until the swap commits, instead
   *    of blocking on TRUNCATE's ACCESS EXCLUSIVE lock.
   * 3. Leaves is_stale = TRUE and logs at error level when the rebuild fails, so a failed refresh
   *    degrades to "slow but correct" instead of "fast but wrong". A silent catch here would show
   *    stale GR status and delivery/receive quantities as though they were current.
   */
  static async refreshAll(): Promise<number> {
    const start = Date.now();
    await markContractPerformanceSnapshotStale();

    const client = await getClient();
    let rowCount = 0;
    try {
      await client.query('BEGIN');
      await client.query(`DELETE FROM ${CONTRACT_PERFORMANCE_SNAPSHOT_TABLE}`);
      const insertRes = await client.query(await buildContractPerformanceSnapshotRefreshSql());
      rowCount = insertRes.rowCount ?? 0;
      await client.query('COMMIT');
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // connection may already be unusable
      }
      logger.error('Contract performance snapshot refresh failed - snapshot left stale', {
        err,
        durationMs: Date.now() - start,
      });
      throw err;
    } finally {
      client.release();
    }

    // The whole table is replaced on every import, so each refresh leaves a full generation of
    // dead tuples behind - observed growing the table to 75MB right after a rebuild whose live
    // data is ~20MB. Reclaim it now rather than waiting on autovacuum, and ANALYZE in the same
    // pass: the read path filters on contract_date / product / plant_site, and this page has
    // already been bitten once by the planner working from stale statistics.
    //
    // Outside the transaction because VACUUM cannot run inside one, and after the meta update so
    // a failure here leaves the snapshot usable - bloat is a housekeeping problem, not a
    // correctness one.
    const durationMs = Date.now() - start;
    await query(
      `UPDATE contract_performance_snapshot_meta
       SET refreshed_at = NOW(), is_stale = FALSE, row_count = $1, duration_ms = $2
       WHERE id = 'global'`,
      [rowCount, durationMs],
    );

    try {
      await query(`VACUUM (ANALYZE) ${CONTRACT_PERFORMANCE_SNAPSHOT_TABLE}`);
    } catch (err) {
      logger.warn('Contract performance snapshot VACUUM ANALYZE failed - snapshot still usable', {
        err,
      });
    }

    logger.info('Contract performance snapshot refreshed', { rowCount, durationMs });
    return rowCount;
  }

  /**
   * Recompute just these contracts' rows.
   *
   * Needed because a SAP import is not the only thing that changes what this snapshot holds:
   * editing delivery/receive quantities or shipment/trucking status from the KLIP Shipment and
   * Trucking pages changes the same values, and the Contract Performance view table has to show
   * the edit immediately. The qty_move snapshot already gets this treatment at every one of those
   * write paths (refreshForShipmentIds / refreshForTruckingOperationIds); without the equivalent
   * here, qty_move would be current while this snapshot still served the pre-edit figures.
   *
   * Targeted rather than marking the whole snapshot stale: staleness would drop the page back to
   * the live query for everyone after any single save. Kept in one transaction so a reader never
   * sees these contracts missing, and `is_stale` is deliberately left alone - the rest of the
   * snapshot is still valid.
   */
  static async refreshForContracts(contractNumbers: string[]): Promise<number> {
    const ids = Array.from(
      new Set(contractNumbers.map((c) => String(c ?? '').trim()).filter(Boolean)),
    );
    if (ids.length === 0) return 0;

    const client = await getClient();
    try {
      await client.query('BEGIN');
      await client.query(
        `DELETE FROM ${CONTRACT_PERFORMANCE_SNAPSHOT_TABLE} WHERE contract_id = ANY($1::text[])`,
        [ids],
      );
      const res = await client.query(
        await buildContractPerformanceSnapshotRefreshSql({ forContractNumbers: true }),
        [ids],
      );
      await client.query('COMMIT');
      return res.rowCount ?? 0;
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // connection may already be unusable
      }
      /*
       * Loud, because the visible symptom is a stale figure on the view table rather than an
       * error the user can see - and logging alone was not enough. The transaction rolled back,
       * so the snapshot still holds the pre-edit rows for these contracts and every read goes on
       * serving them. Marking the snapshot stale sends reads back to the live query instead:
       * slower, but right. Best-effort, so a second failure cannot mask the first.
       */
      try {
        await markContractPerformanceSnapshotStale();
        logger.error(
          'Targeted contract performance snapshot refresh failed - snapshot marked stale, reads fall back to live',
          { contractNumbers: ids, err },
        );
      } catch (markErr) {
        logger.error(
          'Targeted contract performance snapshot refresh failed AND marking it stale failed - reads may serve pre-edit figures',
          { contractNumbers: ids, err, markErr },
        );
      }
      throw err;
    } finally {
      client.release();
    }
  }

  /** Contracts behind these shipment UUIDs - used after KLIP shipment qty/status edits. */
  static async refreshForShipmentIds(shipmentIds: string[]): Promise<number> {
    const ids = shipmentIds.map((id) => String(id ?? '').trim()).filter(Boolean);
    if (ids.length === 0) return 0;
    const res = await query(
      `SELECT DISTINCT c.contract_id
       FROM shipments s
       INNER JOIN contracts c ON c.id = s.contract_id
       WHERE s.id = ANY($1::uuid[])`,
      [ids],
    );
    return this.refreshForContracts(
      res.rows.map((r) => String((r as { contract_id?: string }).contract_id ?? '')),
    );
  }

  /** Contracts behind these trucking operation UUIDs - used after KLIP trucking edits. */
  static async refreshForTruckingOperationIds(truckingOperationIds: string[]): Promise<number> {
    const ids = truckingOperationIds.map((id) => String(id ?? '').trim()).filter(Boolean);
    if (ids.length === 0) return 0;
    const res = await query(
      `SELECT DISTINCT c.contract_id
       FROM trucking_operations t
       INNER JOIN contracts c ON c.id = t.contract_id
       WHERE t.id = ANY($1::uuid[])`,
      [ids],
    );
    return this.refreshForContracts(
      res.rows.map((r) => String((r as { contract_id?: string }).contract_id ?? '')),
    );
  }
}
