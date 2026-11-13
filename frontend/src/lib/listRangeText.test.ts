import { describe, expect, it } from 'vitest'
import { listRangeText } from './listRangeText'

describe('listRangeText', () => {
  it('names the count and the rows on this page', () => {
    expect(listRangeText(1240, 4, 20, 'contracts')).toBe('1,240 contracts · 61–80')
    expect(listRangeText(1240, 1, 20, 'contracts')).toBe('1,240 contracts · 1–20')
  })

  it('stops at the total on the last page', () => {
    expect(listRangeText(45, 3, 20, 'shipments')).toBe('45 shipments · 41–45')
  })

  it('says only the count when there is nothing to range over', () => {
    expect(listRangeText(0, 1, 20, 'shipments')).toBe('0 shipments')
  })
})
