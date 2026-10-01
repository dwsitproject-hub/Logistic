'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import Layout from '@/components/Layout'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  LIST_FILTER_FIELD_LABEL_CLASS,
  ListFilterPanel,
  LIST_FILTER_FIELDS_ROW_CLASS,
} from '@/components/shared/ListFilterPanel'
import { StitchFields } from '@/components/shared/stitchField'
import { StitchSearchIcon } from '@/components/shared/stitchIcons'
import { ListPageColumnsMenu } from '@/components/shared/ListPageColumnsMenu'
import { MasterListCompactTable, type MasterListTableColumn } from '@/components/shared/MasterListCompactTable'
import { useListColumnLayout } from '@/lib/listColumnLayout'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import api from '@/lib/api'
import { Plus } from 'lucide-react'
import { MasterDhmSyncButton } from '@/components/shared/MasterDhmSyncButton'
import { MasterRowActions } from '@/components/shared/MasterRowActions'
import { dhmStatusListColumn } from '@/lib/dhmStatusColumn'
import { saveWithDhmConfirm } from '@/lib/dhmMasterSave'
import * as XLSX from 'xlsx'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

interface MasterPlant {
  id: string
  company_code?: string | null
  company_name: string
  plant_code: string
  plant_name: string | null
  plant_type: string | null
  site?: string | null
  site_id?: string | null
  city: string | null
  postal_code: string | null
  found_in?: string | null
  code_klip?: string | null
  code_dhm?: string | null
  dhm_id?: string | null
  dhm_org_code?: string | null
  group_plant: string | null
}

function plantCell(value: string | null | undefined): string {
  return value && value.trim() ? value : '-'
}

const PLANT_COLUMNS: MasterListTableColumn<MasterPlant>[] = [
  { id: 'code_klip', label: 'Plant Code (KLIP)', getText: (row) => plantCell(row.code_klip) },
  { id: 'code_dhm', label: 'Plant Code (DHM)', getText: (row) => plantCell(row.code_dhm) },
  { id: 'plant_code', label: 'Plant Code (SAP)', getText: (row) => plantCell(row.plant_code) },
  { id: 'plant_name', label: 'Plant Name', getText: (row) => plantCell(row.plant_name) },
  { id: 'plant_type', label: 'Plant Type', getText: (row) => plantCell(row.plant_type) },
  { id: 'site', label: 'Site', getText: (row) => plantCell(row.site) },
  dhmStatusListColumn<MasterPlant>(),
]

