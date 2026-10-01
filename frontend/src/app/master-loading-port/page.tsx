'use client'

import { useCallback, useEffect, useState } from 'react'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import Layout from '@/components/Layout'
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
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useRouter } from 'next/navigation'
import api from '@/lib/api'
import { Plus } from 'lucide-react'
import { MasterDhmSyncButton } from '@/components/shared/MasterDhmSyncButton'
import { MasterRowActions } from '@/components/shared/MasterRowActions'
import { dhmStatusListColumn } from '@/lib/dhmStatusColumn'
import { saveWithDhmConfirm } from '@/lib/dhmMasterSave'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'

interface MasterLoadingPort {
  id: string
  code_klip?: string | null
  code_dhm?: string | null
  dhm_site_code?: string | null
  site_id?: string | null
  site?: string | null
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

function portCell(value: string | number | null | undefined): string {
  if (value == null || value === '') return '-'
  return String(value)
}

const PORT_COLUMNS: MasterListTableColumn<MasterLoadingPort>[] = [
  { id: 'code_klip', label: 'Port Code (KLIP)', getText: (row) => portCell(row.code_klip) },
  { id: 'code_dhm', label: 'Port Code (DHM)', getText: (row) => portCell(row.code_dhm) },
  { id: 'port', label: 'Port', getText: (row) => portCell(row.port) },
  dhmStatusListColumn<MasterLoadingPort>(),
]

export default function MasterLoadingPortPage() {
  const router = useRouter()
  const [items, setItems] = useState<MasterLoadingPort[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState('port')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const portColumns = useListColumnLayout('master-port.visibleColumns.v4', PORT_COLUMNS)
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
      params.set('masterOnly', 'true')
      params.set('limit', '500')
      if (searchQuery.length >= 2) {
        params.set('search', searchQuery)
      }
      const res = await api.get('/master-loading-ports', { params })
      setItems(res.data?.data?.items || [])
    } catch (err) {
      console.error('Failed to load master loading ports', err)
      alert('Failed to load master ports')
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
      port: '',
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
        port: form.port,
      }
      const persist = (overwrite: boolean) => {
        const qs = overwrite ? '?dhmOverwrite=true' : ''
        if (editing) return api.put(`/master-loading-ports/${editing.id}${qs}`, payload)
        return api.post(`/master-loading-ports${qs}`, payload)
      }
      await saveWithDhmConfirm(persist, 'port')
      setEditing(null)
      setForm({})
      setIsFormOpen(false)
      void fetchData(debouncedSearch)
    } catch (err: any) {
      console.error('Save master loading port error', err)
      const msg = err?.response?.data?.error?.message || 'Failed to save master port'
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
      alert('Failed to parse or upload file. Please upload CSV exported from Master Port.xlsx')
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
      const msg = err?.response?.data?.error?.message || 'Failed to delete master port'
      alert(msg)
    }
  }

  return (
    <Layout>
      <StitchFields>
      <div className="space-y-6">
        <p className="text-gray-600">
          Maintain reference data for ports used in shipments.
        </p>

        <ListFilterPanel
          onReset={() => setSearch('')}
          showReset={search.trim().length > 0}
          chips={
            debouncedSearch
              ? [{ id: 'search', label: `Search: ${debouncedSearch}`, onRemove: () => setSearch('') }]
              : []
          }
        >
          <div className={LIST_FILTER_FIELDS_ROW_CLASS}>
            <div className="min-w-[12rem] flex-[1.4]">
              <label className={LIST_FILTER_FIELD_LABEL_CLASS}>Search</label>
              <div className="relative">
                <StitchSearchIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  placeholder="Region or Port"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="rounded-lg border-slate-200 pl-10 text-slate-700 placeholder:text-slate-400 focus-visible:ring-blue-600"
                />
              </div>
            </div>
            {isAdmin ? (
              <div className="flex shrink-0 items-end gap-2">
                <Button size="sm" className="shrink-0" onClick={openNew}>
                  <Plus className="h-4 w-4 mr-2" />
                  New Port
                </Button>
                <MasterDhmSyncButton master="port" onDone={() => void fetchData(debouncedSearch)} />
              </div>
            ) : null}
          </div>
        </ListFilterPanel>

        {isFormOpen && (
          <Card>
            <CardHeader>
              <CardTitle>{editing ? 'Edit Port' : 'New Port'}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Port Code (KLIP)</label>
                  <Input value={editing?.code_klip || ''} placeholder="Assigned on save" readOnly disabled />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Port Code (DHM)</label>
                  <Input value={editing?.code_dhm || ''} placeholder="-" readOnly disabled />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Port <span className="text-red-500">*</span></label>
                  <Input
                    value={form.port || ''}
                    onChange={(e) => handleChange('port', e.target.value)}
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
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle className="text-base flex items-center gap-2 flex-wrap">
                  <span>All Ports</span>
                </CardTitle>
                <p className="text-xs text-gray-500 mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0">
                  <span className="whitespace-nowrap tabular-nums text-gray-700">
                    <span className="font-semibold">{items.length.toLocaleString('en-US')}</span> ports
                  </span>
                  <span className="text-gray-400" aria-hidden>·</span>
                  <span className="whitespace-nowrap font-medium text-gray-600">
                    {debouncedSearch ? 'Filtered' : 'All'}
                  </span>
                </p>
              </div>
              <ListPageColumnsMenu
                columns={portColumns.menuColumns}
                visibleIds={portColumns.visibleIds}
                disabled={loading}
                onToggle={portColumns.toggle}
                onSelectAll={portColumns.selectAll}
                onUnselectAll={portColumns.unselectAll}
                onReset={portColumns.reset}
                onReorder={portColumns.reorder}
              />
            </div>
          </CardHeader>
          <CardContent>
            <MasterListCompactTable
              tightActions
              rows={[...items].sort((a, b) => {
                const col = PORT_COLUMNS.find((item) => item.id === sortKey)
                const cmp = (col?.getText(a) ?? '').localeCompare(col?.getText(b) ?? '', undefined, { numeric: true })
                return sortDir === 'asc' ? cmp : -cmp
              })}
              columns={PORT_COLUMNS.filter((col) => portColumns.orderedVisibleIds.includes(col.id)).sort(
                (a, b) => portColumns.orderedVisibleIds.indexOf(a.id) - portColumns.orderedVisibleIds.indexOf(b.id),
              )}
              getRowId={(row) => row.id}
              sortKey={sortKey}
              sortDir={sortDir}
              dragColId={portColumns.dragColId}
              loading={loading}
              emptyLabel="No ports found"
              onSort={(id) => {
                setSortDir((dir) => (sortKey === id ? (dir === 'asc' ? 'desc' : 'asc') : 'asc'))
                setSortKey(id)
              }}
              onDragStart={portColumns.setDragColId}
              onDragEnd={() => portColumns.setDragColId(null)}
              onDrop={(id) => {
                if (portColumns.dragColId) portColumns.reorder(portColumns.dragColId, id)
                portColumns.setDragColId(null)
              }}
              renderActions={(p) => (
                <MasterRowActions
                  isAdmin={isAdmin}
                  editLabel={isAdmin ? 'Edit port' : 'View port'}
                  deleteLabel="Delete port"
                  onEdit={() => openEdit(p)}
                  onDelete={() => void handleDelete(p)}
                />
              )}
            />
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
      </StitchFields>
    </Layout>
  )
}

