'use client'

import type { ReactNode } from 'react'
import { SearchableMultiSelect } from '@/components/SearchableMultiSelect'
import { listFilterButtonClass } from '@/components/shared/ListFilterBar'

export interface ValueOption {
  value: string
  label: string
}

/**
 * A filter that takes one value, in the same field as the multi-selects (search box, tinted blue when on): nothing chosen is "all".
 * `options` still holds the "All ..." entry; it is left out of the list and is what the empty field shows.
 */
export function SingleValueField({
  label,
  options,
  value,
  onChange,
  icon,
  wrapperClass,
}: {
  label: string
  options: readonly ValueOption[]
  value: string
  onChange: (value: string) => void
  icon: ReactNode
  wrapperClass?: string
}) {
  const allOption = options[0]
  const choices = options.slice(1)
  const current = choices.find((option) => option.value === value)
  return (
    <div className={wrapperClass}>
      <SearchableMultiSelect
        label={label}
        hideLabel
        options={choices.map((option) => option.label)}
        selected={current ? [current.label] : []}
        onChange={(labels) => {
          const next = choices.find((option) => option.label === labels[0])
          onChange(next ? next.value : allOption.value)
        }}
        placeholder={allOption.label}
        emptyMessage="No options"
        icon={icon}
        fieldStyle
        singleSelect
        className="w-full"
        buttonClassName={listFilterButtonClass(current != null)}
      />
    </div>
  )
}

export function MultiValueField({
  label,
  options,
  selected,
  onChange,
  placeholder,
  emptyMessage,
  icon,
  uppercase = false,
}: {
  label: string
  options: string[]
  selected: string[]
  onChange: (values: string[]) => void
  placeholder: string
  emptyMessage: string
  icon: ReactNode
  /** Show the options in capitals (display only). */
  uppercase?: boolean
}) {
  return (
    <SearchableMultiSelect
      label={label}
      hideLabel
      options={options}
      selected={selected}
      onChange={onChange}
      placeholder={placeholder}
      emptyMessage={emptyMessage}
      pinSelectedToTop
      uppercaseOptionLabels={uppercase}
      icon={icon}
      fieldStyle
      className="w-full"
      buttonClassName={listFilterButtonClass(selected.length > 0)}
    />
  )
}
