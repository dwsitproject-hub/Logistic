'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Building2, Cloud, CloudOff, Pencil, Plus, Route } from 'lucide-react'
import Layout from '@/components/Layout'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { ICON_BUTTON_CLASS } from '@/lib/iconButton'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { MasterCodeBadge } from '@/components/shared/MasterCodeBadge'
import { MasterDhmSyncButton } from '@/components/shared/MasterDhmSyncButton'
import { MultiValueCell } from '@/components/shared/MultiValueCell'
import { MasterKpis } from '@/components/master/MasterKpis'
import { MasterFilterBar } from '@/components/master/MasterFilterBar'
import { MasterTableFooter } from '@/components/master/MasterTableFooter'
import { MasterDhmChip, MasterIdentityCell, MasterListTable, type MasterTableColumn } from '@/components/master/MasterListTable'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { StitchFields } from '@/components/shared/stitchField'
import { saveWithDhmConfirm } from '@/lib/dhmMasterSave'
import { masterCountText, masterDhmChip, sortCompanyOptions, type MasterCompanyOption, type MasterDhmFilter } from '@/lib/masterDirectory'
import { multiValuesOf, multiValueText } from '@/lib/multiValueCell'

interface MasterSite {
  id: string
  code_klip: string | null
  code_dhm?: string | null
  dhm_id?: string | null
  site_name: string
  company_name: string | null
  /** The companies linked to the Site, as a list (so a name with a comma is not cut in two). */
  company_names?: string[] | null
  city: string | null
  postal_code: string | null
  dhm_push_status?: string | null
  dhm_push_error?: string | null
  dhm_push_attempts?: number | null
  dhm_push_next_attempt_at?: string | null
}

interface SiteSummary {
  total: number
  synced: number
  notSynced: number
  failed: number
  usedInKlip: number
  companies: MasterCompanyOption[]
}

const PAGE_SIZE = 20
const ALL_COMPANIES = '__all__'

function subtitleOf(row: MasterSite): string {
  return [row.city, row.postal_code].filter(Boolean).join(' · ') || 'No city yet'
}

