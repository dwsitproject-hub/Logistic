'use client'

import type { ReactNode } from 'react'
import { CalendarClock, Clock, FileSpreadsheet, RefreshCw } from 'lucide-react'
import { ClaimKindIcon, CLAIM_KIND_LOOK } from '@/components/claim-import/ClaimKindIcon'
import { formatSapImportWhen } from '@/lib/sapImportSummary'
import { formatDateDMY } from '@/lib/dateFormat'
import { describeClaimAutoRun, describeDailyCron } from '@/lib/claimDataImportView'
import type { ClaimAutoImportStatus, ClaimKindCount, ClaimStatusSummary } from '@/lib/claimDataImportView'

const nf = new Intl.NumberFormat('en-US')

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

function KindKpi({ kind, label, count }: { kind: 'os' | 'real'; label: string; count: ClaimKindCount }) {
  const { Icon } = CLAIM_KIND_LOOK[kind]
  return (
    <Kpi icon={<Icon className="h-3.5 w-3.5" />} label={label} value={count.imported ? nf.format(count.total) : '-'}>
      {count.imported ? (
        <span>
          Shortage {nf.format(count.shortage)} · Quality {nf.format(count.quality)}
        </span>
      ) : (
        <span>Not imported yet</span>
      )}
    </Kpi>
  )
}

/** Four cards above the import area: the last import, what is outstanding, the date the outstanding snapshot is as of, and the state of the daily auto-import. */
export function ClaimImportKpis({ summary, auto }: { summary: ClaimStatusSummary; auto: ClaimAutoImportStatus | null }) {
  const lastRun = auto?.runs?.[0] ?? null
  const last = summary.lastImport
  const when = last ? formatSapImportWhen(last.uploadedAt) : null
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Kpi icon={<Clock className="h-3.5 w-3.5" />} label="Last import" value={when ? `${when.day} ${when.time}` : '-'}>
        {last ? (
          <span className="flex w-full min-w-0 items-center gap-1.5">
            <ClaimKindIcon kind={last.kind} size="sm" />
            <span className="flex min-w-0 items-center gap-1" title={last.fileName}>
              <FileSpreadsheet className="h-3 w-3 shrink-0 text-gray-400" aria-hidden />
              <span className="truncate">{last.fileName}</span>
            </span>
          </span>
        ) : (
          <span>No import yet</span>
        )}
      </Kpi>
      <KindKpi kind="os" label="Outstanding claims" count={summary.os} />
      <Kpi
        icon={<CalendarClock className="h-3.5 w-3.5" />}
        label="Outstanding data as of"
        value={summary.dataAsOf ? formatDateDMY(summary.dataAsOf) : '-'}
      >
        {summary.dataAsOfDaysAgo != null ? (
          <span>{summary.dataAsOfDaysAgo === 0 ? 'today' : `${summary.dataAsOfDaysAgo} day${summary.dataAsOfDaysAgo === 1 ? '' : 's'} ago`}</span>
        ) : (
          <span>-</span>
        )}
      </Kpi>
      <Kpi
        icon={<RefreshCw className="h-3.5 w-3.5" />}
        label="Auto-import"
        value={auto ? (auto.cronEnabled ? 'On' : 'Off') : '-'}
      >
        {auto ? (
          <span>
            {auto.cronEnabled ? `Runs ${describeDailyCron(auto.cron)}` : 'Switched off on this server'}
            {lastRun ? ` · last: ${describeClaimAutoRun(lastRun).label.toLowerCase()}` : ''}
          </span>
        ) : (
          <span>-</span>
        )}
      </Kpi>
    </div>
  )
}
