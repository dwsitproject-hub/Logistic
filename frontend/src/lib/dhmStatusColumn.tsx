import type { ReactNode } from 'react'
import { DhmStatusBadge } from '@/components/shared/DhmStatusBadge'
import { masterVesselDhmStatusLabel } from '@/lib/masterVesselDhmStatus'

type DhmStatusRow = {
  dhm_id?: string | null
  dhm_code?: string | null
  code_dhm?: string | null
}

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
