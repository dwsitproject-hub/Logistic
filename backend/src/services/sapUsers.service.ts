import { getClient, query } from '../database/connection';

/**
 * SAP users (the ZUSER extract): NIK -> name, for the COD dashboard and the SAP Users menu. See migration 262.
 * One writer today (the administrator's upload of the extract, source 'ZUSER'); the planned PRC sync will write source 'PRC' and win.
 */

export type SapUserRow = { user_id: string; client: string; first_name: string; last_name: string };

/** Which source a load comes from. A row written by 'PRC' is never overwritten by a load of 'ZUSER'. */
export type SapUserSource = 'ZUSER' | 'PRC';

const CHUNK = 1000;

/**
 * Upsert users in one transaction. The name is first + last, trimmed, in capitals (built here, so every writer agrees).
 * Rows of a higher-priority source are left alone: a ZUSER load skips the users PRC has written.
 */
export async function upsertSapUsers(rows: SapUserRow[], source: SapUserSource, userId: string | null): Promise<number> {
  if (!rows.length) return 0;
  const client = await getClient();
  try {
    await client.query('BEGIN');
    for (let i = 0; i < rows.length; i += CHUNK) {
      const part = rows.slice(i, i + CHUNK);
      await client.query(
        `INSERT INTO sap_users (user_id, client, first_name, last_name, display_name, source, loaded_by)
         SELECT t.uid, t.client, t.first, t.last,
                UPPER(TRIM(CONCAT_WS(' ', NULLIF(TRIM(t.first), ''), NULLIF(TRIM(t.last), '')))), $5::text, $6::uuid
         FROM unnest($1::text[], $2::text[], $3::text[], $4::text[]) AS t(uid, client, first, last)
         ON CONFLICT (user_id) DO UPDATE
           SET client = EXCLUDED.client, first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, display_name = EXCLUDED.display_name,
               source = EXCLUDED.source, loaded_at = CURRENT_TIMESTAMP, loaded_by = EXCLUDED.loaded_by
           WHERE sap_users.source <> 'PRC' OR EXCLUDED.source = 'PRC'`,
        [part.map((r) => r.user_id), part.map((r) => r.client), part.map((r) => r.first_name), part.map((r) => r.last_name), source, userId],
      );
    }
    await client.query('COMMIT');
    return rows.length;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export type SapUsersListParams = {
  search?: string | null;
  /** Only the users who created POs of the ME2N report, i.e. the ones that have data on the dashboard. */
  hasData?: boolean;
  page?: number;
  limit?: number;
};

const PO_COUNT_JOIN =
  'LEFT JOIN (SELECT created_by, COUNT(*)::int AS pos FROM commercial_po_creators GROUP BY created_by) pc ON pc.created_by = u.user_id';

/** The SAP Users list: users with their number of POs, most POs first, then by name. The search matches the NIK or the name. */
export function buildSapUsersListQuery(params: SapUsersListParams): { sql: string; countSql: string; values: unknown[]; countValues: unknown[] } {
  const page = Math.max(1, Number(params.page) || 1);
  const limit = Math.min(200, Math.max(1, Number(params.limit) || 25));
  const where: string[] = ['1=1'];
  const values: unknown[] = [];
  const term = String(params.search ?? '').trim();
  if (term) {
    // % and _ typed by the user are literal characters, not wildcards.
    values.push(`%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
    where.push(`(u.user_id ILIKE $${values.length} OR u.display_name ILIKE $${values.length})`);
  }
  if (params.hasData) where.push('COALESCE(pc.pos, 0) > 0');
  const whereSql = where.join(' AND ');
  const countValues = [...values];
  values.push(limit, (page - 1) * limit);
  return {
    sql: `
      SELECT u.user_id, u.client, u.display_name, u.source, u.loaded_at, COALESCE(pc.pos, 0)::int AS pos
      FROM sap_users u ${PO_COUNT_JOIN}
      WHERE ${whereSql}
      ORDER BY COALESCE(pc.pos, 0) DESC, u.display_name ASC, u.user_id ASC
      LIMIT $${values.length - 1} OFFSET $${values.length}`,
    countSql: `SELECT COUNT(*)::int AS total FROM sap_users u ${PO_COUNT_JOIN} WHERE ${whereSql}`,
    values,
    countValues,
  };
}

export type SapUsersPage = {
  users: Array<{ userId: string; client: string | null; name: string; source: string; loadedAt: string | null; pos: number }>;
  total: number;
  /** All users loaded, how many have data on the dashboard, and when the extract was last loaded. */
  totals: { users: number; withData: number; loadedAt: string | null };
  /** Creators of the ME2N report that have no row in sap_users (the dashboard shows their NIK instead of a name). */
  unmatchedCreators: number;
};

export async function listSapUsers(params: SapUsersListParams): Promise<SapUsersPage> {
  const q = buildSapUsersListQuery(params);
  const [rows, count, totals, unmatched] = await Promise.all([
    query(q.sql, q.values),
    query(q.countSql, q.countValues),
    query(
      `SELECT COUNT(*)::int AS users, COUNT(*) FILTER (WHERE pc.pos > 0)::int AS with_data, MAX(u.loaded_at) AS loaded_at
       FROM sap_users u ${PO_COUNT_JOIN}`,
    ),
    query(
      `SELECT COUNT(DISTINCT p.created_by)::int AS n FROM commercial_po_creators p
       WHERE NOT EXISTS (SELECT 1 FROM sap_users u WHERE u.user_id = p.created_by AND u.display_name <> '')`,
    ),
  ]);
  return {
    users: rows.rows.map((r) => ({
      userId: String(r.user_id),
      client: r.client ? String(r.client) : null,
      name: String(r.display_name || ''),
      source: String(r.source),
      loadedAt: r.loaded_at ? new Date(String(r.loaded_at)).toISOString() : null,
      pos: Number(r.pos) || 0,
    })),
    total: Number(count.rows[0]?.total) || 0,
    totals: {
      users: Number(totals.rows[0]?.users) || 0,
      withData: Number(totals.rows[0]?.with_data) || 0,
      loadedAt: totals.rows[0]?.loaded_at ? new Date(String(totals.rows[0].loaded_at)).toISOString() : null,
    },
    unmatchedCreators: Number(unmatched.rows[0]?.n) || 0,
  };
}
