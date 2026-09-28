'use client'

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

export type ClaimSusutUploadResult = {
  totalRows: number
  insertedRows: number
  failedRows: number
  errors: { rowIndex: number; message: string; sheet?: string }[]
  /** The outstanding sheet actually read - OS_CLAIM, never simply the first sheet. */
  sheetName?: string | null
  periodLabel?: string | null
  /** REAL_CLAIM is optional: read when the workbook has it, for the realisation dashboard. */
  realSheetName?: string | null
  realPeriodLabel?: string | null
  realTotalRows?: number
  realInsertedRows?: number
  realWarning?: string | null
}

export function ClaimSusutUploadResultDialog({
  open,
  onOpenChange,
  result,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  result: ClaimSusutUploadResult | null
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[88vh] overflow-y-auto" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>Shortage Claim upload result</DialogTitle>
        </DialogHeader>
        {result ? (
          <div className="space-y-4 text-sm">
            {result.sheetName ? (
              <p className="text-xs text-gray-500">
                Outstanding dari sheet <span className="font-medium text-gray-700">{result.sheetName}</span>
                {result.periodLabel ? <> · Periode {result.periodLabel}</> : null}
              </p>
            ) : null}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
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
              <div className="rounded-md border bg-red-50 px-3 py-2">
                <div className="text-xs text-muted-foreground">Failed</div>
                <div className="text-lg font-semibold tabular-nums text-red-800">
                  {result.failedRows.toLocaleString()}
                </div>
              </div>
            </div>
            {result.realSheetName ? (
              <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                Realisasi dari sheet <span className="font-medium">{result.realSheetName}</span>:{' '}
                <span className="font-semibold tabular-nums">{(result.realInsertedRows ?? 0).toLocaleString()}</span> dari{' '}
                <span className="tabular-nums">{(result.realTotalRows ?? 0).toLocaleString()}</span> klaim
                {result.realPeriodLabel ? <> · Periode {result.realPeriodLabel}</> : null}
              </div>
            ) : result.realWarning ? (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                {result.realWarning}. Data outstanding tetap diimpor.
              </div>
            ) : result.sheetName ? (
              <div className="rounded-md border bg-slate-50 px-3 py-2 text-xs text-gray-600">
                File ini tidak menyertakan sheet REAL_CLAIM - hanya data outstanding yang diimpor.
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
