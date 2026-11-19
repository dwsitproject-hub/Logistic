import cron from 'node-cron';
import { validateJpsPortsValue } from '../jps/ports';

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
export type IntegrationId = 'dhm' | 'jps' | 'kmaps';

export type SettingKind = 'secret' | 'url' | 'boolean' | 'integer' | 'cron' | 'text' | 'ports' | 'emails' | 'message';

export interface SettingDef {
  key: string;
  label: string;
  kind: SettingKind;
  help?: string;
  requiresRestart?: boolean;
  /** Minimum for integers - rejected below it rather than silently clamped, so the UI never lies. */
  min?: number;
  /** For a 'message': how many lines the editor shows (1 = a single-line input). */
  rows?: number;
  /** Public prefix a secret must carry, and that the hint may reveal (e.g. "dhm_sk_"). */
  prefix?: string;
  /**
   * A secret KLIP only has to CHECK (the key a partner presents to KLIP), not use. It is typed in like any secret, but what is stored is its scrypt hash
   * (secretHash.ts), sealed like the others. The environment value the code reads is therefore the hash, never the key.
   */
  hashOnStore?: boolean;
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
    description: 'Shipping instructions for the ports switched on below, and their approval and berthing status.',
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
      {
        key: 'JPS_PORTS',
        label: 'Ports',
        kind: 'ports',
        help: 'The Master Ports shipments are sent to JPS for, each with a switch. JPS knows a port by its DHM code and has no site or region, so a shipment is sent when its discharge port is switched on here. A port must be synced with DHM (it has a DHM code) before it can be switched on, and JPS must have set it up first. No port is built into KLIP: with none switched on, nothing is sent.',
      },
      { key: 'JPS_SWEEP_CRON', label: 'Sweep schedule (cron)', kind: 'cron', requiresRestart: true },
      { key: 'JPS_TIMEOUT_MS', label: 'Request timeout (ms)', kind: 'integer', min: 1000 },
      {
        key: 'JPS_MIN_POLL_INTERVAL_MS',
        label: 'Min poll interval per instruction (ms)',
        kind: 'integer',
        min: 60_000,
        help: 'JPS allows at most one status poll per instruction every 5 minutes.',
      },
      {
        key: 'JPS_AUTO_SUBMIT',
        label: 'Send automatically',
        kind: 'boolean',
        help: 'Off unless set to true. When off, nothing is sent to JPS on its own (not after a SAP import, a shipment edit or on the schedule): a user presses Submit to Jetty on the shipment. Instructions already at JPS are still polled for their status and amended while Pending. Takes effect at once.',
      },
      { key: 'JPS_MAX_SUBMITS_PER_SWEEP', label: 'Max submits per sweep', kind: 'integer', min: 1 },
      {
        key: 'JPS_NOTIFY_ENABLED',
        label: 'Email after Submit to Jetty',
        kind: 'boolean',
        help: 'When on, an email goes to the addresses below each time a user presses Submit to Jetty and JPS accepts it (Pending). Off unless set to true. Only the button sends it, not the automatic sweep.',
      },
      {
        key: 'JPS_NOTIFY_TO',
        label: 'Email to',
        kind: 'emails',
        help: 'Recipients, separated by commas or line breaks. Nothing is sent while this is empty. The mail server is the one KLIP already uses (SMTP_* in .env).',
      },
      { key: 'JPS_NOTIFY_CC', label: 'Email cc', kind: 'emails', help: 'Copied recipients, same format. Leave empty (revert to .env) for none.' },
      {
        key: 'JPS_NOTIFY_SUBJECT',
        label: 'Email subject',
        kind: 'message',
        rows: 1,
        help: 'Placeholders: {vessel} {commodity} {shipper} {loading_port} {discharge_port} {qty_kg} {eta} {incoterm} {sto_number} {revision} {revision_note}. {revision_note} is empty on the first submission and reads " (Revisi R2)" on a resubmission. Empty = the built-in subject.',
      },
      {
        key: 'JPS_NOTIFY_BODY',
        label: 'Email body',
        kind: 'message',
        rows: 14,
        help: 'Plain text with the same placeholders as the subject, plus {po_table} (the Shipper / Kontrak / PO / Qty table with its total). Line breaks are kept. Empty = the built-in body.',
      },
      {
        key: 'JPS_RETRY_FAILED',
        label: 'Retry failed submissions',
        kind: 'boolean',
        help: 'Testing only. Leave off in production.',
      },
      { key: 'JPS_RETRY_FAILED_AFTER_MS', label: 'Retry failed after (ms)', kind: 'integer', min: 60_000 },
    ],
  },
  {
    id: 'kmaps',
    name: 'KMAPS - KPN Downstream Maps',
    description:
      'KMAPS reads shipments and vessel pairs from KLIP (partner API at /api/partner/v1). The keys are issued by KMAPS: paste them here once. KLIP keeps only a hash of the private key. The access key is the reverse direction: KLIP asks KMAPS which shipments can be shown on the map.',
    settings: [
      {
        key: 'KMAPS_ENABLED',
        label: 'Enabled',
        kind: 'boolean',
        help: 'Takes effect at once. When off, KMAPS gets 403 application_disabled at /auth/token and its tokens stop working, and the Shipments table keeps View Documents.',
      },
      { key: 'KMAPS_PUBLIC_KEY', label: 'Public key', kind: 'text', prefix: 'kmaps_pk_' },
      {
        key: 'KMAPS_PRIVATE_KEY',
        label: 'Private key',
        kind: 'secret',
        prefix: 'kmaps_sk_',
        hashOnStore: true,
        help: 'Begins with kmaps_sk_. Shown once by KMAPS. KLIP stores only a hash, so it cannot be shown again; saving a new one replaces the old one and ends every token issued under it.',
      },
      {
        key: 'KMAPS_WEBHOOK_URL',
        label: 'Webhook URL',
        kind: 'url',
        help: 'Where KLIP rings the bell when a shipment changes. The last path segment is the slug the KMAPS admin chose for KLIP, e.g. http://172.28.92.56:3120/api/v1/webhooks/klip. Empty = no bell (KMAPS still polls). The bell carries no data and no price.',
      },
      {
        key: 'KMAPS_WEBHOOK_SECRET',
        label: 'Webhook secret',
        kind: 'secret',
        prefix: 'whsec_',
        help: 'Issued by KMAPS together with the keys; begins with whsec_. Signs every bell.',
      },
      {
        key: 'KMAPS_EMBED_URL',
        label: 'Map (embed) URL',
        kind: 'url',
        help: 'Where the KMAPS map opens in a frame, e.g. http://test-kmaps.kpndomain.com (only the scheme, host and port are used). The same origin is used to call GET /api/v1/embed/available. It must be on the same site and scheme as KLIP, and KMAPS must allow-list the KLIP origin as a frame parent.',
      },
      {
        key: 'KMAPS_ACCESS_KEY',
        label: 'Access key (embed available)',
        kind: 'secret',
        prefix: 'kmaps_ak_',
        help: 'Issued once in KMAPS Setting > Integrasi on the KLIP card (Terbitkan kunci akses). Begins with kmaps_ak_. KLIP sends it as Authorization: Bearer when asking which shipments can be shown on the map. Independent of the public/private key pair. Empty = the Shipments table keeps View Documents until this is saved.',
      },
    ],
  },
];

