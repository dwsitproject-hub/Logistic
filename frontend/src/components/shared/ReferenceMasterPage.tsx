'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import Layout from '@/components/Layout'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ListFilterPanel, LIST_FILTER_FIELD_LABEL_CLASS, LIST_FILTER_FIELDS_ROW_CLASS } from '@/components/shared/ListFilterPanel'
import { StitchFields } from '@/components/shared/stitchField'
import { StitchSearchIcon } from '@/components/shared/stitchIcons'
import { ListPageColumnsMenu } from '@/components/shared/ListPageColumnsMenu'
import { MasterListCompactTable, type MasterListTableColumn } from '@/components/shared/MasterListCompactTable'
import { MasterRowActions } from '@/components/shared/MasterRowActions'
import { useListColumnLayout } from '@/lib/listColumnLayout'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { dhmStatusListColumn } from '@/lib/dhmStatusColumn'
import { saveWithDhmConfirm } from '@/lib/dhmMasterSave'

export interface ReferenceField {
  key: 'value_1' | 'value_2' | 'value_3'
  label: string
  required?: boolean
}

interface ReferenceRow {
  id: string
  code_klip: string | null
  code_dhm: string | null
  value_1: string | null
  value_2: string | null
  value_3: string | null
}

interface ReferenceMasterPageProps {
  kind: string
  title: string
  description: string
  newLabel: string
  fields: ReferenceField[]
  storageKey: string
  codeNoun: string
  syncDhm?: boolean
  dhmNoun?: string
}

function cell(value: string | null | undefined): string {
  return value && value.trim() ? value : '-'
}

