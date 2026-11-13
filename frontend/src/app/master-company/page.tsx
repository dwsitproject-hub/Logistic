'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Building2, Cloud, CloudOff, Factory, MapPin, Pencil, Plus } from 'lucide-react'
import Layout from '@/components/Layout'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { iconButtonClass } from '@/lib/iconButton'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { SearchableMultiSelect } from '@/components/SearchableMultiSelect'
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
import { masterCountText, masterDhmChip, sortCompanyOptions, type MasterDhmFilter } from '@/lib/masterDirectory'
import { multiValuesOf, multiValueText } from '@/lib/multiValueCell'

interface MasterCompany {
  id: string
  code_klip: string | null
  code_dhm?: string | null
  dhm_id?: string | null
  company_code: string
  company_name: string
  site: string | null
  /** The sites linked to the company, as a list. */
  site_names?: string[] | null
  site_ids: string[] | null
  dhm_push_status?: string | null
  dhm_push_error?: string | null
  dhm_push_attempts?: number | null
  dhm_push_next_attempt_at?: string | null
}

interface SiteOption {
  id: string
  site_name: string
}

interface CompanySummary {
  total: number
  synced: number
  notSynced: number
  failed: number
  usedInKlip: number
  /** The Sites that have companies, for the Site filter. */
  sites: Array<{ id: string; name: string; companies: number }>
}

const PAGE_SIZE = 20
const ALL_SITES = '__all__'

