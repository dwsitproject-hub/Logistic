/**
 * STO-sibling membership for Shipments OS / CP Open.
 *
 * Lives in its own module so `stoLinkedContractSql` can keep importing only
 * cheap helpers (Shipping Performance imports that file).
 *
 * Do not nest `sqlIsContractSapClosedExpr` here: that expression scans
 * `sap_processed_data` JSON per contract. Correlating it from late-performance
 * (every Open PO × every sibling shipment) hangs Contract Performance.
 */

const SQL_SHIPMENT_NOT_CANCELLED = `UPPER(TRIM(COALESCE(s_link.status, ''))) NOT IN ('CANCELLED', 'CANCELED')`;

/**
 * Set of contract UUIDs that share a numeric STO with another contract's
 * non-cancelled sea shipment. Compute once per query (late-performance).
 *
 * `contractScopeCteName`, when given, restricts the *self* side of every branch to contracts in
 * that CTE (expected shape: a `contract_id` (text) column, matching contracts.contract_id -
 * e.g. late-performance's own `contract_scope`). The *sibling* side (`cs_sib`/`c_link`/the shipment
 * lookup) is deliberately left unscoped in every branch: a sibling contract can fall outside the
 * caller's date filter and still be the reason the in-scope contract counts as "has an active
 * sibling" - narrowing that side would drop real siblings, not just skip irrelevant work. Output-
 * preserving when used correctly: the scoped result is exactly the unscoped result intersected
 * with the scope set (verified 2026-09-03 by comparing both against real data before this was
 * wired into late-performance.service.ts).
 */
export function sqlActiveSeaStoSiblingContractIdsCte(
  cteName = 'active_sea_sto_sibling_ids',
  contractScopeCteName?: string,
): string {
  // contract_stos.contract_id is contracts.id (uuid) - go through contracts to match a
  // contract_id (text)-keyed scope CTE. contracts.id is the PK (always indexed), so this is a
  // cheap semi-join, not a scan.
  const scopeForContractStosSelf = contractScopeCteName
    ? `AND cs_self.contract_id IN (SELECT id FROM contracts WHERE contract_id IN (SELECT contract_id FROM ${contractScopeCteName}))`
    : '';
  // contracts.contract_id is already text - no translation needed for this branch's self side.
  const scopeForContractsSelf = contractScopeCteName
    ? `AND c_self.contract_id IN (SELECT contract_id FROM ${contractScopeCteName})`
    : '';
  // Access-path only, output-preserving (see the two rewrites below). Measured 2026-09-04: this CTE
  // cost ~41s of Contract Performance's 182s cold load, entirely because neither of its
  // contract_stos branches could be hash- or merge-joined, leaving Postgres to evaluate a join
  // filter over the full cross product (branch 1: 12,283 x 5,953 ~ 73M; branch 3: 12,283 x 2,602
  // ~ 32M). Branch 2 already ran ~400x cheaper (cost 3,058 vs 1.28M) purely because
  // idx_contracts_sto_number_trim let it merge-join - that is the shape the other two now match.
  // These tables are small (contract_stos 12,345 rows / 4 MB, shipments 2,628 / 4 MB), so a hash
  // join needs no extra index once the predicate is hashable.
  return `${cteName} AS (
    -- sto_number is NOT NULL on contract_stos, so IS NOT DISTINCT FROM is exactly '=' here - but
    -- only '=' is a hashable/mergeable join operator, so this is what turns the 73M-row join
    -- filter into a hash join. contract_id (also NOT NULL) stays IS DISTINCT FROM: it is a filter,
    -- not a join key, so rewriting it would buy nothing.
    SELECT DISTINCT cs_self.contract_id
    FROM contract_stos cs_self
    INNER JOIN contract_stos cs_sib
      ON cs_sib.sto_number = cs_self.sto_number
     AND cs_sib.contract_id IS DISTINCT FROM cs_self.contract_id
    INNER JOIN shipments s_link ON s_link.contract_id = cs_sib.contract_id
    WHERE NULLIF(TRIM(cs_self.sto_number::text), '') IS NOT NULL
      AND ${SQL_SHIPMENT_NOT_CANCELLED}
      ${scopeForContractStosSelf}
    UNION
    SELECT DISTINCT c_self.id
    FROM contracts c_self
    INNER JOIN contracts c_link
      ON c_link.id IS DISTINCT FROM c_self.id
     AND NULLIF(TRIM(c_link.sto_number::text), '') IS NOT NULL
     AND TRIM(c_link.sto_number::text) = TRIM(c_self.sto_number::text)
    INNER JOIN shipments s_link ON s_link.contract_id = c_link.id
    WHERE NULLIF(TRIM(c_self.sto_number::text), '') IS NOT NULL
      AND ${SQL_SHIPMENT_NOT_CANCELLED}
      ${scopeForContractsSelf}
    UNION
    -- Was one branch joining on (TRIM(shipment_id) = TRIM(sto_number) OR TRIM(operation_id) =
    -- TRIM(sto_number)). An OR of two different key pairs cannot be a join key, so Postgres fell
    -- back to a 32M-row join filter. Split into one branch per key: each is a single equality the
    -- planner can hash, and the surrounding UNION already dedupes rows that match both sides, so
    -- the result set is unchanged. shipments.contract_id is NULLABLE, so IS DISTINCT FROM must
    -- stay - '<>' would drop shipment rows whose contract_id is NULL, which the original kept.
    SELECT DISTINCT cs_self.contract_id
    FROM contract_stos cs_self
    INNER JOIN shipments s_link
      ON TRIM(s_link.shipment_id::text) = TRIM(cs_self.sto_number::text)
     AND s_link.contract_id IS DISTINCT FROM cs_self.contract_id
     AND ${SQL_SHIPMENT_NOT_CANCELLED}
    WHERE NULLIF(TRIM(cs_self.sto_number::text), '') IS NOT NULL
      ${scopeForContractStosSelf}
    UNION
    SELECT DISTINCT cs_self.contract_id
    FROM contract_stos cs_self
    INNER JOIN shipments s_link
      ON TRIM(s_link.operation_id::text) = TRIM(cs_self.sto_number::text)
     AND s_link.contract_id IS DISTINCT FROM cs_self.contract_id
     AND ${SQL_SHIPMENT_NOT_CANCELLED}
    WHERE NULLIF(TRIM(cs_self.sto_number::text), '') IS NOT NULL
      ${scopeForContractStosSelf}
  )`;
}

