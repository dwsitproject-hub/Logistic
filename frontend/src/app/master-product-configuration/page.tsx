'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { useRouter } from 'next/navigation'
import { Boxes, Cloud, CloudOff, Package, Pencil, Plus, Save } from 'lucide-react'
import Layout from '@/components/Layout'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { iconButtonClass } from '@/lib/iconButton'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { StitchFields } from '@/components/shared/stitchField'
import { MasterCodeBadge } from '@/components/shared/MasterCodeBadge'
import { MasterDhmSyncButton } from '@/components/shared/MasterDhmSyncButton'
import { MasterKpis } from '@/components/master/MasterKpis'
import { MasterFilterBar } from '@/components/master/MasterFilterBar'
import { MasterTableFooter } from '@/components/master/MasterTableFooter'
import { MasterDhmChip, MasterIdentityCell, MasterListTable, type MasterTableColumn } from '@/components/master/MasterListTable'
import { saveWithDhmConfirm } from '@/lib/dhmMasterSave'
import { masterCountText, masterDhmChip, type MasterDhmFilter } from '@/lib/masterDirectory'

interface Product {
  id: string
  product_name: string
  long_name?: string | null
  commodity_type?: string | null
  material_code?: string | null
  /** Derived on read: the product (SAP text) contracts carry for this material_code, and how many contracts use it. */
  klip_product?: string | null
  klip_contracts?: number | null
  material_group?: string | null
  hs_code?: string | null
  uom?: string | null
  code_klip?: string | null
  code_dhm?: string | null
  dhm_id?: string | null
  dhm_push_status?: string | null
  dhm_push_error?: string | null
  dhm_push_attempts?: number | null
  dhm_push_next_attempt_at?: string | null
  percent_produce: number | null
  working_hours_per_day: number | null
  working_days_per_month: number | null
  working_days_per_year: number | null
}

/** The cards: the catalog and the products contracts use, and the DHM counts of both (the cards follow the scope the list shows). */
interface ProductSummary {
  total: number
  usedInKlip: number
  synced: number
  notSynced: number
  failed: number
  usedSynced: number
  usedNotSynced: number
  usedFailed: number
}

// What DHM accepts for a commodity type today (GET /v1/catalog, 2026-10-26). The Hub's Integrator edits the list; a
// value saved earlier that is not in it stays selectable so it is not wiped by an edit.
const COMMODITY_TYPES = ['liquid', 'solid', 'Fuel, Greases, & Lub', 'Chemical', 'Civil Supplies (Building)']

const PAGE_SIZE = 20
type Scope = 'used' | 'all'

function sortText(row: Product, key: string): string {
  switch (key) {
    case 'klip_contracts':
      return String(row.klip_contracts ?? 0).padStart(9, '0')
    case 'commodity_type':
      return row.commodity_type || ''
    case 'dhm':
      return masterDhmChip(row).label
    case 'codes':
      return row.code_klip || ''
    default:
      return row.product_name || ''
  }
}

function detailLine(row: Product): string {
  return [row.material_group, row.hs_code ? `HS ${row.hs_code}` : null, row.uom ? `UoM ${row.uom}` : null].filter(Boolean).join(' · ') || 'No DHM details yet'
}

