import { describe, expect, it } from 'vitest';
import { query } from '../../database/connection';
import { SQL_RECONCILE_TRUCKING_STATUS_FROM_SAP } from '../../utils/truckingEffectiveStatus';

/**
 * SQL that only runs on a background path can be broken for a month without anyone noticing.
 *
 * `SQL_RECONCILE_TRUCKING_STATUS_FROM_SAP` referenced the UPDATE target from the ON clause of a
 * join inside FROM - `INNER JOIN contracts c ON c.id = t.contract_id` - which Postgres rejects
 * with 42P01 / errorMissingRTE ("invalid reference to FROM-clause entry for table t"). It failed
 * on every run from 2026-08-12 until 2026-09-08, and the only trace was one warn line in
 * `reconcileTruckingStatusesFromSapIfDue`, which swallows the error so the list keeps working. The
 * cost was silent: SAP's Trucking Start / Last Receive Dates never reached trucking_realizations
 * through this path, and trucking status was never reconciled by it.
 *
 * Nothing in the unit suite could catch it - the connection is mocked there, so a statement that
 * cannot even be planned looks fine. EXPLAIN against a real Postgres is what catches it, and it
 * plans without executing, so this is cheap and touches no data.
 *
 * Add any statement here that the application only issues from a timer, a warmer or a
 * fire-and-forget path.
 */
const BACKGROUND_STATEMENTS: Array<[string, string]> = [
  ['SQL_RECONCILE_TRUCKING_STATUS_FROM_SAP', SQL_RECONCILE_TRUCKING_STATUS_FROM_SAP],
];

describe('background SQL is at least plannable', () => {
  for (const [name, sql] of BACKGROUND_STATEMENTS) {
    it(`${name} plans`, async () => {
      await expect(query(`EXPLAIN ${sql}`)).resolves.toBeDefined();
    });
  }
});
