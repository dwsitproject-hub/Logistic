/**
 * SAP snapshot-absence tracking (Phase 1: observe only).
 *
 * The daily SAP Report is a full snapshot: a PO stays in it while Open and after it is
 * Closed, and drops out only when cancelled or deleted. So a row missing from a *complete*
 * import is evidence the PO was cancelled — but only if that import can be trusted.
 *
 * On 2026-07-27 an import failed 1,250 of 8,987 rows. Those rows kept an old last-seen date
 * and were indistinguishable from cancelled POs; acting on that import would have withdrawn
 * 585 live POs. Hence the trust gate and the two-strike rule.
 *
 * Nothing here changes a total or a list. It records state; Phase 2 acts on it.
 */

import { PoolClient } from 'pg';
import { query } from '../database/connection';
import logger from '../utils/logger';

/** An import that failed more than this share of its rows cannot prove a PO was cancelled. */
export const IMPORT_FAILURE_RATE_THRESHOLD = 0.02;

/** Clean imports in a row that must miss a PO before it is treated as cancelled. */
export const CONSECUTIVE_MISSES_TO_WITHDRAW = 2;

export type AbsenceVerdict = 'WITHDRAW' | 'REVIEW_ANOMALY' | 'REVIEW_NO_EVIDENCE';

/**
 * Why a (PO, STO) row vanished while its PO is still in the report.
 * SUPERSEDED_BY_STO is routine bookkeeping; the other two are real business changes.
 */
export type StoAbsenceKind = 'SUPERSEDED_BY_STO' | 'STO_MOVED' | 'STO_ENDED';

export interface StoLevelAbsence {
  poNumber: string;
  stoNumber: string | null;
  lastSeen: string;
  movedToPo: string | null;
  kind: StoAbsenceKind;
}

export interface AbsenceCandidate {
  poNumber: string | null;
  stoNumber: string | null;
  contractNumber: string | null;
  lastSeen: string;
  consecutiveMisses: number;
  lastGrState: 'OPEN' | 'CLOSE' | 'UNKNOWN';
  verdict: AbsenceVerdict;
}

/**
 * When this (po_number, sto_number) was last present in an uploaded SAP Report.
 *
 * Derived from the import that last touched the row rather than stored per row: the importer
 * always writes import_id, so this is free, always consistent, and avoids rewriting every SAP
 * row on every upload. Falls back to the columns for rows predating this scheme.
 */
const SQL_LAST_SEEN_AT = `COALESCE(
    (SELECT i.import_timestamp FROM sap_data_imports i WHERE i.id = spd.import_id),
    spd.last_seen_at,
    spd.updated_at
  )`;

/** GR state from the last SAP row we saw, incoterm-independent (either field closing counts). */
const SQL_LAST_GR_STATE = `
  CASE
    WHEN UPPER(TRIM(COALESCE(spd.data->'raw'->>'GR PO Status',  spd.data->'contract'->>'gr_po_status',  ''))) LIKE 'CLOSE%'
      OR UPPER(TRIM(COALESCE(spd.data->'raw'->>'GR STO Status', spd.data->'contract'->>'gr_sto_status', ''))) LIKE 'CLOSE%'
      THEN 'CLOSE'
    WHEN UPPER(TRIM(COALESCE(spd.data->'raw'->>'GR PO Status',  spd.data->'contract'->>'gr_po_status',  ''))) LIKE 'OPEN%'
      OR UPPER(TRIM(COALESCE(spd.data->'raw'->>'GR STO Status', spd.data->'contract'->>'gr_sto_status', ''))) LIKE 'OPEN%'
      THEN 'OPEN'
    ELSE 'UNKNOWN'
  END`;

/**
 * Decide whether an import is complete enough to prove absence.
 * Records the verdict on sap_data_imports so it is auditable after the fact.
 */
