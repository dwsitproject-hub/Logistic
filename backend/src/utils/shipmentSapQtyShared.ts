/**
 * "The SAP quantities on this Shipments row are not this row's."
 *
 * A KLIP-identified group (operation OP-..., manual MNL-... / MSEA-... key) has no SAP STO of its own: the list ties SAP rows to it through the
 * contract number. When the same contract sits in two such groups - a PO planned on one vessel and again on another to cover what the first voyage
 * left outstanding - BOTH rows are handed the contract's whole SAP Delivered / Received, so the second voyage shows the first voyage's received
 * quantity (PO 1001031313: Dahlia 1,366 MT received, and the same 1,366 MT on Kapuas 168).
 *
 * The group is identified by KLIP's own operation id / shipment id, so an STO is not needed to tell the groups apart, and a group that has a real
 * SAP STO (a digits key) is never flagged: its SAP quantities are that STO's.
 *
 * Both arguments are SQL expressions: the group key, and the comma-separated business contract numbers of the group.
 */
export function sqlSapQtySharedAcrossShipments(groupKeyExpr: string, contractNumbersExpr: string): string {
  return `(
    TRIM(COALESCE((${groupKeyExpr})::text, '')) ~ '^(OP-|MNL-|MSEA-)'
    AND EXISTS (
      SELECT 1
      FROM shipments sq_o
      JOIN contracts sq_c ON sq_c.id = sq_o.contract_id
      WHERE sq_c.contract_id = ANY(string_to_array(regexp_replace(COALESCE((${contractNumbersExpr})::text, ''), '\\s', '', 'g'), ','))
        AND UPPER(TRIM(COALESCE(sq_o.status, ''))) NOT IN ('CANCELLED', 'CANCELED')
        AND COALESCE(NULLIF(TRIM(sq_o.operation_id::text), ''), NULLIF(TRIM(sq_o.shipment_id::text), ''))
            IS DISTINCT FROM TRIM((${groupKeyExpr})::text)
    )
  )`;
}
