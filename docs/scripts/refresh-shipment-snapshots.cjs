/**
 * Rebuild the snapshots a shipment write invalidates, and wait until they are fresh.
 *
 * Use it when a write was done from outside the app (a one-off script, a restore) and the stale flags stayed set - for instance
 * because the process that did the write closed its database pool before the background rebuilds finished.
 * It calls the same invalidation the app calls after saving a shipment, then polls the three stale flags and closes the pool
 * only once they are all clear (or after 5 minutes). Needs no deploy - it calls the code already in the running image.
 *
 * Writes nothing but the snapshots themselves; the first rebuild is the ~50 s trucking/shipment pipeline summary.
 * Read-only check first (no --run): prints the flags and exits.
 *
 *   cd /opt/klip && git fetch origin SIT --quiet && git show origin/SIT:docs/scripts/refresh-shipment-snapshots.cjs \
 *     | docker exec -i klip-backend node -
 *   ... | docker exec -i klip-backend node - --run
 *
 * The running backend keeps its own in-memory list caches (about an hour); they are not cleared from here.
 */
const path = require('path');
const dist = (p) => require(path.join(process.cwd(), 'dist', p));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  const pool = dist('database/connection').default;
  const { invalidateAfterShipmentWrite } = dist('services/shipmentWriteInvalidation.service');

  const flags = async () => {
    const r = await pool.query(
      `SELECT 'pipeline' AS src, module AS k, is_stale FROM pipeline_summary_refresh_meta
       UNION ALL SELECT 'cp', id, is_stale FROM contract_performance_snapshot_meta
       UNION ALL SELECT 'oil', id, is_stale FROM oil_loss_snapshot_meta`,
    );
    return r.rows;
  };
  const show = (rows) => rows.forEach((x) => console.log(`  ${x.src}/${x.k}: ${x.is_stale ? 'STALE' : 'fresh'}`));

  const before = await flags();
  console.log('snapshot flags now:');
  show(before);

  if (!process.argv.includes('--run')) {
    console.log(
      before.some((x) => x.is_stale)
        ? '\nsomething is stale. Add --run to rebuild it and wait.'
        : '\nall fresh - nothing to do.',
    );
    await pool.end();
    return;
  }

  // No shipment ids: only the list caches and the pipeline / oil-loss refreshes are scheduled, not the per-shipment CP refresh.
  invalidateAfterShipmentWrite();
  await sleep(4000); // the stale flags are set asynchronously right after the call above

  const deadline = Date.now() + 300000;
  let clearPolls = 0;
  let rows = await flags();
  while (Date.now() < deadline && clearPolls < 2) {
    clearPolls = rows.some((x) => x.is_stale) ? 0 : clearPolls + 1;
    if (clearPolls < 2) {
      await sleep(3000);
      rows = await flags();
    }
  }

  console.log('\nsnapshot flags after:');
  show(rows);
  console.log(
    rows.some((x) => x.is_stale)
      ? '\nstill stale after 5 min - they rebuild on the next refresh (open the page / next save or import).'
      : '\nall fresh.',
  );
  await pool.end();
})().catch((e) => {
  console.error(e && e.message ? e.message : e);
  process.exit(1);
});
