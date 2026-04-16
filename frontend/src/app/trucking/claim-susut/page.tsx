'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import Layout from '@/components/Layout'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Upload, ArrowLeft, RefreshCw, ArrowUp, ArrowDown } from 'lucide-react'
import api from '@/lib/api'
import { formatDateDMY, formatDateTimeDMY } from '@/lib/dateFormat'

type ClaimSusutImport = {
  id: string
  file_name: string
  sheet_name?: string
  uploaded_at: string
  total_rows: number
  inserted_rows: number
  errors?: any
  uploaded_by_name?: string | null
  uploaded_by_username?: string | null
}

type ClaimSusutRow = {
  id: string
  vendor_code?: string
  vendor_name?: string
  vendor_type?: string
  created_by?: string
  sta?: string
  crno?: string
  cr_date?: string
  os_days?: number
  group_of_transport?: string
  payment_method?: string
  dest?: string
  po_number?: string
  contract_ext_no?: string
  comm?: string
  commodity?: string
  uom?: string
  currency?: string
  company_code?: string
  remarks?: string
  type?: string
  qty_claim?: number
  amount_before_tax_idr?: number
  tax?: number
  amount_after_tax_idr?: number
  a_0_30?: number
  a_31_60?: number
  a_61_90?: number
  a_gt_90?: number
}

type ClaimSusutGroupTransportRow = {
  group_of_transport: string
  a_0_30: number
  a_31_60: number
  a_61_90: number
  a_gt_90: number
  grand_total: number
}

function money(n: number | undefined | null) {
  const v = Number(n || 0)
  return v.toLocaleString('id-ID', { maximumFractionDigits: 0 })
}

function num(n: number | undefined | null) {
  const v = Number(n || 0)
  return v.toLocaleString('id-ID', { maximumFractionDigits: 3 })
}

function formatDate(d?: string) {
  if (!d) return '-'
  return formatDateDMY(d)
}

type ColumnDef = {
  id: string
  label: string
  sortKey: string
  align?: 'left' | 'right'
}

const columns: ColumnDef[] = [
  { id: 'vendor_code', label: 'Supplier Code', sortKey: 'vendor_code' },
  { id: 'vendor_name', label: 'Supplier Name', sortKey: 'vendor_name' },
  { id: 'vendor_type', label: 'Source Type', sortKey: 'vendor_type' },
  { id: 'created_by', label: 'Created By', sortKey: 'created_by' },
  { id: 'sta', label: 'STA', sortKey: 'sta' },
  { id: 'crno', label: 'CRNO', sortKey: 'crno' },
  { id: 'cr_date', label: 'CR Date', sortKey: 'cr_date' },
  { id: 'os_days', label: 'OS Days', sortKey: 'os_days', align: 'right' },
  { id: 'group_of_transport', label: 'Group Of Transport', sortKey: 'group_of_transport' },
  { id: 'payment_method', label: 'Payment Method', sortKey: 'payment_method' },
  { id: 'dest', label: 'Dest', sortKey: 'dest' },
  { id: 'po_number', label: 'PO Number', sortKey: 'po_number' },
  { id: 'contract_ext_no', label: 'Contract Ext No', sortKey: 'contract_ext_no' },
  { id: 'comm', label: 'COMM', sortKey: 'comm' },
  { id: 'commodity', label: 'Product', sortKey: 'commodity' },
  { id: 'uom', label: 'UOM', sortKey: 'uom' },
  { id: 'currency', label: 'Currency', sortKey: 'currency' },
  { id: 'company_code', label: 'Company Code', sortKey: 'company_code' },
  { id: 'remarks', label: 'Remarks', sortKey: 'remarks' },
  { id: 'type', label: 'Type', sortKey: 'type' },
  { id: 'qty_claim', label: 'Qty Claim', sortKey: 'qty_claim', align: 'right' },
  { id: 'amount_before_tax_idr', label: 'Amount Before Tax (IDR)', sortKey: 'amount_before_tax_idr', align: 'right' },
  { id: 'tax', label: 'Tax', sortKey: 'tax', align: 'right' },
  { id: 'amount_after_tax_idr', label: 'Amount After Tax (IDR)', sortKey: 'amount_after_tax_idr', align: 'right' },
  { id: 'a_0_30', label: 'Aging 0-30 Days', sortKey: 'a_0_30', align: 'right' },
  { id: 'a_31_60', label: 'Aging 31-60 Days', sortKey: 'a_31_60', align: 'right' },
  { id: 'a_61_90', label: 'Aging 61-90 Days', sortKey: 'a_61_90', align: 'right' },
  { id: 'a_gt_90', label: 'Aging > 90 Days', sortKey: 'a_gt_90', align: 'right' },
]

