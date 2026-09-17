/**
 * WB (trucking_daily_actuals) sum scope for Trucking list / Contracts overlay.
 *
 * When an OP has both legacy PO-level rows (sto_number='') and STO-tagged rows,
 * summing everything double-counts (e.g. PO 1001030830: empty 1781 + STO 1949 + junk 151 ≈ 3882).
 *
 * Rules:
 * 1) If any WB row matches contract_stos / SAP STO catalog for the op's contract →
 *    sum only those catalog-matched rows (drops empty + junk like "123").
 * 2) Else if any non-empty sto_number exists → sum only non-empty (drop legacy empty).
 * 3) Else → sum all rows (pure legacy PO-level upload).
 */

/** True when da.sto_number is a known STO on the trucking op's contract (contract_stos or SAP). */
export function sqlWbStoMatchesContractCatalog(
  daAlias = 'da',
  operationIdExpr = 't.id',
): string {
  const sto = `NULLIF(TRIM(COALESCE(${daAlias}.sto_number, '')), '')`;
  return `(
    ${sto} IS NOT NULL
    AND (
      EXISTS (
        SELECT 1
        FROM trucking_operations _t_wb
        JOIN contract_stos _cs_wb ON _cs_wb.contract_id = _t_wb.contract_id
        WHERE _t_wb.id = ${operationIdExpr}
          AND TRIM(_cs_wb.sto_number::text) = ${sto}
      )
      OR EXISTS (
        SELECT 1
        FROM trucking_operations _t_wb
        JOIN contracts _c_wb ON _c_wb.id = _t_wb.contract_id
        JOIN sap_processed_data _spd_wb ON _spd_wb.contract_number = _c_wb.contract_id
        WHERE _t_wb.id = ${operationIdExpr}
          AND NULLIF(TRIM(COALESCE(_spd_wb.sto_number::text, '')), '') = ${sto}
      )
    )
  )`;
}

/** WHERE predicate: include this daily_actuals row in OP-level WB totals. */
export function sqlWbActualRowIncludedPredicate(
  daAlias = 'da',
  operationIdExpr = 't.id',
): string {
  const tagged = `NULLIF(TRIM(COALESCE(${daAlias}.sto_number, '')), '') IS NOT NULL`;
  const hasCatalogHit = `EXISTS (
    SELECT 1 FROM trucking_daily_actuals _wb_hit
    WHERE _wb_hit.trucking_operation_id = ${operationIdExpr}
      AND ${sqlWbStoMatchesContractCatalog('_wb_hit', operationIdExpr)}
  )`;
  const hasAnyTagged = `EXISTS (
    SELECT 1 FROM trucking_daily_actuals _wb_tag
    WHERE _wb_tag.trucking_operation_id = ${operationIdExpr}
      AND NULLIF(TRIM(COALESCE(_wb_tag.sto_number, '')), '') IS NOT NULL
  )`;
  return `(
    (
      ${hasCatalogHit}
      AND ${sqlWbStoMatchesContractCatalog(daAlias, operationIdExpr)}
    )
    OR (
      NOT (${hasCatalogHit})
      AND ${hasAnyTagged}
      AND ${tagged}
    )
    OR (
      NOT (${hasCatalogHit})
      AND NOT (${hasAnyTagged})
    )
  )`;
}

/**
 * Sum of WB Qty Delivery for an operation (Netto PKS), scoped to avoid
 * legacy-empty + STO double-count / junk STO keys.
 */
export function sqlWbActualDeliverySumKg(operationIdExpr = 't.id'): string {
  return `(
    SELECT COALESCE(SUM(COALESCE(da.quantity_delivery_kg, da.quantity_kg)), 0)::numeric
    FROM trucking_daily_actuals da
    WHERE da.trucking_operation_id = ${operationIdExpr}
      AND ${sqlWbActualRowIncludedPredicate('da', operationIdExpr)}
  )`;
}

/**
 * Sum of WB Qty Receive for an operation (Netto EUP), same scope as delivery.
 */
export function sqlWbActualReceiveSumKg(operationIdExpr = 't.id'): string {
  return `(
    SELECT COALESCE(SUM(COALESCE(da.quantity_receive_kg, 0)), 0)::numeric
    FROM trucking_daily_actuals da
    WHERE da.trucking_operation_id = ${operationIdExpr}
      AND ${sqlWbActualRowIncludedPredicate('da', operationIdExpr)}
  )`;
}
