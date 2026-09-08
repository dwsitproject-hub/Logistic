/**
 * SAP presence state.
 *
 * Phase 1 counts how many consecutive trusted imports have missed each (po_number, sto_number).
 * This turns those counters into state that read paths honour:
 *
 *   - a row missing while its PO survives is an STO change -> supersede that row only
 *   - anything that reappears is restored
 *   - a PO whose *every* row is missing is **flagged for review**, never withdrawn automatically
 *
 * **Absence is not evidence of cancellation here, because SAP export files are produced per
 * period.** This code used to assume "the SAP Report is a full snapshot of every PO", so a PO
 * absent from two trusted imports was taken to be cancelled. Confirmed false on 2026-09-07:
 * `EXPORT jan - dec 2025.XLSX` was imported, then two 2026-only files (`CPO 31 Aug 2026`,
 * `CPO 7 Sep 2026`) followed. Those files contain no 2025 PO at all, so every 2025 PO counted
 * two misses and 370 contracts were withdrawn - 143 of them with no SAP cancellation flag
 * whatsoever, hiding 83,623 MT that the 2025 file itself still reported as Open.
 *
 * Cancellation now comes only from what SAP states explicitly: `Delete PO Status` /
 * `Delete STO Status`, which `sqlContractImportStatusExpr` already resolves to Cancelled. A
 * human can still withdraw specific POs deliberately via `extraPos` (see applySapPresence.ts).
 *
 * Inferring coverage from the file's own rows was considered and rejected: `CPO 31 Aug 2026`
 * contains no row before 2026-04-10, so a February 2026 PO would still look absent from it.
 * Only a file that declares its own period could make absence safe, and Klip does not get that.
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

  /*
   * 1. Withdraw - only POs an operator explicitly named. Absence alone no longer withdraws
   *    anything (see the module note: a per-period export file makes every PO outside its own
   *    period look absent, which withdrew 370 contracts on 2026-09-07). Audit first so the
   *    "from" state is the pre-change value.
   */
  let withdrawnCount = 0;
  if (extraPos.length > 0) {
    await client.query(
      `INSERT INTO sap_presence_audit (contract_id, po_number, from_state, to_state, reason, import_id)
       SELECT c.id, TRIM(c.po_number), c.sap_presence, 'WITHDRAWN',
              'Operator-approved withdrawal', $1::uuid
         FROM contracts c
        WHERE c.sap_presence = 'PRESENT'
          AND TRIM(c.po_number) = ANY($2::text[])`,
      [importId, extraPos],
    );

    const withdrawn = await client.query(
      `UPDATE contracts c
          SET sap_presence = 'WITHDRAWN',
              sap_withdrawn_at = CURRENT_TIMESTAMP,
              sap_withdrawn_reason = 'Operator-approved withdrawal'
        WHERE c.sap_presence = 'PRESENT'
          AND TRIM(c.po_number) = ANY($1::text[])`,
      [extraPos],
    );
    withdrawnCount = withdrawn.rowCount ?? 0;
  }

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

  /*
   * 4. Count what a human has to look at: every PO whose rows have all gone missing. This used
   *    to exclude the last-seen-Open ones because those were withdrawn automatically; now that
   *    nothing is withdrawn on absence alone, they are exactly what needs reviewing.
   */
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
       FROM po_state ps`,
    [minMisses],
  );

  const outcome: WithdrawalOutcome = {
    withdrawn: withdrawnCount,
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
