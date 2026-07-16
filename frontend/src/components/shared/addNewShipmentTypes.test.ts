import { describe, expect, it } from 'vitest'
import { resolvePlotStoLookupKey } from './addNewShipmentTypes'

describe('resolvePlotStoLookupKey', () => {
  it('prefers list STO over contract sto from getShipmentById', () => {
    expect(
      resolvePlotStoLookupKey({
        listSto: '1586004884',
        apiStoNumber: '1586004917',
        shipmentId: '1586004884',
      }),
    ).toBe('1586004884')
  })

  it('falls back to numeric shipment_id when list STO missing', () => {
    expect(
      resolvePlotStoLookupKey({
        apiStoNumber: '1586004917',
        shipmentId: '1586004884',
      }),
    ).toBe('1586004884')
  })

  it('uses api sto when list and shipment_id are not usable', () => {
    expect(
      resolvePlotStoLookupKey({
        apiStoNumber: '1586004917',
        shipmentId: 'OP-MANUAL-1',
        operationId: 'OP-X',
      }),
    ).toBe('1586004917')
  })
})
