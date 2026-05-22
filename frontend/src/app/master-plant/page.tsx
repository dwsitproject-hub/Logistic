'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import Layout from '@/components/Layout'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import api from '@/lib/api'
import { Edit2, Trash2, Upload } from 'lucide-react'
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
  company_name: string
  plant_code: string
  plant_name: string | null
  postal_code: string | null
  city: string | null
  plant_type: string | null
  group_plant: string | null
}

export default function MasterPlantPage() {
  const [items, setItems] = useState<MasterPlant[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebouncedValue(search.trim(), 300)
  const [isAdmin, setIsAdmin] = useState(false)
  const [editing, setEditing] = useState<MasterPlant | null>(null)
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [form, setForm] = useState<Partial<MasterPlant>>({})
  const [uploadResult, setUploadResult] = useState<{
    total: number
    success: number
    inserted: number
    updated: number
    failed: number
    errors: Array<{ row: number; plant_code: string; reason: string }>
  } | null>(null)

  const fetchData = useCallback(async (searchQuery: string) => {
    try {
      setLoading(true)
      const params = new URLSearchParams()
      if (searchQuery.length >= 2) params.set('search', searchQuery)
      const res = await api.get('/master-plants', { params })
      setItems(res.data?.data?.items || [])
    } catch (err) {
      console.error('Failed to load master plants', err)
      alert('Failed to load master plants')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    try {
      const u = JSON.parse(localStorage.getItem('user') || 'null')
      setIsAdmin(String(u?.role || '').toUpperCase() === 'ADMIN')
    } catch {
      setIsAdmin(false)
    }
  }, [])

  useEffect(() => {
    void fetchData(debouncedSearch)
  }, [debouncedSearch, fetchData])

  const templateHint = useMemo(() => {
    return 'Template: Row 1 = header, columns A–G (Company Name, Plant Code, Plant Name, Postal Code, City, Plant Type, Group Plant)'
  }, [])

  const normalize = (v: any) => String(v ?? '').trim()

  const openEdit = (p: MasterPlant) => {
    setEditing(p)
    setForm({
      company_name: p.company_name,
      plant_code: p.plant_code,
      plant_name: p.plant_name ?? '',
      postal_code: p.postal_code ?? '',
      city: p.city ?? '',
      plant_type: p.plant_type ?? '',
      group_plant: p.group_plant ?? '',
    })
    setIsFormOpen(true)
  }

  const handleChange = (field: keyof MasterPlant, value: any) => {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  const handleSubmit = async () => {
    if (!editing) return
    try {
      if (!form.company_name || !String(form.company_name).trim()) {
        alert('Company Name is required')
        return
      }
      if (!form.plant_code || !String(form.plant_code).trim()) {
        alert('Plant Code is required')
        return
      }
      const payload = {
        company_name: String(form.company_name).trim(),
        plant_code: String(form.plant_code).trim(),
        plant_name: String(form.plant_name ?? '').trim() || null,
        postal_code: String(form.postal_code ?? '').trim() || null,
        city: String(form.city ?? '').trim() || null,
        plant_type: String(form.plant_type ?? '').trim() || null,
        group_plant: String(form.group_plant ?? '').trim() || null,
      }
      await api.put(`/master-plants/${editing.id}`, payload)
      setEditing(null)
      setForm({})
      setIsFormOpen(false)
      await fetchData(debouncedSearch)
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
      await fetchData(debouncedSearch)
    } catch (err: any) {
      console.error('Delete master plant error', err)
      const msg = err?.response?.data?.error?.message || 'Failed to delete master plant'
      alert(msg)
    }
  }

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

      const res = await api.post('/master-plants/upload', { rows: payloadRows })
      const data = res.data?.data
      if (data) {
        setUploadResult({
          total: data.total ?? payloadRows.length,
          success: (data.inserted ?? 0) + (data.updated ?? 0),
          inserted: data.inserted ?? 0,
          updated: data.updated ?? 0,
          failed: data.failed ?? 0,
          errors: data.errors ?? [],
        })
      } else {
        setUploadResult({
          total: payloadRows.length,
          success: payloadRows.length,
          inserted: payloadRows.length,
          updated: 0,
          failed: 0,
          errors: [],
        })
      }

      await fetchData(debouncedSearch)
    } catch (err: any) {
      console.error('Upload master plant file error', err)
      const msg = err?.response?.data?.error?.message || 'Failed to parse or upload file'
      alert(msg)
    } finally {
      e.target.value = ''
    }
  }

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Master Plant</h1>
            <p className="text-gray-500 text-sm mt-1">{templateHint}</p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => document.getElementById('master-plant-upload')?.click()}
            >
              <Upload className="h-4 w-4 mr-2" />
              Upload Excel
            </Button>
            <input
              id="master-plant-upload"
              type="file"
              accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
              className="hidden"
              onChange={handleUpload}
            />
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Filter</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex gap-3 items-center">
              <Input
                placeholder="Search by Company / Plant Code / Plant Name / City / Type / Group..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="max-w-xl"
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Master Plant List</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="py-8 text-center text-gray-500">Loading...</div>
            ) : items.length === 0 ? (
              <div className="py-8 text-center text-gray-500">No plants found</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b">
                      <th className="text-left px-3 py-2 font-medium">Company Name</th>
                      <th className="text-left px-3 py-2 font-medium">Plant Code</th>
                      <th className="text-left px-3 py-2 font-medium">Plant Name</th>
                      <th className="text-left px-3 py-2 font-medium">Postal Code</th>
                      <th className="text-left px-3 py-2 font-medium">City</th>
                      <th className="text-left px-3 py-2 font-medium">Plant Type</th>
                      <th className="text-left px-3 py-2 font-medium">Group Plant</th>
                      <th className="text-right px-3 py-2 font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((p, idx) => (
                      <tr key={p.id} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                        <td className="px-3 py-2">{p.company_name}</td>
                        <td className="px-3 py-2 font-medium">{p.plant_code}</td>
                        <td className="px-3 py-2">{p.plant_name || '-'}</td>
                        <td className="px-3 py-2">{p.postal_code || '-'}</td>
                        <td className="px-3 py-2">{p.city || '-'}</td>
                        <td className="px-3 py-2">{p.plant_type || '-'}</td>
                        <td className="px-3 py-2">{p.group_plant || '-'}</td>
                        <td className="px-3 py-2 text-right">
                          <div className="inline-flex gap-2">
                            <Button variant="outline" size="sm" onClick={() => openEdit(p)}>
                              <Edit2 className="h-4 w-4 mr-1" />
                              Edit
                            </Button>
                            {isAdmin && (
                              <Button variant="destructive" size="sm" onClick={() => handleDelete(p)}>
                                <Trash2 className="h-4 w-4 mr-1" />
                                Delete
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
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
            <DialogTitle>Edit Plant</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Company Name <span className="text-red-500">*</span></label>
              <Input value={form.company_name || ''} onChange={(e) => handleChange('company_name', e.target.value)} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Plant Code <span className="text-red-500">*</span></label>
              <Input value={form.plant_code || ''} onChange={(e) => handleChange('plant_code', e.target.value)} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Plant Name</label>
              <Input value={form.plant_name || ''} onChange={(e) => handleChange('plant_name', e.target.value)} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Postal Code</label>
              <Input value={form.postal_code || ''} onChange={(e) => handleChange('postal_code', e.target.value)} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">City</label>
              <Input value={form.city || ''} onChange={(e) => handleChange('city', e.target.value)} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Plant Type</label>
              <Input value={form.plant_type || ''} onChange={(e) => handleChange('plant_type', e.target.value)} />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Group Plant</label>
              <Input value={form.group_plant || ''} onChange={(e) => handleChange('group_plant', e.target.value)} />
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
    </Layout>
  )
}