export async function evaluateImportTrust(
  client: PoolClient,
  importId: string,
  totalRecords: number,
  failedRecords: number,
): Promise<boolean> {
  const failureRate = totalRecords > 0 ? failedRecords / totalRecords : 1;
  const trusted = totalRecords > 0 && failureRate <= IMPORT_FAILURE_RATE_THRESHOLD;

  await client.query(`UPDATE sap_data_imports SET is_trusted = $1 WHERE id = $2::uuid`, [
    trusted,
    importId,
  ]);

  if (!trusted) {
    logger.warn('SAP import not trusted for absence detection', {
      importId,
      totalRecords,
      failedRecords,
      failureRate: Number(failureRate.toFixed(4)),
      threshold: IMPORT_FAILURE_RATE_THRESHOLD,
    });
  }
  return trusted;
}

/**
 * Fold one trusted import into the miss counters. Two set-based statements, no per-row work.
 * Rows carrying this import_id were present; everything else missed this snapshot.
 */
export async function applyAbsenceForImport(
  client: PoolClient,
  importId: string,
): Promise<{ present: number; missed: number }> {
  // Only rows whose counters actually need clearing are written.
  //
  // "Last seen" is NOT stamped here: the importer already sets import_id on every row it
  // touches, so the last import that saw a row is recorded by definition and its timestamp is
  // read back via SQL_LAST_SEEN_AT. Stamping last_seen_at on all ~7.5k present rows instead
  // cost 1.6s per upload and left 7.5k dead tuples a day for autovacuum, to store something
  // already known.
  const seen = await client.query(
    `UPDATE sap_processed_data
        SET consecutive_misses = 0,
            missing_since = NULL
      WHERE import_id = $1::uuid
        AND (consecutive_misses <> 0 OR missing_since IS NOT NULL)`,
    [importId],
  );

  const missed = await client.query(
    `UPDATE sap_processed_data
        SET consecutive_misses = consecutive_misses + 1,
            missing_since = COALESCE(missing_since, CURRENT_TIMESTAMP)
      WHERE import_id IS DISTINCT FROM $1::uuid`,
    [importId],
  );

  await client.query(`UPDATE sap_data_imports SET absence_applied = true WHERE id = $1::uuid`, [
    importId,
  ]);

  const result = { present: seen.rowCount ?? 0, missed: missed.rowCount ?? 0 };
  logger.info('SAP absence counters updated', { importId, ...result });
  return result;
}

function verdictFor(grState: string): AbsenceVerdict {
  // Closed POs are expected to stay in the report, so a closed row going missing is an
  // anomaly (archival policy change, or a truncated upload) - never an auto-withdrawal.
  if (grState === 'OPEN') return 'WITHDRAW';
  if (grState === 'CLOSE') return 'REVIEW_ANOMALY';
  return 'REVIEW_NO_EVIDENCE';
}

/**
 * POs whose *every* row has gone missing - the PO itself was cancelled in SAP.
 *
 * Aggregating to PO level is the whole point: a PO with several STOs can lose one of them
 * (an STO cancelled, or moved to another PO) while the PO is very much alive. Judging that
 * at row level and then withdrawing the contract overstates the damage by an order of
 * magnitude - measured on 2026-07-28, 331 absent rows map to only 37 genuinely absent POs.
 */
