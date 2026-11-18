/**
 * Which shipments KMAPS can show on the map (KLIP-EMBED.md Draft 3 §8).
 *
 * KLIP calls `GET <KMAPS_ORIGIN>/api/v1/embed/available` with the access key, caches the answer for a few minutes, and the
 * Shipments Action column shows the map icon only for rows in that list. KMAPS decides "available" (active, DHM vessel,
 * T/C, on Podium); KLIP does not duplicate those rules.
 */
import axios from 'axios';
import { query } from '../database/connection';
import { onIntegrationSettingsChanged } from '../integrations/integrationEnv';
import logger from '../utils/logger';
import { isKmapsEnabled, kmapsAccessKey, kmapsEmbedOrigin } from './config';

const CACHE_TTL_MS = 5 * 60 * 1000;
const STALE_TTL_MS = 30 * 60 * 1000;
const PAGE_LIMIT = 500;
const REQUEST_TIMEOUT_MS = 15_000;

export interface KmapsAvailableItem {
  op: string;
  sto: string | null;
  shipment: string | null;
  vessel: string | null;
  hasPosition: boolean;
}

/** What the Shipments Action column needs. */
export type KmapsAvailabilityMode = 'none' | 'all' | 'filter';

export interface KmapsAvailabilityView {
  mode: KmapsAvailabilityMode;
  /** Present when mode is `filter`. */
  ops?: string[];
  stos?: string[];
  shipments?: string[];
  /** KLIP `partner_shipment_records.sto_key` for available ops — preferred match for list rows. */
  stoKeys?: string[];
  generatedAt?: string | null;
  /** True when the answer is older than the normal cache TTL but still within the stale window. */
  stale?: boolean;
}

interface CacheEntry {
  supported: boolean;
  generatedAt: string | null;
  items: KmapsAvailableItem[];
  fetchedAt: number;
}

let cache: CacheEntry | null = null;
let inflight: Promise<CacheEntry> | null = null;

onIntegrationSettingsChanged(() => {
  cache = null;
  inflight = null;
});

export function resetKmapsAvailabilityCacheForTests(): void {
  cache = null;
  inflight = null;
}

function cleanKey(v: unknown): string | null {
  const s = String(v ?? '').trim();
  return s !== '' && s.length <= 64 ? s : null;
}

/**
 * Pull every page of `/api/v1/embed/available`. Returns `supported: false` on HTTP 404 (endpoint not deployed yet).
 * Throws on other failures so the caller can keep a stale cache.
 */
async function fetchAllPages(): Promise<CacheEntry> {
  const origin = kmapsEmbedOrigin();
  const key = kmapsAccessKey();
  if (!origin || !key) {
    const err = new Error('KMAPS embed origin or access key is not set');
    (err as Error & { code?: string }).code = 'KMAPS_AVAILABLE_NOT_CONFIGURED';
    throw err;
  }

  const items: KmapsAvailableItem[] = [];
  let cursor: string | null = null;
  let generatedAt: string | null = null;
  let pages = 0;

  do {
    pages += 1;
    if (pages > 50) {
      throw new Error('KMAPS availability list exceeded 50 pages; aborting');
    }
    const url = new URL('/api/v1/embed/available', origin);
    url.searchParams.set('limit', String(PAGE_LIMIT));
    if (cursor) url.searchParams.set('cursor', cursor);

    const res = await axios.get(url.toString(), {
      timeout: REQUEST_TIMEOUT_MS,
      validateStatus: () => true,
      headers: {
        Authorization: `Bearer ${key}`,
        Accept: 'application/json',
      },
    });

    if (res.status === 404) {
      return { supported: false, generatedAt: null, items: [], fetchedAt: Date.now() };
    }
    if (res.status === 401 || res.status === 403) {
      const err = new Error(
        res.status === 401
          ? 'KMAPS rejected the access key (401). Re-issue it in KMAPS Setting > Integrasi and paste it again.'
          : 'KMAPS application is disabled (403).',
      );
      (err as Error & { code?: string }).code = res.status === 401 ? 'KMAPS_AVAILABLE_UNAUTHORIZED' : 'KMAPS_AVAILABLE_FORBIDDEN';
      throw err;
    }
    if (res.status === 429 || res.status >= 500) {
      const err = new Error(`KMAPS availability returned HTTP ${res.status}`);
      (err as Error & { code?: string; retryable?: boolean }).code = 'KMAPS_AVAILABLE_RETRYABLE';
      (err as Error & { retryable?: boolean }).retryable = true;
      throw err;
    }
    if (res.status !== 200) {
      throw new Error(`KMAPS availability returned HTTP ${res.status}`);
    }

    const body = res.data as {
      generatedAt?: string;
      items?: Array<Record<string, unknown>>;
      nextCursor?: string | null;
    };
    if (generatedAt == null && body.generatedAt) generatedAt = String(body.generatedAt);
    for (const raw of body.items ?? []) {
      const op = cleanKey(raw.op);
      if (!op) continue;
      items.push({
        op,
        sto: cleanKey(raw.sto),
        shipment: cleanKey(raw.shipment),
        vessel: cleanKey(raw.vessel),
        hasPosition: raw.hasPosition === true,
      });
    }
    cursor = body.nextCursor != null && String(body.nextCursor).trim() !== '' ? String(body.nextCursor) : null;
  } while (cursor);

  return { supported: true, generatedAt, items, fetchedAt: Date.now() };
}

