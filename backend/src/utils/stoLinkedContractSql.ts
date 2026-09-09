/**
 * STO-linked contract aggregation — contracts visible on a grouped shipment STO row.
 * Uses contract_stos (multi-STO per contract) with legacy contracts.sto_number fallback.
 */

import { SQL_SPD_CONTRACT_REFF_PO } from './b2bOriginEndingSql';

/** Operational STO key on a grouped shipment list row (matches shipmentListStoKeyExpr). */
export function buildGroupedStoTrimExpr(stoKeySql: string): string {
  return `NULLIF(TRIM((${stoKeySql})::text), '')`;
}

/**
 * Contracts linked to a grouped list row key (SAP STO or KLIP operation_id / shipment_id).
 *
 * The candidate contracts are gathered *from* the four sources by index and then looked up by
 * primary key, rather than scanning `contracts` and testing a four-way `OR` of `EXISTS` per row.
 * The old shape could not use any index for the OR, so EXPLAIN (ANALYZE, BUFFERS) on the
 * Shipments summary query showed `Seq Scan on contracts cc_2 ... Rows Removed by Filter: 18749,
 * loops=463, Buffers: shared hit=630471` - and this subquery is embedded five times.
 *
 * Set-equivalent by construction: `A OR B OR C OR D` over `contracts` selects exactly the
 * contracts whose id lies in (ids satisfying A) union ... union (ids satisfying D). Each branch
 * extracts the same ids the matching EXISTS tested for, and `sh.contract_id` / `cs.contract_id`
 * being NULL drops the row in both shapes.
 *
 * The one rewritten predicate: the legacy sto_number branch read
 * `TRIM(COALESCE(cc.sto_number::text, '')) = KEY`, which no index can serve. It is written here as
 * `NULLIF(TRIM(c_sto.sto_number::text), '') = KEY` to match `idx_contracts_sto_number_trim`. Those
 * agree for every KEY this function is given: callers always pass `NULLIF(TRIM(...), '')`, so KEY
 * is NULL or non-empty. If KEY is NULL both sides compare to NULL and select nothing; if KEY is
 * non-empty, both require `TRIM(sto_number) = KEY` with a non-empty, non-null `sto_number`.
 *
 * Indexes each branch relies on: idx_contract_stos_sto_number_trim (migration 160),
 * idx_contracts_sto_number_trim, idx_spd_effective_sto_bare, idx_shipments_trim_operation_id and
 * idx_shipments_trim_shipment_id (migration 155). The OR over operation_id / shipment_id is split
 * into two UNION branches so each one can use its own index.
 *
 * B2B children are then mapped to their origin contract (Reff PO -> origin.po_number) instead of
 * dropped, exactly as before. `OFFSET 0` is an optimizer fence kept from the original.
 */
export function contractsOnStoSubquery(groupedStoExpr: string): string {
  return `
    SELECT DISTINCT COALESCE(b2b_o.contract_id, cc.contract_id) AS contract_id
    FROM (
      SELECT cc.id, cc.contract_id, cc.contract_type
      FROM contracts cc
      WHERE cc.id IN (
          SELECT cs_k.contract_id
          FROM contract_stos cs_k
          WHERE TRIM(cs_k.sto_number::text) = ${groupedStoExpr}
        UNION
          SELECT c_sto.id
          FROM contracts c_sto
          WHERE NULLIF(TRIM(c_sto.sto_number::text), '') = ${groupedStoExpr}
        UNION
          SELECT c_spd.id
          FROM contracts c_spd
          WHERE c_spd.contract_id IN (
            SELECT spd_k.contract_number
            FROM sap_processed_data spd_k
            WHERE TRIM(COALESCE(
              spd_k.sto_number::text,
              spd_k.data->'raw'->>'STO No.',
              spd_k.data->'raw'->>'STO Number',
              spd_k.data->'shipment'->>'sto_no',
              spd_k.data->'contract'->>'sto_no'
            )) = ${groupedStoExpr}
          )
        UNION
          SELECT sh_op.contract_id
          FROM shipments sh_op
          WHERE COALESCE(sh_op.status, '') <> 'CANCELLED'
            AND NULLIF(TRIM(sh_op.operation_id::text), '') = ${groupedStoExpr}
        UNION
          SELECT sh_id.contract_id
          FROM shipments sh_id
          WHERE COALESCE(sh_id.status, '') <> 'CANCELLED'
            AND NULLIF(TRIM(sh_id.shipment_id::text), '') = ${groupedStoExpr}
      )
        AND cc.contract_id IS NOT NULL
        AND TRIM(cc.contract_id) != ''
      OFFSET 0
    ) cc
    LEFT JOIN LATERAL (
      SELECT
        ${SQL_SPD_CONTRACT_REFF_PO('spd.data')} AS reff,
        UPPER(TRIM(COALESCE(
          spd.data->'contract'->>'contract_type',
          spd.data->>'B2B Flag',
          cc.contract_type::text,
          ''
        ))) AS flag
      FROM sap_processed_data spd
      WHERE TRIM(spd.contract_number) = TRIM(cc.contract_id)
      ORDER BY spd.created_at DESC NULLS LAST
      LIMIT 1
    ) ch_spd ON true
    LEFT JOIN contracts b2b_o
      ON ch_spd.flag = 'B2B'
      AND ch_spd.reff IS NOT NULL
      AND TRIM(b2b_o.po_number::text) = ch_spd.reff
    WHERE ch_spd.flag IS DISTINCT FROM 'B2B'
       OR ch_spd.reff IS NULL
       OR b2b_o.contract_id IS NOT NULL`;
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
