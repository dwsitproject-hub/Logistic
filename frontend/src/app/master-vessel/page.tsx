'use client'

import { useEffect, useState } from 'react'
import Layout from '@/components/Layout'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { useRouter } from 'next/navigation'
import api from '@/lib/api'
import { Plus, Upload, Edit2 } from 'lucide-react'

interface MasterVessel {
  id: string
  vessel_code: string
  vessel_name: string
  vessel_capacity_mt: number | null
  vessel_owner: string | null
  vessel_owner_group: string | null
  hull_type: string | null
  year_of_creation: number | null
  heating: boolean | null
  lambung_type: string | null
}

export default function MasterVesselPage() {
  const router = useRouter()
  const [items, setItems] = useState<MasterVessel[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<MasterVessel | null>(null)
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [form, setForm] = useState<Partial<MasterVessel>>({})

  const fetchData = async () => {
    try {
      setLoading(true)
      const params = new URLSearchParams()
      if (search.trim().length >= 2) {
        params.set('search', search.trim())
      }
      const res = await api.get('/master-vessels', { params })
      setItems(res.data?.data?.items || [])
    } catch (err) {
      console.error('Failed to load master vessels', err)
      alert('Failed to load master vessels')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const openNew = () => {
    setEditing(null)
    setIsFormOpen(true)
    setForm({
      vessel_code: '',
      vessel_name: '',
      vessel_capacity_mt: null,
      vessel_owner: '',
      vessel_owner_group: '',
      hull_type: '',
      year_of_creation: null,
      heating: null,
      lambung_type: '',
    })
  }

  const openEdit = (v: MasterVessel) => {
    setEditing(v)
    setIsFormOpen(true)
    setForm(v)
  }

  const handleChange = (field: keyof MasterVessel, value: any) => {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  const handleSubmit = async () => {
    try {
      if (!form.vessel_code || !form.vessel_name) {
        alert('Vessel Code and Vessel Name are required')
        return
      }
      const payload = {
        vessel_code: form.vessel_code,
        vessel_name: form.vessel_name,
        vessel_capacity_mt: form.vessel_capacity_mt,
        vessel_owner: form.vessel_owner,
        vessel_owner_group: form.vessel_owner_group,
        hull_type: form.hull_type,
        year_of_creation: form.year_of_creation,
        heating: form.heating,
        lambung_type: form.lambung_type,
      }
      if (editing) {
        await api.put(`/master-vessels/${editing.id}`, payload)
      } else {
        await api.post('/master-vessels', payload)
      }
      setEditing(null)
      setForm({})
      setIsFormOpen(false)
      fetchData()
    } catch (err: any) {
      console.error('Save master vessel error', err)
      const msg = err?.response?.data?.error?.message || 'Failed to save master vessel'
      alert(msg)
    }
  }

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const text = await file.text()

      // Robust CSV parsing that respects quoted fields with commas
      const parseCsv = (input: string): string[][] => {
        const lines = input.split(/\r?\n/).filter(l => l.trim().length > 0)
        const rows: string[][] = []
        for (const line of lines) {
          const row: string[] = []
          let current = ''
          let inQuotes = false
          for (let i = 0; i < line.length; i++) {
            const ch = line[i]
            if (ch === '"') {
              if (inQuotes && line[i + 1] === '"') {
                // Escaped quote
                current += '"'
                i++
              } else {
                inQuotes = !inQuotes
              }
            } else if (ch === ',' && !inQuotes) {
              row.push(current.trim())
              current = ''
            } else {
              current += ch
            }
          }
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

      const payloadRows = dataRows.map(cols => {
        const get = (key: string) => {
          const idx = headerMap[key]
          return typeof idx === 'number' ? cols[idx] || '' : ''
        }

        const capacityRaw = get('vessel capacity (mt)').replace(/,/g, '')
        const yearRaw = get('year of creation')

        return {
          vessel_code: get('vessel code'),
          vessel_name: get('vessel name'),
          vessel_capacity_mt: capacityRaw ? Number(capacityRaw) : null,
          vessel_owner: get('vessel owner') || null,
          vessel_owner_group: get('vessel owner group') || null,
          hull_type: get('hull type') || null,
          year_of_creation: yearRaw ? Number(yearRaw) : null,
          heating: (get('heating') || '').toLowerCase() === 'yes',
          lambung_type: get('lambung type') || null,
        }
      })

      await api.post('/master-vessels/upload', { rows: payloadRows })
      alert('Master vessel data uploaded')
      fetchData()
    } catch (err) {
      console.error('Upload master vessel file error', err)
      alert('Failed to parse or upload file. Please upload CSV exported from Master Vessel.xlsx')
    } finally {
      e.target.value = ''
    }
  }

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Master Vessel</h1>
            <p className="text-gray-600 mt-2">
              Maintain reference data for vessels used in shipments.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => document.getElementById('master-vessel-upload')?.click()}>
              <Upload className="h-4 w-4 mr-2" />
              Upload CSV
            </Button>
            <input
              id="master-vessel-upload"
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={handleUpload}
            />
            <Button size="sm" onClick={openNew}>
              <Plus className="h-4 w-4 mr-2" />
              New Vessel
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
                placeholder="Search by Vessel Code or Name..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="max-w-sm"
              />
              <Button variant="outline" size="sm" onClick={fetchData} disabled={loading}>
                Apply
              </Button>
            </div>
          </CardContent>
        </Card>

        {isFormOpen && (
          <Card>
            <CardHeader>
              <CardTitle>{editing ? 'Edit Vessel' : 'New Vessel'}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Vessel Code</label>
                  <Input
                    value={form.vessel_code || ''}
                    onChange={(e) => handleChange('vessel_code', e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Vessel Name</label>
                  <Input
                    value={form.vessel_name || ''}
                    onChange={(e) => handleChange('vessel_name', e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Vessel Capacity (MT)</label>
                  <Input
                    type="number"
                    value={form.vessel_capacity_mt ?? ''}
                    onChange={(e) => handleChange('vessel_capacity_mt', e.target.value === '' ? null : Number(e.target.value))}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Vessel Owner</label>
                  <Input
                    value={form.vessel_owner || ''}
                    onChange={(e) => handleChange('vessel_owner', e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Vessel Owner Group</label>
                  <Input
                    value={form.vessel_owner_group || ''}
                    onChange={(e) => handleChange('vessel_owner_group', e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Hull Type</label>
                  <select
                    className="border rounded-md px-3 py-2 w-full text-sm"
                    value={form.hull_type || ''}
                    onChange={(e) => handleChange('hull_type', e.target.value || null)}
                  >
                    <option value="">Select...</option>
                    <option value="Barge">Barge</option>
                    <option value="Tanker">Tanker</option>
                    <option value="SPOB">SPOB</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Year of Creation (optional)</label>
                  <Input
                    type="number"
                    value={form.year_of_creation ?? ''}
                    onChange={(e) => handleChange('year_of_creation', e.target.value === '' ? null : Number(e.target.value))}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Heating</label>
                  <div className="flex items-center gap-4">
                    <label className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={form.heating === true}
                        onCheckedChange={() => handleChange('heating', true)}
                      />
                      Yes
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={form.heating === false}
                        onCheckedChange={() => handleChange('heating', false)}
                      />
                      No
                    </label>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Lambgung Type</label>
                  <select
                    className="border rounded-md px-3 py-2 w-full text-sm"
                    value={form.lambung_type || ''}
                    onChange={(e) => handleChange('lambung_type', e.target.value || null)}
                  >
                    <option value="">Select...</option>
                    <option value="DHDB">DHDB</option>
                    <option value="SHSB">SHSB</option>
                    <option value="SHDB">SHDB</option>
                  </select>
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => { setEditing(null); setForm({}); setIsFormOpen(false) }}>
                  Cancel
                </Button>
                <Button onClick={handleSubmit}>
                  Save
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Master Vessel List</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="py-8 text-center text-gray-500">Loading...</div>
            ) : items.length === 0 ? (
              <div className="py-8 text-center text-gray-500">No vessels found</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b">
                      <th className="text-left px-3 py-2 font-medium">Vessel Code</th>
                      <th className="text-left px-3 py-2 font-medium">Vessel Name</th>
                      <th className="text-left px-3 py-2 font-medium">Capacity (MT)</th>
                      <th className="text-left px-3 py-2 font-medium">Owner</th>
                      <th className="text-left px-3 py-2 font-medium">Owner Group</th>
                      <th className="text-left px-3 py-2 font-medium">Hull Type</th>
                      <th className="text-left px-3 py-2 font-medium">Year</th>
                      <th className="text-left px-3 py-2 font-medium">Heating</th>
                      <th className="text-left px-3 py-2 font-medium">Lambgung Type</th>
                      <th className="text-right px-3 py-2 font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((v, idx) => (
                      <tr key={v.id} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                        <td className="px-3 py-2 font-medium">{v.vessel_code}</td>
                        <td className="px-3 py-2">{v.vessel_name}</td>
                        <td className="px-3 py-2">{v.vessel_capacity_mt ?? '-'}</td>
                        <td className="px-3 py-2">{v.vessel_owner || '-'}</td>
                        <td className="px-3 py-2">{v.vessel_owner_group || '-'}</td>
                        <td className="px-3 py-2">{v.hull_type || '-'}</td>
                        <td className="px-3 py-2">{v.year_of_creation || '-'}</td>
                        <td className="px-3 py-2">{v.heating == null ? '-' : (v.heating ? 'Yes' : 'No')}</td>
                        <td className="px-3 py-2">{v.lambung_type || '-'}</td>
                        <td className="px-3 py-2 text-right">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => openEdit(v)}
                          >
                            <Edit2 className="h-4 w-4 mr-1" />
                            Edit
                          </Button>
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
    </Layout>
  )
}