const defaultVisibleIds = columns.map((c) => c.id)

function SortIcon({ active, dir }: { active: boolean; dir: 'asc' | 'desc' }) {
  if (!active) return <span className="text-gray-400 inline-flex"><ArrowUp className="h-3 w-3 opacity-0" /></span>
  return dir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
}

export default function ClaimSusutPage() {
  const [imports, setImports] = useState<ClaimSusutImport[]>([])
  const [selectedImportId, setSelectedImportId] = useState<string>('')
  const [rows, setRows] = useState<ClaimSusutRow[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [uploadSummary, setUploadSummary] = useState<{
    totalRows: number
    insertedRows: number
    failedRows: number
    errors: { rowIndex: number; message: string }[]
  } | null>(null)

  const pageSize = 200
  const [page, setPage] = useState(1)
  const [sortKey, setSortKey] = useState<string>('os_days')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  const [visibleColumnIds, setVisibleColumnIds] = useState<Set<string>>(new Set(defaultVisibleIds))
  const [columnsOpen, setColumnsOpen] = useState(false)
  const columnsRef = useRef<HTMLDivElement>(null)

  const [mainTab, setMainTab] = useState<'all' | 'group_transport'>('all')
  const [groupTransportRows, setGroupTransportRows] = useState<ClaimSusutGroupTransportRow[]>([])
  const [groupTransportLoading, setGroupTransportLoading] = useState(false)

  const selectedImport = useMemo(() => imports.find((i) => i.id === selectedImportId), [imports, selectedImportId])

  const visibleColumns = useMemo(() => columns.filter((c) => visibleColumnIds.has(c.id)), [visibleColumnIds])

  const loadImports = async () => {
    const res = await api.get('/claim-susut/imports')
    setImports(res.data.data || [])
    const first = (res.data.data || [])?.[0]?.id
    if (!selectedImportId && first) setSelectedImportId(first)
  }

  const loadRows = async (opts?: { importId?: string; page?: number }) => {
    setLoading(true)
    setError(null)
    try {
      const importId = opts?.importId ?? selectedImportId
      const p = opts?.page ?? page
      const params = new URLSearchParams()
      if (importId) params.set('importId', importId)
      params.set('limit', String(pageSize))
      params.set('offset', String((p - 1) * pageSize))
      params.set('sortKey', sortKey)
      params.set('sortDir', sortDir)
      const res = await api.get(`/claim-susut/rows?${params.toString()}`)
      setRows(res.data.data || [])
      setTotalCount(Number(res.data.meta?.totalCount) || 0)
    } catch (e: any) {
      const msg = e?.response?.data?.error?.message || e?.message || 'Failed to load Claim Susut data'
      setError(msg)
      setRows([])
      setTotalCount(0)
    } finally {
      setLoading(false)
    }
  }

  const loadByGroupOfTransport = async (opts?: { importId?: string }) => {
    const importId = opts?.importId ?? selectedImportId
    if (!importId) {
      setGroupTransportRows([])
      return
    }
    setGroupTransportLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      params.set('importId', importId)
      const res = await api.get(`/claim-susut/by-group-of-transport?${params.toString()}`)
      setGroupTransportRows((res.data?.data || []) as ClaimSusutGroupTransportRow[])
    } catch (e: any) {
      const msg = e?.response?.data?.error?.message || e?.message || 'Failed to load group of transport summary'
      setError(msg)
      setGroupTransportRows([])
    } finally {
      setGroupTransportLoading(false)
    }
  }

  useEffect(() => {
    loadImports().catch((e) => setError(String(e?.message || e)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!selectedImportId) return
    setPage(1)
    loadRows({ importId: selectedImportId, page: 1 }).catch(() => null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedImportId])

  useEffect(() => {
    if (mainTab !== 'group_transport' || !selectedImportId) return
    loadByGroupOfTransport({ importId: selectedImportId }).catch(() => null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mainTab, selectedImportId])

  useEffect(() => {
    if (!selectedImportId) return
    setPage(1)
    loadRows({ importId: selectedImportId, page: 1 }).catch(() => null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortKey, sortDir])

  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (!columnsOpen) return
      if (columnsRef.current && !columnsRef.current.contains(e.target as Node)) setColumnsOpen(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [columnsOpen])

  const onUpload = async () => {
    if (!file) return
    setUploading(true)
    setError(null)
    setUploadSummary(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await api.post('/claim-susut/upload', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      const importId = res.data?.data?.importId
      const totalRows = Number(res.data?.data?.totalRows) || 0
      const insertedRows = Number(res.data?.data?.insertedRows) || 0
      const errors = (res.data?.data?.errors || []) as { rowIndex: number; message: string }[]
      const failedRows = Number(res.data?.data?.failedRows) || Math.max(0, totalRows - insertedRows)
      setUploadSummary({ totalRows, insertedRows, failedRows, errors })
      await loadImports()
      if (importId) setSelectedImportId(importId)
      setFile(null)
    } catch (e: any) {
      const msg = e?.response?.data?.error?.message || e?.message || 'Upload failed'
      setError(msg)
    } finally {
      setUploading(false)
    }
  }

  const toggleSort = (key: string) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else {
      setSortKey(key)
      const numeric = new Set([
        'os_days',
        'qty_claim',
        'amount_before_tax_idr',
        'tax',
        'amount_after_tax_idr',
        'a_0_30',
        'a_31_60',
        'a_61_90',
        'a_gt_90',
      ])
      setSortDir(numeric.has(key) ? 'desc' : 'asc')
    }
  }

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <Link href="/trucking" className="text-sm text-blue-600 hover:underline inline-flex items-center gap-1">
                <ArrowLeft className="h-4 w-4" />
                Back to Trucking
              </Link>
              <Badge variant="outline">SAP Excel</Badge>
            </div>
            <h1 className="text-2xl font-bold text-gray-900 mt-2">Claim Susut</h1>
            <p className="text-sm text-gray-600 mt-1">
              Upload the SAP Claim Susut excel and view outstanding claim rows.
            </p>
          </div>
          <Button
            variant="outline"
            onClick={() => {
              loadImports().catch(() => null)
              if (mainTab === 'group_transport') loadByGroupOfTransport().catch(() => null)
              else loadRows().catch(() => null)
            }}
            disabled={loading || groupTransportLoading}
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
        </div>

        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
            {error}
          </div>
        )}

        {uploadSummary && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Upload result</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                <div className="rounded-md border bg-white p-3">
                  <div className="text-xs text-gray-500">Processed</div>
                  <div className="text-lg font-semibold tabular-nums">{uploadSummary.totalRows.toLocaleString()}</div>
                </div>
                <div className="rounded-md border bg-green-50 p-3">
                  <div className="text-xs text-gray-600">Succeeded</div>
                  <div className="text-lg font-semibold tabular-nums text-green-700">
                    {uploadSummary.insertedRows.toLocaleString()}
                  </div>
                </div>
                <div className="rounded-md border bg-red-50 p-3">
                  <div className="text-xs text-gray-600">Failed</div>
                  <div className="text-lg font-semibold tabular-nums text-red-700">
                    {uploadSummary.failedRows.toLocaleString()}
                  </div>
                </div>
              </div>

              {uploadSummary.errors.length > 0 && (
                <div className="mt-2">
                  <div className="text-sm font-medium text-gray-800 mb-2">Failed rows</div>
                  <div className="overflow-x-auto border rounded-md">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-100">
                        <tr>
                          <th className="px-3 py-2 text-left font-medium text-gray-600">Excel Row</th>
                          <th className="px-3 py-2 text-left font-medium text-gray-600">Reason</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {uploadSummary.errors.slice(0, 200).map((e, idx) => (
                          <tr key={`${e.rowIndex}-${idx}`} className="hover:bg-gray-50">
                            <td className="px-3 py-2 tabular-nums">{e.rowIndex}</td>
                            <td className="px-3 py-2">{e.message}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Upload & Select Import</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-col md:flex-row gap-3 items-start md:items-end">
              <div className="w-full md:w-[420px]">
                <label className="text-sm font-medium text-gray-700 mb-1 block">Excel file (.xlsx)</label>
                <Input type="file" accept=".xlsx,.xls" onChange={(e) => setFile(e.target.files?.[0] || null)} />
              </div>
              <Button onClick={onUpload} disabled={!file || uploading}>
                <Upload className="h-4 w-4 mr-2" />
                {uploading ? 'Uploading…' : 'Upload'}
              </Button>
              <div className="flex-1" />
              <div className="w-full md:w-[420px]">
                {selectedImport && (
                  <div className="mb-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                    <div className="font-semibold text-slate-900">Data for selected import</div>
                    <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <span className="tabular-nums">
                        {formatDateTimeDMY(selectedImport.uploaded_at)}
                      </span>
                      <span className="text-slate-400">·</span>
                      <span className="font-medium text-slate-900">
                        {String(selectedImport.uploaded_by_name || '').trim() ||
                          String(selectedImport.uploaded_by_username || '').trim() ||
                          'Unknown user'}
                      </span>
                    </div>
                  </div>
                )}
                <label className="text-sm font-medium text-gray-700 mb-1 block">Import</label>
                <select
                  value={selectedImportId}
                  onChange={(e) => setSelectedImportId(e.target.value)}
                  className="w-full h-10 border border-gray-300 rounded-md px-3 text-sm bg-white"
                >
                  {imports.map((imp) => (
                    <option key={imp.id} value={imp.id}>
                      {new Date(imp.uploaded_at).toLocaleString('id-ID')} — {imp.file_name} ({imp.inserted_rows}/{imp.total_rows})
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col gap-2 min-w-0">
              <div className="inline-flex rounded-lg border border-gray-200 bg-gray-100 p-0.5 w-fit">
                <button
                  type="button"
                  onClick={() => setMainTab('all')}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                    mainTab === 'all' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  All rows
                </button>
                <button
                  type="button"
                  onClick={() => setMainTab('group_transport')}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                    mainTab === 'group_transport' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  Group of Transport
                </button>
              </div>
              <CardTitle className="text-base">
                {mainTab === 'all' ? (
                  <>
                    Rows{' '}
                    <span className="text-xs font-normal text-gray-500">
                      {loading ? 'Loading…' : `${totalCount.toLocaleString()} total`}
                    </span>
                  </>
                ) : (
                  <>
                    Aging by Group of Transport{' '}
                    <span className="text-xs font-normal text-gray-500">
                      {groupTransportLoading ? 'Loading…' : `${groupTransportRows.length.toLocaleString()} groups`}
                    </span>
                  </>
                )}
              </CardTitle>
            </div>
            <div className="relative" ref={columnsRef}>
              {mainTab === 'all' && (
                <Button type="button" variant="outline" size="sm" onClick={() => setColumnsOpen((o) => !o)}>
                  Columns
                </Button>
              )}
              {columnsOpen && (
                <div className="absolute right-0 mt-2 w-[280px] rounded-md border bg-white shadow-lg z-50">
                  <div className="p-2 border-b text-xs text-gray-600">Toggle columns</div>
                  <div className="max-h-64 overflow-auto p-2 space-y-1">
                    {columns.map((c) => (
                      <label key={c.id} className="flex items-center gap-2 text-sm cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={visibleColumnIds.has(c.id)}
                          onChange={() =>
                            setVisibleColumnIds((prev) => {
                              const next = new Set(prev)
                              if (next.has(c.id)) next.delete(c.id)
                              else next.add(c.id)
                              return next
                            })
                          }
                        />
                        <span className="truncate">{c.label}</span>
                      </label>
                    ))}
                  </div>
                  <div className="p-2 border-t flex items-center justify-between">
                    <Button type="button" variant="ghost" size="sm" onClick={() => setVisibleColumnIds(new Set(defaultVisibleIds))}>
                      Reset
                    </Button>
                    <Button type="button" variant="ghost" size="sm" onClick={() => setColumnsOpen(false)}>
                      Close
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {mainTab === 'group_transport' ? (
              <div className="overflow-x-auto">
                {groupTransportLoading ? (
                  <div className="text-center py-10 text-gray-500">Loading…</div>
                ) : groupTransportRows.length === 0 ? (
                  <div className="text-center py-10 text-gray-500">No data for this import</div>
                ) : (
                  <table className="w-full min-w-[980px] text-sm">
                    <thead className="bg-gray-100">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium text-gray-600">Group of Transport</th>
                        <th className="px-3 py-2 text-right font-medium text-gray-600">Aging 0-30 Days</th>
                        <th className="px-3 py-2 text-right font-medium text-gray-600">Aging 31-60 Days</th>
                        <th className="px-3 py-2 text-right font-medium text-gray-600">Aging 61-90 Days</th>
                        <th className="px-3 py-2 text-right font-medium text-gray-600">Aging &gt; 90 Days</th>
                        <th className="px-3 py-2 text-right font-medium text-gray-800">Grand Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {groupTransportRows.map((g) => (
                        <tr key={g.group_of_transport} className="hover:bg-gray-50">
                          <td className="px-3 py-2 font-medium">{g.group_of_transport}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{money(g.a_0_30)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{money(g.a_31_60)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{money(g.a_61_90)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{money(g.a_gt_90)}</td>
                          <td className="px-3 py-2 text-right tabular-nums font-semibold">{money(g.grand_total)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            ) : (
              <div className="overflow-x-auto">
                {loading ? (
                  <div className="text-center py-10 text-gray-500">Loading…</div>
                ) : rows.length === 0 ? (
                  <div className="text-center py-10 text-gray-500">No rows</div>
                ) : (
                <table className="w-full min-w-[1700px] text-sm">
                  <thead className="bg-gray-100">
                    <tr>
                      {visibleColumns.map((c) => (
                        <th
                          key={c.id}
                          className={`px-3 py-2 font-medium text-gray-600 ${c.align === 'right' ? 'text-right' : 'text-left'}`}
                        >
                          <button
                            type="button"
                            className={`inline-flex items-center gap-1 hover:underline ${c.align === 'right' ? 'justify-end w-full' : ''}`}
                            onClick={() => toggleSort(c.sortKey)}
                          >
                            {c.label} <SortIcon active={sortKey === c.sortKey} dir={sortDir} />
                          </button>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {rows.map((r: any) => (
                      <tr key={r.id} className="hover:bg-gray-50">
                        {visibleColumns.map((c) => {
                          const val = (() => {
                            switch (c.id) {
                              case 'cr_date':
                                return formatDate(r.cr_date)
                              case 'os_days':
                                return r.os_days ?? '-'
                              case 'qty_claim':
                                return num(r.qty_claim)
                              case 'amount_before_tax_idr':
                              case 'amount_after_tax_idr':
                              case 'a_0_30':
                              case 'a_31_60':
                              case 'a_61_90':
                              case 'a_gt_90':
                                return r[c.id] ? money(r[c.id]) : '-'
                              case 'tax':
                                return r.tax ?? '-'
                              default:
                                return r[c.id] || '-'
                            }
                          })()
                          return (
                            <td key={c.id} className={`px-3 py-2 ${c.align === 'right' ? 'text-right tabular-nums' : 'text-left'}`}>
                              {val}
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
                )}
              </div>
            )}

            {!loading && mainTab === 'all' && totalCount > pageSize && (
              <div className="flex items-center justify-between mt-3">
                <div className="text-xs text-gray-600">
                  Page {page} of {Math.max(1, Math.ceil(totalCount / pageSize))}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page <= 1}
                    onClick={async () => {
                      const next = Math.max(1, page - 1)
                      setPage(next)
                      await loadRows({ importId: selectedImportId, page: next })
                    }}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page >= Math.ceil(totalCount / pageSize)}
                    onClick={async () => {
                      const next = Math.min(Math.ceil(totalCount / pageSize), page + 1)
                      setPage(next)
                      await loadRows({ importId: selectedImportId, page: next })
                    }}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </Layout>
  )
}

