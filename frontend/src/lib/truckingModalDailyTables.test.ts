import { describe, expect, it } from 'vitest'
import {
  combineSapStoActuals,
  formatSapQtyMtOrDash,
  filterActualRowsForSto,
  formatWbTimeRange,
  normalizeDailyActualRows,
  normalizePlanningDeliverableRows,
  normalizeStoActuals,
  resolveWbActualsDisplayMode,
  sumActualDeliveryKg,
  sumActualReceiveKg,
  sumPlanningDeliveryKg,
  wbGrandTotalsFromActualRows,
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

  it('formats the weighbridge window after the date as first entry - last exit', () => {
    expect(formatWbTimeRange('09:00', '17:00')).toBe('09.00-17.00')
    expect(formatWbTimeRange('9:05', '17:30:45')).toBe('09.05-17.30')
    // one side missing keeps the dash where it belongs
    expect(formatWbTimeRange('09:00', null)).toBe('09.00-')
    expect(formatWbTimeRange(undefined, '17:00')).toBe('-17.00')
    // neither: the caller shows the date alone
    expect(formatWbTimeRange(null, null)).toBe('')
    expect(formatWbTimeRange('', 'abc')).toBe('')
  })

  it('carries the weighbridge times onto the WB rows, and leaves them off rows without any', () => {
    const rows = normalizeDailyActualRows([
      { progress_date: '2026-09-05', quantity_delivery_kg: 5000, first_time_in: '09:00', last_time_out: '17:00' },
      { progress_date: '2026-09-06', quantity_delivery_kg: 1000, first_time_in: null, last_time_out: null },
      { progress_date: '2026-09-07', quantity_delivery_kg: 2000, first_time_in: '8:30' },
    ])
    expect(rows[0]).toMatchObject({ date: '2026-09-05', time_in: '09:00', time_out: '17:00' })
    expect('time_in' in rows[1]).toBe(false)
    expect('time_out' in rows[1]).toBe(false)
    expect(rows[2]).toMatchObject({ time_in: '08:30' })
    expect('time_out' in rows[2]).toBe(false)
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

  it('formatSapQtyMtOrDash shows 0.00 for null', () => {
    expect(formatSapQtyMtOrDash(null)).toBe('0.00')
    expect(formatSapQtyMtOrDash(undefined)).toBe('0.00')
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

  it('resolveWbActualsDisplayMode uses poLevelMultiSto even when WB rows are sto-tagged (always combined per PO)', () => {
    const sto = normalizeStoActuals([
      { sto_number: '1006018926' },
      { sto_number: '1006018927' },
    ])
    const rows = normalizeDailyActualRows([
      { date: '2026-06-01', quantity_delivery_kg: 100, sto_number: '1006018926' },
      { date: '2026-06-01', quantity_delivery_kg: 200, sto_number: '1006018927' },
    ])
    expect(resolveWbActualsDisplayMode(rows, sto)).toBe('poLevelMultiSto')
    expect(filterActualRowsForSto(rows, '1006018926')).toHaveLength(1)
    expect(filterActualRowsForSto(rows, '1006018927')).toHaveLength(1)
  })

  it('combineSapStoActuals merges per-STO SAP fields into one PO-level block', () => {
    const sto = normalizeStoActuals([
      {
        sto_number: '1006018596',
        sap_trucking_start_receive_date: '2026-06-03',
        sap_trucking_last_receive_date: '2026-06-10',
        sap_qty_delivery: 244840,
        sap_qty_receive: 242540,
      },
      {
        sto_number: '1006018597',
        sap_trucking_start_receive_date: '2026-06-15',
        sap_trucking_last_receive_date: '2026-06-20',
        sap_qty_delivery: 168400,
        sap_qty_receive: 166680,
      },
    ])
    const combined = combineSapStoActuals(sto)
    expect(combined).toEqual({
      start_receive_date: '2026-06-03',
      last_receive_date: '2026-06-20',
      qty_delivery: 244840 + 168400,
      qty_receive: 242540 + 166680,
    })
  })

  it('combineSapStoActuals returns null quantities when no STO has any value', () => {
    const sto = normalizeStoActuals([
      { sto_number: '1006018926' },
      { sto_number: '1006018927' },
    ])
    const combined = combineSapStoActuals(sto)
    expect(combined.qty_delivery).toBeNull()
    expect(combined.qty_receive).toBeNull()
    expect(combined.start_receive_date).toBe('')
    expect(combined.last_receive_date).toBe('')
  })

  it('wbGrandTotalsFromActualRows sums catalog STOs only (drops empty + junk)', () => {
    const rows = normalizeDailyActualRows([
      {
        date: '2026-07-07',
        quantity_delivery_kg: 1949560,
        quantity_receive_kg: 1942280,
        sto_number: '1006019037',
      },
      {
        date: '2026-07-08',
        quantity_delivery_kg: 1781480,
        quantity_receive_kg: 1773980,
        sto_number: '',
      },
      {
        date: '2026-07-09',
        quantity_delivery_kg: 151380,
        quantity_receive_kg: 150720,
        sto_number: '123',
      },
    ])
    const catalog = ['1006019037', '1006019038', '1006019039', '1006019040']
    const grand = wbGrandTotalsFromActualRows(rows, catalog)
    expect(grand.deliveryKg).toBe(1949560)
    expect(grand.receiveKg).toBe(1942280)
    expect(sumActualDeliveryKg(filterActualRowsForSto(rows, '1006019037'))).toBe(1949560)
  })
})
