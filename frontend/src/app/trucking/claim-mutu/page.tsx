'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import Layout from '@/components/Layout'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Upload, ArrowLeft, RefreshCw, ArrowUp, ArrowDown, Filter as FilterIcon } from 'lucide-react'
import api from '@/lib/api'

type ClaimMutuImport = {
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

type ClaimMutuGroupRow = {
  group_name: string
  row_count: number
  total_amount_after_tax_idr: number
  total_qty_claim_kg: number
  a_lt_30: number
  a_30_60: number
  a_61_90: number
  a_gt_90: number
}

type ClaimMutuRow = {
  id: string
  vendor_code?: string
  vendor_name?: string
  group_name?: string
  cargo_source?: string
  created_by?: string
  sta?: string
  crno?: string
  cr_date?: string
  os_days?: number
  dest?: string
  po_number?: string
  contract_ext_no?: string
  comm?: string
  product?: string
  uom?: string
  currency?: string
  company_code?: string
  mutu_klaim_ffa?: number
  mutu_klaim_mi?: number
  mutu_klaim_dns?: number
  mutu_klaim_dobi?: number
  mutu_klaim_stone?: number
  qty_claim_kg?: number
  amount_after_tax_idr?: number
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
  const t = Date.parse(d)
  if (Number.isNaN(t)) return String(d)
  const dt = new Date(t)
  return dt.toLocaleDateString('id-ID')
}

export default function ClaimMutuPage() {
  const [imports, setImports] = useState<ClaimMutuImport[]>([])
  const [selectedImportId, setSelectedImportId] = useState<string>('')
  const [rows, setRows] = useState<ClaimMutuRow[]>([])
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
  const [visibleColumnIds, setVisibleColumnIds] = useState<Set<string>>(new Set())
  const [columnsOpen, setColumnsOpen] = useState(false)
  const columnsRef = useRef<HTMLDivElement>(null)
  const [columnFilters, setColumnFilters] = useState<Record<string, any>>({})
  const [filterOpenKey, setFilterOpenKey] = useState<string | null>(null)
  const filterRef = useRef<HTMLDivElement>(null)
  const [filterSearch, setFilterSearch] = useState('')
  const [distinctLoading, setDistinctLoading] = useState(false)
  const [distinctOptions, setDistinctOptions] = useState<Record<string, Array<{ value: string; count: number }>>>({})

  const [mainTab, setMainTab] = useState<'all' | 'group'>('all')
  const [groupRows, setGroupRows] = useState<ClaimMutuGroupRow[]>([])
  const [groupLoading, setGroupLoading] = useState(false)

  const selectedImport = useMemo(
    () => imports.find((i) => i.id === selectedImportId),
    [imports, selectedImportId],
  )

  const loadImports = async () => {
    const res = await api.get('/claim-mutu/imports')
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
      if (Object.keys(columnFilters || {}).length > 0) {
        params.set('columnFilters', JSON.stringify(columnFilters))
      }
      const res = await api.get(`/claim-mutu/rows?${params.toString()}`)
      setRows(res.data.data || [])
      setTotalCount(Number(res.data.meta?.totalCount) || 0)
    } catch (e: any) {
      const msg = e?.response?.data?.error?.message || e?.message || 'Failed to load Claim Mutu data'
      setError(msg)
      setRows([])
      setTotalCount(0)
    } finally {
      setLoading(false)
    }
  }

  const loadByGroup = async (opts?: { importId?: string }) => {
    const importId = opts?.importId ?? selectedImportId
    if (!importId) {
      setGroupRows([])
      return
    }
    setGroupLoading(true)
    try {
      const params = new URLSearchParams()
      params.set('importId', importId)
      const res = await api.get(`/claim-mutu/by-group?${params.toString()}`)
      setGroupRows((res.data?.data || []) as ClaimMutuGroupRow[])
    } catch (e: any) {
      const msg = e?.response?.data?.error?.message || e?.message || 'Failed to load group summary'
      setError(msg)
      setGroupRows([])
    } finally {
      setGroupLoading(false)
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

  // Reload on sort change (server-side sort)
  useEffect(() => {
    if (!selectedImportId) return
    setPage(1)
    loadRows({ importId: selectedImportId, page: 1 }).catch(() => null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortKey, sortDir])

  // Reload on filter change
  useEffect(() => {
    if (!selectedImportId) return
    setPage(1)
    loadRows({ importId: selectedImportId, page: 1 }).catch(() => null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columnFilters])

  useEffect(() => {
    if (mainTab !== 'group' || !selectedImportId) return
    loadByGroup({ importId: selectedImportId }).catch(() => null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mainTab, selectedImportId])

  const onUpload = async () => {
    if (!file) return
    setUploading(true)
    setError(null)
    setUploadSummary(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await api.post('/claim-mutu/upload', fd, {
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
        'qty_claim_kg',
        'amount_after_tax_idr',
        'mutu_klaim_ffa',
        'mutu_klaim_mi',
        'mutu_klaim_dns',
        'mutu_klaim_dobi',
        'mutu_klaim_stone',
        'a_lt_30',
        'a_30_60',
        'a_61_90',
        'a_gt_90',
      ])
      setSortDir(numeric.has(key) ? 'desc' : 'asc')
    }
  }

  const SortIcon = ({ active }: { active: boolean }) => {
    if (!active) return null
    return sortDir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
  }

  const columns = useMemo(() => {
    const col = (id: string, label: string, key: string, align: 'left' | 'right' = 'left', defaultVisible = true) => ({
      id,
      label,
      sortKey: key,
      align,
      defaultVisible,
    })
    return [
      col('vendor', 'Vendor', 'vendor', 'left', true),
      col('group_name', 'Group Name', 'group_name', 'left', true),
      col('cargo_source', 'Cargo Source', 'cargo_source', 'left', true),
      col('created_by', 'Created By', 'created_by', 'left', false),
      col('sta', 'STA', 'sta', 'left', false),
      col('crno', 'CRNO', 'crno', 'left', false),
      col('cr_date', 'CR Date', 'cr_date', 'left', true),
      col('os_days', 'OS Days', 'os_days', 'right', true),
      col('dest', 'Dest', 'dest', 'left', false),
      col('po_number', 'PO Number', 'po_number', 'left', true),
      col('contract_ext_no', 'Contract Ext No', 'contract_ext_no', 'left', true),
      col('comm', 'COMM', 'comm', 'left', false),
      col('product', 'Product', 'product', 'left', true),
      col('uom', 'UOM', 'uom', 'left', false),
      col('currency', 'Currency', 'currency', 'left', false),
      col('company_code', 'Company Code', 'company_code', 'left', false),
      col('mutu_klaim_ffa', 'FFA', 'mutu_klaim_ffa', 'right', false),
      col('mutu_klaim_mi', 'M&I', 'mutu_klaim_mi', 'right', false),
      col('mutu_klaim_dns', 'DNS', 'mutu_klaim_dns', 'right', false),
      col('mutu_klaim_dobi', 'DOBI', 'mutu_klaim_dobi', 'right', false),
      col('mutu_klaim_stone', 'STONE', 'mutu_klaim_stone', 'right', false),
      col('qty_claim_kg', 'Qty Claim (Kg)', 'qty_claim_kg', 'right', true),
      col('amount_after_tax_idr', 'Amount (IDR)', 'amount_after_tax_idr', 'right', true),
      col('a_lt_30', 'Aging < 30', 'a_lt_30', 'right', true),
      col('a_30_60', 'Aging 30–60', 'a_30_60', 'right', true),
      col('a_61_90', 'Aging 61–90', 'a_61_90', 'right', true),
      col('a_gt_90', 'Aging > 90', 'a_gt_90', 'right', true),
    ]
  }, [])

  const defaultVisibleIds = useMemo(() => columns.filter((c) => c.defaultVisible).map((c) => c.id), [columns])

  useEffect(() => {
    const key = 'claimMutu.visibleColumns.v1'
    try {
      const raw = localStorage.getItem(key)
      if (raw) {
        const parsed = JSON.parse(raw) as string[]
        if (Array.isArray(parsed) && parsed.length > 0) {
          setVisibleColumnIds(new Set(parsed))
        }
      }
    } catch {}
    // Seed with defaults while we fetch server preference
    setVisibleColumnIds((prev) => (prev.size > 0 ? prev : new Set(defaultVisibleIds)))

    // Load per-user preference from server (falls back to existing localStorage/defaults)
    ;(async () => {
      try {
        const res = await api.get(`/user-preferences/me?key=${encodeURIComponent('claim_mutu.visible_columns')}`)
        const value = res.data?.data?.value
        const arr = Array.isArray(value) ? value : (Array.isArray(value?.columns) ? value.columns : null)
        if (Array.isArray(arr) && arr.length > 0) {
          setVisibleColumnIds(new Set(arr.map((x: any) => String(x))))
        }
      } catch {
        // ignore; localStorage/defaults already applied
      }
    })()
  }, [defaultVisibleIds])

  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (!columnsOpen) return
      if (columnsRef.current && !columnsRef.current.contains(e.target as Node)) setColumnsOpen(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [columnsOpen])

  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (!filterOpenKey) return
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) setFilterOpenKey(null)
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [filterOpenKey])

  useEffect(() => {
    if (!filterOpenKey) setFilterSearch('')
  }, [filterOpenKey])

  const isMultiFilterColumn = (k: string) =>
    new Set(['group_name', 'product', 'company_code', 'dest', 'vendor', 'cargo_source']).has(k)

  useEffect(() => {
    const key = filterOpenKey
    if (!key) return
    if (!isMultiFilterColumn(key)) return
    if (!selectedImportId) return

    let cancelled = false
    const run = async () => {
      try {
        setDistinctLoading(true)
        const params = new URLSearchParams()
        params.set('importId', selectedImportId)
        params.set('column', key)
        if (filterSearch.trim()) params.set('q', filterSearch.trim())
        params.set('limit', '250')
        const res = await api.get(`/claim-mutu/distinct-values?${params.toString()}`)
        if (cancelled) return
        const values = (res.data?.data?.values || []) as Array<{ value: string; count: number }>
        setDistinctOptions((prev) => ({ ...(prev || {}), [key]: values }))
      } catch {
        if (cancelled) return
        setDistinctOptions((prev) => ({ ...(prev || {}), [key]: [] }))
      } finally {
        if (!cancelled) setDistinctLoading(false)
      }
    }
    run()
    return () => {
      cancelled = true
    }
  }, [filterOpenKey, filterSearch, selectedImportId])

  const visibleColumns = useMemo(() => columns.filter((c) => visibleColumnIds.has(c.id)), [columns, visibleColumnIds])

  const toggleColumn = (id: string) => {
    setVisibleColumnIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      const key = 'claimMutu.visibleColumns.v1'
      try {
        localStorage.setItem(key, JSON.stringify(Array.from(next)))
      } catch {}
      // Persist per-user preference (best effort)
      ;(async () => {
        try {
          await api.post('/user-preferences/me', { key: 'claim_mutu.visible_columns', value: Array.from(next) })
        } catch {
          // ignore; localStorage is still updated
        }
      })()
      return next
    })
  }

  const setFilter = (key: string, value: any) => {
    setColumnFilters((prev) => {
      const next = { ...(prev || {}) }
      if (!value || (typeof value === 'object' && Object.values(value).every((v) => v == null || String(v).trim() === ''))) {
        delete next[key]
      } else {
        next[key] = value
      }
      return next
    })
  }

  const clearAllFilters = () => setColumnFilters({})

  const toggleMultiValue = (key: string, v: string) => {
    const cur = columnFilters?.[key] || {}
    const values = new Set<string>((cur.values || []) as string[])
    if (values.has(v)) values.delete(v)
    else values.add(v)
    setFilter(key, { type: 'multi', values: Array.from(values), includeBlank: Boolean(cur.includeBlank) })
  }

  const setMultiAllDisplayed = (key: string, checked: boolean) => {
    const opts = distinctOptions?.[key] || []
    const cur = columnFilters?.[key] || {}
    if (!checked) {
      setFilter(key, { type: 'multi', values: [], includeBlank: Boolean(cur.includeBlank) })
      return
    }
    setFilter(key, { type: 'multi', values: opts.map((o) => o.value), includeBlank: Boolean(cur.includeBlank) })
  }

  const toggleIncludeBlank = (key: string) => {
    const cur = columnFilters?.[key] || {}
    setFilter(key, { type: 'multi', values: (cur.values || []) as string[], includeBlank: !Boolean(cur.includeBlank) })
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
            <h1 className="text-2xl font-bold text-gray-900 mt-2">Claim Mutu</h1>
            <p className="text-sm text-gray-600 mt-1">
              Upload the SAP OSCLAIM excel and view outstanding claim quality rows.
            </p>
          </div>
          <Button
            variant="outline"
            onClick={() => {
              loadImports().catch(() => null)
              if (mainTab === 'group') loadByGroup().catch(() => null)
              else loadRows().catch(() => null)
            }}
            disabled={loading || groupLoading}
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
                  {uploadSummary.errors.length > 200 && (
                    <div className="text-[11px] text-gray-500 mt-1">
                      Showing first 200 errors.
                    </div>
                  )}
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
                <Input
                  type="file"
                  accept=".xlsx,.xls"
                  onChange={(e) => setFile(e.target.files?.[0] || null)}
                />
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
                      <span>
                        {new Date(selectedImport.uploaded_at).toLocaleDateString('id-ID', {
                          weekday: 'short',
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                        })}
                      </span>
                      <span className="text-slate-400">·</span>
                      <span className="tabular-nums">
                        {new Date(selectedImport.uploaded_at).toLocaleTimeString('id-ID', {
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit',
                        })}
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
                  onClick={() => setMainTab('group')}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                    mainTab === 'group' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  By Group Name
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
                    Summary by Group Name{' '}
                    <span className="text-xs font-normal text-gray-500">
                      {groupLoading ? 'Loading…' : `${groupRows.length.toLocaleString()} groups`}
                    </span>
                  </>
                )}
              </CardTitle>
            </div>
            <div className="relative" ref={columnsRef}>
              <div className="flex items-center gap-2">
                {mainTab === 'all' && (
                  <>
                    <Button type="button" variant="outline" size="sm" onClick={clearAllFilters} disabled={Object.keys(columnFilters).length === 0}>
                      Clear Filters
                    </Button>
                    <Button type="button" variant="outline" size="sm" onClick={() => setColumnsOpen((o) => !o)}>
                      Columns
                    </Button>
                  </>
                )}
              </div>
              {columnsOpen && (
                <div className="absolute right-0 mt-2 w-[280px] rounded-md border bg-white shadow-lg z-50">
                  <div className="p-2 border-b text-xs text-gray-600">
                    Toggle columns (saved in browser)
                  </div>
                  <div className="max-h-64 overflow-auto p-2 space-y-1">
                    {columns.map((c) => (
                      <label key={c.id} className="flex items-center gap-2 text-sm cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={visibleColumnIds.has(c.id)}
                          onChange={() => toggleColumn(c.id)}
                        />
                        <span className="truncate">{c.label}</span>
                      </label>
                    ))}
                  </div>
                  <div className="p-2 border-t flex items-center justify-between">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setVisibleColumnIds(new Set(defaultVisibleIds))}
                    >
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
            {mainTab === 'group' ? (
              <div className="overflow-x-auto">
                {groupLoading ? (
                  <div className="text-center py-10 text-gray-500">Loading…</div>
                ) : groupRows.length === 0 ? (
                  <div className="text-center py-10 text-gray-500">No data for this import</div>
                ) : (
                  <table className="w-full min-w-[960px] text-sm">
                    <thead className="bg-gray-100">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium text-gray-600">Group Name</th>
                        <th className="px-3 py-2 text-right font-medium text-gray-600">Rows</th>
                        <th className="px-3 py-2 text-right font-medium text-gray-600">Qty Claim (Kg)</th>
                        <th className="px-3 py-2 text-right font-medium text-gray-600">Amount After Tax (IDR)</th>
                        <th className="px-3 py-2 text-right font-medium text-gray-600">Aging &lt; 30 Days</th>
                        <th className="px-3 py-2 text-right font-medium text-gray-600">Aging 30 – 60 Days</th>
                        <th className="px-3 py-2 text-right font-medium text-gray-600">Aging 61 – 90 Days</th>
                        <th className="px-3 py-2 text-right font-medium text-gray-600">Aging &gt; 90 Days</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {groupRows.map((g) => (
                        <tr key={g.group_name} className="hover:bg-gray-50">
                          <td className="px-3 py-2 font-medium">{g.group_name}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{Number(g.row_count).toLocaleString('id-ID')}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{num(g.total_qty_claim_kg)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{money(g.total_amount_after_tax_idr)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{money(g.a_lt_30)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{money(g.a_30_60)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{money(g.a_61_90)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{money(g.a_gt_90)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            ) : (
            <>
            <div className="overflow-x-auto">
              {loading ? (
                <div className="text-center py-10 text-gray-500">Loading…</div>
              ) : rows.length === 0 ? (
                <div className="text-center py-10 text-gray-500">No rows</div>
              ) : (
                <table className="w-full min-w-[1400px] text-sm">
                  <thead className="bg-gray-100">
                    <tr>
                      {visibleColumns.map((c) => (
                        <th
                          key={c.id}
                          className={`relative px-3 py-2 font-medium text-gray-600 ${c.align === 'right' ? 'text-right' : 'text-left'}`}
                        >
                          <div className={`flex items-center gap-2 ${c.align === 'right' ? 'justify-end' : 'justify-start'}`}>
                            <button
                              type="button"
                              className={`inline-flex items-center gap-1 hover:underline ${c.align === 'right' ? 'justify-end' : ''}`}
                              onClick={() => toggleSort(c.sortKey)}
                            >
                              {c.label} <SortIcon active={sortKey === c.sortKey} />
                            </button>
                            <button
                              type="button"
                              className={`p-1 rounded hover:bg-gray-200 ${columnFilters?.[c.sortKey] ? 'bg-blue-100 text-blue-700' : 'text-gray-500'}`}
                              onClick={() => setFilterOpenKey((k) => (k === c.sortKey ? null : c.sortKey))}
                              title="Filter"
                            >
                              <FilterIcon className="h-3 w-3" />
                            </button>
                            {filterOpenKey === c.sortKey && (
                              <div ref={filterRef} className="absolute z-50 mt-2 rounded-md border bg-white shadow-lg p-3 w-[260px]">
                                {(() => {
                                  const f = columnFilters?.[c.sortKey] || {}
                                  if (isMultiFilterColumn(c.sortKey)) {
                                    const opts = distinctOptions?.[c.sortKey] || []
                                    const selected = new Set<string>((f.values || []) as string[])
                                    const allDisplayedSelected = opts.length > 0 && opts.every((o) => selected.has(o.value))
                                    return (
                                      <div className="space-y-2">
                                        <div className="text-xs font-medium text-gray-700">Filter values</div>
                                        <Input
                                          placeholder="Search..."
                                          value={filterSearch}
                                          onChange={(e) => setFilterSearch(e.target.value)}
                                        />
                                        <label className="flex items-center gap-2 text-xs text-gray-700 select-none">
                                          <input type="checkbox" checked={Boolean(f.includeBlank)} onChange={() => toggleIncludeBlank(c.sortKey)} />
                                          Include blanks
                                        </label>
                                        <label className="flex items-center gap-2 text-xs text-gray-700 select-none">
                                          <input
                                            type="checkbox"
                                            checked={allDisplayedSelected}
                                            onChange={(e) => setMultiAllDisplayed(c.sortKey, e.target.checked)}
                                          />
                                          Select all (shown)
                                        </label>
                                        <div className="max-h-48 overflow-auto rounded border">
                                          {distinctLoading ? (
                                            <div className="p-2 text-xs text-gray-500">Loading…</div>
                                          ) : opts.length === 0 ? (
                                            <div className="p-2 text-xs text-gray-500">No values</div>
                                          ) : (
                                            <div className="p-1 space-y-1">
                                              {opts.map((o) => (
                                                <label
                                                  key={o.value}
                                                  className="flex items-center justify-between gap-2 text-xs px-2 py-1 rounded hover:bg-gray-50 cursor-pointer select-none"
                                                >
                                                  <span className="flex items-center gap-2 min-w-0">
                                                    <input
                                                      type="checkbox"
                                                      checked={selected.has(o.value)}
                                                      onChange={() => toggleMultiValue(c.sortKey, o.value)}
                                                    />
                                                    <span className="truncate">{o.value}</span>
                                                  </span>
                                                  <span className="tabular-nums text-gray-500">{o.count.toLocaleString()}</span>
                                                </label>
                                              ))}
                                            </div>
                                          )}
                                        </div>
                                        <div className="flex items-center justify-between">
                                          <Button variant="ghost" size="sm" onClick={() => setFilter(c.sortKey, null)}>
                                            Clear
                                          </Button>
                                          <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => {
                                              setFilterSearch('')
                                              setFilterOpenKey(null)
                                            }}
                                          >
                                            Done
                                          </Button>
                                        </div>
                                      </div>
                                    )
                                  }
                                  if (c.sortKey === 'cr_date') {
                                    return (
                                      <div className="space-y-2">
                                        <div className="text-xs font-medium text-gray-700">Date filter</div>
                                        <Input
                                          type="date"
                                          value={String(f.from || '')}
                                          onChange={(e) => setFilter(c.sortKey, { type: 'date', from: e.target.value, to: f.to || '' })}
                                        />
                                        <Input
                                          type="date"
                                          value={String(f.to || '')}
                                          onChange={(e) => setFilter(c.sortKey, { type: 'date', from: f.from || '', to: e.target.value })}
                                        />
                                        <div className="flex items-center justify-between">
                                          <Button variant="ghost" size="sm" onClick={() => setFilter(c.sortKey, null)}>
                                            Clear
                                          </Button>
                                          <Button variant="outline" size="sm" onClick={() => setFilterOpenKey(null)}>
                                            Done
                                          </Button>
                                        </div>
                                      </div>
                                    )
                                  }
                                  const numericKeys = new Set([
                                    'os_days',
                                    'qty_claim_kg',
                                    'amount_after_tax_idr',
                                    'mutu_klaim_ffa',
                                    'mutu_klaim_mi',
                                    'mutu_klaim_dns',
                                    'mutu_klaim_dobi',
                                    'mutu_klaim_stone',
                                    'a_lt_30',
                                    'a_30_60',
                                    'a_61_90',
                                    'a_gt_90',
                                  ])
                                  if (numericKeys.has(c.sortKey)) {
                                    return (
                                      <div className="space-y-2">
                                        <div className="text-xs font-medium text-gray-700">Number filter</div>
                                        <Input
                                          placeholder="Min"
                                          value={String(f.min || '')}
                                          onChange={(e) => setFilter(c.sortKey, { type: 'number', min: e.target.value, max: f.max || '' })}
                                        />
                                        <Input
                                          placeholder="Max"
                                          value={String(f.max || '')}
                                          onChange={(e) => setFilter(c.sortKey, { type: 'number', min: f.min || '', max: e.target.value })}
                                        />
                                        <div className="flex items-center justify-between">
                                          <Button variant="ghost" size="sm" onClick={() => setFilter(c.sortKey, null)}>
                                            Clear
                                          </Button>
                                          <Button variant="outline" size="sm" onClick={() => setFilterOpenKey(null)}>
                                            Done
                                          </Button>
                                        </div>
                                      </div>
                                    )
                                  }
                                  return (
                                    <div className="space-y-2">
                                      <div className="text-xs font-medium text-gray-700">Text filter</div>
                                      <Input
                                        placeholder="Contains..."
                                        value={String(f.value || '')}
                                        onChange={(e) => setFilter(c.sortKey, { type: 'text', value: e.target.value })}
                                      />
                                      <div className="flex items-center justify-between">
                                        <Button variant="ghost" size="sm" onClick={() => setFilter(c.sortKey, null)}>
                                          Clear
                                        </Button>
                                        <Button variant="outline" size="sm" onClick={() => setFilterOpenKey(null)}>
                                          Done
                                        </Button>
                                      </div>
                                    </div>
                                  )
                                })()}
                              </div>
                            )}
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {rows.map((r: any) => {
                      return (
                        <tr key={r.id} className="hover:bg-gray-50">
                          {visibleColumns.map((c) => {
                            const cell = (() => {
                              switch (c.id) {
                                case 'vendor':
                                  return (
                                    <div>
                                      <div className="font-medium">{r.vendor_name || '-'}</div>
                                      <div className="text-[11px] text-gray-500">{r.vendor_code || '-'}</div>
                                    </div>
                                  )
                                case 'cr_date':
                                  return formatDate(r.cr_date)
                                case 'os_days':
                                  return r.os_days ?? '-'
                                case 'qty_claim_kg':
                                  return num(r.qty_claim_kg)
                                case 'amount_after_tax_idr':
                                  return money(r.amount_after_tax_idr)
                                case 'a_lt_30':
                                case 'a_30_60':
                                case 'a_61_90':
                                case 'a_gt_90':
                                  return r[c.id] ? money(r[c.id]) : '-'
                                case 'mutu_klaim_ffa':
                                case 'mutu_klaim_mi':
                                case 'mutu_klaim_dns':
                                case 'mutu_klaim_dobi':
                                case 'mutu_klaim_stone':
                                  return r[c.id] ?? '-'
                                default:
                                  return r[c.id] || '-'
                              }
                            })()

                            return (
                              <td
                                key={c.id}
                                className={`px-3 py-2 ${c.align === 'right' ? 'text-right tabular-nums' : 'text-left'}`}
                              >
                                {cell}
                              </td>
                            )
                          })}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>

            {!loading && totalCount > pageSize && (
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
            </>
            )}
          </CardContent>
        </Card>
      </div>
    </Layout>
  )
}

