/**
 * Startup warmers for the Shipments page's two expensive calls.
 *
 * The Shipments page issues four requests per load. Measured on a local restore of staging
 * (2026-08-06), cold vs warm:
 *
 *   shell   (compact, skipSapJoin=true)   733ms  ->    8ms
 *   hydrate (compact, skipSapJoin=false) 1746ms  ->    5ms
 *   summaryOnly                         16823ms  -> 1547ms   <-- no warmer existed
 *   outstandingQtyOnly                   8338ms  ->    8ms   <-- no warmer existed
 *
 * The list itself was already cached and fast. The two summary calls were not warmed at all, so
 * the first visitor after every restart paid ~25s across them - on the page the team opens most.
 * Shipping Performance, Oil Loss and Trucking already had warmers; Shipments did not.
 *
 * These call the real request handler with a synthetic request, exactly as the Trucking warmer
 * does. That matters: it populates the same cache entries a browser hits, through the identical
 * code path, so there is no second implementation to drift out of sync. Nothing is computed
 * differently - the only difference is that it happens before a user asks.
 */

import type { Response } from 'express';
import { getShipments } from '../controllers/shipment.controller';
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

function buildSyntheticRequest(extraQuery: Record<string, string>): AuthRequest {
  const { dateFrom, dateTo } = defaultShipmentsDateRange();
  return {
    // Must match the query the browser sends on a default load, or we warm a key nobody reads.
    query: {
      compact: 'true',
      skipSapJoin: 'true',
      includeSummary: 'false',
      limit: '25',
      page: '1',
      dateFrom,
      dateTo,
      ...extraQuery,
    },
    headers: {},
    get: () => undefined,
  } as unknown as AuthRequest;
}

async function warmOne(label: string, extraQuery: Record<string, string>): Promise<void> {
  try {
    await getShipments(buildSyntheticRequest(extraQuery), createDiscardingResponse());
  } catch (error) {
    // A warm-up failure must never affect startup - the page just stays slow until requested.
    logger.warn(`Shipments ${label} warm-up failed`, { error });
  }
}

/** Section 1 status cards (the 16.8s call). */
export function startShipmentSummaryCacheWarmer(): Promise<void> {
  return warmOne('summary', { summaryOnly: 'true' });
}

/** Outstanding Qty strip (the 8.3s call). */
export function startShipmentOutstandingQtyCacheWarmer(): Promise<void> {
  return warmOne('outstanding qty', { outstandingQtyOnly: 'true' });
}
