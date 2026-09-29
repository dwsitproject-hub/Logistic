'use client'

import { masterVesselDhmStatusLabel } from '@/lib/masterVesselDhmStatus'

export function DhmStatusBadge({
  row,
}: {
  row: { dhm_id?: string | null; dhm_code?: string | null; code_dhm?: string | null }
}) {
  const synced = masterVesselDhmStatusLabel(row) === 'Sync'
  const code = String(row.code_dhm || row.dhm_code || '').trim()
  return (
    <span
      className={
        synced
          ? 'inline-flex shrink-0 items-center whitespace-nowrap rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800'
          : 'inline-flex shrink-0 items-center whitespace-nowrap rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800'
      }
      title={code ? `DHM: ${code}` : undefined}
    >
      {synced ? 'Sync' : 'Not Sync'}
    </span>
  )
}
