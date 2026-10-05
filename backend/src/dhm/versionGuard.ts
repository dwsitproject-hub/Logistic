/**
 * Never let an older DHM record overwrite a newer one.
 *
 * Every DHM record carries an integer `version` that rises with each change. KLIP stores it (dhm_version) next to the
 * replica, but nothing compared it: a webhook is delivered at least once and retried with backoff up to 8 times, the cron
 * pulls on its own clock, and both write the same rows. A v3 that arrives after v4 was applied would put the old name,
 * code or deleted flag back. The guard compares before writing and skips a record whose version is lower than the one
 * the replica already holds.
 *
 * Equal versions are applied: that is the same record again, an idempotent no-op. A record that carries no version at
 * all (a webhook body without one) cannot be ordered, so it is applied as before rather than dropped.
 *
 * A full snapshot sync passes `force`. It exists to rebuild the replica from DHM, and if DHM was ever restored from a
 * backup its versions could be LOWER than ours - the guard would then ignore every change until they caught up.
 *
 * Reading the stored version and then writing is not atomic, so two deliveries of the same record in the same
 * millisecond can still pass each other. The delete path closes that window in SQL (see markDhmMasterDeleted).
 */
import { query } from '../database/connection';
import logger from '../utils/logger';
import { asDhmUuid } from './masterReplica';
import type { DhmRecord } from './types';

export interface DhmApplyOptions {
  /** Apply whatever DHM sent (snapshot sync). */
  force?: boolean;
  /** False when the record's version is a placeholder (a webhook body without one): do not order it. */
  versionKnown?: boolean;
}

/** True when the incoming record is OLDER than what the replica holds. Unknown on either side means "not stale". */
export function isStaleDhmVersion(stored: number | null | undefined, incoming: number | null | undefined): boolean {
  if (stored == null || incoming == null) return false;
  if (!Number.isFinite(stored) || !Number.isFinite(incoming)) return false;
  return incoming < stored;
}

/**
 * The local tables that replicate a DHM slug. `company` / `organization` live in two (the raw organisation replica and
 * the Master Company it feeds), and the reference masters share one table split by kind.
 */
function replicaTargets(slug: string): Array<{ table: string; kind: string | null }> {
  switch (slug) {
    case 'vessel':
      return [{ table: 'master_vessels', kind: null }];
    case 'company':
    case 'organization':
      return [
        { table: 'dhm_organizations', kind: null },
        { table: 'master_companies', kind: null },
      ];
    case 'site':
      return [{ table: 'master_sites', kind: null }];
    case 'plant':
      return [{ table: 'master_plants', kind: null }];
    case 'port_master':
      return [{ table: 'master_loading_ports', kind: null }];
    case 'commodity':
      return [{ table: 'products', kind: null }];
    case 'incoterm':
      return [{ table: 'master_reference_items', kind: 'incoterm' }];
    case 'shipper':
    case 'external_party':
      return [{ table: 'master_reference_items', kind: 'ext_company' }];
    default:
      return [];
  }
}

/** The highest version the replica holds for this DHM record, or null when it has never seen it. */
export async function storedDhmVersion(slug: string, dhmRecordId: string): Promise<number | null> {
  const id = asDhmUuid(dhmRecordId);
  if (!id) return null;
  const targets = replicaTargets(slug);
  if (targets.length === 0) return null;
  const parts = targets.map(
    ({ table, kind }) =>
      `SELECT dhm_version AS v FROM ${table} WHERE dhm_id = $1::uuid${kind ? ` AND kind = '${kind}'` : ''}`,
  );
  const result = await query(`SELECT MAX(v) AS v FROM (${parts.join(' UNION ALL ')}) t`, [id]);
  const v = result.rows[0]?.v;
  return v == null ? null : Number(v);
}

/**
 * Whether this record should be written. False means "the replica already holds a newer version"; the reason is logged so
 * a skipped delivery is visible rather than silent.
 */
export async function shouldApplyDhmRecord(
  slug: string,
  record: Pick<DhmRecord, 'id' | 'version' | 'updatedAt'>,
  options: DhmApplyOptions = {},
): Promise<boolean> {
  if (options.force || options.versionKnown === false) return true;
  const stored = await storedDhmVersion(slug, record.id);
  if (!isStaleDhmVersion(stored, record.version)) return true;
  logger.info('DHM record skipped: the replica already holds a newer version', {
    slug,
    recordId: record.id,
    storedVersion: stored,
    incomingVersion: record.version,
    incomingUpdatedAt: record.updatedAt || null,
  });
  return false;
}
