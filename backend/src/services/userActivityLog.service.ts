import { query } from '../database/connection';
import logger from '../utils/logger';
import {
  computeActiveSecondsFromTimestamps,
  formatActiveDuration,
} from '../utils/userActivityTime';
import { toActivityDateOnly } from '../utils/userActivityDate';
import { parseEventAtInput } from '../utils/strictDateInput';

export type UserActivityEventType = 'CLICK' | 'CREATE' | 'UPDATE' | 'EDIT' | 'VIEW';

export type IngestUserActivityEvent = {
  eventType: UserActivityEventType;
  pagePath?: string | null;
  actionLabel?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  metadata?: Record<string, unknown> | null;
  eventAt?: string | null;
};

const VALID_EVENT_TYPES = new Set<UserActivityEventType>([
  'CLICK',
  'CREATE',
  'UPDATE',
  'EDIT',
  'VIEW',
]);

function truncate(value: string | null | undefined, max: number): string | null {
  if (!value) return null;
  const s = String(value).trim();
  if (!s) return null;
  return s.length > max ? s.slice(0, max) : s;
}

export async function ingestUserActivityEvents(
  userId: string,
  events: IngestUserActivityEvent[],
): Promise<number> {
  if (!events.length) return 0;

  const capped = events.slice(0, 50);
  let inserted = 0;

  for (const ev of capped) {
    if (!VALID_EVENT_TYPES.has(ev.eventType)) continue;
    const eventAtParsed = parseEventAtInput(ev.eventAt);
    if (eventAtParsed.kind === 'invalid') {
      logger.warn('Skipping user activity event with invalid eventAt', {
        userId,
        eventType: ev.eventType,
        eventAt: ev.eventAt,
      });
      continue;
    }
    const eventAtBind = eventAtParsed.kind === 'ok' ? eventAtParsed.value : null;
    try {
      await query(
        `INSERT INTO user_activity_events (
           user_id, event_type, page_path, action_label, entity_type, entity_id, metadata, event_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, COALESCE($8::timestamptz, CURRENT_TIMESTAMP))`,
        [
          userId,
          ev.eventType,
          truncate(ev.pagePath, 500),
          truncate(ev.actionLabel, 500),
          truncate(ev.entityType, 100),
          truncate(ev.entityId, 255),
          ev.metadata ? JSON.stringify(ev.metadata) : null,
          eventAtBind,
        ],
      );
      inserted += 1;
    } catch (error) {
      logger.warn('Failed to ingest user activity event', { error, userId, eventType: ev.eventType });
    }
  }

  return inserted;
}

export type DailySummaryRow = {
  user_id: string;
  username: string;
  full_name: string;
  role: string;
  activity_date: string;
  total_count: number;
  click_count: number;
  create_count: number;
  update_count: number;
  edit_count: number;
  view_count: number;
  active_seconds: number;
  active_duration_label: string;
  /** users.level (empty for Administrator and Management, which carry none). */
  level?: string | null;
  /** The Region/Site names the user is scoped to (user_region_sites), empty when none. */
  region_sites?: string[] | null;
};

export type ListDailySummaryParams = {
  dateFrom?: string;
  dateTo?: string;
  userId?: string;
  /** users.role code. */
  role?: string;
  /** users.level (Dept Head / Section Head / Staff / Admin), compared case-insensitively. */
  level?: string;
  /** One Region/Site name from user_region_sites. */
  regionSite?: string;
  /** Free text: name, username or e-mail. */
  search?: string;
  page?: number;
  limit?: number;
};

/**
 * The WHERE of the daily summary and of its totals, over user_activity_events as e and users as u. One builder so the rows, the count and the cards can never
 * disagree about what a filter means. Values are positional ($1...); nextIndex is the first free one.
 */
