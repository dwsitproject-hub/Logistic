import { describe, expect, it } from 'vitest'
import { buildOilLossDrilldownTree, sumOilLossKgFromRows } from '@/lib/oilLossDrilldown'
import type { OilLossSourceRow } from '@/lib/oilLossAllContractColumns'

describe('oilLossDrilldown contract-level qty', () => {
  const rows: OilLossSourceRow[] = [
    {
      id: '1',
      contract_number: 'CN-1',
      product: 'CPO',
      group_plant: 'Plant A',
      incoterm: 'FOB',
      transporter: 'Vessel X',
      supplier: 'Supp A',
      quantity_sent: 100_000,
      quantity_delivery: 100_000,
      quantity_received: 90_000,
    },
    // Same contract, second SPD/STO row — must not double-count R4 in drilldown
    {
      id: '2',
      contract_number: 'CN-1',
      product: 'CPO',
      group_plant: 'Plant A',
      incoterm: 'FOB',
      transporter: 'Vessel X',
      supplier: 'Supp A',
      quantity_sent: 100_000,
      quantity_delivery: 100_000,
      quantity_received: 90_000,
    },
    {
      id: '3',
      contract_number: 'CN-2',
      product: 'CPO',
      group_plant: 'Plant A',
      incoterm: 'FOB',
      transporter: 'Vessel Y',
      supplier: 'Supp B',
      quantity_sent: 200_000,
      quantity_delivery: 200_000,
      quantity_received: 190_000,
    },
  ]

  it('counts R4 oil loss once per contract in the tree', () => {
    const tree = buildOilLossDrilldownTree(rows)
    expect(tree).toHaveLength(1)
    expect(tree[0].contractCount).toBe(2)
    // CN-1: -10_000 + CN-2: -10_000 = -20_000 (not -30_000)
    expect(tree[0].totalOilLossKg).toBe(-20_000)
  })

  it('sums oil loss once per contract', () => {
    expect(sumOilLossKgFromRows(rows)).toBe(-20_000)
  })
})
