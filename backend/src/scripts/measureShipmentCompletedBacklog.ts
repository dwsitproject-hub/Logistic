/**
 * TEMP: how many rows would each half of "option B" add to the Shipment page?
 *
 * Two separate gates keep a GR-closed sea PO with no shipment off the page:
 *   1. the Completed backlog arm reuses the core WHERE, which excludes GR-closed contracts
 *   2. the ALL view's backlog is unplanned + preplanned only - the Completed arm never feeds it
 *
 * Fixing one without the other changes nothing a user would notice, so both numbers matter
 * before either is touched.
 *
 *   npx ts-node src/scripts/measureShipmentCompletedBacklog.ts
 */
import pool, { query } from '../database/connection';
import { buildShipmentPageSeaIncotermScopeSql } from '../utils/shipmentIncotermScope';
import {
  sqlIsContractSapCancelledExpr,
  sqlIsContractSapClosedForShipmentBacklogExpr,
  sqlIsContractSapInactiveForShipmentBacklogExpr,
} from '../utils/contractDeliveryStatus';
import { sqlContractSharesNumericStoWithActiveSeaShipmentExpr } from '../utils/seaStoSiblingSql';
import { sqlContractHasNoRegisteredEtaExpr } from '../utils/shipmentPagePipelineSql';

const sea = buildShipmentPageSeaIncotermScopeSql('c');
const inactive = sqlIsContractSapInactiveForShipmentBacklogExpr('c');
const cancelled = sqlIsContractSapCancelledExpr('c');
const grClosed = sqlIsContractSapClosedForShipmentBacklogExpr('c');
const noEta = sqlContractHasNoRegisteredEtaExpr('c');
const sibling = sqlContractSharesNumericStoWithActiveSeaShipmentExpr('c.id');

/** Everything the backlog needs except the GR-status gate, which is what this measures. */
const commonBacklog = `
  ${sea}
  AND ${noEta}
  AND NOT EXISTS (SELECT 1 FROM shipments s_ns WHERE s_ns.contract_id = c.id)
  AND NOT (${sibling})
`;

async function count(label: string, where: string): Promise<void> {
  const sql = `SELECT COUNT(*)::int AS n, COALESCE(SUM(COALESCE(c.quantity_ordered,0)),0)::numeric AS qty
               FROM contracts c WHERE ${where}`;
  const t0 = Date.now();
  const res = await query(sql);
  const row = res.rows[0] as { n: number; qty: string };
  console.log(
    `${label.padEnd(52)} ${String(row.n).padStart(6)} kontrak  ` +
      `${(Number(row.qty) / 1000).toFixed(0).padStart(9)} MT  (${Date.now() - t0}ms)`,
  );
}

async function main(): Promise<void> {
  console.log('');
  console.log('--- backlog sea tanpa shipment row, dipecah menurut status GR ---');
  await count('GR masih Open (muncul sekarang, kartu Unplanned)', `${commonBacklog} AND NOT (${inactive})`);
  await count('GR Close (TIDAK muncul di mana pun sekarang)', `${commonBacklog} AND ${grClosed} AND NOT (${cancelled})`);
  await count('Cancelled (punya lengannya sendiri)', `${commonBacklog} AND ${cancelled}`);

  console.log('');
  console.log('--- berapa yang akan bertambah di halaman ALL ---');
  await count(
    'baris baru di ALL kalau lengan Completed ikut dimuat',
    `${commonBacklog} AND ${grClosed} AND NOT (${cancelled})`,
  );

  console.log('');
  console.log('--- sebagai pembanding: ukuran halaman sekarang ---');
  const exec = await query(
    `SELECT COUNT(*)::int AS n FROM shipments s
      JOIN contracts c ON c.id = s.contract_id
     WHERE COALESCE(c.sap_presence,'PRESENT') = 'PRESENT'`,
  );
  console.log(`baris eksekusi (punya shipment row)                  ${String((exec.rows[0] as { n: number }).n).padStart(6)} shipment`);

  await pool.end();
}

main().catch(async (err) => {
  console.error(err);
  await pool.end().catch(() => undefined);
  process.exit(1);
});
