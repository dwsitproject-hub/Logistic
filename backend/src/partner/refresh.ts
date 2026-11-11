import type { PoolClient } from 'pg';
import { getClient, query } from '../database/connection';
import logger from '../utils/logger';
import { enqueueChangeEvents, type ChangeEvent } from './deliveries';
import { assignRecordIds, newRecordId, type StoredIdentity } from './identity';
import {
  buildPartnerRecord,
  partitionPartnerGroups,
  type BuiltRecord,
  type GroupRow,
  type LegRow,
  type LineRow,
  type PairRow,
  type PrimaryRow,
} from './recordBuilder';
import {
  PARTNER_LEGS_SQL,
  PARTNER_LINES_SQL,
  PARTNER_PAIRS_SQL,
  PARTNER_PRIMARY_SQL,
  buildPartnerGroupsSql,
} from './recordSql';

/**
 * Rebuilds partner_shipment_records (migration 257) from the Shipments page derivation, keeping each record's id and raising its version only when what KMAPS
 * can see has changed.
 *
 * It runs only when something it reads has changed (a cheap signature of the source tables) or the day turned (the stage reads CURRENT_DATE), and never
 * twice at once (advisory lock). The signature is taken BEFORE the data is read, so a change that lands mid-run is seen by the next run, not lost.
 */

const LOCK_KEY = 'klip-partner-records-refresh';
/** The freshness GET /catalog states: the scheduler checks every minute and a refresh itself takes seconds. */
export const PARTNER_MAX_STALENESS_SECONDS = 300;
const TOMBSTONE_RETENTION_DAYS = 30;

export interface PartnerRefreshResult {
  refreshed: boolean;
  skippedReason?: 'unchanged' | 'busy';
  records: number;
  created: number;
  changed: number;
  retired: number;
  /** record_ids whose exposed content changed (created, changed, retired): the webhook bell is rung for these. */
  changedRecordIds: string[];
  /** The bells queued for those changes (zero when no webhook is configured). */
  bellsQueued: number;
  durationMs: number;
}

const EMPTY: PartnerRefreshResult = { refreshed: false, records: 0, created: 0, changed: 0, retired: 0, changedRecordIds: [], bellsQueued: 0, durationMs: 0 };

/**
 * Which rules turn the tables into records. Part of the signature: a deploy that changes WHAT is sent (not the data) must make the next run rebuild, or the
 * records already stored keep the old answer until some source row happens to change. Raise it with every change of the rules in recordSql / recordBuilder.
 *   2026-11-11  a shipment is sent only with a vessel AND some schedule (partnerIneligibleReason)
 */
export const PARTNER_RULES_VERSION = '2026-11-11-eligibility';

/** One text per run that changes whenever any table the records are built from changes (or the date does), or the rules do. */
export async function partnerSourceSignature(): Promise<string> {
  const tables = [
    'shipments',
    'contracts',
    'contract_stos',
    'vessel_loading_ports',
    'shipment_ata_overrides',
    'master_vessels',
    'master_vessel_code_aliases',
    'master_loading_ports',
    'master_plants',
    'products',
    'vessel_pairs',
  ];
  const parts = await Promise.all(
    tables.map(async (t) => {
      const col = t === 'vessel_pairs' || t === 'contract_stos' ? 'created_at' : 'updated_at';
      const res = await query(`SELECT COUNT(*)::text AS n, COALESCE(MAX(${col})::text, '') AS m FROM ${t}`);
      return `${t}=${res.rows[0].n}/${res.rows[0].m}`;
    }),
  );
  // SAP imports change the close flags the stage reads through sap_processed_data.
  const spd = await query(`SELECT COUNT(*)::text AS n, COALESCE(MAX(created_at)::text, '') AS m FROM sap_processed_data`);
  const day = await query(`SELECT CURRENT_DATE::text AS d`);
  return [...parts, `sap_processed_data=${spd.rows[0].n}/${spd.rows[0].m}`, `day=${day.rows[0].d}`, `rules=${PARTNER_RULES_VERSION}`].join('|');
}

