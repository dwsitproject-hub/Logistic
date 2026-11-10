/**
 * Filling the working SFAL / SFBD figure of a shipment from SAP's own (SAP Phase 3 template, 2026-11).
 *
 * The import writes SAP's figure for each PO x STO row to shipments.sap_sfal_qty / sap_sfbd_qty (a reference, like sap_ata_*). The figure users see and edit,
 * sfal_qty / sfbd_qty, is filled from it here, once per import, under three conditions that all have to hold:
 *
 * - SAP has a figure (> 0): the template sends 0 where it has none.
 * - No user wrote the working figure: klip_edited_fields holds the column once a user saved it (migration 167; migration 255 marks the figures that existed before
 *   the template as the users'). A figure SAP filled earlier carries no marker, so it follows SAP when SAP changes it. A user who clears the field has written it
 *   too: it stays empty.
 * - The STO has ONE shipment row. SAP sends SFAL per PO line, and on a multi-PO STO that is sometimes each PO's own share and sometimes the whole voyage figure
 *   repeated on every PO (28 of the 56 STOs with an SFAL in the test pull have several POs): a sum would double count the second kind and "last row wins" would be
 *   wrong for the first. Such an STO keeps SAP's figure as a reference only, next to whatever the user entered, until the SAP team says which it is.
 *
 * Set-based on purpose: the row-by-row import cannot know the STO's final row count, and one statement is independent of the order the rows arrive in.
 */
export type SapFigureColumn = 'sfal_qty' | 'sfbd_qty';

const SAP_REFERENCE_COLUMN: Record<SapFigureColumn, string> = {
  sfal_qty: 'sap_sfal_qty',
  sfbd_qty: 'sap_sfbd_qty',
};

export function buildSapFigureFillSql(column: SapFigureColumn): string {
  const sapColumn = SAP_REFERENCE_COLUMN[column];
  return `UPDATE shipments s
     SET ${column} = s.${sapColumn},
         updated_at = CURRENT_TIMESTAMP
   WHERE s.${sapColumn} > 0
     AND UPPER(COALESCE(s.status, '')) NOT IN ('CANCELLED', 'CANCELED')
     AND s.${column} IS DISTINCT FROM s.${sapColumn}
     AND NOT ('${column}' = ANY(COALESCE(s.klip_edited_fields, '{}')))
     AND (
       SELECT COUNT(*)
         FROM shipments o
        WHERE o.shipment_id = s.shipment_id
          AND UPPER(COALESCE(o.status, '')) NOT IN ('CANCELLED', 'CANCELED')
     ) = 1`;
}