export function ReferenceMasterPage({
  kind,
  title,
  description,
  newLabel,
  fields,
  storageKey,
  codeNoun,
  syncDhm = false,
  dhmNoun = 'record',
}: ReferenceMasterPageProps) {
  const columns = useMemo<MasterListTableColumn<ReferenceRow>[]>(
    () => [
      { id: 'code_klip', label: `${codeNoun} Code (KLIP)`, getText: (row) => cell(row.code_klip) },
      { id: 'code_dhm', label: `${codeNoun} Code (DHM)`, getText: (row) => cell(row.code_dhm) },
      ...fields.map((field) => ({
        id: field.key,
        label: field.label,
        getText: (row: ReferenceRow) => cell(row[field.key]),
      })),
      dhmStatusListColumn<ReferenceRow>(),
    ],
    [codeNoun, fields],
  )
  const layout = useListColumnLayout(storageKey, columns)
  const [items, setItems] = useState<ReferenceRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebouncedValue(search.trim(), 300)
  const [loading, setLoading] = useState(false)
  const [isAdmin, setIsAdmin] = useState(false)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<ReferenceRow | null>(null)
  const [form, setForm] = useState<Record<string, string>>({})
  const [sortKey, setSortKey] = useState('value_1')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const limit = 20
  const totalPages = Math.max(1, Math.ceil(total / limit))

  useEffect(() => {
    try {
      const user = JSON.parse(localStorage.getItem('user') || '{}') as { role?: string }
      setIsAdmin(String(user.role || '').toUpperCase() === 'ADMIN')
    } catch {
      setIsAdmin(false)
    }
  }, [])

  const fetchRows = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.get(`/master-references/${kind}`, {
        params: { page, limit, search: debouncedSearch },
      })
      setItems(res.data?.data?.items || [])
      setTotal(Number(res.data?.data?.total || 0))
    } catch (error) {
      console.error('Load master reference error', error)
      setItems([])
      setTotal(0)
    } finally {
      setLoading(false)
    }
  }, [kind, page, debouncedSearch])

  useEffect(() => {
    void fetchRows()
  }, [fetchRows])

  useEffect(() => {
    setPage(1)
  }, [debouncedSearch])

  const openNew = () => {
    setEditing(null)
    setForm({})
    setOpen(true)
  }

  const openEdit = (row: ReferenceRow) => {
    setEditing(row)
    setForm({
      value_1: row.value_1 || '',
      value_2: row.value_2 || '',
      value_3: row.value_3 || '',
    })
    setOpen(true)
  }

  const save = async () => {
    for (const field of fields) {
      if (field.required && !String(form[field.key] || '').trim()) {
        alert(`${field.label} is required`)
        return
      }
    }
    const payload = {
      value_1: form.value_1 ?? '',
      value_2: form.value_2 ?? '',
      value_3: form.value_3 ?? '',
    }
    try {
      const persist = (overwrite: boolean) => {
        const qs = overwrite ? '?dhmOverwrite=true' : ''
        if (editing) return api.put(`/master-references/${kind}/${editing.id}${qs}`, payload)
        return api.post(`/master-references/${kind}${qs}`, payload)
      }
      if (syncDhm) await saveWithDhmConfirm(persist, dhmNoun)
      else await persist(false)
      setOpen(false)
      await fetchRows()
    } catch (error: unknown) {
      const message =
        (error as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ||
        'Failed to save'
      alert(message)
    }
  }

  const remove = async (row: ReferenceRow) => {
    const label = fields.map((field) => row[field.key]).filter(Boolean).join(' · ')
    if (!confirm(`Delete ${label || row.code_klip}?`)) return
    try {
      await api.delete(`/master-references/${kind}/${row.id}`)
      await fetchRows()
    } catch (error: unknown) {
      const message =
        (error as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ||
        'Failed to delete'
      alert(message)
    }
  }

  return (
    <Layout>
      <StitchFields>
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <p className="text-gray-600">{description}</p>
            {isAdmin ? (
              <Button size="sm" onClick={openNew}>
                <Plus className="h-4 w-4 mr-2" />
                {newLabel}
              </Button>
            ) : null}
          </div>
          <ListFilterPanel
            onReset={() => setSearch('')}
            showReset={search.trim().length > 0}
            chips={
              search.trim()
                ? [{ id: 'search', label: `Search: ${search.trim()}`, onRemove: () => setSearch('') }]
                : []
            }
          >
            <div className={LIST_FILTER_FIELDS_ROW_CLASS}>
              <div className="min-w-[12rem] flex-[1.4]">
                <label className={LIST_FILTER_FIELD_LABEL_CLASS}>Search</label>
                <div className="relative">
                  <StitchSearchIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <Input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Code or name"
                    className="rounded-lg border-slate-200 pl-10 text-slate-700 placeholder:text-slate-400 focus-visible:ring-blue-600"
                  />
                </div>
              </div>
            </div>
          </ListFilterPanel>
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-base">{title}</CardTitle>
                  <p className="mt-1 text-xs text-gray-500">
                    <span className="font-semibold text-gray-700">{total.toLocaleString('en-US')}</span> rows
                    <span className="text-gray-400"> · </span>
                    Page {page}/{totalPages} · {items.length} rows
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <ListPageColumnsMenu
                    columns={layout.menuColumns}
                    visibleIds={layout.visibleIds}
                    disabled={loading}
                    onToggle={layout.toggle}
                    onSelectAll={layout.selectAll}
                    onUnselectAll={layout.unselectAll}
                    onReset={layout.reset}
                    onReorder={layout.reorder}
                  />
                  {totalPages > 1 ? (
                    <div className="ml-1 flex items-center gap-2 border-l border-gray-200 pl-2">
                      <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>
                        Previous
                      </Button>
                      <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((value) => value + 1)}>
                        Next
                      </Button>
                    </div>
                  ) : null}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <MasterListCompactTable
                tightActions
                rows={[...items].sort((a, b) => {
                  const column = columns.find((item) => item.id === sortKey)
                  const cmp = (column?.getText(a) ?? '').localeCompare(column?.getText(b) ?? '', undefined, { numeric: true })
                  return sortDir === 'asc' ? cmp : -cmp
                })}
                columns={columns
                  .filter((column) => layout.orderedVisibleIds.includes(column.id))
                  .sort((a, b) => layout.orderedVisibleIds.indexOf(a.id) - layout.orderedVisibleIds.indexOf(b.id))}
                getRowId={(row) => row.id}
                sortKey={sortKey}
                sortDir={sortDir}
                dragColId={layout.dragColId}
                loading={loading}
                emptyLabel="No rows found"
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
                    editLabel={isAdmin ? 'Edit' : 'View'}
                    deleteLabel="Delete"
                    onEdit={() => openEdit(row)}
                    onDelete={() => void remove(row)}
                  />
                )}
              />
            </CardContent>
          </Card>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogContent className="sm:max-w-xl">
              <DialogHeader>
                <DialogTitle>{editing ? `Edit ${title.replace(/^All /, '')}` : newLabel}</DialogTitle>
              </DialogHeader>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">{codeNoun} Code (KLIP)</label>
                  <Input value={editing?.code_klip || ''} placeholder="Assigned on save" readOnly disabled />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">{codeNoun} Code (DHM)</label>
                  <Input value={editing?.code_dhm || ''} placeholder="-" readOnly disabled />
                </div>
                {fields.map((field) => (
                  <div key={field.key}>
                    <label className="mb-1 block text-sm font-medium text-gray-700">
                      {field.label}
                      {field.required ? <span className="text-red-500"> *</span> : null}
                    </label>
                    <Input
                      value={form[field.key] || ''}
                      onChange={(event) => setForm((prev) => ({ ...prev, [field.key]: event.target.value }))}
                      disabled={!isAdmin}
                    />
                  </div>
                ))}
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setOpen(false)}>
                  {isAdmin ? 'Cancel' : 'Close'}
                </Button>
                {isAdmin ? <Button onClick={() => void save()}>Save</Button> : null}
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </StitchFields>
    </Layout>
  )
}
