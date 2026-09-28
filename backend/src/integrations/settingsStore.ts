import { getClient, query } from '../database/connection';
import logger from '../utils/logger';
import { AuditService } from '../services/audit.service';
import {
  INTEGRATIONS,
  findIntegration,
  findSetting,
  secretHint,
  validateCrossField,
  validateSettingValue,
  type IntegrationDef,
  type IntegrationId,
  type SettingDef,
} from './registry';
import { integrationEnv, replaceIntegrationOverrides } from './integrationEnv';
import { isSecretBoxConfigured, openSecret, sealSecret } from './secretBox';

type Row = {
  integration: string;
  setting_key: string;
  is_secret: boolean;
  value_plain: string | null;
  value_encrypted: string | null;
  secret_hint: string | null;
  updated_by: string | null;
  updated_by_name: string | null;
  updated_at: string | null;
};

const contextFor = (integration: string, key: string) => `${integration}:${key}`;

/** Rows as last loaded - kept for describing, never for their plaintext. */
let loadedRows: Row[] = [];
/** Keys whose saved secret could not be decrypted. They fall back to .env, and the UI says so. */
const unreadable = new Map<string, string>();

async function fetchRows(): Promise<Row[]> {
  const res = await query(
    `SELECT s.integration, s.setting_key, s.is_secret, s.value_plain, s.value_encrypted,
            s.secret_hint, s.updated_by::text, s.updated_at::text,
            COALESCE(u.full_name, u.username) AS updated_by_name
       FROM integration_settings s
       LEFT JOIN users u ON u.id = s.updated_by`,
  );
  return res.rows as Row[];
}

/**
 * Load saved settings into integrationEnv. Called at boot, before SchedulerService registers the
 * DHM and JPS jobs, and again after every save.
 *
 * A secret that cannot be decrypted - master key missing or changed, row altered - is left out, so
 * that setting falls back to .env. It is logged by KEY only and flagged for the UI; failing the
 * whole load would take every integration down over one unreadable row.
 */
export async function loadIntegrationSettings(): Promise<void> {
  const rows = await fetchRows();
  const next = new Map<string, string>();
  unreadable.clear();
  for (const row of rows) {
    if (!row.is_secret) {
      if (row.value_plain !== null) next.set(row.setting_key, row.value_plain);
      continue;
    }
    try {
      next.set(
        row.setting_key,
        openSecret(String(row.value_encrypted), contextFor(row.integration, row.setting_key)),
      );
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'unreadable';
      unreadable.set(row.setting_key, reason);
      logger.error('Integration secret could not be read; falling back to .env', {
        integration: row.integration,
        key: row.setting_key,
        reason,
      });
    }
  }
  loadedRows = rows;
  replaceIntegrationOverrides(next);
}

export type SettingSource = 'database' | 'env' | 'unset';

export interface SettingView {
  key: string;
  label: string;
  kind: SettingDef['kind'];
  help?: string;
  requiresRestart: boolean;
  min?: number;
  prefix?: string;
  source: SettingSource;
  /** Plain value. Always null for secrets. */
  value: string | null;
  /** For secrets: prefix / last four / length. Never enough to use. */
  hint: string | null;
  updatedByName: string | null;
  updatedAt: string | null;
  /** Set when a saved secret exists but could not be decrypted. */
  error: string | null;
}

function viewOf(def: SettingDef, integration: IntegrationDef): SettingView {
  const row = loadedRows.find((r) => r.integration === integration.id && r.setting_key === def.key);
  const envValue = process.env[def.key];
  const hasEnv = envValue !== undefined && envValue !== '';
  const readable = Boolean(row) && !unreadable.has(def.key);
  const source: SettingSource = readable ? 'database' : hasEnv ? 'env' : 'unset';
  const isSecret = def.kind === 'secret';
  let hint: string | null = null;
  if (isSecret) {
    if (readable) hint = row?.secret_hint ?? null;
    else if (hasEnv) hint = secretHint(def, String(envValue));
  }
  return {
    key: def.key,
    label: def.label,
    kind: def.kind,
    help: def.help,
    requiresRestart: Boolean(def.requiresRestart),
    min: def.min,
    prefix: def.prefix,
    source,
    value: isSecret ? null : integrationEnv(def.key) ?? null,
    hint,
    updatedByName: readable ? row?.updated_by_name ?? null : null,
    updatedAt: readable ? row?.updated_at ?? null : null,
    error: unreadable.get(def.key) ?? null,
  };
}

