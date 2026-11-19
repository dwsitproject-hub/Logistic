/**
 * The email rules of Submit to Jetty, one per discharge port plus a default (table jps_notify_rules, migration 271; edited in Integrations > JPS > Email notifications).
 *
 * Which rule applies to a shipment: the one of ITS discharge Master Port when it has one (even when that rule is switched off: that port then sends nothing),
 * otherwise the default rule. Pure choosing logic is kept apart from the queries so it is tested without a database.
 */
import { query } from '../database/connection';
import { parseEmailList } from '../integrations/registry';

export interface NotifyRule {
  id: string;
  /** Master Port name in upper case (e.g. "PORT BONTANG"); null = the default rule. */
  port: string | null;
  enabled: boolean;
  emailTo: string;
  emailCc: string;
  subject: string;
  body: string;
  updatedAt: string | null;
}

export interface NotifyRuleInput {
  port: string | null;
  enabled: boolean;
  emailTo: string;
  emailCc: string;
  subject: string;
  body: string;
}

type RuleRow = {
  id: string;
  port: string | null;
  enabled: boolean;
  email_to: string;
  email_cc: string;
  subject: string;
  body: string;
  updated_at: Date | string | null;
};

const SELECT_RULE = `SELECT id, port, enabled, email_to, email_cc, subject, body, updated_at FROM jps_notify_rules`;

function toRule(r: RuleRow): NotifyRule {
  return {
    id: String(r.id),
    port: r.port == null ? null : String(r.port),
    enabled: Boolean(r.enabled),
    emailTo: String(r.email_to ?? ''),
    emailCc: String(r.email_cc ?? ''),
    subject: String(r.subject ?? ''),
    body: String(r.body ?? ''),
    updatedAt: r.updated_at == null ? null : new Date(r.updated_at).toISOString(),
  };
}

export function normalizeRulePort(raw: unknown): string | null {
  const port = String(raw ?? '').trim().replace(/\s+/g, ' ').toUpperCase();
  return port === '' ? null : port;
}

/** The rule that applies to a discharge Master Port (upper case, or empty when unknown): its own rule, else the default; null when there is none. */
export function chooseNotifyRule(rules: NotifyRule[], masterPort: string | null | undefined): NotifyRule | null {
  const port = normalizeRulePort(masterPort);
  if (port) {
    const own = rules.find((r) => r.port === port);
    if (own) return own;
  }
  return rules.find((r) => r.port === null) ?? null;
}

/** What is wrong with a rule a person typed, in words they can act on; empty when it is acceptable. */
export function validateNotifyRule(input: NotifyRuleInput): string[] {
  const problems: string[] = [];
  const to = parseEmailList(input.emailTo);
  const cc = parseEmailList(input.emailCc);
  if (to.invalid.length > 0) problems.push(`Email to has an address that is not valid: ${to.invalid.slice(0, 3).join(', ')}.`);
  if (cc.invalid.length > 0) problems.push(`Email cc has an address that is not valid: ${cc.invalid.slice(0, 3).join(', ')}.`);
  if (to.valid.length + cc.valid.length > 200) problems.push('More than 200 addresses in all.');
  if (input.enabled && to.valid.length === 0) problems.push('A rule that is switched on needs at least one address in Email to.');
  if (input.subject.length > 500) problems.push('The subject is longer than 500 characters.');
  if (/[\r\n]/.test(input.subject)) problems.push('The subject must be on one line.');
  if (input.body.length > 8000) problems.push('The body is longer than 8000 characters.');
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(input.subject + input.body)) problems.push('The subject or body has a control character.');
  if (input.port !== null && input.port.length > 255) problems.push('The port name is too long.');
  return problems;
}

/** Trims what a text box leaves at the ends and settles line breaks, so a stray newline never fails a save or reaches a mail. */
export function cleanNotifyRuleInput(raw: Partial<Record<keyof NotifyRuleInput, unknown>>): NotifyRuleInput {
  const text = (v: unknown) => String(v ?? '').replace(/\r\n/g, '\n').trim();
  return {
    port: normalizeRulePort(raw.port),
    enabled: raw.enabled === true || raw.enabled === 'true',
    emailTo: text(raw.emailTo),
    emailCc: text(raw.emailCc),
    subject: text(raw.subject),
    body: text(raw.body),
  };
}

export async function listNotifyRules(): Promise<NotifyRule[]> {
  const res = await query(`${SELECT_RULE} ORDER BY (port IS NULL) DESC, port`);
  return (res.rows as RuleRow[]).map(toRule);
}

/** Create or replace the rule of a port (null = the default). */
export async function saveNotifyRule(input: NotifyRuleInput, userId: string | null): Promise<NotifyRule> {
  const res = await query(
    `INSERT INTO jps_notify_rules (port, enabled, email_to, email_cc, subject, body, updated_by, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7::uuid, NOW())
     ON CONFLICT ((COALESCE(port, ''))) DO UPDATE SET
       enabled = EXCLUDED.enabled, email_to = EXCLUDED.email_to, email_cc = EXCLUDED.email_cc,
       subject = EXCLUDED.subject, body = EXCLUDED.body, updated_by = EXCLUDED.updated_by, updated_at = NOW()
     RETURNING id, port, enabled, email_to, email_cc, subject, body, updated_at`,
    [input.port, input.enabled, input.emailTo, input.emailCc, input.subject, input.body, userId],
  );
  return toRule(res.rows[0] as RuleRow);
}

/** Delete a port's own rule; the default (null port) cannot be deleted. Returns whether a row went. */
export async function deleteNotifyRule(id: string): Promise<boolean> {
  const res = await query(`DELETE FROM jps_notify_rules WHERE id = $1::uuid AND port IS NOT NULL`, [id]);
  return (res.rowCount ?? 0) > 0;
}
