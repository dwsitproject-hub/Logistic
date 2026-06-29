import { query } from '../database/connection';

export interface ShipmentEditContext {
  lookup_key: string;
  contract_numbers: string;
  po_numbers: string;
}

/**
 * Lightweight sibling resolution for Edit Shipment modal only.
 * Resolves operational STO key and linked contracts via contract_stos + shipment_id.
 */
export async function resolveShipmentEditContext(
  shipmentUuid: string,
): Promise<ShipmentEditContext | null> {
  const result = await query(
    `
    WITH anchor AS (
      SELECT
        s.id,
        COALESCE(
          CASE
            WHEN NULLIF(TRIM(s.shipment_id::text), '') ~ '^[0-9]+$'
            THEN NULLIF(TRIM(s.shipment_id::text), '')
            ELSE NULL
          END,
          (
            SELECT TRIM(cs.sto_number::text)
            FROM contract_stos cs
            WHERE cs.contract_id = s.contract_id
            ORDER BY cs.updated_at DESC NULLS LAST
            LIMIT 1
          ),
          NULLIF(TRIM(s.operation_id::text), ''),
          s.id::text
        ) AS lookup_key
      FROM shipments s
      WHERE s.id = $1::uuid
      LIMIT 1
    ),
    linked_contracts AS (
      SELECT DISTINCT c.contract_id, c.po_number
      FROM anchor a
      INNER JOIN contract_stos cs ON TRIM(cs.sto_number::text) = a.lookup_key
      INNER JOIN contracts c ON c.id = cs.contract_id
      UNION
      SELECT DISTINCT c.contract_id, c.po_number
      FROM anchor a
      INNER JOIN shipments s ON TRIM(COALESCE(s.shipment_id::text, '')) = a.lookup_key
      INNER JOIN contracts c ON c.id = s.contract_id
      WHERE COALESCE(s.status, '') <> 'CANCELLED'
      UNION
      SELECT DISTINCT c.contract_id, c.po_number
      FROM anchor a
      INNER JOIN shipments s ON TRIM(COALESCE(s.operation_id::text, '')) = a.lookup_key
      INNER JOIN contracts c ON c.id = s.contract_id
      WHERE COALESCE(s.status, '') <> 'CANCELLED'
      UNION
      SELECT DISTINCT c.contract_id, c.po_number
      FROM anchor a
      INNER JOIN shipments s ON s.id = a.id
      INNER JOIN contracts c ON c.id = s.contract_id
    )
    SELECT
      a.lookup_key,
      STRING_AGG(DISTINCT lc.contract_id, ', ' ORDER BY lc.contract_id) AS contract_numbers,
      STRING_AGG(DISTINCT lc.po_number, ', ' ORDER BY lc.po_number)
        FILTER (WHERE lc.po_number IS NOT NULL AND TRIM(lc.po_number) != '') AS po_numbers
    FROM anchor a
    LEFT JOIN linked_contracts lc ON TRUE
    GROUP BY a.lookup_key
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
