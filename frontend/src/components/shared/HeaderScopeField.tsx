'use client'

import type { ReactNode } from 'react'
import { SearchableMultiSelect } from '@/components/SearchableMultiSelect'
import { listFilterButtonClass } from '@/components/shared/ListFilterBar'

/**
 * A scope field of the page header (Region/Plant, Discharge Port): the 11rem field of the new look, with an icon, a placeholder that names it, and
 * a blue tint with "first +n" once something is chosen. Put it next to the period control inside HeaderFilterSlot.
 */
export function HeaderScopeField({
  label,
  options,
  selected,
  onChange,
  emptyMessage,
  icon,
  uppercaseOptionLabels = false,
}: {
  label: string
  options: string[]
  selected: string[]
  onChange: (values: string[]) => void
  emptyMessage: string
  icon: ReactNode
  uppercaseOptionLabels?: boolean
}) {
  return (
    <SearchableMultiSelect
      label={label}
      hideLabel
      portalMenu
      icon={icon}
      fieldStyle
      buttonClassName={listFilterButtonClass(selected.length > 0)}
      options={options}
      selected={selected}
      onChange={onChange}
      placeholder={label}
      emptyMessage={emptyMessage}
      uppercaseOptionLabels={uppercaseOptionLabels}
    />
  )
}