/** Splits a recipient list typed as commas, semicolons or line breaks, and sorts the entries into valid addresses and the rest. */
export function parseEmailList(raw: string | null | undefined): { valid: string[]; invalid: string[] } {
  const valid: string[] = [];
  const invalid: string[] = [];
  for (const part of String(raw ?? '').split(/[,;\r\n]+/)) {
    const addr = part.trim();
    if (!addr) continue;
    if (/^[^\s@<>(),;:"\[\]]+@[^\s@<>(),;:"\[\]]+\.[^\s@<>(),;:"\[\]]+$/.test(addr)) {
      if (!valid.some((v) => v.toLowerCase() === addr.toLowerCase())) valid.push(addr);
    } else invalid.push(addr);
  }
  return { valid, invalid };
}

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
    case 'ports':
      return validateJpsPortsValue(value);
    case 'emails': {
      const parsed = parseEmailList(value);
      if (parsed.invalid.length > 0) return `${def.label} has an address that is not valid: ${parsed.invalid.slice(0, 3).join(', ')}.`;
      if (parsed.valid.length === 0) return `${def.label} has no address.`;
      if (parsed.valid.length > 200) return `${def.label} has more than 200 addresses.`;
      return null;
    }
    case 'message':
      // Any text, Indonesian included, with line breaks; only control characters (other than tab and line breaks) and absurd lengths are refused.
      if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value)) return `${def.label} contains a control character.`;
      if (value.length > 8000) return `${def.label} is longer than 8000 characters.`;
      return null;
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
