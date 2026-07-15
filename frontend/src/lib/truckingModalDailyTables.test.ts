import { describe, expect, it } from 'vitest'
import {
  formatSapQtyMtOrDash,
  normalizeDailyActualRows,
  normalizePlanningDeliverableRows,
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
      },
      { date: '2026-06-01', quantity_kg: 1000 },
    ])
    expect(rows[0]).toEqual({
      date: '2026-06-01',
      quantity_delivery_kg: 1000,
      quantity_receive_kg: null,
    })
    expect(rows[1]).toEqual({
      date: '2026-06-02',
      quantity_delivery_kg: 5000,
      quantity_receive_kg: 4800,
    })
    expect(sumActualDeliveryKg(rows)).toBe(6000)
    expect(sumActualReceiveKg(rows)).toBe(4800)
  })

  it('formatSapQtyMtOrDash shows dash for null', () => {
    expect(formatSapQtyMtOrDash(null)).toBe('-')
    expect(formatSapQtyMtOrDash(undefined)).toBe('-')
    expect(formatSapQtyMtOrDash(250000)).toBe('250.00')
  })
})
