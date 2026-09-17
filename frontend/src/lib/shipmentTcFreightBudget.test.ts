import { describe, expect, it } from 'vitest'
import { computeShipmentFreightBudgetIdrKg } from './shipmentTcFreightBudget'

describe('computeShipmentFreightBudgetIdrKg', () => {
  it('returns single PO budget', () => {
    expect(
      computeShipmentFreightBudgetIdrKg(
        [{ vessel_oa_budget_sap: 1200, quantity_kg: 500_000 }],
        null,
      ),
    ).toBe(1200)
  })

  it('returns qty-weighted average for multi-PO', () => {
    expect(
      computeShipmentFreightBudgetIdrKg(
        [
          { vessel_oa_budget_sap: 1000, quantity_kg: 300_000 },
          { vessel_oa_budget_sap: 2000, quantity_kg: 700_000 },
        ],
        null,
      ),
    ).toBe(1700)
  })

  it('falls back to simple average when all weight qty are zero', () => {
    expect(
      computeShipmentFreightBudgetIdrKg(
        [
          { vessel_oa_budget_sap: 1000, quantity_kg: 0 },
          { vessel_oa_budget_sap: 3000, quantity_kg: 0 },
        ],
        null,
      ),
    ).toBe(2000)
  })

  it('falls back to header budget when rows have no SAP budget', () => {
    expect(
      computeShipmentFreightBudgetIdrKg(
        [{ vessel_oa_budget_sap: null, quantity_kg: 100_000 }],
        888,
      ),
    ).toBe(888)
  })

  it('returns null when no budget available', () => {
    expect(computeShipmentFreightBudgetIdrKg([], null)).toBeNull()
    expect(
      computeShipmentFreightBudgetIdrKg(
        [{ vessel_oa_budget_sap: null, quantity_kg: 0 }],
        null,
      ),
    ).toBeNull()
  })
})
