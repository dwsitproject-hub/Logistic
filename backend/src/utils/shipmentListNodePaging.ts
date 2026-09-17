/**
 * Derive a Shipments list page from an already-loaded row set, in Node.
 *
 * Why: the list caches per (filters x status x sort x page), so every toolbar change is a fresh
 * uncached query - measured on the dev DB, clicking a status card cost 12.4s, adding a product
 * filter 11.4s, and the hydrate call behind them 63.7s. The row set itself is small (668 rows for
 * the default YTD scope), so it is far cheaper to load it once and slice it here.
 *
 * These functions mirror the SQL exactly, and refuse the job when they cannot:
 * canDeriveShipmentPageInNode checks the request against what a row actually carries and returns
 * a reason when the caller must fall back to the SQL path. Anything not proven equivalent falls
 * back - that is the safety property this module is built around, not an optimisation gap.
 *
 * Deliberately NOT handled here (each stays in SQL, and therefore in the cache key):
 * - plant: not a row column at all. It filters the *contract scope* (appendRegionSiteFilter over
 *   a contract-level expression), so a different plant is a different row set, not a subset.
 * - text sorts: Postgres orders text by database collation, which JS string comparison does not
 *   reproduce. Only number and date sorts are derived here.
 * - the late_indicator column filter: the SQL filters a computed expression, not a stored column.
 * - global search, sto/contract/vessel/port, lateIndicator, charterType, sourceType, viewOption,
 *   delayed, ETA buckets, etcNoAtcDueWithin7d: all applied inside the SQL that builds the rows.
 */

import {
  isShipmentPageOpenCloseStatusParam,
  shipmentPageCloseEffectiveStatuses,
  shipmentPageOpenEffectiveStatuses,
} from './shipmentPagePipelineSql';
import { shouldPrioritizeSapStoRows } from './listSapStoPrioritySql';

export type NodeRow = Record<string, unknown>;

export interface ColumnFilterSpec {
  type?: string;
  value?: unknown;
  exact?: boolean;
  emptyOnly?: boolean;
  min?: unknown;
  max?: unknown;
  from?: unknown;
  to?: unknown;
  values?: unknown[];
  includeBlank?: boolean;
}

/** Sort keys this module can order identically to the SQL, with the value each one reads. */
const SORTABLE: Readonly<Record<string, { fields: string[]; kind: 'number' | 'date' }>> = {
  contract_date: { fields: ['contract_date'], kind: 'date' },
  delivery_start: { fields: ['delivery_start_date'], kind: 'date' },
  delivery_start_date: { fields: ['delivery_start_date'], kind: 'date' },
  delivery_end: { fields: ['delivery_end_date'], kind: 'date' },
  delivery_end_date: { fields: ['delivery_end_date'], kind: 'date' },
};

/**
 * Quantity sorts are deliberately absent - measured, not assumed.
 *
 * outstanding_quantity, outstanding_qty_planning, quantity_delivered, quantity_receive,
 * contract_qty and sto_quantity are in SHIPMENT_LIST_ENRICHED_SORT_KEYS, so the SQL orders them
 * by a *resolved* expression on the enriched CTE (SAP/KLIP reconciliation), not by the column a
 * row carries. Ordering them here disagreed with the SQL on the shell payload even though the
 * totals matched: status=OPEN sort=quantity_shipped and status=OPEN/CLOSE
 * sort=outstanding_quantity all diverged. quantity_shipped is not in that set but diverged too,
 * so it is excluded until the difference is understood rather than guessed at.
 *
 * The date keys above were verified identical to the SQL across OPEN and CLOSE, both directions,
 * pages 1 and 2.
 */

