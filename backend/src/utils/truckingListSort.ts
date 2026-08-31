/**
 * Trucking View Table sort field maps (UI column id → SQL ORDER BY expression).
 * Expansion-key paging ranks on trucking_source (ts) + contracts (c) + csla.
 * Expanded list pagination orders on trucking_status_scoped aliases (no table prefix).
 */

import { buildListOrderByWithSapStoPriority } from './listSapStoPrioritySql';

/** Late Indicators — same rules as trucking list column filter / UI badge. */
export function sqlTruckingLateIndicatorSortExpr(
  deliveryEndExpr: string,
  completionExpr: string,
  etaCompletionExpr: string,
): string {
  return `(
  CASE
    WHEN ${deliveryEndExpr} IS NULL THEN '-'
    WHEN ${completionExpr} IS NOT NULL THEN
      CASE
        WHEN ${deliveryEndExpr}::date < ${completionExpr}::date THEN 'Late'
        ELSE 'On Time'
      END
    WHEN ${etaCompletionExpr} IS NOT NULL THEN
      CASE
        WHEN ${deliveryEndExpr}::date < ${etaCompletionExpr}::date THEN 'Late'
        ELSE 'On Time'
      END
    WHEN ${deliveryEndExpr}::date < CURRENT_DATE THEN 'Late'
    ELSE 'On Time'
  END
)`;
}

const AGGREGATED_STO_SORT = `COALESCE(csla.agg_sto_lines, NULLIF(TRIM(ts.sto_number::text), ''))`;

/** UI sortKey → row/column alias used for ORDER BY (and in-memory hybrid sorts). */
const SORT_ALIAS_BY_KEY: Record<string, string> = {
  created_at: 'created_at',
  operation_id: 'operation_id',
  status: 'status',
  contract_number: 'contract_number',
  contract_date: 'contract_date',
  contract_ext_no: 'contract_ext_no',
  po_number: 'po_number',
  sto_number: 'sto_number',
  supplier: 'supplier',
  product: 'product',
  buyer: 'buyer',
  group_name: 'group_name',
  trucking_owner: 'trucking_owner',
  location: 'location',
  loading_location: 'loading_location',
  unloading_location: 'unloading_location',
  trucking_start_date: 'trucking_start_date',
  trucking_completion_date: 'trucking_completion_date',
  delivery_start_date: 'delivery_start_date',
  delivery_end_date: 'delivery_end_date',
  cargo_readiness_date: 'cargo_readiness_date',
  quantity_delivered: 'quantity_delivered',
  quantity_receive: 'quantity_receive',
  quantity_sent: 'quantity_sent',
  outstanding_quantity: 'outstanding_quantity',
  /** UI column id for Outstanding Qty */
  outstanding_qty_mt: 'outstanding_quantity',
  contract_qty: 'contract_qty',
  sto_quantity: 'sto_quantity',
  incoterm: 'incoterm',
  oa_budget: 'oa_budget',
  oa_actual: 'oa_actual',
  gain_loss_percentage: 'gain_loss_percentage',
  gain_loss_amount: 'gain_loss_amount',
  estimated_km: 'estimated_km',
};

/**
 * Sort expressions on expansion_keys / ranked_expansion.
 * Prefer columns already selected into trucking_source (ts.*) so OS/qty/ext no work.
 */
export function resolveTruckingExpansionKeySortField(sortKey: string): string {
  if (sortKey === 'sto_number') return AGGREGATED_STO_SORT;
  if (sortKey === 'late_indicator') {
    return sqlTruckingLateIndicatorSortExpr(
      'ts.delivery_end_date',
      'ts.trucking_completion_date',
      'ts.eta_trucking_completion_date',
    );
  }
  const alias = SORT_ALIAS_BY_KEY[sortKey];
  if (alias) return `ts.${alias}`;
  return 'ts.created_at';
}

/**
 * Sort expressions on expanded / status-scoped page CTE (unprefixed aliases).
 */
export function resolveTruckingListSortField(sortKey: string): string {
  if (sortKey === 'late_indicator') {
    return sqlTruckingLateIndicatorSortExpr(
      'delivery_end_date',
      'trucking_completion_date',
      'eta_trucking_completion_date',
    );
  }
  return SORT_ALIAS_BY_KEY[sortKey] || 'created_at';
}

/** Row property for in-memory sorts (hybrid merge) — never a SQL CASE expression. */
export function resolveTruckingListSortRowKey(sortKey: string): string {
  if (sortKey === 'late_indicator') return 'created_at';
  return SORT_ALIAS_BY_KEY[sortKey] || 'created_at';
}

export function buildTruckingExpansionKeyOrderBy(
  sortKey: string,
  sortDir: 'ASC' | 'DESC',
  stageFilter?: string | null,
): string {
  const field = resolveTruckingExpansionKeySortField(sortKey);
  return buildListOrderByWithSapStoPriority(
    AGGREGATED_STO_SORT,
    `${field} ${sortDir} NULLS LAST, ts.created_at DESC`,
    stageFilter,
  );
}

/** @deprecated Prefer resolveTruckingExpansionKeySortField — kept for tests/exports. */
export const TRUCKING_EXPANSION_KEY_SORT_FIELD: Record<string, string> = new Proxy(
  {} as Record<string, string>,
  {
    get: (_t, prop: string) => resolveTruckingExpansionKeySortField(prop),
    has: (_t, prop: string) =>
      prop === 'late_indicator' ||
      prop === 'sto_number' ||
      Object.prototype.hasOwnProperty.call(SORT_ALIAS_BY_KEY, prop),
  },
);

/** @deprecated Prefer resolveTruckingListSortField. */
export const TRUCKING_LIST_SORT_FIELD_BY_KEY: Record<string, string> = new Proxy(
  {} as Record<string, string>,
  {
    get: (_t, prop: string) => resolveTruckingListSortField(prop),
    has: (_t, prop: string) =>
      prop === 'late_indicator' || Object.prototype.hasOwnProperty.call(SORT_ALIAS_BY_KEY, prop),
  },
);
