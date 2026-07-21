import { describe, expect, it } from 'vitest'
import { resolvePlotStoLookupKey } from './addNewShipmentTypes'
import { classifyShipmentTransportMode } from '@/lib/shipmentTransportMode'

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

describe('classifyShipmentTransportMode', () => {
  it('classifies MIX before land/sea substrings (PO 1011003156)', () => {
    expect(classifyShipmentTransportMode('MIX')).toBe('mixed')
    expect(classifyShipmentTransportMode('mix')).toBe('mixed')
    expect(classifyShipmentTransportMode('MIXED')).toBe('mixed')
  })

  it('classifies SEA and LAND', () => {
    expect(classifyShipmentTransportMode('SEA')).toBe('sea')
    expect(classifyShipmentTransportMode('LAND')).toBe('land')
  })

  it('treats Sea/Land style as mixed', () => {
    expect(classifyShipmentTransportMode('Sea / Land')).toBe('mixed')
  })

  it('returns null for blank', () => {
    expect(classifyShipmentTransportMode('')).toBe(null)
    expect(classifyShipmentTransportMode(null)).toBe(null)
  })
})
