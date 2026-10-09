import type { PoolClient } from 'pg';

/**
 * Merge ONE master vessel row into another: the same ship that ended up under two spellings ("TB. TOLLANDAK II" and "TB. TOL LANDAK II").
 *
 * The row that goes away (`from`) hands over everything that points at it, in a transaction of the caller's:
 *   - its SAP codes become non-primary aliases of the survivor (the survivor keeps its own primary code),
 *   - shipments that referenced it reference the survivor,
 *   - pairs it belonged to are re-pointed (a pair that would then repeat one the survivor already has is dropped),
 *   - its empty-in-the-survivor fields (role, owner, capacity, type, heating, lambung, terms) are copied over, never overwriting.
 * and then it is deleted.
 *
 * Refused (blockers) rather than guessed: a row linked to DHM is never the one that goes away, since deleting it would orphan the DHM
 * record - merge the other way; two different roles, or a tug into a barge, are two ships; and a vessel into itself.
 */

export interface MasterRow {
  id: string;
  vessel_name: string;
  vessel_code: string;
  vessel_role: string | null;
  vessel_type: string | null;
  code_status: string | null;
  dhm_id: string | null;
  dhm_code: string | null;
}

export interface MergePlan {
  from: MasterRow | null;
  into: MasterRow | null;
  counts: { aliases: number; shipments: number; pairs: number };
  blockers: string[];
}

const isTug = (t: string | null | undefined) => /^TUG/i.test(String(t ?? '').trim());

/** Pure: why this merge must not happen. */
export function mergeBlockers(from: MasterRow | null, into: MasterRow | null): string[] {
  if (!from) return ['baris yang akan digabung (from) tidak ditemukan'];
  if (!into) return ['baris tujuan (into) tidak ditemukan'];
  const out: string[] = [];
  if (from.id === into.id) out.push('from dan into adalah baris yang sama');
  if (from.dhm_id) {
    out.push(`"${from.vessel_name}" sudah terhubung ke DHM (${from.dhm_code ?? from.dhm_id}); menghapusnya akan menggantung rekaman DHM - gabungkan ke arah sebaliknya`);
  }
  if (from.vessel_role && into.vessel_role && from.vessel_role !== into.vessel_role) {
    out.push(`peran berbeda (${from.vessel_role} vs ${into.vessel_role}): dua kapal, bukan satu`);
  }
  const fromTug = isTug(from.vessel_type) || from.vessel_role === 'TB';
  const intoTug = isTug(into.vessel_type) || into.vessel_role === 'TB';
  const typed = (r: MasterRow) => Boolean(r.vessel_type) || Boolean(r.vessel_role);
  if (typed(from) && typed(into) && fromTug !== intoTug) out.push('satu tugboat dan satu tongkang: dua kapal, bukan satu');
  return out;
}

const ROW_SQL = `SELECT id::text, vessel_name, vessel_code, vessel_role, vessel_type, code_status, dhm_id::text, dhm_code FROM master_vessels`;

/** `ref` is a master vessel id (uuid) or its exact name, case-insensitively. A name that matches several rows is refused. */
export async function findMasterRow(client: Pick<PoolClient, 'query'>, ref: string): Promise<MasterRow | null> {
  const value = String(ref ?? '').trim();
  if (!value) return null;
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
  const res = isUuid
    ? await client.query(`${ROW_SQL} WHERE id = $1::uuid`, [value])
    : await client.query(`${ROW_SQL} WHERE upper(trim(vessel_name)) = upper(trim($1))`, [value]);
  if (res.rows.length > 1) throw new Error(`"${value}" cocok dengan ${res.rows.length} baris; pakai id-nya`);
  return (res.rows[0] as MasterRow | undefined) ?? null;
}

export async function planMasterVesselMerge(client: Pick<PoolClient, 'query'>, fromRef: string, intoRef: string): Promise<MergePlan> {
  const from = await findMasterRow(client, fromRef);
  const into = await findMasterRow(client, intoRef);
  const blockers = mergeBlockers(from, into);
  const counts = { aliases: 0, shipments: 0, pairs: 0 };
  if (from) {
    const [a, s, p] = await Promise.all([
      client.query(`SELECT count(*)::int AS n FROM master_vessel_code_aliases WHERE master_vessel_id = $1::uuid`, [from.id]),
      client.query(`SELECT count(*)::int AS n FROM shipments WHERE master_vessel_id = $1::uuid`, [from.id]),
      client.query(
        `SELECT count(*)::int AS n FROM vessel_pairs WHERE tb_master_vessel_id = $1::uuid OR bg_master_vessel_id = $1::uuid`,
        [from.id],
      ),
    ]);
    counts.aliases = a.rows[0]?.n ?? 0;
    counts.shipments = s.rows[0]?.n ?? 0;
    counts.pairs = p.rows[0]?.n ?? 0;
  }
  return { from, into, counts, blockers };
}

