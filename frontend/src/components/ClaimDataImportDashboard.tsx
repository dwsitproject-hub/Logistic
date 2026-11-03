'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, Upload } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import api from '@/lib/api'
import { canCreatePermission, usePermissions } from '@/components/PermissionsContext'
import { formatDateDMY, formatDateTimeDMY } from '@/lib/dateFormat'

type ClaimDataKind = 'os' | 'real'

interface ImportResult {
  uploadId: string
  kind: ClaimDataKind
  totalRows: number
  susutRows: number
  mutuRows: number
  insertedRows: number
  replacedRows: number
  failedRows: number
  b2b: number
  direct: number
  unmatched: number
  warnings: string[]
  errors: Array<{ rowIndex: number; message: string; sheet?: string }>
  sheetsRead?: number
  subtotalRowsSkipped?: number
}

interface UploadHistoryItem {
  id: string
  kind: ClaimDataKind
  file_name: string
  data_as_of: string | null
  uploaded_at: string
  total_rows: number
  susut_rows: number
  mutu_rows: number
  inserted_rows: number
  replaced_rows: number
  failed_rows: number
  b2b_rows: number
  direct_rows: number
  unmatched_rows: number
  warnings: string[] | null
  errors: unknown[] | null
  uploaded_by_name: string | null
  uploaded_by_username: string | null
}

interface StatusData {
  latest: Partial<Record<ClaimDataKind, { file_name: string; data_as_of: string | null; uploaded_at: string; total_rows: number }>>
  counts: { os_susut?: number; os_mutu?: number; real_susut?: number; real_mutu?: number }
}

const KIND_META: Record<ClaimDataKind, { title: string; file: string; description: string; mode: string }> = {
  os: {
    title: 'OSCLAIM (Outstanding)',
    file: 'OSCLAIM_ALLREGION_MUTU SUSUT_….xls',
    description: 'Claims that are not paid yet. Mutu and Susut claims are split by TYPE OF CLAIM.',
    mode: 'Replaces the whole Outstanding snapshot',
  },
  real: {
    title: 'REALCLAIM (Realised)',
    file: 'REALCLAIM_ALLREGION_MUTU SUSUT_….xls',
    description: 'Claims that are already paid. Mutu and Susut claims are split by TYPE OF CLAIM.',
    mode: 'Upserted per CR number (cumulative)',
  },
}

const nf = new Intl.NumberFormat('en-US')
const todayIso = () => {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

const errorMessage = (e: unknown): string => {
  const err = e as { response?: { data?: { error?: { message?: string } } }; message?: string }
  return err?.response?.data?.error?.message || err?.message || 'Upload failed'
}

interface UploadCardProps {
  kind: ClaimDataKind
  canUpload: boolean
  busyKind: ClaimDataKind | null
  progress: number
  dataAsOf: string
  onDataAsOfChange: (v: string) => void
  onFile: (kind: ClaimDataKind, file: File) => void
}

function UploadCard({ kind, canUpload, busyKind, progress, dataAsOf, onDataAsOfChange, onFile }: UploadCardProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const meta = KIND_META[kind]
  const busy = busyKind === kind
  const disabled = !canUpload || busyKind !== null
  return (
    <Card>
      <CardHeader>
        <CardTitle>{meta.title}</CardTitle>
        <CardDescription>{meta.description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-gray-500">
          Expected file: <span className="font-mono">{meta.file}</span>
          <br />
          Import mode: <span className="font-medium text-gray-700">{meta.mode}</span>
        </p>
        {kind === 'os' ? (
          <label className="block text-xs font-medium text-gray-600">
            Data as of
            <input
              type="date"
              value={dataAsOf}
              max={todayIso()}
              onChange={(e) => onDataAsOfChange(e.target.value)}
              disabled={disabled}
              className="mt-1 block h-9 w-44 rounded-md border border-gray-300 px-2 text-sm"
            />
            <span className="mt-1 block font-normal text-gray-500">
              Shown on Shortage Claim and Quality Claim as the outstanding date. Aging is always recomputed from CR date vs today.
            </span>
          </label>
        ) : null}
        <input
          ref={inputRef}
          type="file"
          accept=".xls,.xlsx"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (f) onFile(kind, f)
          }}
        />
        <Button type="button" disabled={disabled} onClick={() => inputRef.current?.click()}>
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
          {busy ? (progress < 100 ? `Uploading ${progress}%` : 'Processing…') : `Upload ${kind === 'os' ? 'OSCLAIM' : 'REALCLAIM'} (.xls / .xlsx)`}
        </Button>
        {busy ? <Progress value={progress} /> : null}
        {!canUpload ? <p className="text-xs text-gray-500">View only — you do not have permission to import Claim Data.</p> : null}
      </CardContent>
    </Card>
  )
}

