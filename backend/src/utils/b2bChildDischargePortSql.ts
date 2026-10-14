/**
 * The discharge port of a B2B origin (parent) is its ENDING child's.
 *
 * A B2B parent is the company in the middle; the cargo is discharged where the ending child says. The child's port is in b2b_ending_child_snapshot.discharge_port
 * (migration 235), the same overlay the Region/Site, plant, buyer and unload location already use (b2bOriginEndingSql.ts). The parent's own SAP port is a plant or
 * company name on most pairs (on the dev copy 3 of 77 are a Master Port, against 99 of 159 for the child).
 *
 * Two rules, one per kind of row:
 *  - a CONTRACT with no shipment yet (the backlog, a pre-planned group's members): the child's port, else its own SAP port;
 *  - a SHIPMENT: the child's port, UNLESS a KLIP user wrote a discharge port on it (klip_edited_fields, migration 167: a name the user's save changed, on the
 *    shipment or on a discharge leg) - what a person typed is a correction and wins. Then, and when there is no child, the shipment shows what it did before.
 *
 * Provenance only knows saves made after migration 167, and marks a leg name only when a save CHANGED a name that was already there: a port typed on an older
 * shipment, or on a leg created by hand, is not recognised as typed and gives way to the child's.
 *
 * Every expression is a scalar subquery that evaluates the snapshot lookup once. The origin PO is the contract's po_number (the child's "Contract Reff PO Ini").
 */
import { sqlB2bChildDischargePortLookup } from './b2bOriginEndingSql';

/** True when a KLIP user wrote the discharge port of this shipment: its own column, or an active discharge leg's name. */
export function sqlShipmentDischargePortTypedByUser(shipmentAlias = 's'): string {
  return `(
    'port_of_discharge' = ANY(${shipmentAlias}.klip_edited_fields)
    OR EXISTS (
      SELECT 1 FROM vessel_loading_ports vt
      WHERE vt.shipment_id = ${shipmentAlias}.id
        AND COALESCE(vt.is_discharge_port, false) = true
        AND COALESCE(vt.is_cancelled, false) = false
        AND 'port_name' = ANY(vt.klip_edited_fields)
    )
  )`;
}

/**
 * The ending child's port for this shipment, or NULL when it has none, the shipment's port was typed by a user, or the snapshot is being rebuilt.
 * Where it is not NULL it replaces every other port of the shipment.
 */
export function sqlShipmentB2bChildDischargePort(shipmentAlias = 's', contractAlias = 'c'): string {
  return `(
    SELECT b2bc.p
    FROM (SELECT ${sqlB2bChildDischargePortLookup(`${contractAlias}.po_number`)} AS p) b2bc
    WHERE b2bc.p IS NOT NULL
      AND NOT ${sqlShipmentDischargePortTypedByUser(shipmentAlias)}
  )`;
}

/** A contract's own latest-SAP-row port expression is passed in (its text is repeated by humanReadablePortNameExpr, so the caller evaluates it once). */
export function sqlContractDischargePortWithB2bChild(contractPoRef: string, ownPortExpr: string): string {
  return `COALESCE(${sqlB2bChildDischargePortLookup(contractPoRef)}, ${ownPortExpr})`;
}
