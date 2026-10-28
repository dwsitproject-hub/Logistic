/*
 * Master Company (Internal): bring KLIP's SAP Company Code in line with DHM's company_code_sap.
 *
 *   docker cp docs/scripts/repair-company-sap-codes.cjs klip-backend:/app/
 *   docker exec klip-backend node /app/repair-company-sap-codes.cjs            (DRY RUN: prints the plan, changes nothing)
 *   docker exec klip-backend node /app/repair-company-sap-codes.cjs --apply    (writes, in ONE transaction)
 *
 * (it finds the backend build in /app/dist, or in ../../backend/dist when run from the repo checkout)
 *
 * WHY. DHM used to carry the SAP Company Code as the organisation's short_name; the newer legal entities (ORG-0006 PT Prima Makmur Cakrawala, short_name PMC) carry it in
 * company_code_sap (PM). KLIP's sync copied short_name, so SAP code PM stayed on the legacy organisation ORG-0016 "PMC GENERAL HO JAKARTA", which JPS does not know, and an STO at
 * Dumai was held. The sync now reads company_code_sap (dhm/applyMaster.ts); this moves the rows written before that.
 *
 * WHAT IT CHANGES, and only that: master_companies.company_code. For each organisation whose company_code_sap differs from its row's company_code, the row holding that code
 * (the legacy one) is released to its own DHM code (ORG-0016), then the organisation's row takes the SAP code. Nothing is deleted. Plants and sites hang on the row id and do not
 * move; Contracts and Shipments show the SAP Buyer text, not this table. The dry run prints the rollback SQL; --apply saves it to a file next to where it was run.
 *
 * Refuses --apply unless the deployed backend already has the sync change, so a later DHM sync cannot put the old code back.
 */
const path = require('path');
const fs = require('fs');

const DIST = ['/app/dist', path.join(__dirname, '..', '..', 'backend', 'dist')].find((p) => fs.existsSync(p));
if (!DIST) {
  console.error('no backend build found (looked in /app/dist and ../../backend/dist)');
  process.exit(1);
}
const load = (m) => require(path.join(DIST, m));
const APPLY = process.argv.includes('--apply');

(async () => {
  const pool = load('database/connection').default;
  const { planCompanyCodeRepair, loadCompanyRows, applyCompanyCodeRepair, rollbackSql } = load('dhm/companyCodeRepair');

  const rows = await loadCompanyRows(pool);
  const plan = planCompanyCodeRepair(rows);

  // how many contracts carry each SAP code, for context (the Contracts / Shipments pages show the SAP Buyer text and do not change)
  const SAP = "UPPER(NULLIF(TRIM(COALESCE(l.data->'contract'->>'company_code',l.data->'raw'->>'Company Code',l.data->'raw'->>'company code',l.data->>'Company Code',l.data->>'company code')),''))";
  const counts = new Map(
    (await pool.query(`SELECT ${SAP} AS code, COUNT(*)::int AS n FROM contract_latest_spd_snapshot l GROUP BY 1`)).rows.map((r) => [r.code, r.n]),
  );

  console.log('');
  console.log(`=== ${APPLY ? 'APPLY' : 'DRY RUN (nothing is changed)'}: ${rows.length} Master Company rows read`);
  console.log(`   already right : ${plan.alreadyRight.length ? plan.alreadyRight.join(', ') : '-'}`);

  console.log('');
  console.log(`=== steps (${plan.steps.length}), in the order they run`);
  if (plan.steps.length === 0) console.log('   none: nothing to repair');
  for (const s of plan.steps) {
    const sapCode = s.why === 'take SAP code' ? s.to : s.from;
    const n = counts.has(sapCode) ? `   [${counts.get(sapCode)} contracts carry SAP code ${sapCode}]` : '';
    console.log(`   ${s.why.padEnd(20)} ${s.name.padEnd(36)} ${s.from} -> ${s.to}${n}`);
  }

  console.log('');
  console.log(`=== conflicts (${plan.conflicts.length}): not touched, they need a decision`);
  if (plan.conflicts.length === 0) console.log('   none');
  for (const c of plan.conflicts) console.log(`   ${c.code}: ${c.reason}`);

  const undo = rollbackSql(plan.steps);
  console.log('');
  console.log('=== rollback SQL');
  if (undo.length === 0) console.log('   none');
  for (const line of undo) console.log('   ' + line);

  if (!APPLY) {
    console.log('');
    console.log('Dry run only. Run again with --apply to write these steps.');
    await pool.end();
    return;
  }

  if (plan.steps.length === 0) {
    await pool.end();
    return;
  }

  const synced = fs.readFileSync(path.join(DIST, 'dhm', 'applyMaster.js'), 'utf8').includes('company_code_sap');
  if (!synced) {
    console.error('');
    console.error('REFUSED: the deployed backend does not read company_code_sap yet (dist/dhm/applyMaster.js). Deploy it first, or a DHM sync would put the old codes back.');
    await pool.end();
    process.exit(2);
  }

  const file = path.join(process.cwd(), `company-code-rollback-${new Date().toISOString().replace(/[:.]/g, '-')}.sql`);
  fs.writeFileSync(file, undo.join('\n') + '\n');
  console.log('');
  console.log(`rollback SQL saved to ${file}`);

  const client = await pool.connect();
  try {
    await applyCompanyCodeRepair(client, plan.steps);
    console.log(`DONE: ${plan.steps.length} rows changed in one transaction.`);
  } finally {
    client.release();
    await pool.end();
  }
})().catch((error) => {
  console.error('FAILED, nothing was changed:', error.message);
  process.exit(1);
});
