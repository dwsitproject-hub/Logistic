import { describe, expect, it } from 'vitest'
import { plantLabel } from './format'

describe('plantLabel', () => {
  it('shows a Region/Plant name in capitals, and is empty for no name', () => {
    expect(plantLabel('Tanjung Buton')).toBe('TANJUNG BUTON')
    expect(plantLabel('Unassigned')).toBe('UNASSIGNED')
    expect(plantLabel(' bontang ')).toBe('BONTANG')
    expect(plantLabel(null)).toBe('')
    expect(plantLabel(undefined)).toBe('')
  })
})

import { poUploaded } from './format'

describe('poUploaded', () => {
  it('counts a PO once, when it has at least one document, out of all POs', () => {
    expect(poUploaded(9783, 3100)).toEqual({ withDocs: 6683, pct: 68.3 })
    expect(poUploaded(200, 20)).toEqual({ withDocs: 180, pct: 90 })
  })
  it('is zero for no POs, and never negative', () => {
    expect(poUploaded(0, 0)).toEqual({ withDocs: 0, pct: 0 })
    expect(poUploaded(5, 9)).toEqual({ withDocs: 0, pct: 0 })
  })
})
