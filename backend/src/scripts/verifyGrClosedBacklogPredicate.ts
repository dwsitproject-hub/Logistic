/**
 * TEMP: evaluate the new GR-closed backlog predicate directly.
 *
 * Going through the page turned out to prove little: its global search does not cover PO numbers
 * on backlog rows, so a miss there says nothing about membership. The predicate itself is the
 * thing that decides, so this asks it.
 *
 *   PO=1001031325 npx ts-node src/scripts/verifyGrClosedBacklogPredicate.ts
 */
import pool, { query } from '../database/connection';
import {
  completedContractBacklogBaseWhereSql,
  grClosedContractBacklogBaseWhereSql,
  unplannedContractBacklogBaseWhereSql,
} from '../utils/shipmentUnplannedHybridSql';
import { resolveUnplannedContractBacklogLatestSpdCte } from '../utils/shipmentUnplannedHybridSql';

const PO = process.env.PO || '1001031325';

async function main(): Promise<void> {
  const spdCte = await resolveUnplannedContractBacklogLatestSpdCte();

  const one = await query(
    `WITH ${spdCte}
     SELECT
       c.contract_id, c.po_number, c.incoterm, c.status,
       (${grClosedContractBacklogBaseWhereSql('c', 'l')})   AS in_gr_closed_backlog,
       (${unplannedContractBacklogBaseWhereSql('c', 'l')})  AS in_unplanned_backlog,
       (${completedContractBacklogBaseWhereSql('c', 'l')})  AS in_completed_backlog
     FROM contracts c
     LEFT JOIN latest_spd_contract l ON l.contract_number = c.contract_id
     WHERE TRIM(c.po_number::text) = TRIM($1) OR TRIM(c.contract_id::text) = TRIM($1)`,
    [PO],
  );
  console.log(`--- PO ${PO} ---`);
  console.log(one.rows[0] ?? '(not found)');

  const totals = await query(
    `WITH ${spdCte}
     SELECT
       COUNT(*) FILTER (WHERE ${grClosedContractBacklogBaseWhereSql('c', 'l')})::int  AS gr_closed_rows,
       COUNT(*) FILTER (WHERE ${unplannedContractBacklogBaseWhereSql('c', 'l')})::int AS unplanned_rows
     FROM contracts c
     LEFT JOIN latest_spd_contract l ON l.contract_number = c.contract_id`,
  );
  console.log('');
  console.log('--- how many rows each arm contributes, whole database ---');
  console.log(totals.rows[0]);

  // The two arms must not overlap, or the ALL view would double count.
  const overlap = await query(
    `WITH ${spdCte}
     SELECT COUNT(*)::int AS n
     FROM contracts c
     LEFT JOIN latest_spd_contract l ON l.contract_number = c.contract_id
     WHERE (${grClosedContractBacklogBaseWhereSql('c', 'l')})
       AND (${unplannedContractBacklogBaseWhereSql('c', 'l')})`,
  );
  console.log('');
  console.log(`overlap between the two arms (must be 0): ${(overlap.rows[0] as { n: number }).n}`);

  await pool.end();
}

main().catch(async (err) => {
  console.error(err);
  await pool.end().catch(() => undefined);
  process.exit(1);
});
