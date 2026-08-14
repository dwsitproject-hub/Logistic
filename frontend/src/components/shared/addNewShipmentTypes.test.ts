import { describe, expect, it } from 'vitest'
import {
  formatPoPlantLabel,
  resolvePlotStoLookupKey,
  resolvePoPlantCode,
  resolveShipmentPlanQtyMaxMt,
  shipmentPlanQtyExceedsOsActual,
} from './addNewShipmentTypes'
import { classifyShipmentTransportMode } from '@/lib/shipmentTransportMode'

describe('formatPoPlantLabel', () => {
  it('uses plant code and ignores Group Plant Blank', () => {
    expect(formatPoPlantLabel('9191000035', 'AM10')).toBe('9191000035 - AM10')
    expect(formatPoPlantLabel('9191000035', 'Blank')).toBe('9191000035')
    expect(formatPoPlantLabel('9191000035', '')).toBe('9191000035')
    expect(resolvePoPlantCode({ plant_code: 'AM10' })).toBe('AM10')
    expect(resolvePoPlantCode({ plant_code: '' })).toBe('')
    expect(resolvePoPlantCode({ plant_code: 'Blank' })).toBe('')
  })
})

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

describe('shipment plan qty vs OS Actual', () => {
  it('caps Shipment Plan Qty by OS Actual, not OS Plan', () => {
    expect(
      resolveShipmentPlanQtyMaxMt({
        outstanding_quantity: 400_000,
        outstanding_quantity_planning: 0,
        outstanding_quantity_planning_budget: 0,
      }),
    ).toBe(400)
    expect(
      resolveShipmentPlanQtyMaxMt({
        outstanding_qty_actual: 250_000,
        outstanding_quantity: 1,
        outstanding_quantity_planning_budget: 9_000_000,
      }),
    ).toBe(250)
  })

  it('treats missing OS Actual as a zero cap', () => {
    expect(resolveShipmentPlanQtyMaxMt({})).toBe(0)
    expect(shipmentPlanQtyExceedsOsActual(400_000, 0)).toBe(true)
    expect(shipmentPlanQtyExceedsOsActual(0, 0)).toBe(false)
  })
})
