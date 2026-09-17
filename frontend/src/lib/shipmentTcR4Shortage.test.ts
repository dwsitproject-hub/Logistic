import { describe, expect, it } from 'vitest'
import { computeShipmentR4ShortageMt } from './shipmentTcR4Shortage'

describe('computeShipmentR4ShortageMt', () => {
  it('computes R4 MT from KLIP quantities', () => {
    expect(
      computeShipmentR4ShortageMt([
        {
          quantity_delivered_klip: 1_000_000,
          quantity_delivered_sap: 900_000,
          quantity_receive_klip: 995_000,
          quantity_receive_sap: 990_000,
        },
      ]),
    ).toBe(-5)
  })

  it('returns null when delivery is zero or missing', () => {
    expect(
      computeShipmentR4ShortageMt([
        {
          quantity_delivered_klip: null,
          quantity_delivered_sap: 0,
          quantity_receive_klip: 500_000,
          quantity_receive_sap: null,
        },
      ]),
    ).toBeNull()
  })

  it('returns null when receive is missing', () => {
    expect(
      computeShipmentR4ShortageMt([
        {
          quantity_delivered_klip: 1_000_000,
          quantity_delivered_sap: null,
          quantity_receive_klip: null,
          quantity_receive_sap: null,
        },
      ]),
    ).toBeNull()
  })

  it('aggregates multi-PO lines', () => {
    expect(
      computeShipmentR4ShortageMt([
        {
          quantity_delivered_klip: 500_000,
          quantity_delivered_sap: null,
          quantity_receive_klip: 498_000,
          quantity_receive_sap: null,
        },
        {
          quantity_delivered_klip: 500_000,
          quantity_delivered_sap: null,
          quantity_receive_klip: 497_000,
          quantity_receive_sap: null,
        },
      ]),
    ).toBe(-5)
  })

  it('falls back to SAP when KLIP qty is absent', () => {
    expect(
      computeShipmentR4ShortageMt([
        {
          quantity_delivered_klip: null,
          quantity_delivered_sap: 2_000_000,
          quantity_receive_klip: null,
          quantity_receive_sap: 1_990_000,
        },
      ]),
    ).toBe(-10)
  })
})
