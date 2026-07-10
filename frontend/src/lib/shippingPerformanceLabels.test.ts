import { describe, expect, it } from 'vitest'
import {
  formatShippingPerfDisplayLabel,
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
})

describe('shippingPerfCardTitleLines', () => {
  it('splits On Going cards into main line and smaller sub line', () => {
    expect(shippingPerfCardTitleLines('ongoingNoEta')).toEqual({
      main: 'On Going',
      sub: 'no ETA',
    })
    expect(shippingPerfCardTitleLines('ongoingWithEta')).toEqual({
      main: 'On Going',
      sub: 'with ETA',
    })
    expect(shippingPerfCardTitleLines('close')).toEqual({ main: 'Close' })
    expect(shippingPerfCardTitleLines('all')).toEqual({ main: 'All' })
  })
})

describe('resolveShippingPerfLabelMode', () => {
  it('uses status filter when set', () => {
    expect(resolveShippingPerfLabelMode('ongoingWithEta', 'Closed')).toBe('actual')
    expect(resolveShippingPerfLabelMode('close', 'Open')).toBe('estimated')
  })

  it('falls back to dashboard card when All', () => {
    expect(resolveShippingPerfLabelMode('close', 'All')).toBe('actual')
    expect(resolveShippingPerfLabelMode('ongoingWithEta', 'All')).toBe('estimated')
    expect(resolveShippingPerfLabelMode('ongoingNoEta', 'All')).toBe('estimated')
    expect(resolveShippingPerfLabelMode('all', 'All')).toBe('estimated')
  })
})
