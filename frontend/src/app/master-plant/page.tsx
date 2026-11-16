'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import Layout from '@/components/Layout'
import { StitchFields } from '@/components/shared/stitchField'
import { Button } from '@/components/ui/button'
import { iconButtonClass } from '@/lib/iconButton'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import api from '@/lib/api'
import { Building2, Cloud, CloudOff, Factory, FileText, Pencil, Plus, Save } from 'lucide-react'
import { MasterCodeBadge } from '@/components/shared/MasterCodeBadge'
import { MasterDhmSyncButton } from '@/components/shared/MasterDhmSyncButton'
import { MasterKpis } from '@/components/master/MasterKpis'
import { MasterFilterBar } from '@/components/master/MasterFilterBar'
import { MasterTableFooter } from '@/components/master/MasterTableFooter'
import { MasterDhmChip, MasterIdentityCell, MasterListTable, type MasterTableColumn } from '@/components/master/MasterListTable'
import { saveWithDhmConfirm } from '@/lib/dhmMasterSave'
import { masterCountText, masterDhmChip, sortCompanyOptions, type MasterDhmFilter } from '@/lib/masterDirectory'
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
  company_id?: string | null
  /** The Master Company (Internal) row this plant points at (master_plants.company_id); empty when unlinked. */
  linked_company_name?: string | null
  linked_company_code?: string | null
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

interface PlantSummary {
  total: number
  synced: number
  notSynced: number
  failed: number
  usedInKlip: number
  /** The internal companies that have plants, with how many. */
  companies: Array<{ id: string; name: string; plants: number }>
}

const PAGE_SIZE = 20
const ALL_COMPANIES = '__all__'

