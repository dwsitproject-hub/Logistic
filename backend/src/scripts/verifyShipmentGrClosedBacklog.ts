/**
 * TEMP: does a GR-closed sea PO with no shipment row now reach the Shipment page?
 *
 * Checks the page as a user meets it - through resolveShipmentsListForRequest - rather than
 * through the SQL builders, because the builders were only half the problem: the ALL view assembles
 * its backlog from its own arms and would have ignored a fixed Completed arm entirely.
 *
 *   PO=1001031325 npx ts-node src/scripts/verifyShipmentGrClosedBacklog.ts
 */
import pool, { query } from '../database/connection';
import { getShipments } from '../controllers/shipment.controller';

const PO = process.env.PO || '1001031325';

type Row = Record<string, unknown>;

async function page(label: string, q: Record<string, string>): Promise<Row[]> {
  const req = {
    query: { page: '1', limit: '100', ...q },
    user: { id: 'diag', role: 'ADMIN', permissions: ['*'] },
  } as never;
  // Through the controller, because that is where the list SQL is actually assembled.
  let payload: { data?: { shipments?: Row[]; pagination?: { total?: number } } } = {};
  const res = {
    json: (body: unknown) => {
      payload = body as typeof payload;
      return res;
    },
    status: () => res,
  } as never;
  const t0 = Date.now();
  await getShipments(req, res);
  const data = payload?.data ?? {};
  const rows = Array.isArray(data?.shipments) ? data.shipments : [];
  console.log(`${label.padEnd(34)} ${String(Date.now() - t0).padStart(6)}ms  total=${data?.pagination?.total ?? '?'}`);
  return rows;
}

function findPo(rows: Row[], po: string): Row | undefined {
  return rows.find((r) =>
    [r.po_number, r.po_numbers, r.contract_number, r.contract_id]
      .map((v) => String(v ?? '').trim())
      .some((v) => v === po || v.split(',').map((x) => x.trim()).includes(po)),
  );
}

async function main(): Promise<void> {
  const ctx = await query(
    `SELECT c.contract_id, c.po_number, c.incoterm, c.status,
            EXISTS (SELECT 1 FROM shipments s WHERE s.contract_id = c.id) AS has_shipment
       FROM contracts c
      WHERE TRIM(c.po_number::text) = TRIM($1) OR TRIM(c.contract_id::text) = TRIM($1)`,
    [PO],
  );
  console.log(`PO under test: ${PO}`);
  console.log(ctx.rows[0] ?? '(not in this database)');
  console.log('');

  const all = await page('ALL (default view)', { search: PO });
  const hitAll = findPo(all, PO);
  console.log(`  -> on the ALL view: ${hitAll ? `YES (status=${String(hitAll.status)})` : 'NO'}`);

  const completed = await page('status=COMPLETED', { search: PO, status: 'COMPLETED' });
  const hitCompleted = findPo(completed, PO);
  console.log(`  -> on the COMPLETED card: ${hitCompleted ? 'YES' : 'NO'}`);

  const unplanned = await page('status=UNPLANNED', { search: PO, status: 'UNPLANNED' });
  console.log(
    `  -> on the UNPLANNED card: ${findPo(unplanned, PO) ? 'YES (WRONG - it is closed)' : 'NO (correct)'}`,
  );

  console.log('');
  console.log('--- page size, to show what this adds ---');
  const totalAll = await page('ALL, no search', {});
  void totalAll;

  await pool.end();
}

main().catch(async (err) => {
  console.error(err);
  await pool.end().catch(() => undefined);
  process.exit(1);
});
