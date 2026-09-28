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
    const r = await jpsRequest<unknown>({ method: 'GET', url: '/terms' }, { requireEnabled: false });
    result = r.ok
      ? { ok: true, message: 'Authenticated - JPS returned the trade-terms list.' }
      : { ok: false, message: `${r.code}: ${r.message}` };
  }
  res.json({ success: true, data: { ...result, elapsedMs: Date.now() - startedAt } });
};
