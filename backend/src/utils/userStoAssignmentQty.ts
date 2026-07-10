/**
 * KLIP contract / SAP quantities use kg. Manual UI inputs (Add PO, Add Shipment) use MT.
 * Legacy rows in user_sto_contract_assignments may still be stored in MT.
 */

export const STO_QTY_KG_PER_MT = 1000;

export function stoQtyAssignedMtToKg(mt: number): number {
  if (!Number.isFinite(mt) || mt <= 0) return 0;
  return mt * STO_QTY_KG_PER_MT;
}

/**
 * Normalize assignment values to kg for API responses and outstanding math.
 * Values much smaller than contract qty (kg) are treated as legacy MT rows.
 */
export function sqlUserStoQtyAssignedToKgSql(
  assignmentValueExpr: string,
  contractQtyExpr: string,
): string {
  return `CASE
    WHEN COALESCE(${contractQtyExpr}, 0) > 0
      AND COALESCE(${assignmentValueExpr}, 0) > 0
      AND COALESCE(${assignmentValueExpr}, 0) <= COALESCE(${contractQtyExpr}, 0) / 100
    THEN COALESCE(${assignmentValueExpr}, 0) * ${STO_QTY_KG_PER_MT}
    ELSE COALESCE(${assignmentValueExpr}, 0)
  END`;
}
