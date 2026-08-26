import type { ColumnFilterPayload } from './contractListFilters';
import { isExactStoGlobalSearch } from './shipmentListFilters';

export const SHIPMENT_BASE_CORE_GROUP_BY_MARKER = '/* SHIPMENT_BASE_CORE_GROUP_BY */';

export type ShipmentStoPagingFilterInput = {
  summaryOnly: boolean;
  stoIsSet: boolean;
  status?: string;
  etaLoading?: string | null;
  etaDischarge?: string | null;
  lateIndicator?: string;
  charterType?: string;
  globalSearch?: string;
  colFilters?: ColumnFilterPayload;
  viewOption?: string;
  viewQuery?: string;
  unplannedHybrid?: boolean;
  allHybrid?: boolean;
  /** List ORDER BY key — paging is only safe when ranked_sto can ORDER BY the same column. */
  sortKey?: string;
};

/**
 * Sort keys that ranked_sto can ORDER BY from shipments/contracts (before grouping).
 * Qty/SAP sorts must not use this pager — they enrich the full filtered set first.
 */
export const SHIPMENT_STO_PAGING_SORT_EXPR: Record<string, string> = {
  created_at: 'MAX(s.created_at)',
  vessel_name: "LOWER(NULLIF(TRIM(MAX(s.vessel_name::text)), ''))",
  vessel_code: "LOWER(NULLIF(TRIM(MAX(s.vessel_code::text)), ''))",
  supplier: "LOWER(NULLIF(TRIM(MAX(c.supplier::text)), ''))",
  product: "LOWER(NULLIF(TRIM(MAX(c.product::text)), ''))",
  incoterm: "LOWER(NULLIF(TRIM(MAX(c.incoterm::text)), ''))",
  sto_number: "LOWER(NULLIF(TRIM(MAX(COALESCE(s.shipment_id, c.sto_number)::text)), ''))",
  shipment_id: "LOWER(NULLIF(TRIM(MAX(s.shipment_id::text)), ''))",
  contract_date: 'MAX(c.contract_date)',
};

export function shipmentStoPagingSortKey(sortKey?: string): string {
  const key = String(sortKey ?? 'created_at').trim() || 'created_at';
  return SHIPMENT_STO_PAGING_SORT_EXPR[key] ? key : 'created_at';
}

export function canRankStoForListSort(sortKey?: string): boolean {
  const key = String(sortKey ?? 'created_at').trim() || 'created_at';
  return Object.prototype.hasOwnProperty.call(SHIPMENT_STO_PAGING_SORT_EXPR, key);
}

/**
 * Toolbar multi-selects already pushed into the pre-group WHERE (shared with `ranked_sto`)
 * via `appendContractScopeToolbarFilters` — safe to keep STO-key paging on for these.
 * Only the `multi` filter type is whitelisted; any other filter type on these same
 * columns (text/number/date/emptyOnly) is NOT reflected in that pre-group WHERE and
 * must still fall back to the full-scan path.
 */
const PRE_GROUP_SAFE_COLUMN_FILTER_KEYS = new Set(['product', 'incoterm', 'supplier']);

function hasBlockingColumnFilters(colFilters?: ColumnFilterPayload): boolean {
  if (!colFilters) return false;
  return Object.entries(colFilters).some(([key, filter]) => {
    if (!PRE_GROUP_SAFE_COLUMN_FILTER_KEYS.has(key)) return true;
    return !filter || typeof filter !== 'object' || filter.type !== 'multi';
  });
}

/**
 * STO-key paging is only safe when card/status filters are off — otherwise page keys
 * before status derivation would skew rows and totals.
 */
