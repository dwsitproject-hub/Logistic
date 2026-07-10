/**
 * Keep-warm helper for the keyed in-memory list caches (Shipments / Trucking pages).
 *
 * The list endpoints cache query results per cache key with a TTL. Cold keys pay the
 * full query cost (tens of seconds for the heaviest variants), which users hit after
 * the TTL lapses or after an edit invalidates the caches. This registry remembers how
 * to re-run the most recent live loads and re-runs them in the background:
 *
 *  - refresh-ahead: shortly before a cached entry would expire, it is re-loaded off
 *    the request path so pages keep being served from memory;
 *  - re-warm on invalidation: after an edit clears the caches, the recently used
 *    keys are re-loaded in the background so the next viewer does not pay the cost.
 *
 * This never changes what an endpoint returns — it only re-runs the exact same
 * loader (same SQL, same params, same cache key) at a different time. Refreshes are
 * serialized (one at a time) to avoid stampeding the database, and only keys that
 * were accessed recently are kept warm.
 */

interface KeepWarmEntry {
  refresh: () => Promise<void>;
  lastAccessedAt: number;
  lastRefreshedAt: number;
  /** Duration of the most recent live load; expensive loads skip TTL refresh-ahead. */
  lastLoadMs: number;
}

/**
 * Loads slower than this only re-warm after an explicit invalidation (edit), never on
 * the TTL refresh-ahead cycle — otherwise a minute-long query would be re-run every
 * few minutes for as long as the page stays open, keeping the database busy.
 */
const EXPENSIVE_LOAD_MS = 15 * 1000;

export interface ListCacheKeepWarmOptions {
  /** Cache TTL of the map this registry warms; refreshes are scheduled against it. */
  cacheTtlMs: number;
  /** How often the background sweep wakes up. Default 60s. */
  checkMs?: number;
  /** Re-load an entry once it is this old (must be < cacheTtlMs). Default TTL - 60s. */
  refreshAheadMs?: number;
  /** Stop warming keys that have not been requested for this long. Default 15 min. */
  maxIdleMs?: number;
  /** Maximum keys kept warm (least recently accessed evicted first). Default 8. */
  maxEntries?: number;
}

export class ListCacheKeepWarm {
  private entries = new Map<string, KeepWarmEntry>();
  private timer: NodeJS.Timeout | null = null;
  private sweeping = false;

  private readonly checkMs: number;
  private readonly refreshAheadMs: number;
  private readonly maxIdleMs: number;
  private readonly maxEntries: number;

  constructor(opts: ListCacheKeepWarmOptions) {
    this.checkMs = opts.checkMs ?? 60 * 1000;
    this.refreshAheadMs = opts.refreshAheadMs ?? Math.max(opts.cacheTtlMs - 60 * 1000, 60 * 1000);
    this.maxIdleMs = opts.maxIdleMs ?? 15 * 60 * 1000;
    this.maxEntries = opts.maxEntries ?? 8;
  }

  /** Record how to re-run a live load. Call right after a loader ran its query. */
  register(key: string, refresh: () => Promise<void>, lastLoadMs = 0): void {
    const now = Date.now();
    // Preserve lastAccessedAt on re-register: background refreshes re-run the loader,
    // which re-registers the key — that must not count as user activity, or idle keys
    // would keep themselves warm forever.
    const existing = this.entries.get(key);
    this.entries.set(key, {
      refresh,
      lastAccessedAt: existing?.lastAccessedAt ?? now,
      lastRefreshedAt: now,
      lastLoadMs,
    });
    this.evictIfNeeded();
    this.startTimer();
  }

  /** Record that a key was requested (cache hit or live). Keeps it in the warm set. */
  touch(key: string): void {
    const entry = this.entries.get(key);
    if (entry) entry.lastAccessedAt = Date.now();
  }

  /**
   * Re-run recently used loads in the background (after cache invalidation).
   * Serialized and best-effort; a failed refresh just leaves the key cold.
   */
  rewarmRecentlyUsed(): void {
    const now = Date.now();
    const recent = [...this.entries.entries()]
      .filter(([, e]) => now - e.lastAccessedAt <= this.maxIdleMs)
      .sort((a, b) => b[1].lastAccessedAt - a[1].lastAccessedAt);
    void this.runSerially(recent);
  }

  /** Stop the background sweep (tests / shutdown). */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private startTimer(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.sweep(), this.checkMs);
    // Never keep the process alive just for cache warming.
    this.timer.unref?.();
  }

  private sweep(): void {
    const now = Date.now();
    const due = [...this.entries.entries()]
      .filter(
        ([, e]) =>
          e.lastLoadMs <= EXPENSIVE_LOAD_MS &&
          now - e.lastAccessedAt <= this.maxIdleMs &&
          now - e.lastRefreshedAt >= this.refreshAheadMs,
      )
      .sort((a, b) => b[1].lastAccessedAt - a[1].lastAccessedAt);
    void this.runSerially(due);
  }

  private async runSerially(list: Array<[string, KeepWarmEntry]>): Promise<void> {
    if (this.sweeping || list.length === 0) return;
    this.sweeping = true;
    try {
      for (const [key, entry] of list) {
        try {
          await entry.refresh();
          entry.lastRefreshedAt = Date.now();
        } catch {
          // Best-effort: drop entries whose refresh fails so they don't retry forever.
          this.entries.delete(key);
        }
      }
    } finally {
      this.sweeping = false;
    }
  }

  private evictIfNeeded(): void {
    if (this.entries.size <= this.maxEntries) return;
    const sorted = [...this.entries.entries()].sort(
      (a, b) => a[1].lastAccessedAt - b[1].lastAccessedAt,
    );
    const removeCount = this.entries.size - this.maxEntries;
    for (let i = 0; i < removeCount; i += 1) {
      this.entries.delete(sorted[i][0]);
    }
  }
}