/** Column ids whose SQL is a plain stored column, so a row's own value is the filter input. */
const FILTERABLE_COLUMNS: Readonly<Record<string, string>> = {
  operation_id: 'operation_id',
  shipment_id: 'shipment_id',
  sto_number: 'sto_number',
  status: 'status',
  contract_numbers: 'contract_numbers',
  contract_number: 'contract_numbers',
  po_numbers: 'po_numbers',
  contract_reference_po: 'contract_reference_po',
  contract_ext_no: 'contract_ext_no',
  vessel_name: 'vessel_name',
  vessel_code: 'vessel_code',
  vessel_owner: 'vessel_owner',
  port_of_loading: 'port_of_loading',
  port_of_discharge: 'port_of_discharge',
  plant_site: 'plant_site',
  supplier: 'supplier',
  suppliers: 'suppliers',
  buyer: 'buyer',
  buyers: 'buyers',
  product: 'product',
  products: 'products',
  incoterm: 'incoterm',
  group_name: 'group_name',
  group_names: 'group_names',
  shipment_date: 'shipment_date',
  arrival_date: 'arrival_date',
  delivery_start: 'delivery_start_date',
  delivery_end: 'delivery_end_date',
  delivery_start_date: 'delivery_start_date',
  delivery_end_date: 'delivery_end_date',
  quantity_shipped: 'quantity_shipped',
  quantity_delivered: 'quantity_delivered',
  inbound_weight: 'inbound_weight',
  outbound_weight: 'outbound_weight',
  gain_loss_percentage: 'gain_loss_percentage',
  gain_loss_amount: 'gain_loss_amount',
  created_at: 'created_at',
};

function txt(value: unknown): string {
  return value === null || value === undefined ? '' : String(value).trim();
}

function isBlank(value: unknown): boolean {
  return txt(value) === '';
}

