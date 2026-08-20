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
 */
export function sqlActiveSeaStoSiblingContractIdsCte(
  cteName = 'active_sea_sto_sibling_ids',
): string {
  return `${cteName} AS (
    SELECT DISTINCT cs_self.contract_id
    FROM contract_stos cs_self
    INNER JOIN contract_stos cs_sib
      ON cs_sib.sto_number IS NOT DISTINCT FROM cs_self.sto_number
     AND cs_sib.contract_id IS DISTINCT FROM cs_self.contract_id
    INNER JOIN shipments s_link ON s_link.contract_id = cs_sib.contract_id
    WHERE NULLIF(TRIM(cs_self.sto_number::text), '') IS NOT NULL
      AND ${SQL_SHIPMENT_NOT_CANCELLED}
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
    UNION
    SELECT DISTINCT cs_self.contract_id
    FROM contract_stos cs_self
    INNER JOIN shipments s_link
      ON s_link.contract_id IS DISTINCT FROM cs_self.contract_id
     AND ${SQL_SHIPMENT_NOT_CANCELLED}
     AND (
       TRIM(s_link.shipment_id::text) = TRIM(cs_self.sto_number::text)
       OR TRIM(s_link.operation_id::text) = TRIM(cs_self.sto_number::text)
     )
    WHERE NULLIF(TRIM(cs_self.sto_number::text), '') IS NOT NULL
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