async function loadCache(force = false): Promise<CacheEntry> {
  if (!force && cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) return cache;
  if (!inflight) {
    inflight = (async () => {
      try {
        const next = await fetchAllPages();
        cache = next;
        return next;
      } catch (error) {
        if (cache && Date.now() - cache.fetchedAt < STALE_TTL_MS) {
          logger.warn('KMAPS availability fetch failed; using stale cache', {
            error: error instanceof Error ? error.message : String(error),
            ageMs: Date.now() - cache.fetchedAt,
          });
          return cache;
        }
        throw error;
      } finally {
        inflight = null;
      }
    })();
  }
  return inflight;
}

async function stoKeysForOps(ops: string[]): Promise<string[]> {
  if (ops.length === 0) return [];
  const result = await query(
    `SELECT DISTINCT sto_key
       FROM partner_shipment_records
      WHERE NOT deleted
        AND sto_key IS NOT NULL
        AND record_id = ANY($1::text[])`,
    [ops],
  );
  return result.rows
    .map((r) => cleanKey((r as { sto_key: string | null }).sto_key))
    .filter((s): s is string => s != null);
}

/**
 * Shape for `GET /shipments/kmaps-status`.
 * - `none`: show View Documents on every row (integration off, no key, or no usable list).
 * - `all`: endpoint not deployed yet (404) — keep today's behaviour (map icon on every real shipment row).
 * - `filter`: show the map icon only when the row matches ops / stos / shipments / stoKeys.
 */
export async function getKmapsAvailabilityView(): Promise<KmapsAvailabilityView> {
  if (!isKmapsEnabled()) return { mode: 'none' };
  if (!kmapsEmbedOrigin() || !kmapsAccessKey()) return { mode: 'none' };

  try {
    const entry = await loadCache(false);
    if (!entry.supported) return { mode: 'all' };

    const ops = Array.from(new Set(entry.items.map((i) => i.op)));
    const stos = Array.from(new Set(entry.items.map((i) => i.sto).filter((s): s is string => s != null)));
    const shipments = Array.from(new Set(entry.items.map((i) => i.shipment).filter((s): s is string => s != null)));
    const stoKeys = await stoKeysForOps(ops);
    const stale = Date.now() - entry.fetchedAt >= CACHE_TTL_MS;

    return {
      mode: 'filter',
      ops,
      stos,
      shipments,
      stoKeys,
      generatedAt: entry.generatedAt,
      stale,
    };
  } catch (error) {
    logger.warn('KMAPS availability unavailable', {
      error: error instanceof Error ? error.message : String(error),
    });
    return { mode: 'none' };
  }
}

/** Pure match used by tests and (if needed) the backend. Prefer stoKey, then sto, then shipment. */
export function rowMatchesKmapsAvailability(
  row: { stoKey?: string | null; sto?: string | null; shipment?: string | null; op?: string | null },
  view: KmapsAvailabilityView,
): boolean {
  if (view.mode === 'none') return false;
  if (view.mode === 'all') return true;
  const op = cleanKey(row.op);
  if (op && view.ops?.includes(op)) return true;
  const stoKey = cleanKey(row.stoKey);
  if (stoKey && view.stoKeys?.includes(stoKey)) return true;
  const sto = cleanKey(row.sto);
  if (sto && view.stos?.includes(sto)) return true;
  const shipment = cleanKey(row.shipment);
  if (shipment && view.shipments?.includes(shipment)) return true;
  return false;
}