export function buildUserActivityWhere(params: ListDailySummaryParams): { whereSql: string; values: unknown[]; nextIndex: number } {
  const conditions: string[] = ['1=1'];
  const values: unknown[] = [];
  let idx = 1;

  if (params.dateFrom) {
    conditions.push(`(e.event_at AT TIME ZONE 'UTC')::date >= $${idx++}::date`);
    values.push(params.dateFrom);
  }
  if (params.dateTo) {
    conditions.push(`(e.event_at AT TIME ZONE 'UTC')::date <= $${idx++}::date`);
    values.push(params.dateTo);
  }
  if (params.userId) {
    conditions.push(`e.user_id = $${idx++}`);
    values.push(params.userId);
  }
  if (params.role?.trim()) {
    conditions.push(`u.role = $${idx++}`);
    values.push(params.role.trim());
  }
  if (params.level?.trim()) {
    conditions.push(`UPPER(TRIM(u.level)) = UPPER($${idx++})`);
    values.push(params.level.trim());
  }
  if (params.regionSite?.trim()) {
    conditions.push(`EXISTS (SELECT 1 FROM user_region_sites urs WHERE urs.user_id = u.id AND urs.region_site = $${idx++})`);
    values.push(params.regionSite.trim());
  }
  if (params.search?.trim()) {
    conditions.push(`(u.full_name ILIKE $${idx} OR u.username ILIKE $${idx} OR u.email ILIKE $${idx})`);
    values.push(`%${params.search.trim()}%`);
    idx++;
  }

  return { whereSql: conditions.join(' AND '), values, nextIndex: idx };
}

async function attachActiveSeconds(
  rows: Array<{
    user_id: string;
    activity_date: string;
    total_count: number;
    click_count: number;
    create_count: number;
    update_count: number;
    edit_count: number;
    view_count: number;
    username: string;
    full_name: string;
    role: string;
  }>,
): Promise<DailySummaryRow[]> {
  if (!rows.length) return [];

  const pairs = rows.map((r) => [r.user_id, toActivityDateOnly(r.activity_date)]);
  const placeholders = pairs.map((_, i) => `($${i * 2 + 1}, $${i * 2 + 2}::date)`).join(', ');

  const tsResult = await query(
    `SELECT user_id, (event_at AT TIME ZONE 'UTC')::date AS activity_date, event_at
     FROM user_activity_events
     WHERE (user_id, (event_at AT TIME ZONE 'UTC')::date) IN (${placeholders})
     ORDER BY user_id, activity_date, event_at ASC`,
    pairs.flat(),
  );

  const byKey = new Map<string, Date[]>();
  for (const row of tsResult.rows) {
    const key = `${row.user_id}|${toActivityDateOnly(row.activity_date)}`;
    const list = byKey.get(key) ?? [];
    list.push(new Date(row.event_at));
    byKey.set(key, list);
  }

  return rows.map((row) => {
    const dateKey = toActivityDateOnly(row.activity_date);
    const key = `${row.user_id}|${dateKey}`;
    const activeSeconds = computeActiveSecondsFromTimestamps(byKey.get(key) ?? []);
    return {
      ...row,
      activity_date: dateKey,
      active_seconds: activeSeconds,
      active_duration_label: formatActiveDuration(activeSeconds),
    };
  });
}

export async function listUserActivityDailySummary(params: ListDailySummaryParams) {
  const page = Math.max(1, Number(params.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(params.limit) || 20));
  const offset = (page - 1) * limit;

  const { whereSql, values, nextIndex } = buildUserActivityWhere(params);
  let idx = nextIndex;

  const countResult = await query(
    `SELECT COUNT(*)::int AS total FROM (
       SELECT e.user_id, (e.event_at AT TIME ZONE 'UTC')::date AS activity_date
       FROM user_activity_events e
       JOIN users u ON u.id = e.user_id
       WHERE ${whereSql}
       GROUP BY e.user_id, (e.event_at AT TIME ZONE 'UTC')::date
     ) sub`,
    values,
  );
  const total = Number(countResult.rows[0]?.total ?? 0);

  // The cards above the table: the whole filtered period, not the page that is showing.
  const totalsResult = await query(
    `SELECT
       COUNT(DISTINCT e.user_id)::int AS users,
       COUNT(*)::int AS total_actions,
       COUNT(*) FILTER (WHERE e.event_type = 'CLICK')::int AS clicks,
       COUNT(*) FILTER (WHERE e.event_type IN ('CREATE', 'UPDATE', 'EDIT'))::int AS changes
     FROM user_activity_events e
     JOIN users u ON u.id = e.user_id
     WHERE ${whereSql}`,
    values,
  );
  const totals = totalsResult.rows[0] ?? {};

  const listResult = await query(
    `SELECT
       e.user_id,
       u.username,
       u.full_name,
       u.role,
       u.level,
       (SELECT array_agg(urs.region_site ORDER BY urs.region_site) FROM user_region_sites urs WHERE urs.user_id = e.user_id) AS region_sites,
       (e.event_at AT TIME ZONE 'UTC')::date AS activity_date,
       COUNT(*)::int AS total_count,
       COUNT(*) FILTER (WHERE e.event_type = 'CLICK')::int AS click_count,
       COUNT(*) FILTER (WHERE e.event_type = 'CREATE')::int AS create_count,
       COUNT(*) FILTER (WHERE e.event_type = 'UPDATE')::int AS update_count,
       COUNT(*) FILTER (WHERE e.event_type = 'EDIT')::int AS edit_count,
       COUNT(*) FILTER (WHERE e.event_type = 'VIEW')::int AS view_count
     FROM user_activity_events e
     JOIN users u ON u.id = e.user_id
     WHERE ${whereSql}
     GROUP BY e.user_id, u.username, u.full_name, u.role, u.level, (e.event_at AT TIME ZONE 'UTC')::date
     ORDER BY activity_date DESC, u.full_name ASC
     LIMIT $${idx++} OFFSET $${idx++}`,
    [...values, limit, offset],
  );

  const items = await attachActiveSeconds(listResult.rows);

  return {
    items,
    summary: {
      users: Number(totals.users ?? 0),
      total_actions: Number(totals.total_actions ?? 0),
      clicks: Number(totals.clicks ?? 0),
      changes: Number(totals.changes ?? 0),
      day_records: total,
    },
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
  };
}