/** Compare the date part only, the way `(expr)::date` does. */
function dateKey(value: unknown): string {
  const t = txt(value);
  if (!t) return '';
  const m = t.match(/^(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1] as string;
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

function num(value: unknown): number | null {
  if (value === null || value === undefined || txt(value) === '') return null;
  const n = Number(value);
  return Number.isNaN(n) ? null : n;
}

/** created_at is a timestamp, not a date - keep full precision for the tie-break. */
function dateTimeKey(value: unknown): string {
  const t = txt(value);
  if (!t) return '';
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? t : d.toISOString();
}

function firstPresent(row: NodeRow, fields: string[]): unknown {
  for (const f of fields) {
    const v = row[f];
    if (v !== null && v !== undefined && txt(v) !== '') return v;
  }
  return null;
}

/** Effective statuses a status param selects, or null when it selects everything. */
export function nodeStatusAllowList(statusParam: unknown): Set<string> | null {
  const raw = txt(statusParam);
  if (!raw || raw.toUpperCase() === 'ALL') return null;
  const openClose = isShipmentPageOpenCloseStatusParam(raw);
  if (openClose === 'OPEN') {
    return new Set(shipmentPageOpenEffectiveStatuses().map((s) => s.toUpperCase()));
  }
  if (openClose === 'CLOSE') {
    return new Set(shipmentPageCloseEffectiveStatuses().map((s) => s.toUpperCase()));
  }
  return null;
}

/**
 * Status filtering also drops contract-backlog rows.
 *
 * The SQL that serves a status-filtered table is execution-only: appendShipmentPipelineStageFilter
 * narrows shipment rows, and backlog rows never enter that query - they come from a separate
 * resolver. An unfiltered row set contains both, so filtering on status alone over-counts.
 * Measured: status=CLOSE returned 5 rows from SQL against 6 here before this.
 */
export function nodeFilterByStatus(rows: NodeRow[], statusParam: unknown): NodeRow[] {
  const allow = nodeStatusAllowList(statusParam);
  if (!allow) return rows;
  return rows.filter(
    (r) =>
      txt(r.row_kind) !== 'contract_backlog' && allow.has(txt(r.status).toUpperCase()),
  );
}

/** Mirrors appendShipmentColumnFilters for the plain-column subset. */
export function nodeFilterByColumnFilters(
  rows: NodeRow[],
  colFilters: Record<string, ColumnFilterSpec> | undefined,
): NodeRow[] {
  if (!colFilters) return rows;
  let out = rows;
  for (const [colId, spec] of Object.entries(colFilters)) {
    const field = FILTERABLE_COLUMNS[colId];
    if (!field || !spec || typeof spec !== 'object') continue;

    if (spec.emptyOnly) {
      out = out.filter((r) => isBlank(r[field]));
      continue;
    }
    if (spec.type === 'text') {
      const v = txt(spec.value);
      if (!v) continue;
      if (spec.exact) {
        const target = v.toLowerCase();
        out = out.filter((r) => txt(r[field]).toLowerCase() === target);
      } else {
        const needle = v.toLowerCase();
        out = out.filter((r) => String(r[field] ?? '').toLowerCase().includes(needle));
      }
      continue;
    }
    if (spec.type === 'number') {
      const min = num(spec.min);
      const max = num(spec.max);
      if (min !== null) {
        out = out.filter((r) => {
          const n = num(r[field]);
          return n !== null && n >= min;
        });
      }
      if (max !== null) {
        out = out.filter((r) => {
          const n = num(r[field]);
          return n !== null && n <= max;
        });
      }
      continue;
    }
    if (spec.type === 'multi') {
      const values = (Array.isArray(spec.values) ? spec.values : [])
        .filter((x) => x !== null && x !== undefined && String(x).trim() !== '')
        .map((x) => String(x));
      const includeBlank = Boolean(spec.includeBlank);
      if (values.length === 0 && !includeBlank) continue;
      // SQL uses `expr::text = ANY($n::text[])`: exact, case-sensitive, not trimmed.
      const set = new Set(values);
      out = out.filter((r) => {
        if (includeBlank && isBlank(r[field])) return true;
        return set.has(String(r[field] ?? ''));
      });
    }
  }
  return out;
}

/**
 * Mirrors buildShipmentListPageOrderBy: an optional SAP-STO-present prefix (only for the
 * UNPLANNED and PLANNED tables), then `<field> <dir> NULLS LAST, created_at DESC, id ASC`.
 */
export function nodeSortRows(
  rows: NodeRow[],
  sortKey: string,
  sortDir: 'ASC' | 'DESC',
  statusParam?: unknown,
): NodeRow[] {
  const spec = SORTABLE[sortKey];
  if (!spec) return rows;
  const dir = sortDir === 'ASC' ? 1 : -1;
  const prioritizeSto = shouldPrioritizeSapStoRows(statusParam);

  const stoRank = (r: NodeRow): number => {
    const t = txt(r.sto_number);
    return t !== '' && t !== '-' ? 0 : 1;
  };
  const primary = (r: NodeRow): number | string | null => {
    const v = firstPresent(r, spec.fields);
    if (v === null) return null;
    return spec.kind === 'number' ? num(v) : dateKey(v);
  };

  return [...rows].sort((a, b) => {
    if (prioritizeSto) {
      const d = stoRank(a) - stoRank(b);
      if (d !== 0) return d;
    }
    const pa = primary(a);
    const pb = primary(b);
    const aNull = pa === null || pa === '';
    const bNull = pb === null || pb === '';
    // NULLS LAST holds in both directions, so it is decided before the direction is applied.
    if (aNull !== bNull) return aNull ? 1 : -1;
    if (!aNull && !bNull && pa !== pb) return ((pa as number | string) < (pb as number | string) ? -1 : 1) * dir;

    const ca = dateTimeKey(a.created_at);
    const cb = dateTimeKey(b.created_at);
    if (ca !== cb) return ca < cb ? 1 : -1; // created_at DESC
    const ia = txt(a.id);
    const ib = txt(b.id);
    return ia === ib ? 0 : ia < ib ? -1 : 1; // id ASC
  });
}

export interface NodeDeriveRequest {
  statusParam?: unknown;
  colFilters?: Record<string, ColumnFilterSpec>;
  sortKey: string;
  sortDir: 'ASC' | 'DESC';
}

/**
 * Can this request be served from a row set here? Checks the request shape *and* that a real row
 * carries every field the work needs, so a projection change cannot silently break the fast path.
 */
export function canDeriveShipmentPageInNode(
  req: NodeDeriveRequest,
  sampleRow: NodeRow | undefined,
): { ok: true } | { ok: false; reason: string } {
  if (!sampleRow) return { ok: false, reason: 'row set empty - nothing to derive from' };

  const status = txt(req.statusParam);
  /**
   * Only an Open/Close-filtered table is derived here.
   *
   * With no status filter the list is the hybrid ALL view, whose order comes from a global merge
   * sort across execution and backlog rows (hybridListUsesGlobalMergeSort is true for every sort
   * key except created_at) - not from the plain ORDER BY this module reproduces. Measured: the
   * totals matched at 109 rows but the order diverged from index 5 onward.
   */
  if (!status || status.toUpperCase() === 'ALL') {
    return { ok: false, reason: 'unfiltered list is ordered by the hybrid merge sort' };
  }
  if (!isShipmentPageOpenCloseStatusParam(status)) {
    return { ok: false, reason: `status "${status}" is resolved by a dedicated SQL path` };
  }
  if (!('status' in sampleRow)) return { ok: false, reason: 'rows carry no status field' };
  if (!('row_kind' in sampleRow)) {
    return { ok: false, reason: 'rows carry no row_kind, so backlog rows cannot be excluded' };
  }

  const sortSpec = SORTABLE[req.sortKey];
  if (!sortSpec) return { ok: false, reason: `sort key "${req.sortKey}" is not Node-sortable` };
  for (const f of sortSpec.fields) {
    if (!(f in sampleRow)) return { ok: false, reason: `rows carry no ${f} for sorting` };
  }
  if (!('created_at' in sampleRow) || !('id' in sampleRow)) {
    return { ok: false, reason: 'rows carry no created_at/id tie-break' };
  }
  if (shouldPrioritizeSapStoRows(req.statusParam) && !('sto_number' in sampleRow)) {
    return { ok: false, reason: 'rows carry no sto_number for the SAP-STO priority prefix' };
  }

  for (const [colId, spec] of Object.entries(req.colFilters ?? {})) {
    if (!spec || typeof spec !== 'object') continue;
    const field = FILTERABLE_COLUMNS[colId];
    if (!field) return { ok: false, reason: `column filter "${colId}" is not a plain row column` };
    if (!(field in sampleRow)) return { ok: false, reason: `rows carry no ${field} for filtering` };
    const known = spec.type === undefined || ['text', 'number', 'multi'].includes(spec.type);
    if (!known && !spec.emptyOnly) {
      /**
       * `date` is deliberately absent. The SQL compares `(expr)::date` in the database timezone,
       * while a row carries the value as a UTC timestamp - `2027-12-30T17:00:00.000Z` is the 31st
       * in Asia/Jakarta. Truncating the ISO string would shift range boundaries by a day, so date
       * range filters stay in SQL.
       */
      return { ok: false, reason: `column filter type "${spec.type}" not mirrored` };
    }
  }
  return { ok: true };
}

/** Filter, sort and slice - the SQL path's WHERE / ORDER BY / LIMIT over an in-memory row set. */
export function deriveShipmentPageInNode(
  rows: NodeRow[],
  req: NodeDeriveRequest & { page: number; limit: number },
): { rows: NodeRow[]; total: number } {
  const filtered = nodeFilterByColumnFilters(
    nodeFilterByStatus(rows, req.statusParam),
    req.colFilters,
  );
  const sorted = nodeSortRows(filtered, req.sortKey, req.sortDir, req.statusParam);
  const limit = Math.max(1, req.limit);
  const offset = Math.max(0, (Math.max(1, req.page) - 1) * limit);
  return { rows: sorted.slice(offset, offset + limit), total: sorted.length };
}

export const SHIPMENT_NODE_SORTABLE_KEYS = Object.keys(SORTABLE);
export const SHIPMENT_NODE_FILTERABLE_COLUMNS = Object.keys(FILTERABLE_COLUMNS);
