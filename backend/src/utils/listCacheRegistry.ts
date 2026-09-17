/**
 * Cross-module cache invalidation registry.
 *
 * invalidateShipmentsListCache() lives in shipmentList.service, but the hybrid list keeps its
 * own cache in shipmentUnplannedHybridList.service, which already imports from shipmentList.
 * Importing back the other way would create a cycle, so caches register a clear() callback here
 * and the invalidator calls them all.
 *
 * This matters for correctness, not tidiness: a cached list that survives an edit shows the user
 * stale rows. Any cache added to the list path MUST register here, or it will silently go stale
 * after every create/update/delete.
 */

type Invalidator = () => void;

const invalidators = new Set<Invalidator>();

export function registerListCacheInvalidator(fn: Invalidator): void {
  invalidators.add(fn);
}

export function invalidateRegisteredListCaches(): void {
  for (const fn of invalidators) {
    try {
      fn();
    } catch {
      // A cache that fails to clear must not stop the others from clearing.
    }
  }
}
