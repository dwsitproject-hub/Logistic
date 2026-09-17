/**
 * Startup warmers for the Shipments page's two expensive calls.
 *
 * The Shipments page issues four requests per load. Measured on a local restore of staging
 * (2026-08-06), cold vs warm:
 *
 *   shell   (compact, skipSapJoin=true)   733ms  ->    8ms
 *   hydrate (compact, skipSapJoin=false) 1746ms  ->    5ms
 *   summaryOnly                         16823ms  -> 1547ms   <-- warmer + daily snapshot
 *   outstandingQtyOnly                   8338ms  ->    8ms
 *
 * Section 1 now reads the daily snapshot even when marked stale (live stage overlay still
 * runs). Table paging still requires a fresh snapshot.
 *
 * The compact list shell is first in the startup warmup queue (created_at + persisted
 * vessel_name) so a Shipments visitor after restart is not waiting behind Shipping
 * Performance. Section 1 summary/OS no longer join list-grain sto_metrics/sap_agg
 * (qty_move only); cold times above are the pre-change baseline.
 *
 * These call the real request handler with a synthetic request, exactly as the Trucking warmer
 * does. That matters: it populates the same cache entries a browser hits, through the identical
 * code path, so there is no second implementation to drift out of sync. Nothing is computed
 * differently - the only difference is that it happens before a user asks.
 *
 * After default YTD warm, we also warm a few high-traffic plant×product toolbar scopes so the
 * common "filter to CPO / Bontang" path is not a full cold miss.
 */

import type { Response } from 'express';
import { getShipments } from '../controllers/shipment.controller';
import {
  primeCompactShipmentScope,
  readShipmentScopeRows,
  type ScopePageLoader,
} from './shipmentListNodePage.service';
import {
  setShipmentRowSetReloader,
  startShipmentRowSetKeepWarm,
} from './shipmentListRowSetCache';
import type { AuthRequest } from '../middleware/auth';
import logger from '../utils/logger';

/**
 * Default global-filter window used by the Shipments page: 1 January of the current year to
 * today. Computed in Jakarta time (UTC+7) to match the browser's local date for this team - a
 * UTC-based date would be a day behind for the first 7 hours and would warm a cache key nobody
 * requests. Mirrors startTruckingListCacheWarmer.
 */
function defaultShipmentsDateRange(): { dateFrom: string; dateTo: string } {
  const jakartaNow = new Date(Date.now() + 7 * 60 * 60 * 1000);
  const dateTo = jakartaNow.toISOString().slice(0, 10);
  const dateFrom = `${dateTo.slice(0, 4)}-01-01`;
  return { dateFrom, dateTo };
}

/**
 * Response stand-in. The handler's payload is discarded - we run it purely for the cache write
 * it performs on the way. Methods are chainable no-ops so the handler cannot fail on a missing
 * Express method, and `headersSent` stays false so its normal path is taken.
 */
function createDiscardingResponse(): Response {
  const res: Record<string, unknown> = {
    headersSent: false,
    locals: {},
    statusCode: 200,
  };
  const chainable = () => res as unknown as Response;
  for (const method of [
    'status',
    'json',
    'send',
    'set',
    'setHeader',
    'type',
    'vary',
    'end',
    'append',
    'contentType',
  ]) {
    res[method] = chainable;
  }
  return res as unknown as Response;
}

/**
 * The query a default browser load sends, as the warmers replay it. Exported so a test can lock
 * it against the frontend's defaults - `shipments.compact.sort` defaults to created_at/desc in
 * `frontend/src/lib/shipmentsCompactSort.ts`, and the page sends compact/limit/page/includeSummary
 * exactly as below. If either side drifts, the warmers populate a key nobody reads.
 */
export function shipmentWarmerBaseQuery(
  extraQuery: Record<string, string | string[]> = {},
): Record<string, string | string[]> {
  const { dateFrom, dateTo } = defaultShipmentsDateRange();
  return {
    compact: 'true',
    skipSapJoin: 'true',
    includeSummary: 'false',
    limit: '20',
    page: '1',
    sortKey: 'created_at',
    sortDir: 'desc',
    dateFrom,
    dateTo,
    ...extraQuery,
  };
}

function buildSyntheticRequest(extraQuery: Record<string, string | string[]>): AuthRequest {
  return {
    // Must match the query the browser sends on a default load, or we warm a key nobody reads.
    query: shipmentWarmerBaseQuery(extraQuery),
    headers: {},
    get: () => undefined,
  } as unknown as AuthRequest;
}

async function warmOne(label: string, extraQuery: Record<string, string | string[]>): Promise<void> {
  try {
    await getShipments(buildSyntheticRequest(extraQuery), createDiscardingResponse());
  } catch (error) {
    // A warm-up failure must never affect startup - the page just stays slow until requested.
    logger.warn(`Shipments ${label} warm-up failed`, { error });
  }
}

function productColumnFilters(products: string[]): string {
  return JSON.stringify({
    product: { type: 'multi', values: products, includeBlank: false },
  });
}

/** High-traffic toolbar scopes (same shape as browser: plant[] + columnFilters.product). */
export const SHIPMENT_WARM_TOOLBAR_SCOPES: ReadonlyArray<{
  label: string;
  plants?: string[];
  products?: string[];
}> = [
  { label: 'default YTD' },
  { label: 'CPO', products: ['CPO'] },
  { label: 'Bontang', plants: ['Bontang'] },
  { label: 'CPO×Bontang', plants: ['Bontang'], products: ['CPO'] },
];

