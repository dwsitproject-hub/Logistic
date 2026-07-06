import { describe, expect, it } from 'vitest'
import {
  ALL_SHIPMENTS_PRESET_COLUMN_ORDER,
  buildAllShipmentsPresetVisibleColumns,
  ensureAllShipmentsPresetColumnOrder,
  isAllShipmentsPresetVisibleColumn,
} from './shippingPerformanceTableUi'

describe('shippingPerformanceTableUi — All Shipments preset', () => {
  const allKeys = [
    'vessel_name',
    'contract_ext_no',
    'sto_number',
    'loading_port',
    'discharge_port',
    'supplier',
    'incoterm',
    'product',
    'status',
    'contract_qty',
    'delivered_qty',
    'outstanding_qty_actual',
    'outstanding_qty_planning',
    'loading_delta_eta_etr_days',
    'loading_delta_eta_etb_days',
    'loading_delta_etb_etc_days',
    'discharge_delta_eta_etb_days',
    'discharge_delta_etb_etc_days',
    'total_delta_days',
  ]

  it('defines 16 default visible columns in prescribed order', () => {
    expect(ALL_SHIPMENTS_PRESET_COLUMN_ORDER).toEqual([
      'vessel_name',
      'sto_number',
      'loading_port',
      'discharge_port',
      'supplier',
      'incoterm',
      'product',
      'status',
      'contract_qty',
      'outstanding_qty_actual',
      'loading_delta_eta_etr_days',
      'loading_delta_eta_etb_days',
      'loading_delta_etb_etc_days',
      'discharge_delta_eta_etb_days',
      'discharge_delta_etb_etc_days',
      'total_delta_days',
    ])
  })

  it('marks only preset keys visible by default', () => {
    const visible = buildAllShipmentsPresetVisibleColumns(allKeys)
    for (const key of ALL_SHIPMENTS_PRESET_COLUMN_ORDER) {
      expect(visible[key]).toBe(true)
      expect(isAllShipmentsPresetVisibleColumn(key)).toBe(true)
    }
    expect(visible.delivered_qty).toBe(false)
    expect(visible.contract_ext_no).toBe(false)
    expect(visible.outstanding_qty_planning).toBe(false)
  })

  it('places preset columns first then extras in definition order', () => {
    expect(ensureAllShipmentsPresetColumnOrder(allKeys, allKeys).slice(0, 16)).toEqual([
      ...ALL_SHIPMENTS_PRESET_COLUMN_ORDER,
    ])
    expect(ensureAllShipmentsPresetColumnOrder(allKeys, allKeys)).toEqual([
      ...ALL_SHIPMENTS_PRESET_COLUMN_ORDER,
      'contract_ext_no',
      'delivered_qty',
      'outstanding_qty_planning',
    ])
  })
})
