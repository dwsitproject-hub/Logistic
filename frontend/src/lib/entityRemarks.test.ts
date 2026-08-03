import { describe, expect, it } from 'vitest'
import { formatRemarkCategoryLabel } from './entityRemarks'

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
})
