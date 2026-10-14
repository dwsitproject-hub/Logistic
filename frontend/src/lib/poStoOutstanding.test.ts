import { describe, expect, it } from 'vitest'
import {
  isCurrentSto,
  isMultiStoPo,
  outstandingBasis,
  poStoOutstandingHelpText,
  sumStoFulfilment,
} from '@/lib/poStoOutstanding'

describe('a PO carried by several STOs', () => {
  it('is multi-STO from the second STO on, and unknown counts are not', () => {
    expect(isMultiStoPo(2)).toBe(true)
    expect(isMultiStoPo('5')).toBe(true)
    expect(isMultiStoPo(1)).toBe(false)
    expect(isMultiStoPo(0)).toBe(false)
    expect(isMultiStoPo(null)).toBe(false)
    expect(isMultiStoPo(undefined)).toBe(false)
    expect(isMultiStoPo('abc')).toBe(false)
  })

  it('Receive reduces OS for FRC / CIF / CFR, Delivery for LCO / FOB, and any other incoterm names no single column', () => {
    for (const inc of ['CIF', 'cfr', ' FRC ']) expect(outstandingBasis(inc)).toBe('receive')
    for (const inc of ['FOB', 'lco']) expect(outstandingBasis(inc)).toBe('delivery')
    for (const inc of ['', null, undefined, 'EXW']) expect(outstandingBasis(inc)).toBeNull()
  })

  it('sums Delivery and Receive over the STOs; blanks and junk count as 0', () => {
    expect(
      sumStoFulfilment([
        { quantity_delivered: 100, quantity_receive: 90 },
        { quantity_delivered: '300', quantity_receive: null },
        { quantity_delivered: undefined, quantity_receive: 'x' },
      ]),
    ).toEqual({ delivery: 400, receive: 90 })
    expect(sumStoFulfilment([])).toEqual({ delivery: 0, receive: 0 })
  })

  it('the example: Contract Qty 1,000 and STOs that moved 100, 300 and 200 leave 400 on every STO row', () => {
    const stos = [{ quantity_receive: 100 }, { quantity_receive: 300 }, { quantity_receive: 200 }]
    const contractQty = 1000
    const total = sumStoFulfilment(stos).receive
    expect(contractQty - total).toBe(400)
  })

  it('the help text says it is the PO\'s figure, names the STO count and the column that counts', () => {
    const cif = poStoOutstandingHelpText(5, 'CIF')
    expect(cif).toContain('5 STOs')
    expect(cif).toContain('Receive Qty counts for CIF')
    expect(cif).toContain('not of this STO alone')
    expect(poStoOutstandingHelpText(3, 'FOB')).toContain('Delivery Qty counts for FOB')
    expect(poStoOutstandingHelpText(3, null)).toContain('Receive Qty counts, else Delivery Qty')
  })

  it('never says "1 STO": the help only exists for several', () => {
    expect(poStoOutstandingHelpText(1, 'CIF')).toContain('2 STOs')
  })

  it('finds the current STO by its trimmed number only', () => {
    expect(isCurrentSto(' 1586005423 ', '1586005423')).toBe(true)
    expect(isCurrentSto('1586005422', '1586005423')).toBe(false)
    expect(isCurrentSto('', '')).toBe(false)
    expect(isCurrentSto(null, '1586005423')).toBe(false)
  })
})
