'use client'

import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'

export type ClaimMutuUploadResult = {
  totalRows: number
  insertedRows: number
  failedRows: number
  /** OS rows marked B2B: in the Include sheet, not in the Exclude sheet. */
  b2bRows: number
  errors: { rowIndex: number; message: string; sheet?: string }[]
  sheetName?: string | null
  periodLabel?: string | null
  /** 'inc+exc' when both OS sheets were read and B2B is known; otherwise a warning explains. */
  b2bSource?: string | null
  realSheetName?: string | null
  realPeriodLabel?: string | null
  realTotalRows?: number
  realInsertedRows?: number
  realB2bRows?: number
  warnings: string[]
}

export function ClaimMutuUploadResultDialog({
  open,
  onOpenChange,
  result,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  result: ClaimMutuUploadResult | null
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[88vh] overflow-y-auto" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>Claim Mutu upload result</DialogTitle>
        </DialogHeader>
        {result ? (
          <div className="space-y-4 text-sm">
            {result.sheetName ? (
              <p className="text-xs text-gray-500">
                Outstanding from sheet <span className="font-medium text-gray-700">{result.sheetName}</span>
                {result.periodLabel ? <> · Period {result.periodLabel}</> : null}
              </p>
            ) : null}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <div className="rounded-md border bg-slate-50 px-3 py-2">
                <div className="text-xs text-muted-foreground">Processed</div>
                <div className="text-lg font-semibold tabular-nums">{result.totalRows.toLocaleString()}</div>
              </div>
              <div className="rounded-md border bg-green-50 px-3 py-2">
                <div className="text-xs text-muted-foreground">Succeeded</div>
                <div className="text-lg font-semibold tabular-nums text-green-800">
                  {result.insertedRows.toLocaleString()}
                </div>
              </div>
              <div className="rounded-md border bg-indigo-50 px-3 py-2">
                <div className="text-xs text-muted-foreground">Marked B2B</div>
                <div className="text-lg font-semibold tabular-nums text-indigo-800">{result.b2bRows.toLocaleString()}</div>
              </div>
              <div className="rounded-md border bg-red-50 px-3 py-2">
                <div className="text-xs text-muted-foreground">Failed</div>
                <div className="text-lg font-semibold tabular-nums text-red-800">
                  {result.failedRows.toLocaleString()}
                </div>
              </div>
            </div>
            {result.b2bSource === 'inc+exc' ? (
              <p className="text-xs text-gray-500">
                Every Include B2B row is stored; rows missing from the Exclude B2B sheet are marked B2B. The page
                shows Exclude B2B by default.
              </p>
            ) : null}
            {result.realSheetName ? (
              <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                Realised claims from sheet <span className="font-medium">{result.realSheetName}</span>:{' '}
                <span className="font-semibold tabular-nums">{(result.realInsertedRows ?? 0).toLocaleString()}</span> of{' '}
                <span className="tabular-nums">{(result.realTotalRows ?? 0).toLocaleString()}</span> claims
                {result.realB2bRows ? <>, {result.realB2bRows.toLocaleString()} marked B2B</> : null}
                {result.realPeriodLabel ? <> · Period {result.realPeriodLabel}</> : null}
              </div>
            ) : result.sheetName ? (
              <div className="rounded-md border bg-slate-50 px-3 py-2 text-xs text-gray-600">
                This file has no Real_Claim sheet - only the outstanding data was imported.
              </div>
            ) : null}
            {result.warnings.length > 0 ? (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 space-y-1">
                {result.warnings.map((w, i) => (
                  <div key={i}>{w}</div>
                ))}
              </div>
            ) : null}
            {result.errors.length > 0 ? (
              <div>
                <div className="font-medium text-gray-900 mb-2">Failed rows</div>
                <div className="overflow-x-auto max-h-64 border rounded-md">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-100">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium text-gray-600">Sheet</th>
                        <th className="px-3 py-2 text-left font-medium text-gray-600">Excel Row</th>
                        <th className="px-3 py-2 text-left font-medium text-gray-600">Reason</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {result.errors.slice(0, 200).map((e, idx) => (
                        <tr key={`${e.rowIndex}-${idx}`}>
                          <td className="px-3 py-2">{e.sheet ?? result.sheetName ?? '-'}</td>
                          <td className="px-3 py-2 tabular-nums">{e.rowIndex}</td>
                          <td className="px-3 py-2">{e.message}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {result.errors.length > 200 ? (
                  <p className="text-xs text-muted-foreground mt-2">
                    Showing 200 of {result.errors.length.toLocaleString()} failed rows.
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
