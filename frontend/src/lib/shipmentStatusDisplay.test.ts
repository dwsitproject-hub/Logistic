import { describe, expect, it } from 'vitest'
import {
  formatShipmentStatusLabel,
  SHIPMENT_STATUS_DISPLAY_LABELS,
} from './shipmentStatusDisplay'

describe('formatShipmentStatusLabel', () => {
  it('maps renamed pipeline statuses for display', () => {
    expect(formatShipmentStatusLabel('IN_PROGRESS')).toBe('Sailing to LP')
    expect(formatShipmentStatusLabel('LOADING')).toBe('Loading at DP')
    expect(formatShipmentStatusLabel('IN_TRANSIT')).toBe('Sailing to DP')
    expect(formatShipmentStatusLabel('ARRIVED')).toBe('Arrived at DP')
  })

  it('keeps other statuses unchanged', () => {
    expect(formatShipmentStatusLabel('PLANNED')).toBe('Planned')
    expect(formatShipmentStatusLabel('UNLOADING')).toBe('Unloading')
    expect(formatShipmentStatusLabel('COMPLETED')).toBe('Completed')
  })

  it('covers all display labels', () => {
    for (const [key, label] of Object.entries(SHIPMENT_STATUS_DISPLAY_LABELS)) {
      expect(formatShipmentStatusLabel(key)).toBe(label)
    }
  })
})