export default function MasterProductConfigurationPage() {
  const router = useRouter()
  const [items, setItems] = useState<Product[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebouncedValue(search.trim(), 300)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState<Product | null>(null)
  const [form, setForm] = useState<any>({ product_name: '', percent_produce: '', working_hours_per_day: '', working_days_per_month: '', working_days_per_year: '' })
  // On: only products whose Material Code is on at least one KLIP contract (what the DHM Sync sends). Off: the whole DHM catalog.
  const [scope, setScope] = useState<Scope>('used')
  const [dhm, setDhm] = useState<MasterDhmFilter>('all')
  const [summary, setSummary] = useState<ProductSummary | null>(null)
  const [sortKey, setSortKey] = useState('product_name')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [isAdmin, setIsAdmin] = useState(false)

  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / PAGE_SIZE)), [total])

  useEffect(() => {
    const userStr = localStorage.getItem('user')
    if (!userStr) {
      router.push('/login')
      return
    }
    try {
      const user = JSON.parse(userStr) as { role?: string }
      setIsAdmin(String(user.role || '').toUpperCase() === 'ADMIN')
    } catch {
      setIsAdmin(false)
    }
  }, [router])

  const fetchData = useCallback(async (pageNum: number, searchQuery: string, scopeValue: Scope, dhmFilter: MasterDhmFilter) => {
    setLoading(true)
    setError('')
    try {
      const params: Record<string, string> = { page: String(pageNum), limit: String(PAGE_SIZE), withUsage: 'true' }
      if (searchQuery) params.search = searchQuery
      if (scopeValue === 'used') params.usedInKlip = 'true'
      if (dhmFilter !== 'all') params.dhm = dhmFilter
      const res = await api.get('/products', { params })
      setItems(res.data.data.items)
      setTotal(res.data.data.total)
    } catch (e: any) {
      setError(e?.response?.data?.error?.message || 'Failed to load products')
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchSummary = useCallback(async () => {
    try {
      const res = await api.get('/products/summary')
      setSummary(res.data?.data ?? null)
    } catch (e) {
      // the cards are informational: the list still works without them
      console.error('Failed to load the product summary', e)
    }
  }, [])

  useEffect(() => {
    void fetchData(page, debouncedSearch, scope, dhm)
  }, [page, debouncedSearch, scope, dhm, fetchData])

  useEffect(() => {
    void fetchSummary()
  }, [fetchSummary])

  const refresh = () => {
    void fetchData(page, debouncedSearch, scope, dhm)
    void fetchSummary()
  }

  const openAdd = () => {
    setEditing(null)
    setForm({ product_name: '' })
    setShowModal(true)
  }
  const openEdit = (p: Product) => {
    setEditing(p)
    setForm({ ...p })
    setShowModal(true)
  }

  const saveProduct = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setSuccess('')
    try {
      const payload = {
        product_name: form.product_name,
        long_name: form.long_name || null,
        commodity_type: form.commodity_type || null,
        material_code: form.material_code || null,
        material_group: form.material_group || null,
        hs_code: form.hs_code || null,
        uom: form.uom || null,
      }
      const noun = 'product'
      if (editing) {
        await saveWithDhmConfirm((overwrite) => api.put(`/products/${editing.id}${overwrite ? '?dhmOverwrite=true' : ''}`, payload), noun)
        setSuccess('Product updated')
      } else {
        await saveWithDhmConfirm((overwrite) => api.post(`/products${overwrite ? '?dhmOverwrite=true' : ''}`, payload), noun)
        setSuccess('Product created')
      }
      setShowModal(false)
      refresh()
    } catch (err: any) {
      const msg =
        err?.response?.data?.error?.message ||
        (err?.response ? `${err.response.status} ${err.response.statusText}` : '') ||
        err?.message ||
        'Save failed'
      setError(msg)
    }
  }

  const sortedRows = useMemo(
    () =>
      [...items].sort((a, b) => {
        const cmp = sortText(a, sortKey).localeCompare(sortText(b, sortKey), undefined, { numeric: true })
        return sortDir === 'asc' ? cmp : -cmp
      }),
    [items, sortKey, sortDir],
  )

  const columns: MasterTableColumn<Product>[] = [
    {
      id: 'product_name',
      label: 'Product',
      sortable: true,
      render: (row) => <MasterIdentityCell name={row.product_name} subtitle={row.long_name && row.long_name !== row.product_name ? row.long_name : null} />,
    },
    {
      id: 'codes',
      label: 'Codes',
      sortable: true,
      className: 'whitespace-nowrap',
      render: (row) => (
        <div className="flex flex-wrap items-center gap-1.5">
          <MasterCodeBadge kind="klip" value={row.code_klip || ''} fit />
          {row.code_dhm ? <MasterCodeBadge kind="dhm" value={row.code_dhm} fit /> : null}
          {row.material_code ? <MasterCodeBadge kind="sap" value={row.material_code} fit /> : null}
        </div>
      ),
    },
    {
      id: 'klip_contracts',
      label: 'In KLIP contracts',
      sortable: true,
      className: 'whitespace-nowrap',
      render: (row) => (
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-gray-900" title={row.klip_product || undefined}>
            {row.klip_product || '-'}
          </div>
          <div className="text-xs tabular-nums text-gray-500">
            {row.klip_contracts ? `${row.klip_contracts.toLocaleString('en-US')} ${row.klip_contracts === 1 ? 'contract' : 'contracts'}` : 'No contract yet'}
          </div>
        </div>
      ),
    },
    {
      id: 'commodity_type',
      label: 'Type (DHM)',
      sortable: true,
      render: (row) => {
        const line = detailLine(row)
        return (
          <div className="min-w-0 max-w-[18rem]">
            <div className="truncate text-sm font-medium text-gray-900">{row.commodity_type || '-'}</div>
            <div className="truncate text-xs text-gray-500" title={line}>
              {line}
            </div>
          </div>
        )
      },
    },
    { id: 'dhm', label: 'DHM', sortable: true, className: 'whitespace-nowrap', render: (row) => <MasterDhmChip row={row} /> },
  ]

  // The DHM numbers follow the scope the list shows: the used products (what the Sync pushes) or the whole catalog.
  const dhmSynced = scope === 'used' ? summary?.usedSynced : summary?.synced
  const dhmNotSynced = scope === 'used' ? summary?.usedNotSynced : summary?.notSynced
  const dhmFailed = scope === 'used' ? summary?.usedFailed : summary?.failed
  const scopeTotal = summary ? (scope === 'used' ? summary.usedInKlip : summary.total) : null
  const scopeWord = scope === 'used' ? 'of the used products' : 'whole catalog'

  const kpis = [
    { id: 'total', icon: <Package className="h-4 w-4" />, label: 'Total products', value: summary?.total ?? null, tone: 'bg-blue-50 text-blue-600', hint: 'the DHM catalog' },
    { id: 'used', icon: <Boxes className="h-4 w-4" />, label: 'Used in KLIP', value: summary?.usedInKlip ?? null, tone: 'bg-violet-50 text-violet-600', hint: 'on at least one contract' },
    { id: 'synced', icon: <Cloud className="h-4 w-4" />, label: 'Synced to DHM', value: dhmSynced ?? null, tone: 'bg-emerald-50 text-emerald-600', hint: scopeWord },
    {
      id: 'not-synced',
      icon: <CloudOff className="h-4 w-4" />,
      label: 'Not synced',
      value: dhmNotSynced ?? null,
      tone: 'bg-amber-50 text-amber-600',
      hint: dhmFailed ? `${dhmFailed.toLocaleString('en-US')} more failed to deliver` : scopeWord,
    },
  ]

  return (
    <Layout>
      <StitchFields>
        <div className="space-y-6">
          {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">{error}</div>}
          {success && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-800">{success}</div>}

          <MasterKpis items={kpis} />

          <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
            <MasterFilterBar
              search={search}
              onSearch={(value) => {
                setSearch(value)
                setPage(1)
              }}
              placeholder="Short name, long name, material code or DHM code"
              ariaLabel="Search products"
              dhm={dhm}
              onDhm={(value) => {
                setDhm(value)
                setPage(1)
              }}
              dhmCounts={
                summary && dhmSynced != null && dhmNotSynced != null && dhmFailed != null && scopeTotal != null
                  ? { all: scopeTotal, synced: dhmSynced, not_synced: dhmNotSynced, failed: dhmFailed }
                  : undefined
              }
              extraActive={scope !== 'used'}
              onClear={() => {
                setSearch('')
                setDhm('all')
                setScope('used')
                setPage(1)
              }}
              actions={
                <>
                  {isAdmin ? <MasterDhmSyncButton master="product" onDone={refresh} iconOnly /> : null}
                  <Button variant="ghost" size="icon" className={iconButtonClass('add')} title="New product" aria-label="New product" onClick={openAdd}>
                    <Plus className="h-4 w-4" aria-hidden />
                  </Button>
                </>
              }
            >
              <Select
                value={scope}
                onValueChange={(value) => {
                  setScope(value as Scope)
                  setPage(1)
                }}
              >
                <SelectTrigger
                  className="h-9 w-[210px] gap-2 [&>span]:flex-1 [&>span]:truncate [&>span]:text-left"
                  aria-label="Which products to list"
                  title="Used in KLIP: only products whose Material Code is on at least one KLIP contract. Whole catalog: every product DHM has."
                >
                  <Boxes className="h-4 w-4 shrink-0 text-gray-400" aria-hidden />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="used">Used in KLIP{summary ? ` (${summary.usedInKlip.toLocaleString('en-US')})` : ''}</SelectItem>
                  <SelectItem value="all">Whole catalog{summary ? ` (${summary.total.toLocaleString('en-US')})` : ''}</SelectItem>
                </SelectContent>
              </Select>
            </MasterFilterBar>

            <MasterListTable
              rows={sortedRows}
              columns={columns}
              getRowId={(row) => row.id}
              loading={loading}
              emptyLabel={search.trim() || dhm !== 'all' || scope !== 'used' ? 'No products match these filters' : 'No products yet'}
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
                  title={isAdmin ? 'Edit product' : 'View product'}
                  aria-label={`${isAdmin ? 'Edit' : 'View'} ${row.product_name}`}
                  onClick={() => openEdit(row)}
                >
                  <Pencil className="h-4 w-4" />
                </Button>
              )}
            />

            <MasterTableFooter
              countText={`${masterCountText(items.length, total, scopeTotal ?? total, 'products')} · click a row to ${isAdmin ? 'edit' : 'view'} it`}
              kinds={['klip', 'dhm', 'sap']}
              pager={{ page: page, totalPages: totalPages, onPageChange: setPage, disabled: loading }}
            />
          </div>

          {showModal && (
            <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40">
              <div className="bg-white rounded-md w-full max-w-3xl max-h-[90vh] overflow-y-auto px-6 pb-6">
                <h2 className="text-xl font-semibold mb-4">{editing ? 'Edit Product' : 'New Product'}</h2>
                <form onSubmit={saveProduct} className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <Label>Product Code (KLIP)</Label>
                    <Input value={editing?.code_klip || ''} placeholder="Assigned on save" readOnly disabled />
                  </div>
                  <div className="space-y-1">
                    <Label>Code (DHM)</Label>
                    <Input value={editing?.code_dhm || ''} placeholder="-" readOnly disabled />
                  </div>
                  <div className="space-y-1 md:col-span-2">
                    <Label>Short Name (DHM)</Label>
                    <Input
                      value={form.product_name ?? ''}
                      onChange={(e) => setForm((f: { product_name?: string }) => ({ ...f, product_name: e.target.value }))}
                      required
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>Long Name (DHM)</Label>
                    <Input value={form.long_name ?? ''} onChange={(e) => setForm((f: Product) => ({ ...f, long_name: e.target.value }))} />
                  </div>
                  <div className="space-y-1">
                    <Label>Type (DHM)</Label>
                    <select
                      className="w-full rounded-md border px-3 py-2 text-sm"
                      value={form.commodity_type ?? ''}
                      onChange={(e) => setForm((f: Product) => ({ ...f, commodity_type: e.target.value }))}
                    >
                      <option value="">Select a type</option>
                      {form.commodity_type && !COMMODITY_TYPES.includes(form.commodity_type) ? (
                        <option value={form.commodity_type}>{form.commodity_type}</option>
                      ) : null}
                      {COMMODITY_TYPES.map((type) => (
                        <option key={type} value={type}>
                          {type}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <Label>Material Code (SAP)</Label>
                    <Input
                      value={form.material_code ?? ''}
                      placeholder="Filled from the SAP import"
                      onChange={(e) => setForm((f: Product) => ({ ...f, material_code: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>Material Group (DHM)</Label>
                    <Input value={form.material_group ?? ''} onChange={(e) => setForm((f: Product) => ({ ...f, material_group: e.target.value }))} />
                  </div>
                  <div className="space-y-1">
                    <Label>HS Code (DHM)</Label>
                    <Input value={form.hs_code ?? ''} onChange={(e) => setForm((f: Product) => ({ ...f, hs_code: e.target.value }))} />
                  </div>
                  <div className="space-y-1">
                    <Label>UoM (DHM)</Label>
                    <Input value={form.uom ?? ''} onChange={(e) => setForm((f: Product) => ({ ...f, uom: e.target.value }))} />
                  </div>
                  <div className="col-span-full flex justify-end gap-2 mt-2">
                    <Button type="button" variant="outline" onClick={() => setShowModal(false)}>
                      Cancel
                    </Button>
                    <Button type="submit">
                      <Save className="mr-2 h-4 w-4" aria-hidden />
                      Save
                    </Button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </div>
      </StitchFields>
    </Layout>
  )
}
