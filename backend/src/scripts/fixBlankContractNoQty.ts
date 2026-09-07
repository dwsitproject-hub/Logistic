/**
 * Repair Contract Qty on contracts that a blank-Contract-No SAP row understated.
 *
 * SAP emits STO-level rows whose "Contract No." is blank, and in those rows the
 * "Contract Quantity" column carries the STO quantity, not the contract quantity. Klip matches
 * contracts by PO number, so before the guard in sapDataDistribution.service those rows
 * overwrote the real figure (PO 1001030860 stored 4,820 kg instead of 1,000,000 kg).
 *
 * A fresh import repairs a contract only when the new file still contains that PO's named row.
 * The ones whose named row has dropped out of recent exports stay wrong, and this fixes those:
 * it takes the Contract Quantity from the PO's named SAP rows, which the guard now protects.
 *
 * Dry run by default - prints every row it would change and totals, writes nothing.
 * Pass --apply to write, in one transaction, and refresh the snapshots that feed the pages.
 *
 *   npx ts-node src/scripts/fixBlankContractNoQty.ts
 *   npx ts-node src/scripts/fixBlankContractNoQty.ts --apply
 */
import { getClient, query } from '../database/connection';
import { ContractQtyMoveSnapshotService } from '../services/contractQtyMoveSnapshot.service';
import { ContractPerformanceSnapshotService } from '../services/contractPerformanceSnapshot.service';
import logger from '../utils/logger';

/**
 * Only contracts carrying the bug's signature: the PO has a blank-Contract-No row AND a named
 * row whose Contract Quantity is larger than what is stored. Never lowers a value.
 */
const CANDIDATES_SQL = `
  WITH blank_rows AS (
    SELECT DISTINCT po_number
    FROM sap_processed_data
    WHERE COALESCE(NULLIF(TRIM(contract_number), ''), '') = ''
      AND COALESCE(TRIM(po_number), '') <> ''
  ),
  named AS (
    SELECT
      po_number,
      MAX(REPLACE(data->'raw'->>'Contract Quantity', ',', '')::numeric) AS sap_qty,
      MAX(UPPER(TRIM(COALESCE(data->'raw'->>'Contract Qty UoM', '')))) AS sap_uom
    FROM sap_processed_data
    WHERE COALESCE(NULLIF(TRIM(contract_number), ''), '') <> ''
      AND data->'raw'->>'Contract Quantity' IS NOT NULL
    GROUP BY po_number
  )
  SELECT
    c.id,
    c.contract_id,
    c.po_number,
    c.quantity_ordered::numeric AS klip_qty,
    c.unit_price::numeric AS unit_price,
    c.contract_value::numeric AS contract_value,
    n.sap_qty,
    n.sap_uom,
    /* normalizeSapQtyToKg: MT-family UOMs are already MT, everything else is taken as kg. */
    (CASE WHEN n.sap_uom IN ('MT', 'TO', 'TON', 'TONS', 'T') THEN n.sap_qty * 1000 ELSE n.sap_qty END)
      AS sap_qty_kg
  FROM blank_rows b
  JOIN named n ON n.po_number = b.po_number
  JOIN contracts c ON c.po_number = b.po_number
  WHERE c.quantity_ordered <
    (CASE WHEN n.sap_uom IN ('MT', 'TO', 'TON', 'TONS', 'T') THEN n.sap_qty * 1000 ELSE n.sap_qty END)
  ORDER BY
    (CASE WHEN n.sap_uom IN ('MT', 'TO', 'TON', 'TONS', 'T') THEN n.sap_qty * 1000 ELSE n.sap_qty END)
      - c.quantity_ordered DESC`;

interface Candidate {
  id: string;
  contract_id: string;
  po_number: string;
  klip_qty: string;
  unit_price: string | null;
  contract_value: string | null;
  sap_qty_kg: string;
  sap_uom: string | null;
}

const fmt = (v: unknown) => Number(v ?? 0).toLocaleString('en-US', { maximumFractionDigits: 0 });

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const res = await query(CANDIDATES_SQL);
  const rows = res.rows as unknown as Candidate[];

  if (rows.length === 0) {
    console.log('[FIXQTY] nothing to correct - no contract is understated by a blank-Contract-No row');
    process.exit(0);
  }

  console.log(`[FIXQTY] ${apply ? 'APPLYING' : 'DRY RUN'} - ${rows.length} contract(s) to correct\n`);
  console.log(
    `${'CONTRACT'.padEnd(13)}${'PO'.padEnd(13)}${'STORED (kg)'.padStart(14)}` +
    `${'SAP (kg)'.padStart(14)}${'GAIN (kg)'.padStart(14)}  UOM`,
  );
  let totalGain = 0;
  for (const r of rows) {
    const gain = Number(r.sap_qty_kg) - Number(r.klip_qty);
    totalGain += gain;
    console.log(
      `${r.contract_id.padEnd(13)}${String(r.po_number).padEnd(13)}` +
      `${fmt(r.klip_qty).padStart(14)}${fmt(r.sap_qty_kg).padStart(14)}${fmt(gain).padStart(14)}  ${r.sap_uom ?? '-'}`,
    );
  }
  console.log(`\n[FIXQTY] total understatement: ${fmt(totalGain)} kg across ${rows.length} contract(s)`);

  if (!apply) {
    console.log('[FIXQTY] dry run - nothing written. Re-run with --apply to write.');
    process.exit(0);
  }

  const client = await getClient();
  let updated = 0;
  try {
    await client.query('BEGIN');
    for (const r of rows) {
      /** contract_value follows quantity only when a unit price is known; otherwise left alone. */
      const upd = await client.query(
        `UPDATE contracts
         SET quantity_ordered = $2::numeric,
             contract_value = CASE
               WHEN unit_price IS NOT NULL THEN $2::numeric * unit_price
               ELSE contract_value
             END,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $1::uuid`,
        [r.id, r.sap_qty_kg],
      );
      updated += upd.rowCount ?? 0;
    }
    await client.query('COMMIT');
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // connection may already be unusable
    }
    logger.error('[FIXQTY] correction failed - nothing written', { err });
    throw err;
  } finally {
    client.release();
  }
  console.log(`[FIXQTY] updated ${updated} contract row(s)`);

  /** OS and the cards read these, so a correction is invisible until they are rebuilt. */
  const contractNumbers = rows.map((r) => r.contract_id);
  await ContractQtyMoveSnapshotService.refreshForContracts(contractNumbers);
  await ContractPerformanceSnapshotService.refreshForContracts(contractNumbers);
  console.log(`[FIXQTY] refreshed qty_move + Contract Performance snapshots for ${contractNumbers.length} contract(s)`);
  process.exit(0);
}

main().catch((err) => {
  console.error('[FIXQTY] FAILED', err instanceof Error ? err.message : err);
  process.exit(1);
});
