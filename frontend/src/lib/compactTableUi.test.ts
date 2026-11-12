import { describe, expect, it } from 'vitest'
import { COMPACT_TABLE_ACTIONS_COL_WIDTH_PX, compactTableActionsColWidthPx } from './compactTableUi'

describe('compactTableActionsColWidthPx', () => {
  it('keeps the same room around the icons, whatever the icon count', () => {
    // n icons of 32px, 4px between them, 12px on each side
    expect(compactTableActionsColWidthPx(1)).toBe(56)
    expect(compactTableActionsColWidthPx(2)).toBe(92)
    expect(compactTableActionsColWidthPx(3)).toBe(128)
  })

  it('makes the three-icon width (Shipments and Trucking) the default column width', () => {
    expect(COMPACT_TABLE_ACTIONS_COL_WIDTH_PX).toBe(compactTableActionsColWidthPx(3))
  })

  it('never goes below one icon', () => {
    expect(compactTableActionsColWidthPx(0)).toBe(56)
  })
})