async function lockClient(): Promise<PoolClient | null> {
  const client = await getClient();
  const got = await client.query(`SELECT pg_try_advisory_lock(hashtext($1)) AS ok`, [LOCK_KEY]);
  if (got.rows[0]?.ok === true) return client;
  client.release();
  return null;
}

async function unlock(client: PoolClient): Promise<void> {
  try {
    await client.query(`SELECT pg_advisory_unlock(hashtext($1))`, [LOCK_KEY]);
  } finally {
    client.release();
  }
}

export async function refreshPartnerRecords(options: { force?: boolean } = {}): Promise<PartnerRefreshResult> {
  const startedAt = Date.now();
  const lock = await lockClient();
  if (!lock) return { ...EMPTY, skippedReason: 'busy' };
  try {
    const signature = await partnerSourceSignature();
    if (!options.force) {
      const state = await query(`SELECT signature FROM partner_snapshot_state WHERE id = 1`);
      if (state.rows[0]?.signature === signature) return { ...EMPTY, skippedReason: 'unchanged' };
    }
    const result = await rebuild(startedAt);
    await query(
      `UPDATE partner_snapshot_state
          SET signature = $1, refreshed_at = NOW(), duration_ms = $2, record_count = $3, last_error = NULL, last_error_at = NULL
        WHERE id = 1`,
      [signature, Date.now() - startedAt, result.records],
    );
    return { ...result, refreshed: true, durationMs: Date.now() - startedAt };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('KMAPS partner records refresh failed', { error: message });
    await query(`UPDATE partner_snapshot_state SET last_error = $1, last_error_at = NOW() WHERE id = 1`, [message.slice(0, 500)]).catch(
      () => undefined,
    );
    throw error;
  } finally {
    await unlock(lock);
  }
}

interface StoredRow extends StoredIdentity {
  content_hash: string | null;
  version: string;
  active: boolean;
  deleted: boolean;
  status: string | null;
  vessel_dhm_code: string | null;
  vessel_sap_codes: string[];
  left_active_at: Date | null;
}