export async function listCancelledPoCandidates(
  minMisses = CONSECUTIVE_MISSES_TO_WITHDRAW,
): Promise<AbsenceCandidate[]> {
  const res = await query(
    `WITH po_state AS (
       SELECT TRIM(spd.po_number) AS po,
              COUNT(*) FILTER (WHERE spd.consecutive_misses = 0) AS rows_present,
              MIN(spd.consecutive_misses) AS min_misses,
              MAX(${SQL_LAST_SEEN_AT}) AS last_seen
         FROM sap_processed_data spd
        WHERE NULLIF(TRIM(spd.po_number), '') IS NOT NULL
        GROUP BY TRIM(spd.po_number)
       HAVING COUNT(*) FILTER (WHERE spd.consecutive_misses = 0) = 0
          AND MIN(spd.consecutive_misses) >= $1
     ),
     newest_row AS (
       SELECT DISTINCT ON (TRIM(spd.po_number))
              TRIM(spd.po_number) AS po,
              NULLIF(TRIM(spd.sto_number), '') AS sto_number,
              NULLIF(TRIM(spd.contract_number), '') AS contract_number,
              spd.consecutive_misses,
              ${SQL_LAST_GR_STATE} AS last_gr_state
         FROM sap_processed_data spd
         JOIN po_state ps ON ps.po = TRIM(spd.po_number)
        ORDER BY TRIM(spd.po_number), ${SQL_LAST_SEEN_AT} DESC
     )
     SELECT ps.po AS po_number, ps.last_seen, nr.sto_number, nr.contract_number,
            nr.consecutive_misses, nr.last_gr_state
       FROM po_state ps
       JOIN newest_row nr ON nr.po = ps.po
      ORDER BY ps.last_seen DESC`,
    [minMisses],
  );

  return res.rows.map((row) => ({
    poNumber: row.po_number,
    stoNumber: row.sto_number,
    contractNumber: row.contract_number,
    lastSeen: row.last_seen,
    consecutiveMisses: Number(row.consecutive_misses),
    lastGrState: String(row.last_gr_state) as 'OPEN' | 'CLOSE' | 'UNKNOWN',
    verdict: verdictFor(String(row.last_gr_state)),
  }));
}

/**
 * Rows gone while their PO is still present - an STO was cancelled, or moved to another PO.
 * These never withdraw a contract; Phase 2 supersedes the stale (PO, STO) row instead.
 */
export async function listStoLevelAbsences(
  minMisses = CONSECUTIVE_MISSES_TO_WITHDRAW,
): Promise<StoLevelAbsence[]> {
  const res = await query(
    `WITH absent AS (
       SELECT TRIM(spd.po_number) AS po,
              NULLIF(TRIM(spd.sto_number), '') AS sto,
              ${SQL_LAST_SEEN_AT} AS last_seen
         FROM sap_processed_data spd
        WHERE spd.consecutive_misses >= $1
          AND NULLIF(TRIM(spd.po_number), '') IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM sap_processed_data alive
             WHERE TRIM(alive.po_number) = TRIM(spd.po_number)
               AND alive.consecutive_misses = 0
          )
     )
     SELECT a.po AS po_number, a.sto AS sto_number, a.last_seen,
            (SELECT TRIM(m.po_number)
               FROM sap_processed_data m
              WHERE a.sto IS NOT NULL
                AND TRIM(m.sto_number) = a.sto
                AND TRIM(m.po_number) <> a.po
                AND m.consecutive_misses = 0
              LIMIT 1) AS moved_to_po,
            CASE
              -- The identity key is (po_number, sto_number), so a PO first seen before SAP
              -- assigned its STO leaves a blank-STO row behind the moment the STO arrives.
              -- Routine progression, not a change to the business: auto-supersede, no review.
              WHEN a.sto IS NULL AND EXISTS (
                SELECT 1 FROM sap_processed_data f
                 WHERE TRIM(f.po_number) = a.po
                   AND f.consecutive_misses = 0
                   AND NULLIF(TRIM(f.sto_number), '') IS NOT NULL
              ) THEN 'SUPERSEDED_BY_STO'
              WHEN a.sto IS NOT NULL AND EXISTS (
                SELECT 1 FROM sap_processed_data m
                 WHERE TRIM(m.sto_number) = a.sto
                   AND TRIM(m.po_number) <> a.po
                   AND m.consecutive_misses = 0
              ) THEN 'STO_MOVED'
              ELSE 'STO_ENDED'
            END AS kind
       FROM absent a
      ORDER BY a.last_seen DESC`,
    [minMisses],
  );
  return res.rows.map((r) => ({
    poNumber: r.po_number,
    stoNumber: r.sto_number,
    lastSeen: r.last_seen,
    movedToPo: r.moved_to_po,
    kind: r.kind as StoAbsenceKind,
  }));
}
