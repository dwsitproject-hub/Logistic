'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import api from '@/lib/api'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { RefreshCw } from 'lucide-react'

/**
 * The SAP materials under the Master Products.
 *
 * KLIP's Master Product is the broad name (CPO); SAP sends a material per PO line and one product has several (CPO has FFA 3.5-5, RSPO MB and FFA > 5). DHM keeps one commodity per
 * material, each with its own DataHub code, and JPS takes that code: the material is the smallest unit and the key of the mapping KLIP x DHM x JPS. The SAP import fills this list
 * after every run; the DHM sync fills the DHM code. A material with no Master Product (a contract with a blank product, a label that has no row) is linked here by a person, and the
 * import never changes a link a person set.
 */
interface MaterialRow {
  id: string
  material_code: string
  material_description: string | null
  product_id: string | null
  product_name: string | null
  product_label: string | null
  product_link_source: 'AUTO' | 'USER'
  code_dhm: string | null
  dhm_is_deleted: boolean
  contracts: number
  last_seen_at: string | null
}

interface ProductOption {
  id: string
  product_name: string
}

interface Summary {
  total: number
  unlinked: number
  no_dhm: number
}

type StatusFilter = 'all' | 'unlinked' | 'no_dhm'

const FILTERS: Array<{ id: StatusFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'unlinked', label: 'No Master Product' },
  { id: 'no_dhm', label: 'No DHM code' },
]

