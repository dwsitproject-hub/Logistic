/**
 * Report which SAP rows have gone missing from the daily snapshot, and what Phase 2 would
 * do about each. Read-only - it changes nothing.
 *
 *   npm run sap:absence-report            (rows missing >= 2 consecutive trusted imports)
 *   npm run sap:absence-report -- --min=1 (include rows that missed only the last import)
 */

import { query } from '../database/connection';
import logger from '../utils/logger';
import {
  CONSECUTIVE_MISSES_TO_WITHDRAW,
  listCancelledPoCandidates,
  listStoLevelAbsences,
  type StoLevelAbsence,
} from '../services/sapAbsenceTracking.service';

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=')[1] : undefined;
}

async function main(): Promise<void> {
  const minMisses = Number(arg('min') ?? CONSECUTIVE_MISSES_TO_WITHDRAW);

  const imports = await query(
    `SELECT import_date, status, total_records, processed_records, failed_records,
            is_trusted, absence_applied
       FROM sap_data_imports
      ORDER BY import_timestamp DESC
      LIMIT 5`,
  );

  console.log('\n=== Recent imports ===');
  console.log('date        status                  total  failed  trusted  absence_applied');
  for (const r of imports.rows) {
    console.log(
      `${String(r.import_date).slice(0, 10)}  ${String(r.status).padEnd(22)} ` +
        `${String(r.total_records).padStart(5)}  ${String(r.failed_records).padStart(6)}  ` +
        `${String(r.is_trusted ?? '-').padStart(7)}  ${String(r.absence_applied)}`,
    );
  }

  const stoLevel = await listStoLevelAbsences(minMisses);
  console.log(`\n=== STO-level changes (PO still present) : ${stoLevel.length} ===`);
  console.log('These never withdraw a contract - the PO is alive.');
  const kindMeaning: Record<string, string> = {
    SUPERSEDED_BY_STO: 'blank-STO row left behind when SAP assigned the STO - routine, auto-supersede',
    STO_MOVED: 'this STO now sits under a different PO - supersede the stale row',
    STO_ENDED: 'STO gone and not seen elsewhere - review',
  };
  const byKind = new Map<string, StoLevelAbsence[]>();
  for (const s of stoLevel) {
    const list = byKind.get(s.kind) ?? [];
    list.push(s);
    byKind.set(s.kind, list);
  }
  for (const [kind, list] of byKind) {
    console.log(`\n-- ${kind} (${list.length}) : ${kindMeaning[kind]}`);
    for (const s of list.slice(0, 8)) {
      console.log(
        `   ${String(s.poNumber).padEnd(13)} sto=${String(s.stoNumber ?? '(blank)').padEnd(12)} ` +
          `last_seen ${String(s.lastSeen).slice(0, 10)}` +
          (s.movedToPo ? `  -> now under PO ${s.movedToPo}` : ''),
      );
    }
    if (list.length > 8) console.log(`   ... and ${list.length - 8} more`);
  }

  const candidates = await listCancelledPoCandidates(minMisses);
  if (candidates.length === 0) {
    console.log(`\nNo PO has missed ${minMisses}+ consecutive trusted imports in full.`);
    console.log('(If no trusted import has run since deploy, counters are still all zero.)');
    return;
  }

  const byVerdict = new Map<string, typeof candidates>();
  for (const c of candidates) {
    const list = byVerdict.get(c.verdict) ?? [];
    list.push(c);
    byVerdict.set(c.verdict, list);
  }

  console.log(`\n=== ${candidates.length} PO(s) fully absent for ${minMisses}+ consecutive trusted imports ===`);
  for (const [verdict, list] of byVerdict) {
    const meaning =
      verdict === 'WITHDRAW'
        ? 'last seen OPEN -> cancelled in SAP; Phase 2 excludes from totals'
        : verdict === 'REVIEW_ANOMALY'
          ? 'last seen CLOSE -> closed POs should stay in the report; investigate'
          : 'no GR status recorded -> not enough evidence; human decides';
    console.log(`\n-- ${verdict} (${list.length}) : ${meaning}`);
    console.log('   po_number     sto_number    contract        last_seen    misses');
    for (const c of list.slice(0, 40)) {
      console.log(
        `   ${String(c.poNumber ?? '-').padEnd(13)} ${String(c.stoNumber ?? '-').padEnd(13)} ` +
          `${String(c.contractNumber ?? '-').padEnd(15)} ${String(c.lastSeen).slice(0, 10)}   ${c.consecutiveMisses}`,
      );
    }
    if (list.length > 40) console.log(`   ... and ${list.length - 40} more`);
  }

  const withdrawPos = (byVerdict.get('WITHDRAW') ?? [])
    .map((c) => c.poNumber)
    .filter((p): p is string => !!p);

  if (withdrawPos.length > 0) {
    const impact = await query(
      `SELECT COUNT(*)::int AS contracts,
              COUNT(*) FILTER (WHERE UPPER(TRIM(c.status)) = 'ACTIVE')::int AS still_active,
              COALESCE(ROUND(SUM(COALESCE(c.quantity_ordered, 0))::numeric / 1000, 0), 0) AS qty_mt,
              (SELECT COUNT(*)::int FROM shipments s
                 WHERE s.contract_id = ANY(ARRAY(SELECT id FROM contracts WHERE TRIM(po_number) = ANY($1::text[])))
                   AND COALESCE(s.status, '') <> 'CANCELLED') AS active_shipments,
              (SELECT COUNT(*)::int FROM trucking_operations t
                 WHERE t.contract_id = ANY(ARRAY(SELECT id FROM contracts WHERE TRIM(po_number) = ANY($1::text[])))
                   AND COALESCE(t.status, '') <> 'CANCELLED') AS active_trucking
         FROM contracts c
        WHERE TRIM(c.po_number) = ANY($1::text[])`,
      [withdrawPos],
    );
    const i = impact.rows[0] ?? {};
    console.log('\n=== If Phase 2 acted on the WITHDRAW set ===');
    console.log(`  KLIP contracts affected : ${i.contracts} (${i.still_active} still ACTIVE)`);
    console.log(`  Quantity out of totals  : ${i.qty_mt} MT`);
    console.log(`  Active shipments        : ${i.active_shipments}`);
    console.log(`  Active trucking ops     : ${i.active_trucking}`);
    console.log('\n  Nothing above has been changed. This report is read-only.');
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error('sapAbsenceReport failed', err);
    console.error(err);
    process.exit(1);
  });
