import { query } from '../database/connection';
import { poLineHasSapStoSql } from '../utils/poLineSapStoSql';
import { contractSeaVesselStoNumberPickExpr } from '../utils/shipmentStoTypeSql';
import { contractEffectiveIncotermExpr } from '../utils/truckingIncotermScope';

export interface ShipmentEditContext {
  lookup_key: string;
  contract_numbers: string;
  po_numbers: string;
  has_sap_sto: boolean;
  can_add_po: boolean;
  add_po_blocked_reason: string | null;
}

/**
 * Prefer the list STO (Type V sea leg) when it belongs to this shipment.
 * FOB V+T POs store Type T on shipment_id; SAP delivery/receive live on Type V.
 */
export function pickShipmentEditLookupKey(args: {
  resolvedKey: string;
  preferredSto?: string | null;
  seaVesselSto?: string | null;
  shipmentIdNumeric?: string | null;
  operationId?: string | null;
  contractStoNumbers?: string[] | null;
}): string {
  const resolved = String(args.resolvedKey ?? '').trim();
  const preferred = String(args.preferredSto ?? '').trim();
  if (!preferred) return resolved;
  const allowed = new Set(
    [
      resolved,
      args.seaVesselSto,
      args.shipmentIdNumeric,
      args.operationId,
      ...(args.contractStoNumbers ?? []),
    ]
      .map((k) => String(k ?? '').trim())
      .filter(Boolean),
  );
  return allowed.has(preferred) ? preferred : resolved;
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
 * lookup_key must match createShipment assignmentKey (STO / operation_id), not an
 * unrelated contract_stos row on the same contract (that made plan qty look like 0).
 * FOB + vessel: prefer Type V STO (same as shipmentListSeaStoKeyExpr) so SAP qty
 * is scoped to the sea leg, not the Type T trucking sibling on shipment_id.
 */
export async function resolveShipmentEditContext(
  shipmentUuid: string,
  preferredSto?: string | null,
): Promise<ShipmentEditContext | null> {
  const seaVesselStoSql = contractSeaVesselStoNumberPickExpr('c');
  const result = await query(
    `
    WITH anchor AS (
      SELECT
        s.id,
        s.status,
        NULLIF(TRIM(s.operation_id::text), '') AS operation_id,
        CASE
          WHEN NULLIF(TRIM(s.shipment_id::text), '') ~ '^[0-9]+$'
          THEN NULLIF(TRIM(s.shipment_id::text), '')
          ELSE NULL
        END AS shipment_id_numeric,
        ${seaVesselStoSql} AS sea_vessel_sto,
        (
          SELECT ARRAY_AGG(DISTINCT TRIM(cs.sto_number::text))
          FROM contract_stos cs
          WHERE cs.contract_id = s.contract_id
            AND NULLIF(TRIM(cs.sto_number::text), '') IS NOT NULL
        ) AS contract_sto_numbers,
        COALESCE(
          CASE
            WHEN (${contractEffectiveIncotermExpr('c')}) = 'FOB'
              AND NULLIF(TRIM(s.vessel_name), '') IS NOT NULL
              AND (${seaVesselStoSql}) IS NOT NULL
            THEN (${seaVesselStoSql})
            ELSE NULL
          END,
          CASE
            WHEN NULLIF(TRIM(s.shipment_id::text), '') ~ '^[0-9]+$'
            THEN NULLIF(TRIM(s.shipment_id::text), '')
            ELSE NULL
          END,
          NULLIF(TRIM(s.operation_id::text), ''),
          (
            SELECT TRIM(cs.sto_number::text)
            FROM contract_stos cs
            WHERE cs.contract_id = s.contract_id
            ORDER BY cs.updated_at DESC NULLS LAST
            LIMIT 1
          ),
          s.id::text
        ) AS lookup_key
      FROM shipments s
      LEFT JOIN contracts c ON c.id = s.contract_id
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
      a.sea_vessel_sto,
      a.shipment_id_numeric,
      a.operation_id,
      a.contract_sto_numbers,
      STRING_AGG(DISTINCT lc.contract_id, ', ' ORDER BY lc.contract_id) AS contract_numbers,
      STRING_AGG(DISTINCT lc.po_number, ', ' ORDER BY lc.po_number)
        FILTER (WHERE lc.po_number IS NOT NULL AND TRIM(lc.po_number) != '') AS po_numbers
    FROM anchor a
    LEFT JOIN linked_contracts lc ON TRUE
    GROUP BY
      a.lookup_key,
      a.status,
      a.sea_vessel_sto,
      a.shipment_id_numeric,
      a.operation_id,
      a.contract_sto_numbers
    `,
    [shipmentUuid],
  );

  const row = result.rows[0];
  if (!row?.lookup_key) return null;

  const lookupKey = pickShipmentEditLookupKey({
    resolvedKey: String(row.lookup_key),
    preferredSto,
    seaVesselSto: row.sea_vessel_sto != null ? String(row.sea_vessel_sto) : null,
    shipmentIdNumeric: row.shipment_id_numeric != null ? String(row.shipment_id_numeric) : null,
    operationId: row.operation_id != null ? String(row.operation_id) : null,
    contractStoNumbers: Array.isArray(row.contract_sto_numbers)
      ? row.contract_sto_numbers.map((n: unknown) => String(n ?? '').trim()).filter(Boolean)
      : [],
  });

  const contractNumbers = row.contract_numbers?.trim() || '';
  const hasSapSto = await shipmentGroupHasSapSto({
    shipmentUuid,
    lookupKey,
    contractNumbersCsv: contractNumbers,
  });
  const gate = resolveAddPoGate({
    lookupKey,
    hasSapSto,
    shipmentStatus: row.status,
  });

  return {
    lookup_key: lookupKey,
    contract_numbers: contractNumbers,
    po_numbers: row.po_numbers?.trim() || '',
    ...gate,
  };
}