export function SapMaterialsCard({ canEdit }: { canEdit: boolean }) {
  const [items, setItems] = useState<MaterialRow[]>([])
  const [products, setProducts] = useState<ProductOption[]>([])
  const [summary, setSummary] = useState<Summary>({ total: 0, unlinked: 0, no_dhm: 0 })
  const [status, setStatus] = useState<StatusFilter>('all')
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebouncedValue(search.trim(), 300)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [savingId, setSavingId] = useState<string | null>(null)
  const requestSeq = useRef(0)

  const load = useCallback(async () => {
    const seq = ++requestSeq.current
    setLoading(true)
    setError('')
    try {
      const params: Record<string, string> = {}
      if (status !== 'all') params.status = status
      if (debouncedSearch) params.search = debouncedSearch
      const res = await api.get('/products/materials', { params })
      if (seq !== requestSeq.current) return
      setItems(res.data.data.items as MaterialRow[])
      setSummary(res.data.data.summary as Summary)
      setProducts(res.data.data.products as ProductOption[])
    } catch (e: unknown) {
      if (seq !== requestSeq.current) return
      const message = (e as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message
      setError(message || 'Failed to load SAP materials')
    } finally {
      if (seq === requestSeq.current) setLoading(false)
    }
  }, [status, debouncedSearch])

  useEffect(() => {
    void load()
  }, [load])

  const link = async (row: MaterialRow, productId: string) => {
    setSavingId(row.id)
    setError('')
    setNotice('')
    try {
      const res = await api.put(`/products/materials/${row.id}`, { product_id: productId || null })
      const saved = res.data.data as MaterialRow
      setItems((current) => current.map((item) => (item.id === saved.id ? saved : item)))
      setNotice(
        saved.product_name
          ? `${saved.material_code} is linked to ${saved.product_name}`
          : `${saved.material_code} is no longer linked to a product`,
      )
      // the counts above the table changed with it
      void load()
    } catch (e: unknown) {
      const message = (e as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message
      setError(message || 'Failed to link the material')
    } finally {
      setSavingId(null)
    }
  }

  return (
    <Card className="mt-4">
      <CardHeader>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <CardTitle className="text-base">SAP Materials</CardTitle>
            <p className="text-xs text-gray-500 mt-1 flex flex-wrap items-center gap-x-1.5">
              <span className="whitespace-nowrap tabular-nums text-gray-700">
                <span className="font-semibold">{summary.total.toLocaleString('en-US')}</span> materials
              </span>
              <span className="text-gray-400" aria-hidden>·</span>
              <span className="whitespace-nowrap tabular-nums">{summary.unlinked.toLocaleString('en-US')} without a Master Product</span>
              <span className="text-gray-400" aria-hidden>·</span>
              <span className="whitespace-nowrap tabular-nums">{summary.no_dhm.toLocaleString('en-US')} without a DHM code</span>
            </p>
            <p className="text-xs text-gray-500 mt-1 max-w-3xl">
              The material is the smallest unit of a commodity: DHM keeps one commodity (and one DHM code) per material, and JPS takes that code. The list is filled from the SAP
              import; a material that no Master Product claims is linked here.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Input
              className="h-8 w-56 text-sm"
              placeholder="Search code, description, product"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search SAP materials"
            />
            {FILTERS.map((f) => (
              <Button key={f.id} type="button" size="sm" variant={status === f.id ? 'default' : 'outline'} onClick={() => setStatus(f.id)}>
                {f.label}
              </Button>
            ))}
            <Button type="button" size="sm" variant="outline" disabled={loading} onClick={() => void load()}>
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden />
              Refresh
            </Button>
          </div>
        </div>
        {error ? <p className="text-sm text-red-600 mt-2" role="alert">{error}</p> : null}
        {notice ? <p className="text-sm text-green-700 mt-2" role="status">{notice}</p> : null}
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500 border-b">
                <th className="py-2 pr-3 font-medium whitespace-nowrap">Material Code (SAP)</th>
                <th className="py-2 pr-3 font-medium">Material</th>
                <th className="py-2 pr-3 font-medium">Master Product</th>
                <th className="py-2 pr-3 font-medium whitespace-nowrap">DHM Code</th>
                <th className="py-2 pr-0 font-medium text-right whitespace-nowrap">Contracts</th>
              </tr>
            </thead>
            <tbody>
              {items.map((row) => (
                <tr key={row.id} className="border-b last:border-b-0 align-top">
                  <td className="py-2 pr-3 whitespace-nowrap font-mono text-xs">{row.material_code}</td>
                  <td className="py-2 pr-3">{row.material_description || '-'}</td>
                  <td className="py-2 pr-3 min-w-[14rem]">
                    {canEdit ? (
                      <select
                        className="w-full rounded-md border px-2 py-1 text-sm"
                        value={row.product_id ?? ''}
                        disabled={savingId === row.id}
                        onChange={(e) => void link(row, e.target.value)}
                        aria-label={`Master Product of ${row.material_code}`}
                      >
                        <option value="">Not linked</option>
                        {products.map((p) => (
                          <option key={p.id} value={p.id}>{p.product_name}</option>
                        ))}
                      </select>
                    ) : (
                      <span>{row.product_name || '-'}</span>
                    )}
                    <div className="text-xs text-gray-500 mt-0.5">
                      {row.product_id
                        ? row.product_link_source === 'USER'
                          ? 'Linked by a person'
                          : 'Linked from the SAP product name'
                        : row.product_label
                          ? `Contracts call it "${row.product_label}", which has no Master Product`
                          : 'Contracts carry no product name for it'}
                    </div>
                  </td>
                  <td className="py-2 pr-3 whitespace-nowrap font-mono text-xs">
                    {row.code_dhm || '-'}
                    {row.dhm_is_deleted ? <span className="ml-1.5 text-red-600">(deleted in DHM)</span> : null}
                  </td>
                  <td className="py-2 pr-0 text-right tabular-nums">{row.contracts.toLocaleString('en-US')}</td>
                </tr>
              ))}
              {!loading && items.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-sm text-gray-500">
                    {summary.total === 0 ? 'No SAP material yet: the list fills after the next SAP import.' : 'No material matches.'}
                  </td>
                </tr>
              ) : null}
              {loading && items.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-sm text-gray-500">Loading...</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  )
}
