/**
 * Undo the withdrawals that a per-period SAP export file caused.
 *
 * sapPresence used to treat "PO absent from 2 trusted imports" as cancellation. SAP export
 * files are produced per period, so importing `EXPORT jan - dec 2025.XLSX` and then two
 * 2026-only files withdrew every 2025 PO (370 contracts on 2026-09-07). The inference is gone
 * (see sapPresence.service.ts), but the rows it already wrote are still marked WITHDRAWN.
 *
 * This restores them to PRESENT and audits every transition. It deliberately leaves
 * operator-approved withdrawals alone - those are a human decision, not an inference.
 *
 * Restoring is safe for genuinely cancelled POs too: cancellation is expressed by
 * `import_status = Cancelled` (from SAP's Delete PO / Delete STO flags), not by presence, so a
 * cancelled PO stays Cancelled and stays out of OS after this runs.
 *
 * Dry run by default - prints what it would change and writes nothing.
 *
 *   npx ts-node src/scripts/restoreAbsenceWithdrawnContracts.ts
 *   npx ts-node src/scripts/restoreAbsenceWithdrawnContracts.ts --apply
 *   npx ts-node src/scripts/restoreAbsenceWithdrawnContracts.ts --apply --refresh
 */
import { getClient, query } from '../database/connection';
import { invalidatePresenceDependentCaches } from '../services/sapPresence.service';
import logger from '../utils/logger';

/** Only inference-made withdrawals. Operator-approved ones carry a different reason. */
const ABSENCE_REASON_MATCH = `c.sap_withdrawn_reason LIKE 'Absent from %'`;

const SUMMARY_SQL = `
  WITH del AS (
    SELECT DISTINCT TRIM(po_number) AS po
    FROM sap_processed_data
    WHERE NULLIF(TRIM(COALESCE(
      data->'raw'->>'Delete PO Status', data->'contract'->>'delete_po_status',
      data->'shipment'->>'delete_po_status', data->>'delete_po_status')), '') IS NOT NULL
  ),
  target AS (
    SELECT DISTINCT c.contract_id, TRIM(c.po_number) AS po, c.quantity_ordered, c.contract_date
    FROM contracts c
    WHERE c.sap_presence = 'WITHDRAWN' AND ${ABSENCE_REASON_MATCH}
  )
  SELECT
    CASE WHEN d.po IS NOT NULL THEN 'has SAP Delete PO flag (stays Cancelled)'
         ELSE 'no cancellation signal (returns to its real SAP status)' END AS bucket,
    COUNT(*)::text AS contracts,
    ROUND(SUM(COALESCE(t.quantity_ordered, 0))/1000, 1)::text AS qty_mt,
    MIN(t.contract_date)::text AS oldest,
    MAX(t.contract_date)::text AS newest
  FROM target t
  LEFT JOIN del d ON d.po = t.po
  GROUP BY 1
  ORDER BY 2 DESC`;

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const refresh = process.argv.includes('--refresh');

  const countRes = await query(
    `SELECT COUNT(*)::int AS n FROM contracts c
      WHERE c.sap_presence = 'WITHDRAWN' AND ${ABSENCE_REASON_MATCH}`,
  );
  const rowCount = Number((countRes.rows[0] as { n: number }).n ?? 0);

  const otherRes = await query(
    `SELECT COALESCE(c.sap_withdrawn_reason, '(null)') AS reason, COUNT(*)::int AS n
       FROM contracts c
      WHERE c.sap_presence = 'WITHDRAWN' AND NOT (${ABSENCE_REASON_MATCH})
      GROUP BY 1 ORDER BY 2 DESC`,
  );

  if (rowCount === 0) {
    console.log('[RESTORE] nothing to restore - no contract is withdrawn by the absence inference');
    process.exit(0);
  }

  console.log(`[RESTORE] ${apply ? 'APPLYING' : 'DRY RUN'} - ${rowCount} contract row(s) to restore\n`);
  const sum = await query(SUMMARY_SQL);
  console.log(`${'what happens to it'.padEnd(56)}${'contracts'.padStart(10)}${'qty (MT)'.padStart(12)}  contract dates`);
  for (const r of sum.rows as Record<string, string>[]) {
    console.log(`${r.bucket.padEnd(56)}${r.contracts.padStart(10)}${r.qty_mt.padStart(12)}  ${r.oldest} .. ${r.newest}`);
  }
  if (otherRes.rows.length > 0) {
    console.log('\n[RESTORE] left untouched (not an inference):');
    for (const r of otherRes.rows as Record<string, unknown>[]) {
      console.log(`   ${String(r.reason).padEnd(40)} ${r.n}`);
    }
  }

  if (!apply) {
    console.log('\n[RESTORE] dry run - nothing written. Re-run with --apply to write.');
    process.exit(0);
  }

  const client = await getClient();
  let restored = 0;
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO sap_presence_audit (contract_id, po_number, from_state, to_state, reason, import_id)
       SELECT c.id, TRIM(c.po_number), c.sap_presence, 'PRESENT',
              'Correction: withdrawal came from a per-period SAP export, not a cancellation', NULL
         FROM contracts c
        WHERE c.sap_presence = 'WITHDRAWN' AND ${ABSENCE_REASON_MATCH}`,
    );
    const upd = await client.query(
      `UPDATE contracts c
          SET sap_presence = 'PRESENT',
              sap_withdrawn_at = NULL,
              sap_withdrawn_reason = NULL
        WHERE c.sap_presence = 'WITHDRAWN' AND ${ABSENCE_REASON_MATCH}`,
    );
    restored = upd.rowCount ?? 0;
    await client.query('COMMIT');
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // connection may already be unusable
    }
    logger.error('[RESTORE] failed - nothing written', { err });
    throw err;
  } finally {
    client.release();
  }

  console.log(`\n[RESTORE] restored ${restored} contract row(s) to PRESENT`);
  invalidatePresenceDependentCaches();

  /** Presence decides who is in the Contract Performance snapshot, so it is now out of date. */
  const { ContractPerformanceSnapshotService, markContractPerformanceSnapshotStale } = await import(
    '../services/contractPerformanceSnapshot.service'
  );
  if (refresh) {
    console.log('[RESTORE] rebuilding the Contract Performance snapshot (took 301s when last measured)...');
    const t0 = Date.now();
    await ContractPerformanceSnapshotService.refreshAll();
    console.log(`[RESTORE] snapshot rebuilt in ${Date.now() - t0}ms`);
  } else {
    await markContractPerformanceSnapshotStale();
    console.log('[RESTORE] Contract Performance snapshot marked stale - reads fall back to live');
    console.log('[RESTORE] rebuild it with --refresh, or let the next SAP import do it');
  }
  process.exit(0);
}

main().catch((err) => {
  console.error('[RESTORE] FAILED', err instanceof Error ? err.message : err);
  process.exit(1);
});
