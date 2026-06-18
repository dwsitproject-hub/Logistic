import type { KeyboardEvent } from 'react'

export const FAST_ENTRY_ROOT_ATTR = 'data-fast-entry-root'
export const FAST_ENTRY_GROUP_ATTR = 'data-fast-entry-group'
export const FAST_ENTRY_FOCUSABLE_ATTR = 'data-fast-entry-focusable'

export const SHIPMENT_ETA_FAST_ENTRY_GROUP = 'shipment-eta-dates'
export const TRUCKING_PLANNING_FAST_ENTRY_GROUP = 'trucking-planning'

function isFocusableFastEntryTarget(el: HTMLElement): boolean {
  if (el.hasAttribute('disabled') || (el as HTMLInputElement).disabled) return false
  if (el.getAttribute('aria-hidden') === 'true') return false
  if (el.tabIndex < 0) return false
  const style = window.getComputedStyle(el)
  if (style.visibility === 'hidden' || style.display === 'none') return false
  return true
}

/** Move focus to the next/previous field in the same fast-entry group (DOM order). */
export function focusNextInFastEntryGroup(
  current: HTMLElement,
  options?: { reverse?: boolean },
): boolean {
  const group = current.getAttribute(FAST_ENTRY_GROUP_ATTR)
  if (!group) return false

  const root =
    current.closest(`[${FAST_ENTRY_ROOT_ATTR}]`) ??
    current.closest('[role="dialog"]') ??
    document.body

  const selector = `[${FAST_ENTRY_GROUP_ATTR}="${group}"][${FAST_ENTRY_FOCUSABLE_ATTR}="true"]`
  const elements = Array.from(root.querySelectorAll<HTMLElement>(selector)).filter(
    isFocusableFastEntryTarget,
  )

  const idx = elements.indexOf(current)
  if (idx < 0) return false

  const nextIdx = options?.reverse ? idx - 1 : idx + 1
  const next = elements[nextIdx]
  if (!next) return false

  next.focus()
  if (next instanceof HTMLInputElement && next.type !== 'checkbox') {
    next.select()
  }
  return true
}

export function handleFastEntryKeyDown(
  e: KeyboardEvent<HTMLElement>,
  options?: { commitOnEnter?: boolean },
): void {
  const el = e.currentTarget
  if (!el.getAttribute(FAST_ENTRY_GROUP_ATTR)) return

  if (e.key === 'Enter') {
    e.preventDefault()
    if (options?.commitOnEnter !== false) {
      el.blur()
    }
    window.setTimeout(() => {
      focusNextInFastEntryGroup(el)
    }, 0)
    return
  }

  if (e.key === 'Tab') {
    if (focusNextInFastEntryGroup(el, { reverse: e.shiftKey })) {
      e.preventDefault()
    }
  }
}

export function fastEntryFieldProps(group: string) {
  return {
    [FAST_ENTRY_FOCUSABLE_ATTR]: 'true' as const,
    [FAST_ENTRY_GROUP_ATTR]: group,
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => handleFastEntryKeyDown(e),
  }
}
