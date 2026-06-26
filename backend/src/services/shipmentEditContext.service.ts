import { query } from '../database/connection';

export interface ShipmentEditContext {
  lookup_key: string;
  contract_numbers: string;
  po_numbers: string;
}

/**
 * Lightweight sibling resolution for Edit Shipment modal only.
 * Uses shipments + contracts (no SAP scan). Called once per modal open.
 */
export async function resolveShipmentEditContext(
  shipmentUuid: string,
): Promise<ShipmentEditContext | null> {
  const result = await query(
    `
    WITH anchor AS (
      SELECT
        s.id,
        s.operation_id,
        s.shipment_id,
        NULLIF(TRIM(COALESCE(c.sto_number::text, '')), '') AS contract_sto,
        CASE
          WHEN NULLIF(TRIM(s.shipment_id::text), '') ~ '^[0-9]+$'
          THEN NULLIF(TRIM(s.shipment_id::text), '')
          ELSE NULL
        END AS numeric_shipment_id
      FROM shipments s
      LEFT JOIN contracts c ON c.id = s.contract_id
      WHERE s.id = $1::uuid
      LIMIT 1
    ),
    group_ctx AS (
      SELECT
        id,
        COALESCE(
          contract_sto,
          numeric_shipment_id,
          NULLIF(TRIM(operation_id::text), ''),
          id::text
        ) AS lookup_key,
        NULLIF(TRIM(operation_id::text), '') AS operation_id,
        contract_sto,
        numeric_shipment_id
      FROM anchor
    )
    SELECT
      gc.lookup_key,
      STRING_AGG(DISTINCT c.contract_id, ', ' ORDER BY c.contract_id) AS contract_numbers,
      STRING_AGG(DISTINCT c.po_number, ', ' ORDER BY c.po_number)
        FILTER (WHERE c.po_number IS NOT NULL AND TRIM(c.po_number) != '') AS po_numbers
    FROM group_ctx gc
    INNER JOIN shipments s ON (
      s.id = gc.id
      OR (
        gc.operation_id IS NOT NULL
        AND TRIM(COALESCE(s.operation_id::text, '')) = gc.operation_id
      )
      OR (
        gc.numeric_shipment_id IS NOT NULL
        AND TRIM(COALESCE(s.shipment_id::text, '')) = gc.numeric_shipment_id
      )
      OR (
        gc.contract_sto IS NOT NULL
        AND TRIM(COALESCE(s.shipment_id::text, '')) = gc.contract_sto
      )
    )
    INNER JOIN contracts c ON c.id = s.contract_id
    WHERE COALESCE(s.status, '') <> 'CANCELLED'
      AND (
        s.id = gc.id
        OR gc.operation_id IS NOT NULL
        OR gc.numeric_shipment_id IS NOT NULL
        OR TRIM(COALESCE(s.shipment_id::text, '')) = gc.contract_sto
        OR TRIM(COALESCE(c.sto_number::text, '')) = gc.contract_sto
      )
    GROUP BY gc.lookup_key
    `,
    [shipmentUuid],
  );

  const row = result.rows[0];
  if (!row?.lookup_key) return null;

  return {
    lookup_key: row.lookup_key,
    contract_numbers: row.contract_numbers?.trim() || '',
    po_numbers: row.po_numbers?.trim() || '',
  };
}
