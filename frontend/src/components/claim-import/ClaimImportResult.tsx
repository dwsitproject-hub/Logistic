'use client'

import type { ReactNode } from 'react'
import { CheckCircle2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ClaimKindIcon } from '@/components/claim-import/ClaimKindIcon'
import { CLAIM_KIND_LABEL, type ClaimImportResultData } from '@/lib/claimDataImportView'

const nf = new Intl.NumberFormat('en-US')

function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: 'bad' | 'warn' }) {
  const color = tone === 'bad' ? 'text-red-700' : tone === 'warn' ? 'text-amber-700' : 'text-gray-900'
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-2">
      <p className="text-[0.6875rem] font-medium text-gray-500">{label}</p>
      <p className={`text-base font-semibold tabular-nums ${color}`}>{typeof value === 'number' ? nf.format(value) : value}</p>
    </div>
  )
}

/** What an import did: the counts, and in full anything that needs a person (warnings, rows that could not be saved). */
export function ClaimImportResult({ result, fileName, onDismiss }: { result: ClaimImportResultData; fileName: string; onDismiss: () => void }) {
  const matchedPct = result.totalRows > 0 ? ((result.b2b + result.direct) / result.totalRows) * 100 : 0
  const hasProblems = result.failedRows > 0
  return (
    <section
      className={`rounded-xl border bg-white p-4 ${hasProblems ? 'border-amber-300' : 'border-emerald-200'}`}
      aria-label="Import result"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <CheckCircle2 className={`h-5 w-5 shrink-0 ${hasProblems ? 'text-amber-500' : 'text-emerald-500'}`} aria-hidden />
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-sm font-semibold text-gray-900">
              Import finished
              <ClaimKindIcon kind={result.kind} size="sm" />
              <span className="font-normal text-gray-500">{CLAIM_KIND_LABEL[result.kind]}</span>
            </p>
            <p className="truncate text-xs text-gray-500" title={fileName}>
              {fileName}
            </p>
          </div>
        </div>
        <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-gray-400" onClick={onDismiss} aria-label="Dismiss the result">
          <X className="h-4 w-4" aria-hidden />
        </Button>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Rows read" value={result.totalRows} />
        <Stat label="Shortage Claim (SUSUT)" value={result.susutRows} />
        <Stat label="Quality Claim (MUTU)" value={result.mutuRows} />
        <Stat label="Failed rows" value={result.failedRows} tone={result.failedRows > 0 ? 'bad' : undefined} />
        <Stat label="Inserted" value={result.insertedRows} />
        <Stat label={result.kind === 'real' ? 'Replaced (same CR no.)' : 'Replaced'} value={result.replacedRows} />
        <Stat label="B2B / Direct" value={`${nf.format(result.b2b)} / ${nf.format(result.direct)}`} />
        <Stat
          label="Unmatched B2B status"
          value={`${nf.format(result.unmatched)} (${(100 - matchedPct).toFixed(1)}%)`}
          tone={result.unmatched > 0 ? 'warn' : undefined}
        />
      </div>

      {result.unmatched > 0 ? (
        <p className="mt-3 text-xs text-amber-700">
          Unmatched rows are claims whose PO was not found in the Logistics Report. They stay in the totals and can be filtered as &quot;Unmatched&quot;.
        </p>
      ) : null}
      {result.warnings.length > 0 ? (
        <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          <p className="mb-1 font-semibold">Warnings</p>
          <ul className="list-disc space-y-0.5 pl-4">
            {result.warnings.map((warning, index) => (
              <li key={index}>{warning}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {result.errors.length > 0 ? (
        <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-800">
          <p className="mb-1 font-semibold">Rows that could not be saved ({result.errors.length})</p>
          <ul className="max-h-40 list-disc space-y-0.5 overflow-auto pl-4">
            {result.errors.slice(0, 50).map((error, index) => (
              <li key={index}>
                {error.sheet ? `${error.sheet} · ` : ''}row {error.rowIndex}: {error.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  )
}
