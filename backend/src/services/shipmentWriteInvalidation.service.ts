import { invalidateShipmentsListCache } from './shipmentList.service';
import { invalidateShippingPerformanceRowCache } from './shippingPerformance.service';
import { scheduleContractPerformanceRefreshForShipments } from './contractPerformanceSnapshot.service';

/**
 * Everything that must be invalidated when a shipment changes — one call, one place.
 *
 * WHY THIS EXISTS. The invalidation was a list of named caches, spelled out at each write path,
 * and the lists had drifted apart. Measured across the write paths:
 *
 *     createShipment.service.ts         Shipments  Shipping Performance  Contract Performance
 *     shipmentAtaOverride.controller    Shipments  -                     -
 *     ensureSapStoShipment.service      Shipments  -                     -
 *     prePlanned.controller (x6)        Shipments  -                     -
 *
 * So a refresh did run on every update, and it was a real refresh - it simply named one page. The
 * other two kept serving cached rows until their TTL expired, which is why edits appeared on
 * Shipments immediately and elsewhere minutes later. Saving an ATA override was the sharpest case:
 * the ATC it writes is what Trade Cycle and Log Cycle are measured from, and Contract Performance
 * was told nothing at all.
 *
 * Patching nine call sites individually would have restored the invariant and left the same
 * mechanism that lost it - nine places to remember, and no way to tell from any one of them that
 * the others exist. Write paths now call this instead, so adding a cache later means changing one
 * function rather than finding every writer.
 *
 * `shipmentIds` is optional because not every writer knows them: a pre-planned rebuild reshapes
 * many groups at once and has no single list. The Contract Performance refresh is per-shipment, so
 * it is skipped when the ids are unknown - exactly as it was before, but now visibly rather than
 * by omission. The two cache invalidations always run; neither needs an id.
 */
export function invalidateAfterShipmentWrite(shipmentIds?: readonly string[]): void {
  invalidateShipmentsListCache();
  invalidateShippingPerformanceRowCache();

  const ids = (shipmentIds ?? []).map((id) => String(id ?? '').trim()).filter(Boolean);
  if (ids.length > 0) {
    scheduleContractPerformanceRefreshForShipments(ids);
  }
}
