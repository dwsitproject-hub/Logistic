import { describe, expect, it } from 'vitest'
import {
  mergeShipmentQtyOverridesOnContractRows,
  resolveShipmentListDeliveredKg,
  resolveShipmentListReceiveKg,
  sapContractDetailQtyToKg,
  sapDeliveredOrReceiveMtToKg,
} from './shipmentQuantityUnits'

describe('sapDeliveredOrReceiveMtToKg', () => {
  it('converts SAP MT to kg unconditionally', () => {
    expect(sapDeliveredOrReceiveMtToKg(1000)).toBe(1_000_000)
    expect(sapDeliveredOrReceiveMtToKg(null)).toBeNull()
  })
})

describe('sapContractDetailQtyToKg', () => {
  it('treats large SAP values as kg (comma-parsed 497115 on 3M contract)', () => {
    expect(sapContractDetailQtyToKg(497_115, 3_000_000)).toBe(497_115)
    expect(sapContractDetailQtyToKg(1_503_841, 1_500_000)).toBe(1_503_841)
  })

  it('scales MT-scale values when much smaller than contract qty', () => {
    expect(sapContractDetailQtyToKg(500, 3_000_000)).toBe(500_000)
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

  it('uses SAP when manual is 0 but SAP has delivery', () => {
    expect(
      resolveShipmentListDeliveredKg({
        quantity_delivered: 0,
        quantity_delivered_sap: 497_115,
      }),
    ).toBe(497_115)
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

  it('uses SAP receive when manual row is 0', () => {
    expect(
      resolveShipmentListReceiveKg({
        actual_vessel_qty_receive: 0,
        quantity_receive: 497_115,
      }),
    ).toBe(497_115)
  })
})

describe('mergeShipmentQtyOverridesOnContractRows', () => {
  it('uses shipment kg on a single contract row when SAP total differs', () => {
    const rows = [{ quantity_delivered: 1_000_000, quantity_receive: null }]
    const merged = mergeShipmentQtyOverridesOnContractRows(rows, 1_005_000, null)
    expect(merged[0].quantity_delivered).toBe(1_005_000)
  })

  it('keeps SAP delivered when shipment manual qty is 0', () => {
    const rows = [{ quantity_delivered: 497_115, quantity_receive: 497_115 }]
    const merged = mergeShipmentQtyOverridesOnContractRows(rows, 0, 0)
    expect(merged[0].quantity_delivered).toBe(497_115)
    expect(merged[0].quantity_receive).toBe(497_115)
  })

  it('keeps per-PO SAP delivered when shipment shell has partial total (multi-PO STO)', () => {
    const rows = [
      { quantity_delivered: 625_079, quantity_receive: null },
      { quantity_delivered: 208_360, quantity_receive: null },
      { quantity_delivered: 625_078, quantity_receive: null },
      { quantity_delivered: 208_360, quantity_receive: null },
    ]
    const merged = mergeShipmentQtyOverridesOnContractRows(rows, 208_360, null)
    expect(merged[0].quantity_delivered).toBe(625_079)
    expect(merged[1].quantity_delivered).toBe(208_360)
  })

  it('adds manual shipment delta to largest PO row when header exceeds SAP sum', () => {
    const rows = [
      { quantity_delivered: 600_000, quantity_receive: null },
      { quantity_delivered: 400_000, quantity_receive: null },
    ]
    const merged = mergeShipmentQtyOverridesOnContractRows(rows, 1_010_000, null)
    expect(merged[0].quantity_delivered).toBe(610_000)
    expect(merged[1].quantity_delivered).toBe(400_000)
  })
})
