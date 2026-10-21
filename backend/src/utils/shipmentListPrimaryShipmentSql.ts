import { shipmentListStoKeyExpr } from './shipmentStoTypeSql';

/**
 * Shared ORDER BY for picking the primary shipment row in a STO group.
 *
 * The final `id` is a tiebreaker, not a preference: without it, rows tying on every key
 * (including `created_at`) were resolved by whatever order the plan happened to deliver, so
 * `array_agg(...)[1]` returned an arbitrary row. Converting the vlp_* CTEs to LATERALs changed
 * the plan and with it one vessel in the Shipments summary's completed list - the value was
 * never wrong before, it was undefined. With `id` last the choice is stable across plans.
 * Keep in sync with sqlShipmentListPrimaryIdAgg / sqlShipmentListPrimaryFieldAgg.
 */
export function sqlShipmentListPrimaryOrderBy(
  stoKeyExpr?: string,
  contractAlias = 'c',
  spdAlias = 'l',
  shipmentAlias = 's',
  contractStosAlias?: string,
  ataOverrideAlias?: string,
): string {
  const key = stoKeyExpr ?? shipmentListStoKeyExpr(contractAlias, spdAlias, shipmentAlias);
  const stoType = contractStosAlias
    ? `UPPER(TRIM(COALESCE(NULLIF(TRIM(${contractStosAlias}.sto_type), ''), 'Z')))`
    : `'Z'`;
  /*
   * A manual ATA lives in shipment_ata_overrides, not on the shipment row. A query that joins that table (alias passed in) counts it as
   * "ATA populated" too: otherwise a group whose finished voyage carries its ATA only as an override ranked below a newer planned member with no
   * ATA, the list row opened that planned member, and Edit Shipment read Planned with an empty ATA step while the table row read Completed.
   */
  const o = ataOverrideAlias;
  const overrideAtaPresent = o
    ? `
        OR ${o}.ata_arrival IS NOT NULL
        OR ${o}.ata_loading_complete IS NOT NULL
        OR ${o}.ata_sailed IS NOT NULL
        OR ${o}.ata_discharge_start IS NOT NULL
        OR ${o}.ata_discharge_complete IS NOT NULL`
    : '';
  return `
    /*
     * A cancelled member is the LAST choice. A shipment with several POs is one row here, and one PO's shipment can be cancelled while the others
     * run (SAP deletes one line of a PO and the shipment of that line is cancelled): created_at DESC then made the newest member the primary row
     * even when it was the cancelled one, so the row opened in Edit Shipment read Cancelled and its vessel / qty fields came from the cancelled PO.
     * A group whose members are ALL cancelled is ranked as before.
     */
    CASE
      WHEN UPPER(TRIM(COALESCE(${shipmentAlias}.status, ''))) IN ('CANCELLED', 'CANCELED') THEN 1
      ELSE 0
    END,
    CASE
      WHEN ${stoType} = 'V' THEN 0
      WHEN ${stoType} = 'T' THEN 2
      ELSE 1
    END,
    CASE
      WHEN NULLIF(TRIM(${shipmentAlias}.vessel_name), '') IS NOT NULL THEN 0
      ELSE 1
    END,
    CASE
      WHEN NULLIF(TRIM(${shipmentAlias}.shipment_id::text), '') IS NOT NULL
       AND NULLIF(TRIM(${shipmentAlias}.shipment_id::text), '') = NULLIF(TRIM((${key})::text), '')
      THEN 0
      ELSE 1
    END,
    CASE
      WHEN ${shipmentAlias}.ata_arrival IS NOT NULL
        OR ${shipmentAlias}.ata_loading_complete IS NOT NULL
        OR ${shipmentAlias}.ata_sailed IS NOT NULL
        OR ${shipmentAlias}.ata_discharge_complete IS NOT NULL${overrideAtaPresent}
      THEN 0
      ELSE 1
    END,
    ${shipmentAlias}.created_at DESC,
    ${shipmentAlias}.id`;
}

/**
 * When shipment list groups multiple DB rows under one STO, pick the primary shipment row:
 * 0) a member that is not cancelled
 * 1) STO Type V (vessel) before T (trucking) / other
 * 2) row with vessel_name populated
 * 3) shipment_id matches the group STO key
 * 4) row has ATA milestones populated
 * 5) newest created_at
 *
 * Uses join aliases only (no correlated subqueries) so this is safe inside GROUP BY + array_agg.
 */
export function sqlShipmentListPrimaryIdAgg(
  stoKeyExpr?: string,
  contractAlias = 'c',
  spdAlias = 'l',
  shipmentAlias = 's',
  contractStosAlias?: string,
  ataOverrideAlias?: string,
): string {
  const orderBy = sqlShipmentListPrimaryOrderBy(
    stoKeyExpr,
    contractAlias,
    spdAlias,
    shipmentAlias,
    contractStosAlias,
    ataOverrideAlias,
  );
  return `(array_agg(${shipmentAlias}.id ORDER BY ${orderBy}
  ) FILTER (WHERE ${shipmentAlias}.id IS NOT NULL))[1]`;
}

/**
 * Same primary-row ranking as sqlShipmentListPrimaryIdAgg, but returns a field
 * (e.g. vessel_name) so list columns match the shipment opened in Edit modal.
 */
export function sqlShipmentListPrimaryFieldAgg(
  fieldExpr: string,
  stoKeyExpr?: string,
  contractAlias = 'c',
  spdAlias = 'l',
  shipmentAlias = 's',
  contractStosAlias?: string,
  ataOverrideAlias?: string,
): string {
  const orderBy = sqlShipmentListPrimaryOrderBy(
    stoKeyExpr,
    contractAlias,
    spdAlias,
    shipmentAlias,
    contractStosAlias,
    ataOverrideAlias,
  );
  return `(array_agg(${fieldExpr} ORDER BY ${orderBy}
  ) FILTER (WHERE ${shipmentAlias}.id IS NOT NULL AND NULLIF(TRIM((${fieldExpr})::text), '') IS NOT NULL))[1]`;
}

/**
 * The primary member's value, including NULL.
 *
 * `sqlShipmentListPrimaryFieldAgg` skips blanks so a vessel name falls through to the next member.
 * A date must not: the shipment Edit opens is this row, and a sibling's ATA must not fill the cell
 * when that shipment's own date is empty (OP-1004032737-34122029, ATA Discharge Complete).
 */
export function sqlShipmentListPrimaryRowValueAgg(
  fieldExpr: string,
  stoKeyExpr?: string,
  contractAlias = 'c',
  spdAlias = 'l',
  shipmentAlias = 's',
  contractStosAlias?: string,
  ataOverrideAlias?: string,
): string {
  const orderBy = sqlShipmentListPrimaryOrderBy(
    stoKeyExpr,
    contractAlias,
    spdAlias,
    shipmentAlias,
    contractStosAlias,
    ataOverrideAlias,
  );
  return `(array_agg(${fieldExpr} ORDER BY ${orderBy}
  ) FILTER (WHERE ${shipmentAlias}.id IS NOT NULL))[1]`;
}
