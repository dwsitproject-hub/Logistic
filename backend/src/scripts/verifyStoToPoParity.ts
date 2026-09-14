/**
 * TEMP: prove the rewritten STO -> PO batch lookup returns exactly what the old one did.
 *
 * The old form asked, per key, "scan contracts, keep the first matching any of three ORed
 * conditions". The new one joins each condition separately and picks the winner with DISTINCT ON.
 * Faster is worthless if it answers differently, so this runs both over the same keys and
 * compares every row.
 *
 *   KEYS=2000 npx ts-node src/scripts/verifyStoToPoParity.ts
 */
import pool, { query } from '../database/connection';
import { SQL_RESOLVE_PO_FROM_STO_BATCH } from '../utils/truckingPoStoIdentitySql';
import { SPD_EFFECTIVE_STO_SQL } from '../utils/contractLogisticsStoDetailSql';

const KEYS = Number(process.env.KEYS || 2000);

/** The previous implementation, kept here only so the two can be compared. */
const OLD_SQL = `
  SELECT
    x.sto_key,
    (
      SELECT NULLIF(TRIM(c.po_number::text), '')
      FROM contracts c
      WHERE COALESCE(c.po_number, '') != ''
        AND (
          EXISTS (
            SELECT 1 FROM contract_stos cs
            WHERE cs.contract_id = c.id
              AND TRIM(cs.sto_number::text) = x.sto_key
          )
          OR TRIM(COALESCE(c.sto_number::text, '')) = x.sto_key
          OR EXISTS (
            SELECT 1 FROM sap_processed_data spd
            WHERE TRIM(spd.contract_number) = TRIM(c.contract_id::text)
              AND TRIM(${SPD_EFFECTIVE_STO_SQL}) = x.sto_key
          )
        )
      ORDER BY c.contract_date DESC NULLS LAST, c.updated_at DESC NULLS LAST
      LIMIT 1
    ) AS po_number
  FROM UNNEST($1::text[]) AS x(sto_key)
`;

async function run(label: string, sql: string, keys: string[]) {
  const t0 = Date.now();
  const res = await query(sql, [keys] as never[]);
  const ms = Date.now() - t0;
  const map = new Map<string, string | null>();
  for (const row of res.rows as Array<{ sto_key: string; po_number: string | null }>) {
    map.set(String(row.sto_key), row.po_number ?? null);
  }
  console.log(`${label.padEnd(12)} ${String(ms).padStart(8)}ms  rows=${res.rowCount}`);
  return { map, ms };
}

async function main(): Promise<void> {
  /*
   * Real STO keys, from the same three places the lookup searches - otherwise the comparison only
   * exercises the "no match" path, which is the easy one.
   */
  const picked = await query(
    `SELECT sto_key FROM (
       SELECT DISTINCT TRIM(cs.sto_number::text) AS sto_key FROM contract_stos cs
       UNION
       SELECT DISTINCT TRIM(c.sto_number::text) FROM contracts c
       UNION
       SELECT DISTINCT TRIM(d.sto_number) FROM trucking_daily_actuals d
     ) x
     WHERE NULLIF(sto_key, '') IS NOT NULL
     LIMIT $1`,
    [KEYS],
  );
  const keys = picked.rows.map((r) => String((r as { sto_key: string }).sto_key));
  console.log(`STO keys under test: ${keys.length}`);
  console.log('');

  const oldRun = await run('old', OLD_SQL, keys);
  const newRun = await run('new', SQL_RESOLVE_PO_FROM_STO_BATCH, keys);

  let differing = 0;
  let missing = 0;
  for (const [key, oldPo] of oldRun.map) {
    if (!newRun.map.has(key)) {
      missing++;
      continue;
    }
    const newPo = newRun.map.get(key) ?? null;
    if ((oldPo ?? null) !== newPo) {
      if (differing < 10) console.log(`  DIFF ${key}: old=${oldPo ?? 'NULL'} new=${newPo ?? 'NULL'}`);
      differing++;
    }
  }
  for (const key of newRun.map.keys()) {
    if (!oldRun.map.has(key)) missing++;
  }

  console.log('');
  console.log(`keys only in one side : ${missing}`);
  console.log(`values differing      : ${differing}`);
  console.log(
    differing === 0 && missing === 0
      ? `PARITY OK - ${oldRun.ms}ms -> ${newRun.ms}ms`
      : 'PARITY FAILED',
  );

  await pool.end();
  process.exit(differing === 0 && missing === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error(err);
  await pool.end().catch(() => undefined);
  process.exit(1);
});
