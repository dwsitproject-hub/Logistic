'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import Layout from '@/components/Layout'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { SearchableMultiSelect } from '@/components/SearchableMultiSelect'
import { MasterListCompactTable, type MasterListTableColumn } from '@/components/shared/MasterListCompactTable'
import { MasterRowActions } from '@/components/shared/MasterRowActions'
import { MasterDhmSyncButton } from '@/components/shared/MasterDhmSyncButton'
import { useListColumnLayout } from '@/lib/listColumnLayout'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { ListFilterPanel, LIST_FILTER_FIELD_LABEL_CLASS, LIST_FILTER_FIELDS_ROW_CLASS } from '@/components/shared/ListFilterPanel'
import { StitchFields } from '@/components/shared/stitchField'
import { StitchSearchIcon } from '@/components/shared/stitchIcons'
import { dhmStatusListColumn } from '@/lib/dhmStatusColumn'
import { saveWithDhmConfirm } from '@/lib/dhmMasterSave'

interface MasterCompany {
  id: string
  code_klip: string | null
  code_dhm?: string | null
  dhm_id?: string | null
  company_code: string
  company_name: string
  site: string | null
  site_ids: string[] | null
}

interface SiteOption {
  id: string
  site_name: string
}

const COLUMNS: MasterListTableColumn<MasterCompany>[] = [
  { id: 'code_klip', label: 'Company Code (KLIP)', getText: (row) => row.code_klip || '-' },
  { id: 'code_dhm', label: 'Company Code (DHM)', getText: (row) => row.code_dhm || '-' },
  { id: 'company_code', label: 'Company Code (SAP)', getText: (row) => row.company_code || '-' },
  { id: 'company_name', label: 'Company Name', getText: (row) => row.company_name || '-' },
  { id: 'site', label: 'Site', getText: (row) => row.site || '-' },
  dhmStatusListColumn<MasterCompany>(),
]

export default function MasterCompanyPage() {
  const [items, setItems] = useState<MasterCompany[]>([])
  const [sites, setSites] = useState<SiteOption[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebouncedValue(search.trim(), 300)
  const [loading, setLoading] = useState(false)
  const [isAdmin, setIsAdmin] = useState(false)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<MasterCompany | null>(null)
  const [form, setForm] = useState({ company_code: '', company_name: '', site_ids: [] as string[] })
  const [sortKey, setSortKey] = useState('company_name')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const layout = useListColumnLayout('master-company.visibleColumns.v1', COLUMNS)
  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / 20)), [total])

  useEffect(() => {
    try {
      const user = JSON.parse(localStorage.getItem('user') || 'null') as { role?: string } | null
      setIsAdmin(String(user?.role || '').toUpperCase() === 'ADMIN')
    } catch {
      setIsAdmin(false)
    }
  }, [])

  const fetchData = useCallback(async (pageNum: number, term: string) => {
    setLoading(true)
    try {
      const res = await api.get('/master-companies', { params: { page: pageNum, limit: 20, search: term } })
      setItems(res.data?.data?.items || [])
      setTotal(res.data?.data?.pagination?.total || 0)
    } catch (error) {
      console.error('Failed to load companies', error)
      alert('Failed to load companies')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchData(page, debouncedSearch)
  }, [page, debouncedSearch, fetchData])

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
      void fetchData(page, debouncedSearch)
    } catch (error: unknown) {
      const message = (error as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message
      alert(message || 'Save failed')
    }
  }

  const remove = async (row: MasterCompany) => {
    if (!confirm(`Delete ${row.company_name}?`)) return
    try {
      await api.delete(`/master-companies/${row.id}`)
      void fetchData(page, debouncedSearch)
    } catch (error: unknown) {
      const message = (error as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message
      alert(message || 'Delete failed')
    }
  }

  return (
    <Layout>
      <StitchFields>
        <div className="space-y-6">
          <ListFilterPanel
            onReset={() => setSearch('')}
            showReset={search.trim().length > 0}
            chips={search.trim() ? [{ id: 'search', label: `Search: ${search.trim()}`, onRemove: () => setSearch('') }] : []}
          >
            <div className={LIST_FILTER_FIELDS_ROW_CLASS}>
              <div className="min-w-[12rem] flex-[1.4]">
                <label className={LIST_FILTER_FIELD_LABEL_CLASS}>Search</label>
                <div className="relative">
                  <StitchSearchIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <Input
                    placeholder="Company code, name, or site"
                    value={search}
                    onChange={(event) => {
                      setSearch(event.target.value)
                      setPage(1)
                    }}
                    className="rounded-lg border-slate-200 pl-10"
                  />
                </div>
              </div>
              {isAdmin ? (
                <div className="flex shrink-0 items-end gap-2">
                  <Button
                    size="sm"
                    className="shrink-0"
                    onClick={() => {
                      setEditing(null)
                      setForm({ company_code: '', company_name: '', site_ids: [] })
                      setOpen(true)
                    }}
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    New Company
                  </Button>
                  <MasterDhmSyncButton master="company" onDone={() => void fetchData(page, debouncedSearch)} />
                </div>
              ) : null}
            </div>
          </ListFilterPanel>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">All Company (Internal)</CardTitle>
              <p className="mt-1 text-xs text-gray-500">
                <span className="font-semibold text-gray-700">{total.toLocaleString('en-US')}</span> companies · Page {page}/{totalPages}
              </p>
            </CardHeader>
            <CardContent>
              <MasterListCompactTable
                tightActions
                rows={[...items].sort((a, b) => {
                  const col = COLUMNS.find((item) => item.id === sortKey)
                  const left = col?.getText(a) ?? ''
                  const right = col?.getText(b) ?? ''
                  const cmp = left.localeCompare(right, undefined, { numeric: true })
                  return sortDir === 'asc' ? cmp : -cmp
                })}
                columns={COLUMNS.filter((col) => layout.orderedVisibleIds.includes(col.id)).sort(
                  (a, b) => layout.orderedVisibleIds.indexOf(a.id) - layout.orderedVisibleIds.indexOf(b.id),
                )}
                getRowId={(row) => row.id}
                sortKey={sortKey}
                sortDir={sortDir}
                dragColId={layout.dragColId}
                loading={loading}
                emptyLabel="No companies found"
                onSort={(id) => {
                  setSortDir((dir) => (sortKey === id ? (dir === 'asc' ? 'desc' : 'asc') : 'asc'))
                  setSortKey(id)
                }}
                onDragStart={layout.setDragColId}
                onDragEnd={() => layout.setDragColId(null)}
                onDrop={(id) => {
                  if (layout.dragColId) layout.reorder(layout.dragColId, id)
                  layout.setDragColId(null)
                }}
                renderActions={(row) => (
                  <MasterRowActions
                    isAdmin={isAdmin}
                    editLabel={isAdmin ? 'Edit company' : 'View company'}
                    deleteLabel="Delete company"
                    onEdit={() => {
                      setEditing(row)
                      setForm({
                        company_code: row.company_code || '',
                        company_name: row.company_name || '',
                        site_ids: row.site_ids || [],
                      })
                      setOpen(true)
                    }}
                    onDelete={() => void remove(row)}
                  />
                )}
              />
              {totalPages > 1 ? (
                <div className="mt-3 flex justify-end gap-2">
                  <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>Previous</Button>
                  <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((current) => current + 1)}>Next</Button>
                </div>
              ) : null}
            </CardContent>
          </Card>
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
