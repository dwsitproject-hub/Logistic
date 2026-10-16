import { describe, expect, it } from 'vitest'
import { applyOilLossSfalSfbdPatch } from '@/lib/oilLossSfalPatch'

type Row = { id: string; sto_number?: string | null; quantity_sfal?: number | null; quantity_sfbd?: number | null; note?: string }

const rows: Row[] = [
  { id: 'sto:1006020342', sto_number: '1006020342', quantity_sfal: 3_007_120, quantity_sfbd: 2_998_908, note: 'edited STO' },
  { id: 'sto:1006020352', sto_number: '1006020352', quantity_sfal: 2_654_861, quantity_sfbd: null, note: 'other STO' },
  { id: 'multi', sto_number: '1006020342, 1006020396', quantity_sfal: 9_999, quantity_sfbd: 9_999, note: 'joins several STOs' },
  { id: 'plain', sto_number: ' 1006020342 ', quantity_sfal: 1, quantity_sfbd: 2, note: 'same STO, no sto: id' },
]

describe('applyOilLossSfalSfbdPatch', () => {
  it('puts the saved SFAL / SFBD on the row of that STO and touches nothing else in it', () => {
    const out = applyOilLossSfalSfbdPatch(rows, '1006020342', { sfalKg: 3_100_000, sfbdKg: 3_050_000 })
    expect(out[0]).toEqual({ ...rows[0], quantity_sfal: 3_100_000, quantity_sfbd: 3_050_000 })
    expect(out[0].note).toBe('edited STO')
  })

  it('leaves every other STO alone, and a row that joins several STOs (a sum the patch cannot recompute)', () => {
    const out = applyOilLossSfalSfbdPatch(rows, '1006020342', { sfalKg: 1, sfbdKg: 2 })
    expect(out[1]).toBe(rows[1])
    expect(out[2]).toBe(rows[2])
  })

  it('finds the row by its STO list when its id is not sto:<sto>', () => {
    const out = applyOilLossSfalSfbdPatch(rows, '1006020342', { sfalKg: 5, sfbdKg: 6 })
    expect(out[3].quantity_sfal).toBe(5)
    expect(out[3].quantity_sfbd).toBe(6)
  })

  it('a cleared or zero quantity is no quantity (the snapshot stores NULLIF(sfal_qty, 0)): the row shows "-"', () => {
    const out = applyOilLossSfalSfbdPatch(rows, '1006020352', { sfalKg: null, sfbdKg: 0 })
    expect(out[1].quantity_sfal).toBeNull()
    expect(out[1].quantity_sfbd).toBeNull()
  })

  it('does not mutate its input and returns the rows unchanged when there is nothing to apply', () => {
    const before = JSON.stringify(rows)
    applyOilLossSfalSfbdPatch(rows, '1006020342', { sfalKg: 7, sfbdKg: 8 })
    expect(JSON.stringify(rows)).toBe(before)
    expect(applyOilLossSfalSfbdPatch(rows, '1006020342', null)).toEqual(rows)
    expect(applyOilLossSfalSfbdPatch(rows, '', { sfalKg: 7, sfbdKg: 8 })).toEqual(rows)
    expect(applyOilLossSfalSfbdPatch(rows, null, { sfalKg: 7, sfbdKg: 8 })).toEqual(rows)
    expect(applyOilLossSfalSfbdPatch(rows, '9999999999', { sfalKg: 7, sfbdKg: 8 })).toEqual(rows)
  })
})