/**
 * True when another contract already has a non-cancelled sea shipment
 * on a numeric STO this contract shares (`contract_stos`, `contracts.sto_number`,
 * or the sibling shipment's numeric `shipment_id` / `operation_id`).
 *
 * Starts from this contract's STO rows (not from every shipment) so backlog /
 * CP Open can use it as a correlated EXISTS without a nested SAP JSON scan.
 *
 * Shipments OS unnests grouped-STO `contract_numbers` at contract grain. View table
 * stays per STO; Unplanned/Preplanned backlog and CP Open must not treat these
 * sibling POs as a second OS line.
 */
export function sqlContractSharesNumericStoWithActiveSeaShipmentExpr(
  contractUuidExpr: string,
): string {
  return `(
    EXISTS (
      SELECT 1
      FROM contract_stos cs_self
      INNER JOIN contract_stos cs_sib
        ON cs_sib.sto_number IS NOT DISTINCT FROM cs_self.sto_number
       AND cs_sib.contract_id IS DISTINCT FROM cs_self.contract_id
      INNER JOIN shipments s_link ON s_link.contract_id = cs_sib.contract_id
      WHERE cs_self.contract_id = ${contractUuidExpr}
        AND NULLIF(TRIM(cs_self.sto_number::text), '') IS NOT NULL
        AND ${SQL_SHIPMENT_NOT_CANCELLED}
    )
    OR EXISTS (
      SELECT 1
      FROM contracts c_self
      INNER JOIN contracts c_link
        ON c_link.id IS DISTINCT FROM c_self.id
       AND NULLIF(TRIM(c_link.sto_number::text), '') IS NOT NULL
       AND TRIM(c_link.sto_number::text) = TRIM(c_self.sto_number::text)
      INNER JOIN shipments s_link ON s_link.contract_id = c_link.id
      WHERE c_self.id = ${contractUuidExpr}
        AND NULLIF(TRIM(c_self.sto_number::text), '') IS NOT NULL
        AND ${SQL_SHIPMENT_NOT_CANCELLED}
    )
    OR EXISTS (
      SELECT 1
      FROM contract_stos cs_self
      INNER JOIN shipments s_link
        ON s_link.contract_id IS DISTINCT FROM cs_self.contract_id
       AND ${SQL_SHIPMENT_NOT_CANCELLED}
       AND (
         TRIM(s_link.shipment_id::text) = TRIM(cs_self.sto_number::text)
         OR TRIM(s_link.operation_id::text) = TRIM(cs_self.sto_number::text)
       )
      WHERE cs_self.contract_id = ${contractUuidExpr}
        AND NULLIF(TRIM(cs_self.sto_number::text), '') IS NOT NULL
    )
  )`;
}
