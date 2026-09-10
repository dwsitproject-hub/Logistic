/**
 * Serve a status-filtered Shipments page from one cached row set instead of a fresh query.
 *
 * The list's per-page caches are keyed by (filters x status x sort x page), so every toolbar
 * change is an uncached query - measured on the dev DB, clicking a status card cost 12.4s and
 * adding a product filter another 11.4s, while repeating an identical combination came back in
 * 80ms. This loads the *scope* once (date window + the filters that decide which rows exist) and
 * derives status, column filters, sort and paging from it via `shipmentListNodePaging`.
 *
 * The loader is injected rather than imported so this file does not depend on the controller
 * (which imports this one). It receives a plain query object and returns whatever the normal list
 * path returns for it.
 *
 * Every refusal is explicit and returns a reason: if anything about the request cannot be mirrored,
 * the caller runs the SQL path exactly as before.
 */

import {
  canDeriveShipmentPageInNode,
  deriveShipmentPageInNode,
  SHIPMENT_NODE_FILTERABLE_COLUMNS,
  SHIPMENT_NODE_SORTABLE_KEYS,
  type ColumnFilterSpec,
  type NodeRow,
} from '../utils/shipmentListNodePaging';
import { isShipmentPageOpenCloseStatusParam } from '../utils/shipmentPagePipelineSql';
import {
  getCachedShipmentRowSet,
  loadShipmentRowSet,
  type RowSetRow,
} from './shipmentListRowSetCache';

/** Marks the synthetic scope request, so it can never take this path itself. */
export const ROW_SET_LOAD_MARKER = '__rowSetLoad';

/** The list caps limit at 500, so a scope is read in pages of that size. */
const SCOPE_PAGE_SIZE = 500;
/** A scope larger than this is not worth holding in memory; fall back to SQL paging. */
const MAX_SCOPE_ROWS = 5000;

export interface ScopePageResult {
  rows: RowSetRow[];
}

export type ScopePageLoader = (query: Record<string, string>) => Promise<ScopePageResult>;

export interface DerivedPage {
  shipments: NodeRow[];
  pagination: { total: number; page: number; limit: number; totalPages: number };
}

function parseColumnFilters(raw: unknown): Record<string, ColumnFilterSpec> {
  if (typeof raw !== 'string' || raw.trim() === '') return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, ColumnFilterSpec>) : {};
  } catch {
    return {};
  }
}

/**
 * Split the column filters into the ones derived here and the ones left to SQL.
 *
 * A filter left to SQL is not a failure - it stays in the scope request, and therefore in the
 * scope key, so the row set it produces is already narrowed by it.
 */
function splitColumnFilters(all: Record<string, ColumnFilterSpec>): {
  node: Record<string, ColumnFilterSpec>;
  sql: Record<string, ColumnFilterSpec>;
} {
  const node: Record<string, ColumnFilterSpec> = {};
  const sql: Record<string, ColumnFilterSpec> = {};
  for (const [colId, spec] of Object.entries(all)) {
    const mirrorable =
      SHIPMENT_NODE_FILTERABLE_COLUMNS.includes(colId) &&
      !!spec &&
      typeof spec === 'object' &&
      (spec.emptyOnly === true ||
        spec.type === undefined ||
        ['text', 'number', 'multi'].includes(String(spec.type)));
    if (mirrorable) node[colId] = spec;
    else sql[colId] = spec;
  }
  return { node, sql };
}

function stableKey(value: Record<string, unknown>): string {
  return JSON.stringify(
    Object.keys(value)
      .sort()
      .reduce<Record<string, unknown>>((acc, k) => {
        acc[k] = value[k];
        return acc;
      }, {}),
  );
}

/**
 * The scope a request belongs to: the same request minus status, sort, page and the column
 * filters derived in Node. Everything left decides which rows exist, so it belongs in the key.
 */
function buildScope(
  query: Record<string, unknown>,
  sqlFilters: Record<string, ColumnFilterSpec>,
): { scopeQuery: Record<string, string>; key: string } {
  const scopeQuery: Record<string, string> = {};
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null) continue;
    if (k === 'status' || k === 'page' || k === 'limit' || k === 'sortKey' || k === 'sortDir') continue;
    if (k === 'columnFilters') continue;
    scopeQuery[k] = Array.isArray(v) ? JSON.stringify(v) : String(v);
  }
  if (Object.keys(sqlFilters).length > 0) {
    scopeQuery.columnFilters = JSON.stringify(sqlFilters);
  }
  /** created_at avoids the hybrid global merge sort; the rows are re-sorted here anyway. */
  scopeQuery.sortKey = 'created_at';
  scopeQuery.sortDir = 'desc';
  scopeQuery[ROW_SET_LOAD_MARKER] = '1';
  return { scopeQuery, key: stableKey(scopeQuery) };
}

/**
 * Read a whole scope, page by page.
 *
 * Exported because the cache's warm cycle reloads a scope without any request behind it - it is
 * handed a stored scope query and needs the same paging loop a request would have run.
 */
export async function readShipmentScopeRows(
  scopeQuery: Record<string, string>,
  loadScopePage: ScopePageLoader,
): Promise<RowSetRow[]> {
  const all: RowSetRow[] = [];
  for (let page = 1; ; page += 1) {
    const res = await loadScopePage({
      ...scopeQuery,
      page: String(page),
      limit: String(SCOPE_PAGE_SIZE),
    });
    all.push(...res.rows);
    if (res.rows.length < SCOPE_PAGE_SIZE) break;
    if (all.length >= MAX_SCOPE_ROWS) break;
  }
  return all;
}

