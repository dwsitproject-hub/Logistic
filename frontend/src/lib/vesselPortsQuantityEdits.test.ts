import { describe, expect, it } from 'vitest'
import { hasVesselPortsQuantityUserEdits } from './vesselPortsQuantityEdits'

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
