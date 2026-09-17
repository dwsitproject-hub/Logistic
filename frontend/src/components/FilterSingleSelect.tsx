'use client'

import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

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
}

/** Single-select dropdown styled like SearchableMultiSelect (ChevronDown trigger). */
export function FilterSingleSelect({
  value,
  onChange,
  options,
  ariaLabel,
  className,
}: FilterSingleSelectProps) {
  return (
    <div className={cn('relative min-w-[10rem]', className)}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={ariaLabel}
        className="h-10 w-full appearance-none rounded-md border border-gray-300 bg-white py-2 pl-3 pr-9 text-sm text-gray-900 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      <ChevronDown
        className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500"
        aria-hidden
      />
    </div>
  )
}
