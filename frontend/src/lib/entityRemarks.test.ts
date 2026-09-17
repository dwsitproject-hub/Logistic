import { describe, expect, it } from 'vitest'
import { formatRemarkCategoryLabel, hasEntityRemarks } from './entityRemarks'

describe('entityRemarks', () => {
  it('formatRemarkCategoryLabel maps known shipment keys', () => {
    expect(formatRemarkCategoryLabel('EDIT_SHIPMENT')).toBe('Edit shipment')
    expect(formatRemarkCategoryLabel('CANCEL_SHIPMENT')).toBe('Shipment cancellation')
  })

  it('formatRemarkCategoryLabel maps contract cargo readiness', () => {
    expect(formatRemarkCategoryLabel('CARGO_READINESS')).toBe('Cargo readiness')
  })

  it('formatRemarkCategoryLabel humanizes unknown keys', () => {
    expect(formatRemarkCategoryLabel('CUSTOM_AUDIT')).toBe('Custom Audit')
  })

  it('formatRemarkCategoryLabel returns null for empty', () => {
    expect(formatRemarkCategoryLabel(null)).toBeNull()
    expect(formatRemarkCategoryLabel('')).toBeNull()
  })

  it('hasEntityRemarks is false when empty or missing', () => {
    expect(hasEntityRemarks(0)).toBe(false)
    expect(hasEntityRemarks(undefined)).toBe(false)
    expect(hasEntityRemarks(null)).toBe(false)
    expect(hasEntityRemarks('0')).toBe(false)
  })

  it('hasEntityRemarks is true when count is at least 1', () => {
    expect(hasEntityRemarks(1)).toBe(true)
    expect(hasEntityRemarks('2')).toBe(true)
  })
})
