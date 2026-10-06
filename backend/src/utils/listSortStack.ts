/**
 * Sort by click history for the server-paged list pages (Trucking, Shipments).
 *
 * The client sends `sort=incoterm:asc,product:asc,supplier:desc` (newest click first, at most three keys) next to the
 * `sortKey` / `sortDir` pair it always sent. Those two stay the PRIMARY key everywhere, so every existing signature,
 * cache key and ORDER BY is unchanged for a single sort; what a stack adds is `thenBy`, the keys that only break ties of
 * the ones before them. A request without `sort` has an empty `thenBy` and behaves exactly as before.
 *
 * The parser takes a predicate for the keys a page can order by, and drops everything else - an unknown, duplicate or
 * malformed key is ignored rather than rejected, and every ORDER BY expression is looked up in the page's static map, so
 * nothing from the query string reaches SQL.
 */

export const LIST_SORT_MAX_KEYS = 3;

export type ListSortDir = 'ASC' | 'DESC';

export type ListSortEntry = { key: string; dir: ListSortDir };

export type ListSortRequest = {
  sortKey: string;
  sortDir: ListSortDir;
  /** The legacy `sortDir` text exactly as the page read it ('asc' / 'desc' / anything), for code that still wants it. */
  sortDirRaw: string;
  /** Keys after the primary one, in priority order. Empty for a single sort. */
  thenBy: ListSortEntry[];
};

/** `a:asc,b:desc` -> entries; keeps order, drops unknown / duplicate / malformed keys, caps the length. */
export function parseListSortStack(
  raw: unknown,
  isAllowedKey: (key: string) => boolean,
  maxKeys: number = LIST_SORT_MAX_KEYS,
): ListSortEntry[] {
  const text = Array.isArray(raw) ? String(raw[0] ?? '') : typeof raw === 'string' ? raw : '';
  if (!text.trim()) return [];
  const out: ListSortEntry[] = [];
  const seen = new Set<string>();
  for (const part of text.split(',')) {
    const [keyRaw, dirRaw] = part.split(':');
    const key = (keyRaw ?? '').trim();
    const dirText = (dirRaw ?? 'asc').trim().toLowerCase();
    if (!key || seen.has(key) || !isAllowedKey(key)) continue;
    if (dirText !== 'asc' && dirText !== 'desc') continue;
    seen.add(key);
    out.push({ key, dir: dirText === 'asc' ? 'ASC' : 'DESC' });
    if (out.length >= maxKeys) break;
  }
  return out;
}

/**
 * The sort a request asks for. With a usable `sort` the first entry is the primary key and the rest are `thenBy`;
 * otherwise the legacy `sortKey` / `sortDir` pair is read exactly as the page read it before.
 */
export function resolveListSortRequest(
  query: { sort?: unknown; sortKey?: unknown; sortDir?: unknown },
  options: {
    isAllowedKey: (key: string) => boolean;
    defaultKey: string;
    defaultDirRaw: string;
    maxKeys?: number;
  },
): ListSortRequest {
  const stack = parseListSortStack(query.sort, options.isAllowedKey, options.maxKeys);
  if (stack.length > 0) {
    const [primary, ...thenBy] = stack;
    return {
      sortKey: primary.key,
      sortDir: primary.dir,
      sortDirRaw: primary.dir.toLowerCase(),
      thenBy,
    };
  }
  const sortKey = String(query.sortKey || options.defaultKey);
  const sortDirRaw = String(query.sortDir || options.defaultDirRaw).toLowerCase();
  return { sortKey, sortDir: sortDirRaw === 'asc' ? 'ASC' : 'DESC', sortDirRaw, thenBy: [] };
}

/** Cache-key fragment: empty for a single sort, so every existing key stays byte-for-byte the same. */
export function listSortThenByKey(thenBy: ReadonlyArray<ListSortEntry> | undefined): string {
  if (!thenBy || thenBy.length === 0) return '';
  return `:then=${thenBy.map((e) => `${e.key}:${e.dir}`).join(',')}`;
}
