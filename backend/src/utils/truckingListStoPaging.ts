import type { ColumnFilterPayload } from './contractListFilters';
import { buildListOrderByWithSapStoPriority } from './listSapStoPrioritySql';

export type TruckingStoPagingFilterInput = {
  summaryOnly: boolean;
  stoIsSet: boolean;
  contractIsSet: boolean;
  status?: string;
  location?: string;
  loadingLocation?: string;
  unloadingLocation?: string;
  lateIndicator?: string;
  globalSearch?: string;
  colFilters?: ColumnFilterPayload;
  unplannedHybrid?: boolean;
  allHybrid?: boolean;
};

function hasColumnFilters(colFilters?: ColumnFilterPayload): boolean {
  if (!colFilters) return false;
  return Object.keys(colFilters).length > 0;
}

/**
 * Expansion-key paging is only safe when pipeline status / outer filters are off —
 * status is derived per operation (PO grain) and must not be applied before paging.
 */
export function canUseTruckingStoKeyPaging(input: TruckingStoPagingFilterInput): boolean {
  if (input.summaryOnly || input.unplannedHybrid || input.allHybrid) return false;
  if (input.stoIsSet || input.contractIsSet) return false;
  if (String(input.globalSearch ?? '').trim().length >= 2) return false;
  if (hasColumnFilters(input.colFilters)) return false;
  if (input.lateIndicator && String(input.lateIndicator).toUpperCase() !== 'ALL') return false;
  if (input.location?.trim()) return false;
  if (input.loadingLocation?.trim()) return false;
  if (input.unloadingLocation?.trim()) return false;
  const status = String(input.status ?? 'ALL').trim().toUpperCase();
  if (status && status !== 'ALL') return false;
  return true;
}

/**
 * Aggregated STO list for expansion-key sort (PO grain — one row per operation).
 * Reads the pre-aggregated contract_sto_lines_agg (LEFT JOINed as `csla` in ranked_expansion)
 * instead of a correlated STRING_AGG subquery re-run per row — same fix as sto_line_resolved
 * in truckingListStoExpandSql.ts.
 */
const AGGREGATED_STO_SORT = `COALESCE(csla.agg_sto_lines, NULLIF(TRIM(ts.sto_number::text), ''))`;

/** Sort expressions available on expansion_keys (trucking_source + contracts). */
const EXPANSION_KEY_SORT_FIELD: Record<string, string> = {
  created_at: 'ts.created_at',
  operation_id: 'ts.operation_id',
  status: 'ts.status',
  contract_number: 'c.contract_id',
  po_number: 'c.po_number',
  sto_number: AGGREGATED_STO_SORT,
  supplier: 'c.supplier',
  trucking_owner: 'ts.trucking_owner',
  loading_location: 'ts.loading_location',
  unloading_location: 'ts.unloading_location',
  trucking_start_date: 'ts.trucking_start_date',
  trucking_completion_date: 'ts.trucking_completion_date',
  delivery_start_date: 'c.delivery_start_date',
  delivery_end_date: 'c.delivery_end_date',
  quantity_delivered: 'ts.quantity_delivered',
  quantity_receive: 'ts.quantity_receive',
  outstanding_quantity: 'ts.outstanding_quantity',
  quantity_sent: 'ts.quantity_sent',
  contract_qty: 'c.quantity_ordered',
  incoterm: 'c.incoterm',
  oa_budget: 'ts.oa_budget',
  oa_actual: 'ts.oa_actual',
  gain_loss_percentage: 'ts.gain_loss_percentage',
  gain_loss_amount: 'ts.gain_loss_amount',
};

export function buildTruckingExpansionKeyOrderBy(
  sortKey: string,
  sortDir: 'ASC' | 'DESC',
  stageFilter?: string | null,
): string {
  const field = EXPANSION_KEY_SORT_FIELD[sortKey] || 'ts.created_at';
  return buildListOrderByWithSapStoPriority(
    AGGREGATED_STO_SORT,
    `${field} ${sortDir} NULLS LAST, ts.created_at DESC`,
    stageFilter,
  );
}
