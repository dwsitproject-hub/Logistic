'use client'

import type { ReactNode } from 'react'
import { AlertTriangle, Clock, PieChart, Scale } from 'lucide-react'
import { SapImportStatusChip } from '@/components/sap-import/SapImportStatusChip'
import { formatSapImportWhen } from '@/lib/sapImportSummary'
import { wbImportStatusMeta, wbImportUploaderLabel, type WbImportSummary } from '@/lib/wbDataSummary'

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

const n = (value: unknown) => (Number(value) || 0).toLocaleString('en-US')

/** Four numbers above the history: the last upload and who made it, what it wrote, what failed, and how clean the uploads usually are. */
export function WbDataKpis({ summary }: { summary: WbImportSummary }) {
  const { latest } = summary
  if (!latest) return null
  const when = formatSapImportWhen(latest.created_at)
  const failed = Number(latest.operations_failed) || 0
  const rate = summary.weightedOperationRate
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Kpi icon={<Clock className="h-3.5 w-3.5" />} label="Last upload" value={`${when.day} ${when.time}`}>
        <SapImportStatusChip status={latest.status} meta={wbImportStatusMeta(latest)} />
        <span>by {wbImportUploaderLabel(latest)}</span>
      </Kpi>
      <Kpi icon={<Scale className="h-3.5 w-3.5" />} label="Rows written in last upload" value={n(latest.rows_upserted)}>
        <span>
          {n(latest.operations_updated)} operations · {n(latest.raw_ticket_rows)} ticket rows
        </span>
      </Kpi>
      <Kpi
        icon={<AlertTriangle className="h-3.5 w-3.5" />}
        label="Failed operations"
        value={<span className={failed > 0 ? 'text-red-600' : undefined}>{n(failed)}</span>}
      >
        <span>
          {summary.recentFailedOperations === 0
            ? `none in the last ${summary.recentCount} upload${summary.recentCount === 1 ? '' : 's'}`
            : `${n(summary.recentFailedOperations)} in the last ${summary.recentCount} upload${summary.recentCount === 1 ? '' : 's'}`}
        </span>
      </Kpi>
      <Kpi icon={<PieChart className="h-3.5 w-3.5" />} label="Operations written" value={rate == null ? '—' : `${rate.toFixed(1)}%`}>
        <span>
          {rate == null
            ? 'no upload had an operation yet'
            : `${summary.count} upload${summary.count === 1 ? '' : 's'} · ${summary.uploaderCount} ${summary.uploaderCount === 1 ? 'person' : 'people'}`}
        </span>
      </Kpi>
    </div>
  )
}
