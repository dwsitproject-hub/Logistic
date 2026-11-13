import { masterDhmCountsSelect, type MasterDhmSource } from './masterDhmFilter';

/**
 * The SQL of the cards above a Master list: total, synced, not synced, failed (the DHM rule of masterDhmFilter) and "used in KLIP", in one pass over the table.
 *
 * `usedCondition` is a boolean SQL expression over the table's own columns that is true when KLIP actually uses the row, e.g.
 *   "EXISTS (SELECT 1 FROM master_plants p WHERE p.site_id = master_sites.id)".
 * Pass null for a master that is not "used" by anything (the card is then left out by the page and `used_in_klip` is 0).
 * Counts are over ALL rows, never the page or the filters on screen.
 */
export function masterSummarySql(source: MasterDhmSource, usedCondition: string | null): string {
  const used = usedCondition ? `COUNT(*) FILTER (WHERE ${usedCondition})::int` : '0::int';
  return `SELECT ${masterDhmCountsSelect(source)},
       ${used} AS used_in_klip
FROM ${source.table}`;
}

export interface MasterSummaryCounts {
  total: number;
  synced: number;
  notSynced: number;
  failed: number;
  usedInKlip: number;
}

/** The row masterSummarySql returns, in the shape the pages read. */
export function toMasterSummaryCounts(row: Record<string, unknown> | undefined): MasterSummaryCounts {
  return {
    total: Number(row?.total ?? 0),
    synced: Number(row?.synced ?? 0),
    notSynced: Number(row?.not_synced ?? 0),
    failed: Number(row?.failed ?? 0),
    usedInKlip: Number(row?.used_in_klip ?? 0),
  };
}
