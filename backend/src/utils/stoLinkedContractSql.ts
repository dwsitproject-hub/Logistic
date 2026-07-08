/**
 * STO-linked contract aggregation — contracts visible on a grouped shipment STO row.
 * Uses contract_stos (multi-STO per contract) with legacy contracts.sto_number fallback.
 */

/** Operational STO key on a grouped shipment list row (matches shipmentListStoKeyExpr). */
export function buildGroupedStoTrimExpr(stoKeySql: string): string {
  return `NULLIF(TRIM((${stoKeySql})::text), '')`;
}

/** Contracts linked to a grouped list row key (SAP STO or KLIP operation_id / shipment_id). */
export function contractsOnStoSubquery(groupedStoExpr: string): string {
  return `
    SELECT DISTINCT cc.contract_id
    FROM contracts cc
    WHERE cc.contract_id IS NOT NULL
      AND TRIM(cc.contract_id) != ''
      AND (
        EXISTS (
          SELECT 1 FROM contract_stos cs
          WHERE cs.contract_id = cc.id
            AND TRIM(cs.sto_number::text) = ${groupedStoExpr}
        )
        OR TRIM(COALESCE(cc.sto_number::text, '')) = ${groupedStoExpr}
        OR EXISTS (
          SELECT 1 FROM sap_processed_data spd
          WHERE spd.contract_number = cc.contract_id
            AND TRIM(COALESCE(
              spd.sto_number::text,
              spd.data->'raw'->>'STO No.',
              spd.data->'raw'->>'STO Number',
              spd.data->'shipment'->>'sto_no',
              spd.data->'contract'->>'sto_no'
            )) = ${groupedStoExpr}
        )
        OR EXISTS (
          SELECT 1 FROM shipments sh
          WHERE sh.contract_id = cc.id
            AND COALESCE(sh.status, '') <> 'CANCELLED'
            AND (
              NULLIF(TRIM(sh.operation_id::text), '') = ${groupedStoExpr}
              OR NULLIF(TRIM(sh.shipment_id::text), '') = ${groupedStoExpr}
            )
        )
      )`;
}

export function buildStoLinkedContractNumbersSql(
  groupedStoExpr: string,
  contractAlias = 'c',
  elseExpr?: string,
): string {
  const elseBranch =
    elseExpr ??
    `STRING_AGG(DISTINCT ${contractAlias}.contract_id, ', ' ORDER BY ${contractAlias}.contract_id)
            FILTER (WHERE ${contractAlias}.contract_id IS NOT NULL)`;
  return `CASE
          WHEN ${groupedStoExpr} IS NOT NULL THEN
            COALESCE(
              (SELECT STRING_AGG(DISTINCT cid.contract_id, ', ' ORDER BY cid.contract_id)
               FROM (${contractsOnStoSubquery(groupedStoExpr)}) cid),
              ${elseBranch}
            )
          ELSE ${elseBranch}
        END`;
}

export function buildStoLinkedPoNumbersSql(
  groupedStoExpr: string,
  contractAlias = 'c',
  elseExpr?: string,
): string {
  const elseBranch =
    elseExpr ??
    `STRING_AGG(DISTINCT ${contractAlias}.po_number, ', ' ORDER BY ${contractAlias}.po_number)
            FILTER (WHERE ${contractAlias}.po_number IS NOT NULL AND TRIM(${contractAlias}.po_number) != '')`;
  return `CASE
          WHEN ${groupedStoExpr} IS NOT NULL THEN
            COALESCE(
              (SELECT STRING_AGG(DISTINCT cc.po_number, ', ' ORDER BY cc.po_number)
               FROM contracts cc
               WHERE cc.contract_id IN (${contractsOnStoSubquery(groupedStoExpr)})
                 AND cc.po_number IS NOT NULL AND TRIM(cc.po_number) != ''),
              ${elseBranch}
            )
          ELSE ${elseBranch}
        END`;
}

export function buildStoLinkedContractCountSql(
  groupedStoExpr: string,
  contractAlias = 'c',
  elseExpr?: string,
): string {
  const elseBranch =
    elseExpr ??
    `COUNT(DISTINCT ${contractAlias}.contract_id) FILTER (WHERE ${contractAlias}.contract_id IS NOT NULL)`;
  return `CASE
          WHEN ${groupedStoExpr} IS NOT NULL THEN
            COALESCE(
              (SELECT COUNT(DISTINCT cid.contract_id)::int
               FROM (${contractsOnStoSubquery(groupedStoExpr)}) cid),
              ${elseBranch}
            )
          ELSE ${elseBranch}
        END`;
}

export function buildStoLinkedSuppliersSql(
  groupedStoExpr: string,
  contractAlias = 'c',
  elseExpr?: string,
): string {
  const elseBranch =
    elseExpr ??
    `STRING_AGG(DISTINCT ${contractAlias}.supplier, ', ' ORDER BY ${contractAlias}.supplier)
            FILTER (WHERE ${contractAlias}.supplier IS NOT NULL AND TRIM(${contractAlias}.supplier) != '')`;
  return `CASE
          WHEN ${groupedStoExpr} IS NOT NULL THEN
            COALESCE(
              (SELECT STRING_AGG(DISTINCT cc.supplier, ', ' ORDER BY cc.supplier)
               FROM contracts cc
               WHERE cc.contract_id IN (${contractsOnStoSubquery(groupedStoExpr)})
                 AND cc.supplier IS NOT NULL AND TRIM(cc.supplier) != ''),
              ${elseBranch}
            )
          ELSE ${elseBranch}
        END`;
}
