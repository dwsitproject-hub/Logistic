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
    'lp_flow_rate',
    'dp_flow_rate',
  ]

  it('defines 18 default visible columns in prescribed order', () => {
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
      'lp_flow_rate',
      'dp_flow_rate',
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

  it('preserves saved user order and appends missing keys', () => {
    expect(
      ensureAllShipmentsPresetColumnOrder(
        ['delivered_qty', 'vessel_name', 'sto_number'],
        allKeys,
      ),
    ).toEqual([
      'delivered_qty',
      'vessel_name',
      'sto_number',
      ...ALL_SHIPMENTS_PRESET_COLUMN_ORDER.filter(
        (key) => key !== 'vessel_name' && key !== 'sto_number',
      ),
      'contract_ext_no',
      'outstanding_qty_planning',
    ])
  })

  it('uses preset order when saved order is empty', () => {
    expect(ensureAllShipmentsPresetColumnOrder([], allKeys).slice(0, 18)).toEqual([
      ...ALL_SHIPMENTS_PRESET_COLUMN_ORDER,
    ])
  })
})
