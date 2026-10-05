/**
 * Contract Performance: sort by click history on GET /contracts.
 *
 * The columns a stack may hold are the ones the server sorts in SQL. Cycle days, overall status and over/under delivery are
 * derived in Node after up to 10,000 rows are fetched, so they stay a single sort: clicking one replaces the stack, and
 * clicking an ordinary column afterwards starts a new stack from that column. The server enforces the same rule, so a stale
 * client cannot send the expensive combination.
 */
import {
  clickSortStack,
  DEFAULT_SORT_STACK_DEPTH,
  serializeSortStack,
  type SortEntry,
} from '@/lib/sortStack'

/** Columns derived in Node on the server (see CONTRACTS_LIST_NODE_SORT_KEYS in the backend). Single sort only. */
export const CONTRACTS_NODE_SORT_COLUMN_IDS: ReadonlySet<string> = new Set([
  'log_cycle_days',
  'trade_cycle_days',
  'cash_cycle_days',
  'dp_cycle_days',
  'status_overall',
  'over_under_delivery_status',
])

/** True for a column the server sorts in SQL, i.e. one that may sit in a stack. */
export function isStackableContractsSort(
  columnId: string,
  resolveApiSortKey: (columnId: string) => string | null,
): boolean {
  return resolveApiSortKey(columnId) != null && !CONTRACTS_NODE_SORT_COLUMN_IDS.has(columnId)
}

/** What a header click does in Contract Performance. */
export function nextContractsPerfSortStack(
  stack: ReadonlyArray<SortEntry>,
  columnId: string,
  resolveApiSortKey: (columnId: string) => string | null,
  maxDepth: number = DEFAULT_SORT_STACK_DEPTH,
): SortEntry[] {
  if (!isStackableContractsSort(columnId, resolveApiSortKey)) {
    // A single sort: flip it if it is already the only/primary one, else start it ascending.
    const top = stack[0]
    const dir: 'asc' | 'desc' = top && top.key === columnId && top.dir === 'asc' ? 'desc' : 'asc'
    return [{ key: columnId, dir }]
  }
  // Never carry a single (non-stackable) sort into a stack: the new column starts it.
  const base = stack.every((entry) => isStackableContractsSort(entry.key, resolveApiSortKey)) ? stack : []
  return clickSortStack(base, columnId, maxDepth)
}

/**
 * The `sort` query parameter for a stack, or '' when the plain sortKey + sortDir already say it (one key, or a stack that
 * holds a column the server cannot stack).
 */
export function contractsSortStackParam(
  stack: ReadonlyArray<SortEntry>,
  resolveApiSortKey: (columnId: string) => string | null,
): string {
  if (stack.length < 2) return ''
  const mapped: SortEntry[] = []
  for (const entry of stack) {
    const apiKey = isStackableContractsSort(entry.key, resolveApiSortKey) ? resolveApiSortKey(entry.key) : null
    if (!apiKey) return ''
    mapped.push({ key: apiKey, dir: entry.dir })
  }
  return serializeSortStack(mapped)
}
