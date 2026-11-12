import { describe, expect, it } from 'vitest'
import { COMPACT_TABLE_ACTIONS_COL_WIDTH_PX, compactTableActionsColWidthPx } from './compactTableUi'

describe('compactTableActionsColWidthPx', () => {
  it('keeps 8px between the outer icons and the column edge, whatever the icon count', () => {
    // n icons of 32px, 4px between them, 8px each side
    expect(compactTableActionsColWidthPx(1)).toBe(48)
    expect(compactTableActionsColWidthPx(2)).toBe(84)
    expect(compactTableActionsColWidthPx(3)).toBe(120)
  })

  it('makes the three-icon width (Shipments and Trucking) the default column width', () => {
    expect(COMPACT_TABLE_ACTIONS_COL_WIDTH_PX).toBe(compactTableActionsColWidthPx(3))
  })

  it('never goes below one icon', () => {
    expect(compactTableActionsColWidthPx(0)).toBe(48)
  })
})
