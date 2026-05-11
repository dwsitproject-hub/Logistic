'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Layout from '@/components/Layout'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

interface Product {
  id: string
  product_name: string
  percent_produce: number | null
  working_hours_per_day: number | null
  working_days_per_month: number | null
  working_days_per_year: number | null
}

export default function MasterProductConfigurationPage() {
  const router = useRouter()
  const [items, setItems] = useState<Product[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [limit] = useState(20)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState<Product | null>(null)
  const [form, setForm] = useState<any>({ product_name: '', percent_produce: '', working_hours_per_day: '', working_days_per_month: '', working_days_per_year: '' })

  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / limit)), [total, limit])

  useEffect(() => {
    const userStr = localStorage.getItem('user')
    if (!userStr) { router.push('/login'); return }
    fetchData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page])

  const fetchData = async () => {
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams()
      params.append('page', String(page))
      params.append('limit', String(limit))
      if (search) params.append('search', search)
      const res = await api.get(`/products?${params.toString()}`)
      setItems(res.data.data.items)
      setTotal(res.data.data.total)
    } catch (e: any) {
      setError(e?.response?.data?.error?.message || 'Failed to load products')
    } finally {
      setLoading(false)
    }
  }

  const openAdd = () => { setEditing(null); setForm({ product_name: '', percent_produce: '', working_hours_per_day: '', working_days_per_month: '', working_days_per_year: '' }); setShowModal(true) }
  const openEdit = (p: Product) => { setEditing(p); setForm({ ...p }); setShowModal(true) }

  const saveProduct = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(''); setSuccess('')
    try {
      const payload = {
        product_name: form.product_name,
        percent_produce: form.percent_produce === '' ? null : Number(form.percent_produce),
        working_hours_per_day: form.working_hours_per_day === '' ? null : Number(form.working_hours_per_day),
        working_days_per_month: form.working_days_per_month === '' ? null : Number(form.working_days_per_month),
        working_days_per_year: form.working_days_per_year === '' ? null : Number(form.working_days_per_year),
      }
      if (editing) { await api.put(`/products/${editing.id}`, payload); setSuccess('Product updated') }
      else { await api.post('/products', payload); setSuccess('Product created') }
      setShowModal(false); fetchData()
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
    try { await api.delete(`/products/${p.id}`); fetchData() } catch (e: any) { alert(e?.response?.data?.error?.message || 'Delete failed') }
  }

  return (
    <Layout>
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Master Product Configuration</h1>
        <div className="flex items-center gap-2">
          <Input placeholder="Search products..." value={search} onChange={(e) => setSearch(e.target.value)} />
          <Button onClick={() => { setPage(1); fetchData() }}>Search</Button>
          <Button onClick={openAdd}>Add Product</Button>
        </div>
      </div>

      {error && <div className="text-red-600 text-sm">{error}</div>}
      {success && <div className="text-green-600 text-sm">{success}</div>}

      <Card>
        <CardHeader>
          <CardTitle>Products</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div>Loading...</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left">
                    <th className="p-2">Product Name</th>
                    <th className="p-2">% Produce</th>
                    <th className="p-2">Working Hours / Day</th>
                    <th className="p-2">Working Days / Month</th>
                    <th className="p-2">Working Days / Year</th>
                    <th className="p-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((p) => (
                    <tr key={p.id} className="border-t">
                      <td className="p-2 font-medium">{p.product_name}</td>
                      <td className="p-2">{p.percent_produce ?? ''}</td>
                      <td className="p-2">{p.working_hours_per_day ?? ''}</td>
                      <td className="p-2">{p.working_days_per_month ?? ''}</td>
                      <td className="p-2">{p.working_days_per_year ?? ''}</td>
                      <td className="p-2 flex gap-2">
                        <Button variant="outline" onClick={() => openEdit(p)}>Edit</Button>
                        <Button variant="destructive" onClick={() => removeProduct(p)}>Delete</Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="flex items-center justify-end gap-2 mt-4">
            <Button variant="outline" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Prev</Button>
            <span className="text-sm">Page {page} of {totalPages}</span>
            <Button variant="outline" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
          </div>
        </CardContent>
      </Card>

      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center">
          <div className="bg-white rounded-md w-full max-w-3xl p-6 max-h-[90vh] overflow-y-auto">
            <h2 className="text-xl font-semibold mb-4">{editing ? 'Edit Product' : 'Add Product'}</h2>
            <form onSubmit={saveProduct} className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {[
                ['product_name','Product Name'],
                ['percent_produce','% Produce'],
                ['working_hours_per_day','No of Working Hours per day'],
                ['working_days_per_month','No of Working Days per month'],
                ['working_days_per_year','No of Working Days per year']
              ].map(([key, label]) => (
                <div key={key as string} className="space-y-1">
                  <Label>{label}</Label>
                  <Input
                    type={(key === 'product_name') ? 'text' : 'number'}
                    value={form[key as string] ?? ''}
                    onChange={(e) => setForm((f: any) => ({ ...f, [key as string]: e.target.value }))}
                    required={key === 'product_name'}
                  />
                </div>
              ))}
              <div className="col-span-full flex justify-end gap-2 mt-2">
                <Button type="button" variant="outline" onClick={() => setShowModal(false)}>Cancel</Button>
                <Button type="submit">Save</Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
    </Layout>
  )
}