export default function MasterPlantPage() {
  const [items, setItems] = useState<MasterPlant[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const PAGE_SIZE = 20
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState('plant_name')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const plantColumns = useListColumnLayout('master-plant.visibleColumns.v4', PLANT_COLUMNS)
  const debouncedSearch = useDebouncedValue(search.trim(), 300)
  const [isAdmin, setIsAdmin] = useState(false)
  const [editing, setEditing] = useState<MasterPlant | null>(null)
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [sites, setSites] = useState<Array<{ id: string; site_name: string }>>([])
  const [form, setForm] = useState<Partial<MasterPlant>>({})
  const [uploadResult, setUploadResult] = useState<{
    total: number
    success: number
    inserted: number
    updated: number
    failed: number
    errors: Array<{ row: number; plant_code: string; reason: string }>
  } | null>(null)

  const fetchData = useCallback(async (pageNum: number, searchQuery: string) => {
    try {
      setLoading(true)
      const params = new URLSearchParams()
      params.set('page', String(pageNum))
      params.set('limit', String(PAGE_SIZE))
      if (searchQuery.length >= 2) params.set('search', searchQuery)
      const res = await api.get('/master-plants', { params })
      setItems(res.data?.data?.items || [])
      setTotal(res.data?.data?.pagination?.total ?? 0)
    } catch (err) {
      console.error('Failed to load master plants', err)
      alert('Failed to load master plants')
    } finally {
      setLoading(false)
    }
  }, [PAGE_SIZE])

  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / PAGE_SIZE)), [total, PAGE_SIZE])

  const skipSearchPageReset = useRef(true)
  useEffect(() => {
    if (skipSearchPageReset.current) {
      skipSearchPageReset.current = false
      return
    }
    setPage(1)
  }, [debouncedSearch])

  useEffect(() => {
    void fetchData(page, debouncedSearch)
  }, [page, debouncedSearch, fetchData])

  useEffect(() => {
    try {
      const u = JSON.parse(localStorage.getItem('user') || 'null')
      setIsAdmin(String(u?.role || '').toUpperCase() === 'ADMIN')
    } catch {
      setIsAdmin(false)
    }
  }, [])

  useEffect(() => {
    if (!isFormOpen) return
    let cancelled = false
    void api.get('/master-sites', { params: { page: 1, limit: 500 } }).then((res) => {
      if (cancelled) return
      const rows = (res.data?.data?.items || []) as Array<{ id: string; site_name?: string | null }>
      setSites(rows.filter((row) => row.site_name).map((row) => ({ id: row.id, site_name: String(row.site_name) })))
    }).catch(() => {
      if (!cancelled) setSites([])
    })
    return () => { cancelled = true }
  }, [isFormOpen])

  const handlePageChange = (newPage: number) => {
    if (newPage >= 1 && newPage <= totalPages) setPage(newPage)
  }

  const emptyForm = (): Partial<MasterPlant> => ({
    company_code: '',
    company_name: '',
    plant_code: '',
    plant_name: '',
    plant_type: '',
    site: '',
    city: '',
    postal_code: '',
    found_in: '',
    code_klip: '',
    code_dhm: '',
    dhm_org_code: '',
  })

  const openNew = () => {
    setEditing(null)
    setForm(emptyForm())
    setIsFormOpen(true)
  }

  const openEdit = (p: MasterPlant) => {
    setEditing(p)
    setForm({
      company_code: p.company_code ?? '',
      company_name: p.company_name,
      plant_code: p.plant_code,
      plant_name: p.plant_name ?? '',
      plant_type: p.plant_type ?? '',
      site: p.site ?? '',
      site_id: p.site_id ?? '',
      city: p.city ?? '',
      postal_code: p.postal_code ?? '',
      found_in: p.found_in ?? '',
      code_klip: p.code_klip ?? '',
      code_dhm: p.code_dhm ?? '',
      dhm_org_code: p.dhm_org_code ?? '',
    })
    setIsFormOpen(true)
  }

  const handleChange = (field: keyof MasterPlant, value: any) => {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  const handleSubmit = async () => {
    try {
      if (!form.plant_code || !String(form.plant_code).trim()) {
        alert('Plant Code is required')
        return
      }
      const payload = {
        plant_code: String(form.plant_code).trim(),
        plant_name: String(form.plant_name ?? '').trim() || null,
        plant_type: String(form.plant_type ?? '').trim() || null,
        site_id: form.site_id || null,
      }
      const persist = (overwrite: boolean) => {
        const qs = overwrite ? '?dhmOverwrite=true' : ''
        if (editing) return api.put(`/master-plants/${editing.id}${qs}`, payload)
        return api.post(`/master-plants${qs}`, payload)
      }
      await saveWithDhmConfirm(persist, 'plant')
      setEditing(null)
      setForm({})
      setIsFormOpen(false)
      await fetchData(page, debouncedSearch)
    } catch (err: any) {
      console.error('Save master plant error', err)
      const msg = err?.response?.data?.error?.message || 'Failed to save master plant'
      alert(msg)
    }
  }

  const handleDelete = async (p: MasterPlant) => {
    if (!isAdmin) return
    const ok = confirm(`Delete plant?\n\n${p.company_name} - ${p.plant_code}`)
    if (!ok) return
    try {
      await api.delete(`/master-plants/${p.id}`)
      await fetchData(page, debouncedSearch)
    } catch (err: any) {
      console.error('Delete master plant error', err)
      const msg = err?.response?.data?.error?.message || 'Failed to delete master plant'
      alert(msg)
    }
  }

  const normalize = (v: unknown) => String(v ?? '').trim()

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const buf = await file.arrayBuffer()
      const wb = XLSX.read(buf, { type: 'array' })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const raw = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true }) as any[][]

      // Auto-detect header row (first row with "Company" or "Plant" in any cell)
      let headerRowIdx = 0
      for (let i = 0; i < Math.min(raw.length, 5); i++) {
        const rowStr = (raw[i] || []).map((c: any) => String(c ?? '').toLowerCase()).join(' ')
        if (rowStr.includes('company') || rowStr.includes('plant')) {
          headerRowIdx = i
          break
        }
      }

      const headers = (raw[headerRowIdx] || []).map((h: any) => String(h ?? '').toLowerCase().trim())
      const dataRows = raw.slice(headerRowIdx + 1)

      if (dataRows.length === 0) {
        alert('File has no data rows')
        return
      }

      // Map columns by header name first, then fall back to positional (A–G)
      const colIdx = (names: string[], fallback: number): number => {
        const idx = headers.findIndex((h) => names.some((n) => h.includes(n)))
        return idx >= 0 ? idx : fallback
      }

      const iCompany   = colIdx(['company'], 0)
      const iCode      = colIdx(['plant code', 'code'], 1)
      const iName      = colIdx(['plant name', 'name'], 2)
      const iPostal    = colIdx(['postal'], 3)
      const iCity      = colIdx(['city'], 4)
      const iType      = colIdx(['plant type', 'type'], 5)
      const iGroup     = colIdx(['group'], 6)

      const parsed = dataRows.map((r, idx) => {
        const col = (i: number) => normalize(r?.[i])
        return {
          _row: headerRowIdx + idx + 2,
          company_name: col(iCompany),
          plant_code:   col(iCode),
          plant_name:   col(iName)   || null,
          postal_code:  col(iPostal) || null,
          city:         col(iCity)   || null,
          plant_type:   col(iType)   || null,
          group_plant:  col(iGroup)  || null,
        }
      })

      const payloadRows = parsed
        .filter((r) => r.company_name || r.plant_code)
        .filter((r) => r.company_name.trim() !== '' || r.plant_code.trim() !== '')
        .map(({ _row, ...rest }) => rest)

      if (payloadRows.length === 0) {
        alert('No valid rows found (check Company Name / Plant Code columns)')
        return
      }

      const BATCH_SIZE = 50
      let totalInserted = 0
      let totalUpdated = 0
      let totalFailed = 0
      const allErrors: Array<{ row: number; plant_code: string; reason: string }> = []

      for (let offset = 0; offset < payloadRows.length; offset += BATCH_SIZE) {
        const chunk = payloadRows.slice(offset, offset + BATCH_SIZE)
        const res = await api.post('/master-plants/upload', { rows: chunk })
        const data = res.data?.data
        if (data) {
          totalInserted += data.inserted ?? 0
          totalUpdated += data.updated ?? 0
          totalFailed += data.failed ?? 0
          if (Array.isArray(data.errors)) {
            allErrors.push(...data.errors)
          }
        } else {
          totalInserted += chunk.length
        }
      }

      setUploadResult({
        total: payloadRows.length,
        success: totalInserted + totalUpdated,
        inserted: totalInserted,
        updated: totalUpdated,
        failed: totalFailed,
        errors: allErrors,
      })

      await fetchData(page, debouncedSearch)
    } catch (err: any) {
      console.error('Upload master plant file error', err)
      const msg =
        err?.response?.data?.error?.message ||
        err?.response?.data?.message ||
        err?.message ||
        'Failed to parse or upload file'
      alert(msg)
    } finally {
      e.target.value = ''
    }
  }

  return (
    <Layout>
      <StitchFields>
      <div className="space-y-6">
        <p className="text-gray-600">Maintain internal companies and reconcile them with DHM.</p>

        <ListFilterPanel
          onReset={() => setSearch('')}
          showReset={search.trim().length > 0}
          chips={
            debouncedSearch
              ? [{ id: 'search', label: `Search: ${debouncedSearch}`, onRemove: () => setSearch('') }]
              : []
          }
        >
          <div className={LIST_FILTER_FIELDS_ROW_CLASS}>
            <div className="min-w-[12rem] flex-[1.4]">
              <label className={LIST_FILTER_FIELD_LABEL_CLASS}>Search</label>
              <div className="relative">
                <StitchSearchIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  placeholder="Company, Plant Code, Plant Name, City, Type, or Group"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="rounded-lg border-slate-200 pl-10 text-slate-700 placeholder:text-slate-400 focus-visible:ring-blue-600"
                />
              </div>
            </div>
            {isAdmin ? (
              <div className="flex shrink-0 items-end gap-2">
                <Button size="sm" className="shrink-0" onClick={openNew}>
                  <Plus className="h-4 w-4 mr-2" />
                  New Company
                </Button>
                <MasterDhmSyncButton master="plant" onDone={() => void fetchData(page, debouncedSearch)} />
              </div>
            ) : null}
          </div>
        </ListFilterPanel>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle className="text-base flex items-center gap-2 flex-wrap">
                  <span>All Plant</span>
                </CardTitle>
                <p className="text-xs text-gray-500 mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0">
                  <span className="whitespace-nowrap tabular-nums text-gray-700">
                    <span className="font-semibold">{total.toLocaleString('en-US')}</span> plants
                  </span>
                  <span className="text-gray-400" aria-hidden>·</span>
                  <span className="whitespace-nowrap tabular-nums">
                    Page {page}/{totalPages} · {items.length} rows
                  </span>
                </p>
              </div>
              <div className="flex items-center gap-2">
                <ListPageColumnsMenu
                  columns={plantColumns.menuColumns}
                  visibleIds={plantColumns.visibleIds}
                  disabled={loading}
                  onToggle={plantColumns.toggle}
                  onSelectAll={plantColumns.selectAll}
                  onUnselectAll={plantColumns.unselectAll}
                  onReset={plantColumns.reset}
                  onReorder={plantColumns.reorder}
                />
              {totalPages > 1 ? (
                <div className="flex items-center gap-2 border-l border-gray-200 pl-2 ml-1">
                  <Button variant="outline" size="sm" onClick={() => handlePageChange(page - 1)} disabled={page <= 1}>
                    Previous
                  </Button>
                  {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                    let pageNum: number
                    if (totalPages <= 5) pageNum = i + 1
                    else if (page <= 3) pageNum = i + 1
                    else if (page >= totalPages - 2) pageNum = totalPages - 4 + i
                    else pageNum = page - 2 + i
                    return (
                      <Button
                        key={pageNum}
                        variant={page === pageNum ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => handlePageChange(pageNum)}
                        className="min-w-[40px]"
                      >
                        {pageNum}
                      </Button>
                    )
                  })}
                  <Button variant="outline" size="sm" onClick={() => handlePageChange(page + 1)} disabled={page >= totalPages}>
                    Next
                  </Button>
                </div>
              ) : null}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <MasterListCompactTable
              tightActions
              fitContent
              rows={[...items].sort((a, b) => {
                const col = PLANT_COLUMNS.find((item) => item.id === sortKey)
                const cmp = (col?.getText(a) ?? '').localeCompare(col?.getText(b) ?? '', undefined, { numeric: true })
                return sortDir === 'asc' ? cmp : -cmp
              })}
              columns={PLANT_COLUMNS.filter((col) => plantColumns.orderedVisibleIds.includes(col.id)).sort(
                (a, b) => plantColumns.orderedVisibleIds.indexOf(a.id) - plantColumns.orderedVisibleIds.indexOf(b.id),
              )}
              getRowId={(row) => row.id}
              sortKey={sortKey}
              sortDir={sortDir}
              dragColId={plantColumns.dragColId}
              loading={loading}
              emptyLabel="No plants found"
              onSort={(id) => {
                setSortDir((dir) => (sortKey === id ? (dir === 'asc' ? 'desc' : 'asc') : 'asc'))
                setSortKey(id)
              }}
              onDragStart={plantColumns.setDragColId}
              onDragEnd={() => plantColumns.setDragColId(null)}
              onDrop={(id) => {
                if (plantColumns.dragColId) plantColumns.reorder(plantColumns.dragColId, id)
                plantColumns.setDragColId(null)
              }}
              renderActions={(p) => (
                <MasterRowActions
                  isAdmin={isAdmin}
                  editLabel={isAdmin ? 'Edit company' : 'View company'}
                  deleteLabel="Delete company"
                  onEdit={() => openEdit(p)}
                  onDelete={() => void handleDelete(p)}
                />
              )}
            />
          </CardContent>
        </Card>
      </div>

      {/* Upload result dialog */}
      <Dialog open={!!uploadResult} onOpenChange={(open) => !open && setUploadResult(null)}>
        <DialogContent className="sm:max-w-xl max-h-[85vh]">
          <DialogHeader>
            <DialogTitle>Upload Result</DialogTitle>
          </DialogHeader>
          {uploadResult && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div><span className="text-gray-600">Records found:</span> <strong>{uploadResult.total}</strong></div>
                <div><span className="text-gray-600">Success:</span>{' '}<strong className="text-green-600">{uploadResult.success}</strong></div>
                <div><span className="text-gray-600">Inserted:</span> {uploadResult.inserted}</div>
                <div><span className="text-gray-600">Updated:</span> {uploadResult.updated}</div>
                <div>
                  <span className="text-gray-600">Failed:</span>{' '}
                  <strong className={uploadResult.failed ? 'text-red-600' : ''}>{uploadResult.failed}</strong>
                </div>
              </div>
              {uploadResult.errors.length > 0 && (
                <div>
                  <p className="text-sm font-medium text-gray-700 mb-2">Failed records:</p>
                  <div className="border rounded overflow-x-auto max-h-60 overflow-y-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-gray-100">
                          <th className="text-left px-2 py-1.5">Row</th>
                          <th className="text-left px-2 py-1.5">Plant Code</th>
                          <th className="text-left px-2 py-1.5">Reason</th>
                        </tr>
                      </thead>
                      <tbody>
                        {uploadResult.errors.map((er, i) => (
                          <tr key={i} className="border-t">
                            <td className="px-2 py-1.5">{er.row}</td>
                            <td className="px-2 py-1.5">{er.plant_code}</td>
                            <td className="px-2 py-1.5 text-red-600">{er.reason}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button type="button" onClick={() => setUploadResult(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog
        open={isFormOpen}
        onOpenChange={(open) => {
          if (!open) { setIsFormOpen(false); setEditing(null); setForm({}) }
        }}
      >
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit Plant' : 'New Plant'}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Plant Code (KLIP)</label>
              <Input value={form.code_klip || ''} placeholder="Assigned on save" readOnly disabled />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Plant Code (DHM)</label>
              <Input value={form.code_dhm || ''} placeholder="-" readOnly disabled />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Plant Code (SAP) <span className="text-red-500">*</span></label>
              <Input value={form.plant_code || ''} onChange={(e) => handleChange('plant_code', e.target.value)} disabled={!isAdmin} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Plant Name</label>
              <Input value={form.plant_name || ''} onChange={(e) => handleChange('plant_name', e.target.value)} disabled={!isAdmin} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Plant Type</label>
              <Input value={form.plant_type || ''} onChange={(e) => handleChange('plant_type', e.target.value)} disabled={!isAdmin} />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Site</label>
              <select
                className="w-full rounded-md border px-3 py-2 text-sm disabled:bg-gray-50"
                value={form.site_id || ''}
                onChange={(e) => handleChange('site_id', e.target.value || null)}
                disabled={!isAdmin}
              >
                <option value="">Select a site</option>
                {form.site_id && !sites.some((site) => site.id === form.site_id) ? (
                  <option value={form.site_id}>{form.site || form.site_id}</option>
                ) : null}
                {sites.map((site) => (
                  <option key={site.id} value={site.id}>{site.site_name}</option>
                ))}
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => { setIsFormOpen(false); setEditing(null); setForm({}) }}
            >
              Cancel
            </Button>
            <Button type="button" onClick={handleSubmit}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      </StitchFields>
    </Layout>
  )
}
