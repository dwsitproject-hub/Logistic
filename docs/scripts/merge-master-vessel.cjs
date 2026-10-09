/**
 * Merge two master vessel rows that are the same ship under two spellings - for example "TB. TOLLANDAK II" (the row SAP's spelling made)
 * into "TB. TOL LANDAK II" (the row DHM already knows). Dry run unless --apply; one transaction.
 *
 *   cd /opt/klip && git fetch origin SIT --quiet && git show origin/SIT:docs/scripts/merge-master-vessel.cjs \
 *     | docker exec -i klip-backend node - --from "TB. TOLLANDAK II" --into "TB. TOL LANDAK II"
 *   ... | docker exec -i klip-backend node - --from "TB. TOLLANDAK II" --into "TB. TOL LANDAK II" --apply
 *
 * --from  the row that goes away. It must NOT be linked to DHM (deleting it would orphan the DHM record): merge into the DHM row.
 * --into  the row that stays. It keeps its name and its own primary code unless --rename is given.
 * --rename "NAME"  give the surviving row this name (the clean spelling). The name matching key is not touched.
 * A reference is an exact vessel name or a master vessel id (uuid); a name that matches several rows is refused.
 *
 * What moves: the SAP codes of the row that goes (as non-primary aliases), shipments that pointed at it, the pairs it was in, and any
 * field the survivor leaves empty (role, owner, capacity, type, heating, lambung, terms). Nothing the survivor already has is overwritten.
 * It refuses: two different roles, a tug into a barge, a DHM-linked row as the one that goes away.
 */
const path = require('path');
const dist = (p) => require(path.join(process.cwd(), 'dist', p));

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
}

(async () => {
  const from = arg('--from');
  const into = arg('--into');
  const rename = arg('--rename');
  const apply = process.argv.includes('--apply');
  if (!from || !into) {
    console.error('Give --from "<name or id>" and --into "<name or id>".');
    process.exit(1);
  }
  const pool = dist('database/connection').default;
  const svc = dist('services/masterVesselMerge.service');
  const client = await pool.connect();
  let code = 0;
  try {
    const plan = await svc.planMasterVesselMerge(client, from, into);
    const row = (r) => (r ? `${r.vessel_name}  [${r.vessel_code}, ${r.code_status}${r.vessel_role ? ', ' + r.vessel_role : ''}${r.vessel_type ? ', ' + r.vessel_type : ''}]  dhm=${r.dhm_code || '-'}` : '(not found)');
    console.log(`GOES AWAY : ${row(plan.from)}`);
    console.log(`STAYS     : ${row(plan.into)}${rename ? `   -> will be renamed "${String(rename).toUpperCase()}"` : ''}`);
    if (plan.from) console.log(`MOVES     : ${plan.counts.aliases} SAP code alias(es), ${plan.counts.shipments} shipment(s), ${plan.counts.pairs} pair(s)`);
    if (plan.blockers.length > 0) {
      console.error('\nREFUSED:\n  ' + plan.blockers.join('\n  '));
      process.exitCode = 1; // the finally below still releases the client and closes the pool
      return;
    }
    if (!apply) {
      console.log('\nDry run - nothing changed. Add --apply to merge.');
      return;
    }
    await client.query('BEGIN');
    try {
      const out = await svc.applyMasterVesselMerge(client, plan, { renameSurvivorTo: rename });
      await client.query('COMMIT');
      console.log(`\nMERGED: ${out.aliases} alias(es) and ${out.shipments} shipment(s) moved, ${out.pairsMoved} pair(s) re-pointed, ${out.pairsDropped} duplicate pair(s) dropped.`);
      console.log('Push the surviving vessel to DHM again if its attributes changed (load-vessel-master-bersih.cjs --push-dhm).');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    }
  } catch (error) {
    console.error('\nFailed:', error && error.message ? error.message : error);
    code = 1;
  } finally {
    client.release();
    await pool.end();
  }
  if (code) process.exit(code);
})();
