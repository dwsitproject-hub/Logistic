'use client'

import { useEffect, useMemo, useState } from 'react'

/**
 * The compact list tables give each column a tight width so management sees as much as possible on one screen. When the screen is wider than those widths add up to, the
 * leftover used to be an empty strip at the right of the table. This spreads that leftover over the columns in proportion to their own width, so the table fills its
 * card; on a narrow screen (or a table with many columns) nothing changes: the widths stay as they are and the table scrolls sideways.
 *
 * `widths` are the compact widths in px, `fixedPx` is what must keep its width (an Actions column, a Rank column), `availablePx` is the room the table has.
 * The rounding remainder goes to the last column so the table ends exactly at the edge instead of 1px short or over.
 */
export function stretchColumnWidths(widths: readonly number[], availablePx: number, fixedPx = 0): number[] {
  const sum = widths.reduce((total, w) => total + w, 0)
  // 1px of margin keeps a fractional container width from making the table 1px too wide and showing a scrollbar
  const room = Math.floor(availablePx - fixedPx - 1)
  if (!(sum > 0) || !(room > sum)) return [...widths]
  const scale = room / sum
  const stretched = widths.map((w) => Math.floor(w * scale))
  const used = stretched.reduce((total, w) => total + w, 0)
  if (stretched.length > 0) stretched[stretched.length - 1] += room - used
  return stretched
}

/**
 * Attach `ref` to the element that scrolls the table (the one whose width is the table's room) and render each `<col>` with the returned width.
 * `ref` is a callback ref, so a table that mounts later (after a load, or only on a wide screen) is measured when it appears.
 * Until the first measurement the compact widths are used, so a server render and the first paint are unchanged.
 */
export function useStretchedColumnWidths(widths: readonly number[], fixedPx = 0) {
  const [el, setEl] = useState<HTMLDivElement | null>(null)
  const [availablePx, setAvailablePx] = useState<number | null>(null)

  useEffect(() => {
    if (!el) return
    const measure = () => setAvailablePx(el.clientWidth)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [el])

  const key = widths.join(',')
  const stretched = useMemo(
    () => (availablePx == null ? [...widths] : stretchColumnWidths(widths, availablePx, fixedPx)),
    // `key` stands for the contents of `widths`, which callers rebuild on every render
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key, availablePx, fixedPx],
  )
  return { ref: setEl, widths: stretched }
}
