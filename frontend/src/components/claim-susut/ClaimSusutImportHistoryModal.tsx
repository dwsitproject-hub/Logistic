'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Loader2, X } from 'lucide-react'
import api from '@/lib/api'
import { formatDateDMY, formatDateTimeDMY, formatTimeHMS } from '@/lib/dateFormat'
import {
  claimSusutImportFailedCount,
  claimSusutImportStatus,
  claimSusutImportSuccessRate,
  parseClaimSusutImportErrors,
  type ClaimSusutImportError,
} from '@/lib/claimSusutView'

export type ClaimSusutImportListItem = {
  id: string
  file_name: string
  sheet_name?: string
  uploaded_at: string
  total_rows: number
  inserted_rows: number
  errors?: unknown
  uploaded_by_name?: string | null
  uploaded_by_username?: string | null
}

function displayImportFileName(fileName: string | null | undefined): string {
  const raw = String(fileName || '').trim()
  if (!raw) return '—'
  const withoutExt = raw.replace(/\.(xlsx|xlsm|xlsb|xls)$/i, '').trim()
  return withoutExt || raw
}

function statusBadge(status: ReturnType<typeof claimSusutImportStatus>) {
  if (status === 'completed') return <Badge>Completed</Badge>
  if (status === 'partial') return <Badge variant="secondary">Partial</Badge>
  return <Badge variant="destructive">Failed</Badge>
}