function ResultCard({ result, fileName }: { result: ImportResult; fileName: string }) {
  const matchedPct = result.totalRows > 0 ? ((result.b2b + result.direct) / result.totalRows) * 100 : 0
  return (
    <Card className="border-emerald-200">
      <CardHeader>
        <CardTitle>Import finished — {KIND_META[result.kind].title}</CardTitle>
        <CardDescription>{fileName}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
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
          <p className="text-xs text-amber-700">
            Unmatched rows are claims whose PO was not found in the Logistics Report. They stay in the totals and can be filtered as
            “Unmatched”.
          </p>
        ) : null}
        {result.warnings.length > 0 ? (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
            <p className="mb-1 font-semibold">Warnings</p>
            <ul className="list-disc space-y-0.5 pl-4">
              {result.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {result.errors.length > 0 ? (
          <div className="rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-800">
            <p className="mb-1 font-semibold">Rows that could not be saved ({result.errors.length})</p>
            <ul className="max-h-40 list-disc space-y-0.5 overflow-auto pl-4">
              {result.errors.slice(0, 50).map((er, i) => (
                <li key={i}>
                  {er.sheet ? `${er.sheet} · ` : ''}row {er.rowIndex}: {er.message}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}

function Stat({ label, value, tone }: { label: string; value: number | string; tone?: 'bad' | 'warn' }) {
  const color = tone === 'bad' ? 'text-red-700' : tone === 'warn' ? 'text-amber-700' : 'text-gray-900'
  return (
    <div className="rounded-md border border-gray-200 p-2">
      <p className="text-[11px] uppercase tracking-wide text-gray-500">{label}</p>
      <p className={`text-base font-semibold ${color}`}>{typeof value === 'number' ? nf.format(value) : value}</p>
    </div>
  )
}

export default function ClaimDataImportDashboard() {
  const perms = usePermissions()
  const canUpload = canCreatePermission(perms, 'page.claim_data')

  const [status, setStatus] = useState<StatusData | null>(null)
  const [history, setHistory] = useState<UploadHistoryItem[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busyKind, setBusyKind] = useState<ClaimDataKind | null>(null)
  const [progress, setProgress] = useState(0)
  const [dataAsOf, setDataAsOf] = useState(todayIso())
  const [result, setResult] = useState<{ data: ImportResult; fileName: string } | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [s, h] = await Promise.all([api.get('/claim-data/status'), api.get('/claim-data/uploads')])
      setStatus(s.data?.data ?? null)
      setHistory(h.data?.data ?? [])
      setLoadError(null)
    } catch (e) {
      setLoadError(errorMessage(e))
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const onFile = async (kind: ClaimDataKind, file: File) => {
    if (kind === 'os') {
      const label = formatDateDMY(dataAsOf)
      const ok = window.confirm(
        `Importing OSCLAIM replaces the whole Outstanding snapshot on Shortage Claim and Quality Claim (data as of ${label}). Continue?`,
      )
      if (!ok) return
    }
    setBusyKind(kind)
    setProgress(0)
    setUploadError(null)
    setResult(null)
    try {
      const form = new FormData()
      form.append('file', file)
      form.append('kind', kind)
      if (kind === 'os' && dataAsOf) form.append('dataAsOf', dataAsOf)
      const res = await api.post('/claim-data/upload', form, {
        timeout: 10 * 60 * 1000,
        onUploadProgress: (ev) => {
          if (ev.total) setProgress(Math.min(100, Math.round((ev.loaded * 100) / ev.total)))
        },
      })
      setResult({ data: res.data.data as ImportResult, fileName: file.name })
      await load()
    } catch (e) {
      setUploadError(errorMessage(e))
    } finally {
      setBusyKind(null)
    }
  }

  const counts = status?.counts ?? {}

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">Claim Data Imports</h2>
        <p className="text-sm text-gray-500">
          Import the SAP claim exports once here. Each file holds Mutu and Susut claims; they feed Quality Claim and Shortage Claim.
        </p>
      </div>

      {loadError ? <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{loadError}</p> : null}
      {uploadError ? <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{uploadError}</p> : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {(['os', 'real'] as ClaimDataKind[]).map((kind) => (
          <UploadCard
            key={kind}
            kind={kind}
            canUpload={canUpload}
            busyKind={busyKind}
            progress={progress}
            dataAsOf={dataAsOf}
            onDataAsOfChange={setDataAsOf}
            onFile={onFile}
          />
        ))}
      </div>

      {result ? <ResultCard result={result.data} fileName={result.fileName} /> : null}

      <Card>
        <CardHeader>
          <CardTitle>Current data</CardTitle>
          <CardDescription>What Shortage Claim and Quality Claim are showing right now.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {(['os', 'real'] as ClaimDataKind[]).map((kind) => {
              const latest = status?.latest?.[kind]
              const susut = kind === 'os' ? counts.os_susut : counts.real_susut
              const mutu = kind === 'os' ? counts.os_mutu : counts.real_mutu
              return (
                <div key={kind} className="rounded-md border border-gray-200 p-3 text-sm">
                  <p className="font-medium text-gray-900">{KIND_META[kind].title}</p>
                  {latest ? (
                    <>
                      <p className="text-xs text-gray-500">
                        Last file: {latest.file_name}
                        {latest.data_as_of ? ` · as of ${formatDateDMY(latest.data_as_of)}` : ''} · {formatDateTimeDMY(latest.uploaded_at)}
                      </p>
                      <p className="mt-1">
                        Shortage: <b>{nf.format(susut ?? 0)}</b> claims · Quality: <b>{nf.format(mutu ?? 0)}</b> claims
                      </p>
                    </>
                  ) : (
                    <p className="text-xs text-gray-500">Not imported yet.</p>
                  )}
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Import History</CardTitle>
        </CardHeader>
        <CardContent>
          {history.length === 0 ? (
            <p className="text-sm text-gray-500">No imports yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b text-gray-500">
                  <tr>
                    <th className="px-2 py-2">Uploaded</th>
                    <th className="px-2 py-2">Type</th>
                    <th className="px-2 py-2">File</th>
                    <th className="px-2 py-2">Data as of</th>
                    <th className="px-2 py-2 text-right">Rows</th>
                    <th className="px-2 py-2 text-right">Susut</th>
                    <th className="px-2 py-2 text-right">Mutu</th>
                    <th className="px-2 py-2 text-right">Failed</th>
                    <th className="px-2 py-2 text-right">B2B</th>
                    <th className="px-2 py-2 text-right">Direct</th>
                    <th className="px-2 py-2 text-right">Unmatched</th>
                    <th className="px-2 py-2">By</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((h) => (
                    <tr key={h.id} className="border-b last:border-0">
                      <td className="whitespace-nowrap px-2 py-2">{formatDateTimeDMY(h.uploaded_at)}</td>
                      <td className="px-2 py-2">
                        <Badge variant="outline">{h.kind === 'os' ? 'Outstanding' : 'Realised'}</Badge>
                      </td>
                      <td className="max-w-[18rem] truncate px-2 py-2" title={h.file_name}>
                        {h.file_name}
                      </td>
                      <td className="whitespace-nowrap px-2 py-2">{h.data_as_of ? formatDateDMY(h.data_as_of) : '-'}</td>
                      <td className="px-2 py-2 text-right">{nf.format(h.total_rows)}</td>
                      <td className="px-2 py-2 text-right">{nf.format(h.susut_rows)}</td>
                      <td className="px-2 py-2 text-right">{nf.format(h.mutu_rows)}</td>
                      <td className={`px-2 py-2 text-right ${h.failed_rows > 0 ? 'text-red-700' : ''}`}>{nf.format(h.failed_rows)}</td>
                      <td className="px-2 py-2 text-right">{nf.format(h.b2b_rows)}</td>
                      <td className="px-2 py-2 text-right">{nf.format(h.direct_rows)}</td>
                      <td className="px-2 py-2 text-right">{nf.format(h.unmatched_rows)}</td>
                      <td className="whitespace-nowrap px-2 py-2">{h.uploaded_by_name || h.uploaded_by_username || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
