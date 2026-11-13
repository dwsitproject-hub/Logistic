'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import Layout from '@/components/Layout'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { StitchFields } from '@/components/shared/stitchField'
import { Button } from '@/components/ui/button'
import { ICON_BUTTON_CLASS } from '@/lib/iconButton'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useRouter } from 'next/navigation'
import api from '@/lib/api'
import { Anchor, Building2, Cloud, CloudOff, Pencil, Plus, Save, Ship } from 'lucide-react'
import { MasterCodeBadge } from '@/components/shared/MasterCodeBadge'
import { MasterDhmSyncButton } from '@/components/shared/MasterDhmSyncButton'
import { MultiValueCell } from '@/components/shared/MultiValueCell'
import { MasterKpis } from '@/components/master/MasterKpis'
import { MasterFilterBar } from '@/components/master/MasterFilterBar'
import { MasterTableFooter } from '@/components/master/MasterTableFooter'
import { MasterDhmChip, MasterIdentityCell, MasterListTable, type MasterTableColumn } from '@/components/master/MasterListTable'
import { saveWithDhmConfirm } from '@/lib/dhmMasterSave'
import { masterCountText, masterDhmChip, sortCompanyOptions, type MasterDhmFilter } from '@/lib/masterDirectory'
import { multiValuesOf, multiValueText } from '@/lib/multiValueCell'
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
  /** The SAP Vessel Port texts that stand for this port (one text, one port). */
  vessel_port_sap?: string[]
}

/** Only a real Master Port (a uuid) carries VESSEL PORT (SAP) names; the list also holds port texts seen on shipments, which are not ports. */
const IS_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SAP_NAMES_PLACEHOLDER = 'One SAP Vessel Port text per line, e.g.\nEUP EDIBLE OIL BONTANG\nPABRIK WKSM'

function portCell(value: string | number | null | undefined): string {
  if (value == null || value === '') return '-'
  return String(value)
}

interface PortSummary {
  total: number
  synced: number
  notSynced: number
  failed: number
  usedInKlip: number
  /** The Sites that have ports, with how many. */
  sites: Array<{ id: string; name: string; ports: number }>
}

const PAGE_SIZE = 20
const ALL_SITES = '__all__'

