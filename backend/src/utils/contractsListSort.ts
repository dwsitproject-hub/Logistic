import { sqlContractOutstandingSignedExpr } from './sapIncotermMetrics';

/**
 * GET /contracts list sort.
 *
 * SQL keys ORDER BY on the `filtered` CTE then LIMIT/OFFSET (all pages).
 * Node keys are computed after row hydration (cycle / overall status);
 * the handler fetches up to 10k matching rows, sorts, then slices the page.
 */

export type ContractsListSortMode = 'sql' | 'node';

export interface ContractsListSortResolution {
  sortKey: string;
  orderExpr: string;
  mode: ContractsListSortMode;
  /** last_vessel_name / ETA aliases live on cycle field select. */
  needsCycleFields: boolean;
}

const OUTSTANDING_QTY_EXPR = sqlContractOutstandingSignedExpr({
  contractQtyExpr: 'quantity_ordered',
  incotermExpr: 'incoterm',
  receiveExpr: 'quantity_receive',
  deliveryExpr: 'quantity_delivery',
});

/** Expressions must be static (never interpolate the request sortKey). */
export const CONTRACTS_LIST_SQL_SORT_COLUMNS: Record<string, string> = {
  contract_date: 'contract_date::date',
  contract_id: 'contract_id',
  status: 'status',
  supplier: 'supplier',
  supplier_name: 'supplier',
  buyer: 'buyer',
  product: 'product',
  group_name: 'group_name',
  company_name: 'company_name',
  incoterm: 'incoterm',
  transport_mode: 'transport_mode',
  delivery_start: 'delivery_start_date::date',
  delivery_end: 'delivery_end_date::date',
  delivery_start_date: 'delivery_start_date::date',
  delivery_end_date: 'delivery_end_date::date',
  sto_count: 'sto_count',
  total_sto_quantity: 'total_sto_quantity',
  outstanding_qty: OUTSTANDING_QTY_EXPR,
  outstanding_qty_mt: OUTSTANDING_QTY_EXPR,
  contract_qty: 'quantity_ordered',
  po_number: 'po_numbers',
  po_numbers: 'po_numbers',
  sto_number: `COALESCE(NULLIF(TRIM(sto_numbers_agg), ''), NULLIF(TRIM(sto_number::text), ''))`,
  sto_numbers: `COALESCE(NULLIF(TRIM(sto_numbers_agg), ''), NULLIF(TRIM(sto_number::text), ''))`,
  contract_ext_no: `COALESCE(latest_spd_data->'raw'->>'Contract Ext No', latest_spd_data->>'Contract Ext No')`,
  source_type: 'source_type',
  lt_spot: `COALESCE(latest_spd_data->'contract'->>'ltc_spot', contract_type::text)`,
  delivery_qty: 'quantity_delivery',
  received_qty: 'quantity_receive',
  quantity_delivery: 'quantity_delivery',
  quantity_receive: 'quantity_receive',
  month_delivery_end: `to_char(delivery_end_date::date, 'YYYY-MM')`,
  cargo_readiness_date: 'cargo_readiness_date::date',
  vessel_name: `NULLIF(TRIM(last_vessel_name), '')`,
  eta_vessel_completed_loading: 'last_eta_vessel_completed_loading',
  eta_vessel_complete_discharge: 'last_eta_vessel_complete_discharge',
  last_planning_delivery_date: 'last_trucking_daily_deliverable_date',
};

const SQL_SORT_NEEDS_CYCLE_FIELDS = new Set([
  'vessel_name',
  'eta_vessel_completed_loading',
  'eta_vessel_complete_discharge',
  'last_planning_delivery_date',
]);

/** Hydrated in getContracts after cycle / payment fields are attached. */
export const CONTRACTS_LIST_NODE_SORT_KEYS = new Set([
  'log_cycle_days',
  'trade_cycle_days',
  'cash_cycle_days',
  'dp_cycle_days',
  'status_overall',
  'over_under_delivery_status',
]);

const NODE_NUMERIC_SORT_KEYS = new Set([
  'log_cycle_days',
  'trade_cycle_days',
  'cash_cycle_days',
  'dp_cycle_days',
]);

export function resolveContractsListSort(sortKeyRaw: unknown): ContractsListSortResolution {
  const key = typeof sortKeyRaw === 'string' ? sortKeyRaw.trim() : '';
  if (CONTRACTS_LIST_NODE_SORT_KEYS.has(key)) {
    return {
      sortKey: key,
      orderExpr: CONTRACTS_LIST_SQL_SORT_COLUMNS.contract_date,
      mode: 'node',
      needsCycleFields: true,
    };
  }
  if (CONTRACTS_LIST_SQL_SORT_COLUMNS[key]) {
    return {
      sortKey: key,
      orderExpr: CONTRACTS_LIST_SQL_SORT_COLUMNS[key],
      mode: 'sql',
      needsCycleFields: SQL_SORT_NEEDS_CYCLE_FIELDS.has(key),
    };
  }
  return {
    sortKey: 'contract_date',
    orderExpr: CONTRACTS_LIST_SQL_SORT_COLUMNS.contract_date,
    mode: 'sql',
    needsCycleFields: false,
  };
}

function deliveryStatusUpper(row: Record<string, unknown>): string {
  return String(row.import_status || row.status || '')
    .trim()
    .toUpperCase();
}

export function computeStatusOverallSortValue(row: Record<string, unknown>): string {
  const delivery = deliveryStatusUpper(row);
  const paid = String(row.payment_status || '').toUpperCase() === 'PAID';
  if (delivery === 'CLOSE' && paid) return 'Close';
  return String(row.import_status || row.status || '');
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function contractsListSortNumeric(row: Record<string, unknown>, sortKey: string): number | null {
  return asNumber(row[sortKey]);
}

function contractsListSortString(row: Record<string, unknown>, sortKey: string): string {
  if (sortKey === 'status_overall') return computeStatusOverallSortValue(row);
  if (sortKey === 'over_under_delivery_status') {
    return String(row.over_under_delivery_status || '');
  }
  return String(row[sortKey] ?? '');
}

/** NULLS LAST, then value. dirMul is 1 (ASC) or -1 (DESC). */
export function compareContractsListSortRows(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
  sortKey: string,
  dirMul: number,
  _todayMid: Date = new Date(),
): number {
  if (NODE_NUMERIC_SORT_KEYS.has(sortKey)) {
    const av = contractsListSortNumeric(a, sortKey);
    const bv = contractsListSortNumeric(b, sortKey);
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    return (av - bv) * dirMul;
  }
  const as = contractsListSortString(a, sortKey);
  const bs = contractsListSortString(b, sortKey);
  if (!as && !bs) return 0;
  if (!as) return 1;
  if (!bs) return -1;
  return as.localeCompare(bs, undefined, { numeric: true, sensitivity: 'base' }) * dirMul;
}
