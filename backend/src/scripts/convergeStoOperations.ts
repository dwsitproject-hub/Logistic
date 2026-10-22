/**
 * One STO, one operation: pull the SAP-assigned rows of the given STOs onto the operation the STO's other rows share.
 * Same rule as the SAP import (utils/sapShellOperationId.ts convergeStoOperationIds): only OP-SEA ids KLIP assigned itself (operation_id_source = 'SAP_IMPORT')
 * move, only to an operation with the same vessel, never out of an operation another STO shares, never a user-planned row.
 *
 * Dry-run by default: the change runs inside a transaction that is rolled back, and the rows before/after are printed.
 *
 * Usage (inside the backend container):
 *   node dist/scripts/convergeStoOperations.js --sto 1006020605 --sto 1006020667 --sto 1016011511
 *   node dist/scripts/convergeStoOperations.js --sto 1006020605 --sto 1006020667 --sto 1016011511 --apply
 */
import { getClient } from '../database/connection';
import { convergeStoOperationIds } from '../utils/sapShellOperationId';

async function snapshot(client: { query: (t: string, p?: unknown[]) => Promise<{ rows: unknown[] }> }, stos: string[]) {
  const r = await client.query(
    `SELECT s.shipment_id AS sto, c.po_number AS po, s.operation_id AS op, s.operation_id_source AS src, s.vessel_name AS vessel, s.status
       FROM shipments s JOIN contracts c ON c.id = s.contract_id
      WHERE s.shipment_id = ANY($1::text[]) AND COALESCE(s.status, '') <> 'CANCELLED'
      ORDER BY s.shipment_id, s.operation_id, c.po_number`,
    [stos],
  );
  return r.rows;
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const stos: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--sto' && args[i + 1] && !args[i + 1].startsWith('--')) stos.push(args[i + 1].trim());
  }
  if (stos.length === 0 || stos.some((s) => !/^[0-9]+$/.test(s))) {
    console.error('Usage: --sto <digits> [--sto <digits> ...] [--apply]');
    process.exit(1);
  }

  const client = await getClient();
  try {
    await client.query('BEGIN');
    console.log('--- BEFORE ---');
    console.table(await snapshot(client, stos));
    const moved: Record<string, number> = {};
    for (const sto of stos) moved[sto] = await convergeStoOperationIds(client, sto);
    console.log('--- AFTER ---');
    console.table(await snapshot(client, stos));
    console.log('rows moved per STO:', JSON.stringify(moved));
    if (apply) {
      await client.query('COMMIT');
      console.log('APPLIED (committed).');
    } else {
      await client.query('ROLLBACK');
      console.log('DRY-RUN: rolled back, nothing changed. Re-run with --apply to commit.');
    }
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    console.error((e as Error).message);
    process.exitCode = 1;
  } finally {
    client.release();
    process.exit(process.exitCode ?? 0);
  }
}

void main();