export default function MasterLoadingPortPage() {
  const router = useRouter()
  const [items, setItems] = useState<MasterLoadingPort[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [dhm, setDhm] = useState<MasterDhmFilter>('all')
  const [site, setSite] = useState('')
  const [page, setPage] = useState(1)
  const [summary, setSummary] = useState<PortSummary | null>(null)
  const [sortKey, setSortKey] = useState('port')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
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

  // The Master Port list is small (a few hundred ports at most), so it is loaded whole - already filtered by the server (search, DHM status, Site) - and paged
  // and sorted here, which keeps the sort across every port and not only across one page.
  const fetchData = useCallback(async (searchQuery: string, dhmFilter: MasterDhmFilter, siteId: string) => {
    try {
      setLoading(true)
      const params = new URLSearchParams()
      params.set('masterOnly', 'true')
      params.set('limit', '500')
      if (searchQuery.length >= 2) {
        params.set('search', searchQuery)
      }
      if (dhmFilter !== 'all') params.set('dhm', dhmFilter)
      if (siteId) params.set('site', siteId)
      const res = await api.get('/master-loading-ports', { params })
      setItems(res.data?.data?.items || [])
    } catch (err) {
      console.error('Failed to load master loading ports', err)
      alert('Failed to load master ports')
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchSummary = useCallback(async () => {
    try {
      const res = await api.get('/master-loading-ports/summary')
      setSummary(res.data?.data ?? null)
    } catch (err) {
      // the cards are informational: the list still works without them
      console.error('Failed to load the port summary', err)
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
    void fetchData(debouncedSearch, dhm, site)
  }, [debouncedSearch, dhm, site, fetchData])

  useEffect(() => {
    void fetchSummary()
  }, [fetchSummary])

  const refresh = () => {
    void fetchData(debouncedSearch, dhm, site)
    void fetchSummary()
  }

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
    setForm({ ...p, vessel_port_sap: p.vessel_port_sap ?? [] })
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
      // Only a real Master Port (a uuid) carries VESSEL PORT (SAP) names; one text per line, saved as the whole list.
      const payload: { port: string; vessel_port_sap?: string[] } = {
        port: form.port,
      }
      if (isAdmin && (!editing || IS_UUID.test(editing.id))) {
        payload.vessel_port_sap = (form.vessel_port_sap ?? []).map((v) => v.trim()).filter(Boolean)
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
      refresh()
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
          // optional column; several texts in one cell separated by ; or |
          vessel_port_sap: get('vessel port (sap)') || undefined,
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
      refresh()
    } catch (err) {
      console.error('Upload master loading port file error', err)
      alert('Failed to parse or upload file. Please upload CSV exported from Master Port.xlsx')
    } finally {
      e.target.value = ''
    }
  }

  const siteOptions = useMemo(() => sortCompanyOptions(summary?.sites ?? []), [summary])
  const filtersOn = search.trim() !== '' || site !== '' || dhm !== 'all'

  const sortedRows = useMemo(() => {
    const text = (row: MasterLoadingPort): string => {
      if (sortKey === 'dhm') return masterDhmChip(row).label
      if (sortKey === 'vessel_port_sap') return multiValueText(multiValuesOf(row.vessel_port_sap))
      return row.port || ''
    }
    return [...items].sort((a, b) => {
      const cmp = text(a).localeCompare(text(b), undefined, { numeric: true })
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [items, sortKey, sortDir])

  const total = sortedRows.length
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const pageRows = useMemo(() => sortedRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), [sortedRows, page])

  // a filter that leaves fewer pages than the one on screen must not leave the table empty
  useEffect(() => {
    if (page > totalPages) setPage(totalPages)
  }, [page, totalPages])

  const columns: MasterTableColumn<MasterLoadingPort>[] = [
    {
      id: 'port',
      label: 'Port',
      sortable: true,
      render: (row) => <MasterIdentityCell name={row.port} subtitle={[row.region, row.site].filter(Boolean).join(' · ') || 'No region or site yet'} />,
    },
    {
      id: 'codes',
      label: 'Codes',
      className: 'whitespace-nowrap',
      render: (row) => (
        <div className="flex flex-wrap items-center gap-1.5">
          <MasterCodeBadge kind="klip" value={row.code_klip || ''} fit />
          <MasterCodeBadge kind="dhm" value={row.code_dhm || ''} fit />
        </div>
      ),
    },
    {
      id: 'vessel_port_sap',
      label: 'Vessel Port (SAP)',
      sortable: true,
      render: (row) => <MultiValueCell values={multiValuesOf(row.vessel_port_sap)} rowTitle={row.port} columnLabel="Vessel Port (SAP)" plural="SAP names" />,
    },
    { id: 'dhm', label: 'DHM', sortable: true, className: 'whitespace-nowrap', render: (row) => <MasterDhmChip row={row} /> },
  ]

  const kpis = [
    { id: 'total', icon: <Anchor className="h-4 w-4" />, label: 'Total ports', value: summary?.total ?? null, tone: 'bg-blue-50 text-blue-600', hint: 'all master ports' },
    { id: 'synced', icon: <Cloud className="h-4 w-4" />, label: 'Synced to DHM', value: summary?.synced ?? null, tone: 'bg-emerald-50 text-emerald-600', hint: 'DHM has them' },
    {
      id: 'not-synced',
      icon: <CloudOff className="h-4 w-4" />,
      label: 'Not synced',
      value: summary?.notSynced ?? null,
      tone: 'bg-amber-50 text-amber-600',
      hint: summary && summary.failed > 0 ? `${summary.failed.toLocaleString('en-US')} more failed to deliver` : 'not in DHM yet',
    },
    { id: 'used', icon: <Ship className="h-4 w-4" />, label: 'Used in KLIP', value: summary?.usedInKlip ?? null, tone: 'bg-violet-50 text-violet-600', hint: 'used by a shipment or a vessel' },
  ]

  return (
    <Layout>
      <StitchFields>
      <div className="space-y-6">
        <p className="text-sm text-gray-500">The ports KLIP uses in shipments: which SAP names stand for them, and whether DHM has them.</p>

        <MasterKpis items={kpis} />

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
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">VESSEL PORT (SAP)</label>
                  <textarea
                    className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 disabled:bg-slate-50"
                    rows={4}
                    placeholder={SAP_NAMES_PLACEHOLDER}
                    value={(form.vessel_port_sap ?? []).join('\n')}
                    disabled={!isAdmin || (!!editing && !IS_UUID.test(editing.id))}
                    onChange={(e) => handleChange('vessel_port_sap', e.target.value.split(/\r?\n/))}
                  />
                  <p className="mt-1 text-xs text-gray-500">
                    The texts SAP writes as a vessel port that belong to this port. A text can belong to one port only; it decides which Master Port a SAP transaction is shown under.
                  </p>
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
                <Button onClick={handleSubmit}><Save className="mr-2 h-4 w-4" aria-hidden />Save</Button>
              </div>
            </CardContent>
          </Card>
        )}

        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          <MasterFilterBar
            search={search}
            onSearch={(value) => {
              setSearch(value)
              setPage(1)
            }}
            placeholder="Search port, region, site or code"
            ariaLabel="Search ports"
            dhm={dhm}
            onDhm={(value) => {
              setDhm(value)
              setPage(1)
            }}
            dhmCounts={summary ? { all: summary.total, synced: summary.synced, not_synced: summary.notSynced, failed: summary.failed } : undefined}
            extraActive={site !== ''}
            onClear={() => {
              setSearch('')
              setDhm('all')
              setSite('')
              setPage(1)
            }}
            actions={
              isAdmin ? (
                <>
                  <MasterDhmSyncButton master="port" onDone={refresh} iconOnly />
                  <Button variant="outline" size="icon" className={ICON_BUTTON_CLASS} title="New port" aria-label="New port" onClick={openNew}>
                    <Plus className="h-4 w-4" aria-hidden />
                  </Button>
                </>
              ) : null
            }
          >
            <Select
              value={site || ALL_SITES}
              onValueChange={(value) => {
                setSite(value === ALL_SITES ? '' : value)
                setPage(1)
              }}
            >
              <SelectTrigger className="h-9 w-[230px] gap-2 [&>span]:flex-1 [&>span]:truncate [&>span]:text-left" aria-label="Filter by site">
                <Building2 className="h-4 w-4 shrink-0 text-gray-400" aria-hidden />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_SITES}>All sites{summary ? ` (${siteOptions.length.toLocaleString('en-US')})` : ''}</SelectItem>
                {siteOptions.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {option.name} ({option.ports.toLocaleString('en-US')})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </MasterFilterBar>

          <MasterListTable
            rows={pageRows}
            columns={columns}
            getRowId={(row) => row.id}
            loading={loading}
            emptyLabel={filtersOn ? 'No ports match these filters' : 'No ports yet'}
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
                title={isAdmin ? 'Edit port' : 'View port'}
                aria-label={`${isAdmin ? 'Edit' : 'View'} ${row.port}`}
                onClick={() => openEdit(row)}
              >
                <Pencil className="h-4 w-4" />
              </Button>
            )}
          />

          <MasterTableFooter
            countText={`${masterCountText(pageRows.length, total, summary?.total ?? total, 'ports')} · click a row to ${isAdmin ? 'edit' : 'view'} it`}
            kinds={['klip', 'dhm']}
            pager={{ page: page, totalPages: totalPages, onPageChange: setPage, disabled: loading }}
          />
        </div>
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

