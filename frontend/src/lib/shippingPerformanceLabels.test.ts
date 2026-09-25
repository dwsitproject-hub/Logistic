import { describe, expect, it } from 'vitest'
import {
  formatShippingPerfDisplayLabel,
  getShippingSummaryMetricFormula,
  getShippingSummaryMetricLabel,
  resolveShippingPerfLabelMode,
  shippingPerfCardTitleLines,
  SHIPPING_SUMMARY_METRIC_LABELS,
} from './shippingPerformanceLabels'

describe('formatShippingPerfDisplayLabel', () => {
  it('keeps estimated short labels for Open', () => {
    expect(
      formatShippingPerfDisplayLabel(SHIPPING_SUMMARY_METRIC_LABELS.loadingEtr, 'estimated'),
    ).toBe('Avg Load (ETA-ETR)')
  })

  it('maps ETA/ETR/ETB/ETC to ATA/ATR/ATB/ATC for Close short labels', () => {
    expect(
      formatShippingPerfDisplayLabel(SHIPPING_SUMMARY_METRIC_LABELS.loadingEtr, 'actual'),
    ).toBe('Avg Load (ATA-ATR)')
    expect(
      formatShippingPerfDisplayLabel(SHIPPING_SUMMARY_METRIC_LABELS.loadingEtb, 'actual'),
    ).toBe('Avg Load (ATA-ATB)')
    expect(
      formatShippingPerfDisplayLabel(SHIPPING_SUMMARY_METRIC_LABELS.loadingEtc, 'actual'),
    ).toBe('Avg Load (ATB-ATC)')
    expect(
      formatShippingPerfDisplayLabel('Avg Discharge (ETA-ETB)', 'actual'),
    ).toBe('Avg Discharge (ATA-ATB)')
    expect(
      formatShippingPerfDisplayLabel('Avg Discharge (ETB-ETC)', 'actual'),
    ).toBe('Avg Discharge (ATB-ATC)')
  })
})

describe('getShippingSummaryMetricLabel', () => {
  it('returns full label for tooltips', () => {
    expect(getShippingSummaryMetricLabel('loadingEtr', 'estimated', 'full')).toBe(
      'Avg Load (ETA - ETR)',
    )
    expect(getShippingSummaryMetricLabel('loadingEtr', 'actual', 'full')).toBe(
      'Avg Load (ATA - ATR)',
    )
  })

  it('returns Formula: hover text and maps ETA to ATA on Completed', () => {
    expect(getShippingSummaryMetricFormula('loadingEtr', 'estimated')).toBe(
      'Formula: ETA Vessel Arrival at Loading Port - Cargo Readiness Date',
    )
    expect(getShippingSummaryMetricFormula('loadingEtr', 'actual')).toBe(
      'Formula: ATA Vessel Arrival at Loading Port - Cargo Readiness Date',
    )
    expect(getShippingSummaryMetricFormula('dischargeEtc', 'actual')).toBe(
      'Formula: ATA Vessel Berthed at Discharge Port - ATA Vessel Complete Discharge',
    )
  })

  it('uses compact Avg Disc on the card short label', () => {
    expect(getShippingSummaryMetricLabel('dischargeEtb', 'estimated', 'short')).toBe(
      'Avg Disc (ETA-ETB)',
    )
    expect(getShippingSummaryMetricLabel('dischargeEtc', 'actual', 'short')).toBe(
      'Avg Disc (ATB-ATC)',
    )
    expect(getShippingSummaryMetricLabel('dischargeEtb', 'estimated', 'full')).toBe(
      'Avg Discharge (ETA - ETB)',
    )
  })
})

describe('shippingPerfCardTitleLines', () => {
  it('uses single-line On Going title', () => {
    expect(shippingPerfCardTitleLines('ongoing')).toEqual({ main: 'ON GOING' })
    expect(shippingPerfCardTitleLines('close')).toEqual({ main: 'COMPLETED' })
    expect(shippingPerfCardTitleLines('all')).toEqual({ main: 'All' })
  })
})

describe('resolveShippingPerfLabelMode', () => {
  it('uses status filter when set', () => {
    expect(resolveShippingPerfLabelMode('ongoing', 'Closed')).toBe('actual')
    expect(resolveShippingPerfLabelMode('close', 'Open')).toBe('estimated')
  })

  it('falls back to dashboard card when All', () => {
    expect(resolveShippingPerfLabelMode('close', 'All')).toBe('actual')
    expect(resolveShippingPerfLabelMode('ongoing', 'All')).toBe('estimated')
    expect(resolveShippingPerfLabelMode('all', 'All')).toBe('estimated')
  })
})
