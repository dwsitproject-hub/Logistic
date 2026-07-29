/**
 * SAP presence state (Phase 2: act on absence).
 *
 * Phase 1 counts how many consecutive trusted imports have missed each (po_number, sto_number).
 * This turns those counters into state that read paths honour:
 *
 *   - a PO whose *every* row is missing was cancelled in SAP -> contract WITHDRAWN
 *   - a row missing while its PO survives is an STO change -> supersede that row only
 *   - anything that reappears is restored
 *
 * Withdrawal excludes a contract from totals. It never deletes anything: KLIP-entered planning,
 * ATAs and remarks stay, the row stays visible behind a filter, and restoration is one import
 * away. Every transition is written to sap_presence_audit.
 */

import { PoolClient } from 'pg';
import { query } from '../database/connection';
import logger from '../utils/logger';
import { CONSECUTIVE_MISSES_TO_WITHDRAW } from './sapAbsenceTracking.service';
import { invalidateLatePerformanceCache } from './latePerformance.service';
import { invalidateShipmentsListCache } from './shipmentList.service';
import { invalidateShippingPerformanceRowCache } from './shippingPerformance.service';
import { invalidateTruckingListCache } from './truckingList.service';
import { invalidateOilLossCache } from './oilLoss.service';
import { invalidateTtlMemo } from '../utils/ttlMemo';

export interface WithdrawalOutcome {
  withdrawn: number;
  restored: number;
  supersededStoRows: number;
  flaggedForReview: number;
}

/**
 * POs eligible for withdrawal: every row for the PO has missed the threshold, and the last
 * row we saw was still Open.
 *
 * A PO last seen Closed is deliberately excluded - closed POs stay in the SAP Report, so one
 * disappearing means something changed about the report itself (archival policy, a truncated
 * upload), not that the business was cancelled. Those surface in the Phase 1 review instead.
 * Rows with no GR status recorded are likewise left for a human.
 */
const SQL_WITHDRAWABLE_POS = `
  WITH po_state AS (
    SELECT TRIM(spd.po_number) AS po
      FROM sap_processed_data spd
     WHERE NULLIF(TRIM(spd.po_number), '') IS NOT NULL
       AND spd.superseded_at IS NULL
     GROUP BY TRIM(spd.po_number)
    HAVING COUNT(*) FILTER (WHERE spd.consecutive_misses = 0) = 0
       AND MIN(spd.consecutive_misses) >= $1
  ),
  newest AS (
    SELECT DISTINCT ON (TRIM(spd.po_number))
           TRIM(spd.po_number) AS po,
           CASE
             WHEN UPPER(TRIM(COALESCE(spd.data->'raw'->>'GR PO Status',  spd.data->'contract'->>'gr_po_status',  ''))) LIKE 'CLOSE%'
               OR UPPER(TRIM(COALESCE(spd.data->'raw'->>'GR STO Status', spd.data->'contract'->>'gr_sto_status', ''))) LIKE 'CLOSE%'
               THEN 'CLOSE'
             WHEN UPPER(TRIM(COALESCE(spd.data->'raw'->>'GR PO Status',  spd.data->'contract'->>'gr_po_status',  ''))) LIKE 'OPEN%'
               OR UPPER(TRIM(COALESCE(spd.data->'raw'->>'GR STO Status', spd.data->'contract'->>'gr_sto_status', ''))) LIKE 'OPEN%'
               THEN 'OPEN'
             ELSE 'UNKNOWN'
           END AS gr_state
      FROM sap_processed_data spd
      JOIN po_state ps ON ps.po = TRIM(spd.po_number)
     ORDER BY TRIM(spd.po_number), COALESCE(
              (SELECT i.import_timestamp FROM sap_data_imports i WHERE i.id = spd.import_id),
              spd.last_seen_at,
              spd.updated_at
            ) DESC
  )
  SELECT po FROM newest WHERE gr_state = 'OPEN'`;

/**
 * Fold absence counters into contract presence. Set-based; safe to run repeatedly.
 * `extraPos` lets an operator withdraw POs a human explicitly approved (for example the
 * no-GR-evidence backlog signed off in the Phase 1 review).
 */
