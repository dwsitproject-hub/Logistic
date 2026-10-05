'use client'

import {
  dhmStatusHint,
  masterVesselDhmStatusLabel,
  type DhmStatusLabel,
  type DhmStatusRow,
} from '@/lib/masterVesselDhmStatus'

const TONE: Record<DhmStatusLabel, string> = {
  Sync: 'bg-blue-100 text-blue-800',
  'Not Sync': 'bg-red-100 text-red-800',
  // Linked to DHM, but the last change did not reach it: the row differs from DHM until the retry succeeds.
  'Sync Failed': 'bg-amber-100 text-amber-900',
  // DHM already holds something different under this name or code; a person has to choose.
  Conflict: 'bg-orange-100 text-orange-900',
}

export function DhmStatusBadge({ row }: { row: DhmStatusRow }) {
  const label = masterVesselDhmStatusLabel(row)
  return (
    <span
      className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${TONE[label]}`}
      title={dhmStatusHint(row) || undefined}
    >
      {label}
    </span>
  )
}
