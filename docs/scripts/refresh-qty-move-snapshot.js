/*
 * Rebuild contract_qty_move_snapshot.
 *
 * Contract Performance does not read the live trucking quantity expressions. It reads `qm.*` -
 * this snapshot - so a change to how delivery and receive resolve is invisible there until the
 * snapshot is rebuilt. That is the whole reason this script exists: after the GREATEST change the
 * Trucking page moved immediately and Contract Performance did not, which looked like a deploy
 * failure and was not.
 *
 * refreshAll marks the snapshot stale FIRST, so readers fall back to the live path while the
 * rebuild runs, then does the DELETE and INSERT in one transaction. Nobody sees an empty snapshot.
 * If it throws, the snapshot is left marked stale rather than half-written.
 *
 *   docker exec klip-backend node /app/refresh-qty-move-snapshot.js
 *
 * It is one heavy write against the whole contracts table - run it when the pages are quiet, and
 * not twice at once.
 */
const { ContractQtyMoveSnapshotService } = require('/app/dist/services/contractQtyMoveSnapshot.service');

(async () => {
  const started = Date.now();
  console.log('rebuilding contract_qty_move_snapshot (readers fall back to live meanwhile)...');
  const rows = await ContractQtyMoveSnapshotService.refreshAll();
  console.log(`done: ${rows} rows in ${Math.round((Date.now() - started) / 1000)}s`);
  console.log('Contract Performance should now agree with the Trucking page.');
  process.exit(0);
})().catch((e) => {
  console.error('ERR', e && e.stack ? e.stack : e);
  console.error('The snapshot is left marked stale, so pages read the live path - degraded, not wrong.');
  process.exit(1);
});
