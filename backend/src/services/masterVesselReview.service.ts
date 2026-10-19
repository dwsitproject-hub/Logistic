/**
 * The "Perlu review" queue of Master Vessel: the vessels KLIP registered itself from a SAP vessel name and was not sure of
 * (services/registerVesselFromSap.service.ts marks them review_status PENDING with the reasons).
 *
 * A person does one of three things with a row:
 *   - approve it (it is right as it is): review_status APPROVED, and the DHM cron may push it;
 *   - edit it in the Edit Vessel dialog (a stump SAP cut at 35 characters, a missing prefix ...) and then approve it;
 *   - merge it into the vessel it really is (the stump "BG. PRIMA SAMUDR" into "BG. PRIMA SAMUDRA VI"): its codes, shipments and pairs move to
 *     the survivor, and it is deleted (masterVesselMerge.service - the same rules as the merge script, so a DHM-linked row is never the one that goes).
 */
import { getClient, query } from '../database/connection';
import { applyMasterVesselMerge, planMasterVesselMerge } from './masterVesselMerge.service';

export interface ReviewCandidate {
  id: string;
  vessel_name: string;
  vessel_code: string;
}

export interface VesselReviewItem {
  id: string;
  vessel_name: string;
  vessel_code: string;
  vessel_role: string | null;
  vessel_type: string | null;
  vessel_owner: string | null;
  code_status: string | null;
  review_reasons: string[];
  review_sap_name: string | null;
  created_at: string | null;
  pair_code: string | null;
  pair_partner_name: string | null;
  /** Existing vessels this one may really be (a longer spelling of a cut name, the same base name): the targets a merge would offer. */
  candidates: ReviewCandidate[];
}

export async function listVesselsForReview(limit = 200): Promise<VesselReviewItem[]> {
  const res = await query(
    `SELECT mv.id::text AS id, mv.vessel_name, mv.vessel_code, mv.vessel_role, mv.vessel_type, mv.vessel_owner, mv.code_status,
            mv.review_reason, mv.review_sap_name, mv.created_at,
            pr.pair_code,
            pr.partner_name AS pair_partner_name,
            COALESCE((
              SELECT json_agg(json_build_object('id', c.id::text, 'vessel_name', c.vessel_name, 'vessel_code', c.vessel_code) ORDER BY c.vessel_name)
              FROM (
                SELECT o.id, o.vessel_name, o.vessel_code
                FROM master_vessels o
                WHERE o.id <> mv.id
                  AND o.review_status IS DISTINCT FROM 'PENDING'
                  AND (mv.vessel_role IS NULL OR o.vessel_role IS NULL OR o.vessel_role = mv.vessel_role)
                  AND length(mv.normalized_vessel_name) >= 4
                  AND (o.normalized_vessel_name = mv.normalized_vessel_name
                       OR o.normalized_vessel_name LIKE mv.normalized_vessel_name || '%')
                ORDER BY o.vessel_name
                LIMIT 5
              ) c
            ), '[]'::json) AS candidates
       FROM master_vessels mv
       LEFT JOIN LATERAL (
         SELECT p.pair_code,
                CASE WHEN p.tb_master_vessel_id = mv.id THEN bg.vessel_name ELSE tb.vessel_name END AS partner_name
           FROM vessel_pairs p
           JOIN master_vessels tb ON tb.id = p.tb_master_vessel_id
           JOIN master_vessels bg ON bg.id = p.bg_master_vessel_id
          WHERE p.tb_master_vessel_id = mv.id OR p.bg_master_vessel_id = mv.id
          ORDER BY p.updated_at DESC NULLS LAST
          LIMIT 1
       ) pr ON TRUE
      WHERE mv.review_status = 'PENDING'
      ORDER BY mv.created_at DESC
      LIMIT $1`,
    [Math.min(500, Math.max(1, limit))],
  );
  return (res.rows as Array<Record<string, unknown>>).map((row) => ({
    id: String(row.id),
    vessel_name: String(row.vessel_name ?? ''),
    vessel_code: String(row.vessel_code ?? ''),
    vessel_role: (row.vessel_role as string | null) ?? null,
    vessel_type: (row.vessel_type as string | null) ?? null,
    vessel_owner: (row.vessel_owner as string | null) ?? null,
    code_status: (row.code_status as string | null) ?? null,
    review_reasons: String(row.review_reason ?? '')
      .split(',')
      .map((r) => r.trim())
      .filter(Boolean),
    review_sap_name: (row.review_sap_name as string | null) ?? null,
    created_at: row.created_at ? new Date(row.created_at as string).toISOString() : null,
    pair_code: (row.pair_code as string | null) ?? null,
    pair_partner_name: (row.pair_partner_name as string | null) ?? null,
    candidates: (Array.isArray(row.candidates) ? row.candidates : []) as ReviewCandidate[],
  }));
}

export async function countVesselsForReview(): Promise<number> {
  const res = await query(`SELECT count(*)::int AS n FROM master_vessels WHERE review_status = 'PENDING'`);
  return Number(res.rows[0]?.n ?? 0);
}

/** Approve one vessel. Returns false when it was not waiting for review. */
export async function approveVesselReview(id: string): Promise<boolean> {
  const res = await query(
    `UPDATE master_vessels SET review_status = 'APPROVED', updated_at = CURRENT_TIMESTAMP
      WHERE id = $1::uuid AND review_status = 'PENDING'
      RETURNING id`,
    [id],
  );
  return res.rows.length > 0;
}

export type MergeForReviewResult =
  | { ok: true; into: { id: string; vessel_name: string }; moved: { aliases: number; shipments: number; pairsMoved: number; pairsDropped: number } }
  | { ok: false; status: number; error: string };

/**
 * Merge a vessel waiting for review into the one it really is. Only a PENDING vessel can be merged away this way (an ordinary merge is the
 * script's job), and every rule of mergeBlockers still applies.
 */
export async function mergeVesselForReview(fromId: string, intoId: string): Promise<MergeForReviewResult> {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const pending = await client.query(`SELECT 1 FROM master_vessels WHERE id = $1::uuid AND review_status = 'PENDING'`, [fromId]);
    if (pending.rows.length === 0) {
      await client.query('ROLLBACK');
      return { ok: false, status: 409, error: 'Kapal ini tidak sedang menunggu review.' };
    }
    const plan = await planMasterVesselMerge(client, fromId, intoId);
    if (plan.blockers.length > 0 || !plan.into) {
      await client.query('ROLLBACK');
      return { ok: false, status: 422, error: plan.blockers.join('; ') };
    }
    const moved = await applyMasterVesselMerge(client, plan);
    await client.query('COMMIT');
    return { ok: true, into: { id: plan.into.id, vessel_name: plan.into.vessel_name }, moved };
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // connection may already be unusable
    }
    throw error;
  } finally {
    client.release();
  }
}
