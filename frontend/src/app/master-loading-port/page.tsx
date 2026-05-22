'use client'

import { useCallback, useEffect, useState } from 'react'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import Layout from '@/components/Layout'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useRouter } from 'next/navigation'
import api from '@/lib/api'
import { Plus, Upload, Edit2, Trash2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'

interface MasterLoadingPort {
  id: string
  region: string | null
  port: string
  coordinate: string | null
  masuk_alur: string | null
  lebar_alur: string | null
  jumlah_jembatan: number | null
  jenis_port: string | null
  pemilik_port: string | null
  antri_muat_hari: number | null
  jumlah_demaraga: number | null
  panjang_demaraga: string | null
  draft: string | null
  dwt: string | null
  siklus_pasang: string | null
  loading_method: string | null
  loading_rate_mt_per_hour: number | null
  shipper: string | null
}

export default function MasterLoadingPortPage() {
  const router = useRouter()
  const [items, setItems] = useState<MasterLoadingPort[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebouncedValue(search.trim(), 300)
  const [editing, setEditing] = useState<MasterLoadingPort | null>(null)
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [form, setForm] = useState<Partial<MasterLoadingPort>>({})
  const [isAdmin, setIsAdmin] = useState(false)
  const [uploadResult, setUploadResult] = useState<{
    total: number
    success: number
    inserted: number
    updated: number
    failed: number
    errors: Array<{ row: number; port: string; reason: string }>
  } | null>(null)

  const fetchData = useCallback(async (searchQuery: string) => {
    try {
      setLoading(true)
      const params = new URLSearchParams()
      if (searchQuery.length >= 2) {
        params.set('search', searchQuery)
      }
      const res = await api.get('/master-loading-ports', { params })
      setItems(res.data?.data?.items || [])
    } catch (err) {
      console.error('Failed to load master loading ports', err)
      alert('Failed to load master loading ports')
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

  const openNew = () => {
    setEditing(null)
    setIsFormOpen(true)
    setForm({
      region: '',
      port: '',
      coordinate: '',
      masuk_alur: '',
      lebar_alur: '',
      jumlah_jembatan: null,
      jenis_port: '',
      pemilik_port: '',
      antri_muat_hari: null,
      jumlah_demaraga: null,
      panjang_demaraga: '',
      draft: '',
      dwt: '',
      siklus_pasang: '',
      loading_method: '',
      loading_rate_mt_per_hour: null,
      shipper: '',
    })
  }

  const openEdit = (p: MasterLoadingPort) => {
    setEditing(p)
    setIsFormOpen(true)
    setForm(p)
  }

  const handleChange = (field: keyof MasterLoadingPort, value: any) => {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  const handleSubmit = async () => {
    try {
      if (!form.port) {
        alert('Port is required')
        return
      }
      const payload = {
        region: form.region,
        port: form.port,
        coordinate: form.coordinate,
        masuk_alur: form.masuk_alur,
        lebar_alur: form.lebar_alur,
        jumlah_jembatan: form.jumlah_jembatan,
        jenis_port: form.jenis_port,
        pemilik_port: form.pemilik_port,
        antri_muat_hari: form.antri_muat_hari,
        jumlah_demaraga: form.jumlah_demaraga,
        panjang_demaraga: form.panjang_demaraga,
        draft: form.draft,
        dwt: form.dwt,
        siklus_pasang: form.siklus_pasang,
        loading_method: form.loading_method,
        loading_rate_mt_per_hour: form.loading_rate_mt_per_hour,
        shipper: form.shipper,
      }
      if (editing) {
        await api.put(`/master-loading-ports/${editing.id}`, payload)
      } else {
        await api.post('/master-loading-ports', payload)
      }
      setEditing(null)
      setForm({})
      setIsFormOpen(false)
      void fetchData(debouncedSearch)
    } catch (err: any) {
      console.error('Save master loading port error', err)
      const msg = err?.response?.data?.error?.message || 'Failed to save master loading port'
      alert(msg)
    }
  }

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const text = await file.text()

      // CSV parser that respects quotes and embedded newlines (one logical row can span multiple lines)
      const parseCsv = (input: string): string[][] => {
        const rows: string[][] = []
        let row: string[] = []
        let current = ''
        let inQuotes = false
        for (let i = 0; i < input.length; i++) {
          const ch = input[i]
          if (ch === '"') {
            if (inQuotes && input[i + 1] === '"') {
              current += '"'
              i++
            } else {
              inQuotes = !inQuotes
            }
          } else if (!inQuotes && (ch === '\n' || ch === '\r')) {
            if (ch === '\r' && input[i + 1] === '\n') i++
            row.push(current.trim())
            current = ''
            rows.push(row)
            row = []
          } else if (ch === ',' && !inQuotes) {
            row.push(current.trim())
            current = ''
          } else {
            current += ch
          }
        }
        if (current.length > 0 || row.length > 0) {
          row.push(current.trim())
          rows.push(row)
        }
        return rows
      }

      const rows = parseCsv(text)
      if (rows.length <= 1) {
        alert('File has no data rows')
        return
      }
      const [header, ...dataRows] = rows
      const headerMap: Record<string, number> = {}
      header.forEach((h, idx) => {
        headerMap[h.toLowerCase()] = idx
      })

      const getIdx = (key: string) => headerMap[key]

      // Column index fallbacks (A=0, B=1, C=2, D=3, E=4, F=5, ... J=9, K=10, ... P=15) for CSV from Master Loading Port.xlsx
      const COL = { C: 2, F: 5, J: 9, K: 10, P: 15 } as const

      const parsedRows = dataRows.map(cols => {
        const get = (key: string) => {
          const idx = getIdx(key)
          return typeof idx === 'number' ? cols[idx]?.trim() ?? '' : ''
        }
        const col = (idx: number) => cols[idx]?.trim() ?? ''

        const numOrNull = (v: string) => {
          const cleaned = (v || '').replace(/,/g, '')
          return cleaned ? Number(cleaned) : null
        }

        return {
          region: get('region') || null,
          port: (col(1) || get('port'))?.trim() || '',
          coordinate: (col(COL.C) || get('coordinate'))?.trim() || null,
          masuk_alur: get('masuk alur') || null,
          lebar_alur: get('lebar alur') || null,
          jumlah_jembatan: numOrNull(col(COL.F) || get('jumlah jembatan')),
          jenis_port: get('jenis port') || null,
          pemilik_port: get('pemilik port') || null,
          antri_muat_hari: numOrNull(get('antri muat (hari)')),
          jumlah_demaraga: numOrNull(col(COL.J) || get('jumlah demaraga')),
          panjang_demaraga: (col(COL.K) || get('panjang demaraga'))?.trim() || null,
          draft: get('draft') || null,
          dwt: get('dwt') || null,
          siklus_pasang: get('siklus pasang') || null,
          loading_method: get('loading method') || null,
          loading_rate_mt_per_hour: numOrNull(col(COL.P) || get('loading rate (mt/hour)') || get('loading rate (kg/hour)')),
          shipper: get('shipper') || null,
        }
      })

      // Only send rows that have a port (skip empty / continuation rows)
      const payloadRows = parsedRows.filter(r => (r.port ?? '').trim() !== '')

      const res = await api.post('/master-loading-ports/upload', { rows: payloadRows })
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
      void fetchData(debouncedSearch)
    } catch (err) {
      console.error('Upload master loading port file error', err)
      alert('Failed to parse or upload file. Please upload CSV exported from Master Loading Port.xlsx')
    } finally {
      e.target.value = ''
    }
  }

  const handleDelete = async (p: MasterLoadingPort) => {
    if (!isAdmin) return
    const ok = confirm(`Delete loading port?\n\n${p.port}`)
    if (!ok) return
    try {
      await api.delete(`/master-loading-ports/${p.id}`)
      await fetchData(debouncedSearch)
    } catch (err: any) {
      console.error('Delete master loading port error', err)
      const msg = err?.response?.data?.error?.message || 'Failed to delete master loading port'
      alert(msg)
    }
  }

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Master Loading Port</h1>
            <p className="text-gray-600 mt-2">
              Maintain reference data for loading ports used in shipments.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => document.getElementById('master-loading-port-upload')?.click()}>
              <Upload className="h-4 w-4 mr-2" />
              Upload CSV
            </Button>
            <input
              id="master-loading-port-upload"
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={handleUpload}
            />
            <Button size="sm" onClick={openNew}>
              <Plus className="h-4 w-4 mr-2" />
              New Port
            </Button>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Filter</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex gap-3 items-center">
              <Input
                placeholder="Search by Region or Port..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="max-w-sm"
              />
            </div>
          </CardContent>
        </Card>

        {isFormOpen && (
          <Card>
            <CardHeader>
              <CardTitle>{editing ? 'Edit Loading Port' : 'New Loading Port'}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Region</label>
                  <Input
                    value={form.region || ''}
                    onChange={(e) => handleChange('region', e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Port</label>
                  <Input
                    value={form.port || ''}
                    onChange={(e) => handleChange('port', e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Coordinate</label>
                  <Input
                    value={form.coordinate || ''}
                    onChange={(e) => handleChange('coordinate', e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Masuk Alur</label>
                  <select
                    className="border rounded-md px-3 py-2 w-full text-sm"
                    value={form.masuk_alur || ''}
                    onChange={(e) => handleChange('masuk_alur', e.target.value || null)}
                  >
                    <option value="">Select...</option>
                    <option value="Ya">Ya</option>
                    <option value="Tidak">Tidak</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Lebar Alur</label>
                  <Input
                    value={form.lebar_alur || ''}
                    onChange={(e) => handleChange('lebar_alur', e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Jumlah Jembatan</label>
                  <Input
                    type="number"
                    value={form.jumlah_jembatan ?? ''}
                    onChange={(e) =>
                      handleChange('jumlah_jembatan', e.target.value === '' ? null : Number(e.target.value))
                    }
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Jenis Port</label>
                  <select
                    className="border rounded-md px-3 py-2 w-full text-sm"
                    value={form.jenis_port || ''}
                    onChange={(e) => handleChange('jenis_port', e.target.value || null)}
                  >
                    <option value="">Select...</option>
                    <option value="Umum">Umum</option>
                    <option value="TUKS">TUKS</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Pemilik Port</label>
                  <Input
                    value={form.pemilik_port || ''}
                    onChange={(e) => handleChange('pemilik_port', e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Antri Muat (hari)</label>
                  <Input
                    type="number"
                    value={form.antri_muat_hari ?? ''}
                    onChange={(e) =>
                      handleChange('antri_muat_hari', e.target.value === '' ? null : Number(e.target.value))
                    }
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Jumlah Demaraga</label>
                  <Input
                    type="number"
                    value={form.jumlah_demaraga ?? ''}
                    onChange={(e) =>
                      handleChange('jumlah_demaraga', e.target.value === '' ? null : Number(e.target.value))
                    }
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Panjang Demaraga</label>
                  <Input
                    value={form.panjang_demaraga || ''}
                    onChange={(e) => handleChange('panjang_demaraga', e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Draft</label>
                  <Input
                    value={form.draft || ''}
                    onChange={(e) => handleChange('draft', e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">DWT</label>
                  <Input
                    value={form.dwt || ''}
                    onChange={(e) => handleChange('dwt', e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Siklus Pasang</label>
                  <Input
                    value={form.siklus_pasang || ''}
                    onChange={(e) => handleChange('siklus_pasang', e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Loading Method</label>
                  <Input
                    value={form.loading_method || ''}
                    onChange={(e) => handleChange('loading_method', e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Loading Rate (Kg/hour)</label>
                  <Input
                    type="number"
                    value={form.loading_rate_mt_per_hour ?? ''}
                    onChange={(e) =>
                      handleChange(
                        'loading_rate_mt_per_hour',
                        e.target.value === '' ? null : Number(e.target.value),
                      )
                    }
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Shipper</label>
                  <Input
                    value={form.shipper || ''}
                    onChange={(e) => handleChange('shipper', e.target.value)}
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  variant="ghost"
                  onClick={() => {
                    setEditing(null)
                    setForm({})
                    setIsFormOpen(false)
                  }}
                >
                  Cancel
                </Button>
                <Button onClick={handleSubmit}>Save</Button>
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Master Loading Port List</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="py-8 text-center text-gray-500">Loading...</div>
            ) : items.length === 0 ? (
              <div className="py-8 text-center text-gray-500">No loading ports found</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b">
                      <th className="text-left px-3 py-2 font-medium">Region</th>
                      <th className="text-left px-3 py-2 font-medium">Port</th>
                      <th className="text-left px-3 py-2 font-medium">Coordinate</th>
                      <th className="text-left px-3 py-2 font-medium">Masuk Alur</th>
                      <th className="text-left px-3 py-2 font-medium">Lebar Alur</th>
                      <th className="text-left px-3 py-2 font-medium">Jumlah Jembatan</th>
                      <th className="text-left px-3 py-2 font-medium">Jenis Port</th>
                      <th className="text-left px-3 py-2 font-medium">Pemilik Port</th>
                      <th className="text-left px-3 py-2 font-medium">Antri Muat (hari)</th>
                      <th className="text-left px-3 py-2 font-medium">Jumlah Demaraga</th>
                      <th className="text-left px-3 py-2 font-medium">Panjang Demaraga</th>
                      <th className="text-left px-3 py-2 font-medium">Draft</th>
                      <th className="text-left px-3 py-2 font-medium">DWT</th>
                      <th className="text-left px-3 py-2 font-medium">Siklus Pasang</th>
                      <th className="text-left px-3 py-2 font-medium">Loading Method</th>
                      <th className="text-left px-3 py-2 font-medium">Loading Rate (Kg/hour)</th>
                      <th className="text-left px-3 py-2 font-medium">Shipper</th>
                      <th className="text-right px-3 py-2 font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((p, idx) => (
                      <tr key={p.id} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                        <td className="px-3 py-2">{p.region || '-'}</td>
                        <td className="px-3 py-2 font-medium">{p.port}</td>
                        <td className="px-3 py-2">{p.coordinate || '-'}</td>
                        <td className="px-3 py-2">{p.masuk_alur || '-'}</td>
                        <td className="px-3 py-2">{p.lebar_alur || '-'}</td>
                        <td className="px-3 py-2">{p.jumlah_jembatan ?? '-'}</td>
                        <td className="px-3 py-2">{p.jenis_port || '-'}</td>
                        <td className="px-3 py-2">{p.pemilik_port || '-'}</td>
                        <td className="px-3 py-2">{p.antri_muat_hari ?? '-'}</td>
                        <td className="px-3 py-2">{p.jumlah_demaraga ?? '-'}</td>
                        <td className="px-3 py-2">{p.panjang_demaraga || '-'}</td>
                        <td className="px-3 py-2">{p.draft || '-'}</td>
                        <td className="px-3 py-2">{p.dwt || '-'}</td>
                        <td className="px-3 py-2">{p.siklus_pasang || '-'}</td>
                        <td className="px-3 py-2">{p.loading_method || '-'}</td>
                        <td className="px-3 py-2">{p.loading_rate_mt_per_hour ?? '-'}</td>
                        <td className="px-3 py-2">{p.shipper || '-'}</td>
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
            <DialogTitle>Upload result</DialogTitle>
          </DialogHeader>
          {uploadResult && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div><span className="text-gray-600">Records found:</span> <strong>{uploadResult.total}</strong></div>
                <div><span className="text-gray-600">Success:</span> <strong className="text-green-600">{uploadResult.success}</strong></div>
                <div><span className="text-gray-600">Inserted:</span> {uploadResult.inserted}</div>
                <div><span className="text-gray-600">Updated:</span> {uploadResult.updated}</div>
                <div><span className="text-gray-600">Failed:</span> <strong className={uploadResult.failed ? 'text-red-600' : ''}>{uploadResult.failed}</strong></div>
              </div>
              {uploadResult.errors.length > 0 && (
                <div>
                  <p className="text-sm font-medium text-gray-700 mb-2">Failed records:</p>
                  <div className="border rounded overflow-x-auto max-h-60 overflow-y-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-gray-100">
                          <th className="text-left px-2 py-1.5">Row</th>
                          <th className="text-left px-2 py-1.5">Port</th>
                          <th className="text-left px-2 py-1.5">Reason</th>
                        </tr>
                      </thead>
                      <tbody>
                        {uploadResult.errors.map((e, i) => (
                          <tr key={i} className="border-t">
                            <td className="px-2 py-1.5">{e.row}</td>
                            <td className="px-2 py-1.5">{e.port}</td>
                            <td className="px-2 py-1.5 text-red-600">{e.reason}</td>
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
    </Layout>
  )
}

