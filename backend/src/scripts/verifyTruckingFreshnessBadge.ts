/**
 * TEMP: does the page report its as-of on the filtered paths, not just the unfiltered one?
 *
 * The badge is the page's only statement about how old the card quantities are. It was emitted
 * from the daily-summary branch alone, so applying a Region/Plant filter - or any filter the
 * daily aggregate cannot express - silently dropped it, while the figures stayed exactly as old.
 *
 *   npx ts-node src/scripts/verifyTruckingFreshnessBadge.ts
 */
import pool from '../database/connection';
import { resolveTruckingListForRequest } from '../services/truckingList.service';

type Summary = { summaryFreshness?: { source?: string; asOf?: string | null; isStale?: boolean } };

async function check(label: string, q: Record<string, string>): Promise<boolean> {
  const req = {
    query: { page: '1', limit: '20', ...q },
    user: { id: 'diag', role: 'ADMIN', permissions: ['*'] },
  } as never;
  const t0 = Date.now();
  const data = (await resolveTruckingListForRequest(req)) as { summary?: Summary };
  const ms = Date.now() - t0;
  const f = data?.summary?.summaryFreshness;
  const ok = Boolean(f && typeof f.source === 'string');
  console.log(
    `${ok ? 'OK  ' : 'MISS'} ${label.padEnd(34)} ${String(ms).padStart(6)}ms  ` +
      (f ? `source=${f.source} isStale=${f.isStale} asOf=${f.asOf ?? 'null'}` : 'summaryFreshness ABSENT'),
  );
  return ok;
}

async function main(): Promise<void> {
  const results: boolean[] = [];
  results.push(await check('no filter (daily path)', {}));
  results.push(await check('plant=BONTANG', { plant: 'BONTANG' }));
  results.push(await check('plant=TANJUNG PURA', { plant: 'TANJUNG PURA' }));
  results.push(await check('sourceType=Interco', { sourceType: 'Interco' }));
  results.push(await check('status=COMPLETED', { status: 'COMPLETED' }));
  results.push(await check('lateIndicator=LATE', { lateIndicator: 'LATE' }));
  results.push(await check('product=CPO + plant=BONTANG', { product: 'CPO', plant: 'BONTANG' }));

  const missing = results.filter((r) => !r).length;
  console.log('');
  console.log(missing === 0 ? 'all paths report an as-of' : `${missing} path(s) still drop the badge`);
  await pool.end();
  process.exit(missing === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error(err);
  await pool.end().catch(() => undefined);
  process.exit(1);
});
