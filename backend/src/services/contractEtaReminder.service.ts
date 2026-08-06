import { query } from '../database/connection';
import logger from '../utils/logger';
import { frontendUrl } from './sessionAuth.service';
import { sendEmail } from './email.service';
import {
  buildContractEtaReminderEmailHtml,
  buildContractEtaReminderEmailSubject,
  type ContractEtaReminderRow,
} from './contractEtaReminderEmail.template';
import { buildContractsMissingEtaNearCargoReadinessSql } from '../utils/missingEtaAlertSql';

/**
 * Open contracts whose Cargo Readiness Date is within
 * {@link MISSING_ETA_ALERT_CARGO_READINESS_WINDOW_DAYS} days (or already passed) but still have
 * no ETA on their Shipment (SEA) and/or Trucking (LAND/MIX) record.
 *
 * - "No ETA" for SEA mirrors the canonical "loading_no_eta" definition used elsewhere
 *   (all 5 loading ETA columns on `shipments` are null).
 * - "No ETA" for LAND uses the closest analogue on `trucking_operations`: the delivery/trucking
 *   planning window columns are all null.
 * - `transport_mode` gates which check applies (SEA / LAND / MIX checks both).
 */
export async function findContractsMissingEtaNearCargoReadiness(): Promise<ContractEtaReminderRow[]> {
  const result = await query(buildContractsMissingEtaNearCargoReadinessSql());
  return result.rows as ContractEtaReminderRow[];
}

export interface ContractEtaReminderRecipient {
  email: string;
  full_name: string | null;
}

/** Active LOGISTICS users above Staff level (Dept Head / Section Head / Admin level). */
export async function findEtaReminderRecipients(): Promise<ContractEtaReminderRecipient[]> {
  const result = await query(
    `SELECT email, full_name
     FROM users
     WHERE is_active = true
       AND UPPER(TRIM(role)) = 'LOGISTICS'
       AND level IS NOT NULL
       AND UPPER(TRIM(level)) <> 'STAFF'`,
  );
  return result.rows as ContractEtaReminderRecipient[];
}

/**
 * Extra recipients for testing/UAT, comma/semicolon-separated in `CONTRACT_ETA_REMINDER_EXTRA_RECIPIENTS`.
 * Only set on SIT (see docker-compose.backend.yml) — left empty for local/production so the
 * distribution list stays DB-driven there.
 */
function resolveExtraTestRecipients(): ContractEtaReminderRecipient[] {
  const raw = String(process.env.CONTRACT_ETA_REMINDER_EXTRA_RECIPIENTS || '');
  return raw
    .split(/[,;]/)
    .map((email) => email.trim())
    .filter(Boolean)
    .map((email) => ({ email, full_name: null }));
}

/** DB recipients + any extra test recipients, deduped by email (case-insensitive). */
function mergeRecipients(
  dbRecipients: ContractEtaReminderRecipient[],
  extraRecipients: ContractEtaReminderRecipient[],
): ContractEtaReminderRecipient[] {
  const merged = [...dbRecipients];
  const seen = new Set(dbRecipients.map((r) => r.email.trim().toLowerCase()));
  for (const extra of extraRecipients) {
    const key = extra.email.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push(extra);
  }
  return merged;
}

export interface ContractEtaReminderJobResult {
  sent: boolean;
  contractCount: number;
  recipientCount: number;
  recipients: string[];
  skipReason?: string;
}

export interface RunContractEtaReminderJobOptions {
  /** When set, these addresses are merged into (or replace) the normal recipient list. */
  overrideRecipients?: string[];
  /** When true with overrideRecipients, only send to override list (for manual test runs). */
  recipientsOnly?: boolean;
}

/**
 * Finds contracts missing ETA near their Cargo Readiness Date and emails the Logistics
 * distribution list. Never throws — logs and returns on any failure so the daily cron
 * never crashes the scheduler.
 */
export async function runContractEtaReminderJob(
  options: RunContractEtaReminderJobOptions = {},
): Promise<ContractEtaReminderJobResult> {
  const emptyResult = (
    skipReason: string,
    contractCount = 0,
    recipients: string[] = [],
  ): ContractEtaReminderJobResult => ({
    sent: false,
    contractCount,
    recipientCount: recipients.length,
    recipients,
    skipReason,
  });

  try {
    const rows = await findContractsMissingEtaNearCargoReadiness();
    if (rows.length === 0) {
      logger.info('Contract ETA reminder: no contracts match, skipping email');
      return emptyResult('no_matching_contracts');
    }

    const overrideRecipients = (options.overrideRecipients ?? [])
      .map((email) => email.trim())
      .filter(Boolean)
      .map((email) => ({ email, full_name: null as string | null }));

    let recipients: ContractEtaReminderRecipient[];
    if (options.recipientsOnly && overrideRecipients.length > 0) {
      recipients = overrideRecipients;
    } else {
      const dbRecipients = await findEtaReminderRecipients();
      recipients = mergeRecipients(
        dbRecipients,
        [...resolveExtraTestRecipients(), ...overrideRecipients],
      );
    }

    if (recipients.length === 0) {
      logger.warn('Contract ETA reminder: no eligible recipients found, skipping email', {
        contractCount: rows.length,
      });
      return emptyResult('no_recipients', rows.length);
    }

    const recipientEmails = recipients.map((r) => r.email);
    const html = buildContractEtaReminderEmailHtml(rows, frontendUrl());
    const subject = buildContractEtaReminderEmailSubject(rows);
    const sent = await sendEmail({
      to: recipientEmails,
      subject,
      html,
    });

    if (sent) {
      logger.info('Contract ETA reminder email sent', {
        contractCount: rows.length,
        recipientCount: recipients.length,
      });
    }

    return {
      sent,
      contractCount: rows.length,
      recipientCount: recipients.length,
      recipients: recipientEmails,
      skipReason: sent ? undefined : 'smtp_send_failed',
    };
  } catch (error) {
    logger.error('Contract ETA reminder job failed', error);
    return emptyResult('job_error');
  }
}