export default function MasterCompanyPage() {
  const [items, setItems] = useState<MasterCompany[]>([])
  const [sites, setSites] = useState<SiteOption[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [dhm, setDhm] = useState<MasterDhmFilter>('all')
  const [siteFilter, setSiteFilter] = useState('')
  const debouncedSearch = useDebouncedValue(search.trim(), 300)
  const [loading, setLoading] = useState(false)
  const [summary, setSummary] = useState<CompanySummary | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<MasterCompany | null>(null)
  const [form, setForm] = useState({ company_code: '', company_name: '', site_ids: [] as string[] })
  const [sortKey, setSortKey] = useState('company')
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

  const fetchData = useCallback(async (pageNum: number, term: string, dhmFilter: MasterDhmFilter, siteId: string) => {
    setLoading(true)
    try {
      const res = await api.get('/master-companies', {
        params: { page: pageNum, limit: PAGE_SIZE, search: term, ...(dhmFilter !== 'all' ? { dhm: dhmFilter } : {}), ...(siteId ? { site: siteId } : {}) },
      })
      setItems(res.data?.data?.items || [])
      setTotal(res.data?.data?.pagination?.total || 0)
    } catch (error) {
      console.error('Failed to load companies', error)
      alert('Failed to load companies')
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchSummary = useCallback(async () => {
    try {
      const res = await api.get('/master-companies/summary')
      setSummary(res.data?.data ?? null)
    } catch (error) {
      // the cards are informational: the list still works without them
      console.error('Failed to load the company summary', error)
    }
  }, [])

  useEffect(() => {
    void fetchData(page, debouncedSearch, dhm, siteFilter)
  }, [page, debouncedSearch, dhm, siteFilter, fetchData])

  useEffect(() => {
    void fetchSummary()
  }, [fetchSummary])

  const refresh = () => {
    void fetchData(page, debouncedSearch, dhm, siteFilter)
    void fetchSummary()
  }

  useEffect(() => {
    if (!open) return
    let cancelled = false
    void api.get('/master-sites', { params: { page: 1, limit: 500 } }).then((res) => {
      if (cancelled) return
      const rows = (res.data?.data?.items || []) as SiteOption[]
      setSites(rows.filter((row) => row.id && row.site_name))
    }).catch(() => {
      if (!cancelled) setSites([])
    })
    return () => {
      cancelled = true
    }
  }, [open])

  const siteName = (id: string) => sites.find((site) => site.id === id)?.site_name || ''

  const save = async () => {
    if (!form.company_code.trim() || !form.company_name.trim()) {
      alert('Company Code (SAP) and Company Name are required')
      return
    }
    const payload = {
      company_code: form.company_code.trim(),
      company_name: form.company_name.trim(),
      site_ids: form.site_ids,
    }
    try {
      await saveWithDhmConfirm((overwrite) => {
        const qs = overwrite ? '?dhmOverwrite=true' : ''
        if (editing) return api.put(`/master-companies/${editing.id}${qs}`, payload)
        return api.post(`/master-companies${qs}`, payload)
      }, 'company')
      setOpen(false)
      refresh()
    } catch (error: unknown) {
      const message = (error as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message
      alert(message || 'Save failed')
    }
  }

  const openRow = (row: MasterCompany) => {
    setEditing(row)
    setForm({ company_code: row.company_code || '', company_name: row.company_name || '', site_ids: row.site_ids || [] })
    setOpen(true)
  }

  const siteOptions = useMemo(() => sortCompanyOptions(summary?.sites ?? []), [summary])
  const filtersOn = search.trim() !== '' || siteFilter !== '' || dhm !== 'all'

  const sortedRows = useMemo(() => {
    const text = (row: MasterCompany): string => {
      if (sortKey === 'dhm') return masterDhmChip(row).label
      if (sortKey === 'sites') return multiValueText(multiValuesOf(row.site_names, row.site))
      return row.company_name || ''
    }
    return [...items].sort((a, b) => {
      const cmp = text(a).localeCompare(text(b), undefined, { numeric: true })
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [items, sortKey, sortDir])

  const columns: MasterTableColumn<MasterCompany>[] = [
    {
      id: 'company',
      label: 'Company',
      sortable: true,
      render: (row) => <MasterIdentityCell name={row.company_name} subtitle={row.company_code ? `SAP ${row.company_code}` : 'No SAP code yet'} />,
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
      id: 'sites',
      label: 'Sites',
      sortable: true,
      render: (row) => <MultiValueCell values={multiValuesOf(row.site_names, row.site)} rowTitle={row.company_name} columnLabel="Site" plural="sites" />,
    },
    { id: 'dhm', label: 'DHM', sortable: true, className: 'whitespace-nowrap', render: (row) => <MasterDhmChip row={row} /> },
  ]

  const kpis = [
    { id: 'total', icon: <Building2 className="h-4 w-4" />, label: 'Total companies', value: summary?.total ?? null, tone: 'bg-blue-50 text-blue-600', hint: 'all internal companies' },
    { id: 'synced', icon: <Cloud className="h-4 w-4" />, label: 'Synced to DHM', value: summary?.synced ?? null, tone: 'bg-emerald-50 text-emerald-600', hint: 'DHM has them' },
    {
      id: 'not-synced',
      icon: <CloudOff className="h-4 w-4" />,
      label: 'Not synced',
      value: summary?.notSynced ?? null,
      tone: 'bg-amber-50 text-amber-600',
      hint: summary && summary.failed > 0 ? `${summary.failed.toLocaleString('en-US')} more failed to deliver` : 'not in DHM yet',
    },
    { id: 'used', icon: <Factory className="h-4 w-4" />, label: 'Used in KLIP', value: summary?.usedInKlip ?? null, tone: 'bg-violet-50 text-violet-600', hint: 'with at least one plant' },
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
              placeholder="Search company, code or site"
              ariaLabel="Search companies"
              dhm={dhm}
              onDhm={(value) => {
                setDhm(value)
                setPage(1)
              }}
              dhmCounts={summary ? { all: summary.total, synced: summary.synced, not_synced: summary.notSynced, failed: summary.failed } : undefined}
              extraActive={siteFilter !== ''}
              onClear={() => {
                setSearch('')
                setDhm('all')
                setSiteFilter('')
                setPage(1)
              }}
              actions={
                isAdmin ? (
                  <>
                    <MasterDhmSyncButton master="company" onDone={refresh} iconOnly />
                    <Button
                      variant="ghost"
                      size="icon"
                      className={iconButtonClass('add')}
                      title="New company"
                      aria-label="New company"
                      onClick={() => {
                        setEditing(null)
                        setForm({ company_code: '', company_name: '', site_ids: [] })
                        setOpen(true)
                      }}
                    >
                      <Plus className="h-4 w-4" aria-hidden />
                    </Button>
                  </>
                ) : null
              }
            >
              <Select
                value={siteFilter || ALL_SITES}
                onValueChange={(value) => {
                  setSiteFilter(value === ALL_SITES ? '' : value)
                  setPage(1)
                }}
              >
                <SelectTrigger className="h-9 w-[220px] gap-2 [&>span]:flex-1 [&>span]:truncate [&>span]:text-left" aria-label="Filter by site">
                  <MapPin className="h-4 w-4 shrink-0 text-gray-400" aria-hidden />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_SITES}>All sites{summary ? ` (${siteOptions.length.toLocaleString('en-US')})` : ''}</SelectItem>
                  {siteOptions.map((option) => (
                    <SelectItem key={option.id} value={option.id}>
                      {option.name} ({option.companies.toLocaleString('en-US')})
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
              emptyLabel={filtersOn ? 'No companies match these filters' : 'No companies yet'}
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
                  title={isAdmin ? 'Edit company' : 'View company'}
                  aria-label={`${isAdmin ? 'Edit' : 'View'} ${row.company_name}`}
                  onClick={() => openRow(row)}
                >
                  <Pencil className="h-4 w-4" />
                </Button>
              )}
            />

            <MasterTableFooter
              countText={`${masterCountText(items.length, total, summary?.total ?? total, 'companies')} · click a row to ${isAdmin ? 'edit' : 'view'} it`}
              kinds={['klip', 'dhm']}
              pager={{ page: page, totalPages: totalPages, onPageChange: setPage, disabled: loading }}
            />
          </div>

          <Dialog open={open} onOpenChange={setOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{editing ? 'Edit Company' : 'New Company'}</DialogTitle>
              </DialogHeader>
              <div className="grid gap-3">
                <div className="space-y-1">
                  <Label>Company Code (KLIP)</Label>
                  <Input value={editing?.code_klip || ''} placeholder="Assigned on save" readOnly disabled />
                </div>
                <div className="space-y-1">
                  <Label>Company Code (DHM)</Label>
                  <Input value={editing?.code_dhm || ''} placeholder="-" readOnly disabled />
                </div>
                <div className="space-y-1">
                  <Label>Company Code (SAP)</Label>
                  <Input value={form.company_code} onChange={(event) => setForm((current) => ({ ...current, company_code: event.target.value }))} disabled={!isAdmin} required />
                </div>
                <div className="space-y-1">
                  <Label>Company Name</Label>
                  <Input value={form.company_name} onChange={(event) => setForm((current) => ({ ...current, company_name: event.target.value }))} disabled={!isAdmin} required />
                </div>
                <SearchableMultiSelect
                  label="Site"
                  labelClassName="text-sm font-medium text-gray-700"
                  options={sites.map((site) => site.site_name)}
                  selected={form.site_ids.map(siteName).filter(Boolean)}
                  onChange={(names) =>
                    setForm((current) => ({
                      ...current,
                      site_ids: names
                        .map((name) => sites.find((site) => site.site_name === name)?.id)
                        .filter((id): id is string => Boolean(id)),
                    }))
                  }
                  placeholder="Select sites"
                  emptyMessage="No sites"
                />
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