function ClaimSusutImportDetailOverlay({
  importId,
  onClose,
}: {
  importId: string
  onClose: () => void
}) {
  const [loading, setLoading] = useState(true)
  const [detail, setDetail] = useState<{
    id: string
    file_name: string
    sheet_name?: string
    uploaded_at: string
    total_rows: number
    inserted_rows: number
    failedRows: number
    successRate: number
    errors: ClaimSusutImportError[]
    uploaded_by_name?: string | null
    uploaded_by_username?: string | null
  } | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      try {
        const res = await api.get(`/claim-susut/imports/${importId}`)
        const data = res.data?.data
        if (cancelled) return
        if (!data) {
          setDetail(null)
          return
        }
        const errors = parseClaimSusutImportErrors(data.errors)
        const totalRows = Number(data.total_rows) || 0
        const insertedRows = Number(data.inserted_rows) || 0
        setDetail({
          id: String(data.id),
          file_name: String(data.file_name || ''),
          sheet_name: data.sheet_name ? String(data.sheet_name) : undefined,
          uploaded_at: String(data.uploaded_at || ''),
          total_rows: totalRows,
          inserted_rows: insertedRows,
          failedRows: Number(data.failedRows) || errors.length,
          successRate: Number(data.successRate) || claimSusutImportSuccessRate(totalRows, insertedRows),
          errors,
          uploaded_by_name: data.uploaded_by_name ?? null,
          uploaded_by_username: data.uploaded_by_username ?? null,
        })
      } catch {
        if (!cancelled) setDetail(null)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [importId])

  const status = detail
    ? claimSusutImportStatus(detail.inserted_rows, detail.failedRows)
    : 'failed'

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black bg-opacity-50 p-4">
      <Card className="max-w-6xl w-full max-h-[90vh] flex flex-col overflow-hidden">
        <CardHeader className="shrink-0 border-b">
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle>Import Details</CardTitle>
              {detail ? <p className="text-sm text-gray-500 mt-1 font-mono">Import ID: {detail.id}</p> : null}
            </div>
            <Button variant="ghost" size="icon" className="shrink-0" aria-label="Close" onClick={onClose}>
              <X className="h-5 w-5" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="min-h-0 flex-1 overflow-y-auto space-y-6 pt-6">
          {loading ? (
            <div className="flex items-center justify-center p-12 text-gray-500">Loading import details...</div>
          ) : !detail ? (
            <div className="p-12 text-center">
              <div className="text-xl font-semibold mb-2">Import Not Found</div>
              <Button onClick={onClose} className="mt-4">
                Close
              </Button>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <Card>
                  <CardHeader className="pb-2">
                    <CardDescription>Import Date</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">{formatDateDMY(detail.uploaded_at)}</div>
                    <div className="text-sm text-gray-500">{formatTimeHMS(detail.uploaded_at)}</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardDescription>Status</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">{statusBadge(status)}</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardDescription>Total Records</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">{detail.total_rows.toLocaleString()}</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardDescription>Success Rate</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div
                      className={`text-2xl font-bold ${detail.successRate >= 95 ? 'text-green-600' : 'text-red-600'}`}
                    >
                      {detail.successRate.toFixed(1)}%
                    </div>
                  </CardContent>
                </Card>
              </div>

              <Card>
                <CardHeader>
                  <CardTitle>Processing Results</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div className="flex justify-between items-center p-3 bg-green-50 rounded">
                      <span className="font-medium">Successfully Processed</span>
                      <span className="text-2xl font-bold text-green-600">
                        {detail.inserted_rows.toLocaleString()}
                      </span>
                    </div>
                    <div className="flex justify-between items-center p-3 bg-red-50 rounded">
                      <span className="font-medium">Failed Records</span>
                      <span className="text-2xl font-bold text-red-600">{detail.failedRows.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between items-center p-3 bg-gray-50 rounded">
                      <span className="font-medium">Total Imported</span>
                      <span className="text-2xl font-bold">{detail.total_rows.toLocaleString()}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {detail.errors.length > 0 ? (
                <Card>
                  <CardHeader>
                    <CardTitle>Failed Records ({detail.errors.length})</CardTitle>
                    <CardDescription>Excel rows that failed during this Claim Susut import</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="overflow-x-auto max-h-96 overflow-y-auto">
                      <table className="w-full">
                        <thead>
                          <tr className="border-b">
                            <th className="text-left p-3">Excel Row</th>
                            <th className="text-left p-3">Reason</th>
                          </tr>
                        </thead>
                        <tbody>
                          {detail.errors.slice(0, 200).map((failure, idx) => (
                            <tr key={`${failure.rowIndex}-${idx}`} className="border-b align-top">
                              <td className="p-3 font-medium tabular-nums">{failure.rowIndex}</td>
                              <td className="p-3 text-sm text-red-600">{failure.message || '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {detail.errors.length > 200 ? (
                      <p className="text-xs text-muted-foreground mt-2">
                        Showing 200 of {detail.errors.length.toLocaleString()} failed rows.
                      </p>
                    ) : null}
                  </CardContent>
                </Card>
              ) : null}

              <Card>
                <CardHeader>
                  <CardTitle>Import Information</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <div className="text-sm text-gray-500">File Name</div>
                      <div className="font-medium">{detail.file_name || '—'}</div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-500">Sheet</div>
                      <div className="font-medium">{detail.sheet_name || '—'}</div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-500">Uploaded At</div>
                      <div className="font-medium">{formatDateTimeDMY(detail.uploaded_at)}</div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-500">Uploaded By</div>
                      <div className="font-medium">
                        {String(detail.uploaded_by_name || '').trim() ||
                          String(detail.uploaded_by_username || '').trim() ||
                          'Unknown user'}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

export function ClaimSusutImportHistoryModal({
  open,
  onOpenChange,
  imports,
  loading,
  onSelectImport,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  imports: ClaimSusutImportListItem[]
  loading?: boolean
  onSelectImport: (id: string) => void
}) {
  const [detailImportId, setDetailImportId] = useState<string | null>(null)

  useEffect(() => {
    if (!open) setDetailImportId(null)
  }, [open])

  const openDetails = (id: string) => {
    onSelectImport(id)
    setDetailImportId(id)
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-5xl max-h-[88vh] overflow-hidden flex flex-col" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>Import History</DialogTitle>
          </DialogHeader>
          {loading ? (
            <div className="flex items-center justify-center py-10 text-sm text-gray-500">
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Loading imports...
            </div>
          ) : imports.length === 0 ? (
            <div className="py-10 text-center text-sm text-gray-500">No Claim Susut Excel imports yet.</div>
          ) : (
            <div className="overflow-x-auto min-h-0 flex-1">
              <table className="w-full">
                <thead>
                  <tr className="border-b">
                    <th className="text-left p-3">Import Date</th>
                    <th className="text-left p-3">File Name</th>
                    <th className="text-left p-3">Status</th>
                    <th className="text-left p-3">Uploaded By</th>
                    <th className="text-right p-3">Total Records</th>
                    <th className="text-right p-3">Processed</th>
                    <th className="text-right p-3">Failed</th>
                    <th className="text-right p-3">Success Rate</th>
                    <th className="text-right p-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {imports.map((imp) => {
                    const total = Number(imp.total_rows) || 0
                    const inserted = Number(imp.inserted_rows) || 0
                    const failed = claimSusutImportFailedCount(imp.errors, total, inserted)
                    const successRate = claimSusutImportSuccessRate(total, inserted)
                    const status = claimSusutImportStatus(inserted, failed)
                    return (
                      <tr key={imp.id} className="border-b hover:bg-gray-50">
                        <td className="p-3">
                          <div className="font-medium">{new Date(imp.uploaded_at).toLocaleString()}</div>
                          <div className="text-xs text-gray-500">{formatDateDMY(imp.uploaded_at)}</div>
                        </td>
                        <td className="p-3">
                          <div className="font-medium" title={imp.file_name || undefined}>
                            {displayImportFileName(imp.file_name)}
                          </div>
                        </td>
                        <td className="p-3">{statusBadge(status)}</td>
                        <td className="p-3">
                          {String(imp.uploaded_by_name || '').trim() ||
                            String(imp.uploaded_by_username || '').trim() ||
                            '—'}
                        </td>
                        <td className="p-3 text-right">{total.toLocaleString()}</td>
                        <td className="p-3 text-right text-green-600 font-medium">{inserted.toLocaleString()}</td>
                        <td className="p-3 text-right text-red-600 font-medium">{failed.toLocaleString()}</td>
                        <td className="p-3 text-right">
                          <Badge variant={successRate >= 95 ? 'default' : 'destructive'}>{successRate.toFixed(1)}%</Badge>
                        </td>
                        <td className="p-3 text-right">
                          <Button variant="outline" size="sm" onClick={() => openDetails(imp.id)}>
                            View Details
                          </Button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </DialogContent>
      </Dialog>
      {detailImportId ? (
        <ClaimSusutImportDetailOverlay importId={detailImportId} onClose={() => setDetailImportId(null)} />
      ) : null}
    </>
  )
}
