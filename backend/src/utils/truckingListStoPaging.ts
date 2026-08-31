import type { ColumnFilterPayload } from './contractListFilters';
export {
  buildTruckingExpansionKeyOrderBy,
  resolveTruckingExpansionKeySortField,
  resolveTruckingListSortField,
  TRUCKING_EXPANSION_KEY_SORT_FIELD,
  TRUCKING_LIST_SORT_FIELD_BY_KEY,
} from './truckingListSort';

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
