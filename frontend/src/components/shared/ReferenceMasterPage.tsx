'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Cloud, CloudOff, Layers, Pencil, Plus, Route } from 'lucide-react'
import Layout from '@/components/Layout'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { ICON_BUTTON_CLASS } from '@/lib/iconButton'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { StitchFields } from '@/components/shared/stitchField'
import { MasterCodeBadge } from '@/components/shared/MasterCodeBadge'
import { MasterDhmSyncButton } from '@/components/shared/MasterDhmSyncButton'
import { MasterKpis, type MasterKpiItem } from '@/components/master/MasterKpis'
import { MasterFilterBar } from '@/components/master/MasterFilterBar'
import { MasterTableFooter } from '@/components/master/MasterTableFooter'
import { MasterDhmChip, MasterIdentityCell, MasterListTable, type MasterTableColumn } from '@/components/master/MasterListTable'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { saveWithDhmConfirm } from '@/lib/dhmMasterSave'
import { masterCountText, masterDhmChip, type MasterDhmFilter } from '@/lib/masterDirectory'

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
  dhm_id?: string | null
  dhm_push_status?: string | null
  dhm_push_error?: string | null
  dhm_push_attempts?: number | null
  dhm_push_next_attempt_at?: string | null
}

interface ReferenceSummary {
  total: number
  synced: number
  notSynced: number
  failed: number
  usedInKlip: number
  dhm: boolean
}

interface ReferenceMasterPageProps {
  kind: string
  title: string
  description: string
  newLabel: string
  fields: ReferenceField[]
  /** Kept so the page files do not change: the Users-style layout has no column picker, so there is nothing to remember. */
  storageKey?: string
  codeNoun: string
  syncDhm?: boolean
  dhmNoun?: string
  dhmSyncMaster?: string
  lockedFields?: Array<{ id: string; label: string; value: string }>
}

const EMPTY_LOCKED_FIELDS: NonNullable<ReferenceMasterPageProps['lockedFields']> = []
const PAGE_SIZE = 20

/** What "Used in KLIP" counts for each reference master (the API judges it; this is the one line under the number). */
const USED_HINT: Record<string, string> = {
  incoterm: 'on a contract',
  ext_company: 'is the supplier of a contract',
  truck_transporter: 'owns a trucking operation',
}

function clean(value: string | null | undefined): string {
  return String(value ?? '').trim()
}