export function describeIntegrations(): {
  secretsKeyConfigured: boolean;
  integrations: Array<{ id: IntegrationId; name: string; description: string; settings: SettingView[] }>;
} {
  return {
    secretsKeyConfigured: isSecretBoxConfigured(),
    integrations: INTEGRATIONS.map((i) => ({
      id: i.id,
      name: i.name,
      description: i.description,
      settings: i.settings.map((d) => viewOf(d, i)),
    })),
  };
}

export class IntegrationSettingsError extends Error {
  constructor(public readonly problems: string[]) {
    super(problems.join(' '));
  }
}

export interface SaveRequest {
  /** key -> new value. A secret is only ever written, never read back. */
  values?: Record<string, string>;
  /** keys to delete, so they fall back to .env. */
  revert?: string[];
}

/** What an audit entry records for a value: the value for plain settings, only the hint for secrets. */
function auditValue(def: SettingDef, value: string | undefined): string | null {
  if (value === undefined || value === '') return null;
  return def.kind === 'secret' ? secretHint(def, value) : value;
}

/**
 * Validate everything first, write in one transaction, reload, then audit.
 *
 * Nothing is written when any field fails - a half-applied key pair (new public key, old private
 * key) is exactly the state that breaks authentication.
 */
export async function saveIntegrationSettings(
  integrationId: string,
  request: SaveRequest,
  actor: { id: string; ip?: string; userAgent?: string },
): Promise<void> {
  const integration = findIntegration(integrationId);
  if (!integration) throw new IntegrationSettingsError([`Unknown integration "${integrationId}".`]);

  const values = request.values ?? {};
  const revert = request.revert ?? [];
  const problems: string[] = [];

  for (const key of [...Object.keys(values), ...revert]) {
    if (!findSetting(integration, key)) problems.push(`"${key}" is not a ${integration.name} setting.`);
  }
  for (const key of revert) {
    if (key in values) problems.push(`"${key}" cannot be both saved and reverted.`);
  }
  for (const [key, value] of Object.entries(values)) {
    const def = findSetting(integration, key);
    if (!def) continue;
    const problem = validateSettingValue(def, value);
    if (problem) problems.push(problem);
    if (def.kind === 'secret' && !isSecretBoxConfigured()) {
      problems.push(
        `${def.label} cannot be saved: INTEGRATION_SECRETS_KEY is not configured on the server.`,
      );
    }
  }

  // Cross-field rules judge the integration as it will be AFTER this save.
  const effective: Record<string, string | undefined> = {};
  for (const def of integration.settings) {
    if (def.key in values) effective[def.key] = values[def.key];
    else if (revert.includes(def.key)) effective[def.key] = process.env[def.key];
    else effective[def.key] = integrationEnv(def.key);
  }
  problems.push(...validateCrossField(integration.id, effective));

  if (problems.length > 0) throw new IntegrationSettingsError([...new Set(problems)]);

  const before: Record<string, string | null> = {};
  const after: Record<string, string | null> = {};
  for (const def of integration.settings) {
    if (def.key in values || revert.includes(def.key)) {
      before[def.key] = auditValue(def, integrationEnv(def.key));
      after[def.key] = auditValue(def, effective[def.key]);
    }
  }

  const client = await getClient();
  try {
    await client.query('BEGIN');
    for (const [key, value] of Object.entries(values)) {
      const def = findSetting(integration, key) as SettingDef;
      const isSecret = def.kind === 'secret';
      await client.query(
        `INSERT INTO integration_settings
           (integration, setting_key, is_secret, value_plain, value_encrypted, secret_hint, updated_by, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7::uuid, NOW())
         ON CONFLICT (integration, setting_key) DO UPDATE SET
           is_secret = EXCLUDED.is_secret,
           value_plain = EXCLUDED.value_plain,
           value_encrypted = EXCLUDED.value_encrypted,
           secret_hint = EXCLUDED.secret_hint,
           updated_by = EXCLUDED.updated_by,
           updated_at = NOW()`,
        [
          integration.id,
          key,
          isSecret,
          isSecret ? null : value,
          isSecret ? sealSecret(value, contextFor(integration.id, key)) : null,
          isSecret ? secretHint(def, value) : null,
          actor.id,
        ],
      );
    }
    if (revert.length > 0) {
      await client.query(
        `DELETE FROM integration_settings WHERE integration = $1 AND setting_key = ANY($2::text[])`,
        [integration.id, revert],
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }

  await loadIntegrationSettings();

  await AuditService.log({
    userId: actor.id,
    action: 'INTEGRATION_SETTINGS_UPDATE',
    entityType: `integration:${integration.id}`,
    beforeData: before,
    afterData: after,
    ipAddress: actor.ip,
    userAgent: actor.userAgent,
  });
}
