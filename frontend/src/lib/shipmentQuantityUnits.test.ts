import { describe, expect, it } from 'vitest'
import {
  mergeShipmentQtyOverridesOnContractRows,
  resolveShipmentListDeliveredKg,
  resolveShipmentListReceiveKg,
  sapDeliveredOrReceiveMtToKg,
} from './shipmentQuantityUnits'

describe('sapDeliveredOrReceiveMtToKg', () => {
  it('converts SAP MT to kg for the edit grid', () => {
    expect(sapDeliveredOrReceiveMtToKg(1000)).toBe(1_000_000)
    expect(sapDeliveredOrReceiveMtToKg(null)).toBeNull()
  })
})

describe('resolveShipmentListDeliveredKg', () => {
  it('prefers manual shipment qty when it differs from SAP', () => {
    expect(
      resolveShipmentListDeliveredKg({
        quantity_delivered: 1_005_000,
        quantity_delivered_sap: 1_000_000,
      }),
    ).toBe(1_005_000)
  })

  it('uses SAP when manual matches or is absent', () => {
    expect(
      resolveShipmentListDeliveredKg({
        quantity_delivered: 1_000_000,
        quantity_delivered_sap: 1_000_000,
      }),
    ).toBe(1_000_000)
    expect(resolveShipmentListDeliveredKg({ quantity_delivered_sap: 500_000 })).toBe(500_000)
    expect(resolveShipmentListDeliveredKg({ quantity_delivered_sap: 0 })).toBe(0)
    expect(resolveShipmentListDeliveredKg({})).toBeNull()
  })
})

describe('resolveShipmentListReceiveKg', () => {
  it('prefers actual_vessel_qty_receive when it differs from SAP', () => {
    expect(
      resolveShipmentListReceiveKg({
        actual_vessel_qty_receive: 990_000,
        quantity_receive: 1_000_000,
      }),
    ).toBe(990_000)
  })
})

describe('mergeShipmentQtyOverridesOnContractRows', () => {
  it('uses shipment kg on a single contract row when SAP total differs', () => {
    const rows = [{ quantity_delivered: 1_000_000, quantity_receive: null }]
    const merged = mergeShipmentQtyOverridesOnContractRows(rows, 1_005_000, null)
    expect(merged[0].quantity_delivered).toBe(1_005_000)
  })
})