export function canUseShipmentStoKeyPaging(input: ShipmentStoPagingFilterInput): boolean {
  if (input.summaryOnly || input.unplannedHybrid || input.allHybrid || input.stoIsSet) return false;
  if (!canRankStoForListSort(input.sortKey)) return false;
  const globalSearchTrim = String(input.globalSearch ?? '').trim();
  if (globalSearchTrim.length >= 2 && !isExactStoGlobalSearch(globalSearchTrim)) return false;
  if (hasBlockingColumnFilters(input.colFilters)) return false;
  if (input.lateIndicator && String(input.lateIndicator).toUpperCase() !== 'ALL') return false;
  if (input.charterType && String(input.charterType).toUpperCase() !== 'ALL') return false;
  const viewOpt = String(input.viewOption ?? 'all').toLowerCase();
  if (viewOpt !== 'all' && String(input.viewQuery ?? '').trim().length > 0) return false;
  const status = String(input.status ?? 'ALL').trim().toUpperCase();
  if (status && status !== 'ALL') return false;
  if (input.etaLoading) return false;
  if (input.etaDischarge) return false;
  return true;
}

/** Pre-aggregated contract/PO/supplier links for the paged STO keys (shared by both pagers). */
const STO_LINK_AGG_CTE_SQL = `
      sto_link_agg AS (
        SELECT
          m.sto_key,
          STRING_AGG(DISTINCT m.contract_id, ', ' ORDER BY m.contract_id) AS contract_numbers,
          STRING_AGG(DISTINCT m.po_number, ', ' ORDER BY m.po_number)
            FILTER (WHERE m.po_number IS NOT NULL AND TRIM(m.po_number) <> '') AS po_numbers,
          COUNT(DISTINCT m.contract_id)::int AS contract_count,
          STRING_AGG(DISTINCT m.supplier, ', ' ORDER BY m.supplier)
            FILTER (WHERE m.supplier IS NOT NULL AND TRIM(m.supplier) <> '') AS suppliers_linked
        FROM (
          SELECT TRIM(cs.sto_number::text) AS sto_key, c.contract_id, c.po_number, c.supplier
          FROM paged_sto ps
          JOIN contract_stos cs ON TRIM(cs.sto_number::text) = TRIM(ps.sto_key::text)
          JOIN contracts c ON c.id = cs.contract_id
          WHERE c.contract_id IS NOT NULL AND TRIM(c.contract_id) <> ''
          UNION
          SELECT TRIM(c.sto_number::text), c.contract_id, c.po_number, c.supplier
          FROM paged_sto ps
          JOIN contracts c ON TRIM(c.sto_number::text) = TRIM(ps.sto_key::text)
          WHERE c.contract_id IS NOT NULL AND TRIM(c.contract_id) <> ''
            AND NULLIF(TRIM(c.sto_number::text), '') IS NOT NULL
        ) m
        GROUP BY m.sto_key
      ),`;

export function buildRankedStoCtes(
  stoKeyExpr: string,
  coreWhereSql: string,
  sortKey = 'created_at',
  sortDir: 'ASC' | 'DESC' = 'DESC',
): string {
  const key = shipmentStoPagingSortKey(sortKey);
  const orderExpr = SHIPMENT_STO_PAGING_SORT_EXPR[key] ?? 'MAX(s.created_at)';
  const dir = sortDir === 'ASC' ? 'ASC' : 'DESC';
  return `
      ranked_sto AS (
        SELECT ${stoKeyExpr} AS sto_key,
          MAX(s.created_at) AS mx,
          ${orderExpr} AS sort_val
        FROM shipments s
        LEFT JOIN contracts c ON s.contract_id = c.id
        LEFT JOIN latest_spd_contract l ON l.contract_number = c.contract_id
        WHERE 1=1
          AND (${coreWhereSql})
          AND NOT (
            l.contract_number IS NOT NULL
            AND UPPER(NULLIF(TRIM(COALESCE(l.b2b_flag_raw, c.contract_type::text, '')), '')) = 'B2B'
            AND NULLIF(TRIM(COALESCE(l.contract_reference_po_raw, '')), '') IS NOT NULL
          )
        GROUP BY 1
      ),
      paged_sto AS (
        SELECT sto_key FROM ranked_sto
        ORDER BY sort_val ${dir} NULLS LAST, mx DESC
        LIMIT __STO_PAGE_LIMIT__ OFFSET __STO_PAGE_OFFSET__
      ),${STO_LINK_AGG_CTE_SQL}`;
}

