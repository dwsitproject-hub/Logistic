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
