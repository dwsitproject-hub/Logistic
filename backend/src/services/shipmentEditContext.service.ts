import { query } from '../database/connection';
import { poLineHasSapStoSql } from '../utils/poLineSapStoSql';

export interface ShipmentEditContext {
  lookup_key: string;
  contract_numbers: string;
  po_numbers: string;
  has_sap_sto: boolean;
  can_add_po: boolean;
  add_po_blocked_reason: string | null;
}

function spdEffectiveStoSql(alias: string): string {
  return `NULLIF(TRIM(COALESCE(
    ${alias}.sto_number::text,
    ${alias}.data->'raw'->>'STO No.',
    ${alias}.data->'raw'->>'STO Number',
    ${alias}.data->'shipment'->>'sto_no',
    ${alias}.data->'contract'->>'sto_no'
  )), '')`;
}

function isKlipSyntheticLogisticsKey(value: string): boolean {
  return value.startsWith('OP-') || value.startsWith('MNL-') || value.startsWith('MSEA-');
}

async function resolveLinkedContractIds(
  shipmentUuid: string,
  lookupKey: string,
  contractNumbersCsv: string,
): Promise<string[]> {
  const contractList = contractNumbersCsv
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean);
  const result = await query(
    `
    SELECT DISTINCT c.id::text AS contract_row_id
    FROM contracts c
    WHERE ($1::text[] <> '{}' AND c.contract_id = ANY($1::text[]))
    UNION
    SELECT DISTINCT c.id::text
    FROM shipments s
    INNER JOIN contracts c ON c.id = s.contract_id
    WHERE s.id = $2::uuid
    UNION
    SELECT DISTINCT c.id::text
    FROM shipments s
    INNER JOIN contracts c ON c.id = s.contract_id
    WHERE COALESCE(s.status, '') <> 'CANCELLED'
      AND (
        TRIM(COALESCE(s.shipment_id::text, '')) = TRIM($3::text)
        OR TRIM(COALESCE(s.operation_id::text, '')) = TRIM($3::text)
      )
    `,
    [contractList, shipmentUuid, lookupKey],
  );
  return result.rows
    .map((r: { contract_row_id?: string }) => String(r.contract_row_id ?? '').trim())
    .filter(Boolean);
}

/** True when the shipment group is tied to an official SAP STO (not KLIP manual planning). */
export async function shipmentGroupHasSapSto(args: {
  shipmentUuid: string;
  lookupKey: string;
  contractNumbersCsv: string;
}): Promise<boolean> {
  const lookupKey = String(args.lookupKey ?? '').trim();
  if (!lookupKey) return false;

  if (/^\d+$/.test(lookupKey) && !isKlipSyntheticLogisticsKey(lookupKey)) {
    const sapRes = await query(
      `
      SELECT 1
      FROM sap_processed_data spd
      WHERE ${spdEffectiveStoSql('spd')} = TRIM($1::text)
      LIMIT 1
      `,
      [lookupKey],
    );
    if (sapRes.rows.length > 0) return true;
  }

  const linkedIds = await resolveLinkedContractIds(
    args.shipmentUuid,
    lookupKey,
    args.contractNumbersCsv,
  );
  if (linkedIds.length === 0) return false;

  const poSapRes = await query(
    `
    SELECT 1
    FROM contracts c
    WHERE c.id = ANY($1::uuid[])
      AND (${poLineHasSapStoSql('c')})
    LIMIT 1
    `,
    [linkedIds],
  );
  return poSapRes.rows.length > 0;
}

export function resolveAddPoGate(args: {
  lookupKey: string;
  hasSapSto: boolean;
  shipmentStatus: string | null | undefined;
}): Pick<ShipmentEditContext, 'has_sap_sto' | 'can_add_po' | 'add_po_blocked_reason'> {
  const status = String(args.shipmentStatus ?? '').trim().toUpperCase();
  if (status === 'CANCELLED') {
    return {
      has_sap_sto: args.hasSapSto,
      can_add_po: false,
      add_po_blocked_reason: 'Cannot add PO to a cancelled shipment',
    };
  }
  return {
    has_sap_sto: args.hasSapSto,
    can_add_po: true,
    add_po_blocked_reason: null,
  };
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
        s.status,
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
      a.status,
      STRING_AGG(DISTINCT lc.contract_id, ', ' ORDER BY lc.contract_id) AS contract_numbers,
      STRING_AGG(DISTINCT lc.po_number, ', ' ORDER BY lc.po_number)
        FILTER (WHERE lc.po_number IS NOT NULL AND TRIM(lc.po_number) != '') AS po_numbers
    FROM anchor a
    LEFT JOIN linked_contracts lc ON TRUE
    GROUP BY a.lookup_key, a.status
    `,
    [shipmentUuid],
  );

  const row = result.rows[0];
  if (!row?.lookup_key) return null;

  const contractNumbers = row.contract_numbers?.trim() || '';
  const hasSapSto = await shipmentGroupHasSapSto({
    shipmentUuid,
    lookupKey: row.lookup_key,
    contractNumbersCsv: contractNumbers,
  });
  const gate = resolveAddPoGate({
    lookupKey: row.lookup_key,
    hasSapSto,
    shipmentStatus: row.status,
  });

  return {
    lookup_key: row.lookup_key,
    contract_numbers: contractNumbers,
    po_numbers: row.po_numbers?.trim() || '',
    ...gate,
  };
}
