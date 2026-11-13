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
import { ClaimFolderSyncButton, ClaimFolderSyncStatus, useClaimFolderSync } from '@/components/claim-import/ClaimFolderSync'
import {
  isClaimDataFileName,
  isRealisedClaimFileName,
  summarizeClaimStatus,
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
  dataAsOf: string
}

/**
 * Claim Data import: ONE drop area, for the OUTSTANDING claim file (OSCLAIM) only - the file SAP delivers every day. The review step says what the import does
 * and nothing is sent until the person confirms. The same file is also pulled from SAP's folder every morning and by the Sync button (see ClaimFolderSync).
 * The import replaces the whole outstanding snapshot; the server's rules are unchanged. A realised (REALCLAIM) file is refused here, so it can never replace
 * the snapshot by mistake; when SAP's one claim file carries the outstanding/realised column, this is the place to adjust.
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

  const folderSync = useClaimFolderSync(() => void load())

  const summary = useMemo(() => summarizeClaimStatus(status), [status])

  const selectFile = (file: File) => {
    setUploadError(null)
    setResult(null)
    if (!isClaimDataFileName(file.name)) {
      setPending(null)
      setUploadError('Only .xls or .xlsx files are accepted.')
      return
    }
    if (isRealisedClaimFileName(file.name)) {
      setPending(null)
      setUploadError('This is a realised (REALCLAIM) file. This page imports the outstanding claim file (OSCLAIM) only.')
      return
    }
    setPending({ file, dataAsOf: todayIso() })
  }

  const runImport = async () => {
    if (!pending) return
    const { file, dataAsOf } = pending
    const ok = window.confirm(
      `Importing the Outstanding file replaces the whole Outstanding snapshot on Shortage Claim and Quality Claim (data as of ${formatDateDMY(dataAsOf)}). Continue?`,
    )
    if (!ok) return
    setBusy({ phase: 'uploading', fileName: file.name })
    setProgress(0)
    setUploadError(null)
    setResult(null)
    try {
      const form = new FormData()
      form.append('file', file)
      form.append('kind', 'os')
      if (dataAsOf) form.append('dataAsOf', dataAsOf)
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
          SAP outstanding claim export (OSCLAIM): one file holds Mutu and Susut claims; they feed Quality Claim and Shortage Claim.
        </p>
        {canUpload ? (
          <div className="flex items-center gap-2">
            <ClaimFolderSyncButton folderSync={folderSync} canSync={canUpload} />
            <Button size="sm" onClick={() => inputRef.current?.click()} disabled={busy != null}>
              <Upload className="mr-2 h-4 w-4" aria-hidden />
              Import Claim Data
            </Button>
          </div>
        ) : null}
      </div>

      {loadError ? <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">{loadError}</p> : null}
      {uploadError ? <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">{uploadError}</p> : null}
      {!canUpload ? (
        <p className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm text-gray-600">View only: you do not have permission to import Claim Data.</p>
      ) : null}

      <ClaimFolderSyncStatus folderSync={folderSync} />

      <ClaimImportKpis summary={summary} auto={folderSync.status} />

      {busy ? (
        <ClaimImportProgress phase={busy.phase} uploadProgress={progress} fileName={busy.fileName} />
      ) : pending ? (
        <ClaimImportReview
          fileName={pending.file.name}
          fileSize={pending.file.size}
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
          title="Drop the SAP Claim file here, or browse"
          hint=".xls or .xlsx. The outstanding file (OSCLAIM) replaces the whole outstanding snapshot."
          ariaLabel="Upload the SAP Claim file"
        />
      ) : null}

      {result ? <ClaimImportResult result={result.data} fileName={result.fileName} onDismiss={() => setResult(null)} /> : null}

      <ClaimImportHistory items={history} loadError={loadError} />
    </div>
  )
}
