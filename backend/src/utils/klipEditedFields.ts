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
  /*
   * sfal_qty / sfbd_qty were absent until the SAP Phase 3 template (2026-11): SAP never sent the values (0 occurrences of any SF key across 27,003
   * sap_processed_data rows), so a figure on a row proved itself as KLIP input. The template now carries SFAL / SFBD per PO line, so a figure can come from
   * either door and the marker is needed. The import writes SAP's figure to sap_sfal_qty / sap_sfbd_qty and fills sfal_qty / sfbd_qty only where no user wrote it
   * (SapDataDistributionService.fillSapFigures). Migration 255 marks the figures that exist before the first template import as the user's: the one backfill
   * this list has, justified by that evidence (re-checked on production 2026-11-06: 97 SFAL and 59 SFBD on 2,692 shipments, no SAP row has ever mentioned SFAL).
   */
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
  /*
   * port_name: the SAP plan writes it and so does the Edit Shipment modal. Marked only when a save CHANGES
   * a name that was already there (see VESSEL_LOADING_PORT_CHANGED_PROVENANCE_SQL), and cleared again when
   * the SAP import overwrites it with a different name - so the marker always means "the name on screen is
   * the user's", which equality with a SAP name cannot tell (a user can pick another SAP-reported port).
   */
  'port_name',
  /*
   * eta_* columns are deliberately absent. The SAP writer does pass them through the same merge,
   * so the code path exists - but SAP never supplies a value: across 27,003 sap_processed_data
   * rows the ETA keys appear 0 times, against 1,800 for ATA. ETA is KLIP input and proves itself,
   * and marking it would imply an ambiguity that does not exist.
   */
] as const;

/**
 * Columns on `trucking_operations` shared with the SAP import.
 *
 * `daily_deliverables` is not here on purpose: SAP never writes it, so a row holding planning is
 * already proof of KLIP authorship. The same reasoning keeps sfal_qty/sfbd_qty off the shipment
 * list above.
 */
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
 * @param changedPairs columns to record ONLY when the incoming value differs from the stored one, in this same assignment (an UPDATE may assign
 *   klip_edited_fields once): `{ column: 'sfal_qty', placeholder: '$12::numeric' }`. The comparison reads the OLD row, as buildKlipEditedFieldsChangedSetSql explains.
 */
export function buildKlipEditedFieldsSetSql(
  paramPlaceholder: string,
  changedPairs: ReadonlyArray<{ column: string; placeholder: string }> = [],
): string {
  const changed = changedPairs
    .map(
      ({ column, placeholder }) =>
        ` || CASE WHEN ${placeholder} IS DISTINCT FROM ${column} THEN ARRAY['${column}']::text[] ELSE ARRAY[]::text[] END`,
    )
    .join('');
  return `klip_edited_fields = (
    SELECT COALESCE(ARRAY(SELECT DISTINCT unnest(COALESCE(klip_edited_fields, '{}') || ${paramPlaceholder}::text[]${changed}) ORDER BY 1), '{}')
  )`;
}

/**
 * Columns of `shipments` recorded only when a save CHANGES them. The Edit Shipment modal submits sfal_qty / sfbd_qty on every save, whatever the user touched, so
 * recording whatever was submitted would mark a figure SAP filled as the user's the first time anyone saved an unrelated edit (an ETA, say) - and SAP would
 * never fill it again. A figure the user cleared is a change (NULL differs from a value) and stays marked.
 */
export const SHIPMENT_CHANGED_ONLY_PROVENANCE_COLUMNS = ['sfal_qty', 'sfbd_qty'] as const;

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

/**
 * Mark only the columns whose value this statement actually changes.
 *
 * Needed where a save submits a whole form rather than the fields a user touched - the per-port
 * ATA/quality editor does exactly that, round-tripping values it merely displayed. Marking those
 * would claim a user authored SAP's number, which is the very thing this marker exists to stop.
 *
 * The comparison is safe inside the same UPDATE: every SET expression is evaluated against the
 * OLD row, so "$12 IS DISTINCT FROM ata_vessel_arrival" asks "is the incoming value different
 * from what is stored", even though the same statement is assigning that column.
 *
 * IS DISTINCT FROM rather than <>: a column going from NULL to a value is a change, and <> would
 * answer NULL there and quietly record nothing.
 */
export function buildKlipEditedFieldsChangedSetSql(
  pairs: ReadonlyArray<{ column: string; placeholder: string }>,
): string {
  if (pairs.length === 0) return '';
  const branches = pairs
    .map(
      ({ column, placeholder }) =>
        `      || CASE WHEN ${placeholder} IS DISTINCT FROM ${column} THEN ARRAY['${column}'] ELSE ARRAY[]::text[] END`,
    )
    .join('\n');
  return `klip_edited_fields = (
    SELECT COALESCE(ARRAY(
      SELECT DISTINCT unnest(
        COALESCE(klip_edited_fields, '{}')
${branches}
      ) ORDER BY 1
    ), '{}')
  )`;
}
