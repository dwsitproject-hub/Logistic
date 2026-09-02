import { describe, expect, it } from 'vitest'
import { aggregateOilLossByContract, type OilLossSourceRow } from '@/lib/oilLossAllContractColumns'

describe('aggregateOilLossByContract — SEA multi-PO voyage merge', () => {
  it('merges POs sharing one STO/voyage Operation ID into a single summed row', () => {
    const rows: OilLossSourceRow[] = [
      {
        id: '1',
        transport_mode: 'SEA',
        operation_id: 'OP-1',
        contract_number: 'CN-1',
        po_number: 'PO-1',
        sto_number: 'STO-1',
        contract_ext_no: 'EXT-1',
        quantity_sent: 100_000,
        quantity_received: 90_000,
      },
      {
        id: '2',
        transport_mode: 'SEA',
        operation_id: 'OP-1',
        contract_number: 'CN-2',
        po_number: 'PO-2',
        sto_number: 'STO-1',
        contract_ext_no: 'EXT-2',
        quantity_sent: 200_000,
        quantity_received: 190_000,
      },
    ]

    const result = aggregateOilLossByContract(rows)
    expect(result).toHaveLength(1)
    expect(result[0].quantity_delivery).toBe(300_000)
    expect(result[0].quantity_received).toBe(280_000)
    expect(result[0].gain_loss_amount).toBe(-20_000)
    expect(result[0].po_number).toBe('PO-1, PO-2')
    expect(result[0].contract_number).toBe('CN-1, CN-2')
  })
})

describe('aggregateOilLossByContract — LAND single-PO multi-STO row (unchanged)', () => {
  it('keeps one row per LAND PO with STO lines comma-merged, quantities not summed across STO lines', () => {
    const rows: OilLossSourceRow[] = [
      {
        id: '1',
        transport_mode: 'LAND',
        operation_id: 'TRK-1',
        contract_number: 'CN-1',
        po_number: 'PO-1',
        sto_number: 'STO-A',
        quantity_sent: 50_000,
        quantity_received: 48_000,
      },
      {
        id: '2',
        transport_mode: 'LAND',
        operation_id: 'TRK-1',
        contract_number: 'CN-1',
        po_number: 'PO-1',
        sto_number: 'STO-B',
        quantity_sent: 50_000,
        quantity_received: 48_000,
      },
    ]

    const result = aggregateOilLossByContract(rows)
    expect(result).toHaveLength(1)
    expect(result[0].sto_number).toBe('STO-A, STO-B')
    // Contract-level delivery/receive taken once (not summed across duplicate SPD/STO rows).
    expect(result[0].quantity_delivery).toBe(50_000)
    expect(result[0].quantity_received).toBe(48_000)
  })

  it('keeps two distinct LAND POs as two separate rows', () => {
    const rows: OilLossSourceRow[] = [
      {
        id: '1',
        transport_mode: 'LAND',
        operation_id: 'TRK-1',
        contract_number: 'CN-1',
        po_number: 'PO-1',
        quantity_sent: 50_000,
        quantity_received: 48_000,
      },
      {
        id: '2',
        transport_mode: 'LAND',
        operation_id: 'TRK-2',
        contract_number: 'CN-2',
        po_number: 'PO-2',
        quantity_sent: 60_000,
        quantity_received: 58_000,
      },
    ]

    const result = aggregateOilLossByContract(rows)
    expect(result).toHaveLength(2)
  })
})
