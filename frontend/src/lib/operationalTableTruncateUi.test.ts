import { describe, expect, it } from 'vitest'
import {
  SHIPMENTS_TRUNCATE_TOOLTIP_COLUMN_IDS,
  operationalMultiValueTooltip,
  operationalRowFieldTooltipText,
  shouldApplyOperationalTruncateTooltip,
} from './operationalTableTruncateUi'
import { getOperationalColumnLayout } from './operationalTableLayout'

describe('operationalTableTruncateUi', () => {
  it('applies truncate tooltip for wrap/truncate/short/two_line in allowlist', () => {
    const allow = new Set(['supplier', 'product'])
    expect(shouldApplyOperationalTruncateTooltip('supplier', 'truncate', allow)).toBe(true)
    expect(shouldApplyOperationalTruncateTooltip('supplier', 'two_line', allow)).toBe(true)
    expect(shouldApplyOperationalTruncateTooltip('supplier', 'stack', allow)).toBe(false)
    expect(shouldApplyOperationalTruncateTooltip('status', 'truncate', allow)).toBe(false)
  })

  it('builds tooltip text from row fields', () => {
    expect(operationalRowFieldTooltipText('supplier', { supplier: ' PT Long Name ' })).toBe(
      'PT Long Name',
    )
    expect(operationalRowFieldTooltipText('supplier', { supplier: '-' })).toBeNull()
    expect(operationalRowFieldTooltipText('supplier', { supplier: null })).toBeNull()
  })

  it('a cell that lists several values in one line shows them one per line in its tooltip', () => {
    expect(operationalMultiValueTooltip('1586005441, 1586005442,1586005443')).toBe('1586005441\n1586005442\n1586005443')
    expect(operationalMultiValueTooltip('PT. A')).toBe('PT. A')
    expect(operationalMultiValueTooltip(' , ')).toBeNull()
    expect(operationalMultiValueTooltip(null)).toBeNull()
  })

  it('the Shipments STO column is a truncate column with a tooltip, so a list of STOs is cut by the column width and readable on hover', () => {
    expect(getOperationalColumnLayout('shipments', 'shipment_id')).toBe('truncate')
    expect(SHIPMENTS_TRUNCATE_TOOLTIP_COLUMN_IDS.has('shipment_id')).toBe(true)
    expect(shouldApplyOperationalTruncateTooltip('shipment_id', getOperationalColumnLayout('shipments', 'shipment_id'), SHIPMENTS_TRUNCATE_TOOLTIP_COLUMN_IDS)).toBe(true)
  })
})
