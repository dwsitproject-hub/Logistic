export type ShipmentTcFreightBudgetRow = {
  vessel_oa_budget_sap: number | null
  shipment_plan_qty: number
}

function parseBudget(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function parsePlanQty(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : 0
}

/**
 * Blended Freight Budget (IDR/KG) for a multi-PO shipment.
 * Qty-weighted by shipment_plan_qty; falls back to simple avg, single PO, then header.
 */
export function computeShipmentFreightBudgetIdrKg(
  detailRows: ShipmentTcFreightBudgetRow[],
  headerVesselOaBudget: number | null | undefined,
): number | null {
  if (detailRows.length === 0) {
    return parseBudget(headerVesselOaBudget)
  }

  const weighted: { budget: number; planQty: number }[] = []
  const budgets: number[] = []

  for (const row of detailRows) {
    const budget = parseBudget(row.vessel_oa_budget_sap)
    if (budget === null) continue
    budgets.push(budget)
    const planQty = parsePlanQty(row.shipment_plan_qty)
    if (planQty > 0) {
      weighted.push({ budget, planQty })
    }
  }

  if (weighted.length > 0) {
    const totalQty = weighted.reduce((sum, item) => sum + item.planQty, 0)
    if (totalQty > 0) {
      const numerator = weighted.reduce((sum, item) => sum + item.budget * item.planQty, 0)
      return numerator / totalQty
    }
  }

  if (budgets.length === 1) {
    return budgets[0]
  }

  if (budgets.length > 1) {
    const distinct = [...new Set(budgets)]
    return distinct.reduce((sum, b) => sum + b, 0) / distinct.length
  }

  return parseBudget(headerVesselOaBudget)
}
