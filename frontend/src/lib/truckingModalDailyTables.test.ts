import { describe, expect, it } from 'vitest'
import {
  formatSapQtyMtOrDash,
  filterActualRowsForSto,
  normalizeDailyActualRows,
  normalizePlanningDeliverableRows,
  normalizeStoActuals,
  resolveWbActualsDisplayMode,
  sumActualDeliveryKg,
  sumActualReceiveKg,
  sumPlanningDeliveryKg,
} from './truckingModalDailyTables'

describe('truckingModalDailyTables', () => {
  it('normalizes planning deliverables sorted by date', () => {
    const rows = normalizePlanningDeliverableRows([
      { date: '2026-06-02', quantity_delivered: 2000 },
      { date: '2026-06-01', quantity_delivered: 1000 },
    ])
    expect(rows).toEqual([
      { date: '2026-06-01', quantity_delivery_kg: 1000 },
      { date: '2026-06-02', quantity_delivery_kg: 2000 },
    ])
    expect(sumPlanningDeliveryKg(rows)).toBe(3000)
  })

  it('normalizes WB actuals with dual qty and legacy quantity_kg fallback', () => {
    const rows = normalizeDailyActualRows([
      {
        progress_date: '2026-06-02',
        quantity_delivery_kg: 5000,
        quantity_receive_kg: 4800,
        quantity_kg: 5000,
        sto_number: '1006018597',
      },
      { date: '2026-06-01', quantity_kg: 1000 },
    ])
    expect(rows[0]).toEqual({
      date: '2026-06-01',
      quantity_delivery_kg: 1000,
      quantity_receive_kg: null,
      sto_number: '',
    })
    expect(rows[1]).toEqual({
      date: '2026-06-02',
      quantity_delivery_kg: 5000,
      quantity_receive_kg: 4800,
      sto_number: '1006018597',
    })
    expect(sumActualDeliveryKg(rows)).toBe(6000)
    expect(sumActualReceiveKg(rows)).toBe(4800)
  })

  it('normalizes and filters per-STO actuals', () => {
    const sto = normalizeStoActuals([
      {
        sto_number: '1006018597',
        sap_trucking_start_receive_date: '2026-06-15',
        sap_trucking_last_receive_date: '2026-06-20',
        sap_qty_delivery: 168400,
        sap_qty_receive: 166680,
      },
      {
        sto_number: '1006018596',
        sap_trucking_start_receive_date: '2026-06-03',
        sap_qty_delivery: 244840,
        sap_qty_receive: 242540,
      },
    ])
    expect(sto).toHaveLength(2)
    expect(sto[0]?.sto_number).toBe('1006018596')
    expect(sto[1]?.qty_delivery).toBe(168400)

    const rows = normalizeDailyActualRows([
      { date: '2026-06-01', quantity_delivery_kg: 100, sto_number: '1006018596' },
      { date: '2026-06-01', quantity_delivery_kg: 200, sto_number: '1006018597' },
      { date: '2026-06-02', quantity_delivery_kg: 50 },
    ])
    expect(filterActualRowsForSto(rows, '1006018596')).toHaveLength(1)
    expect(filterActualRowsForSto(rows, '1006018596', { includeLegacyEmpty: true })).toHaveLength(2)
  })

  it('formatSapQtyMtOrDash shows dash for null', () => {
    expect(formatSapQtyMtOrDash(null)).toBe('-')
    expect(formatSapQtyMtOrDash(undefined)).toBe('-')
    expect(formatSapQtyMtOrDash(250000)).toBe('250.00')
  })

  it('resolveWbActualsDisplayMode uses singleSto for one STO', () => {
    const sto = normalizeStoActuals([{ sto_number: '1006018926' }])
    const rows = normalizeDailyActualRows([{ date: '2026-06-01', quantity_delivery_kg: 1000 }])
    expect(resolveWbActualsDisplayMode(rows, sto)).toBe('singleSto')
  })

  it('resolveWbActualsDisplayMode uses poLevelMultiSto for legacy WB without sto_number', () => {
    const sto = normalizeStoActuals([
      { sto_number: '1006018926' },
      { sto_number: '1006018927' },
    ])
    const rows = normalizeDailyActualRows([
      { date: '2026-06-01', quantity_delivery_kg: 100000 },
      { date: '2026-06-02', quantity_delivery_kg: 200000 },
    ])
    expect(resolveWbActualsDisplayMode(rows, sto)).toBe('poLevelMultiSto')
  })

  it('resolveWbActualsDisplayMode uses perSto when WB rows are sto-tagged', () => {
    const sto = normalizeStoActuals([
      { sto_number: '1006018926' },
      { sto_number: '1006018927' },
    ])
    const rows = normalizeDailyActualRows([
      { date: '2026-06-01', quantity_delivery_kg: 100, sto_number: '1006018926' },
      { date: '2026-06-01', quantity_delivery_kg: 200, sto_number: '1006018927' },
    ])
    expect(resolveWbActualsDisplayMode(rows, sto)).toBe('perSto')
    expect(filterActualRowsForSto(rows, '1006018926')).toHaveLength(1)
    expect(filterActualRowsForSto(rows, '1006018927')).toHaveLength(1)
  })
})
