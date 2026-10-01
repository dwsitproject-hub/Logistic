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
import { MasterListCompactTable, type MasterListTableColumn } from '@/components/shared/MasterListCompactTable'
import { MasterRowActions } from '@/components/shared/MasterRowActions'
import { useListColumnLayout } from '@/lib/listColumnLayout'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { ListFilterPanel, LIST_FILTER_FIELD_LABEL_CLASS, LIST_FILTER_FIELDS_ROW_CLASS } from '@/components/shared/ListFilterPanel'
import { StitchFields } from '@/components/shared/stitchField'
import { StitchSearchIcon } from '@/components/shared/stitchIcons'
import { dhmStatusListColumn } from '@/lib/dhmStatusColumn'
import { saveWithDhmConfirm } from '@/lib/dhmMasterSave'
import { MasterDhmSyncButton } from '@/components/shared/MasterDhmSyncButton'

interface MasterSite {
  id: string
  code_klip: string | null
  code_dhm?: string | null
  dhm_id?: string | null
  site_name: string
  company_name: string | null
  city: string | null
  postal_code: string | null
}

const COLUMNS: MasterListTableColumn<MasterSite>[] = [
  { id: 'code_klip', label: 'Site Code (KLIP)', getText: (row) => row.code_klip || '-' },
  { id: 'code_dhm', label: 'Site Code (DHM)', getText: (row) => row.code_dhm || '-' },
  { id: 'site_name', label: 'Site', getText: (row) => row.site_name || '-' },
  { id: 'company_name', label: 'Company Name', getText: (row) => row.company_name || '-' },
  { id: 'city', label: 'City', getText: (row) => row.city || '-' },
  { id: 'postal_code', label: 'Postal Code', getText: (row) => row.postal_code || '-' },
  dhmStatusListColumn<MasterSite>(),
]

export default function MasterSitePage() {
  const [items, setItems] = useState<MasterSite[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebouncedValue(search.trim(), 300)
  const [loading, setLoading] = useState(false)
  const [isAdmin, setIsAdmin] = useState(false)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<MasterSite | null>(null)
  const [form, setForm] = useState({ site_name: '', city: '', postal_code: '' })
  const [sortKey, setSortKey] = useState('site_name')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const layout = useListColumnLayout('master-site.visibleColumns.v3', COLUMNS)
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
      const res = await api.get('/master-sites', { params: { page: pageNum, limit: 20, search: term } })
      setItems(res.data?.data?.items || [])
      setTotal(res.data?.data?.pagination?.total || 0)
    } catch (error) {
      console.error('Failed to load sites', error)
      alert('Failed to load sites')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchData(page, debouncedSearch)
  }, [page, debouncedSearch, fetchData])

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
      void fetchData(page, debouncedSearch)
    } catch (error: any) {
      alert(error?.response?.data?.error?.message || 'Save failed')
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
                    placeholder="Site, company, city, or postal code"
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
                      setForm({ site_name: '', city: '', postal_code: '' })
                      setOpen(true)
                    }}
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    New Site
                  </Button>
                  <MasterDhmSyncButton master="site" onDone={() => void fetchData(page, debouncedSearch)} />
                </div>
              ) : null}
            </div>
          </ListFilterPanel>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">All Site</CardTitle>
              <p className="mt-1 text-xs text-gray-500">
                <span className="font-semibold text-gray-700">{total.toLocaleString('en-US')}</span> sites · Page {page}/{totalPages}
              </p>
            </CardHeader>
            <CardContent>
              <MasterListCompactTable
                tightActions
                fitContent
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
                emptyLabel="No sites found"
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
                    editLabel={isAdmin ? 'Edit site' : 'View site'}
                    onEdit={() => {
                      setEditing(row)
                      setForm({
                        site_name: row.site_name || '',
                        city: row.city || '',
                        postal_code: row.postal_code || '',
                      })
                      setOpen(true)
                    }}
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
