'use client'

import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

export type StyledNativeSelectOption<T extends string = string> = {
  value: T
  label: string
}

export type StyledNativeSelectProps<T extends string = string> = {
  label?: string
  value: T
  onChange: (value: T) => void
  options: readonly StyledNativeSelectOption<T>[]
  className?: string
  selectClassName?: string
  minWidthClassName?: string
  inlineLabel?: boolean
  /** Display-only: uppercase option labels in the closed select and dropdown. */
  uppercaseLabels?: boolean
}

export const STYLED_NATIVE_SELECT_TRIGGER_CLASS =
  'h-10 w-full appearance-none rounded-md border border-gray-300 bg-white pl-3 pr-9 py-2 text-sm text-gray-900 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 [&::-ms-expand]:hidden'

export function StyledNativeSelect<T extends string = string>({
  label,
  value,
  onChange,
  options,
  className,
  selectClassName,
  minWidthClassName = 'min-w-[160px]',
  inlineLabel = true,
  uppercaseLabels = false,
}: StyledNativeSelectProps<T>) {
  const control = (
    <div className={cn('relative', minWidthClassName, className)}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className={cn(STYLED_NATIVE_SELECT_TRIGGER_CLASS, uppercaseLabels && 'uppercase', selectClassName)}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      <ChevronDown
        className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 shrink-0 text-gray-500"
        aria-hidden
      />
    </div>
  )

  if (!label) return control

  if (inlineLabel) {
    return (
      <div className="flex items-center gap-3">
        <span className="text-sm font-medium text-gray-700 shrink-0">{label}</span>
        {control}
      </div>
    )
  }

  return (
    <div>
      <span className="text-sm font-medium text-gray-700 mb-1 block">{label}</span>
      {control}
    </div>
  )
}
