'use client'

import type { ReactNode } from 'react'
import { AlertTriangle, Clock, Database, PieChart } from 'lucide-react'
import { SapImportStatusChip } from '@/components/sap-import/SapImportStatusChip'
import { formatSapImportWhen, type SapImportSummary } from '@/lib/sapImportSummary'

function Kpi({ icon, label, value, children }: { icon: ReactNode; label: string; value: ReactNode; children?: ReactNode }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white px-4 py-3">
      <div className="flex items-center gap-1.5 text-xs font-medium text-gray-500">
        <span className="text-gray-400" aria-hidden>
          {icon}
        </span>
        {label}
      </div>
      <div className="mt-1.5 text-2xl font-semibold tabular-nums text-gray-900">{value}</div>
      <div className="mt-1 flex min-h-[1.25rem] flex-wrap items-center gap-1.5 text-xs text-gray-500">{children}</div>
    </div>
  )
}

/** Four numbers above the history: the last import, how big it was, how many rows failed, and how clean the imports usually are. */
export function SapImportKpis({ summary }: { summary: SapImportSummary }) {
  const { latest } = summary
  if (!latest) return null
  const when = formatSapImportWhen(latest.import_timestamp)
  const latestFailed = Number(latest.failed_records) || 0
  const rate = summary.weightedSuccessRate
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Kpi icon={<Clock className="h-3.5 w-3.5" />} label="Last import" value={`${when.day} ${when.time}`}>
        <SapImportStatusChip status={latest.status} />
        <span>{latest.source === 'scheduler' ? 'Scheduler' : 'Manual'}</span>
      </Kpi>
      <Kpi icon={<Database className="h-3.5 w-3.5" />} label="Rows in last import" value={(Number(latest.total_records) || 0).toLocaleString('en-US')}>
        <span>{(Number(latest.processed_records) || 0).toLocaleString('en-US')} processed</span>
      </Kpi>
      <Kpi
        icon={<AlertTriangle className="h-3.5 w-3.5" />}
        label="Failed rows"
        value={<span className={latestFailed > 0 ? 'text-red-600' : undefined}>{latestFailed.toLocaleString('en-US')}</span>}
      >
        <span>
          {summary.recentFailedRows === 0
            ? `none in the last ${summary.recentCount} import${summary.recentCount === 1 ? '' : 's'}`
            : `${summary.recentFailedRows.toLocaleString('en-US')} in the last ${summary.recentCount} import${summary.recentCount === 1 ? '' : 's'}`}
        </span>
      </Kpi>
      <Kpi icon={<PieChart className="h-3.5 w-3.5" />} label="Success rate" value={rate == null ? '—' : `${rate.toFixed(1)}%`}>
        <span>{rate == null ? 'no finished import yet' : `rows imported, last ${summary.finishedCount} import${summary.finishedCount === 1 ? '' : 's'}`}</span>
      </Kpi>
    </div>
  )
}
