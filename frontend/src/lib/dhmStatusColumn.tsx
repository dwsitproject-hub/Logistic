import type { ReactNode } from 'react'
import { DhmStatusBadge } from '@/components/shared/DhmStatusBadge'
import { masterVesselDhmStatusLabel, type DhmStatusRow } from '@/lib/masterVesselDhmStatus'

export function dhmStatusListColumn<T extends DhmStatusRow>(): {
  id: string
  label: string
  widthPx: number
  getText: (row: T) => string
  render: (row: T) => ReactNode
} {
  return {
    id: 'dhm_status',
    label: 'DHM Status',
    widthPx: 108,
    getText: (row) => masterVesselDhmStatusLabel(row),
    render: (row) => <DhmStatusBadge row={row} />,
  }
}
