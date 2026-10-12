import { describe, expect, it } from 'vitest'
import {
  buildPoKlipQtySaveRows,
  hasShipmentPlanQtyEdits,
  hasVesselPortsQuantityFieldEdits,
  hasVesselPortsQuantityUserEdits,
} from './vesselPortsQuantityEdits'

const rows = [
  {
    rowKey: 'sh-1-PO1',
    quantity_delivered: 100_000,
    quantity_receive: 99_000,
  },
]

describe('hasVesselPortsQuantityUserEdits', () => {
  it('returns false when qtyEdits is empty (ETA-only save)', () => {
    expect(hasVesselPortsQuantityUserEdits(rows, {})).toBe(false)
  })

  it('returns false when edit matches the loaded row value', () => {
    expect(
      hasVesselPortsQuantityUserEdits(rows, {
        'sh-1-PO1': { quantity_delivered: 100_000 },
      }),
    ).toBe(false)
  })

  it('returns true when delivered qty differs from baseline', () => {
    expect(
      hasVesselPortsQuantityUserEdits(rows, {
        'sh-1-PO1': { quantity_delivered: 101_000 },
      }),
    ).toBe(true)
  })

  it('returns true when receive qty differs from baseline', () => {
    expect(
      hasVesselPortsQuantityUserEdits(rows, {
        'sh-1-PO1': { quantity_receive: 98_500 },
      }),
    ).toBe(true)
  })
})

describe('hasVesselPortsQuantityFieldEdits', () => {
  it('detects receive-only edits without treating delivery as changed', () => {
    expect(
      hasVesselPortsQuantityFieldEdits(rows, { 'sh-1-PO1': { quantity_receive: 98_500 } }, 'quantity_receive'),
    ).toBe(true)
    expect(
      hasVesselPortsQuantityFieldEdits(rows, { 'sh-1-PO1': { quantity_receive: 98_500 } }, 'quantity_delivered'),
    ).toBe(false)
  })
})

describe('buildPoKlipQtySaveRows', () => {
  it('emits only changed PO fields (not untouched sibling rows)', () => {
    const qtyRows = [
      {
        rowKey: 'a',
        contract_ext_no: '1004030778',
        po_number: '1001030778',
        quantity_delivered: 100_000,
        quantity_receive: 90_000,
      },
      {
        rowKey: 'b',
        contract_ext_no: '1014003113',
        po_number: '1011003113',
        quantity_delivered: 200_000,
        quantity_receive: 180_000,
      },
    ]
    const edits = {
      a: { quantity_delivered: 111_000 },
      b: { quantity_receive: 222_000 },
    }
    expect(buildPoKlipQtySaveRows(qtyRows, edits)).toEqual([
      {
        contractNumber: '1004030778',
        poNumber: '1001030778',
        quantityDeliveredKlipKg: 111_000,
        quantityReceiveKlipKg: null,
      },
      {
        contractNumber: '1014003113',
        poNumber: '1011003113',
        quantityDeliveredKlipKg: null,
        quantityReceiveKlipKg: 222_000,
      },
    ])
  })

  it('skips rows whose edit matches the loaded baseline', () => {
    expect(
      buildPoKlipQtySaveRows(
        [{ rowKey: 'a', contract_ext_no: '1004030778', quantity_delivered: 100_000, quantity_receive: null }],
        { a: { quantity_delivered: 100_000 } },
      ),
    ).toEqual([])
  })
})

describe('Shipment Plan Qty edits', () => {
  const planRows = [
    {
      rowKey: 'sh-1-PO1',
      contract_ext_no: '1004030778',
      po_number: '1001030778',
      quantity_delivered: 100_000,
      quantity_receive: 99_000,
      quantity_shipment_plan: 250_000,
    },
    {
      rowKey: 'sh-1-PO2',
      contract_ext_no: '1004030779',
      po_number: '1001030779',
      quantity_delivered: 0,
      quantity_receive: 0,
      quantity_shipment_plan: null,
    },
  ]

  it('detects a changed plan, and ignores an edit equal to the loaded value', () => {
    expect(hasShipmentPlanQtyEdits(planRows, {})).toBe(false)
    expect(hasShipmentPlanQtyEdits(planRows, { 'sh-1-PO1': { quantity_shipment_plan: 250_000 } })).toBe(false)
    expect(hasShipmentPlanQtyEdits(planRows, { 'sh-1-PO1': { quantity_shipment_plan: 300_000 } })).toBe(true)
    expect(hasShipmentPlanQtyEdits(planRows, { 'sh-2-X': { quantity_shipment_plan: 1 } })).toBe(false)
  })

  it('a plan edit is NOT a Delivered / Receive edit, so it cannot switch on that handling of the save', () => {
    const edits = { 'sh-1-PO1': { quantity_shipment_plan: 300_000 } }
    expect(hasVesselPortsQuantityUserEdits(planRows, edits)).toBe(false)
    expect(hasVesselPortsQuantityFieldEdits(planRows, edits, 'quantity_delivered')).toBe(false)
    expect(hasVesselPortsQuantityFieldEdits(planRows, edits, 'quantity_receive')).toBe(false)
  })

  it('sends the plan for a changed row only, and leaves the key out of rows that did not change it', () => {
    const rowsOut = buildPoKlipQtySaveRows(planRows, {
      'sh-1-PO1': { quantity_shipment_plan: 300_000 },
      'sh-1-PO2': { quantity_delivered: 5_000 },
    })
    expect(rowsOut).toEqual([
      {
        contractNumber: '1004030778',
        poNumber: '1001030778',
        quantityDeliveredKlipKg: null,
        quantityReceiveKlipKg: null,
        quantityShipmentPlanKg: 300_000,
      },
      {
        contractNumber: '1004030779',
        poNumber: '1001030779',
        quantityDeliveredKlipKg: 5_000,
        quantityReceiveKlipKg: null,
      },
    ])
    expect(rowsOut[1]).not.toHaveProperty('quantityShipmentPlanKg')
  })

  it('a plan set to 0 is saved as 0 (a cleared plan), not dropped', () => {
    const rowsOut = buildPoKlipQtySaveRows(planRows, { 'sh-1-PO1': { quantity_shipment_plan: 0 } })
    expect(rowsOut).toHaveLength(1)
    expect(rowsOut[0]?.quantityShipmentPlanKg).toBe(0)
  })

  it('delivered, receive and plan changed together are carried in one row', () => {
    const rowsOut = buildPoKlipQtySaveRows(planRows, {
      'sh-1-PO1': { quantity_delivered: 120_000, quantity_receive: 110_000, quantity_shipment_plan: 260_000 },
    })
    expect(rowsOut[0]).toMatchObject({
      quantityDeliveredKlipKg: 120_000,
      quantityReceiveKlipKg: 110_000,
      quantityShipmentPlanKg: 260_000,
    })
  })
})
