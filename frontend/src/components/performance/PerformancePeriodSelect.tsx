'use client'

import { StyledNativeSelect } from '@/components/shared/StyledNativeSelect'
import {
  buildPerformancePeriodOptions,
  type PerformancePeriodKey,
} from '@/lib/performancePeriodFilters'

export type PerformancePeriodSelectProps = {
  value: PerformancePeriodKey
  onChange: (value: PerformancePeriodKey) => void
  label?: string
  className?: string
}

export function PerformancePeriodSelect({
  value,
  onChange,
  label = 'Period:',
  className,
}: PerformancePeriodSelectProps) {
  return (
    <StyledNativeSelect
      label={label}
      value={value}
      onChange={onChange}
      options={buildPerformancePeriodOptions()}
      className={className}
      uppercaseLabels
    />
  )
}
