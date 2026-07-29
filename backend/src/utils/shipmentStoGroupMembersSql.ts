import { query } from '../database/connection';

/** STO key for a shipment row without requiring latest_spd_contract join. */
export function shipmentStoKeyWithoutSpdExpr(
  contractAlias = 'c',
  shipmentAlias = 's',
): string {
  return `COALESCE(
    CASE
      WHEN NULLIF(TRIM(${shipmentAlias}.shipment_id::text), '') ~ '^[0-9]+$'
        AND (
          NULLIF(TRIM(${contractAlias}.sto_number::text), '') IS NULL
          OR NULLIF(TRIM(${shipmentAlias}.shipment_id::text), '')
             <> NULLIF(TRIM(${contractAlias}.sto_number::text), '')
        )
      THEN NULLIF(TRIM(${shipmentAlias}.shipment_id::text), '')
      ELSE NULL
    END,
    NULLIF(TRIM(${contractAlias}.sto_number::text), ''),
    NULLIF(TRIM(${shipmentAlias}.operation_id::text), ''),
    NULLIF(TRIM(${shipmentAlias}.shipment_id::text), ''),
    ${shipmentAlias}.id::text
  )`;
}

/** SQL: all non-cancelled shipment UUIDs sharing the anchor shipment's operational STO key. */
export function sqlStoGroupMemberIdsForShipment(
  contractAlias = 'c',
  shipmentAlias = 's',
): string {
  const stoKey = shipmentStoKeyWithoutSpdExpr(contractAlias, shipmentAlias);
  return `
    WITH anchor AS (
      SELECT ${shipmentStoKeyWithoutSpdExpr('ac', 'a')} AS sto_key
      FROM shipments a
      LEFT JOIN contracts ac ON ac.id = a.contract_id
      WHERE a.id = $1::uuid
    )
    SELECT ${shipmentAlias}.id::text
    FROM shipments ${shipmentAlias}
    LEFT JOIN contracts ${contractAlias} ON ${contractAlias}.id = ${shipmentAlias}.contract_id
    CROSS JOIN anchor
    WHERE ${stoKey} = anchor.sto_key
      AND COALESCE(${shipmentAlias}.status, '') <> 'CANCELLED'
    ORDER BY ${contractAlias}.contract_id ASC NULLS LAST, ${shipmentAlias}.created_at ASC`;
}

/** Resolve all shipment UUIDs in the same list STO group as the given shipment. */
export async function resolveStoGroupShipmentIds(shipmentId: string): Promise<string[]> {
  const result = await query(sqlStoGroupMemberIdsForShipment(), [shipmentId]);
  const ids = result.rows
    .map((row) => String(row.id ?? '').trim())
    .filter((id) => id.length > 0);
  return ids.length > 0 ? ids : [shipmentId];
}

/** WHERE clause matching shipments / ports under an operational STO key (incl. OP-*). */
export function sqlShipmentOrStoKeyMatchWhere(
  paramRef = '$1',
  contractAlias = 'c',
  shipmentAlias = 's',
): string {
  const stoKey = shipmentStoKeyWithoutSpdExpr(contractAlias, shipmentAlias);
  return `(
    ${contractAlias}.sto_number = ${paramRef}
    OR ${shipmentAlias}.shipment_id = ${paramRef}
    OR NULLIF(TRIM(${shipmentAlias}.operation_id::text), '') = ${paramRef}
    OR ${stoKey} = NULLIF(TRIM(${paramRef}::text), '')
  )`;
}
