import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth';
import logger from '../utils/logger';
import {
  IntegrationSettingsError,
  describeIntegrations,
  saveIntegrationSettings,
} from '../integrations/settingsStore';
import { findIntegration } from '../integrations/registry';
import { verifyDhmCredentials } from '../dhm/client';
import { jpsRequest } from '../jps/client';
import { JPS_CALL_KINDS } from '../jps/callLog';
import { DHM_CALL_KINDS } from '../dhm/callLog';
import { API_CALL_TABLES, isApiCallIntegration, type ApiCallIntegration } from '../integrations/apiCallLog';
import { query } from '../database/connection';

/**
 * Integrations menu (ADMIN only). Secrets are write-only: no response from this controller ever
 * carries one - GET returns hints, PUT returns the same view as GET, and the connection test
 * reports only whether authentication worked.
 */
export const getIntegrations = async (_req: AuthRequest, res: Response): Promise<void> => {
  res.json({ success: true, data: describeIntegrations() });
};

export const updateIntegration = async (req: AuthRequest, res: Response): Promise<void> => {
  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({ success: false, error: { message: 'Not authenticated' } });
    return;
  }
  const body = (req.body ?? {}) as { values?: unknown; revert?: unknown };
  const values =
    body.values && typeof body.values === 'object' && !Array.isArray(body.values)
      ? Object.fromEntries(
          Object.entries(body.values as Record<string, unknown>).map(([k, v]) => [k, String(v ?? '')]),
        )
      : {};
  const revert = Array.isArray(body.revert) ? body.revert.map((k) => String(k)) : [];

  try {
    await saveIntegrationSettings(
      req.params.id,
      { values, revert },
      { id: userId, ip: req.ip, userAgent: req.get('user-agent') ?? undefined },
    );
    res.json({ success: true, data: describeIntegrations() });
  } catch (error) {
    if (error instanceof IntegrationSettingsError) {
      res.status(400).json({ success: false, error: { message: 'Not saved.', problems: error.problems } });
      return;
    }
    // Log the integration and keys only - the body may hold a secret.
    logger.error('Failed to save integration settings', {
      integration: req.params.id,
      keys: [...Object.keys(values), ...revert],
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ success: false, error: { message: 'Failed to save integration settings.' } });
  }
};

/**
 * Can KLIP authenticate right now, with the settings it would actually use?
 *
 * DHM asks for a fresh token; JPS reads its trade-terms list, the cheapest authenticated call it
 * offers. Neither requires the integration to be enabled, so a new key can be checked first.
 */
export const testIntegration = async (req: AuthRequest, res: Response): Promise<void> => {
  const integration = findIntegration(req.params.id);
  if (!integration) {
    res.status(404).json({ success: false, error: { message: 'Unknown integration.' } });
    return;
  }
  const startedAt = Date.now();
  let result: { ok: boolean; message: string };
  if (integration.id === 'dhm') {
    result = await verifyDhmCredentials();
  } else {
    const r = await jpsRequest<unknown>(
      { method: 'GET', url: '/terms' },
      { requireEnabled: false, audit: { kind: 'test' } },
    );
    result = r.ok
      ? { ok: true, message: 'Authenticated - JPS returned the trade-terms list.' }
      : { ok: false, message: `${r.code}: ${r.message}` };
  }
  res.json({ success: true, data: { ...result, elapsedMs: Date.now() - startedAt } });
};

const KINDS_BY_INTEGRATION: Record<ApiCallIntegration, readonly string[]> = {
  jps: JPS_CALL_KINDS,
  dhm: DHM_CALL_KINDS,
};

/** The integration named in the path, or a 404: only jps and dhm have a history, and the name goes into SQL. */
function callIntegration(req: AuthRequest, res: Response): ApiCallIntegration | null {
  const id = req.params.id;
  if (isApiCallIntegration(id)) return id;
  res.status(404).json({ success: false, error: { message: 'Unknown integration.' } });
  return null;
}

/**
 * Integrations > JPS | DHM > History: what KLIP sent and what came back, newest first. The list leaves the bodies out
 * (they can be large); one row's bodies come from getApiCall.
 *
 * `subject` is the STO key (JPS) or the slug (DHM), `reference` the external reference (JPS) or the record code (DHM).
 * `q` matches those two and the other system's request id, the things a person has in hand when tracing a call.
 */
export const listApiCalls = async (req: AuthRequest, res: Response): Promise<void> => {
  const integration = callIntegration(req, res);
  if (!integration) return;
  const t = API_CALL_TABLES[integration];
  try {
    const limit = Math.min(200, Math.max(1, Math.trunc(Number(req.query.limit)) || 50));
    const offset = Math.max(0, Math.trunc(Number(req.query.offset)) || 0);
    const kind = String(req.query.kind ?? '').trim();
    const ok = String(req.query.ok ?? '').trim();
    const search = String(req.query.q ?? '').trim();

    const where: string[] = [];
    const params: unknown[] = [];
    if (kind && KINDS_BY_INTEGRATION[integration].includes(kind)) {
      params.push(kind);
      where.push(`kind = $${params.length}`);
    }
    if (ok === 'true' || ok === 'false') {
      params.push(ok === 'true');
      where.push(`ok = $${params.length}`);
    }
    if (search) {
      params.push(`%${search}%`);
      where.push(
        `(${t.subject} ILIKE $${params.length} OR ${t.reference} ILIKE $${params.length} OR request_id ILIKE $${params.length})`,
      );
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const columns = `id, created_at, kind, method, url, ${t.subject} AS subject, ${t.reference} AS reference,
      response_status, ok, error_code, error_message, request_id, duration_ms`;

    const [rows, count] = await Promise.all([
      query(
        `SELECT ${columns} FROM ${t.table} ${clause}
         ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset],
      ),
      query(`SELECT COUNT(*) AS count FROM ${t.table} ${clause}`, params),
    ]);
    res.json({
      success: true,
      data: {
        items: rows.rows,
        pagination: { total: parseInt(String(count.rows[0]?.count ?? '0'), 10), limit, offset },
      },
    });
  } catch (error) {
    logger.error(`List ${integration} calls error:`, error);
    res.status(500).json({ success: false, error: { message: 'Failed to load the call history.' } });
  }
};

export const getApiCall = async (req: AuthRequest, res: Response): Promise<void> => {
  const integration = callIntegration(req, res);
  if (!integration) return;
  const t = API_CALL_TABLES[integration];
  const id = String(req.params.callId ?? '');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    res.status(404).json({ success: false, error: { message: 'Call not found.' } });
    return;
  }
  try {
    const result = await query(
      `SELECT *, ${t.subject} AS subject, ${t.reference} AS reference FROM ${t.table} WHERE id = $1::uuid`,
      [id],
    );
    if (result.rows.length === 0) {
      res.status(404).json({ success: false, error: { message: 'Call not found.' } });
      return;
    }
    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    logger.error(`Get ${integration} call error:`, error);
    res.status(500).json({ success: false, error: { message: 'Failed to load the call.' } });
  }
};
