import { describe, expect, it } from 'vitest'
import { resolveShipmentListSuppliers } from './shipmentListSuppliers'

describe('resolveShipmentListSuppliers', () => {
  it('prefers aggregated suppliers over single supplier', () => {
    expect(
      resolveShipmentListSuppliers({
        supplier: 'TAMA BUANA JAYA PT',
        suppliers: 'SUPPLIER A, SUPPLIER B, SUPPLIER C',
      }),
    ).toBe('SUPPLIER A, SUPPLIER B, SUPPLIER C')
  })

  it('falls back to supplier when suppliers is empty', () => {
    expect(resolveShipmentListSuppliers({ supplier: 'TAMA BUANA JAYA PT', suppliers: '' })).toBe(
      'TAMA BUANA JAYA PT',
    )
  })
})
