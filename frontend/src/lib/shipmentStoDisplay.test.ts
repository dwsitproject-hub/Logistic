import { describe, expect, it } from 'vitest'
import { resolveEditShipmentStoNumber, resolveShipmentDisplayStoNumber } from './shipmentStoDisplay'

describe('resolveEditShipmentStoNumber', () => {
  it('shows the table STO on the SAP voyage even when the lookup key is the operation id', () => {
    expect(
      resolveEditShipmentStoNumber({
        listStoNumber: '1006020666',
        listStoProvided: true,
        lookupKey: 'OP-1004032737-34122029',
        shipmentId: '1006020666-1004032425',
        operationId: 'OP-1004032737-34122029',
        contractStoNumber: '1006020666',
      }),
    ).toBe('1006020666')
  })

  it('leaves the Add New voyage blank when the table STO is empty', () => {
    expect(
      resolveEditShipmentStoNumber({
        listStoNumber: null,
        listStoProvided: true,
        lookupKey: 'OP-1004032737-05814565',
        shipmentId: 'MNL-05814565-1004032737',
        operationId: 'OP-1004032737-05814565',
        contractStoNumber: '1006020666',
      }),
    ).toBe('-')
  })

  it('keeps the contract STO for a SAP shell opened without a list column', () => {
    expect(
      resolveEditShipmentStoNumber({
        lookupKey: 'OP-1004032737-34122029',
        shipmentId: '40012345',
        operationId: 'OP-1004032737-34122029',
        contractStoNumber: '1006020666',
      }),
    ).toBe('1006020666')
  })

  it('does not copy the contract STO onto a KLIP-added shipment id', () => {
    expect(
      resolveEditShipmentStoNumber({
        lookupKey: 'OP-1004032737-05814565',
        shipmentId: '1006020666-1004032737',
        operationId: 'OP-1004032737-05814565',
        contractStoNumber: '1006020666',
      }),
    ).toBe('-')
    expect(resolveShipmentDisplayStoNumber('OP-1004032737-05814565')).toBe('-')
  })
})
