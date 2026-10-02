import cron from 'node-cron';

/**
 * Every setting the Integrations menu can change, per integration.
 *
 * `key` is the environment variable name the integration already reads. That is what lets the
 * database override .env without touching a single caller: dhm/config.ts and jps/config.ts ask for
 * the same name, and get the saved value when there is one.
 *
 * `requiresRestart` marks settings read ONCE at boot. The enabled flags and cron expressions decide
 * which jobs SchedulerService registers at startup; changing them afterwards has no effect until the
 * backend restarts. The UI says so next to the field rather than letting a save look like it worked.
 */
export type IntegrationId = 'dhm' | 'jps';

export type SettingKind = 'secret' | 'url' | 'boolean' | 'integer' | 'cron' | 'text';

export interface SettingDef {
  key: string;
  label: string;
  kind: SettingKind;
  help?: string;
  requiresRestart?: boolean;
  /** Minimum for integers - rejected below it rather than silently clamped, so the UI never lies. */
  min?: number;
  /** Public prefix a secret must carry, and that the hint may reveal (e.g. "dhm_sk_"). */
  prefix?: string;
}

export interface IntegrationDef {
  id: IntegrationId;
  name: string;
  description: string;
  settings: SettingDef[];
}

export const INTEGRATIONS: IntegrationDef[] = [
  {
    id: 'dhm',
    name: 'DHM - Data Hub Master',
    description: 'Master vessel sync and vessel webhooks.',
    settings: [
      { key: 'DHM_ENABLED', label: 'Enabled', kind: 'boolean', requiresRestart: true },
      { key: 'DHM_BASE_URL', label: 'Base URL', kind: 'url' },
      { key: 'DHM_PUBLIC_KEY', label: 'Public key', kind: 'text', prefix: 'dhm_pk_' },
      {
        key: 'DHM_PRIVATE_KEY',
        label: 'Private key',
        kind: 'secret',
        prefix: 'dhm_sk_',
        help: 'Begins with dhm_sk_. A key beginning with dhm_pk_ is the public key.',
      },
      { key: 'DHM_WEBHOOK_SECRET', label: 'Webhook secret', kind: 'secret' },
      { key: 'DHM_TIMEOUT_MS', label: 'Request timeout (ms)', kind: 'integer', min: 1000 },
      { key: 'DHM_SYNC_CRON', label: 'Sync schedule (cron)', kind: 'cron', requiresRestart: true },
    ],
  },
  {
    id: 'jps',
    name: 'JPS - Jetty Planning System',
    description: 'Shipping instructions for BONTANG, and their approval and berthing status.',
    settings: [
      { key: 'JPS_ENABLED', label: 'Enabled', kind: 'boolean', requiresRestart: true },
      { key: 'JPS_API_BASE_URL', label: 'API base URL', kind: 'url' },
      { key: 'JPS_API_KEY', label: 'API key', kind: 'secret' },
      {
        key: 'JPS_WEBHOOK_SECRET',
        label: 'Webhook secret',
        kind: 'secret',
        prefix: 'whsec_',
        help: 'Shown once by JPS when the webhook endpoint is registered; begins with whsec_. KLIP receives at /api/jps/webhooks.',
      },
      { key: 'JPS_REGION_SITE', label: 'Region / site', kind: 'text' },
      { key: 'JPS_SWEEP_CRON', label: 'Sweep schedule (cron)', kind: 'cron', requiresRestart: true },
      { key: 'JPS_TIMEOUT_MS', label: 'Request timeout (ms)', kind: 'integer', min: 1000 },
      {
        key: 'JPS_MIN_POLL_INTERVAL_MS',
        label: 'Min poll interval per instruction (ms)',
        kind: 'integer',
        min: 60_000,
        help: 'JPS allows at most one status poll per instruction every 5 minutes.',
      },
      { key: 'JPS_MAX_SUBMITS_PER_SWEEP', label: 'Max submits per sweep', kind: 'integer', min: 1 },
      {
        key: 'JPS_RETRY_FAILED',
        label: 'Retry failed submissions',
        kind: 'boolean',
        help: 'Testing only. Leave off in production.',
      },
      { key: 'JPS_RETRY_FAILED_AFTER_MS', label: 'Retry failed after (ms)', kind: 'integer', min: 60_000 },
    ],
  },
];

export function findIntegration(id: string): IntegrationDef | undefined {
  return INTEGRATIONS.find((i) => i.id === id);
}

export function findSetting(integration: IntegrationDef, key: string): SettingDef | undefined {
  return integration.settings.find((s) => s.key === key);
}

/** One field's problem, in words an ADMIN can act on. Null when the value is acceptable. */
export function validateSettingValue(def: SettingDef, raw: string): string | null {
  const value = String(raw ?? '');
  if (value.trim() === '') return `${def.label} cannot be empty. Use "revert to .env" to remove it instead.`;
  if (value !== value.trim()) return `${def.label} has leading or trailing spaces.`;
  switch (def.kind) {
    case 'boolean':
      return value === 'true' || value === 'false' ? null : `${def.label} must be true or false.`;
    case 'integer': {
      if (!/^\d+$/.test(value)) return `${def.label} must be a whole number.`;
      const n = Number(value);
      if (def.min !== undefined && n < def.min) return `${def.label} must be at least ${def.min}.`;
      return null;
    }
    case 'url':
      return /^https?:\/\/[^\s/$.?#].[^\s]*$/i.test(value) ? null : `${def.label} must be an http(s) URL.`;
    case 'cron':
      return cron.validate(value) ? null : `${def.label} is not a valid cron expression.`;
    case 'secret':
    case 'text':
      if (/\s/.test(value)) return `${def.label} must not contain spaces or line breaks.`;
      /*
       * Printable ASCII only. A key copied out of a chat app can carry a zero-width space or a
       * similar invisible character: \s does not match it, the prefix still checks out, the field
       * looks right - and the remote system rejects the key. Only the length gives it away.
       */
      if (/[^\x21-\x7E]/.test(value)) {
        return `${def.label} contains an invisible or non-ASCII character, usually from copying out of a chat app. Retype it, or paste it as plain text.`;
      }
      if (def.prefix && !value.startsWith(def.prefix)) {
        return `${def.label} must begin with ${def.prefix}.${def.help ? ` ${def.help}` : ''}`;
      }
      return null;
    default:
      return null;
  }
}

/**
 * Rules that span two fields, checked against the values the integration WILL have after the save
 * (saved values merged over what it has now).
 *
 * The DHM pair is the reason this exists: on 2026-09-28 the public key was pasted into both
 * fields. Each value was individually well-formed; only comparing them shows the mistake.
 */
export function validateCrossField(
  integration: IntegrationId,
  effective: Record<string, string | undefined>,
): string[] {
  const errors: string[] = [];
  if (integration === 'dhm') {
    const pub = effective.DHM_PUBLIC_KEY;
    const priv = effective.DHM_PRIVATE_KEY;
    if (pub && priv && pub === priv) {
      errors.push('Public key and private key are identical - the private key begins with dhm_sk_.');
    }
  }
  return errors;
}

/**
 * What the UI shows instead of a secret: the registry's public prefix when the value carries it,
 * the last four characters, and the length. Enough to tell two keys apart and to spot the wrong one
 * pasted, not enough to use.
 */
export function secretHint(def: SettingDef, value: string): string {
  const prefix = def.prefix && value.startsWith(def.prefix) ? def.prefix : '';
  const tail = value.length > 8 ? value.slice(-4) : '';
  return `${prefix}...${tail} (${value.length})`;
}
