import { describe, expect, it } from 'vitest';
import { SHIPMENT_WARM_TOOLBAR_SCOPES } from './shipmentSummaryWarmer.service';
import { readFileSync } from 'fs';
import { join } from 'path';
import { shipmentWarmerBaseQuery } from './shipmentSummaryWarmer.service';

describe('SHIPMENT_WARM_TOOLBAR_SCOPES', () => {
  it('includes default YTD plus CPO×Bontang high-traffic scopes', () => {
    expect(SHIPMENT_WARM_TOOLBAR_SCOPES.some((s) => !s.plants && !s.products)).toBe(true);
    expect(
      SHIPMENT_WARM_TOOLBAR_SCOPES.some(
        (s) => s.products?.includes('CPO') && s.plants?.includes('Bontang'),
      ),
    ).toBe(true);
    expect(SHIPMENT_WARM_TOOLBAR_SCOPES.some((s) => s.label === 'CPO' && s.products?.[0] === 'CPO')).toBe(
      true,
    );
  });
});

describe('shipmentWarmerBaseQuery', () => {
  it('matches the query a default browser load sends, on every field in the cache key', () => {
    // buildShipmentListCacheKey includes skipSapJoin, page, limit, sortKey, sortDir and the date
    // window. A warmer that differs on any of them populates a key nobody reads - which is how
    // the hydrate call (skipSapJoin=false) stayed cold for every first visitor.
    const q = shipmentWarmerBaseQuery();
    expect(q.compact).toBe('true');
    expect(q.includeSummary).toBe('false');
    expect(q.page).toBe('1');
    expect(q.limit).toBe('20');
    // Frontend default: frontend/src/lib/shipmentsCompactSort.ts DEFAULT_SORT.
    expect(q.sortKey).toBe('created_at');
    expect(q.sortDir).toBe('desc');
    // Default global filter window: 1 January of the current year .. today (Jakarta).
    expect(String(q.dateFrom)).toMatch(/^\d{4}-01-01$/);
    expect(String(q.dateTo)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(String(q.dateFrom).slice(0, 4)).toBe(String(q.dateTo).slice(0, 4));
  });

  it('the shell warmer covers both list variants the page requests', () => {
    // The page calls the list twice: shell (skipSapJoin=true) then hydrate (skipSapJoin=false).
    expect(shipmentWarmerBaseQuery().skipSapJoin).toBe('true');
    expect(shipmentWarmerBaseQuery({ skipSapJoin: 'false' }).skipSapJoin).toBe('false');
    const src = readFileSync(
      join(__dirname, 'shipmentSummaryWarmer.service.ts'),
      'utf8',
    );
    expect(src).toContain("warmOne('list hydrate', { skipSapJoin: 'false'");
  });
});
