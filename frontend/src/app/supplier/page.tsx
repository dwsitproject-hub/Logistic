'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import Layout from '@/components/Layout'
import {
  BulkUploadStatusModal,
  type BulkUploadStatusResult,
} from '@/components/BulkUploadStatusModal'
import { Plus, Upload, Download, X, Eye, Loader2 } from 'lucide-react'
import { SearchableMultiSelect } from '@/components/SearchableMultiSelect'
import {
  LIST_FILTER_FIELD_LABEL_CLASS,
  ListFilterPanel,
  selectionChips,
  LIST_FILTER_FIELDS_ROW_CLASS,
} from '@/components/shared/ListFilterPanel'
import { StitchFields } from '@/components/shared/stitchField'
import { StitchSearchIcon } from '@/components/shared/stitchIcons'
import { ListPageColumnsMenu } from '@/components/shared/ListPageColumnsMenu'
import { MasterListCompactTable, type MasterListTableColumn } from '@/components/shared/MasterListCompactTable'
import { useListColumnLayout } from '@/lib/listColumnLayout'

interface Supplier {
  id: string
  plant_code: string
  prov_code: string | null
  prov_no: string | null
  mill_no: string | null
  mill_code: string | null
  mills: string | null
  group_id: string | null
  parent_company: string | null
  group_holding: string | null
  controlling_shareholder: string | null
  other_shareholders: string | null
  group_type: string | null
  group_scale: string | null
  integrated_status: string | null
  cap: string | null
  cpo_prod_est_month?: number | null
  pk_prod_est_month?: number | null
  pome_prod_est_month?: number | null
  shell_prod_est_month?: number | null
  cpo_prod_est_year?: number | null
  pk_prod_est_year?: number | null
  pome_prod_est_year?: number | null
  shell_prod_est_year?: number | null
  city_regency: string | null
  province: string | null
  island: string | null
  longitude: number | null
  latitude: number | null
  kml_folder: string | null
  map: string | null
  rspo: string | null
  rspo_type: string | null
  ispo: string | null
  iscc: string | null
  ggl: string | null
  year_commence: number | null
  updated_date: string | null
  update_year: number | null
  remarks: string | null
}

function supplierText(value: string | null | undefined): string {
  return value && String(value).trim() ? String(value) : '-'
}

function supplierNumber(value: string | number | null | undefined): string {
  if (value == null || value === '') return '-'
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed.toLocaleString('en-US', { maximumFractionDigits: 0 }) : String(value)
}

const SUPPLIER_TABLE_COLUMNS: MasterListTableColumn<Supplier>[] = [
  { id: 'mill_code', label: 'Mill Code', defaultVisible: true, getText: (row) => supplierText(row.mill_code) },
  { id: 'mills', label: 'Mills', defaultVisible: true, getText: (row) => supplierText(row.mills) },
  { id: 'group_id', label: 'Group', defaultVisible: true, getText: (row) => supplierText(row.group_id) },
  { id: 'province', label: 'Province', defaultVisible: true, getText: (row) => supplierText(row.province) },
  { id: 'island', label: 'Island', defaultVisible: true, getText: (row) => supplierText(row.island) },
  { id: 'group_type', label: 'Group Type', defaultVisible: true, getText: (row) => supplierText(row.group_type) },
  { id: 'cap', label: 'CAP (tph)', defaultVisible: false, getText: (row) => supplierNumber(row.cap) },
  { id: 'cpo_prod_est_month', label: 'CPO / Month', defaultVisible: false, getText: (row) => supplierNumber(row.cpo_prod_est_month) },
  { id: 'pk_prod_est_month', label: 'PK / Month', defaultVisible: false, getText: (row) => supplierNumber(row.pk_prod_est_month) },
  { id: 'pome_prod_est_month', label: 'POME / Month', defaultVisible: false, getText: (row) => supplierNumber(row.pome_prod_est_month) },
  { id: 'shell_prod_est_month', label: 'SHELL / Month', defaultVisible: false, getText: (row) => supplierNumber(row.shell_prod_est_month) },
]