export default function MasterPlantPage() {
  const [items, setItems] = useState<MasterPlant[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [dhm, setDhm] = useState<MasterDhmFilter>('all')
  const [company, setCompany] = useState('')
  const [summary, setSummary] = useState<PlantSummary | null>(null)
  const [sortKey, setSortKey] = useState('plant')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
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

  const fetchData = useCallback(async (pageNum: number, searchQuery: string, dhmFilter: MasterDhmFilter, companyId: string) => {
    try {
      setLoading(true)
      const params = new URLSearchParams()
      params.set('page', String(pageNum))
      params.set('limit', String(PAGE_SIZE))
      if (searchQuery.length >= 2) params.set('search', searchQuery)
      if (dhmFilter !== 'all') params.set('dhm', dhmFilter)
      if (companyId) params.set('company', companyId)
      const res = await api.get('/master-plants', { params })
      setItems(res.data?.data?.items || [])
      setTotal(res.data?.data?.pagination?.total ?? 0)
    } catch (err) {
      console.error('Failed to load master plants', err)
      alert('Failed to load master plants')
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchSummary = useCallback(async () => {
    try {
      const res = await api.get('/master-plants/summary')
      setSummary(res.data?.data ?? null)
    } catch (err) {
      // the cards are informational: the list still works without them
      console.error('Failed to load the plant summary', err)
    }
  }, [])

  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / PAGE_SIZE)), [total])

  useEffect(() => {
    void fetchData(page, debouncedSearch, dhm, company)
  }, [page, debouncedSearch, dhm, company, fetchData])

  useEffect(() => {
    void fetchSummary()
  }, [fetchSummary])

  const refresh = async () => {
    await Promise.all([fetchData(page, debouncedSearch, dhm, company), fetchSummary()])
  }

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
      await refresh()
    } catch (err: any) {
      console.error('Save master plant error', err)
      const msg = err?.response?.data?.error?.message || 'Failed to save master plant'
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

      await refresh()
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

  const companyOptions = useMemo(() => sortCompanyOptions(summary?.companies ?? []), [summary])
  const filtersOn = search.trim() !== '' || company !== '' || dhm !== 'all'

  const sortedRows = useMemo(() => {
    const text = (row: MasterPlant): string => {
      if (sortKey === 'dhm') return masterDhmChip(row).label
      if (sortKey === 'company') return row.linked_company_name || ''
      if (sortKey === 'site') return row.site || ''
      return row.plant_name || row.plant_code || ''
    }
    return [...items].sort((a, b) => {
      const cmp = text(a).localeCompare(text(b), undefined, { numeric: true })
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [items, sortKey, sortDir])

  const columns: MasterTableColumn<MasterPlant>[] = [
    {
      id: 'plant',
      label: 'Plant',
      sortable: true,
      render: (row) => <MasterIdentityCell name={row.plant_name || row.plant_code} subtitle={[row.plant_type, row.city].filter(Boolean).join(' · ') || 'No type yet'} />,
    },
    {
      id: 'codes',
      label: 'Codes',
      className: 'whitespace-nowrap',
      render: (row) => (
        <div className="flex flex-wrap items-center gap-1.5">
          <MasterCodeBadge kind="klip" value={row.code_klip || ''} fit />
          <MasterCodeBadge kind="dhm" value={row.code_dhm || ''} fit />
          <MasterCodeBadge kind="sap" value={row.plant_code || ''} fit />
        </div>
      ),
    },
    { id: 'company', label: 'Company', sortable: true, render: (row) => <span className="block max-w-[18rem] truncate text-sm text-gray-800" title={row.linked_company_name || undefined}>{plantCell(row.linked_company_name)}</span> },
    { id: 'site', label: 'Site', sortable: true, render: (row) => <span className="block max-w-[14rem] truncate text-sm text-gray-800" title={row.site || undefined}>{plantCell(row.site)}</span> },
    { id: 'dhm', label: 'DHM', sortable: true, className: 'whitespace-nowrap', render: (row) => <MasterDhmChip row={row} /> },
  ]

  const kpis = [
    { id: 'total', icon: <Factory className="h-4 w-4" />, label: 'Total plants', value: summary?.total ?? null, tone: 'bg-blue-50 text-blue-600', hint: 'all master plants' },
    { id: 'synced', icon: <Cloud className="h-4 w-4" />, label: 'Synced to DHM', value: summary?.synced ?? null, tone: 'bg-emerald-50 text-emerald-600', hint: 'DHM has them' },
    {
      id: 'not-synced',
      icon: <CloudOff className="h-4 w-4" />,
      label: 'Not synced',
      value: summary?.notSynced ?? null,
      tone: 'bg-amber-50 text-amber-600',
      hint: summary && summary.failed > 0 ? `${summary.failed.toLocaleString('en-US')} more failed to deliver` : 'not in DHM yet',
    },
    { id: 'used', icon: <FileText className="h-4 w-4" />, label: 'Used in KLIP', value: summary?.usedInKlip ?? null, tone: 'bg-violet-50 text-violet-600', hint: 'with a contract placed on them' },
  ]

  return (
    <Layout>
      <StitchFields>
      <div className="space-y-6">
        <MasterKpis items={kpis} />

        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          <MasterFilterBar
            search={search}
            onSearch={(value) => {
              setSearch(value)
              setPage(1)
            }}
            placeholder="Search plant, code, company, site or city"
            ariaLabel="Search plants"
            dhm={dhm}
            onDhm={(value) => {
              setDhm(value)
              setPage(1)
            }}
            dhmCounts={summary ? { all: summary.total, synced: summary.synced, not_synced: summary.notSynced, failed: summary.failed } : undefined}
            extraActive={company !== ''}
            onClear={() => {
              setSearch('')
              setDhm('all')
              setCompany('')
              setPage(1)
            }}
            actions={
              isAdmin ? (
                <>
                  <MasterDhmSyncButton master="plant" onDone={() => void refresh()} iconOnly />
                  <Button variant="ghost" size="icon" className={iconButtonClass('add')} title="New plant" aria-label="New plant" onClick={openNew}>
                    <Plus className="h-4 w-4" aria-hidden />
                  </Button>
                </>
              ) : null
            }
          >
            <Select
              value={company || ALL_COMPANIES}
              onValueChange={(value) => {
                setCompany(value === ALL_COMPANIES ? '' : value)
                setPage(1)
              }}
            >
              <SelectTrigger className="h-9 w-[250px] gap-2 [&>span]:flex-1 [&>span]:truncate [&>span]:text-left" aria-label="Filter by company">
                <Building2 className="h-4 w-4 shrink-0 text-gray-400" aria-hidden />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_COMPANIES}>All companies{summary ? ` (${companyOptions.length.toLocaleString('en-US')})` : ''}</SelectItem>
                {companyOptions.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {option.name} ({option.plants.toLocaleString('en-US')})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </MasterFilterBar>

          <MasterListTable
            rows={sortedRows}
            columns={columns}
            getRowId={(row) => row.id}
            loading={loading}
            emptyLabel={filtersOn ? 'No plants match these filters' : 'No plants yet'}
            sortKey={sortKey}
            sortDir={sortDir}
            onSort={(id) => {
              setSortDir((dir) => (sortKey === id ? (dir === 'asc' ? 'desc' : 'asc') : 'asc'))
              setSortKey(id)
            }}
            onRowClick={openEdit}
            renderActions={(row) => (
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8 border-transparent bg-transparent text-blue-600 hover:bg-blue-50"
                title={isAdmin ? 'Edit plant' : 'View plant'}
                aria-label={`${isAdmin ? 'Edit' : 'View'} ${row.plant_name || row.plant_code}`}
                onClick={() => openEdit(row)}
              >
                <Pencil className="h-4 w-4" />
              </Button>
            )}
          />

          <MasterTableFooter
            countText={`${masterCountText(items.length, total, summary?.total ?? total, 'plants')} · click a row to ${isAdmin ? 'edit' : 'view'} it`}
            kinds={['klip', 'dhm', 'sap']}
            pager={{ page: page, totalPages: totalPages, onPageChange: setPage, disabled: loading }}
          />
        </div>
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
            <Button type="button" onClick={handleSubmit}><Save className="mr-2 h-4 w-4" aria-hidden />Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      </StitchFields>
    </Layout>
  )
}
