'use client'

import type { ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { stitchControlClass, useStitchFields } from '@/components/shared/stitchField'

export interface FilterSingleSelectOption {
  value: string
  label: string
}

export interface FilterSingleSelectProps {
  value: string
  onChange: (value: string) => void
  options: readonly FilterSingleSelectOption[]
  ariaLabel: string
  className?: string
  /** A small icon in front of the text. */
  icon?: ReactNode
  /** The dense field look of the Contracts filters (36px, rounder, blue when `active`). */
  dense?: boolean
  /** The filter is narrowing the list (dense look only). */
  active?: boolean
}

/** Single-select dropdown styled like SearchableMultiSelect (ChevronDown trigger). */
export function FilterSingleSelect({
  value,
  onChange,
  options,
  ariaLabel,
  className,
  icon,
  dense = false,
  active = false,
}: FilterSingleSelectProps) {
  const stitch = useStitchFields()
  return (
    <div className={cn('relative min-w-[10rem]', className)}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={ariaLabel}
        className={stitchControlClass(
          dense
            ? cn(
                'h-9 w-full appearance-none rounded-[10px] border py-0 pr-8 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1',
                icon ? 'pl-9' : 'pl-3',
                active ? 'border-blue-400 bg-blue-50 text-blue-700' : 'border-gray-300 bg-white text-gray-900 hover:bg-gray-50',
              )
            : 'h-10 w-full appearance-none rounded-md border border-gray-300 bg-white py-2 pl-3 pr-9 text-sm text-gray-900 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1',
          stitch,
        )}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      {icon ? (
        <span className={cn('pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2', active ? 'text-blue-600' : 'text-gray-400')} aria-hidden>
          {icon}
        </span>
      ) : null}
      <ChevronDown
        className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500"
        aria-hidden
      />
    </div>
  )
}
