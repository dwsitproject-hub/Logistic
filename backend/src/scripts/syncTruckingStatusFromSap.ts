/**
 * One-time sync: copy SAP Trucking Last/Start Receive into trucking_operations
 * and set status PLANNED | IN_PROGRESS | COMPLETED.
 *
 * Usage: npx ts-node src/scripts/syncTruckingStatusFromSap.ts
 */
import { query } from '../database/connection';
import logger from '../utils/logger';

async function main() {
  const result = await query(`
    WITH latest_sap AS (
      SELECT DISTINCT ON (COALESCE(NULLIF(TRIM(spd.contract_number), ''), NULLIF(TRIM(spd.sto_number), '')))
        spd.contract_number,
        spd.sto_number,
        COALESCE(
          spd.data->'raw'->>'Trucking Last Receive Date',
          spd.data->>'Trucking Last Receive Date',
          spd.data->'trucking'->0->'data'->>'trucking_last_receive_date'
        ) AS last_receive_raw,
        COALESCE(
          spd.data->'raw'->>'Trucking Start Receive Date',
          spd.data->>'Trucking Start Receive Date',
          spd.data->'trucking'->0->'data'->>'trucking_start_receive_date'
        ) AS start_receive_raw
      FROM sap_processed_data spd
      WHERE COALESCE(NULLIF(TRIM(spd.contract_number), ''), NULLIF(TRIM(spd.sto_number), '')) IS NOT NULL
      ORDER BY COALESCE(NULLIF(TRIM(spd.contract_number), ''), NULLIF(TRIM(spd.sto_number), '')),
        spd.created_at DESC NULLS LAST
    ),
    parsed AS (
      SELECT
        contract_number,
        sto_number,
        CASE
          WHEN last_receive_raw IS NULL OR length(trim(last_receive_raw)) < 6 THEN NULL
          WHEN trim(last_receive_raw) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN trim(last_receive_raw)::date
          WHEN trim(last_receive_raw) ~ '^[0-9]{1,2}/[0-9]{1,2}/[0-9]{2}$' THEN to_date(trim(last_receive_raw), 'MM/DD/YY')
          WHEN trim(last_receive_raw) ~ '^[0-9]{1,2}/[0-9]{1,2}/[0-9]{4}$' THEN to_date(trim(last_receive_raw), 'MM/DD/YYYY')
          ELSE NULL
        END AS last_receive_date,
        CASE
          WHEN start_receive_raw IS NULL OR length(trim(start_receive_raw)) < 6 THEN NULL
          WHEN trim(start_receive_raw) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN trim(start_receive_raw)::date
          WHEN trim(start_receive_raw) ~ '^[0-9]{1,2}/[0-9]{1,2}/[0-9]{2}$' THEN to_date(trim(start_receive_raw), 'MM/DD/YY')
          WHEN trim(start_receive_raw) ~ '^[0-9]{1,2}/[0-9]{1,2}/[0-9]{4}$' THEN to_date(trim(start_receive_raw), 'MM/DD/YYYY')
          ELSE NULL
        END AS start_receive_date
      FROM latest_sap
    )
    UPDATE trucking_operations t
    SET
      trucking_completion_date = COALESCE(t.trucking_completion_date, p.last_receive_date),
      trucking_start_date = COALESCE(t.trucking_start_date, p.start_receive_date),
      status = CASE
        WHEN t.status = 'CANCELLED' THEN t.status
        WHEN COALESCE(t.trucking_completion_date, p.last_receive_date) IS NOT NULL THEN 'COMPLETED'
        WHEN COALESCE(t.trucking_start_date, p.start_receive_date) IS NOT NULL THEN 'IN_PROGRESS'
        ELSE COALESCE(t.status, 'PLANNED')
      END,
      updated_at = CURRENT_TIMESTAMP
    FROM contracts c
    INNER JOIN parsed p ON (
      p.contract_number = c.contract_id
      OR (
        NULLIF(TRIM(c.sto_number::text), '') IS NOT NULL
        AND p.sto_number = NULLIF(TRIM(c.sto_number::text), '')
      )
    )
    WHERE t.contract_id = c.id
      AND (
        (t.trucking_completion_date IS NULL AND p.last_receive_date IS NOT NULL)
        OR (t.trucking_start_date IS NULL AND p.start_receive_date IS NOT NULL)
        OR (t.status NOT IN ('COMPLETED', 'CANCELLED') AND p.last_receive_date IS NOT NULL)
      )
    RETURNING t.id
  `);

  logger.info(`Synced ${result.rowCount ?? 0} trucking operation(s) from SAP receive dates.`);
  process.exit(0);
}

main().catch((err) => {
  logger.error(err);
  process.exit(1);
});
