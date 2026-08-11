import { buildListOrderByWithSapStoPriority } from './listSapStoPrioritySql';

/** Sortable shipment list columns mapped to filtered_shipments (`fs`) expressions. */
export const SHIPMENT_LIST_SORT_COLUMNS: Record<string, string> = {
  created_at: 'fs.created_at',
  vessel_name: "LOWER(NULLIF(TRIM(fs.vessel_name::text), ''))",
  sto_number: 'fs.sto_number',
  shipment_id: 'fs.sto_number',
  contract_numbers: 'fs.contract_numbers',
  contract_number: 'fs.contract_numbers',
  po_numbers: 'fs.po_numbers',
  status: 'fs.status',
  plant_site: 'fs.plant_site',
  supplier: 'fs.supplier',
  suppliers: 'fs.suppliers',
  product: 'fs.product',
  products: 'fs.products',
  incoterm: 'fs.incoterm',
  contract_date: 'fs.contract_date',
  charter_type: 'fs.charter_type',
  operation_id: 'fs.operation_id',
  delivery_start_date: 'fs.delivery_start_date',
  delivery_end_date: 'fs.delivery_end_date',
  quantity_shipped: 'fs.quantity_shipped',
  quantity_delivered: 'fs.quantity_delivered',
  eta_arrival: 'fs.eta_arrival',
  eta_sailed: 'fs.eta_sailed',
  eta_discharge_complete: 'fs.eta_discharge_complete',
  ata_vessel_completed_loading: 'fs.ata_vessel_completed_loading',
  ata_vessel_complete_discharge: 'fs.ata_vessel_complete_discharge',
};

/** Contract backlog slice sort (Unplanned / ALL hybrid). */
export const SHIPMENT_CONTRACT_BACKLOG_SORT_COLUMNS: Record<string, string> = {
  created_at: 'c.created_at',
  vessel_name: 'c.contract_date',
  sto_number: 'c.contract_id',
  shipment_id: 'c.contract_id',
  contract_numbers: 'c.contract_id',
  contract_number: 'c.contract_id',
  po_numbers: 'c.po_number',
  status: `'UNPLANNED'`,
  plant_site: 'c.plant_code',
  supplier: 'c.supplier',
  suppliers: 'c.supplier',
  product: 'c.product',
  products: 'c.product',
  incoterm: 'c.incoterm',
  contract_date: 'c.contract_date',
  charter_type: 'c.contract_id',
  operation_id: 'c.contract_id',
  delivery_start_date: 'c.delivery_start_date',
  delivery_end_date: 'c.delivery_end_date',
};

export function parseShipmentListSort(
  sortKeyRaw?: unknown,
  sortDirRaw?: unknown,
): { sortKey: string; sortDir: 'ASC' | 'DESC' } {
  const keyTrim = typeof sortKeyRaw === 'string' ? sortKeyRaw.trim() : '';
  const sortKey =
    keyTrim && SHIPMENT_LIST_SORT_COLUMNS[keyTrim] ? keyTrim : 'created_at';
  const sortDir =
    String(sortDirRaw ?? '').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  return { sortKey, sortDir };
}

function withRowPrefix(expr: string, prefix: string): string {
  if (prefix === 'fs') return expr;
  return expr.replace(/\bfs\./g, `${prefix}.`);
}

/** ORDER BY clause for shipment execution rows (before LIMIT/OFFSET). */
export function buildShipmentListPageOrderBy(
  sortKey: string,
  sortDir: 'ASC' | 'DESC',
  tableStatusFilter?: string,
  rowPrefix = 'fs',
): string {
  const field = SHIPMENT_LIST_SORT_COLUMNS[sortKey] ?? SHIPMENT_LIST_SORT_COLUMNS.created_at;
  const sortExpr = withRowPrefix(field, rowPrefix);
  const createdAtExpr = withRowPrefix('fs.created_at', rowPrefix);
  const stoExpr = withRowPrefix('fs.sto_number', rowPrefix);
  const primaryOrder = `${sortExpr} ${sortDir} NULLS LAST, ${createdAtExpr} DESC`;
  return buildListOrderByWithSapStoPriority(stoExpr, primaryOrder, tableStatusFilter);
}

/** ORDER BY for Unplanned / ALL hybrid contract backlog page queries. */
export function buildShipmentContractBacklogOrderBy(
  sortKey: string,
  sortDir: 'ASC' | 'DESC',
): string {
  const field =
    SHIPMENT_CONTRACT_BACKLOG_SORT_COLUMNS[sortKey] ??
    SHIPMENT_CONTRACT_BACKLOG_SORT_COLUMNS.created_at;
  if (sortKey === 'created_at' || !SHIPMENT_CONTRACT_BACKLOG_SORT_COLUMNS[sortKey]) {
    return `c.contract_date ${sortDir} NULLS LAST, c.contract_id ASC`;
  }
  return `${field} ${sortDir} NULLS LAST, c.contract_date DESC NULLS LAST, c.contract_id ASC`;
}
