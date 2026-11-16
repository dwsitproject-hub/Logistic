'use client'

import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { SlidersHorizontal, X } from 'lucide-react'

/** One filter of a FitFilterBar, in display order. Which ones move behind More filters first is the priority (the first ones are the last to move by default). */
export interface FitItem {
  key: string
  /** The least width of the field in the row, in rem; the fields then grow to share what is left of the row. */
  width: number
  /** The field as drawn in the row. */
  row: ReactNode
  /** The same field with its label (a ListFilterField), as drawn inside More filters. */
  panel: ReactNode
  /** The filter is narrowing the list. */
  active: boolean
  /**
   * Higher stays in the row longer. Default: the earlier in the list, the higher, which is the old behaviour (the tail goes first). Give it explicitly when the field that
   * should leave first is not the last one drawn (Master Vessel: Owner and Type leave before Charter, In KLIP and the DHM status that sit after them).
   */
  priority?: number
  /** How strongly the field takes the free width, relative to the others (default 1). A search box takes more. */
  grow?: number
  /** The widest the field may get, in rem (default 20); null for no limit. */
  maxRem?: number | null
}

interface Props {
  items: FitItem[]
  /** True when anything (the header fields included) narrows the page, so Reset shows. */
  anyActive: boolean
  onReset: () => void
  /** Icon buttons at the right end of the row. */
  actions?: ReactNode
  /** No outer card: for a bar that sits inside a card of its own (the Master lists), with a line under it. */
  bare?: boolean
}

const GAP_REM = 0.5
const RESET_REM = 2.25
const MORE_WIDE_REM = 7.75
const MORE_NARROW_REM = 3.25

/**
 * The filter row of a list: it measures its own width and shows as many filters as really fit, the rest wait behind a More filters button, which carries a count
 * of the ones that are on and disappears when everything fits. Nothing here depends on the screen's breakpoints, so a wide window never leaves a filter behind
 * while there is room for it. Used by Shipping and Contract Performance, the claim pages and the Master Vessel list.
 */
export function FitFilterBar({ items, anyActive, onReset, actions, bare = false }: Props) {
  const rowRef = useRef<HTMLDivElement>(null)
  const actionsRef = useRef<HTMLDivElement>(null)
  const [visibleKeys, setVisibleKeys] = useState<string[]>(() => items.map((item) => item.key))
  const [open, setOpen] = useState(false)
  const layoutKey = items.map((item, index) => `${item.key}:${item.width}:${item.priority ?? -index}`).join('|')

  useLayoutEffect(() => {
    const el = rowRef.current
    if (!el) return
    const entries = layoutKey.split('|').map((part) => {
      const [key, width, priority] = part.split(':')
      return { key, width: Number(width), priority: Number(priority) }
    })
    // the order they are tried in: the highest priority first (a stable sort, so equal priorities keep the order they are drawn in)
    const byPriority = entries.map((entry, index) => ({ ...entry, index })).sort((a, b) => b.priority - a.priority || a.index - b.index)
    const compute = () => {
      const rootPx = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
      const style = getComputedStyle(el)
      const inner = el.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
      const gap = GAP_REM * rootPx
      const actionsW = actionsRef.current ? actionsRef.current.offsetWidth + gap : 0
      const resetW = anyActive ? RESET_REM * rootPx + gap : 0
      const moreW = (window.innerWidth >= 640 ? MORE_WIDE_REM : MORE_NARROW_REM) * rootPx + gap
      const fit = (reserved: number) => {
        let used = 0
        const chosen = new Set<string>()
        for (const entry of byPriority) {
          const need = entry.width * rootPx + (chosen.size > 0 ? gap : 0)
          if (used + need > inner - reserved) break
          used += need
          chosen.add(entry.key)
        }
        return chosen
      }
      const all = fit(actionsW + resetW)
      const chosen = all.size === entries.length ? all : fit(actionsW + resetW + moreW)
      const next = entries.map((entry) => entry.key).filter((key) => chosen.has(key))
      setVisibleKeys((prev) => (prev.length === next.length && prev.every((key, index) => key === next[index]) ? prev : next))
    }
    compute()
    const observer = new ResizeObserver(compute)
    observer.observe(el)
    return () => observer.disconnect()
    // the Reset button appearing or going changes the room, so anyActive is a dependency too
  }, [layoutKey, actions, anyActive])

  const visible = new Set(visibleKeys)
  const shown = items.filter((item) => visible.has(item.key))
  const hidden = items.filter((item) => !visible.has(item.key))
  const hiddenOn = hidden.filter((item) => item.active).length
  const hasMore = hidden.length > 0

  const row = (
    <div ref={rowRef} className="flex flex-nowrap items-center gap-2 px-3 py-3 sm:px-4">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {shown.map((item) => (
          <div
            key={item.key}
            style={{
              flex: `${item.grow ?? 1} 1 ${item.width}rem`,
              minWidth: `${item.width}rem`,
              maxWidth: item.maxRem === null ? undefined : `${item.maxRem ?? 20}rem`,
            }}
          >
            {item.row}
          </div>
        ))}
      </div>

      {anyActive ? (
        <button
          type="button"
          onClick={onReset}
          title="Reset filters"
          aria-label="Reset filters"
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-800"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      ) : null}

      {hasMore ? (
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          title="More filters"
          className={`inline-flex h-9 shrink-0 items-center gap-1.5 rounded-[10px] border px-2.5 text-sm ${
            open || hiddenOn > 0 ? 'border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100' : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
          }`}
        >
          <SlidersHorizontal className="h-4 w-4" aria-hidden />
          <span className="hidden sm:inline">More filters</span>
          {hiddenOn > 0 ? (
            <span className="rounded-full bg-blue-600 px-1.5 text-[0.6875rem] font-medium leading-4 text-white">{hiddenOn}</span>
          ) : null}
        </button>
      ) : null}

      {actions ? (
        <div ref={actionsRef} className="flex shrink-0 items-center gap-0.5">
          {actions}
        </div>
      ) : null}
    </div>
  )

  const panel =
    hasMore && open ? (
      <div className={`${bare ? '' : 'rounded-b-xl '}border-t border-gray-100 bg-gray-50/70 px-3 py-4 sm:px-4`}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 [&>*]:min-w-0">
          {hidden.map((item) => (
            <div key={item.key} className="contents">
              {item.panel}
            </div>
          ))}
        </div>
        <div className="mt-4 flex items-center justify-between gap-3 text-xs text-gray-500">
          <span>{hiddenOn <= 0 ? 'No filters on' : hiddenOn === 1 ? '1 filter active' : `${hiddenOn} filters active`}</span>
          {anyActive ? (
            <button
              type="button"
              onClick={onReset}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 font-medium text-blue-700 hover:bg-blue-50"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
              Reset filters
            </button>
          ) : null}
        </div>
      </div>
    ) : null

  if (bare) {
    return (
      <div className="border-b border-gray-200">
        {row}
        {panel}
      </div>
    )
  }
  return (
    <section className="rounded-xl border border-gray-200 bg-white">
      {row}
      {panel}
    </section>
  )
}
