import { describe, expect, it } from 'vitest'
import { computeMultiSelectMenuBox, establishesFixedContainingBlock, type PlacementRect } from '@/lib/multiSelectMenuPlacement'

const rect = (left: number, top: number, width: number, height: number): PlacementRect => ({
  left,
  top,
  width,
  height,
  right: left + width,
  bottom: top + height,
})

const VIEWPORT = { width: 1280, height: 800 }

describe('computeMultiSelectMenuBox', () => {
  it('opens below the trigger in viewport coordinates when portaled to the body', () => {
    const box = computeMultiSelectMenuBox({ trigger: rect(100, 200, 300, 40), viewport: VIEWPORT })
    expect(box.top).toBe(244)
    expect(box.left).toBe(100)
    expect(box.width).toBe(300)
  })

  it('opens above when there is little room below and more above', () => {
    const box = computeMultiSelectMenuBox({ trigger: rect(100, 700, 300, 40), viewport: VIEWPORT })
    expect(box.top).toBeLessThan(700)
  })

  describe('inside a transformed dialog', () => {
    // Centred dialog 512 wide, 600 tall, 1px border; the transform makes position: fixed relative to its padding box.
    const dialog = { ...rect(384, 100, 512, 600), borderLeft: 1, borderTop: 1 }

    it('measures from the dialog, not the viewport', () => {
      const trigger = rect(420, 300, 440, 40)
      const box = computeMultiSelectMenuBox({ trigger, viewport: VIEWPORT, containingBlock: dialog })
      // viewport top would be trigger.bottom + 4 = 344; relative to the dialog's padding box that is 344 - (100 + 1)
      expect(box.top).toBe(344 - 101)
      expect(box.left).toBe(420 - 385)
    })

    it('keeps the list inside the dialog it is clipped by', () => {
      const trigger = rect(420, 560, 440, 40) // near the bottom of the dialog
      const box = computeMultiSelectMenuBox({ trigger, viewport: VIEWPORT, containingBlock: dialog })
      const bottom = box.top + 101 + box.listMaxHeight + 96 // back to viewport coordinates
      expect(bottom).toBeLessThanOrEqual(dialog.bottom + 1)
    })

    it('does not run past the dialog\'s right edge', () => {
      const trigger = rect(800, 300, 90, 40) // narrow trigger at the right: the 220px menu would overflow
      const box = computeMultiSelectMenuBox({ trigger, viewport: VIEWPORT, containingBlock: dialog })
      const rightInViewport = box.left + 385 + box.width
      expect(rightInViewport).toBeLessThanOrEqual(dialog.right - 8)
    })
  })

  it('always leaves room for a usable list', () => {
    const tiny = { ...rect(0, 0, 400, 260), borderLeft: 0, borderTop: 0 }
    const box = computeMultiSelectMenuBox({ trigger: rect(20, 100, 300, 40), viewport: VIEWPORT, containingBlock: tiny })
    expect(box.listMaxHeight).toBeGreaterThanOrEqual(120)
  })
})

describe('establishesFixedContainingBlock', () => {
  it('is true for the centred Radix dialog (transform), false for a plain element', () => {
    expect(establishesFixedContainingBlock({ transform: 'matrix(1, 0, 0, 1, -256, -300)' })).toBe(true)
    expect(establishesFixedContainingBlock({ transform: 'none', filter: 'none' })).toBe(false)
    expect(establishesFixedContainingBlock({})).toBe(false)
  })

  it('also counts filter, perspective, will-change and paint containment', () => {
    expect(establishesFixedContainingBlock({ filter: 'blur(2px)' })).toBe(true)
    expect(establishesFixedContainingBlock({ willChange: 'transform' })).toBe(true)
    expect(establishesFixedContainingBlock({ contain: 'paint' })).toBe(true)
  })
})
