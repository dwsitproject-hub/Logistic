import {
  formatShipmentStatusLabel,
  shipmentStatusBadgeClass,
  shipmentStatusBadgeLayout,
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

describe('shipmentStatusBadgeClass', () => {
  it('uses purple for SAILED and legacy IN_TRANSIT (Sailed label)', () => {
    expect(shipmentStatusBadgeClass('SAILED')).toContain('purple')
    expect(shipmentStatusBadgeClass('IN_TRANSIT')).toContain('purple')
    expect(shipmentStatusBadgeClass('IN_TRANSIT')).toBe(shipmentStatusBadgeClass('SAILED'))
  })

  it('maps other legacy keys to the same chips as their modern equivalents', () => {
    expect(shipmentStatusBadgeClass('IN_PROGRESS')).toBe(shipmentStatusBadgeClass('ARRIVED_LP'))
    expect(shipmentStatusBadgeClass('ARRIVED')).toBe(shipmentStatusBadgeClass('ARRIVED_DP'))
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

describe('shipmentStatusBadgeLayout', () => {
  it('a status that is too long for the Shipping Performance column (Completed Loading) is two lines inside its chip, not clipped', () => {
    const layout = shipmentStatusBadgeLayout('COMPLETED_LOADING')
    expect(layout.lines).toEqual(['Completed', 'Loading'])
    expect(layout.className).toContain('whitespace-normal')
    expect(layout.className).toContain('h-auto')
    expect(layout.className).not.toContain('whitespace-nowrap')
  })

  it('every other status stays on one line and never wraps', () => {
    for (const key of Object.keys(SHIPMENT_STATUS_DISPLAY_LABELS).filter((k) => k !== 'COMPLETED_LOADING')) {
      const layout = shipmentStatusBadgeLayout(key)
      expect(layout.lines).toHaveLength(1)
      expect(layout.className).toContain('whitespace-nowrap')
    }
  })

  it('no status gives an empty chip', () => {
    expect(shipmentStatusBadgeLayout(null).lines.length).toBeGreaterThan(0)
  })
})