export function ReferenceMasterPage({
  kind,
  title,
  description,
  newLabel,
  fields,
  codeNoun,
  syncDhm = false,
  dhmNoun = 'record',
  dhmSyncMaster,
  lockedFields = EMPTY_LOCKED_FIELDS,
}: ReferenceMasterPageProps) {
  const noun = title.replace(/^All /, '')
  // The row's name is the field the form requires (Company Name on External Company), else the first field; the others are the quiet line under it.
  const nameKey = (fields.find((field) => field.required) ?? fields[0])?.key ?? 'value_1'
  const otherKeys = fields.filter((field) => field.key !== nameKey).map((field) => field.key)

  const [items, setItems] = useState<ReferenceRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [dhm, setDhm] = useState<MasterDhmFilter>('all')
  const debouncedSearch = useDebouncedValue(search.trim(), 300)
  const [loading, setLoading] = useState(false)
  const [summary, setSummary] = useState<ReferenceSummary | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<ReferenceRow | null>(null)
  const [form, setForm] = useState<Record<string, string>>({})
  const [sortKey, setSortKey] = useState('name')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

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
        params: { page, limit: PAGE_SIZE, search: debouncedSearch, ...(syncDhm && dhm !== 'all' ? { dhm } : {}) },
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
  }, [kind, page, debouncedSearch, dhm, syncDhm])

  const fetchSummary = useCallback(async () => {
    try {
      const res = await api.get(`/master-references/${kind}/summary`)
      setSummary(res.data?.data ?? null)
    } catch (error) {
      // the cards are informational: the list still works without them
      console.error('Load master reference summary error', error)
    }
  }, [kind])

  useEffect(() => {
    void fetchRows()
  }, [fetchRows])

  useEffect(() => {
    void fetchSummary()
  }, [fetchSummary])

  useEffect(() => {
    setPage(1)
  }, [debouncedSearch])

  const refresh = async () => {
    await Promise.all([fetchRows(), fetchSummary()])
  }

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
      await refresh()
    } catch (error: unknown) {
      const message =
        (error as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ||
        'Failed to save'
      alert(message)
    }
  }

  const nameOf = useCallback((row: ReferenceRow) => clean(row[nameKey]), [nameKey])
  const subtitleOf = useCallback(
    (row: ReferenceRow) => otherKeys.map((key) => clean(row[key])).filter(Boolean).join(' · '),
    [otherKeys],
  )

  const sortedRows = useMemo(() => {
    const text = (row: ReferenceRow): string => (sortKey === 'dhm' ? masterDhmChip(row).label : sortKey === 'code' ? clean(row.code_klip) : nameOf(row))
    return [...items].sort((a, b) => {
      const cmp = text(a).localeCompare(text(b), undefined, { numeric: true })
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [items, sortKey, sortDir, nameOf])

  const columns: MasterTableColumn<ReferenceRow>[] = [
    {
      id: 'name',
      label: fields.find((field) => field.key === nameKey)?.label ?? 'Name',
      sortable: true,
      render: (row) => <MasterIdentityCell name={nameOf(row)} subtitle={subtitleOf(row) || undefined} />,
    },
    {
      id: 'code',
      label: 'Codes',
      sortable: true,
      className: 'whitespace-nowrap',
      render: (row) => (
        <div className="flex flex-wrap items-center gap-1.5">
          <MasterCodeBadge kind="klip" value={row.code_klip || ''} fit />
          {syncDhm ? <MasterCodeBadge kind="dhm" value={row.code_dhm || ''} fit /> : null}
        </div>
      ),
    },
    ...lockedFields.map((field) => ({
      id: field.id,
      label: field.label,
      className: 'whitespace-nowrap',
      render: () => (
        <span className="inline-block whitespace-nowrap rounded-md border border-slate-200 bg-slate-100 px-2 py-0.5 text-xs leading-4 text-slate-600">{field.value}</span>
      ),
    })),
    ...(syncDhm
      ? [{ id: 'dhm', label: 'DHM', sortable: true, className: 'whitespace-nowrap', render: (row: ReferenceRow) => <MasterDhmChip row={row} /> }]
      : []),
  ]

  const kpis: MasterKpiItem[] = [
    { id: 'total', icon: <Layers className="h-4 w-4" />, label: `Total ${noun.toLowerCase()}`, value: summary?.total ?? null, tone: 'bg-blue-50 text-blue-600', hint: 'all rows' },
    ...(syncDhm
      ? [
          { id: 'synced', icon: <Cloud className="h-4 w-4" />, label: 'Synced to DHM', value: summary?.synced ?? null, tone: 'bg-emerald-50 text-emerald-600', hint: 'DHM has them' },
          {
            id: 'not-synced',
            icon: <CloudOff className="h-4 w-4" />,
            label: 'Not synced',
            value: summary?.notSynced ?? null,
            tone: 'bg-amber-50 text-amber-600',
            hint: summary && summary.failed > 0 ? `${summary.failed.toLocaleString('en-US')} more failed to deliver` : 'not in DHM yet',
          },
        ]
      : []),
    { id: 'used', icon: <Route className="h-4 w-4" />, label: 'Used in KLIP', value: summary?.usedInKlip ?? null, tone: 'bg-violet-50 text-violet-600', hint: USED_HINT[kind] ?? 'referenced by KLIP data' },
  ]

  const filtersOn = search.trim() !== '' || (syncDhm && dhm !== 'all')

  return (
    <Layout>
      <StitchFields>
        <div className="space-y-6">
          <p className="text-sm text-gray-500">{description}</p>

          <MasterKpis items={kpis} />

          <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
            <MasterFilterBar
              search={search}
              onSearch={(value) => {
                setSearch(value)
                setPage(1)
              }}
              placeholder={`Search ${codeNoun.toLowerCase()} code or name`}
              ariaLabel={`Search ${noun.toLowerCase()}`}
              dhm={syncDhm ? dhm : undefined}
              onDhm={
                syncDhm
                  ? (value) => {
                      setDhm(value)
                      setPage(1)
                    }
                  : undefined
              }
              dhmCounts={syncDhm && summary ? { all: summary.total, synced: summary.synced, not_synced: summary.notSynced, failed: summary.failed } : undefined}
              onClear={() => {
                setSearch('')
                setDhm('all')
                setPage(1)
              }}
              actions={
                isAdmin ? (
                  <>
                    {dhmSyncMaster ? <MasterDhmSyncButton master={dhmSyncMaster} onDone={() => void refresh()} iconOnly /> : null}
                    <Button variant="outline" size="icon" className={ICON_BUTTON_CLASS} title={newLabel} aria-label={newLabel} onClick={openNew}>
                      <Plus className="h-4 w-4" aria-hidden />
                    </Button>
                  </>
                ) : null
              }
            />

            <MasterListTable
              rows={sortedRows}
              columns={columns}
              getRowId={(row) => row.id}
              loading={loading}
              emptyLabel={filtersOn ? 'No rows match these filters' : 'No rows yet'}
              sortKey={sortKey}
              sortDir={sortDir}
              onSort={(id) => {
                setSortDir((dir) => (sortKey === id ? (dir === 'asc' ? 'desc' : 'asc') : 'asc'))
                setSortKey(id)
              }}
              onRowClick={openEdit}
              minWidthPx={640}
              renderActions={(row) => (
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8 border-transparent bg-transparent text-blue-600 hover:bg-blue-50"
                  title={isAdmin ? 'Edit' : 'View'}
                  aria-label={`${isAdmin ? 'Edit' : 'View'} ${nameOf(row) || codeNoun}`}
                  onClick={() => openEdit(row)}
                >
                  <Pencil className="h-4 w-4" />
                </Button>
              )}
            />

            <MasterTableFooter
              countText={`${masterCountText(items.length, total, summary?.total ?? total, noun.toLowerCase())} · click a row to ${isAdmin ? 'edit' : 'view'} it`}
              kinds={syncDhm ? ['klip', 'dhm'] : ['klip']}
              pager={{ page: page, totalPages: totalPages, onPageChange: setPage, disabled: loading }}
            />
          </div>

          <Dialog open={open} onOpenChange={setOpen}>
            <DialogContent className="sm:max-w-xl">
              <DialogHeader>
                <DialogTitle>{editing ? `Edit ${noun}` : newLabel}</DialogTitle>
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
                {lockedFields.map((field) => (
                  <div key={field.id}>
                    <label className="mb-1 block text-sm font-medium text-gray-700">{field.label}</label>
                    <Input value={field.value} readOnly disabled />
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