export type UserActivityDetailRow = {
  id: string;
  event_type: string;
  page_path: string | null;
  action_label: string | null;
  entity_type: string | null;
  entity_id: string | null;
  metadata: Record<string, unknown> | null;
  event_at: string;
};

export async function listUserActivityDailyDetail(userId: string, activityDate: string) {
  const normalizedDate = toActivityDateOnly(activityDate);
  if (!normalizedDate) {
    return { summary: null, events: [] as UserActivityDetailRow[] };
  }

  const summaryResult = await query(
    `SELECT
       e.user_id,
       u.username,
       u.full_name,
       u.role,
       COUNT(*)::int AS total_count,
       COUNT(*) FILTER (WHERE e.event_type = 'CLICK')::int AS click_count,
       COUNT(*) FILTER (WHERE e.event_type = 'CREATE')::int AS create_count,
       COUNT(*) FILTER (WHERE e.event_type = 'UPDATE')::int AS update_count,
       COUNT(*) FILTER (WHERE e.event_type = 'EDIT')::int AS edit_count,
       COUNT(*) FILTER (WHERE e.event_type = 'VIEW')::int AS view_count
     FROM user_activity_events e
     JOIN users u ON u.id = e.user_id
     WHERE e.user_id = $1
       AND (e.event_at AT TIME ZONE 'UTC')::date = $2::date
     GROUP BY e.user_id, u.username, u.full_name, u.role`,
    [userId, normalizedDate],
  );

  const summaryRow = summaryResult.rows[0];
  if (!summaryRow) {
    return { summary: null, events: [] as UserActivityDetailRow[] };
  }

  const tsResult = await query(
    `SELECT event_at FROM user_activity_events
     WHERE user_id = $1 AND (event_at AT TIME ZONE 'UTC')::date = $2::date
     ORDER BY event_at ASC`,
    [userId, normalizedDate],
  );
  const activeSeconds = computeActiveSecondsFromTimestamps(
    tsResult.rows.map((r: { event_at: string }) => new Date(r.event_at)),
  );

  const eventsResult = await query(
    `SELECT id, event_type, page_path, action_label, entity_type, entity_id, metadata, event_at
     FROM user_activity_events
     WHERE user_id = $1 AND (event_at AT TIME ZONE 'UTC')::date = $2::date
     ORDER BY event_at DESC, id DESC`,
    [userId, normalizedDate],
  );

  return {
    summary: {
      user_id: summaryRow.user_id,
      username: summaryRow.username,
      full_name: summaryRow.full_name,
      role: summaryRow.role,
      activity_date: normalizedDate,
      total_count: Number(summaryRow.total_count),
      click_count: Number(summaryRow.click_count),
      create_count: Number(summaryRow.create_count),
      update_count: Number(summaryRow.update_count),
      edit_count: Number(summaryRow.edit_count),
      view_count: Number(summaryRow.view_count),
      active_seconds: activeSeconds,
      active_duration_label: formatActiveDuration(activeSeconds),
    },
    events: eventsResult.rows as UserActivityDetailRow[],
  };
}
