/**
 * Clear the "Too many requests" push failures a whole-catalog Sync left on Master Product rows.
 *
 * The Sync button used to send all ~3,400 products to DHM one request each; DHM's rate limit refused most of them and each refusal was recorded as a FAILED push. That is not a problem with the
 * data, and for a product no KLIP contract uses there is nothing to deliver anyway. This removes those states for the products that are NOT used by a contract and were already received by DHM,
 * and keeps the rest (they are retried by the cron).
 *
 *   npx ts-node src/scripts/repairDhmThrottledProductStates.ts            dry run: counts only
 *   npx ts-node src/scripts/repairDhmThrottledProductStates.ts --apply    deletes
 * On a host: docker exec -i klip-backend node dist/scripts/repairDhmThrottledProductStates.js [--apply]
 */
import { query } from '../database/connection';
import { USED_OR_UNDELIVERED_PRODUCTS_SQL } from '../dhm/pushCatalog';

(async () => {
  const apply = process.argv.includes('--apply');
  const keep = `SELECT kept.id FROM (${USED_OR_UNDELIVERED_PRODUCTS_SQL.replace('SELECT p.* FROM products p', 'SELECT p.id FROM products p').replace(/\s+ORDER BY p\.product_name\s*$/, '')}) kept`;
  const where = `s.entity_kind = 'product' AND s.error ILIKE 'Too many requests%' AND s.entity_id NOT IN (${keep})`;
  const before = await query(`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE s.error ILIKE 'Too many requests%')::int AS throttled FROM dhm_push_state s WHERE s.entity_kind = 'product' AND s.status = 'FAILED'`);
  const clear = await query(`SELECT COUNT(*)::int AS n FROM dhm_push_state s WHERE ${where}`);
  console.log('product push states FAILED:', before.rows[0], ' to clear (throttled, product not used, DHM has it):', clear.rows[0].n);
  if (apply) {
    const res = await query(`DELETE FROM dhm_push_state s WHERE ${where}`);
    console.log('deleted', res.rowCount);
  } else {
    console.log('dry run: nothing changed. Pass --apply to delete.');
  }
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