function scopeToExtraQuery(scope: {
  plants?: string[];
  products?: string[];
}): Record<string, string | string[]> {
  const extra: Record<string, string | string[]> = {};
  if (scope.plants && scope.plants.length > 0) {
    extra.plant = scope.plants.length === 1 ? scope.plants[0]! : scope.plants;
  }
  if (scope.products && scope.products.length > 0) {
    extra.columnFilters = productColumnFilters(scope.products);
  }
  return extra;
}

/**
 * Compact list shell (skipSapJoin) — default created_at then persisted vessel_name sort.
 *
 * The hydrate variant is warmed too. `skipSapJoin` is part of the list cache key, and every
 * warmer here inherits `skipSapJoin: 'true'` from buildSyntheticRequest, so before this the
 * page's second call (`skipSapJoin=false`, measured at 15.9s cold) was never warmed and the
 * first visitor always paid for it. Only the default sort is hydrated: it is the expensive
 * variant, and a persisted non-default sort is picked up by PAGE_KEEP_WARM after its first use.
 */
export async function startShipmentListShellCacheWarmer(): Promise<void> {
  await warmOne('list shell', { sortKey: 'created_at', sortDir: 'desc' });
  await warmOne('list shell vessel_name', { sortKey: 'vessel_name', sortDir: 'asc' });
  await warmOne('list hydrate', { skipSapJoin: 'false', sortKey: 'created_at', sortDir: 'desc' });
}

/**
 * Run one scope page through the real list handler with no request behind it.
 *
 * The row-set cache reloads scopes long after the request that first asked for one has ended, so
 * the loader it is given must not close over an Express request. This builds a fresh synthetic
 * one per page, exactly as the other warmers here do.
 */
const syntheticScopePageLoader: ScopePageLoader = async (scopeQuery) => {
  let body: unknown;
  const capture = {
    statusCode: 200,
    status() {
      return capture;
    },
    json(payload: unknown) {
      body = payload;
      return capture;
    },
    setHeader() {
      return capture;
    },
    send() {
      return capture;
    },
  };
  await getShipments(
    { query: scopeQuery, headers: {}, get: () => undefined } as unknown as AuthRequest,
    capture as unknown as Response,
  );
  const data = (body as { data?: { shipments?: unknown[] } } | undefined)?.data;
  return { rows: (data?.shipments ?? []) as Record<string, unknown>[] };
};

/**
 * Load the row sets the status cards are derived from.
 *
 * A status-filtered page can be answered from a scope row set in single-digit milliseconds, but
 * only if that set is already loaded - a request never loads it, because the scope is the
 * *unfiltered* view and costs more than the filtered query it would replace (measured: the first
 * status click went 12.4s to 60.8s when the request did the loading). So the warmer does it.
 *
 * Two scopes: the shell and the hydrate variant, since skipSapJoin changes the row contents.
 * Everything else about the default view is already in the base query.
 *
 * Keeping them loaded is the cache's job, not this function's: the reloader is registered and the
 * refresh-ahead timer started *before* the first load, so a SAP import arriving mid-warm already
 * triggers a rebuild rather than leaving the cache empty until someone clicks a status card.
 */
export async function startShipmentRowSetScopeWarmer(): Promise<void> {
  setShipmentRowSetReloader((scopeQuery) =>
    readShipmentScopeRows(scopeQuery, syntheticScopePageLoader),
  );
  startShipmentRowSetKeepWarm();

  for (const skipSapJoin of ['true', 'false']) {
    const query = shipmentWarmerBaseQuery({ skipSapJoin });
    try {
      const primed = await primeCompactShipmentScope({
        query,
        loadScopePage: syntheticScopePageLoader,
      });
      logger.info('Shipments scope row set warmed', {
        skipSapJoin,
        rows: primed.rows,
      });
    } catch (error) {
      logger.warn('Shipments scope row-set warm-up failed', { skipSapJoin, error });
    }
  }
}

/**
 * Section 1 status cards (the 16.8s call) — default YTD only.
 *
 * `limit: '1'` is not cosmetic. The page sends limit=1 for this call, and the Unplanned
 * breakdown caches under `${shipmentCtx.cacheKey}:breakdown:...` - a *list* cache key, which
 * includes limit. Warming with the default limit=20 populated the summary row (keyed by the
 * limit-independent filter key) but not the breakdown, so the first visitor still paid 4.7s for
 * the four breakdown queries.
 */
export function startShipmentSummaryCacheWarmer(): Promise<void> {
  return warmOne('summary', { summaryOnly: 'true', limit: '1' });
}

/** Outstanding Qty strip (the 8.3s call) — default YTD only. Same limit=1 as the page sends. */
export function startShipmentOutstandingQtyCacheWarmer(): Promise<void> {
  return warmOne('outstanding qty', { outstandingQtyOnly: 'true', limit: '1' });
}

/**
 * Warm summaryOnly + outstandingQtyOnly for top plant×product scopes after the default warm.
 * Runs sequentially so we do not stampede the DB pool at boot.
 */
export async function startShipmentScopedToolbarCacheWarmer(): Promise<void> {
  for (const scope of SHIPMENT_WARM_TOOLBAR_SCOPES) {
    if (!scope.plants?.length && !scope.products?.length) continue;
    const extra = scopeToExtraQuery(scope);
    await warmOne(`summary (${scope.label})`, { ...extra, summaryOnly: 'true', limit: '1' });
    await warmOne(`outstanding qty (${scope.label})`, {
      ...extra,
      outstandingQtyOnly: 'true',
      limit: '1',
    });
  }
}
