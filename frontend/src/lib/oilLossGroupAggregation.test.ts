import { describe, expect, it } from 'vitest'
import type { OilLossSourceRow } from '@/lib/oilLossAllContractColumns'
import {
  aggregateOilLossQuantitiesByOuterGroup,
  aggregateOilLossRowsByGroup,
  isSeaOilLossTransportMode,
  oilLossContractGroupKey,
  oilLossOuterGroupKey,
} from '@/lib/oilLossGroupAggregation'

describe('isSeaOilLossTransportMode', () => {
  it('is case-insensitive and trims whitespace', () => {
    expect(isSeaOilLossTransportMode('SEA')).toBe(true)
    expect(isSeaOilLossTransportMode(' sea ')).toBe(true)
    expect(isSeaOilLossTransportMode('LAND')).toBe(false)
    expect(isSeaOilLossTransportMode(null)).toBe(false)
    expect(isSeaOilLossTransportMode(undefined)).toBe(false)
  })
})

describe('oilLossOuterGroupKey', () => {
  it('groups SEA rows by Operation ID regardless of contract', () => {
    const a = oilLossOuterGroupKey({
      id: '1',
      contract_number: 'CN-1',
      contract_ext_no: null,
      transport_mode: 'SEA',
      operation_id: 'OP-1',
    })
    const b = oilLossOuterGroupKey({
      id: '2',
      contract_number: 'CN-2',
      contract_ext_no: null,
      transport_mode: 'SEA',
      operation_id: 'OP-1',
    })
    expect(a).toBe(b)
    expect(a).toBe('op:OP-1')
  })

  it('falls back to the contract key for SEA rows with no Operation ID', () => {
    const key = oilLossOuterGroupKey({
      id: '1',
      contract_number: 'CN-1',
      contract_ext_no: null,
      transport_mode: 'SEA',
      operation_id: null,
    })
    expect(key).toBe(oilLossContractGroupKey({ id: '1', contract_number: 'CN-1', contract_ext_no: null }))
  })

  it('keeps LAND rows at the contract key even when Operation ID is set', () => {
    const key = oilLossOuterGroupKey({
      id: '1',
      contract_number: 'CN-1',
      contract_ext_no: null,
      transport_mode: 'LAND',
      operation_id: 'TRK-1',
    })
    expect(key).toBe(oilLossContractGroupKey({ id: '1', contract_number: 'CN-1', contract_ext_no: null }))
  })
})

describe('aggregateOilLossQuantitiesByOuterGroup', () => {
  it('sums quantities across distinct contracts sharing one SEA voyage', () => {
    const rows: OilLossSourceRow[] = [
      { id: '1', transport_mode: 'SEA', operation_id: 'OP-1', contract_number: 'CN-1', quantity_sent: 100_000, quantity_received: 90_000 },
      { id: '2', transport_mode: 'SEA', operation_id: 'OP-1', contract_number: 'CN-2', quantity_sent: 200_000, quantity_received: 190_000 },
    ]
    const groups = aggregateOilLossQuantitiesByOuterGroup(rows)
    expect(groups.size).toBe(1)
    const [agg] = [...groups.values()]
    expect(agg.quantity_sent).toBe(300_000)
    expect(agg.quantity_received).toBe(280_000)
  })

  it('does not double-sum duplicate SPD rows of the same contract within a voyage', () => {
    const rows: OilLossSourceRow[] = [
      { id: '1', transport_mode: 'SEA', operation_id: 'OP-1', contract_number: 'CN-1', quantity_sent: 100_000, quantity_received: 90_000 },
      // Duplicate SPD/STO row for the same contract — must not re-sum delivery/receive.
      { id: '1b', transport_mode: 'SEA', operation_id: 'OP-1', contract_number: 'CN-1', quantity_sent: 100_000, quantity_received: 90_000 },
      { id: '2', transport_mode: 'SEA', operation_id: 'OP-1', contract_number: 'CN-2', quantity_sent: 200_000, quantity_received: 190_000 },
    ]
    const groups = aggregateOilLossQuantitiesByOuterGroup(rows)
    expect(groups.size).toBe(1)
    const [agg] = [...groups.values()]
    expect(agg.quantity_sent).toBe(300_000)
    expect(agg.quantity_received).toBe(280_000)
  })
})

describe('aggregateOilLossRowsByGroup', () => {
  it('merges a multi-PO SEA voyage into one row: summed qty, comma-merged PO/STO/Contract Ext No', () => {
    const rows: OilLossSourceRow[] = [
      {
        id: '1',
        transport_mode: 'SEA',
        operation_id: 'OP-1',
        contract_number: 'CN-1',
        contract_ext_no: 'EXT-1',
        po_number: 'PO-1',
        sto_number: 'STO-1',
        product: 'CPO',
        quantity_sent: 100_000,
        quantity_received: 90_000,
        quantity_sfal: 5_000,
        quantity_sfbd: 3_000,
      },
      {
        id: '2',
        transport_mode: 'SEA',
        operation_id: 'OP-1',
        contract_number: 'CN-2',
        contract_ext_no: 'EXT-2',
        po_number: 'PO-2',
        sto_number: 'STO-1',
        product: 'CPO',
        quantity_sent: 200_000,
        quantity_received: 190_000,
        quantity_sfal: 8_000,
        quantity_sfbd: 6_000,
      },
    ]

    const [merged] = aggregateOilLossRowsByGroup(rows)
    expect(aggregateOilLossRowsByGroup(rows)).toHaveLength(1)
    expect(merged.contract_count).toBe(2)
    expect(merged.quantity_delivery).toBe(300_000)
    expect(merged.quantity_received).toBe(280_000)
    expect(merged.quantity_sfal).toBe(13_000)
    expect(merged.quantity_sfbd).toBe(9_000)
    expect(merged.gain_loss_amount).toBe(-20_000)
    expect(merged.po_number).toBe('PO-1, PO-2')
    expect(merged.sto_number).toBe('STO-1')
    expect(merged.contract_number).toBe('CN-1, CN-2')
    expect(merged.contract_ext_no).toBe('EXT-1, EXT-2')
  })

  it('keeps LAND rows one-per-PO with STOs comma-merged (unchanged behavior)', () => {
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
      // Second SAP row for the same LAND PO with a different STO line — merges within the contract.
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
      {
        id: '3',
        transport_mode: 'LAND',
        operation_id: 'TRK-2',
        contract_number: 'CN-2',
        po_number: 'PO-2',
        sto_number: 'STO-C',
        quantity_sent: 60_000,
        quantity_received: 58_000,
      },
    ]

    const merged = aggregateOilLossRowsByGroup(rows)
    expect(merged).toHaveLength(2)
    const po1 = merged.find((m) => m.po_number === 'PO-1')!
    expect(po1.contract_count).toBe(1)
    expect(po1.sto_number).toBe('STO-A, STO-B')
    // Delivery/receive taken once per contract (not summed across duplicate SPD/STO rows).
    expect(po1.quantity_delivery).toBe(50_000)
    expect(po1.quantity_received).toBe(48_000)

    const po2 = merged.find((m) => m.po_number === 'PO-2')!
    expect(po2.contract_count).toBe(1)
    expect(po2.quantity_delivery).toBe(60_000)
  })
})
