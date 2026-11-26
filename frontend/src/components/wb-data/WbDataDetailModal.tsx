'use client'

import React, { useEffect, useState, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { SapImportStatusChip } from '@/components/sap-import/SapImportStatusChip'
import api from '@/lib/api'
import { formatDateDMY, formatDateTimeDMY, formatTimeHMS } from '@/lib/dateFormat'
import { formatSapImportDuration } from '@/lib/sapImportProgress'
import { displaySapImportFileName } from '@/lib/sapImportSummary'
import {
  formatKgAsMt,
  formatWbUploadDay,
  wbImportDurationSeconds,
  wbImportOperationRate,
  wbImportStatusMeta,
  wbImportUploaderLabel,
  type WbImportRow,
} from '@/lib/wbDataSummary'

interface SheetSkipped {
  sheetName: string
  reason: string
}
interface ParseFailure {
  sheetName: string
  rowNumber: number
  po_number: string
  sto_number?: string
  reason: string
}
interface OperationFailure {
  po_number: string
  sto_numbers?: string[]
  progress_date?: string
  reason: string
}
interface HeldRow {
  progress_date: string
  sto_number: string | null
  quantity_delivery_kg: string | number | null
  quantity_receive_kg: string | number | null
  first_time_in: string | null
  last_time_out: string | null
  po_number: string | null
  contract_number: string | null
  operation_id: string | null
}
interface WbImportDetail extends WbImportRow {
  uploaded_by: string | null
  sheets_processed: string[]
  sheets_skipped: SheetSkipped[]
  row_parse_failures: ParseFailure[]
  operation_failures: OperationFailure[]
}

const n = (value: unknown) => (Number(value) || 0).toLocaleString('en-US')
const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : [])
const hhmm = (t: string | null) => (t ? t.slice(0, 5) : '—')

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
        {hint ? <CardDescription>{hint}</CardDescription> : null}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}

