'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { useRouter } from 'next/navigation'
import Layout from '@/components/Layout'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
import { MasterRowActions } from '@/components/shared/MasterRowActions'
import { dhmStatusListColumn } from '@/lib/dhmStatusColumn'
import { saveWithDhmConfirm } from '@/lib/dhmMasterSave'
import { Plus } from 'lucide-react'
import { MasterDhmSyncButton } from '@/components/shared/MasterDhmSyncButton'

interface Product {
  id: string
  product_name: string
  long_name?: string | null
  commodity_type?: string | null
  code_klip?: string | null
  code_dhm?: string | null
  percent_produce: number | null
  working_hours_per_day: number | null
  working_days_per_month: number | null
  working_days_per_year: number | null
}

const PRODUCT_COLUMNS: MasterListTableColumn<Product>[] = [
  { id: 'code_klip', label: 'Product Code (KLIP)', getText: (row) => row.code_klip || '-' },
  { id: 'code_dhm', label: 'Product Code (DHM)', getText: (row) => row.code_dhm || '-' },
  { id: 'product_name', label: 'Product', getText: (row) => row.product_name || '-' },
  { id: 'long_name', label: 'Long Name', getText: (row) => row.long_name || '-' },
  { id: 'commodity_type', label: 'Type', getText: (row) => row.commodity_type || '-' },
  dhmStatusListColumn<Product>(),
]

