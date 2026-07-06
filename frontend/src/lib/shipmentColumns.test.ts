import { describe, expect, it } from 'vitest'
import {
  SHIPMENT_COLUMN_LAYOUT_VERSION,
  SHIPMENT_DEFAULT_VISIBLE_COLUMN_IDS,
  buildShipmentVisibleColumns,
  mergeShipmentColumnOrder,
  shipmentCompactColumnFallbackOrder,
} from './shipmentColumns'

describe('shipmentColumns', () => {
  it('uses v6 default visible order', () => {
    expect(SHIPMENT_COLUMN_LAYOUT_VERSION).toBe('shipments-columns-v6')
    expect(SHIPMENT_DEFAULT_VISIBLE_COLUMN_IDS.slice(0, 5)).toEqual([
      'late_indicator',
      'vessel_name',
      'shipment_id',
      'loading_port',
      'discharge_port',
    ])
    expect(SHIPMENT_DEFAULT_VISIBLE_COLUMN_IDS).toContain('contract_qty')
    expect(SHIPMENT_DEFAULT_VISIBLE_COLUMN_IDS).toContain('outstanding_qty_planning')
    expect(SHIPMENT_DEFAULT_VISIBLE_COLUMN_IDS).not.toContain('contract_date')
    expect(SHIPMENT_DEFAULT_VISIBLE_COLUMN_IDS).not.toContain('sto_quantity')
  })

  it('places primary columns first then extras', () => {
    const allIds = ['contract_date', 'vessel_name', 'loading_port', 'po_numbers', 'late_indicator']
    expect(shipmentCompactColumnFallbackOrder(allIds)).toEqual([
      'late_indicator',
      'vessel_name',
      'loading_port',
      'contract_date',
      'po_numbers',
    ])
  })

  it('builds visible columns from saved order', () => {
    const cols = [
      { id: 'vessel_name', label: 'Vessel' },
      { id: 'loading_port', label: 'Loading Port' },
      { id: 'contract_date', label: 'Contract Date' },
    ]
    const visible = buildShipmentVisibleColumns(cols, new Set(['vessel_name', 'contract_date']), [
      'contract_date',
      'vessel_name',
    ])
    expect(visible.map((c) => c.id)).toEqual(['contract_date', 'vessel_name'])
  })

  it('mergeShipmentColumnOrder keeps primary block first', () => {
    const allIds = ['late_indicator', 'vessel_name', 'contract_date', 'loading_port']
    expect(mergeShipmentColumnOrder(['contract_date', 'loading_port'], allIds)).toEqual([
      'late_indicator',
      'vessel_name',
      'loading_port',
      'contract_date',
    ])
  })
})
