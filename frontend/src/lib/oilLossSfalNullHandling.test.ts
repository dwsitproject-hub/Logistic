import { describe, expect, it } from 'vitest'
import {
  aggregateOilLossByContract,
  sumNullableOilLossQtyKg,
  type OilLossSourceRow,
} from '@/lib/oilLossAllContractColumns'
import { computeROilLossSummary } from '@/lib/oilLossSummary'

describe('sumNullableOilLossQtyKg', () => {
  it('keeps null when both sides missing', () => {
    expect(sumNullableOilLossQtyKg(null, null)).toBeNull()
    expect(sumNullableOilLossQtyKg(undefined, undefined)).toBeNull()
  })

  it('preserves genuine zero', () => {
    expect(sumNullableOilLossQtyKg(0, null)).toBe(0)
    expect(sumNullableOilLossQtyKg(null, 0)).toBe(0)
    expect(sumNullableOilLossQtyKg(0, 1000)).toBe(1000)
  })
})

describe('aggregateOilLossByContract SFAL/SFBD null', () => {
  it('keeps SFAL/SFBD null when all source rows are null', () => {
    const rows: OilLossSourceRow[] = [
      {
        id: '1',
        contract_number: 'CN-1',
        quantity_sent: 100_000,
        quantity_received: 90_000,
        quantity_sfal: null,
        quantity_sfbd: null,
      },
      {
        id: '2',
        contract_number: 'CN-1',
        quantity_sent: 100_000,
        quantity_received: 90_000,
        quantity_sfal: null,
        quantity_sfbd: null,
      },
    ]
    const [agg] = aggregateOilLossByContract(rows)
    expect(agg.quantity_sfal).toBeNull()
    expect(agg.quantity_sfbd).toBeNull()
  })
})

describe('computeROilLossSummary R1 with null SFAL', () => {
  it('skips R1 when SFAL is null', () => {
    const summary = computeROilLossSummary(
      [
        {
          contract_number: 'CN-1',
          quantity_sent: 100_000,
          quantity_received: 90_000,
          quantity_sfal: null,
        },
      ],
      'r1',
    )
    expect(summary.sampleCount).toBe(0)
    expect(summary.totalMt).toBeNull()
  })

  it('computes R1 when SFAL is genuine zero', () => {
    const summary = computeROilLossSummary(
      [
        {
          contract_number: 'CN-1',
          quantity_sent: 100_000,
          quantity_received: 90_000,
          quantity_sfal: 0,
        },
      ],
      'r1',
    )
    expect(summary.sampleCount).toBe(1)
    expect(summary.totalMt).toBe(-100)
  })
})
