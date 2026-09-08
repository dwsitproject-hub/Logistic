import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

/**
 * Shipping Performance serves its rows from a 5-minute in-process cache, and its outstanding qty
 * comes from qty_move. So any write path that refreshes qty_move has also changed what this page
 * shows, and must drop that cache - otherwise the page keeps serving pre-write figures for up to
 * the whole window.
 *
 * Three paths were missing it (2026-09-08): the daily WB upload, trucking realization, and KLIP
 * shipment cancel. WB is the one that matters most - it is exactly what moves OS Qty. SAP import
 * and the shipment controller already had it, which is why the gap was easy to miss.
 *
 * This is a source-level invariant rather than a behavioural test because these services need
 * heavy DB mocking to exercise end to end; what regressed was a forgotten sibling call, and that
 * is precisely what this catches.
 */
const SERVICES_DIR = path.join(__dirname);
const REFRESH_MARKERS = [
  'scheduleContractPerformanceRefreshFor',
  'ContractQtyMoveSnapshotService.refreshFor',
  'ContractPerformanceSnapshotService.refreshFor',
];
const INVALIDATE = 'invalidateShippingPerformanceRowCache';

/** Files that fire a refresh but legitimately do not need the cache drop. */
const EXEMPT = new Set([
  // The snapshot services themselves - they are the refresh, not a write path.
  'contractQtyMoveSnapshot.service.ts',
  'contractPerformanceSnapshot.service.ts',
  // Its own cache; dropping it from inside would be circular.
  'shippingPerformance.service.ts',
]);

function sourceFiles(): string[] {
  return fs
    .readdirSync(SERVICES_DIR)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
}

describe('write paths that refresh a snapshot also drop the Shipping Performance row cache', () => {
  it('holds for every service that fires a targeted refresh', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles()) {
      if (EXEMPT.has(file)) continue;
      const src = fs.readFileSync(path.join(SERVICES_DIR, file), 'utf8');
      const firesRefresh = REFRESH_MARKERS.some((m) => src.includes(m));
      if (firesRefresh && !src.includes(INVALIDATE)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it('covers the three paths that were missing it', () => {
    for (const file of [
      'truckingWbImport.service.ts',
      'truckingRealization.service.ts',
      'cancelKlipShipment.service.ts',
    ]) {
      const src = fs.readFileSync(path.join(SERVICES_DIR, file), 'utf8');
      expect(src, `${file} must drop the Shipping Performance row cache`).toContain(INVALIDATE);
    }
  });
});