/**
 * Paging CTEs for an already-resolved key page (e.g. from the stage snapshot).
 * Preserves the given key order and satisfies the same CTE contract as
 * buildRankedStoCtes (ranked_sto / paged_sto / sto_link_agg).
 */
export function buildResolvedStoKeyPageCtes(stoKeys: string[]): string {
  const values =
    stoKeys.length > 0
      ? stoKeys
          .map((key, i) => `('${String(key).replace(/'/g, "''")}', ${i})`)
          .join(', ')
      : null;
  const rankedSto = values
    ? `ranked_sto AS (
        SELECT v.sto_key::text AS sto_key, v.ord
        FROM (VALUES ${values}) v(sto_key, ord)
      )`
    : `ranked_sto AS (
        SELECT NULL::text AS sto_key, 0 AS ord WHERE FALSE
      )`;
  return `
      ${rankedSto},
      paged_sto AS (
        SELECT sto_key FROM ranked_sto ORDER BY ord
      ),${STO_LINK_AGG_CTE_SQL}`;
}

/**
 * Stage-snapshot paging applies to status-card list requests whose remaining filters
 * are toolbar scope only (the same conditions as STO-key paging, except that a
 * grouped pipeline status IS selected). Unplanned uses the hybrid path instead.
 */
export function canUseShipmentStageSnapshotPaging(input: ShipmentStoPagingFilterInput): boolean {
  const status = String(input.status ?? 'ALL').trim().toUpperCase();
  if (!status || status === 'ALL' || status === 'UNPLANNED' || status === 'COMPLETED') return false;
  // Snapshot keys are stored in created_at order; vessel/supplier sorts would page the wrong 20 keys.
  if (shipmentStoPagingSortKey(input.sortKey) !== 'created_at') return false;
  return canUseShipmentStoKeyPaging({ ...input, status: 'ALL' });
}

export function injectShipmentStoKeyPaging(
  baseCteSql: string,
  stoKeyExpr: string,
  rankedStoBlock: string,
): string | null {
  const anchor = 'shipment_base_core AS (';
  const idx = baseCteSql.indexOf(anchor);
  if (idx < 0) return null;
  if (!baseCteSql.includes(SHIPMENT_BASE_CORE_GROUP_BY_MARKER)) return null;

  const pagedFilter = `AND TRIM((${stoKeyExpr})::text) IN (SELECT TRIM(sto_key::text) FROM paged_sto)`;
  const pagingSuffix = `${pagedFilter}\n        ${SHIPMENT_BASE_CORE_GROUP_BY_MARKER}`;
  return (
    baseCteSql.slice(0, idx) +
    rankedStoBlock +
    baseCteSql.slice(idx).replace(SHIPMENT_BASE_CORE_GROUP_BY_MARKER, () => pagingSuffix)
  );
}

/** Shell enrich — join pre-aggregated STO links (no per-row subqueries). */
export function buildShipmentShellEnrichWithStoLinkAgg(): string {
  return `,
      shipment_base AS (
        SELECT
          g.*,
          COALESCE(sla.contract_numbers, g.contract_numbers_from_join) AS contract_numbers,
          COALESCE(sla.po_numbers, g.po_numbers_from_join) AS po_numbers,
          COALESCE(sla.contract_count, g.contract_count_from_join) AS contract_count,
          g.contract_ext_no_from_join AS contract_ext_no,
          COALESCE(sla.suppliers_linked, g.suppliers) AS suppliers_linked
        FROM shipment_base_core g
        LEFT JOIN sto_link_agg sla ON TRIM(sla.sto_key::text) = TRIM(g.sto_key::text)
      )`;
}
