export type ShipmentTcFreightBudgetRow = {
  vessel_oa_budget_sap: number | null
  /** Weight for blending — Delivered Qty (Klip) when present. */
  quantity_kg: number
}

function parseBudget(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function parseWeightQty(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : 0
}

/**
 * Blended Freight Budget (IDR/KG) for a multi-PO shipment.
 * Qty-weighted by Delivered Qty (Klip); falls back to simple avg, single PO, then header.
 */
export function computeShipmentFreightBudgetIdrKg(
  detailRows: ShipmentTcFreightBudgetRow[],
  headerVesselOaBudget: number | null | undefined,
): number | null {
  if (detailRows.length === 0) {
    return parseBudget(headerVesselOaBudget)
  }

  const weighted: { budget: number; quantityKg: number }[] = []
  const budgets: number[] = []

  for (const row of detailRows) {
    const budget = parseBudget(row.vessel_oa_budget_sap)
    if (budget === null) continue
    budgets.push(budget)
    const quantityKg = parseWeightQty(row.quantity_kg)
    if (quantityKg > 0) {
      weighted.push({ budget, quantityKg })
    }
  }

  if (weighted.length > 0) {
    const totalQty = weighted.reduce((sum, item) => sum + item.quantityKg, 0)
    if (totalQty > 0) {
      const numerator = weighted.reduce((sum, item) => sum + item.budget * item.quantityKg, 0)
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
