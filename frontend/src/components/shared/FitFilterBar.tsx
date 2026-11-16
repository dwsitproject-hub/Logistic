'use client'

import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { SlidersHorizontal, X } from 'lucide-react'

/** One filter of a FitFilterBar, in priority order: the first ones are the last to move behind More filters. */
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
}

interface Props {
  items: FitItem[]
  /** True when anything (the header fields included) narrows the page, so Reset shows. */
  anyActive: boolean
  onReset: () => void
  /** Icon buttons at the right end of the row. */
  actions?: ReactNode
}

const GAP_REM = 0.5
const RESET_REM = 2.25
const MORE_WIDE_REM = 7.75
const MORE_NARROW_REM = 3.25

/**
 * The filter row of a list without a search box (Shipping and Contract Performance, the claim pages). It measures its own width and shows as many
 * filters as really fit, in priority order; the rest wait behind a More filters button, which carries a count of the ones that are on and disappears
 * when everything fits. Nothing here depends on the screen's breakpoints, so a wide window never leaves a filter behind while there is room for it.
 */
export function FitFilterBar({ items, anyActive, onReset, actions }: Props) {
  const rowRef = useRef<HTMLDivElement>(null)
  const actionsRef = useRef<HTMLDivElement>(null)
  const [fitCount, setFitCount] = useState(items.length)
  const [open, setOpen] = useState(false)
  const widthsKey = items.map((item) => `${item.key}:${item.width}`).join('|')

  useLayoutEffect(() => {
    const el = rowRef.current
    if (!el) return
    const widths = widthsKey.split('|').map((part) => Number(part.split(':')[1]))
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
        let n = 0
        for (const w of widths) {
          const need = w * rootPx + (n > 0 ? gap : 0)
          if (used + need > inner - reserved) break
          used += need
          n += 1
        }
        return n
      }
      const all = fit(actionsW + resetW)
      setFitCount(all === widths.length ? all : fit(actionsW + resetW + moreW))
    }
    compute()
    const observer = new ResizeObserver(compute)
    observer.observe(el)
    return () => observer.disconnect()
    // the Reset button appearing or going changes the room, so anyActive is a dependency too
  }, [widthsKey, actions, anyActive])

  const shown = items.slice(0, fitCount)
  const hidden = items.slice(fitCount)
  const hiddenOn = hidden.filter((item) => item.active).length
  const hasMore = hidden.length > 0

  return (
    <section className="rounded-xl border border-gray-200 bg-white">
      <div ref={rowRef} className="flex flex-nowrap items-center gap-2 px-3 py-3 sm:px-4">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {shown.map((item) => (
            <div key={item.key} style={{ flex: `1 1 ${item.width}rem`, minWidth: `${item.width}rem`, maxWidth: '20rem' }}>
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

      {hasMore && open ? (
        <div className="rounded-b-xl border-t border-gray-100 bg-gray-50/70 px-3 py-4 sm:px-4">
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
      ) : null}
    </section>
  )
}