/** Writes inside the caller's transaction. Throws when the plan has blockers. */
export async function applyMasterVesselMerge(
  client: Pick<PoolClient, 'query'>,
  plan: MergePlan,
  options: { renameSurvivorTo?: string | null } = {},
): Promise<{ aliases: number; shipments: number; pairsMoved: number; pairsDropped: number }> {
  if (plan.blockers.length > 0 || !plan.from || !plan.into) throw new Error(`merge refused: ${plan.blockers.join('; ')}`);
  const from = plan.from.id;
  const into = plan.into.id;

  await client.query(
    `UPDATE master_vessels t SET
       vessel_role = COALESCE(t.vessel_role, f.vessel_role),
       vessel_owner = COALESCE(NULLIF(trim(t.vessel_owner), ''), f.vessel_owner),
       vessel_capacity_mt = COALESCE(t.vessel_capacity_mt, f.vessel_capacity_mt),
       vessel_type = COALESCE(NULLIF(trim(t.vessel_type), ''), f.vessel_type),
       heating = COALESCE(t.heating, f.heating),
       lambung_type = COALESCE(NULLIF(trim(t.lambung_type), ''), f.lambung_type),
       terms = COALESCE(NULLIF(trim(t.terms), ''), f.terms),
       updated_at = CURRENT_TIMESTAMP
     FROM master_vessels f WHERE t.id = $1::uuid AND f.id = $2::uuid`,
    [into, from],
  );
  // one primary code per vessel (a partial unique index): the codes that move come over as plain aliases
  const aliases = await client.query(
    `UPDATE master_vessel_code_aliases SET master_vessel_id = $1::uuid, is_primary = false, updated_at = CURRENT_TIMESTAMP
      WHERE master_vessel_id = $2::uuid`,
    [into, from],
  );
  const shipments = await client.query(`UPDATE shipments SET master_vessel_id = $1::uuid WHERE master_vessel_id = $2::uuid`, [into, from]);

  // a pair that would repeat one the survivor already has is dropped (its SAP names go with it); the others are re-pointed
  const dropped =
    ((await client.query(
      `DELETE FROM vessel_pairs p WHERE p.tb_master_vessel_id = $2::uuid
         AND EXISTS (SELECT 1 FROM vessel_pairs q WHERE q.tb_master_vessel_id = $1::uuid AND q.bg_master_vessel_id = p.bg_master_vessel_id)`,
      [into, from],
    )).rowCount ?? 0) +
    ((await client.query(
      `DELETE FROM vessel_pairs p WHERE p.bg_master_vessel_id = $2::uuid
         AND EXISTS (SELECT 1 FROM vessel_pairs q WHERE q.bg_master_vessel_id = $1::uuid AND q.tb_master_vessel_id = p.tb_master_vessel_id)`,
      [into, from],
    )).rowCount ?? 0);
  const moved =
    ((await client.query(`UPDATE vessel_pairs SET tb_master_vessel_id = $1::uuid, updated_at = CURRENT_TIMESTAMP WHERE tb_master_vessel_id = $2::uuid`, [into, from])).rowCount ?? 0) +
    ((await client.query(`UPDATE vessel_pairs SET bg_master_vessel_id = $1::uuid, updated_at = CURRENT_TIMESTAMP WHERE bg_master_vessel_id = $2::uuid`, [into, from])).rowCount ?? 0);

  await client.query(`DELETE FROM master_vessels WHERE id = $1::uuid`, [from]);
  if (options.renameSurvivorTo && options.renameSurvivorTo.trim()) {
    await client.query(`UPDATE master_vessels SET vessel_name = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1::uuid`, [
      into,
      options.renameSurvivorTo.trim().toUpperCase(),
    ]);
  }
  return { aliases: aliases.rowCount ?? 0, shipments: shipments.rowCount ?? 0, pairsMoved: moved, pairsDropped: dropped };
}
