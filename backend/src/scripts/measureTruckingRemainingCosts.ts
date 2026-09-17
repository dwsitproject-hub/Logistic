/**
 * TEMP: what is still slow on Trucking, measured through the endpoint rather than the SQL.
 *
 * The snapshot work took the cold default page from 60.9s to ~3.3s and Section 1 from 34.9s to
 * 70ms. What remains are the requests the snapshot cannot express - they fall back to the live
 * expansion. This measures each of them twice: cold (first touch) and warm (caches primed), since
 * only the cold number is a user's first impression and only the warm one repeats.
 *
 *   npx ts-node src/scripts/measureTruckingRemainingCosts.ts
 */
import pool from '../database/connection';
import { resolveTruckingListForRequest } from '../services/truckingList.service';

type Case = { label: string; q: Record<string, string> };

const CASES: Case[] = [
  { label: 'default (baseline)', q: {} },
  { label: 'region/plant BONTANG', q: { plant: 'BONTANG' } },
  { label: 'global search', q: { search: 'CPO' } },
  { label: 'supplier column filter', q: { colFilters: JSON.stringify({ supplier: ['PT MULIA'] }) } },
  { label: 'loading location', q: { loadingLocation: 'BONTANG' } },
  { label: 'page 2 (expansion)', q: { page: '2' } },
  { label: 'sort by supplier', q: { sortKey: 'supplier', sortDir: 'asc' } },
  { label: 'sort by outstanding qty', q: { sortKey: 'outstanding_quantity', sortDir: 'desc' } },
];

async function run(q: Record<string, string>): Promise<{ ms: number; rows: number; total: unknown }> {
  const req = {
    query: { page: '1', limit: '20', ...q },
    user: { id: 'diag', role: 'ADMIN', permissions: ['*'] },
  } as never;
  const t0 = Date.now();
  const data = (await resolveTruckingListForRequest(req)) as {
    truckingOperations?: unknown[];
    pagination?: { total?: number };
  };
  return {
    ms: Date.now() - t0,
    rows: Array.isArray(data?.truckingOperations) ? data.truckingOperations.length : -1,
    total: data?.pagination?.total ?? '?',
  };
}

async function main(): Promise<void> {
  console.log('');
  console.log('case                            cold      warm   rows  total');
  console.log('---------------------------------------------------------------');
  for (const c of CASES) {
    try {
      const cold = await run(c.q);
      const warm = await run(c.q);
      const flag = cold.ms > 3000 ? '  <-- over 3s' : '';
      console.log(
        `${c.label.padEnd(28)} ${String(cold.ms).padStart(6)}ms ${String(warm.ms).padStart(6)}ms  ` +
          `${String(cold.rows).padStart(4)}  ${String(cold.total).padStart(5)}${flag}`,
      );
    } catch (err) {
      console.log(`${c.label.padEnd(28)} FAILED: ${(err as Error).message.slice(0, 60)}`);
    }
  }
  await pool.end();
}

main().catch(async (err) => {
  console.error(err);
  await pool.end().catch(() => undefined);
  process.exit(1);
});