async function rebuild(startedAt: number): Promise<Omit<PartnerRefreshResult, 'refreshed' | 'durationMs'>> {
  const groups = (await query(buildPartnerGroupsSql())).rows as GroupRow[];
  const stored = (
    await query(
      `SELECT record_id, sto_key, member_ids::text[] AS member_ids, first_seen_at, content_hash, version::text AS version, active, deleted, status,
              vessel_dhm_code, vessel_sap_codes, left_active_at
         FROM partner_shipment_records WHERE NOT deleted`,
    )
  ).rows as StoredRow[];

  // A query that yields nothing while records exist is a fault, not a fleet that vanished: retiring everything would tell KMAPS every shipment ended.
  if (groups.length === 0 && stored.some((s) => s.active)) {
    throw new Error('The shipment scope came back empty while active records exist; nothing was retired.');
  }

  const primaryIds = groups.map((g) => g.primary_id);
  const memberIds = groups.flatMap((g) => g.member_ids);
  const memberKeys = groups.flatMap((g) => g.member_ids.map(() => g.sto_key));

  const [primaryRows, legRows, lineRows, pairRows] = await Promise.all([
    query(PARTNER_PRIMARY_SQL, [primaryIds, groups.map((g) => g.master_vessel_id)]),
    query(PARTNER_LEGS_SQL, [primaryIds]),
    query(PARTNER_LINES_SQL, [memberIds, memberKeys]),
    query(PARTNER_PAIRS_SQL),
  ]);

  const primaryById = new Map((primaryRows.rows as PrimaryRow[]).map((p) => [p.primary_id, p]));
  const legsById = new Map<string, LegRow[]>();
  for (const l of legRows.rows as LegRow[]) legsById.set(l.primary_id, [...(legsById.get(l.primary_id) ?? []), l]);
  const linesByKey = new Map<string, LineRow[]>();
  for (const l of lineRows.rows as LineRow[]) linesByKey.set(l.sto_key, [...(linesByKey.get(l.sto_key) ?? []), l]);
  const pairs = pairRows.rows as PairRow[];

  // Only a shipment with a vessel and some schedule is sent (see partnerIneligibleReason). The rest stay out of `built`, so a record already sent for one of them is
  // left unclaimed below and retired as a tombstone, not as Cancelled: it was never a real shipment.
  const { eligible, ineligibleMemberIds, ineligibleByReason } = partitionPartnerGroups({ groups, primaryById, legsById, linesByKey });
  const ineligible = groups.length - eligible.length;
  // A judgement that rejects every group while records are live is a fault in the read, not a fleet with no vessel: retiring all of it would tell KMAPS everything ended.
  if (eligible.length === 0 && groups.length > 0 && stored.some((s) => s.active)) {
    throw new Error('Every shipment group was judged ineligible while active records exist; nothing was retired.');
  }

  const built: BuiltRecord[] = eligible.map((group) =>
    buildPartnerRecord({
      group,
      primary: primaryById.get(group.primary_id),
      legs: legsById.get(group.primary_id) ?? [],
      lines: linesByKey.get(group.sto_key) ?? [],
      pairs,
    }),
  );

  const assignment = assignRecordIds(
    built.map((b) => ({ stoKey: b.stoKey, memberIds: b.memberIds })),
    stored,
  );
  const storedById = new Map(stored.map((s) => [s.record_id, s]));

  // A stored record no group claims: gone from the page scope. If its shipments still exist (SAP withdrew the PO, a type changed) it is a Cancelled record;
  // if they are gone too it is a tombstone. Shipments of a group judged ineligible count as gone: the shipment exists in KLIP but KMAPS must stop holding it.
  const unclaimedMembers = assignment.unclaimed.flatMap((id) => storedById.get(id)?.member_ids ?? []);
  const stillThere = new Set<string>(
    unclaimedMembers.length
      ? ((await query(`SELECT id::text AS id FROM shipments WHERE id = ANY($1::uuid[])`, [unclaimedMembers])).rows as Array<{ id: string }>)
          .map((r) => r.id)
          .filter((id) => !ineligibleMemberIds.has(id))
      : [],
  );

  const client = await getClient();
  const changedRecordIds: string[] = [];
  const events: ChangeEvent[] = [];
  let created = 0;
  let changed = 0;
  let retired = 0;
  let bellsQueued = 0;
  try {
    await client.query('BEGIN');

    for (let i = 0; i < built.length; i += 1) {
      const rec = built[i];
      const keepId = assignment.keeps[i];
      const old = keepId ? storedById.get(keepId) : undefined;
      const cols = [rec.stoKey, rec.memberIds, rec.vesselDhmCode, rec.vesselSapCodes, rec.status, rec.active, JSON.stringify(rec.payload), rec.contentHash];
      if (!old) {
        const id = await insertRecord(client, cols);
        changedRecordIds.push(id);
        events.push({ recordId: id, version: 1, vesselCode: rec.vesselDhmCode, events: ['shipment.created'] });
        created += 1;
        continue;
      }
      const exposedChanged = old.content_hash !== rec.contentHash || old.deleted;
      if (exposedChanged) {
        await client.query(
          `UPDATE partner_shipment_records
              SET sto_key = $2, member_ids = $3::uuid[], vessel_dhm_code = $4, vessel_sap_codes = $5::text[], status = $6, active = $7,
                  deleted = FALSE, deleted_at = NULL, payload = $8::jsonb, content_hash = $9,
                  version = version + 1, updated_at = NOW(),
                  left_active_at = CASE WHEN $7 THEN NULL WHEN left_active_at IS NULL THEN NOW() ELSE left_active_at END
            WHERE record_id = $1`,
          [old.record_id, ...cols],
        );
        changedRecordIds.push(old.record_id);
        events.push({
          recordId: old.record_id,
          version: Number(old.version) + 1,
          vesselCode: rec.vesselDhmCode,
          events: old.status !== rec.status ? ['shipment.updated', 'shipment.status_changed'] : ['shipment.updated'],
        });
        changed += 1;
      } else {
        // Nothing KMAPS can see changed. Keep the internal columns current (a new STO key or member) without raising the version.
        await client.query(
          `UPDATE partner_shipment_records
              SET sto_key = $2, member_ids = $3::uuid[], vessel_dhm_code = $4, vessel_sap_codes = $5::text[]
            WHERE record_id = $1
              AND (sto_key IS DISTINCT FROM $2 OR member_ids IS DISTINCT FROM $3::uuid[] OR vessel_dhm_code IS DISTINCT FROM $4
                   OR vessel_sap_codes IS DISTINCT FROM $5::text[])`,
          [old.record_id, rec.stoKey, rec.memberIds, rec.vesselDhmCode, rec.vesselSapCodes],
        );
      }
    }

    for (const id of assignment.unclaimed) {
      const old = storedById.get(id);
      if (!old) continue;
      const exists = old.member_ids.some((m) => stillThere.has(m));
      if (exists) {
        if (old.active || old.status !== 'CANCELLED') {
          await client.query(
            `UPDATE partner_shipment_records
                SET active = FALSE, status = 'CANCELLED',
                    payload = jsonb_set(jsonb_set(COALESCE(payload, '{}'::jsonb), '{status}', '"CANCELLED"'), '{statusLabel}', '"Cancelled"'),
                    content_hash = NULL, version = version + 1, updated_at = NOW(),
                    left_active_at = COALESCE(left_active_at, NOW())
              WHERE record_id = $1`,
            [id],
          );
          changedRecordIds.push(id);
          events.push({ recordId: id, version: Number(old.version) + 1, vesselCode: old.vessel_dhm_code, events: ['shipment.updated', 'shipment.status_changed'] });
          retired += 1;
        }
      } else {
        await client.query(
          `UPDATE partner_shipment_records
              SET deleted = TRUE, active = FALSE, deleted_at = NOW(), left_active_at = COALESCE(left_active_at, NOW()),
                  version = version + 1, updated_at = NOW()
            WHERE record_id = $1`,
          [id],
        );
        changedRecordIds.push(id);
        events.push({ recordId: id, version: Number(old.version) + 1, vesselCode: old.vessel_dhm_code, events: ['shipment.deleted'] });
        retired += 1;
      }
    }

    // The bells are committed with the changes they announce: both happen or neither does.
    bellsQueued = await enqueueChangeEvents(client, events);

    await client.query(
      `DELETE FROM partner_shipment_records WHERE deleted AND deleted_at < NOW() - ($1::int || ' days')::interval`,
      [TOMBSTONE_RETENTION_DAYS],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }

  logger.info('KMAPS partner records refreshed', { groups: built.length, ineligible, ineligibleByReason, created, changed, retired, ms: Date.now() - startedAt });
  return { records: built.length, created, changed, retired, changedRecordIds, bellsQueued };
}

async function insertRecord(client: PoolClient, cols: unknown[]): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const id = newRecordId();
    const res = await client.query(
      `INSERT INTO partner_shipment_records
         (record_id, sto_key, member_ids, vessel_dhm_code, vessel_sap_codes, status, active, payload, content_hash)
       VALUES ($1, $2, $3::uuid[], $4, $5::text[], $6, $7, $8::jsonb, $9)
       ON CONFLICT (record_id) DO NOTHING
       RETURNING record_id`,
      [id, ...cols],
    );
    if (res.rows.length > 0) return id;
  }
  throw new Error('Could not allocate a unique record id.');
}
