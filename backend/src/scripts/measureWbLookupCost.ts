/**
 * TEMP: which of the WB upload's pre-loop lookups costs the 47 seconds?
 *
 * Production's stage timings put 46.9s of 48.0s inside the batched lookups - the per-row apply
 * loop was 687ms for 741 rows, so the writes are not the problem. This times the two expressions
 * those lookups are built on, over a realistic candidate list, to find which one carries it.
 *
 *   POS=250 npx ts-node src/scripts/measureWbLookupCost.ts
 */
import pool, { query } from '../database/connection';
import { contractEffectiveIncotermExpr } from '../utils/truckingIncotermScope';
import { SQL_CONTRACT_IMPORT_STATUS } from '../utils/contractDeliveryStatus';
import { sqlTruckingOpIsActiveForMatchingSql } from '../utils/truckingOperationUniqueness';

const POS = Number(process.env.POS || 250);

async function time(label: string, sql: string, params: unknown[]): Promise<void> {
  const t0 = Date.now();
  const res = await query(sql, params as never[]);
  console.log(`${label.padEnd(46)} ${String(Date.now() - t0).padStart(7)}ms  rows=${res.rowCount}`);
}

async function main(): Promise<void> {
  const picked = await query(
    `SELECT DISTINCT TRIM(c.po_number::text) AS po
       FROM contracts c
      WHERE NULLIF(TRIM(c.po_number::text), '') IS NOT NULL
      ORDER BY 1 DESC
      LIMIT $1`,
    [POS],
  );
  const pos = picked.rows.map((r) => String((r as { po: string }).po));
  console.log(`candidate POs: ${pos.length}`);
  console.log('');

  const inc = contractEffectiveIncotermExpr('c');

  // 1. findTruckingOpsByPoForWbImportBatch - effective incoterm twice, in SELECT and WHERE.
  await time(
    'ops by PO (effective incoterm x2)',
    `SELECT t.id, ${inc} AS incoterm
       FROM trucking_operations t
       INNER JOIN contracts c ON c.id = t.contract_id
      WHERE ${sqlTruckingOpIsActiveForMatchingSql('t')}
        AND TRIM(COALESCE(c.po_number::text, '')) = ANY($1::text[])
        AND ${inc} IN ('FRC', 'LCO')`,
    [pos],
  );

  // Same shape with the incoterm fallback removed, to price the fallback itself.
  await time(
    '  ... same, contracts.incoterm only',
    `SELECT t.id, c.incoterm
       FROM trucking_operations t
       INNER JOIN contracts c ON c.id = t.contract_id
      WHERE ${sqlTruckingOpIsActiveForMatchingSql('t')}
        AND TRIM(COALESCE(c.po_number::text, '')) = ANY($1::text[])
        AND UPPER(TRIM(COALESCE(c.incoterm, ''))) IN ('FRC', 'LCO')`,
    [pos],
  );

  // 2. batchFetchContractDiagnostics - the 26KB import-status expression, once per contract.
  await time(
    'contract diagnostics (import status expr)',
    `SELECT TRIM(COALESCE(c.po_number::text, '')) AS po_number,
            ${SQL_CONTRACT_IMPORT_STATUS} AS import_status
       FROM contracts c
      WHERE TRIM(COALESCE(c.po_number::text, '')) = ANY($1::text[])`,
    [pos],
  );

  await time(
    '  ... same, without import status',
    `SELECT TRIM(COALESCE(c.po_number::text, '')) AS po_number, c.transport_mode
       FROM contracts c
      WHERE TRIM(COALESCE(c.po_number::text, '')) = ANY($1::text[])`,
    [pos],
  );

  await pool.end();
}

main().catch(async (err) => {
  console.error(err);
  await pool.end().catch(() => undefined);
  process.exit(1);
});
