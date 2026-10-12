/**
 * Where the SearchableMultiSelect menu goes, as numbers - so it can be tested without a browser.
 *
 * The menu is portaled out of its trigger's clipping parents. Inside a Radix Dialog it has to be portaled into the dialog's own
 * element instead of document.body: the dialog traps focus, so a search box that lives outside it is pulled back out of focus
 * the moment it receives it, and typing never reaches it (clicking an option still worked, which is why only Search looked broken).
 *
 * The dialog is centred with a CSS transform, and a transformed ancestor becomes the containing block of `position: fixed`
 * descendants: top/left are then measured from the dialog, not from the viewport, and the dialog's overflow clips what sticks out.
 * So the box is computed in viewport coordinates, kept inside the bounds it will be clipped to, and converted at the end.
 */

export type PlacementRect = { top: number; left: number; right: number; bottom: number; width: number; height: number }

export type MenuBox = { top: number; left: number; width: number; listMaxHeight: number }

const MARGIN = 8
/** Search box + footer around the scrolling list. */
const CHROME_HEIGHT = 96
const MIN_LIST_HEIGHT = 120
const MIN_MENU_WIDTH = 220

export function computeMultiSelectMenuBox(input: {
  trigger: PlacementRect
  viewport: { width: number; height: number }
  /**
   * The transformed ancestor that `position: fixed` is measured from and clipped by - null when the menu is portaled to
   * document.body. `borderLeft` / `borderTop` are its clientLeft / clientTop: the containing block is its PADDING box.
   */
  containingBlock?: (PlacementRect & { borderLeft: number; borderTop: number }) | null
}): MenuBox {
  const { trigger, viewport, containingBlock } = input
  const bounds = containingBlock
    ? { top: containingBlock.top, left: containingBlock.left, right: containingBlock.right, bottom: containingBlock.bottom }
    : { top: 0, left: 0, right: viewport.width, bottom: viewport.height }

  const spaceBelow = bounds.bottom - trigger.bottom - MARGIN
  const spaceAbove = trigger.top - bounds.top - MARGIN
  const openBelow = spaceBelow >= 220 || spaceBelow >= spaceAbove
  const available = Math.max(160, openBelow ? spaceBelow : spaceAbove)
  const listMaxHeight = Math.max(MIN_LIST_HEIGHT, available - CHROME_HEIGHT)

  const width = Math.max(trigger.width, MIN_MENU_WIDTH)
  const viewportTop = openBelow
    ? trigger.bottom + 4
    : Math.max(bounds.top + MARGIN, trigger.top - (listMaxHeight + CHROME_HEIGHT) - 4)
  // Never start left of the bounds or run past their right edge (a dialog is narrower than the menu's natural reach).
  const viewportLeft = Math.max(bounds.left + MARGIN, Math.min(trigger.left, bounds.right - MARGIN - width))

  const offsetLeft = containingBlock ? containingBlock.left + containingBlock.borderLeft : 0
  const offsetTop = containingBlock ? containingBlock.top + containingBlock.borderTop : 0
  return {
    top: viewportTop - offsetTop,
    left: viewportLeft - offsetLeft,
    width,
    listMaxHeight,
  }
}

/** A `position: fixed` descendant is positioned against this element when it has any of these. */
export function establishesFixedContainingBlock(style: {
  transform?: string
  filter?: string
  perspective?: string
  willChange?: string
  contain?: string
}): boolean {
  const none = (v?: string) => !v || v === 'none'
  if (!none(style.transform) || !none(style.filter) || !none(style.perspective)) return true
  if (/transform|filter|perspective/.test(style.willChange ?? '')) return true
  return /paint|layout|strict|content/.test(style.contain ?? '')
}
