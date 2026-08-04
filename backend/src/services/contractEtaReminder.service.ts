import { query } from '../database/connection';
import logger from '../utils/logger';
import { SQL_CONTRACT_IMPORT_STATUS, sqlContractImportStatusIsOpenExpr } from '../utils/contractDeliveryStatus';
import { frontendUrl } from './sessionAuth.service';
import { sendEmail } from './email.service';
import {
  buildContractEtaReminderEmailHtml,
  buildContractEtaReminderEmailSubject,
  type ContractEtaReminderRow,
} from './contractEtaReminderEmail.template';

/**
 * Open contracts whose Cargo Readiness Date is within 7 days (or already passed) but still have
 * no ETA on their Shipment (SEA) and/or Trucking (LAND/MIX) record.
 *
 * - "No ETA" for SEA mirrors the canonical "loading_no_eta" definition used elsewhere
 *   (all 5 loading ETA columns on `shipments` are null).
 * - "No ETA" for LAND uses the closest analogue on `trucking_operations`: the delivery/trucking
 *   planning window columns are all null.
 * - `transport_mode` gates which check applies (SEA / LAND / MIX checks both).
 */
export async function findContractsMissingEtaNearCargoReadiness(): Promise<ContractEtaReminderRow[]> {
  const sql = `
    WITH candidates AS (
      SELECT
        c.id,
        c.contract_id,
        (
          SELECT COALESCE(spd.data->'raw'->>'Contract Ext No', spd.data->>'Contract Ext No')
          FROM sap_processed_data spd
          WHERE spd.contract_number = c.contract_id
          ORDER BY spd.created_at DESC NULLS LAST
          LIMIT 1
        ) AS contract_ext_no,
        c.po_number,
        c.supplier,
        c.product,
        c.incoterm,
        c.transport_mode,
        TO_CHAR(c.cargo_readiness_date, 'YYYY-MM-DD') AS cargo_readiness_date,
        (c.cargo_readiness_date - CURRENT_DATE) AS days_to_cargo_readiness,
        NOT EXISTS (
          SELECT 1 FROM shipments s
          WHERE s.contract_id = c.id
            AND (
              s.eta_arrival IS NOT NULL
              OR s.eta_berthed IS NOT NULL
              OR s.eta_loading_start IS NOT NULL
              OR s.eta_loading_complete IS NOT NULL
              OR s.eta_sailed IS NOT NULL
            )
        ) AS sea_missing_eta,
        NOT EXISTS (
          SELECT 1 FROM trucking_operations t
          WHERE t.contract_id = c.id
            AND (
              t.eta_delivery_start_date IS NOT NULL
              OR t.eta_delivery_end_date IS NOT NULL
              OR t.eta_trucking_start_date IS NOT NULL
              OR t.eta_trucking_completion_date IS NOT NULL
            )
        ) AS land_missing_eta
      FROM contracts c
      WHERE c.cargo_readiness_date IS NOT NULL
        AND c.cargo_readiness_date <= CURRENT_DATE + INTERVAL '7 days'
        AND ${sqlContractImportStatusIsOpenExpr(SQL_CONTRACT_IMPORT_STATUS)}
    )
    SELECT
      contract_id,
      contract_ext_no,
      po_number,
      supplier,
      product,
      incoterm,
      transport_mode,
      cargo_readiness_date,
      days_to_cargo_readiness,
      sea_missing_eta,
      land_missing_eta
    FROM candidates
    WHERE (UPPER(TRIM(transport_mode)) LIKE 'SEA%' AND sea_missing_eta)
       OR (UPPER(TRIM(transport_mode)) LIKE 'LAND%' AND land_missing_eta)
       OR (UPPER(TRIM(transport_mode)) LIKE 'MIX%' AND (sea_missing_eta OR land_missing_eta))
    ORDER BY cargo_readiness_date ASC
  `;
  const result = await query(sql);
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

/**
 * Finds contracts missing ETA near their Cargo Readiness Date and emails the Logistics
 * distribution list. Never throws — logs and returns on any failure so the daily cron
 * never crashes the scheduler.
 */
export async function runContractEtaReminderJob(): Promise<void> {
  try {
    const rows = await findContractsMissingEtaNearCargoReadiness();
    if (rows.length === 0) {
      logger.info('Contract ETA reminder: no contracts match, skipping email');
      return;
    }

    const dbRecipients = await findEtaReminderRecipients();
    const recipients = mergeRecipients(dbRecipients, resolveExtraTestRecipients());
    if (recipients.length === 0) {
      logger.warn('Contract ETA reminder: no eligible recipients found, skipping email', {
        contractCount: rows.length,
      });
      return;
    }

    const html = buildContractEtaReminderEmailHtml(rows, frontendUrl());
    const subject = buildContractEtaReminderEmailSubject(rows);
    const sent = await sendEmail({
      to: recipients.map((r) => r.email),
      subject,
      html,
    });

    if (sent) {
      logger.info('Contract ETA reminder email sent', {
        contractCount: rows.length,
        recipientCount: recipients.length,
      });
    }
  } catch (error) {
    logger.error('Contract ETA reminder job failed', error);
  }
}
