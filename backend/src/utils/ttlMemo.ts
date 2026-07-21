/**
 * Tiny TTL memo for cheap-to-serve, expensive-to-compute values (e.g. dropdown
 * filter-option lists that scan sap_processed_data JSONB). Concurrent callers of
 * the same key share one in-flight computation. Values are recomputed after
 * ttlMs — the compute function itself is never altered, so results are identical
 * to an uncached call, just up to ttlMs old.
 */
const STORE = new Map<string, { value: unknown; expiresAt: number }>();
const IN_FLIGHT = new Map<string, Promise<unknown>>();

export async function ttlMemo<T>(key: string, ttlMs: number, compute: () => Promise<T>): Promise<T> {
  const hit = STORE.get(key);
  if (hit && Date.now() < hit.expiresAt) return hit.value as T;

  const inFlight = IN_FLIGHT.get(key);
  if (inFlight) return inFlight as Promise<T>;

  const promise = (async () => {
    try {
      const value = await compute();
      STORE.set(key, { value, expiresAt: Date.now() + ttlMs });
      return value;
    } finally {
      IN_FLIGHT.delete(key);
    }
  })();
  IN_FLIGHT.set(key, promise);
  return promise;
}

export function invalidateTtlMemo(prefix?: string): void {
  if (!prefix) {
    STORE.clear();
    return;
  }
  for (const key of STORE.keys()) {
    if (key.startsWith(prefix)) STORE.delete(key);
  }
}