function Table({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div className="max-h-72 overflow-auto rounded-lg border border-gray-200">
      <table className="w-full text-left text-sm">
        <thead className="sticky top-0 bg-gray-50 text-xs font-medium text-gray-500">
          <tr>
            {head.map((h) => (
              <th key={h} className="px-3 py-2 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">{children}</tbody>
      </table>
    </div>
  )
}

/** One WB upload in full: who and when, the counts, the sheets, what failed and why, and the rows it still holds. */
export function WbDataDetailModal({ importId, onClose }: { importId: string | null; onClose: () => void }) {
  const [data, setData] = useState<WbImportDetail | null>(null)
  const [rows, setRows] = useState<HeldRow[]>([])
  const [rowsTotal, setRowsTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!importId) return
    let cancelled = false
    setLoading(true)
    setData(null)
    setError(null)
    api
      .get(`/wb-data/imports/${importId}`)
      .then((res) => {
        if (cancelled) return
        setData(res.data?.data?.import ?? null)
        setRows(res.data?.data?.rows ?? [])
        setRowsTotal(Number(res.data?.data?.rowsTotal) || 0)
      })
      .catch((e: { response?: { status?: number } }) => {
        if (cancelled) return
        setError(
          e.response?.status === 403
            ? 'You do not have permission to view WB uploads.'
            : e.response?.status === 404
              ? 'This upload no longer exists.'
              : 'Could not load this upload. Please retry, and tell IT if it keeps happening.',
        )
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [importId])

  useEffect(() => {
    if (!importId) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [importId, onClose])

  if (!importId) return null

  const sheetsSkipped = arr<SheetSkipped>(data?.sheets_skipped)
  const parseFailures = arr<ParseFailure>(data?.row_parse_failures)
  const opFailures = arr<OperationFailure>(data?.operation_failures)
  const sheetsProcessed = arr<string>(data?.sheets_processed)
  const duration = data ? wbImportDurationSeconds(data) : null
  const rate = data ? wbImportOperationRate(data) : null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4" role="dialog" aria-modal="true" aria-label="WB upload details">
      <Card className="flex max-h-[90vh] w-full max-w-6xl flex-col overflow-hidden">
        <CardHeader className="shrink-0 border-b">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <CardTitle>WB Upload Details</CardTitle>
              {data ? (
                <>
                  <p className="mt-1 truncate text-sm text-gray-700" title={data.file_name || undefined}>
                    {displaySapImportFileName(data.file_name)}
                  </p>
                  <p className="mt-0.5 font-mono text-xs text-gray-400">Upload ID: {data.id}</p>
                </>
              ) : null}
            </div>
            <Button variant="ghost" size="icon" className="shrink-0" aria-label="Close" onClick={onClose}>
              <X className="h-5 w-5" />
            </Button>
          </div>
        </CardHeader>

        <CardContent className="min-h-0 flex-1 space-y-5 overflow-y-auto pt-6">
          {loading ? (
            <div className="flex items-center justify-center p-12 text-gray-500">Loading upload details...</div>
          ) : error || !data ? (
            <div className="p-12 text-center">
              <div className="mb-2 text-xl font-semibold">{error ?? 'Upload not found'}</div>
              <Button onClick={onClose} className="mt-4">
                Close
              </Button>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
                <Card>
                  <CardHeader className="pb-2">
                    <CardDescription>Uploaded by</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="truncate text-xl font-bold" title={wbImportUploaderLabel(data)}>
                      {wbImportUploaderLabel(data)}
                    </div>
                    <div className="text-sm text-gray-500">{data.uploaded_by_username ? `@${data.uploaded_by_username}` : 'user no longer available'}</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardDescription>Uploaded at</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="text-xl font-bold">{formatWbUploadDay(data.created_at)}</div>
                    <div className="text-sm text-gray-500" title={formatDateTimeDMY(data.created_at)}>
                      {formatTimeHMS(data.created_at)}
                      {duration != null ? ` · took ${formatSapImportDuration(duration)}` : ''}
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardDescription>Status</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="py-0.5">
                      <SapImportStatusChip status={data.status} meta={wbImportStatusMeta(data)} />
                    </div>
                    <div className="mt-1 text-sm text-gray-500">{wbImportStatusMeta(data).hint}</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardDescription>Operations written</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className={`text-xl font-bold ${rate != null && rate < 100 ? 'text-amber-700' : ''}`}>{rate == null ? '—' : `${rate.toFixed(1)}%`}</div>
                    <div className="text-sm text-gray-500">
                      {n(data.operations_updated)} written · {n(data.operations_failed)} failed
                    </div>
                  </CardContent>
                </Card>
              </div>

              <Section title="What the file held">
                <dl className="grid grid-cols-2 gap-3 text-sm md:grid-cols-5">
                  {[
                    ['Ticket rows', data.raw_ticket_rows],
                    ['PO / date lines', data.aggregated_po_dates],
                    ['Rows written', data.rows_upserted],
                    ['Sheets read', sheetsProcessed.length],
                    ['Sheets skipped', sheetsSkipped.length],
                  ].map(([label, value]) => (
                    <div key={String(label)} className="rounded-lg bg-gray-50 px-3 py-2">
                      <dt className="text-xs text-gray-500">{label}</dt>
                      <dd className="text-lg font-semibold tabular-nums text-gray-900">{n(value)}</dd>
                    </div>
                  ))}
                </dl>
                {sheetsProcessed.length > 0 ? (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {sheetsProcessed.map((s) => (
                      <span key={s} className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs text-emerald-700">
                        {s}
                      </span>
                    ))}
                  </div>
                ) : null}
              </Section>

              {sheetsSkipped.length > 0 ? (
                <Section title={`Sheets skipped (${sheetsSkipped.length})`} hint="A sheet that is not a weighbridge sheet, or has no ticket rows.">
                  <Table head={['Sheet', 'Reason']}>
                    {sheetsSkipped.map((s, i) => (
                      <tr key={`${s.sheetName}-${i}`}>
                        <td className="px-3 py-2 font-medium text-gray-800">{s.sheetName}</td>
                        <td className="px-3 py-2 text-gray-600">{s.reason}</td>
                      </tr>
                    ))}
                  </Table>
                </Section>
              ) : null}

              {opFailures.length > 0 ? (
                <Section title={`Operations that failed (${opFailures.length})`} hint="The PO and date could not be written to a Trucking operation.">
                  <Table head={['PO', 'STO', 'Date', 'Reason']}>
                    {opFailures.map((f, i) => (
                      <tr key={`${f.po_number}-${f.progress_date}-${i}`}>
                        <td className="whitespace-nowrap px-3 py-2 font-medium text-gray-800">{f.po_number || '—'}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-gray-600">{arr<string>(f.sto_numbers).join(', ') || '—'}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-gray-600">{f.progress_date ? formatDateDMY(f.progress_date) : '—'}</td>
                        <td className="px-3 py-2 text-red-700">{f.reason}</td>
                      </tr>
                    ))}
                  </Table>
                </Section>
              ) : null}

              {parseFailures.length > 0 ? (
                <Section title={`Rows that could not be read (${parseFailures.length})`} hint="Lines of the Excel file that did not read as a ticket.">
                  <Table head={['Sheet', 'Row', 'PO', 'STO', 'Reason']}>
                    {parseFailures.map((f, i) => (
                      <tr key={`${f.sheetName}-${f.rowNumber}-${i}`}>
                        <td className="whitespace-nowrap px-3 py-2 text-gray-800">{f.sheetName}</td>
                        <td className="whitespace-nowrap px-3 py-2 tabular-nums text-gray-600">{f.rowNumber}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-gray-600">{f.po_number || '—'}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-gray-600">{f.sto_number || '—'}</td>
                        <td className="px-3 py-2 text-red-700">{f.reason}</td>
                      </tr>
                    ))}
                  </Table>
                </Section>
              ) : null}

              <Section
                title={`Rows this upload still holds (${n(rowsTotal)})`}
                hint="A later upload of the same PO and date takes the row over, so this is what the upload holds now, not everything it ever wrote."
              >
                {rows.length === 0 ? (
                  <p className="text-sm text-gray-500">None. Every row it wrote was replaced by a later upload, or it wrote none.</p>
                ) : (
                  <>
                    <Table head={['Date', 'PO', 'Contract', 'Operation', 'STO', 'Delivery', 'Receive', 'In', 'Out']}>
                      {rows.map((r, i) => (
                        <tr key={`${r.operation_id}-${r.po_number}-${r.progress_date}-${r.sto_number}-${i}`}>
                          <td className="whitespace-nowrap px-3 py-2 text-gray-800">{formatDateDMY(r.progress_date)}</td>
                          <td className="whitespace-nowrap px-3 py-2 font-medium text-gray-800">{r.po_number || '—'}</td>
                          <td className="whitespace-nowrap px-3 py-2 text-gray-600">{r.contract_number || '—'}</td>
                          <td className="whitespace-nowrap px-3 py-2 text-gray-600">{r.operation_id || '—'}</td>
                          <td className="whitespace-nowrap px-3 py-2 text-gray-600">{r.sto_number || '—'}</td>
                          <td className="whitespace-nowrap px-3 py-2 tabular-nums text-gray-800">{formatKgAsMt(r.quantity_delivery_kg)}</td>
                          <td className="whitespace-nowrap px-3 py-2 tabular-nums text-gray-800">{formatKgAsMt(r.quantity_receive_kg)}</td>
                          <td className="whitespace-nowrap px-3 py-2 tabular-nums text-gray-600">{hhmm(r.first_time_in)}</td>
                          <td className="whitespace-nowrap px-3 py-2 tabular-nums text-gray-600">{hhmm(r.last_time_out)}</td>
                        </tr>
                      ))}
                    </Table>
                    {rowsTotal > rows.length ? (
                      <p className="mt-2 text-xs text-gray-500">
                        Showing the newest {n(rows.length)} of {n(rowsTotal)} rows.
                      </p>
                    ) : null}
                  </>
                )}
              </Section>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
