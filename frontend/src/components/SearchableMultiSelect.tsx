'use client'

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { stitchControlClass, useStitchFields } from '@/components/shared/stitchField'
import { isBlankFilterOption, sortFilterOptionsWithSelectedFirst } from '@/lib/globalScopeFilters'
import { computeMultiSelectMenuBox, establishesFixedContainingBlock } from '@/lib/multiSelectMenuPlacement'

// Searchable multi-select dropdown (type to filter, multiple selection with OR).
// Copied from Dashboard to keep Plant/Site and Incoterm UX consistent.
export function SearchableMultiSelect({
  label,
  options,
  selected = [],
  onChange,
  placeholder,
  emptyMessage = 'Loading...',
  /** When true, selected values appear at the top of the list (for plotted Product / Group Plant). */
  pinSelectedToTop = false,
  /** Display-only: uppercase the option labels (underlying value/filtering stays unchanged). */
  uppercaseOptionLabels = false,
  labelClassName,
  hideLabel = false,
  buttonClassName,
  portalMenu: _portalMenu = false,
  className,
}: {
  label: string
  options: string[]
  selected?: string[]
  onChange: (value: string[]) => void
  placeholder: string
  emptyMessage?: string
  pinSelectedToTop?: boolean
  uppercaseOptionLabels?: boolean
  labelClassName?: string
  hideLabel?: boolean
  buttonClassName?: string
  /** Kept for callers. Menus always render above clipping parents. */
  portalMenu?: boolean
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const stitch = useStitchFields()
  const containerRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [menuBox, setMenuBox] = useState<{
    top: number
    left: number
    width: number
    listMaxHeight: number
  } | null>(null)
  /**
   * Where the menu is portaled. document.body normally; the surrounding dialog when the trigger sits in one. A Radix Dialog traps focus,
   * so a search box outside it is pulled back out of focus as soon as it gets it and typing never arrives (clicks still worked, so
   * only Search looked broken). See lib/multiSelectMenuPlacement.ts.
   */
  const [menuHost, setMenuHost] = useState<HTMLElement | null>(null)

  const orderedOptions = useMemo(() => {
    const withoutBlank = options.filter((option) => !isBlankFilterOption(option))
    return pinSelectedToTop ? sortFilterOptionsWithSelectedFirst(withoutBlank, selected) : withoutBlank
  }, [options, selected, pinSelectedToTop])

  const filtered = search.trim()
    ? orderedOptions.filter((o) => o.toLowerCase().includes(search.toLowerCase().trim()))
    : orderedOptions

  useEffect(() => {
    if (!open) return
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Node
      if (containerRef.current?.contains(target) || menuRef.current?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [open])

  useLayoutEffect(() => {
    if (!open) {
      setMenuBox(null)
      return
    }
    const place = () => {
      const triggerEl = containerRef.current
      const trigger = triggerEl?.getBoundingClientRect()
      if (!triggerEl || !trigger) return
      const dialog = triggerEl.closest<HTMLElement>('[role="dialog"]')
      setMenuHost(dialog)
      // Only a transformed dialog (Radix centres it with one) re-bases `position: fixed`; a plain one measures from the viewport.
      const rebasing = dialog != null && establishesFixedContainingBlock(window.getComputedStyle(dialog))
      const dialogRect = rebasing ? dialog.getBoundingClientRect() : null
      setMenuBox(
        computeMultiSelectMenuBox({
          trigger,
          viewport: { width: window.innerWidth, height: window.innerHeight },
          containingBlock:
            dialog && dialogRect
              ? { ...dialogRect, borderLeft: dialog.clientLeft, borderTop: dialog.clientTop }
              : null,
        }),
      )
    }
    place()
    const onScroll = (event: Event) => {
      const target = event.target
      if (target instanceof Node && menuRef.current?.contains(target)) return
      place()
    }
    window.addEventListener('resize', place)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [open])

  const toggle = (value: string) => {
    if (selected.includes(value)) onChange(selected.filter((s) => s !== value))
    else onChange([...selected, value])
  }

  const clearSelection = (e: React.MouseEvent) => {
    e.stopPropagation()
    onChange([])
  }

  const loneSelection = selected.length === 1 ? selected[0] : ''
  const displayLabel =
    selected.length === 0
      ? placeholder
      : selected.length === 1
        ? uppercaseOptionLabels
          ? loneSelection.toUpperCase()
          : loneSelection
        : `${selected.length} selected (OR)`

  const menuBody = (
    <>
      <div className="p-2 border-b border-gray-100">
        <Input
          type="text"
          placeholder="Type to search..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-9 text-sm"
          autoFocus
        />
      </div>
      <div
        className="overflow-y-auto overscroll-contain p-1"
        data-scroll-lock-scrollable=""
        style={{ maxHeight: menuBox?.listMaxHeight ?? 224 }}
        onWheel={(event) => event.stopPropagation()}
      >
        {options.length === 0 ? (
          <div className="py-4 text-center text-sm text-gray-500">{emptyMessage}</div>
        ) : filtered.length === 0 ? (
          <div className="py-4 text-center text-sm text-gray-500">No matches</div>
        ) : (
          filtered.map((option) => (
            <label
              key={option}
              className="flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer hover:bg-gray-100 text-sm"
            >
              <input
                type="checkbox"
                checked={selected.includes(option)}
                onChange={() => toggle(option)}
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className={`truncate${uppercaseOptionLabels ? ' uppercase' : ''}`}>{option}</span>
            </label>
          ))
        )}
      </div>
      {selected.length > 0 && (
        <div className="p-2 border-t border-gray-100">
          <button type="button" onClick={clearSelection} className="text-xs text-blue-600 hover:underline">
            Clear selection
          </button>
        </div>
      )}
    </>
  )

  return (
    <div ref={containerRef} className={`${_portalMenu ? 'relative w-44 shrink-0' : 'relative min-w-0 w-full'} ${className ?? ''}`.trim()}>
      {!hideLabel && label ? (
        <label className={labelClassName ?? 'text-sm font-medium text-gray-700 mb-1 block'}>{label}</label>
      ) : null}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={label}
        className={stitchControlClass(
          buttonClassName ??
            'w-full flex items-center justify-between gap-2 h-10 px-3 py-2 text-left text-sm border border-gray-300 rounded-md bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1',
          stitch,
        )}
      >
        <span className={`truncate ${selected.length === 0 ? 'text-gray-500' : 'text-gray-900'}`}>{displayLabel}</span>
        <ChevronDown className={`h-4 w-4 text-gray-500 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && menuBox
        ? createPortal(
            <div
              ref={menuRef}
              data-klip-multiselect-menu=""
              data-scroll-lock-scrollable=""
              className={stitchControlClass(
                'fixed z-[80] pointer-events-auto rounded-md border border-gray-200 bg-white shadow-lg',
                stitch,
              )}
              style={{
                top: menuBox?.top ?? 0,
                left: menuBox?.left ?? 0,
                width: menuBox?.width ?? 220,
              }}
              onWheel={(event) => event.stopPropagation()}
              onPointerDown={(event) => event.stopPropagation()}
            >
              {menuBody}
            </div>,
            menuHost ?? document.body,
          )
        : null}
    </div>
  )
}

