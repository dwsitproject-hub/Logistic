import { describe, expect, it } from 'vitest'
import { canonicalProductName, sameProduct } from './productAlias'

describe('productAlias', () => {
  it('collapses POME and WASTE OIL (POME) into one product', () => {
    expect(canonicalProductName('WASTE OIL (POME)')).toBe('POME')
    expect(canonicalProductName('waste oil (pome')).toBe('POME')
    expect(sameProduct('POME', 'WASTE OIL (POME)')).toBe(true)
  })

  it('does not merge other materials', () => {
    expect(sameProduct('POME', 'RPOME')).toBe(false)
    expect(sameProduct('POME', 'WASTE OIL (PFAD)')).toBe(false)
    expect(sameProduct('CPO', 'PK')).toBe(false)
  })

  it('treats null and blank as empty', () => {
    expect(canonicalProductName(null)).toBe('')
    expect(sameProduct(undefined, '')).toBe(true)
  })
})
