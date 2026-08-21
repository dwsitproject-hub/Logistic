import { shipmentListStoKeyExpr } from './shipmentStoTypeSql';

/**
 * Shared ORDER BY for picking the primary shipment row in a STO group.
 * Keep in sync with sqlShipmentListPrimaryIdAgg / sqlShipmentListPrimaryFieldAgg.
 */
export function sqlShipmentListPrimaryOrderBy(
  stoKeyExpr?: string,
  contractAlias = 'c',
  spdAlias = 'l',
  shipmentAlias = 's',
  contractStosAlias?: string,
): string {
  const key = stoKeyExpr ?? shipmentListStoKeyExpr(contractAlias, spdAlias, shipmentAlias);
  const stoType = contractStosAlias
    ? `UPPER(TRIM(COALESCE(NULLIF(TRIM(${contractStosAlias}.sto_type), ''), 'Z')))`
    : `'Z'`;
  return `
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
        OR ${shipmentAlias}.ata_discharge_complete IS NOT NULL
      THEN 0
      ELSE 1
    END,
    ${shipmentAlias}.created_at DESC`;
}

/**
 * When shipment list groups multiple DB rows under one STO, pick the primary shipment row:
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
): string {
  const orderBy = sqlShipmentListPrimaryOrderBy(
    stoKeyExpr,
    contractAlias,
    spdAlias,
    shipmentAlias,
    contractStosAlias,
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
): string {
  const orderBy = sqlShipmentListPrimaryOrderBy(
    stoKeyExpr,
    contractAlias,
    spdAlias,
    shipmentAlias,
    contractStosAlias,
  );
  return `(array_agg(${fieldExpr} ORDER BY ${orderBy}
  ) FILTER (WHERE ${shipmentAlias}.id IS NOT NULL AND NULLIF(TRIM((${fieldExpr})::text), '') IS NOT NULL))[1]`;
}