const headersOrder = [
  'PLANT CODE','PROV CODE','PROV #','MILL NO','MILL CODE','MILLS','GROUP ID','GROUP TYPE','Group Scale','Integrated Status',
  'CAP (tph)','CPO Prod Est /Month','PK Prod Est /Month','POME Prod Est /Month','SHELL Prod Est /Month',
  'CPO Prod Est /Year','PK Prod Est /Year','POME Prod Est /Year','SHELL Prod Est /Year',
  'CITY / REGENCY','PROVINCE','ISLAND','LONGITUDE','LATITUDE','KML_FOLDER','GOOGLE MAPS',
  'RSPO','RSPO Type','ISPO','ISCC','GGL','YEAR COMMENCE','UPDATE DATE','UPDATE YEAR','REMARKS'
]

const PINNED_GROUPS = [
  'FIRST RESOURCES',
  'KORINDO',
  'PALMA SERASIH',
  'SAMPOERNA',
  'TELADAN',
  'TRIPUTRA',
  'USTP',
]

export default function SupplierPage() {
  const router = useRouter()
  const [allItems, setAllItems] = useState<Supplier[]>([])
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState<string>('mill_code')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const PAGE_SIZE = 20
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [bulkUploadResult, setBulkUploadResult] = useState<BulkUploadStatusResult | null>(null)
  const [uploading, setUploading] = useState(false)

  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState<Supplier | null>(null)
  const [productConfigs, setProductConfigs] = useState<Record<string, any>>({})
  const [viewingSupplier, setViewingSupplier] = useState<Supplier | null>(null)

  const emptyForm = {
    plant_code: '', prov_code: '', prov_no: '', mill_no: '', mill_code: '',
    mills: '', group_id: '', parent_company: '', group_holding: '',
    controlling_shareholder: '', other_shareholders: '', group_type: '', group_scale: '', integrated_status: '', cap: '',
    cpo_prod_est_month: '', pk_prod_est_month: '', pome_prod_est_month: '', shell_prod_est_month: '',
    cpo_prod_est_year: '', pk_prod_est_year: '', pome_prod_est_year: '', shell_prod_est_year: '',
    city_regency: '', province: '', island: '',
    longitude: '', latitude: '', kml_folder: '', map: '', rspo: '', rspo_type: '', ispo: '', iscc: '', ggl: '',
    year_commence: '', updated_date: '', update_year: '', remarks: ''
  } as any
  const [form, setForm] = useState<any>(emptyForm)

  const [selectedGroups, setSelectedGroups] = useState<Set<string>>(new Set())

  const groupOptions = useMemo(() => {
    const ids = new Set(allItems.map(s => s.group_id).filter(Boolean) as string[])
    return Array.from(ids).sort()
  }, [allItems])

  const groupSelectOptions = useMemo(() => {
    const available = new Set(groupOptions)
    const pinned = PINNED_GROUPS.filter((g) => available.has(g))
    const rest = groupOptions.filter((g) => !PINNED_GROUPS.includes(g))
    return [...pinned, ...rest]
  }, [groupOptions])

  const setGroupFilter = (values: string[]) => {
    setSelectedGroups(new Set(values))
    setPage(1)
  }

  const filtered = useMemo(() => {
    let result = allItems
    if (selectedGroups.size > 0) {
      result = result.filter(s => s.group_id != null && selectedGroups.has(s.group_id))
    }
    if (search.trim()) {
      const q = search.toLowerCase()
      result = result.filter(s =>
        (s.mill_code || '').toLowerCase().includes(q) ||
        (s.mills || '').toLowerCase().includes(q) ||
        (s.group_id || '').toLowerCase().includes(q) ||
        (s.province || '').toLowerCase().includes(q) ||
        (s.island || '').toLowerCase().includes(q)
      )
    }
    return result
  }, [allItems, search, selectedGroups])

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const aVal = (a as any)[sortBy]
      const bVal = (b as any)[sortBy]
      if (aVal == null && bVal == null) return 0
      if (aVal == null) return 1
      if (bVal == null) return -1
      const numeric = ['cap', 'cpo_prod_est_month', 'pk_prod_est_month', 'pome_prod_est_month', 'shell_prod_est_month']
      const cmp = numeric.includes(sortBy)
        ? Number(aVal) - Number(bVal)
        : String(aVal).localeCompare(String(bVal))
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [filtered, sortBy, sortDir])

  const total = filtered.length
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const items = useMemo(() => sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), [sorted, page])

  const supplierColumns = useListColumnLayout('master-suppliers.visibleColumns.v1', SUPPLIER_TABLE_COLUMNS)

  const handlePageChange = (newPage: number) => {
    if (newPage >= 1 && newPage <= totalPages) setPage(newPage)
  }

  const handleSort = (col: string) => {
    if (sortBy === col) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortBy(col)
      setSortDir('asc')
    }
    setPage(1)
  }

  const fetchProductConfigs = async () => {
    try {
      const res = await api.get('/products?limit=200')
      const map: Record<string, any> = {}
      for (const p of res.data.data.items || []) {
        const key = String(p.product_name || '').toUpperCase()
        if (['CPO','PK','POME','SHELL'].includes(key)) map[key] = p
      }
      setProductConfigs(map)
    } catch {}
  }

  useEffect(() => {
    const userStr = localStorage.getItem('user')
    if (!userStr) {
      router.push('/login')
      return
    }
    fetchData()
    fetchProductConfigs()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const capNum = Number(form.cap)
    if (!isFinite(capNum)) {
      setForm((f: any) => ({
        ...f,
        cpo_prod_est_month: '', pk_prod_est_month: '', pome_prod_est_month: '', shell_prod_est_month: '',
        cpo_prod_est_year: '', pk_prod_est_year: '', pome_prod_est_year: '', shell_prod_est_year: ''
      }))
      return
    }
    const calc = (prod: any, useYear = false) => {
      if (!prod) return ''
      const pct = prod.percent_produce == null ? null : Number(prod.percent_produce) / 100
      const hours = prod.working_hours_per_day == null ? null : Number(prod.working_hours_per_day)
      const days = useYear
        ? prod.working_days_per_year == null ? null : Number(prod.working_days_per_year)
        : prod.working_days_per_month == null ? null : Number(prod.working_days_per_month)
      if (pct == null || hours == null || days == null) return ''
      const v = capNum * pct * hours * days
      return isFinite(v) ? String(v) : ''
    }
    setForm((prev: any) => ({
      ...prev,
      cpo_prod_est_month: calc(productConfigs['CPO'], false),
      pk_prod_est_month: calc(productConfigs['PK'], false),
      pome_prod_est_month: calc(productConfigs['POME'], false),
      shell_prod_est_month: calc(productConfigs['SHELL'], false),
      cpo_prod_est_year: calc(productConfigs['CPO'], true),
      pk_prod_est_year: calc(productConfigs['PK'], true),
      pome_prod_est_year: calc(productConfigs['POME'], true),
      shell_prod_est_year: calc(productConfigs['SHELL'], true),
    }))
  }, [form.cap, productConfigs])

  const fetchData = async () => {
    setLoading(true)
    setError('')
    try {
      const res = await api.get('/suppliers?page=1&limit=5000')
      setAllItems(res.data.data.items)
    } catch (e: any) {
      setError(e?.response?.data?.error?.message || 'Failed to load suppliers')
    } finally {
      setLoading(false)
    }
  }

  const openAdd = () => {
    setEditing(null)
    setForm({ ...emptyForm })
    fetchProductConfigs()
    setShowModal(true)
  }

  const openEdit = (s: Supplier) => {
    setEditing(s)
    setForm({ ...s, updated_date: s.updated_date ? s.updated_date.substring(0, 10) : '' })
    fetchProductConfigs()
    setShowModal(true)
  }

  const saveSupplier = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setSuccess('')
    try {
      if (editing) {
        await api.put(`/suppliers/${editing.id}`, form)
        setSuccess('Supplier updated')
      } else {
        await api.post('/suppliers', form)
        setSuccess('Supplier created')
      }
      setShowModal(false)
      fetchData()
    } catch (err: any) {
      setError(err?.response?.data?.error?.message || 'Save failed')
    }
  }

  const removeSupplier = async (s: Supplier) => {
    if (!confirm(`Delete ${s.plant_code}?`)) return
    try {
      await api.delete(`/suppliers/${s.id}`)
      fetchData()
    } catch (e: any) {
      alert(e?.response?.data?.error?.message || 'Delete failed')
    }
  }

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setError('')
    setSuccess('')
    setUploading(true)
    const fd = new FormData()
    fd.append('file', file)
    try {
      const res = await api.post('/suppliers/import', fd, { headers: { 'Content-Type': 'multipart/form-data' } })
      const r = res.data?.data ?? {}
      const errors: string[] = Array.isArray(r.errors) ? r.errors.map(String) : []
      setBulkUploadResult({
        created: Number(r.inserted) || 0,
        updated: Number(r.updated) || 0,
        failed: errors.length,
        errors,
      })
      await fetchData()
    } catch (e: any) {
      setError(e?.response?.data?.error?.message || 'Import failed')
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  const downloadTemplate = () => {
    const header = headersOrder.join(',') + '\n'
    const blob = new Blob([header], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'Suppliers_Import_Template.csv'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  return (
    <Layout>
      <StitchFields>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-gray-600">
              Maintain reference data for suppliers and their production estimates.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="border-green-600 text-green-700 hover:bg-green-50"
              onClick={downloadTemplate}
            >
              <Download className="h-4 w-4 mr-2" />
              Download Template
            </Button>
            <input
              id="supplier-upload"
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={handleUpload}
              disabled={uploading}
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => document.getElementById('supplier-upload')?.click()}
              disabled={uploading}
            >
              {uploading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Uploading...
                </>
              ) : (
                <>
                  <Upload className="h-4 w-4 mr-2" />
                  Upload CSV
                </>
              )}
            </Button>
            <Button size="sm" onClick={openAdd}>
              <Plus className="h-4 w-4 mr-2" />
              Add Supplier
            </Button>
          </div>
        </div>

        {error && <div className="text-red-600 text-sm">{error}</div>}
        {success && <div className="text-green-600 text-sm">{success}</div>}

        <ListFilterPanel
          onReset={() => {
            setSearch('')
            setSelectedGroups(new Set())
            setPage(1)
          }}
          showReset={search.trim().length > 0 || selectedGroups.size > 0}
          chips={[
            ...(search.trim()
              ? [{ id: 'search', label: `Search: ${search.trim()}`, onRemove: () => { setSearch(''); setPage(1) } }]
              : []),
            ...selectionChips('Group', Array.from(selectedGroups), setGroupFilter),
          ]}
        >
          <div className={LIST_FILTER_FIELDS_ROW_CLASS}>
            <div className="min-w-[12rem] flex-[1.4]">
              <label className={LIST_FILTER_FIELD_LABEL_CLASS}>Search</label>
              <div className="relative">
                <StitchSearchIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  placeholder="Mill Code, Mills, or Group ID"
                  value={search}
                  onChange={(e) => { setSearch(e.target.value); setPage(1) }}
                  className="rounded-lg border-slate-200 pl-10 text-slate-700 placeholder:text-slate-400 focus-visible:ring-blue-600"
                />
              </div>
            </div>
            <SearchableMultiSelect
              className="min-w-[7.5rem] flex-1"
              labelClassName={LIST_FILTER_FIELD_LABEL_CLASS}
              label="Group"
              options={groupSelectOptions}
              selected={Array.from(selectedGroups)}
              onChange={setGroupFilter}
              placeholder="All"
              emptyMessage="No groups"
              pinSelectedToTop
            />
          </div>
        </ListFilterPanel>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base flex items-center gap-2 flex-wrap">
                  <span>All Suppliers</span>
                </CardTitle>
                <p className="text-xs text-gray-500 mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0">
                  <span className="whitespace-nowrap tabular-nums text-gray-700">
                    <span className="font-semibold">{total.toLocaleString('en-US')}</span> suppliers
                  </span>
                  <span className="text-gray-400" aria-hidden>·</span>
                  <span className="whitespace-nowrap tabular-nums">
                    Page {page}/{totalPages} · {items.length} rows
                  </span>
                </p>
              </div>
              <div className="flex items-center gap-2">
                <ListPageColumnsMenu
                  columns={supplierColumns.menuColumns}
                  visibleIds={supplierColumns.visibleIds}
                  disabled={loading}
                  onToggle={supplierColumns.toggle}
                  onSelectAll={supplierColumns.selectAll}
                  onUnselectAll={supplierColumns.unselectAll}
                  onReset={supplierColumns.reset}
                  onReorder={supplierColumns.reorder}
                />
                {totalPages > 1 && (
                  <div className="flex items-center gap-2 border-l border-gray-200 pl-2 ml-1">
                    <Button variant="outline" size="sm" onClick={() => handlePageChange(page - 1)} disabled={page <= 1}>Previous</Button>
                    {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                      let pageNum: number
                      if (totalPages <= 5) { pageNum = i + 1 }
                      else if (page <= 3) { pageNum = i + 1 }
                      else if (page >= totalPages - 2) { pageNum = totalPages - 4 + i }
                      else { pageNum = page - 2 + i }
                      return (
                        <Button key={pageNum} variant={page === pageNum ? 'default' : 'outline'} size="sm" onClick={() => handlePageChange(pageNum)} className="min-w-[36px]">
                          {pageNum}
                        </Button>
                      )
                    })}
                    <Button variant="outline" size="sm" onClick={() => handlePageChange(page + 1)} disabled={page >= totalPages}>Next</Button>
                  </div>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <MasterListCompactTable
              rows={items}
              columns={SUPPLIER_TABLE_COLUMNS.filter((col) => supplierColumns.orderedVisibleIds.includes(col.id)).sort(
                (a, b) => supplierColumns.orderedVisibleIds.indexOf(a.id) - supplierColumns.orderedVisibleIds.indexOf(b.id),
              )}
              getRowId={(row) => row.id}
              sortKey={sortBy}
              sortDir={sortDir}
              dragColId={supplierColumns.dragColId}
              loading={loading}
              emptyLabel="No suppliers found"
              onSort={handleSort}
              onDragStart={supplierColumns.setDragColId}
              onDragEnd={() => supplierColumns.setDragColId(null)}
              onDrop={(id) => {
                if (supplierColumns.dragColId) supplierColumns.reorder(supplierColumns.dragColId, id)
                supplierColumns.setDragColId(null)
              }}
              renderActions={(row) => (
                <div className="inline-flex items-center justify-center gap-1">
                  <Button variant="outline" size="sm" onClick={() => setViewingSupplier(row)} className="bg-green-50 border-green-200 text-green-700 hover:bg-green-100">
                    <Eye className="h-4 w-4 mr-1" />View
                  </Button>
                </div>
              )}
            />
          </CardContent>
        </Card>

        {showModal && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
            <div className="bg-white rounded-md w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden">
              <div className="sticky top-0 z-10 flex shrink-0 items-center justify-between border-b bg-white px-6 py-4">
                <h2 className="text-xl font-semibold">{editing ? 'Edit Supplier' : 'Add Supplier'}</h2>
                <Button type="button" variant="ghost" size="icon" className="shrink-0" aria-label="Close" onClick={() => setShowModal(false)}>
                  <X className="h-5 w-5" />
                </Button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
              <form onSubmit={saveSupplier} className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {[
                  ['plant_code','Plant Code'],['prov_code','Prov Code'],['prov_no','Prov #'],['mill_no','Mill No'],['mill_code','Mill Code'],
                  ['mills','Mills'],['group_id','Group ID'],['parent_company','Parent Company'],['group_holding','Group / Holding'],
                  ['controlling_shareholder','Controlling Shareholder'],['other_shareholders','Other Shareholders'],
                  ['group_type','Group Type'],['group_scale','Group Scale'],['integrated_status','Integrated Status'],
                  ['cap','CAP (tph)'],
                  ['cpo_prod_est_month','CPO Prod Est / Month'],['pk_prod_est_month','PK Prod Est / Month'],['pome_prod_est_month','POME Prod Est / Month'],['shell_prod_est_month','SHELL Prod Est / Month'],
                  ['cpo_prod_est_year','CPO Prod Est / Year'],['pk_prod_est_year','PK Prod Est / Year'],['pome_prod_est_year','POME Prod Est / Year'],['shell_prod_est_year','SHELL Prod Est / Year'],
                  ['city_regency','City / Regency'],['province','Province'],['island','Island'],['longitude','Longitude'],['latitude','Latitude'],
                  ['kml_folder','KML Folder'],['map','Google Maps'],['rspo','RSPO'],['rspo_type','RSPO Type'],['ispo','ISPO'],['iscc','ISCC'],['ggl','GGL']
                ].map(([key, label]) => (
                  <div key={key as string} className="space-y-1">
                    <Label>{label}</Label>
                    <Input
                      type={key === 'updated_date' ? 'date' : (key?.toString().includes('prod_est') || key === 'longitude' || key === 'latitude' || key === 'year_commence' || key === 'update_year' || key === 'cap') ? 'number' : 'text'}
                      value={form[key as string] ?? ''}
                      onChange={(e) => {
                        const val = e.target.value
                        if (key === 'cap') {
                          const capNum = Number(val)
                          const calc = (prod: any, useYear = false) => {
                            if (!prod || !isFinite(capNum)) return ''
                            const pct = prod.percent_produce == null ? null : Number(prod.percent_produce) / 100
                            const hours = prod.working_hours_per_day == null ? null : Number(prod.working_hours_per_day)
                            const days = useYear
                              ? prod.working_days_per_year == null ? null : Number(prod.working_days_per_year)
                              : prod.working_days_per_month == null ? null : Number(prod.working_days_per_month)
                            if (pct == null || hours == null || days == null) return ''
                            const v = capNum * pct * hours * days
                            return isFinite(v) ? String(v) : ''
                          }
                          setForm((f: any) => ({
                            ...f,
                            cap: val,
                            cpo_prod_est_month: calc(productConfigs['CPO'], false),
                            pk_prod_est_month: calc(productConfigs['PK'], false),
                            pome_prod_est_month: calc(productConfigs['POME'], false),
                            shell_prod_est_month: calc(productConfigs['SHELL'], false),
                            cpo_prod_est_year: calc(productConfigs['CPO'], true),
                            pk_prod_est_year: calc(productConfigs['PK'], true),
                            pome_prod_est_year: calc(productConfigs['POME'], true),
                            shell_prod_est_year: calc(productConfigs['SHELL'], true),
                          }))
                        } else {
                          setForm((f: any) => ({ ...f, [key as string]: val }))
                        }
                      }}
                      disabled={key?.toString().includes('prod_est')}
                      required={key === 'plant_code'}
                    />
                  </div>
                ))}
                <div className="col-span-full flex justify-end gap-2 mt-2">
                  <Button type="button" variant="ghost" onClick={() => { setEditing(null); setForm(emptyForm); setShowModal(false) }}>Cancel</Button>
                  <Button type="submit">Save</Button>
                </div>
              </form>
              </div>
            </div>
          </div>
        )}

        {viewingSupplier && (() => {
          const fv = (key: string) => {
            const v: any = (viewingSupplier as any)[key]
            if (v == null || v === '') return '-'
            if (key.includes('prod_est')) return Number(v).toLocaleString('en-US', { maximumFractionDigits: 0 })
            if (key === 'cap') return Number(v).toLocaleString('en-US')
            return String(v)
          }
          const Field = ({ k, label, wide }: { k: string; label: string; wide?: boolean }) => (
            <div className={`p-3 bg-gray-50 rounded${wide ? ' col-span-2' : ''}`}>
              <div className="text-gray-500">{label}</div>
              <div className="font-medium mt-1 break-words">{fv(k)}</div>
            </div>
          )
          return (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
              <Card className="max-w-4xl w-full max-h-[90vh] flex flex-col overflow-hidden">
                <CardHeader className="shrink-0 border-b">
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle>Supplier Details</CardTitle>
                      <p className="text-sm text-gray-500 mt-1">{viewingSupplier.plant_code}{viewingSupplier.mills ? ` — ${viewingSupplier.mills}` : ''}</p>
                    </div>
                    <Button variant="ghost" size="icon" className="shrink-0" aria-label="Close" onClick={() => setViewingSupplier(null)}>
                      <X className="h-5 w-5" />
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="min-h-0 flex-1 overflow-y-auto">
                  <div className="space-y-6 text-sm">
                    {/* Basic Info */}
                    <div>
                      <h3 className="text-lg font-semibold mb-3">Basic Info</h3>
                      <div className="grid grid-cols-2 gap-4">
                        <Field k="plant_code" label="Plant Code" />
                        <Field k="mill_code"  label="Mill Code" />
                        <Field k="mill_no"    label="Mill No" />
                        <Field k="prov_code"  label="Prov Code" />
                        <Field k="prov_no"    label="Prov #" />
                        <Field k="mills"      label="Mills" wide />
                      </div>
                    </div>

                    {/* Group Info */}
                    <div>
                      <h3 className="text-lg font-semibold mb-3">Group Info</h3>
                      <div className="grid grid-cols-2 gap-4">
                        <Field k="group_id"     label="Group ID" />
                        <Field k="parent_company" label="Parent Company" />
                        <Field k="group_holding" label="Group / Holding" />
                        <Field k="group_type"   label="Group Type" />
                        <Field k="group_scale"  label="Group Scale" />
                        <Field k="integrated_status" label="Integrated Status" />
                        <Field k="controlling_shareholder" label="Controlling Shareholder" wide />
                        <Field k="other_shareholders"      label="Other Shareholders" wide />
                      </div>
                    </div>

                    {/* Production Capacity */}
                    <div>
                      <h3 className="text-lg font-semibold mb-3">Production Capacity</h3>
                      <div className="grid grid-cols-2 gap-4">
                        <Field k="cap"                 label="CAP (tph)" wide />
                        <Field k="cpo_prod_est_month"  label="CPO Prod Est / Month" />
                        <Field k="cpo_prod_est_year"   label="CPO Prod Est / Year" />
                        <Field k="pk_prod_est_month"   label="PK Prod Est / Month" />
                        <Field k="pk_prod_est_year"    label="PK Prod Est / Year" />
                        <Field k="pome_prod_est_month" label="POME Prod Est / Month" />
                        <Field k="pome_prod_est_year"  label="POME Prod Est / Year" />
                        <Field k="shell_prod_est_month" label="SHELL Prod Est / Month" />
                        <Field k="shell_prod_est_year"  label="SHELL Prod Est / Year" />
                      </div>
                    </div>

                    {/* Location */}
                    <div>
                      <h3 className="text-lg font-semibold mb-3">Location</h3>
                      <div className="grid grid-cols-2 gap-4">
                        <Field k="city_regency" label="City / Regency" />
                        <Field k="province"     label="Province" />
                        <Field k="island"       label="Island" />
                        <Field k="longitude"    label="Longitude" />
                        <Field k="latitude"     label="Latitude" />
                        <Field k="kml_folder"   label="KML Folder" />
                        <Field k="map"          label="Google Maps" wide />
                      </div>
                    </div>

                    {/* Certification */}
                    <div>
                      <h3 className="text-lg font-semibold mb-3">Certification</h3>
                      <div className="grid grid-cols-2 gap-4">
                        <Field k="rspo"      label="RSPO" />
                        <Field k="rspo_type" label="RSPO Type" />
                        <Field k="ispo"      label="ISPO" />
                        <Field k="iscc"      label="ISCC" />
                        <Field k="ggl"       label="GGL" />
                      </div>
                    </div>

                  </div>
                </CardContent>
              </Card>
            </div>
          )
        })()}

        <BulkUploadStatusModal
          open={!!bulkUploadResult}
          onOpenChange={(open) => { if (!open) setBulkUploadResult(null) }}
          title="Supplier CSV upload result"
          result={bulkUploadResult}
          createdLabel="Inserted"
        />
      </div>
      </StitchFields>
    </Layout>
  )
}
