/**
 * Apply SAP presence state outside an import - for the initial backlog, or after a review.
 *
 *   npm run sap:presence:apply -- --dry-run
 *   npm run sap:presence:apply
 *   npm run sap:presence:apply -- --extra-pos=1581000939,1001030031
 *
 * --extra-pos withdraws POs a human explicitly approved even though the automatic rule left
 * them for review (no GR status recorded). Use it only for a reviewed list.
 */

import { getClient, query } from '../database/connection';
import logger from '../utils/logger';
import { applyPresenceState } from '../services/sapPresence.service';

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : undefined;
}
const has = (name: string) => process.argv.includes(`--${name}`);

async function snapshot(): Promise<Record<string, number>> {
  const res = await query(
    `SELECT
       COUNT(*) FILTER (WHERE sap_presence = 'PRESENT')::int   AS present,
       COUNT(*) FILTER (WHERE sap_presence = 'WITHDRAWN')::int AS withdrawn,
       COALESCE(ROUND(SUM(COALESCE(quantity_ordered,0)) FILTER (WHERE sap_presence = 'WITHDRAWN')::numeric/1000, 1), 0) AS withdrawn_mt
     FROM contracts`,
  );
  return res.rows[0];
}

async function main(): Promise<void> {
  const dryRun = has('dry-run');
  const extraPos = (arg('extra-pos') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const before = await snapshot();
  console.log('\nBefore:', before);
  if (extraPos.length > 0) {
    console.log(`Human-approved extra POs to withdraw: ${extraPos.length}`);
  }

  const client = await getClient();
  try {
    await client.query('BEGIN');
    const outcome = await applyPresenceState(client, { extraPos });
    console.log('\nOutcome:', outcome);

    if (dryRun) {
      await client.query('ROLLBACK');
      console.log('\n--dry-run: rolled back, nothing changed.');
      return;
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  const after = await snapshot();
  console.log('After :', after);
  console.log(
    `\nWithdrawn contracts: ${before.withdrawn} -> ${after.withdrawn} ` +
      `(${after.withdrawn_mt} MT now excluded from totals)`,
  );
  console.log('Reversible: a PO reappearing in SAP restores it automatically.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error('applySapPresence failed', err);
    console.error(err);
    process.exit(1);
  });
