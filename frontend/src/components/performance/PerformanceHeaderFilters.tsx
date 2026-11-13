'use client'

import { Anchor, MapPin } from 'lucide-react'
import { HeaderScopeField } from '@/components/shared/HeaderScopeField'
import {
  PerformanceContractDateControl,
  type PerformanceContractDateOption,
  type PerformancePeriodRange,
} from '@/components/performance/PerformanceContractDateControl'

interface Props<T extends string> {
  period: T
  options: readonly PerformanceContractDateOption<T>[]
  dateFrom: string
  dateTo: string
  onPeriodChange: (value: T) => void
  onDateFromChange: (iso: string) => void
  onDateToChange: (iso: string) => void
  resolvePeriodRange: (period: T) => PerformancePeriodRange
  /** The period is not the default year to date: the field turns blue. */
  dateActive: boolean
  groupPlantOptions: string[]
  selectedGroupPlants: string[]
  onGroupPlantsChange: (values: string[]) => void
  dischargePortOptions: string[]
  selectedDischargePorts: string[]
  onDischargePortsChange: (values: string[]) => void
}

/** The three fields of the performance pages' header (period, Region/Plant, Discharge Port) in the new field look. Put it inside HeaderFilterSlot. */
export function PerformanceHeaderFilters<T extends string>({
  period,
  options,
  dateFrom,
  dateTo,
  onPeriodChange,
  onDateFromChange,
  onDateToChange,
  resolvePeriodRange,
  dateActive,
  groupPlantOptions,
  selectedGroupPlants,
  onGroupPlantsChange,
  dischargePortOptions,
  selectedDischargePorts,
  onDischargePortsChange,
}: Props<T>) {
  return (
    <>
      <PerformanceContractDateControl
        header
        period={period}
        options={options}
        dateFrom={dateFrom}
        dateTo={dateTo}
        onPeriodChange={onPeriodChange}
        onDateFromChange={onDateFromChange}
        onDateToChange={onDateToChange}
        resolvePeriodRange={resolvePeriodRange}
        fieldStyle
        active={dateActive}
      />
      <HeaderScopeField
        label="Region/Plant"
        options={groupPlantOptions}
        selected={selectedGroupPlants}
        onChange={onGroupPlantsChange}
        emptyMessage="No region/plant values"
        icon={<MapPin className="h-4 w-4" />}
        uppercaseOptionLabels
      />
      <HeaderScopeField
        label="Discharge Port"
        options={dischargePortOptions}
        selected={selectedDischargePorts}
        onChange={onDischargePortsChange}
        emptyMessage="No discharge ports"
        icon={<Anchor className="h-4 w-4" />}
        uppercaseOptionLabels
      />
    </>
  )
}
