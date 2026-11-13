'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import api from '@/lib/api'
import { canCreatePermission, usePermissions } from '@/components/PermissionsContext'
import { formatDateDMY } from '@/lib/dateFormat'
import { SapImportDropZone } from '@/components/sap-import/SapImportDropZone'
import { ClaimImportKpis } from '@/components/claim-import/ClaimImportKpis'
import { ClaimImportReview } from '@/components/claim-import/ClaimImportReview'
import { ClaimImportProgress } from '@/components/claim-import/ClaimImportProgress'
import { ClaimImportResult } from '@/components/claim-import/ClaimImportResult'
import { ClaimImportHistory } from '@/components/claim-import/ClaimImportHistory'
import {
  CLAIM_KIND_LABEL,
  detectClaimDataKind,
  isClaimDataFileName,
  summarizeClaimStatus,
  type ClaimDataKind,
  type ClaimImportResultData,
  type ClaimStatusData,
  type ClaimUploadHistoryItem,
} from '@/lib/claimDataImportView'

const todayIso = () => {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

const errorMessage = (e: unknown): string => {
  const err = e as { response?: { data?: { error?: { message?: string } } }; message?: string }
  return err?.response?.data?.error?.message || err?.message || 'Upload failed'
}

interface PendingFile {
  file: File
  kind: ClaimDataKind | null
  /** The kind came from the file name (so the review says so). */
  detected: boolean
  dataAsOf: string
}

/**
 * Claim Data import: ONE drop area for the SAP claim export. The file name says whether it is the outstanding (OSCLAIM) or the realised (REALCLAIM) file,
 * the review step shows that and what the import will do, and nothing is sent until the person confirms. The import rules are the server's and are unchanged:
 * OSCLAIM replaces the whole outstanding snapshot, REALCLAIM is upserted per CR number.
 */
export default function ClaimDataImportDashboard() {
  const perms = usePermissions()
  const canUpload = canCreatePermission(perms, 'page.claim_data')
  const inputRef = useRef<HTMLInputElement>(null)

  const [status, setStatus] = useState<ClaimStatusData | null>(null)
  const [history, setHistory] = useState<ClaimUploadHistoryItem[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [pending, setPending] = useState<PendingFile | null>(null)
  const [busy, setBusy] = useState<{ phase: 'uploading' | 'processing'; fileName: string } | null>(null)
  const [progress, setProgress] = useState(0)
  const [result, setResult] = useState<{ data: ClaimImportResultData; fileName: string } | null>(null)
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

  const summary = useMemo(() => summarizeClaimStatus(status), [status])

  const selectFile = (file: File) => {
    setUploadError(null)
    setResult(null)
    if (!isClaimDataFileName(file.name)) {
      setPending(null)
      setUploadError('Only .xls or .xlsx files are accepted.')
      return
    }
    const kind = detectClaimDataKind(file.name)
    setPending({ file, kind, detected: kind != null, dataAsOf: todayIso() })
  }

  const runImport = async () => {
    if (!pending || !pending.kind) return
    const { file, kind, dataAsOf } = pending
    if (kind === 'os') {
      const ok = window.confirm(
        `Importing the Outstanding file replaces the whole Outstanding snapshot on Shortage Claim and Quality Claim (data as of ${formatDateDMY(dataAsOf)}). Continue?`,
      )
      if (!ok) return
    }
    setBusy({ phase: 'uploading', fileName: file.name })
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
        onUploadProgress: (event) => {
          if (event.total) {
            const percent = Math.min(100, Math.round((event.loaded * 100) / event.total))
            setProgress(percent)
            if (percent >= 100) setBusy((current) => (current ? { ...current, phase: 'processing' } : current))
          }
        },
      })
      setResult({ data: res.data.data as ClaimImportResultData, fileName: file.name })
      setPending(null)
      await load()
    } catch (e) {
      setUploadError(errorMessage(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-5">
      <input
        ref={inputRef}
        type="file"
        accept=".xls,.xlsx"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (file) selectFile(file)
        }}
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-gray-500">
          SAP claim export: one file holds Mutu and Susut claims; they feed Quality Claim and Shortage Claim.
        </p>
        {canUpload ? (
          <Button size="sm" onClick={() => inputRef.current?.click()} disabled={busy != null}>
            <Upload className="mr-2 h-4 w-4" aria-hidden />
            Import Claim Data
          </Button>
        ) : null}
      </div>

      {loadError ? <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">{loadError}</p> : null}
      {uploadError ? <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">{uploadError}</p> : null}
      {!canUpload ? (
        <p className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm text-gray-600">View only: you do not have permission to import Claim Data.</p>
      ) : null}

      <ClaimImportKpis summary={summary} />

      {busy ? (
        <ClaimImportProgress phase={busy.phase} uploadProgress={progress} fileName={busy.fileName} />
      ) : pending ? (
        <ClaimImportReview
          fileName={pending.file.name}
          fileSize={pending.file.size}
          kind={pending.kind}
          detected={pending.detected}
          onKind={(kind) => setPending((current) => (current ? { ...current, kind, detected: false } : current))}
          dataAsOf={pending.dataAsOf}
          onDataAsOf={(value) => setPending((current) => (current ? { ...current, dataAsOf: value } : current))}
          maxDate={todayIso()}
          onCancel={() => setPending(null)}
          onImport={() => void runImport()}
        />
      ) : canUpload ? (
        <SapImportDropZone
          onFile={selectFile}
          onBrowse={() => inputRef.current?.click()}
          title="Drop the SAP claim file here, or browse"
          hint={`.xls or .xlsx. OSCLAIM (${CLAIM_KIND_LABEL.os.toLowerCase()}) or REALCLAIM (${CLAIM_KIND_LABEL.real.toLowerCase()}) is read from the file name.`}
          ariaLabel="Upload an SAP claim file"
        />
      ) : null}

      {result ? <ClaimImportResult result={result.data} fileName={result.fileName} onDismiss={() => setResult(null)} /> : null}

      <ClaimImportHistory items={history} loadError={loadError} />
    </div>
  )
}