export default function MasterSitePage() {
  const [items, setItems] = useState<MasterSite[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [dhm, setDhm] = useState<MasterDhmFilter>('all')
  const [company, setCompany] = useState('')
  const debouncedSearch = useDebouncedValue(search.trim(), 300)
  const [loading, setLoading] = useState(false)
  const [summary, setSummary] = useState<SiteSummary | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<MasterSite | null>(null)
  const [form, setForm] = useState({ site_name: '', city: '', postal_code: '' })
  const [sortKey, setSortKey] = useState('site')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / PAGE_SIZE)), [total])

  useEffect(() => {
    try {
      const user = JSON.parse(localStorage.getItem('user') || 'null') as { role?: string } | null
      setIsAdmin(String(user?.role || '').toUpperCase() === 'ADMIN')
    } catch {
      setIsAdmin(false)
    }
  }, [])

  const fetchData = useCallback(async (pageNum: number, term: string, dhmFilter: MasterDhmFilter, companyId: string) => {
    setLoading(true)
    try {
      const res = await api.get('/master-sites', {
        params: { page: pageNum, limit: PAGE_SIZE, search: term, ...(dhmFilter !== 'all' ? { dhm: dhmFilter } : {}), ...(companyId ? { company: companyId } : {}) },
      })
      setItems(res.data?.data?.items || [])
      setTotal(res.data?.data?.pagination?.total || 0)
    } catch (error) {
      console.error('Failed to load sites', error)
      alert('Failed to load sites')
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchSummary = useCallback(async () => {
    try {
      const res = await api.get('/master-sites/summary')
      setSummary(res.data?.data ?? null)
    } catch (error) {
      // the cards are informational: the list still works without them
      console.error('Failed to load the site summary', error)
    }
  }, [])

  useEffect(() => {
    void fetchData(page, debouncedSearch, dhm, company)
  }, [page, debouncedSearch, dhm, company, fetchData])

  useEffect(() => {
    void fetchSummary()
  }, [fetchSummary])

  const refresh = () => {
    void fetchData(page, debouncedSearch, dhm, company)
    void fetchSummary()
  }

  const save = async () => {
    if (!form.site_name.trim()) {
      alert('Site is required')
      return
    }
    const payload = {
      site_name: form.site_name.trim(),
      city: form.city.trim() || null,
      postal_code: form.postal_code.trim() || null,
    }
    try {
      await saveWithDhmConfirm((overwrite) => {
        const qs = overwrite ? '?dhmOverwrite=true' : ''
        if (editing) return api.put(`/master-sites/${editing.id}${qs}`, payload)
        return api.post(`/master-sites${qs}`, payload)
      }, 'site')
      setOpen(false)
      refresh()
    } catch (error: any) {
      alert(error?.response?.data?.error?.message || 'Save failed')
    }
  }

  const openRow = (row: MasterSite) => {
    setEditing(row)
    setForm({ site_name: row.site_name || '', city: row.city || '', postal_code: row.postal_code || '' })
    setOpen(true)
  }

  const companyOptions = useMemo(() => sortCompanyOptions(summary?.companies ?? []), [summary])
  const filtersOn = search.trim() !== '' || company !== '' || dhm !== 'all'

  const sortedRows = useMemo(() => {
    const text = (row: MasterSite): string => {
      if (sortKey === 'dhm') return masterDhmChip(row).label
      if (sortKey === 'companies') return multiValueText(multiValuesOf(row.company_names, row.company_name))
      return row.site_name || ''
    }
    return [...items].sort((a, b) => {
      const cmp = text(a).localeCompare(text(b), undefined, { numeric: true })
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [items, sortKey, sortDir])

  const columns: MasterTableColumn<MasterSite>[] = [
    { id: 'site', label: 'Site', sortable: true, render: (row) => <MasterIdentityCell name={row.site_name} subtitle={subtitleOf(row)} /> },
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
      id: 'companies',
      label: 'Companies',
      sortable: true,
      render: (row) => (
        <MultiValueCell values={multiValuesOf(row.company_names, row.company_name)} rowTitle={row.site_name} columnLabel="Company Name" plural="companies" />
      ),
    },
    { id: 'dhm', label: 'DHM', sortable: true, className: 'whitespace-nowrap', render: (row) => <MasterDhmChip row={row} /> },
  ]

  const kpis = [
    { id: 'total', icon: <Building2 className="h-4 w-4" />, label: 'Total sites', value: summary?.total ?? null, tone: 'bg-blue-50 text-blue-600', hint: 'all master sites' },
    { id: 'synced', icon: <Cloud className="h-4 w-4" />, label: 'Synced to DHM', value: summary?.synced ?? null, tone: 'bg-emerald-50 text-emerald-600', hint: 'DHM has them' },
    {
      id: 'not-synced',
      icon: <CloudOff className="h-4 w-4" />,
      label: 'Not synced',
      value: summary?.notSynced ?? null,
      tone: 'bg-amber-50 text-amber-600',
      hint: summary && summary.failed > 0 ? `${summary.failed.toLocaleString('en-US')} more failed to deliver` : 'not in DHM yet',
    },
    { id: 'used', icon: <Route className="h-4 w-4" />, label: 'Used in KLIP', value: summary?.usedInKlip ?? null, tone: 'bg-violet-50 text-violet-600', hint: 'linked to a plant or a port' },
  ]

  return (
    <Layout>
      <StitchFields>
        <div className="space-y-6">
          <MasterKpis items={kpis} />

          <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
            <MasterFilterBar
              search={search}
              onSearch={(value) => {
                setSearch(value)
                setPage(1)
              }}
              placeholder="Search site, company, city or code"
              ariaLabel="Search sites"
              dhm={dhm}
              onDhm={(value) => {
                setDhm(value)
                setPage(1)
              }}
              dhmCounts={summary ? { all: summary.total, synced: summary.synced, not_synced: summary.notSynced, failed: summary.failed } : undefined}
              extraActive={company !== ''}
              actions={
                isAdmin ? (
                  <>
                    <MasterDhmSyncButton master="site" onDone={refresh} iconOnly />
                    <Button
                      variant="outline"
                      size="icon"
                      className={ICON_BUTTON_CLASS}
                      title="New site"
                      aria-label="New site"
                      onClick={() => {
                        setEditing(null)
                        setForm({ site_name: '', city: '', postal_code: '' })
                        setOpen(true)
                      }}
                    >
                      <Plus className="h-4 w-4" aria-hidden />
                    </Button>
                  </>
                ) : null
              }
              onClear={() => {
                setSearch('')
                setDhm('all')
                setCompany('')
                setPage(1)
              }}
            >
              <Select
                value={company || ALL_COMPANIES}
                onValueChange={(value) => {
                  setCompany(value === ALL_COMPANIES ? '' : value)
                  setPage(1)
                }}
              >
                <SelectTrigger className="h-9 w-[250px] gap-2 [&>span]:flex-1 [&>span]:truncate [&>span]:text-left" aria-label="Filter by company">
                  <Building2 className="h-4 w-4 shrink-0 text-gray-400" aria-hidden />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_COMPANIES}>All companies{summary ? ` (${companyOptions.length.toLocaleString('en-US')})` : ''}</SelectItem>
                  {companyOptions.map((option) => (
                    <SelectItem key={option.id} value={option.id}>
                      {option.name} ({option.sites.toLocaleString('en-US')})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </MasterFilterBar>

            <MasterListTable
              rows={sortedRows}
              columns={columns}
              getRowId={(row) => row.id}
              loading={loading}
              emptyLabel={filtersOn ? 'No sites match these filters' : 'No sites yet'}
              sortKey={sortKey}
              sortDir={sortDir}
              onSort={(id) => {
                setSortDir((dir) => (sortKey === id ? (dir === 'asc' ? 'desc' : 'asc') : 'asc'))
                setSortKey(id)
              }}
              onRowClick={openRow}
              renderActions={(row) => (
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8 border-transparent bg-transparent text-blue-600 hover:bg-blue-50"
                  title={isAdmin ? 'Edit site' : 'View site'}
                  aria-label={`${isAdmin ? 'Edit' : 'View'} ${row.site_name}`}
                  onClick={() => openRow(row)}
                >
                  <Pencil className="h-4 w-4" />
                </Button>
              )}
            />

            <MasterTableFooter
              countText={`${masterCountText(items.length, total, summary?.total ?? total, 'sites')} · click a row to ${isAdmin ? 'edit' : 'view'} it`}
              kinds={['klip', 'dhm']}
              pager={{ page: page, totalPages: totalPages, onPageChange: setPage, disabled: loading }}
            />
          </div>

          <Dialog open={open} onOpenChange={setOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{editing ? 'Edit Site' : 'New Site'}</DialogTitle>
              </DialogHeader>
              <div className="grid gap-3">
                <div className="space-y-1">
                  <Label>Site Code (KLIP)</Label>
                  <Input value={editing?.code_klip || ''} placeholder="Assigned on save" readOnly disabled />
                </div>
                <div className="space-y-1">
                  <Label>Site Code (DHM)</Label>
                  <Input value={editing?.code_dhm || ''} placeholder="-" readOnly disabled />
                </div>
                <div className="space-y-1">
                  <Label>Site</Label>
                  <Input value={form.site_name} onChange={(event) => setForm((current) => ({ ...current, site_name: event.target.value }))} disabled={!isAdmin} required />
                </div>
                <div className="space-y-1">
                  <Label>City</Label>
                  <Input value={form.city} onChange={(event) => setForm((current) => ({ ...current, city: event.target.value }))} disabled={!isAdmin} />
                </div>
                <div className="space-y-1">
                  <Label>Postal Code</Label>
                  <Input value={form.postal_code} onChange={(event) => setForm((current) => ({ ...current, postal_code: event.target.value }))} disabled={!isAdmin} />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                {isAdmin ? <Button onClick={() => void save()}>Save</Button> : null}
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </StitchFields>
    </Layout>
  )
}