export default function MasterProductConfigurationPage() {
  const router = useRouter()
  const [items, setItems] = useState<Product[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [limit] = useState(20)
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebouncedValue(search.trim(), 300)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState<Product | null>(null)
  const [form, setForm] = useState<any>({ product_name: '', percent_produce: '', working_hours_per_day: '', working_days_per_month: '', working_days_per_year: '' })
  const [sortKey, setSortKey] = useState('product_name')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [isAdmin, setIsAdmin] = useState(false)
  const productColumns = useListColumnLayout('master-product.visibleColumns.v4', PRODUCT_COLUMNS)

  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / limit)), [total, limit])

  useEffect(() => {
    const userStr = localStorage.getItem('user')
    if (!userStr) { router.push('/login'); return }
    try {
      const user = JSON.parse(userStr) as { role?: string }
      setIsAdmin(String(user.role || '').toUpperCase() === 'ADMIN')
    } catch {
      setIsAdmin(false)
    }
  }, [router])

  const fetchData = useCallback(async (pageNum: number, searchQuery: string) => {
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams()
      params.append('page', String(pageNum))
      params.append('limit', String(limit))
      if (searchQuery) params.append('search', searchQuery)
      const res = await api.get(`/products?${params.toString()}`)
      setItems(res.data.data.items)
      setTotal(res.data.data.total)
    } catch (e: any) {
      setError(e?.response?.data?.error?.message || 'Failed to load products')
    } finally {
      setLoading(false)
    }
  }, [limit])

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

  const openAdd = () => { setEditing(null); setForm({ product_name: '' }); setShowModal(true) }
  const openEdit = (p: Product) => { setEditing(p); setForm({ ...p }); setShowModal(true) }

  const saveProduct = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(''); setSuccess('')
    try {
      const payload = {
        product_name: form.product_name,
        long_name: form.long_name || null,
        commodity_type: form.commodity_type || null,
      }
      const noun = 'product'
      if (editing) {
        await saveWithDhmConfirm((overwrite) => api.put(`/products/${editing.id}${overwrite ? '?dhmOverwrite=true' : ''}`, payload), noun)
        setSuccess('Product updated')
      } else {
        await saveWithDhmConfirm((overwrite) => api.post(`/products${overwrite ? '?dhmOverwrite=true' : ''}`, payload), noun)
        setSuccess('Product created')
      }
      setShowModal(false); void fetchData(page, debouncedSearch)
    } catch (err: any) {
      const msg = err?.response?.data?.error?.message 
        || (err?.response ? `${err.response.status} ${err.response.statusText}` : '')
        || err?.message 
        || 'Save failed'
      setError(msg)
    }
  }

  const removeProduct = async (p: Product) => {
    if (!confirm(`Delete ${p.product_name}?`)) return
    try { await api.delete(`/products/${p.id}`); void fetchData(page, debouncedSearch) } catch (e: any) { alert(e?.response?.data?.error?.message || 'Delete failed') }
  }

  return (
    <Layout>
    <StitchFields>
      <div className="space-y-6">
      {error && <div className="text-red-600 text-sm">{error}</div>}
      {success && <div className="text-green-600 text-sm">{success}</div>}

      <ListFilterPanel
        onReset={() => setSearch('')}
        showReset={search.trim().length > 0}
        chips={
          search.trim()
            ? [{ id: 'search', label: `Search: ${search.trim()}`, onRemove: () => setSearch('') }]
            : []
        }
      >
        <div className={LIST_FILTER_FIELDS_ROW_CLASS}>
          <div className="min-w-[12rem] flex-[1.4]">
            <label className={LIST_FILTER_FIELD_LABEL_CLASS}>Search</label>
            <div className="relative">
              <StitchSearchIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                placeholder="Product name"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="rounded-lg border-slate-200 pl-10 text-slate-700 placeholder:text-slate-400 focus-visible:ring-blue-600"
              />
              </div>
            </div>
            <div className="flex shrink-0 items-end gap-2">
              <Button size="sm" className="shrink-0" onClick={openAdd}>
                <Plus className="h-4 w-4 mr-2" />
                New Product
              </Button>
              {isAdmin ? <MasterDhmSyncButton master="product" onDone={() => void fetchData(page, debouncedSearch)} /> : null}
            </div>
          </div>
      </ListFilterPanel>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base flex items-center gap-2 flex-wrap">
                <span>All Products</span>
              </CardTitle>
              <p className="text-xs text-gray-500 mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0">
                <span className="whitespace-nowrap tabular-nums text-gray-700">
                  <span className="font-semibold">{total.toLocaleString('en-US')}</span> products
                </span>
                <span className="text-gray-400" aria-hidden>·</span>
                <span className="whitespace-nowrap tabular-nums">
                  Page {page}/{totalPages} · {items.length} rows
                </span>
              </p>
            </div>
            <div className="flex items-center gap-2">
              <ListPageColumnsMenu
                columns={productColumns.menuColumns}
                visibleIds={productColumns.visibleIds}
                disabled={loading}
                onToggle={productColumns.toggle}
                onSelectAll={productColumns.selectAll}
                onUnselectAll={productColumns.unselectAll}
                onReset={productColumns.reset}
                onReorder={productColumns.reorder}
              />
            {totalPages > 1 ? (
              <div className="flex items-center gap-2 border-l border-gray-200 pl-2 ml-1">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Previous</Button>
                <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
              </div>
            ) : null}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <MasterListCompactTable
            tightActions
            rows={[...items].sort((a, b) => {
              const col = PRODUCT_COLUMNS.find((item) => item.id === sortKey)
              const left = col?.getText(a) ?? ''
              const right = col?.getText(b) ?? ''
              const cmp = left.localeCompare(right, undefined, { numeric: true })
              return sortDir === 'asc' ? cmp : -cmp
            })}
            columns={PRODUCT_COLUMNS.filter((col) => productColumns.orderedVisibleIds.includes(col.id)).sort(
              (a, b) => productColumns.orderedVisibleIds.indexOf(a.id) - productColumns.orderedVisibleIds.indexOf(b.id),
            )}
            getRowId={(row) => row.id}
            sortKey={sortKey}
            sortDir={sortDir}
            dragColId={productColumns.dragColId}
            loading={loading}
            emptyLabel="No products found"
            onSort={(id) => {
              setSortDir((dir) => (sortKey === id ? (dir === 'asc' ? 'desc' : 'asc') : 'asc'))
              setSortKey(id)
            }}
            onDragStart={productColumns.setDragColId}
            onDragEnd={() => productColumns.setDragColId(null)}
            onDrop={(id) => {
              if (productColumns.dragColId) productColumns.reorder(productColumns.dragColId, id)
              productColumns.setDragColId(null)
            }}
            renderActions={(row) => (
              <MasterRowActions
                isAdmin={isAdmin}
                editLabel={isAdmin ? 'Edit product' : 'View product'}
                deleteLabel="Delete product"
                onEdit={() => openEdit(row)}
                onDelete={() => void removeProduct(row)}
              />
            )}
          />
        </CardContent>
      </Card>

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
                <Label>Product Code (DHM)</Label>
                <Input value={editing?.code_dhm || ''} placeholder="-" readOnly disabled />
              </div>
              <div className="space-y-1 md:col-span-2">
                <Label>Product</Label>
                <Input
                  value={form.product_name ?? ''}
                  onChange={(e) => setForm((f: { product_name?: string }) => ({ ...f, product_name: e.target.value }))}
                  required
                />
              </div>
              <div className="space-y-1">
                <Label>Long Name</Label>
                <Input
                  value={form.long_name ?? ''}
                  onChange={(e) => setForm((f: Product) => ({ ...f, long_name: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <Label>Type</Label>
                <Input
                  value={form.commodity_type ?? ''}
                  onChange={(e) => setForm((f: Product) => ({ ...f, commodity_type: e.target.value }))}
                />
              </div>
              <div className="col-span-full flex justify-end gap-2 mt-2">
                <Button type="button" variant="outline" onClick={() => setShowModal(false)}>Cancel</Button>
                <Button type="submit">Save</Button>
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


