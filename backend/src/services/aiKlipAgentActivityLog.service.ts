import { query } from '../database/connection';
import logger from '../utils/logger';
import { truncateActivityText } from '../constants/aiKlipAgent';

export type AiKlipAgentActivityStatus = 'success' | 'error';

export type LogAiKlipAgentActivityInput = {
  agentName: string;
  apiKeyName: string;
  activity: string;
  userId?: string | null;
  status?: AiKlipAgentActivityStatus;
  metadata?: Record<string, unknown> | null;
  activityAt?: Date;
};

export async function logAiKlipAgentActivity(input: LogAiKlipAgentActivityInput): Promise<void> {
  try {
    await query(
      `INSERT INTO ai_klip_agent_activity_logs (
         agent_name, api_key_name, activity, activity_at, created_by, status, metadata
       ) VALUES ($1, $2, $3, COALESCE($4, CURRENT_TIMESTAMP), $5, $6, $7::jsonb)`,
      [
        input.agentName,
        input.apiKeyName,
        truncateActivityText(input.activity, 2000),
        input.activityAt ?? null,
        input.userId ?? null,
        input.status ?? 'success',
        input.metadata ? JSON.stringify(input.metadata) : null,
      ],
    );
  } catch (error) {
    logger.warn('Failed to write AI Klip Agent activity log', { error, agentName: input.agentName });
  }
}

export type ListAiKlipAgentActivityParams = {
  dateFrom?: string;
  dateTo?: string;
  agentName?: string;
  page?: number;
  limit?: number;
};

export async function listAiKlipAgentActivityLogs(params: ListAiKlipAgentActivityParams) {
  const page = Math.max(1, Number(params.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(params.limit) || 20));
  const offset = (page - 1) * limit;

  const conditions: string[] = ['1=1'];
  const values: unknown[] = [];
  let idx = 1;

  if (params.dateFrom) {
    conditions.push(`l.activity_at::date >= $${idx++}::date`);
    values.push(params.dateFrom);
  }
  if (params.dateTo) {
    conditions.push(`l.activity_at::date <= $${idx++}::date`);
    values.push(params.dateTo);
  }
  if (params.agentName) {
    conditions.push(`l.agent_name = $${idx++}`);
    values.push(params.agentName);
  }

  const whereSql = conditions.join(' AND ');

  const countResult = await query(
    `SELECT COUNT(*)::int AS total
     FROM ai_klip_agent_activity_logs l
     WHERE ${whereSql}`,
    values,
  );
  const total = Number(countResult.rows[0]?.total ?? 0);

  const listResult = await query(
    `SELECT
       l.id,
       l.agent_name,
       l.api_key_name,
       l.activity,
       l.activity_at,
       l.status,
       l.created_by,
       u.username AS created_by_username
     FROM ai_klip_agent_activity_logs l
     LEFT JOIN users u ON u.id = l.created_by
     WHERE ${whereSql}
     ORDER BY l.activity_at DESC, l.id DESC
     LIMIT $${idx++} OFFSET $${idx++}`,
    [...values, limit, offset],
  );

  return {
    items: listResult.rows,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
  };
}

export async function listAiKlipAgentNames(): Promise<string[]> {
  const result = await query(
    `SELECT DISTINCT agent_name
     FROM ai_klip_agent_activity_logs
     ORDER BY agent_name ASC`,
  );
  return result.rows.map((row: { agent_name: string }) => String(row.agent_name));
}
