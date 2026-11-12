'use client'

import type { ReactNode } from 'react'
import { Clock, UserCheck, UserX, Users } from 'lucide-react'
import type { UserSummary } from '@/lib/userDirectory'

function Kpi({ icon, label, value, tone }: { icon: ReactNode; label: string; value: number; tone: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3">
      <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${tone}`} aria-hidden>
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-xs font-medium text-gray-500">{label}</div>
        <div className="text-xl font-semibold tabular-nums text-gray-900">{value.toLocaleString('en-US')}</div>
      </div>
    </div>
  )
}

/** Four counts above the list: everyone, who can sign in, who was invited but has not started, and who is switched off. */
export function UserKpis({ summary }: { summary: UserSummary }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Kpi icon={<Users className="h-4 w-4" />} label="Total users" value={summary.total} tone="bg-blue-50 text-blue-600" />
      <Kpi icon={<UserCheck className="h-4 w-4" />} label="Active" value={summary.active} tone="bg-emerald-50 text-emerald-600" />
      <Kpi icon={<Clock className="h-4 w-4" />} label="Invitation pending" value={summary.pending} tone="bg-amber-50 text-amber-600" />
      <Kpi icon={<UserX className="h-4 w-4" />} label="Inactive" value={summary.inactive} tone="bg-gray-100 text-gray-500" />
    </div>
  )
}