export async function applyPresenceState(
  client: PoolClient,
  options: { importId?: string | null; minMisses?: number; extraPos?: string[] } = {},
): Promise<WithdrawalOutcome> {
  const minMisses = options.minMisses ?? CONSECUTIVE_MISSES_TO_WITHDRAW;
  const importId = options.importId ?? null;
  const extraPos = (options.extraPos ?? []).map((p) => String(p).trim()).filter(Boolean);

  // 1. Withdraw. Audit first so the "from" state is the pre-change value.
  await client.query(
    `INSERT INTO sap_presence_audit (contract_id, po_number, from_state, to_state, reason, import_id)
     SELECT c.id, TRIM(c.po_number), c.sap_presence, 'WITHDRAWN',
            'Absent from ' || $1::int || '+ consecutive trusted SAP imports (last seen Open)', $2::uuid
       FROM contracts c
      WHERE c.sap_presence = 'PRESENT'
        AND (TRIM(c.po_number) IN (${SQL_WITHDRAWABLE_POS})
             OR ($3::text[] IS NOT NULL AND TRIM(c.po_number) = ANY($3::text[])))`,
    [minMisses, importId, extraPos.length > 0 ? extraPos : null],
  );

  const withdrawn = await client.query(
    `UPDATE contracts c
        SET sap_presence = 'WITHDRAWN',
            sap_withdrawn_at = CURRENT_TIMESTAMP,
            sap_withdrawn_reason = 'Absent from ' || $1::int || '+ consecutive trusted SAP imports'
      WHERE c.sap_presence = 'PRESENT'
        AND (TRIM(c.po_number) IN (${SQL_WITHDRAWABLE_POS})
             OR ($2::text[] IS NOT NULL AND TRIM(c.po_number) = ANY($2::text[])))`,
    [minMisses, extraPos.length > 0 ? extraPos : null],
  );

  // 2. Restore anything that came back. Reappearance always wins over a prior withdrawal.
  await client.query(
    `INSERT INTO sap_presence_audit (contract_id, po_number, from_state, to_state, reason, import_id)
     SELECT c.id, TRIM(c.po_number), c.sap_presence, 'PRESENT',
            'Reappeared in the SAP Report', $1::uuid
       FROM contracts c
      WHERE c.sap_presence = 'WITHDRAWN'
        AND EXISTS (
          SELECT 1 FROM sap_processed_data spd
           WHERE TRIM(spd.po_number) = TRIM(c.po_number)
             AND spd.consecutive_misses = 0
        )`,
    [importId],
  );

  const restored = await client.query(
    `UPDATE contracts c
        SET sap_presence = 'PRESENT',
            sap_withdrawn_at = NULL,
            sap_withdrawn_reason = NULL
      WHERE c.sap_presence = 'WITHDRAWN'
        AND EXISTS (
          SELECT 1 FROM sap_processed_data spd
           WHERE TRIM(spd.po_number) = TRIM(c.po_number)
             AND spd.consecutive_misses = 0
        )`,
  );

  // 3. Supersede stale rows whose PO is still present - an STO moved, or a blank-STO row was
  //    replaced once SAP assigned the STO. Never touches a contract.
  const superseded = await client.query(
    `UPDATE sap_processed_data stale
        SET superseded_at = CURRENT_TIMESTAMP,
            superseded_reason = CASE
              WHEN NULLIF(TRIM(stale.sto_number), '') IS NULL THEN 'SUPERSEDED_BY_STO'
              ELSE 'STO_MOVED'
            END,
            superseded_by_po = (
              SELECT TRIM(m.po_number)
                FROM sap_processed_data m
               WHERE NULLIF(TRIM(stale.sto_number), '') IS NOT NULL
                 AND TRIM(m.sto_number) = TRIM(stale.sto_number)
                 AND TRIM(m.po_number) <> TRIM(stale.po_number)
                 AND m.consecutive_misses = 0
               LIMIT 1
            )
      WHERE stale.superseded_at IS NULL
        AND stale.consecutive_misses >= $1
        AND NULLIF(TRIM(stale.po_number), '') IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM sap_processed_data alive
           WHERE TRIM(alive.po_number) = TRIM(stale.po_number)
             AND alive.consecutive_misses = 0
        )
        AND (
          NULLIF(TRIM(stale.sto_number), '') IS NULL
          OR EXISTS (
            SELECT 1 FROM sap_processed_data m
             WHERE TRIM(m.sto_number) = TRIM(stale.sto_number)
               AND TRIM(m.po_number) <> TRIM(stale.po_number)
               AND m.consecutive_misses = 0
          )
        )`,
    [minMisses],
  );

  // 4. Count what a human still has to look at (last seen Closed, or no GR evidence).
  const review = await client.query(
    `WITH po_state AS (
       SELECT TRIM(spd.po_number) AS po
         FROM sap_processed_data spd
        WHERE NULLIF(TRIM(spd.po_number), '') IS NOT NULL
          AND spd.superseded_at IS NULL
        GROUP BY TRIM(spd.po_number)
       HAVING COUNT(*) FILTER (WHERE spd.consecutive_misses = 0) = 0
          AND MIN(spd.consecutive_misses) >= $1
     )
     SELECT COUNT(*)::int AS n
       FROM po_state ps
      WHERE ps.po NOT IN (${SQL_WITHDRAWABLE_POS})`,
    [minMisses],
  );

  const outcome: WithdrawalOutcome = {
    withdrawn: withdrawn.rowCount ?? 0,
    restored: restored.rowCount ?? 0,
    supersededStoRows: superseded.rowCount ?? 0,
    flaggedForReview: review.rows[0]?.n ?? 0,
  };

  // Presence changes who counts towards every aggregate, so the cached ones must be dropped -
  // otherwise a withdrawal appears to have done nothing until the TTL happens to expire.
  if (outcome.withdrawn > 0 || outcome.restored > 0) {
    invalidatePresenceDependentCaches();
  }

  logger.info('SAP presence state applied', { importId, ...outcome });
  return outcome;
}

/** Every cache whose contents depend on which contracts are PRESENT. */
export function invalidatePresenceDependentCaches(): void {
  invalidateLatePerformanceCache();
  invalidateShipmentsListCache();
  invalidateShippingPerformanceRowCache();
  invalidateTruckingListCache();
  invalidateOilLossCache();
  invalidateTtlMemo();
}

/** Manual reversal, for when a withdrawal turns out to be wrong. */
export async function restoreContractPresence(
  poNumber: string,
  actor = 'manual',
): Promise<boolean> {
  const res = await query(
    `WITH audited AS (
       INSERT INTO sap_presence_audit (contract_id, po_number, from_state, to_state, reason, actor)
       SELECT c.id, TRIM(c.po_number), c.sap_presence, 'PRESENT', 'Manually restored', $2
         FROM contracts c
        WHERE TRIM(c.po_number) = TRIM($1) AND c.sap_presence <> 'PRESENT'
       RETURNING contract_id
     )
     UPDATE contracts c
        SET sap_presence = 'PRESENT', sap_withdrawn_at = NULL, sap_withdrawn_reason = NULL
      WHERE c.id IN (SELECT contract_id FROM audited)`,
    [poNumber, actor],
  );
  return (res.rowCount ?? 0) > 0;
}
