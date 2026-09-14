/**
 * Recording which columns a KLIP user wrote — see migration 167.
 *
 * The rule this enforces is narrow on purpose: a field is marked only when a user's own request
 * supplied it. Nothing derived, nothing imported, nothing backfilled. A marker that is sometimes
 * inferred is worse than no marker, because it cannot then be trusted anywhere.
 */

/** Columns on `shipments` that the SAP import also writes, so provenance is ambiguous without this. */
export const SHIPMENT_PROVENANCE_COLUMNS = [
  'vessel_code',
  'vessel_name',
  'port_of_loading',
  'port_of_discharge',
  'quantity_delivered',
  'actual_vessel_qty_receive',
  'sfal_qty',
  'sfbd_qty',
  'ata_arrival',
  'ata_berthed',
  'ata_loading_start',
  'ata_loading_complete',
  'ata_sailed',
  'ata_discharge_arrival',
  'ata_discharge_berthed',
  'ata_discharge_start',
  'ata_discharge_complete',
] as const;

/** Columns on `vessel_loading_ports` shared with the SAP import. */
export const VESSEL_LOADING_PORT_PROVENANCE_COLUMNS = [
  'ata_vessel_arrival',
  'ata_vessel_berthed',
  'ata_loading_start',
  'ata_loading_completed',
  'ata_vessel_sailed',
  'quality_ffa',
  'quality_mi',
  'quality_dobi',
  'quality_red',
  'quality_ds',
  'quality_stone',
  'quantity_at_loading_port',
  'loading_rate',
] as const;

/** Columns on `trucking_operations` shared with the SAP import. */
export const TRUCKING_PROVENANCE_COLUMNS = [
  'loading_location',
  'unloading_location',
  'quantity_delivered',
] as const;

/**
 * SQL that unions the given column names into `klip_edited_fields` without duplicating them.
 *
 * Union rather than replace: a later edit to one field must not erase the record of an earlier
 * edit to another. Returns null when there is nothing to record, so callers can skip the clause
 * entirely rather than emit a no-op.
 *
 * @param paramPlaceholder the bind placeholder holding a text[] of column names, e.g. '$7'
 */
export function buildKlipEditedFieldsSetSql(paramPlaceholder: string): string {
  return `klip_edited_fields = (
    SELECT COALESCE(ARRAY(SELECT DISTINCT unnest(COALESCE(klip_edited_fields, '{}') || ${paramPlaceholder}::text[]) ORDER BY 1), '{}')
  )`;
}

/**
 * The columns to record for this save, from the fields the request actually supplied.
 *
 * `provided` is the set of column names the update is writing. Only those that are ambiguous
 * (i.e. in the table's provenance list) are worth recording - a KLIP-only column like
 * `daily_deliverables` already proves itself.
 */
export function klipEditedFieldsToRecord(
  provided: readonly string[],
  ambiguousColumns: readonly string[],
): string[] {
  const ambiguous = new Set(ambiguousColumns);
  const out = new Set<string>();
  for (const column of provided) {
    if (ambiguous.has(column)) out.add(column);
  }
  return [...out].sort();
}
