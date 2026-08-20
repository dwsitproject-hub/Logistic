import { describe, expect, it } from 'vitest'
import {
  mergeShipmentQtyOverridesOnContractRows,
  preferHydratedQty,
  resolveShipmentListDeliveredKg,
  resolveShipmentListReceiveKg,
  sapContractDetailQtyToKg,
  sapDeliveredOrReceiveMtToKg,
  seedKlipQtyFromShipmentHeader,
  shipmentListDeliveredKgForViewTable,
  shipmentListReceiveKgForViewTable,
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

describe('preferHydratedQty', () => {
  it('does not let a shell qty_move stub 0 hide hydrated SAP', () => {
    expect(preferHydratedQty(3_002_849, 0)).toBe(3_002_849)
    expect(preferHydratedQty(0, 3_002_849)).toBe(3_002_849)
  })
})

describe('resolveShipmentListDeliveredKg', () => {
  it('Open + KLIP qty present uses quantity_delivered_klip even if below SAP', () => {
    expect(
      resolveShipmentListDeliveredKg({
        quantity_delivered_klip: 500_000,
        quantity_delivered_sap: 1_000_000,
        is_contract_sap_closed: false,
      }),
    ).toBe(500_000)
  })

  it('Open without KLIP falls back to SAP', () => {
    expect(
      resolveShipmentListDeliveredKg({
        quantity_delivered: 208_360,
        quantity_delivered_sap: 4_000_000,
        is_contract_sap_closed: false,
      }),
    ).toBe(4_000_000)
  })

  it('Open with null KLIP (planning-only, no delivery edit) uses SAP', () => {
    expect(
      resolveShipmentListDeliveredKg({
        quantity_delivered_klip: null,
        quantity_delivered_sap: 2_500_000,
        is_contract_sap_closed: false,
      }),
    ).toBe(2_500_000)
  })

  it('Close always prefers SAP over KLIP', () => {
    expect(
      resolveShipmentListDeliveredKg({
        quantity_delivered_klip: 5_000_000,
        quantity_delivered_sap: 4_002_486,
        is_contract_sap_closed: true,
      }),
    ).toBe(4_002_486)
  })

  it('Close with missing SAP falls back to legacy then KLIP so the table is not blank', () => {
    expect(
      resolveShipmentListDeliveredKg({
        quantity_delivered_klip: 5_000_000,
        quantity_delivered: 4_002_486,
        is_contract_sap_closed: true,
      }),
    ).toBe(4_002_486)
    expect(
      resolveShipmentListDeliveredKg({
        quantity_delivered_klip: 5_000_000,
        is_contract_sap_closed: true,
      }),
    ).toBe(5_000_000)
  })

  it('Close ignores stub SAP 0 and uses shipment header (STO 1006018954)', () => {
    expect(
      resolveShipmentListDeliveredKg({
        quantity_delivered_sap: 0,
        quantity_delivered: 3_002_849,
        is_contract_sap_closed: true,
      }),
    ).toBe(3_002_849)
  })

  it('uses SAP when manual is 0 but SAP has delivery', () => {
    expect(
      resolveShipmentListDeliveredKg({
        quantity_delivered: 0,
        quantity_delivered_sap: 497_115,
      }),
    ).toBe(497_115)
  })

  it('falls back to legacy quantity_delivered when KLIP and SAP are absent', () => {
    expect(
      resolveShipmentListDeliveredKg({
        quantity_delivered: 1_000_000,
      }),
    ).toBe(1_000_000)
    expect(resolveShipmentListDeliveredKg({ quantity_delivered_sap: 500_000 })).toBe(500_000)
    expect(resolveShipmentListDeliveredKg({ quantity_delivered_sap: 0 })).toBe(0)
    expect(resolveShipmentListDeliveredKg({})).toBeNull()
  })

  it('View Table shows 0 when KLIP and SAP delivery qty are both null', () => {
    expect(shipmentListDeliveredKgForViewTable({})).toBe(0)
    expect(
      shipmentListDeliveredKgForViewTable({
        quantity_delivered_klip: null,
        quantity_delivered_sap: null,
        quantity_delivered: null,
      }),
    ).toBe(0)
  })
})

describe('resolveShipmentListReceiveKg', () => {
  it('Open + KLIP vessel receive uses actual_vessel_qty_receive even if below SAP', () => {
    expect(
      resolveShipmentListReceiveKg({
        actual_vessel_qty_receive: 500_000,
        quantity_receive: 1_000_000,
        is_contract_sap_closed: false,
      }),
    ).toBe(500_000)
  })

  it('Open without KLIP falls back to SAP', () => {
    expect(
      resolveShipmentListReceiveKg({
        actual_vessel_qty_receive: 0,
        quantity_receive: 4_000_000,
        is_contract_sap_closed: false,
      }),
    ).toBe(4_000_000)
  })

  it('Close always prefers SAP over KLIP vessel receive', () => {
    expect(
      resolveShipmentListReceiveKg({
        actual_vessel_qty_receive: 5_000_000,
        quantity_receive: 4_002_486,
        is_contract_sap_closed: true,
      }),
    ).toBe(4_002_486)
  })

  it('Close with missing SAP receive falls back to vessel qty so the table is not blank', () => {
    expect(
      resolveShipmentListReceiveKg({
        actual_vessel_qty_receive: 241_610,
        is_contract_sap_closed: true,
      }),
    ).toBe(241_610)
  })

  it('Close ignores stub SAP receive 0 and uses vessel header', () => {
    expect(
      resolveShipmentListReceiveKg({
        quantity_receive: 0,
        actual_vessel_qty_receive: 3_002_849,
        is_contract_sap_closed: true,
      }),
    ).toBe(3_002_849)
  })

  it('GR Close STO 1016010610 pattern: hydrated SAP receive beats duplicate MNL KLIP row', () => {
    expect(
      resolveShipmentListReceiveKg({
        actual_vessel_qty_receive: 500_000,
        quantity_receive: 241_610,
        is_contract_sap_closed: true,
      }),
    ).toBe(241_610)
  })

  it('uses SAP receive when manual row is 0 and Open', () => {
    expect(
      resolveShipmentListReceiveKg({
        actual_vessel_qty_receive: 0,
        quantity_receive: 497_115,
        is_contract_sap_closed: false,
      }),
    ).toBe(497_115)
  })

  it('View Table shows 0 when KLIP and SAP receive qty are both null', () => {
    expect(shipmentListReceiveKgForViewTable({})).toBe(0)
    expect(
      shipmentListReceiveKgForViewTable({
        actual_vessel_qty_receive: null,
        quantity_receive: null,
        is_contract_sap_closed: false,
      }),
    ).toBe(0)
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

describe('seedKlipQtyFromShipmentHeader', () => {
  it('returns null KLIP when no prior KLIP input', () => {
    const seeded = seedKlipQtyFromShipmentHeader(
      [{ quantity_delivered: 500_000, quantity_receive: 480_000 }],
      {
        shipmentDeliveredKlipKg: null,
        shipmentDeliveredKg: 500_000,
        shipmentReceiveKg: null,
      },
    )
    expect(seeded).toEqual([{ quantity_delivered: null, quantity_receive: null }])
  })

  it('seeds single-PO from quantity_delivered_klip and actual_vessel receive', () => {
    const seeded = seedKlipQtyFromShipmentHeader(
      [{ quantity_delivered: 500_000, quantity_receive: 480_000 }],
      {
        shipmentDeliveredKlipKg: 510_000,
        shipmentDeliveredKg: 500_000,
        shipmentReceiveKg: 505_000,
      },
    )
    expect(seeded).toEqual([{ quantity_delivered: 510_000, quantity_receive: 505_000 }])
  })
})
