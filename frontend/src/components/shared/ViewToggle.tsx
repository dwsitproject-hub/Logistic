'use client'

import { cn } from '@/lib/utils'

export interface ViewToggleOption<T extends string> {
  value: T
  label: string
}

/**
 * The switch between views of one table (All Shipment / By Vessel, All Oil Loss / By Transporter / By Supplier): the small, flat group of the first
 * Master filter bar, a thin outline with the chosen view in light grey. It sits in the card header's action group, just before the Columns button.
 */
export function ViewToggle<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  disabled = false,
}: {
  options: readonly ViewToggleOption<T>[]
  value: T
  onChange: (value: T) => void
  ariaLabel: string
  disabled?: boolean
}) {
  return (
    <div role="group" aria-label={ariaLabel} className="inline-flex shrink-0 overflow-hidden rounded-lg border border-gray-200 text-xs">
      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            disabled={disabled}
            onClick={() => {
              if (!active) onChange(option.value)
            }}
            className={cn(
              'whitespace-nowrap px-3 py-2 transition-colors disabled:pointer-events-none disabled:opacity-60',
              active ? 'bg-gray-100 font-medium text-gray-900' : 'text-gray-600 hover:bg-gray-50',
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
