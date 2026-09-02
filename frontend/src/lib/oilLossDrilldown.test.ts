import { describe, expect, it } from 'vitest'
import { buildOilLossDrilldownTree, countUniqueOilLossContracts, sumOilLossKgFromRows } from '@/lib/oilLossDrilldown'
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

describe('oilLossDrilldown SEA voyage merge (multi-PO Operation ID)', () => {
  const voyageRows: OilLossSourceRow[] = [
    {
      id: '1',
      transport_mode: 'SEA',
      operation_id: 'OP-1',
      contract_number: 'CN-1',
      product: 'CPO',
      group_plant: 'Plant A',
      incoterm: 'CIF',
      transporter: 'Vessel X',
      supplier: 'Supp A',
      quantity_sent: 100_000,
      quantity_delivery: 100_000,
      quantity_received: 90_000,
    },
    {
      id: '2',
      transport_mode: 'SEA',
      operation_id: 'OP-1',
      contract_number: 'CN-2',
      product: 'CPO',
      group_plant: 'Plant A',
      incoterm: 'CIF',
      transporter: 'Vessel X',
      supplier: 'Supp A',
      quantity_sent: 200_000,
      quantity_delivery: 200_000,
      quantity_received: 190_000,
    },
  ]

  it('merges a multi-PO SEA voyage into one group: contractCount 1, summed loss', () => {
    const tree = buildOilLossDrilldownTree(voyageRows)
    expect(tree).toHaveLength(1)
    expect(tree[0].contractCount).toBe(1)
    // Merged voyage: (90k-100k) + (190k-200k) = -20_000, summed once (not per-PO).
    expect(tree[0].totalOilLossKg).toBe(-20_000)
  })

  it('sums the merged voyage once via sumOilLossKgFromRows', () => {
    expect(sumOilLossKgFromRows(voyageRows)).toBe(-20_000)
  })

  it('counts the voyage once via countUniqueOilLossContracts', () => {
    expect(countUniqueOilLossContracts(voyageRows)).toBe(1)
  })

  it('LAND rows spanning distinct contracts stay ungrouped (Operation ID is 1:1 with PO)', () => {
    const landRows: OilLossSourceRow[] = [
      {
        id: '1',
        transport_mode: 'LAND',
        operation_id: 'TRK-1',
        contract_number: 'CN-1',
        product: 'PK',
        group_plant: 'Plant B',
        incoterm: 'FOR',
        transporter: 'Truck Co',
        supplier: 'Supp C',
        quantity_sent: 50_000,
        quantity_delivery: 50_000,
        quantity_received: 48_000,
      },
      {
        id: '2',
        transport_mode: 'LAND',
        operation_id: 'TRK-2',
        contract_number: 'CN-3',
        product: 'PK',
        group_plant: 'Plant B',
        incoterm: 'FOR',
        transporter: 'Truck Co',
        supplier: 'Supp C',
        quantity_sent: 60_000,
        quantity_delivery: 60_000,
        quantity_received: 58_000,
      },
    ]
    expect(countUniqueOilLossContracts(landRows)).toBe(2)
    expect(sumOilLossKgFromRows(landRows)).toBe(-4_000)
  })
})
