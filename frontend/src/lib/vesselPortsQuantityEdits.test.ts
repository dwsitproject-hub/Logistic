import { describe, expect, it } from 'vitest'
import {
  buildPoKlipQtySaveRows,
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

describe('buildPoKlipQtySaveRows', () => {
  it('emits one row per PO with effective delivered/receive (edits win)', () => {
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
        quantityReceiveKlipKg: 90_000,
      },
      {
        contractNumber: '1014003113',
        poNumber: '1011003113',
        quantityDeliveredKlipKg: 200_000,
        quantityReceiveKlipKg: 222_000,
      },
    ])
  })
})
