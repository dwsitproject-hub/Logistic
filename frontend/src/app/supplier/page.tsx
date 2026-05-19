'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import Layout from '@/components/Layout'
import { Plus, SlidersHorizontal, Upload, Edit2, Trash2, X, Eye, ArrowUp, ArrowDown, ArrowUpDown, ChevronDown } from 'lucide-react'

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

const COLUMN_DEFS = [
  { key: 'mill_code',           label: 'Mill Code',      defaultVisible: true  },
  { key: 'mills',               label: 'Mills',          defaultVisible: true  },
  { key: 'group_id',            label: 'Group',          defaultVisible: true  },
  { key: 'province',            label: 'Province',       defaultVisible: true  },
  { key: 'island',              label: 'Island',         defaultVisible: true  },
  { key: 'group_type',          label: 'Group Type',     defaultVisible: true  },
  { key: 'cap',                 label: 'CAP (tph)',      defaultVisible: false },
  { key: 'cpo_prod_est_month',  label: 'CPO / Month',   defaultVisible: false },
  { key: 'pk_prod_est_month',   label: 'PK / Month',    defaultVisible: false },
  { key: 'pome_prod_est_month', label: 'POME / Month',  defaultVisible: false },
  { key: 'shell_prod_est_month',label: 'SHELL / Month', defaultVisible: false },
] as const

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
  const [groupDropdownOpen, setGroupDropdownOpen] = useState(false)
  const [groupSearch, setGroupSearch] = useState('')
  const groupDropdownRef = useRef<HTMLDivElement>(null)

  const groupOptions = useMemo(() => {
    const ids = new Set(allItems.map(s => s.group_id).filter(Boolean) as string[])
    return Array.from(ids).sort()
  }, [allItems])

  const filteredGroupOptions = useMemo(() => {
    const q = groupSearch.trim().toLowerCase()
    const available = new Set(groupOptions)
    const pinnedAvailable = PINNED_GROUPS.filter(g => available.has(g) && (!q || g.toLowerCase().includes(q)))
    const rest = groupOptions.filter(g => !PINNED_GROUPS.includes(g) && (!q || g.toLowerCase().includes(q)))
    return { pinned: pinnedAvailable, rest }
  }, [groupOptions, groupSearch])

  const toggleGroup = (id: string) => {
    setSelectedGroups(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
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

  const [visibleColumns, setVisibleColumns] = useState<Record<string, boolean>>(
    Object.fromEntries(COLUMN_DEFS.map((c) => [c.key, c.defaultVisible]))
  )
  const [showColumnManager, setShowColumnManager] = useState(false)
  const columnsMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (columnsMenuRef.current && !columnsMenuRef.current.contains(e.target as Node)) {
        setShowColumnManager(false)
      }
      if (groupDropdownRef.current && !groupDropdownRef.current.contains(e.target as Node)) {
        setGroupDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const onToggleColumn = (key: string) => {
    setVisibleColumns((prev) => {
      const next = { ...prev, [key]: !prev[key] }
      if (Object.values(next).filter(Boolean).length === 0) return prev
      return next
    })
  }

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

  const SortIcon = ({ col }: { col: string }) => {
    if (sortBy !== col) return <ArrowUpDown className="inline h-3 w-3 ml-1 text-gray-400" />
    return sortDir === 'asc'
      ? <ArrowUp className="inline h-3 w-3 ml-1 text-blue-600" />
      : <ArrowDown className="inline h-3 w-3 ml-1 text-blue-600" />
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
    const fd = new FormData()
    fd.append('file', file)
    try {
      const res = await api.post('/suppliers/import', fd, { headers: { 'Content-Type': 'multipart/form-data' } })
      const r = res.data.data
      const details = r.errors?.length ? r.errors.slice(0, 10).join(' | ') + (r.errors.length > 10 ? ' | ...' : '') : ''
      setSuccess(`Imported: ${r.inserted} inserted, ${r.updated} updated${r.errors?.length ? `, ${r.errors.length} errors` : ''}`)
      if (details) setError(details)
      fetchData()
    } catch (e: any) {
      setError(e?.response?.data?.error?.message || 'Import failed')
    } finally {
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
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Suppliers</h1>
            <p className="text-gray-600 mt-2">
              Maintain reference data for suppliers and their production estimates.
            </p>
          </div>
          <div className="flex items-center gap-2">
<Button variant="outline" size="sm" onClick={() => document.getElementById('supplier-upload')?.click()}>
              <Upload className="h-4 w-4 mr-2" />
              Upload CSV
            </Button>
            <input
              id="supplier-upload"
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={handleUpload}
            />
            <Button size="sm" onClick={openAdd}>
              <Plus className="h-4 w-4 mr-2" />
              Add Supplier
            </Button>
          </div>
        </div>

        {error && <div className="text-red-600 text-sm">{error}</div>}
        {success && <div className="text-green-600 text-sm">{success}</div>}

        <Card>
          <CardHeader>
            <CardTitle>Filter</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-3 items-start">
              <Input
                placeholder="Search by Mill Code, Mills, or Group ID..."
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1) }}
                className="max-w-sm"
              />

              {/* Group ID multi-select */}
              <div ref={groupDropdownRef} className="relative">
                <button
                  type="button"
                  onClick={() => setGroupDropdownOpen(v => !v)}
                  className="inline-flex items-center gap-2 h-9 px-3 rounded-md border border-input bg-white text-sm hover:bg-gray-50 min-w-[180px] justify-between"
                >
                  <span className="truncate text-left">
                    {selectedGroups.size === 0
                      ? 'Filter by Group ID'
                      : selectedGroups.size === 1
                        ? Array.from(selectedGroups)[0]
                        : `${selectedGroups.size} groups selected`}
                  </span>
                  <ChevronDown className="h-4 w-4 text-gray-400 shrink-0" />
                </button>

                {groupDropdownOpen && (
                  <div className="absolute left-0 top-full mt-1 z-50 w-64 bg-white border rounded-md shadow-lg flex flex-col max-h-72">
                    <div className="p-2 border-b">
                      <Input
                        placeholder="Search group..."
                        value={groupSearch}
                        onChange={e => setGroupSearch(e.target.value)}
                        className="h-7 text-xs"
                        autoFocus
                      />
                    </div>
                    {selectedGroups.size > 0 && (
                      <button
                        className="text-xs text-red-500 hover:text-red-700 px-3 py-1.5 text-left border-b hover:bg-red-50"
                        onClick={() => { setSelectedGroups(new Set()); setPage(1) }}
                      >
                        Clear all ({selectedGroups.size} selected)
                      </button>
                    )}
                    <div className="overflow-y-auto flex-1">
                      {filteredGroupOptions.pinned.length === 0 && filteredGroupOptions.rest.length === 0 ? (
                        <div className="px-3 py-2 text-xs text-gray-400">No groups found</div>
                      ) : (
                        <>
                          {filteredGroupOptions.pinned.length > 0 && (
                            <>
                              <div className="px-3 py-1 text-[10px] font-semibold text-gray-400 uppercase tracking-wide bg-gray-50 border-b">
                                Top Groups
                              </div>
                              {filteredGroupOptions.pinned.map(g => (
                                <label key={g} className="flex items-center gap-2 px-3 py-1.5 hover:bg-blue-50 cursor-pointer text-sm">
                                  <Checkbox checked={selectedGroups.has(g)} onCheckedChange={() => toggleGroup(g)} />
                                  <span className="truncate font-medium">{g}</span>
                                </label>
                              ))}
                              {filteredGroupOptions.rest.length > 0 && (
                                <div className="px-3 py-1 text-[10px] font-semibold text-gray-400 uppercase tracking-wide bg-gray-50 border-y">
                                  All Groups
                                </div>
                              )}
                            </>
                          )}
                          {filteredGroupOptions.rest.map(g => (
                            <label key={g} className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-50 cursor-pointer text-sm">
                              <Checkbox checked={selectedGroups.has(g)} onCheckedChange={() => toggleGroup(g)} />
                              <span className="truncate">{g}</span>
                            </label>
                          ))}
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Active group chips */}
              {selectedGroups.size > 0 && (
                <div className="flex flex-wrap gap-1.5 items-center">
                  {Array.from(selectedGroups).map(g => (
                    <span key={g} className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-50 border border-blue-200 rounded text-xs text-blue-800">
                      {g}
                      <button onClick={() => toggleGroup(g)} className="hover:text-red-500 ml-0.5">
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <CardTitle>Supplier List</CardTitle>
                <Badge variant="outline" className="hidden md:inline-flex">Default view: Compact</Badge>
              </div>
              <div className="flex items-center gap-2">
                <div ref={columnsMenuRef} className="relative">
                  <Button variant="outline" size="sm" onClick={() => setShowColumnManager((v) => !v)}>
                    <SlidersHorizontal className="h-4 w-4 mr-2" />
                    Columns
                  </Button>
                  {showColumnManager && (
                    <div className="absolute right-0 mt-2 w-56 rounded-md border bg-white shadow-md z-50 p-3">
                      <p className="text-xs font-medium text-gray-500 mb-2">Toggle Columns</p>
                      {COLUMN_DEFS.map((col) => (
                        <label key={col.key} className="flex items-center gap-2 text-sm cursor-pointer select-none py-1">
                          <Checkbox
                            checked={Boolean(visibleColumns[col.key])}
                            onCheckedChange={() => onToggleColumn(col.key)}
                          />
                          <span>{col.label}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
                {totalPages > 1 && (
                  <div className="flex items-center gap-1">
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
            {loading ? (
              <div className="py-8 text-center text-gray-500">Loading...</div>
            ) : items.length === 0 ? (
              <div className="py-8 text-center text-gray-500">No suppliers found</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b">
                      {visibleColumns['mill_code']           && <th className="text-left px-3 py-2 font-medium whitespace-nowrap cursor-pointer select-none hover:bg-gray-100" onClick={() => handleSort('mill_code')}>Mill Code<SortIcon col="mill_code" /></th>}
                      {visibleColumns['mills']               && <th className="text-left px-3 py-2 font-medium whitespace-nowrap cursor-pointer select-none hover:bg-gray-100" onClick={() => handleSort('mills')}>Mills<SortIcon col="mills" /></th>}
                      {visibleColumns['group_id']            && <th className="text-left px-3 py-2 font-medium whitespace-nowrap cursor-pointer select-none hover:bg-gray-100" onClick={() => handleSort('group_id')}>Group<SortIcon col="group_id" /></th>}
                      {visibleColumns['province']            && <th className="text-left px-3 py-2 font-medium whitespace-nowrap cursor-pointer select-none hover:bg-gray-100" onClick={() => handleSort('province')}>Province<SortIcon col="province" /></th>}
                      {visibleColumns['island']              && <th className="text-left px-3 py-2 font-medium whitespace-nowrap cursor-pointer select-none hover:bg-gray-100" onClick={() => handleSort('island')}>Island<SortIcon col="island" /></th>}
                      {visibleColumns['group_type']          && <th className="text-left px-3 py-2 font-medium whitespace-nowrap cursor-pointer select-none hover:bg-gray-100" onClick={() => handleSort('group_type')}>Group Type<SortIcon col="group_type" /></th>}
                      {visibleColumns['cap']                 && <th className="text-right px-3 py-2 font-medium whitespace-nowrap cursor-pointer select-none hover:bg-gray-100" onClick={() => handleSort('cap')}>CAP (tph)<SortIcon col="cap" /></th>}
                      {visibleColumns['cpo_prod_est_month']  && <th className="text-right px-3 py-2 font-medium whitespace-nowrap cursor-pointer select-none hover:bg-gray-100" onClick={() => handleSort('cpo_prod_est_month')}>CPO / Month<SortIcon col="cpo_prod_est_month" /></th>}
                      {visibleColumns['pk_prod_est_month']   && <th className="text-right px-3 py-2 font-medium whitespace-nowrap cursor-pointer select-none hover:bg-gray-100" onClick={() => handleSort('pk_prod_est_month')}>PK / Month<SortIcon col="pk_prod_est_month" /></th>}
                      {visibleColumns['pome_prod_est_month'] && <th className="text-right px-3 py-2 font-medium whitespace-nowrap cursor-pointer select-none hover:bg-gray-100" onClick={() => handleSort('pome_prod_est_month')}>POME / Month<SortIcon col="pome_prod_est_month" /></th>}
                      {visibleColumns['shell_prod_est_month']&& <th className="text-right px-3 py-2 font-medium whitespace-nowrap cursor-pointer select-none hover:bg-gray-100" onClick={() => handleSort('shell_prod_est_month')}>SHELL / Month<SortIcon col="shell_prod_est_month" /></th>}
                      <th className="text-right px-3 py-2 font-medium whitespace-nowrap">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((s, idx) => (
                      <tr key={s.id} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                        {visibleColumns['mill_code']           && <td className="px-3 py-2 whitespace-nowrap">{s.mill_code || '-'}</td>}
                        {visibleColumns['mills']               && <td className="px-3 py-2">{s.mills || '-'}</td>}
                        {visibleColumns['group_id']            && <td className="px-3 py-2 whitespace-nowrap">{s.group_id || '-'}</td>}
                        {visibleColumns['province']            && <td className="px-3 py-2 whitespace-nowrap">{s.province || '-'}</td>}
                        {visibleColumns['island']              && <td className="px-3 py-2 whitespace-nowrap">{s.island || '-'}</td>}
                        {visibleColumns['group_type']          && <td className="px-3 py-2">{s.group_type || '-'}</td>}
                        {visibleColumns['cap']                 && <td className="px-3 py-2 text-right">{s.cap ? Number(s.cap).toLocaleString('en-US') : '-'}</td>}
                        {visibleColumns['cpo_prod_est_month']  && <td className="px-3 py-2 text-right">{s.cpo_prod_est_month ? Number(s.cpo_prod_est_month).toLocaleString('en-US', { maximumFractionDigits: 0 }) : '-'}</td>}
                        {visibleColumns['pk_prod_est_month']   && <td className="px-3 py-2 text-right">{s.pk_prod_est_month ? Number(s.pk_prod_est_month).toLocaleString('en-US', { maximumFractionDigits: 0 }) : '-'}</td>}
                        {visibleColumns['pome_prod_est_month'] && <td className="px-3 py-2 text-right">{s.pome_prod_est_month ? Number(s.pome_prod_est_month).toLocaleString('en-US', { maximumFractionDigits: 0 }) : '-'}</td>}
                        {visibleColumns['shell_prod_est_month']&& <td className="px-3 py-2 text-right">{s.shell_prod_est_month ? Number(s.shell_prod_est_month).toLocaleString('en-US', { maximumFractionDigits: 0 }) : '-'}</td>}
                        <td className="px-3 py-2">
                          <div className="inline-flex gap-2 justify-end w-full">
                            <Button variant="outline" size="sm" onClick={() => setViewingSupplier(s)} className="bg-green-50 border-green-200 text-green-700 hover:bg-green-100">
                              <Eye className="h-4 w-4 mr-1" />View
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {totalPages > 1 && (
              <div className="flex items-center justify-between mt-4 border-t pt-4">
                <div className="text-sm text-gray-700">
                  Showing page {page} of {totalPages} ({total} suppliers)
                </div>
                <div className="flex items-center gap-1">
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
              </div>
            )}
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
      </div>
    </Layout>
  )
}
