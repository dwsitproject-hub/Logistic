import { describe, expect, it } from 'vitest'
import {
  operationalRowFieldTooltipText,
  shouldApplyOperationalTruncateTooltip,
} from './operationalTableTruncateUi'

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
})
