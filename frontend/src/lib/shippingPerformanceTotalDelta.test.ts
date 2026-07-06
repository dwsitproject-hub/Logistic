import { describe, expect, it } from 'vitest'
import {
  areAllShippingPerfDeltaSegmentsNull,
  resolveShippingPerfTotalDeltaDisplay,
} from './shippingPerformanceTotalDelta'

describe('shippingPerformanceTotalDelta', () => {
  it('treats total as missing when all ETA segments are null', () => {
    const row = {
      loading_delta_eta_etr_days: null,
      loading_delta_eta_etb_days: null,
      loading_delta_etb_etc_days: null,
      discharge_delta_eta_etb_days: null,
      discharge_delta_etb_etc_days: null,
      total_delta_days: 0,
    }
    expect(areAllShippingPerfDeltaSegmentsNull(row, 'eta')).toBe(true)
    expect(resolveShippingPerfTotalDeltaDisplay(row, 'eta')).toBeNull()
  })

  it('keeps total when at least one segment has a value', () => {
    const row = {
      loading_delta_eta_etr_days: 2,
      loading_delta_eta_etb_days: null,
      loading_delta_etb_etc_days: null,
      discharge_delta_eta_etb_days: null,
      discharge_delta_etb_etc_days: null,
      total_delta_days: 2,
    }
    expect(resolveShippingPerfTotalDeltaDisplay(row, 'eta')).toBe(2)
  })

  it('uses ATA segment keys in close mode', () => {
    const row = {
      ata_loading_delta_eta_etr_days: null,
      ata_loading_delta_eta_etb_days: null,
      ata_loading_delta_etb_etc_days: null,
      ata_discharge_delta_eta_etb_days: null,
      ata_discharge_delta_etb_etc_days: null,
      ata_total_delta_days: 0,
    }
    expect(resolveShippingPerfTotalDeltaDisplay(row, 'ata')).toBeNull()
  })
})
