/**
 * Multi-column sort by click history - the same idea as sorting a sheet column by column in Excel.
 *
 * Click Supplier, then Product, then Incoterm: the table is ordered by Incoterm, then Product within an
 * incoterm, then Supplier within a product. The LAST click is the primary key, so the stack is kept
 * newest-first and trimmed from the oldest end.
 *
 * Pure functions only; each table decides where the rows are sorted (the browser for Shipping Performance,
 * the server for the paged lists) and how a key maps to a value.
 */

export type SortDir = 'asc' | 'desc'

export interface SortEntry<K extends string = string> {
  key: K
  dir: SortDir
}

/** Deep enough to say "by incoterm, then product, then supplier"; deeper stacks are rarely read. */
export const DEFAULT_SORT_STACK_DEPTH = 3

/**
 * What a header click does.
 * - the column on top: flips its direction (the single-sort behaviour tables already have)
 * - any other column: becomes the primary key, ascending; if it was lower in the stack it leaves its old place
 * The oldest key falls off once the stack is deeper than `maxDepth`.
 */
export function clickSortStack<K extends string>(
  stack: ReadonlyArray<SortEntry<K>>,
  key: K,
  maxDepth: number = DEFAULT_SORT_STACK_DEPTH,
): SortEntry<K>[] {
  const top = stack[0]
  if (top && top.key === key) {
    return [{ key, dir: top.dir === 'asc' ? 'desc' : 'asc' }, ...stack.slice(1)]
  }
  const rest = stack.filter((entry) => entry.key !== key)
  return [{ key, dir: 'asc' as SortDir }, ...rest].slice(0, Math.max(1, maxDepth))
}

/** 1 for the primary key, 2 for the next, and so on; null when the column is not part of the sort. */
export function sortPriority<K extends string>(stack: ReadonlyArray<SortEntry<K>>, key: K): number | null {
  const index = stack.findIndex((entry) => entry.key === key)
  return index < 0 ? null : index + 1
}

export function sortEntryFor<K extends string>(stack: ReadonlyArray<SortEntry<K>>, key: K): SortEntry<K> | null {
  return stack.find((entry) => entry.key === key) ?? null
}

/** `incoterm:asc,product:asc,supplier:desc` - for a query string, a cache key or a stored preference. */
export function serializeSortStack(stack: ReadonlyArray<SortEntry>): string {
  return stack.map((entry) => `${entry.key}:${entry.dir}`).join(',')
}

/**
 * The inverse. Anything malformed is dropped rather than guessed at: an unknown key (when `allowedKeys` is given), a
 * repeated key (the first, i.e. the higher-priority one, wins), an unknown direction, and anything past `maxDepth`.
 */
export function parseSortStack<K extends string = string>(
  raw: unknown,
  options: { allowedKeys?: ReadonlySet<string>; maxDepth?: number } = {},
): SortEntry<K>[] {
  const maxDepth = options.maxDepth ?? DEFAULT_SORT_STACK_DEPTH
  const text = typeof raw === 'string' ? raw : ''
  const out: SortEntry<K>[] = []
  const seen = new Set<string>()
  for (const part of text.split(',')) {
    const [keyRaw, dirRaw] = part.split(':')
    const key = (keyRaw ?? '').trim()
    const dir = (dirRaw ?? 'asc').trim().toLowerCase()
    if (!key || seen.has(key)) continue
    if (dir !== 'asc' && dir !== 'desc') continue
    if (options.allowedKeys && !options.allowedKeys.has(key)) continue
    seen.add(key)
    out.push({ key: key as K, dir })
    if (out.length >= maxDepth) break
  }
  return out
}

export type SortValue =
  | { type: 'number'; value: number | null }
  | { type: 'text'; value: string }

/**
 * Orders two rows by the stack: the first key that differs decides, so ties on the primary key are broken by the next.
 * An empty number sorts as the smallest, as the single sorts here always did; text compares case-insensitively.
 */
export function compareByStack<T, K extends string>(
  a: T,
  b: T,
  stack: ReadonlyArray<SortEntry<K>>,
  valueOf: (row: T, key: K) => SortValue,
): number {
  for (const { key, dir } of stack) {
    const av = valueOf(a, key)
    const bv = valueOf(b, key)
    let cmp = 0
    if (av.type === 'number' && bv.type === 'number') {
      const x = av.value == null || Number.isNaN(av.value) ? Number.NEGATIVE_INFINITY : av.value
      const y = bv.value == null || Number.isNaN(bv.value) ? Number.NEGATIVE_INFINITY : bv.value
      cmp = x < y ? -1 : x > y ? 1 : 0
    } else {
      const x = String(av.value ?? '').toLowerCase()
      const y = String(bv.value ?? '').toLowerCase()
      cmp = x < y ? -1 : x > y ? 1 : 0
    }
    if (cmp !== 0) return dir === 'asc' ? cmp : -cmp
  }
  return 0
}

/** A sorted copy. Array.prototype.sort is stable, so rows that tie on every key keep their incoming order. */
export function sortRowsByStack<T, K extends string>(
  rows: ReadonlyArray<T>,
  stack: ReadonlyArray<SortEntry<K>>,
  valueOf: (row: T, key: K) => SortValue,
): T[] {
  if (stack.length === 0) return [...rows]
  return [...rows].sort((a, b) => compareByStack(a, b, stack, valueOf))
}
