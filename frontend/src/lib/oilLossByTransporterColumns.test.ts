import { describe, expect, it } from 'vitest'
import { aggregateOilLossByTransporter } from '@/lib/oilLossByTransporterColumns'
import { aggregateOilLossBySupplier } from '@/lib/oilLossBySupplierColumns'
import type { OilLossSourceRow } from '@/lib/oilLossAllContractColumns'

/**
 * Regression: the SEA voyage merge (STO/Operation ID grouping) added for Section 1 /
 * All Contract must NOT change By Transporter / By Supplier totals — those views already
 * dedupe delivery/receive per distinct contract within their own bucket, independent of
 * any Operation ID grouping.
 */
describe('By Transporter — unaffected by SEA voyage Operation ID grouping', () => {
  const voyageRowsSameTransporter: OilLossSourceRow[] = [
    {
      id: '1',
      transport_mode: 'SEA',
      operation_id: 'OP-1',
      contract_number: 'CN-1',
      transporter: 'Vessel X',
      quantity_sent: 100_000,
      quantity_received: 90_000,
    },
    {
      id: '2',
      transport_mode: 'SEA',
      operation_id: 'OP-1',
      contract_number: 'CN-2',
      transporter: 'Vessel X',
      quantity_sent: 200_000,
      quantity_received: 190_000,
    },
  ]

  it('sums quantities per distinct contract regardless of shared voyage Operation ID', () => {
    const result = aggregateOilLossByTransporter(voyageRowsSameTransporter)
    expect(result).toHaveLength(1)
    expect(result[0].quantity_delivery).toBe(300_000)
    expect(result[0].quantity_received).toBe(280_000)
    expect(result[0].gain_loss_amount).toBe(-20_000)
  })
})

describe('By Supplier — unaffected by SEA voyage Operation ID grouping', () => {
  const voyageRowsSameSupplier: OilLossSourceRow[] = [
    {
      id: '1',
      transport_mode: 'SEA',
      operation_id: 'OP-1',
      contract_number: 'CN-1',
      supplier: 'Supp A',
      quantity_sent: 100_000,
      quantity_received: 90_000,
    },
    {
      id: '2',
      transport_mode: 'SEA',
      operation_id: 'OP-1',
      contract_number: 'CN-2',
      supplier: 'Supp A',
      quantity_sent: 200_000,
      quantity_received: 190_000,
    },
  ]

  it('sums quantities per distinct contract regardless of shared voyage Operation ID', () => {
    const result = aggregateOilLossBySupplier(voyageRowsSameSupplier)
    expect(result).toHaveLength(1)
    expect(result[0].quantity_delivery).toBe(300_000)
    expect(result[0].quantity_received).toBe(280_000)
    expect(result[0].gain_loss_amount).toBe(-20_000)
  })
})
