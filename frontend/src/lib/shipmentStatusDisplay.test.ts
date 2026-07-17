import {
  formatShipmentStatusLabel,
  shipmentStatusLabelLines,
  SHIPMENT_STATUS_DISPLAY_LABELS,
} from './shipmentStatusDisplay'

describe('formatShipmentStatusLabel', () => {
  it('maps granular shipment statuses for display', () => {
    expect(formatShipmentStatusLabel('ARRIVED_LP')).toBe('Arrived LP')
    expect(formatShipmentStatusLabel('BERTHED_LP')).toBe('Berthed LP')
    expect(formatShipmentStatusLabel('LOADING')).toBe('Loading')
    expect(formatShipmentStatusLabel('COMPLETED_LOADING')).toBe('Completed Loading')
    expect(formatShipmentStatusLabel('SAILED')).toBe('Sailed')
    expect(formatShipmentStatusLabel('ARRIVED_DP')).toBe('Arrived DP')
    expect(formatShipmentStatusLabel('BERTHED_DP')).toBe('Berthed DP')
    expect(formatShipmentStatusLabel('UNLOADING')).toBe('Unloading')
  })

  it('maps legacy keys to granular labels', () => {
    expect(formatShipmentStatusLabel('IN_PROGRESS')).toBe('Arrived LP')
    expect(formatShipmentStatusLabel('IN_TRANSIT')).toBe('Sailed')
    expect(formatShipmentStatusLabel('ARRIVED')).toBe('Arrived DP')
  })

  it('covers all display labels', () => {
    for (const [key, label] of Object.entries(SHIPMENT_STATUS_DISPLAY_LABELS)) {
      expect(formatShipmentStatusLabel(key)).toBe(label)
    }
  })
})

describe('shipmentStatusLabelLines', () => {
  it('splits Completed Loading into two lines for narrow columns', () => {
    expect(shipmentStatusLabelLines('COMPLETED_LOADING')).toEqual(['Completed', 'Loading'])
  })

  it('keeps other statuses as a single line', () => {
    expect(shipmentStatusLabelLines('LOADING')).toEqual(['Loading'])
    expect(shipmentStatusLabelLines('ARRIVED_LP')).toEqual(['Arrived LP'])
  })
})