/**
 * Load a scope's row set and wait for it.
 *
 * Used by the warmers and by diagnostics - never on a request path, where an unloaded scope falls
 * back to SQL instead of making the caller wait.
 */
export async function primeCompactShipmentScope(input: {
  query: Record<string, unknown>;
  loadScopePage: ScopePageLoader;
}): Promise<{ key: string; rows: number }> {
  const { sql: sqlFilters } = splitColumnFilters(parseColumnFilters(input.query.columnFilters));
  const { scopeQuery, key } = buildScope(input.query, sqlFilters);
  /**
   * Pinned: this is the startup warmer's own scope, so the warm cycle keeps refreshing it even
   * when nobody has read it - which is exactly its purpose.
   */
  const rows = await loadShipmentRowSet(
    key,
    scopeQuery,
    () => readShipmentScopeRows(scopeQuery, input.loadScopePage),
    { pinned: true },
  );
  return { key, rows: rows.length };
}

export interface DeriveInput {
  /** The original request query, already alias-resolved by the controller. */
  query: Record<string, unknown>;
  sortKey: string;
  sortDir: 'ASC' | 'DESC';
  page: number;
  limit: number;
  loadScopePage: ScopePageLoader;
}

/**
 * Returns the derived page, or a reason the caller must use the SQL path.
 *
 * Shape checks come first and cost nothing; the row set is only loaded once the request is known
 * to be derivable, and the field-level gate runs again against a real row afterwards.
 */
export async function deriveCompactShipmentPage(
  input: DeriveInput,
): Promise<{ ok: true; page: DerivedPage } | { ok: false; reason: string }> {
  const { query } = input;

  if (query[ROW_SET_LOAD_MARKER]) {
    return { ok: false, reason: 'this is the scope load itself' };
  }

  const status = typeof query.status === 'string' ? query.status.trim() : '';
  if (!isShipmentPageOpenCloseStatusParam(status)) {
    /**
     * Only Open/Close is derived. With no status the list is the hybrid ALL view, ordered by a
     * global merge sort this module does not reproduce; the stage-specific statuses have their own
     * resolvers. Both are covered by the page's own warmers.
     */
    return { ok: false, reason: 'only an Open/Close status filter is derived here' };
  }
  if (!SHIPMENT_NODE_SORTABLE_KEYS.includes(input.sortKey)) {
    return { ok: false, reason: `sort key "${input.sortKey}" is not mirrored` };
  }

  const { node: nodeFilters, sql: sqlFilters } = splitColumnFilters(
    parseColumnFilters(query.columnFilters),
  );
  const { scopeQuery, key } = buildScope(query, sqlFilters);

  /**
   * Never load the scope on the request path.
   *
   * Measured the other way round first, and it was a net loss: the scope is the *unfiltered* view,
   * which costs far more than a filtered query because the filters do narrow the SQL work. The
   * first status click went from 12.4s to 60.8s, and the whole replayed session from 268s to 311s,
   * even though a second filter change inside the same scope answered in 15ms.
   *
   * So a request either finds the row set already loaded and answers from memory, or it falls back
   * to the SQL path it would have run anyway - and the load happens in the background for the next
   * one. That makes this strictly an improvement over the previous behaviour, never a regression.
   */
  const rows = getCachedShipmentRowSet(key);
  if (!rows) {
    void loadShipmentRowSet(key, scopeQuery, () =>
      readShipmentScopeRows(scopeQuery, input.loadScopePage),
    ).catch(() => {
      // A failed background load just means the next request runs on SQL again.
    });
    return { ok: false, reason: 'scope row set not loaded yet - loading in background' };
  }
  if (rows.length >= MAX_SCOPE_ROWS) {
    return { ok: false, reason: `scope exceeds ${MAX_SCOPE_ROWS} rows` };
  }

  const gate = canDeriveShipmentPageInNode(
    { statusParam: status, colFilters: nodeFilters, sortKey: input.sortKey, sortDir: input.sortDir },
    rows[0],
  );
  if (!gate.ok) return { ok: false, reason: gate.reason };

  const derived = deriveShipmentPageInNode(rows, {
    statusParam: status,
    colFilters: nodeFilters,
    sortKey: input.sortKey,
    sortDir: input.sortDir,
    page: input.page,
    limit: input.limit,
  });

  /**
   * Drop row_kind from the derived rows.
   *
   * The scope load goes through the hybrid ALL path, which stamps row_kind='shipment_execution';
   * the filtered SQL path never sets it, so the key is absent there. Every remaining row is an
   * execution row (the status filter drops the backlog ones), so the value carries no information
   * here - and leaving it in was the only difference between the two responses. Copies, so the
   * shared cached row set keeps the field for the ALL path that needs it.
   */
  const shipments = derived.rows.map((r) => {
    if (!('row_kind' in r)) return r;
    const copy = { ...r };
    delete (copy as Record<string, unknown>).row_kind;
    return copy;
  });

  return {
    ok: true,
    page: {
      shipments,
      pagination: {
        total: derived.total,
        page: input.page,
        limit: input.limit,
        /** Exactly the SQL path's formula (shipment.controller.ts:2345) - 0 rows means 0 pages. */
        totalPages: Math.ceil(derived.total / input.limit),
      },
    },
  };
}
