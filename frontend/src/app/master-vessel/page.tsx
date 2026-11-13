'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Anchor, Cloud, CloudOff, Pencil, Plus, Ship } from 'lucide-react'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import Layout from '@/components/Layout'
import { StitchFields } from '@/components/shared/stitchField'
import { Button } from '@/components/ui/button'
import { iconButtonClass } from '@/lib/iconButton'
import api from '@/lib/api'
import { EditVesselModal, type MasterVesselFormData } from '@/components/master-vessel/EditVesselModal'
import { heatingFilterToApi, termsFilterToApi, type MasterVesselFilterOptions } from '@/components/master-vessel/MasterVesselGlobalFiltersSection'
import { KlipTransactionBadge } from '@/components/master-vessel/KlipTransactionBadge'
import { MasterVesselReviewPanel } from '@/components/master-vessel/MasterVesselReviewPanel'
import { SearchableMultiSelect } from '@/components/SearchableMultiSelect'
import { MasterCodeBadge } from '@/components/shared/MasterCodeBadge'
import { MasterDhmSyncButton } from '@/components/shared/MasterDhmSyncButton'
import { MultiValueCell } from '@/components/shared/MultiValueCell'
import { MasterKpis } from '@/components/master/MasterKpis'
import { MasterFilterBar } from '@/components/master/MasterFilterBar'
import { MasterTableFooter } from '@/components/master/MasterTableFooter'
import { MasterDhmChip, MasterIdentityCell, MasterListTable, type MasterTableColumn } from '@/components/master/MasterListTable'
import { formatVesselCapacity, formatVesselMetres } from '@/lib/masterVesselColumns'
import { masterCountText, type MasterDhmFilter } from '@/lib/masterDirectory'
import { multiValuesOf } from '@/lib/multiValueCell'

interface MasterVessel extends MasterVesselFormData {
  id: string
  pair_code?: string | null
}

interface VesselSummary {
  total: number
  synced: number
  notSynced: number
  failed: number
  usedInKlip: number
}

const VESSELS_PER_PAGE = 20

const EMPTY_FILTER_OPTIONS: MasterVesselFilterOptions = {
  owners: [],
  vesselTypes: ['BARGE', 'TANKER', 'SPOB', 'TUG BOAT'],
  terms: ['T/C', 'V/C', 'CIF'],
}

const TERMS_FILTER_OPTIONS = ['T/C', 'V/C', 'CIF', '(Blank)']
const KLIP_TRANSACTION_FILTER_OPTIONS = ['Yes', 'No']

/** A multi-select that looks like the Select next to it in the filter row: one 36px field, the name as the placeholder. */
const FILTER_BUTTON_CLASS =
  'w-full flex items-center justify-between gap-2 h-9 px-3 text-left text-sm border border-gray-300 rounded-md bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1'

type VesselSortKey = 'vessel_name' | 'vessel_code' | 'vessel_codes_sap' | 'vessel_type' | 'vessel_capacity_mt' | 'klip_transaction' | 'dhm_status'

function ownerLine(row: MasterVessel): string {
  const owner = row.vessel_owner?.trim()
  const code = row.sap_vendor_code?.trim()
  if (owner && code) return `${owner} · ${code}`
  return owner || code || 'No owner yet'
}

function typeLine(row: MasterVessel): string {
  return [row.terms, row.lambung_type].filter(Boolean).join(' · ') || 'No charter type'
}

function specsLine(row: MasterVessel): string {
  const parts: string[] = []
  if (row.vessel_draft != null && String(row.vessel_draft).trim() !== '') parts.push(`Draft ${formatVesselMetres(row.vessel_draft)} m`)
  if (row.vessel_length_overall) parts.push(`LOA ${formatVesselMetres(row.vessel_length_overall)} m`)
  if (row.vessel_hull_type) parts.push(row.vessel_hull_type)
  if (row.vessel_registration_year != null) parts.push(String(row.vessel_registration_year))
  return parts.join(' · ') || 'No dimensions yet'
}

export default function MasterVesselPage() {
  const [items, setItems] = useState<MasterVessel[]>([])
  const [loading, setLoading] = useState(false)
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [currentPage, setCurrentPage] = useState(1)

  const [searchDraft, setSearchDraft] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const debouncedSearchDraft = useDebouncedValue(searchDraft.trim(), 300)

  const [filterOptions, setFilterOptions] = useState<MasterVesselFilterOptions>(EMPTY_FILTER_OPTIONS)
  const [selectedOwners, setSelectedOwners] = useState<string[]>([])
  const [selectedVesselTypes, setSelectedVesselTypes] = useState<string[]>([])
  const [selectedTerms, setSelectedTerms] = useState<string[]>([])
  const [selectedKlipTransaction, setSelectedKlipTransaction] = useState<string[]>([])
  const [dhm, setDhm] = useState<MasterDhmFilter>('all')
  const [summary, setSummary] = useState<VesselSummary | null>(null)

  const [modalOpen, setModalOpen] = useState(false)
  const [modalMode, setModalMode] = useState<'create' | 'edit'>('create')
  const [editingVessel, setEditingVessel] = useState<MasterVessel | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  // "Perlu review": vessels KLIP registered from a SAP name and is not sure of (the badge counts them)
  const [view, setView] = useState<'all' | 'review'>('all')
  const [reviewCount, setReviewCount] = useState(0)
  const [sortKey, setSortKey] = useState<VesselSortKey>('vessel_name')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  const extraFiltersOn =
    selectedOwners.length > 0 || selectedVesselTypes.length > 0 || selectedTerms.length > 0 || selectedKlipTransaction.length > 0
  const filtersOn = searchTerm.length > 0 || extraFiltersOn || dhm !== 'all'

  const fetchVessels = useCallback(
    async (page = 1) => {
      try {
        setLoading(true)
        const params: Record<string, unknown> = { page, limit: VESSELS_PER_PAGE }
        if (searchTerm.length >= 2) params.search = searchTerm
        if (selectedOwners.length) params.owners = selectedOwners
        if (selectedVesselTypes.length) params.vesselTypes = selectedVesselTypes
        if (selectedTerms.length) params.terms = termsFilterToApi(selectedTerms)
        if (selectedKlipTransaction.length) params.klipTransaction = heatingFilterToApi(selectedKlipTransaction)
        if (dhm !== 'all') params.dhm = dhm
        params.sortKey = sortKey
        params.sortDir = sortDir

        const res = await api.get('/master-vessels', { params })
        const pagination = res.data?.data?.pagination
        setItems(res.data?.data?.items || [])
        setTotal(Number(pagination?.total ?? 0))
        setTotalPages(Math.max(1, Number(pagination?.totalPages ?? 1)))
        setCurrentPage(Number(pagination?.page ?? page))
      } catch (err) {
        console.error('Failed to load master vessels', err)
        alert('Failed to load master vessels')
      } finally {
        setLoading(false)
      }
    },
    [searchTerm, selectedOwners, selectedVesselTypes, selectedTerms, selectedKlipTransaction, dhm, sortKey, sortDir],
  )

  const fetchSummary = useCallback(async () => {
    try {
      const res = await api.get('/master-vessels/summary')
      setSummary(res.data?.data ?? null)
    } catch (err) {
      // the cards are informational: the list still works without them
      console.error('Failed to load the vessel summary', err)
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

  const refreshReviewCount = useCallback(() => {
    void api
      .get('/master-vessels/review')
      .then((res) => setReviewCount(Number(res.data?.data?.total ?? 0)))
      .catch(() => setReviewCount(0))
  }, [])

  useEffect(() => {
    refreshReviewCount()
  }, [refreshReviewCount])

  useEffect(() => {
    void fetchSummary()
  }, [fetchSummary])

  useEffect(() => {
    void api
      .get('/master-vessels/filter-options')
      .then((res) => {
        const data = res.data?.data
        if (data) {
          setFilterOptions({
            owners: data.owners ?? [],
            vesselTypes: data.vesselTypes ?? EMPTY_FILTER_OPTIONS.vesselTypes,
            terms: data.terms ?? EMPTY_FILTER_OPTIONS.terms,
          })
        }
      })
      .catch((err) => console.error('Failed to load filter options', err))
  }, [])

  useEffect(() => {
    setSearchTerm(debouncedSearchDraft.length >= 2 ? debouncedSearchDraft : '')
  }, [debouncedSearchDraft])

  useEffect(() => {
    void fetchVessels(1)
  }, [searchTerm, selectedOwners, selectedVesselTypes, selectedTerms, selectedKlipTransaction, dhm, sortKey, sortDir, fetchVessels])

  const refresh = () => {
    void fetchVessels(currentPage)
    void fetchSummary()
  }

  const handleSortChange = (colId: string) => {
    const id = colId as VesselSortKey
    setSortDir((prev) => (sortKey === id ? (prev === 'asc' ? 'desc' : 'asc') : 'asc'))
    setSortKey(id)
  }

  const handlePageChange = (newPage: number) => {
    if (newPage >= 1 && newPage <= totalPages) {
      void fetchVessels(newPage)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }

  const clearFilters = () => {
    setSearchDraft('')
    setSearchTerm('')
    setSelectedOwners([])
    setSelectedVesselTypes([])
    setSelectedTerms([])
    setSelectedKlipTransaction([])
    setDhm('all')
  }

  // the Edit button lives in the All Vessel list: show the vessel there
  const openInList = (vesselName: string) => {
    setSearchDraft(vesselName)
    setSearchTerm(vesselName.trim().length >= 2 ? vesselName.trim() : '')
    setView('all')
  }

  const openNew = () => {
    setModalMode('create')
    setEditingVessel(null)
    setModalOpen(true)
  }

  const openEdit = (v: MasterVessel) => {
    setModalMode('edit')
    setEditingVessel(v)
    setModalOpen(true)
  }

  const termOptions = useMemo(
    () => [...TERMS_FILTER_OPTIONS, ...filterOptions.terms.filter((t) => t !== 'T/C' && t !== 'V/C' && t !== 'CIF')],
    [filterOptions.terms],
  )

  const columns: MasterTableColumn<MasterVessel>[] = [
    {
      id: 'vessel_name',
      label: 'Vessel',
      sortable: true,
      render: (row) => <MasterIdentityCell name={row.vessel_name} subtitle={ownerLine(row)} />,
    },
    {
      id: 'vessel_code',
      label: 'Codes',
      sortable: true,
      className: 'whitespace-nowrap',
      render: (row) => (
        <div className="flex flex-wrap items-center gap-1.5">
          <MasterCodeBadge kind="klip" value={row.vessel_code_klip || ''} fit />
          {row.dhm_code ? <MasterCodeBadge kind="dhm" value={row.dhm_code} fit /> : null}
          {row.pair_code ? <MasterCodeBadge kind="pair" value={row.pair_code} fit /> : null}
        </div>
      ),
    },
    {
      id: 'vessel_codes_sap',
      label: 'SAP codes',
      sortable: true,
      className: 'whitespace-nowrap',
      render: (row) => (
        <MultiValueCell values={multiValuesOf(null, row.vessel_codes_sap)} rowTitle={row.vessel_name} columnLabel="Vessel Code SAP" plural="SAP codes" />
      ),
    },
    {
      id: 'vessel_type',
      label: 'Type',
      sortable: true,
      render: (row) => (
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-gray-900">{row.vessel_type || '-'}</div>
          <div className="truncate text-xs text-gray-500">{typeLine(row)}</div>
        </div>
      ),
    },
    {
      id: 'vessel_capacity_mt',
      label: 'Capacity',
      sortable: true,
      render: (row) => {
        const line = specsLine(row)
        return (
          <div className="min-w-0 max-w-[16rem]">
            <div className="truncate text-sm font-medium tabular-nums text-gray-900">
              {formatVesselCapacity(row.vessel_capacity_mt)}
              {row.vessel_capacity_mt != null ? ' MT' : ''}
              {row.heating ? <span className="ml-2 rounded-full bg-orange-50 px-2 py-0.5 text-[0.6875rem] font-medium text-orange-700">Heating</span> : null}
            </div>
            <div className="truncate text-xs text-gray-500" title={line}>
              {line}
            </div>
          </div>
        )
      },
    },
    { id: 'klip_transaction', label: 'In KLIP', sortable: true, className: 'whitespace-nowrap', render: (row) => <KlipTransactionBadge value={row.klip_transaction} /> },
    { id: 'dhm_status', label: 'DHM', sortable: true, className: 'whitespace-nowrap', render: (row) => <MasterDhmChip row={row} /> },
  ]

  const kpis = [
    { id: 'total', icon: <Ship className="h-4 w-4" />, label: 'Total vessels', value: summary?.total ?? null, tone: 'bg-blue-50 text-blue-600', hint: 'all master vessels' },
    { id: 'synced', icon: <Cloud className="h-4 w-4" />, label: 'Synced to DHM', value: summary?.synced ?? null, tone: 'bg-emerald-50 text-emerald-600', hint: 'DHM has them' },
    {
      id: 'not-synced',
      icon: <CloudOff className="h-4 w-4" />,
      label: 'Not synced',
      value: summary?.notSynced ?? null,
      tone: 'bg-amber-50 text-amber-600',
      hint: summary && summary.failed > 0 ? `${summary.failed.toLocaleString('en-US')} more failed to deliver` : 'not in DHM yet',
    },
    { id: 'used', icon: <Anchor className="h-4 w-4" />, label: 'Used in KLIP', value: summary?.usedInKlip ?? null, tone: 'bg-violet-50 text-violet-600', hint: 'on at least one shipment' },
  ]

  return (
    <Layout>
      <StitchFields>
        <div className="space-y-6">
          <div className="flex gap-2 border-b border-gray-200">
            {(
              [
                ['all', 'All Vessel'],
                ['review', reviewCount > 0 ? `Perlu review (${reviewCount})` : 'Perlu review'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setView(id)}
                className={
                  view === id
                    ? '-mb-px border-b-2 border-blue-600 px-3 py-2 text-sm font-medium text-blue-700'
                    : 'px-3 py-2 text-sm text-gray-600 hover:text-gray-900'
                }
              >
                {label}
              </button>
            ))}
          </div>

          {view === 'all' ? (
            <>
              <MasterKpis items={kpis} />

              <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
                <MasterFilterBar
                  search={searchDraft}
                  onSearch={setSearchDraft}
                  placeholder="Search vessel code or name"
                  ariaLabel="Search vessels"
                  dhm={dhm}
                  onDhm={setDhm}
                  dhmCounts={summary ? { all: summary.total, synced: summary.synced, not_synced: summary.notSynced, failed: summary.failed } : undefined}
                  extraActive={extraFiltersOn}
                  onClear={clearFilters}
                  actions={
                    isAdmin ? (
                      <>
                        <MasterDhmSyncButton master="vessel" onDone={refresh} iconOnly />
                        <Button variant="ghost" size="icon" className={iconButtonClass('add')} title="New vessel" aria-label="New vessel" onClick={openNew}>
                          <Plus className="h-4 w-4" aria-hidden />
                        </Button>
                      </>
                    ) : null
                  }
                >
                  <div className="w-[150px] shrink-0">
                  <SearchableMultiSelect
                    label="Owner"
                    hideLabel
                    buttonClassName={FILTER_BUTTON_CLASS}
                    options={filterOptions.owners}
                    selected={selectedOwners}
                    onChange={setSelectedOwners}
                    placeholder="All owners"
                    emptyMessage="No owners"
                    uppercaseOptionLabels
                  />
                  </div>
                  <div className="w-[140px] shrink-0">
                  <SearchableMultiSelect
                    label="Vessel Type"
                    hideLabel
                    buttonClassName={FILTER_BUTTON_CLASS}
                    options={filterOptions.vesselTypes}
                    selected={selectedVesselTypes}
                    onChange={setSelectedVesselTypes}
                    placeholder="All types"
                    emptyMessage="No types"
                  />
                  </div>
                  <div className="w-[150px] shrink-0">
                  <SearchableMultiSelect
                    label="Term / Charter"
                    hideLabel
                    buttonClassName={FILTER_BUTTON_CLASS}
                    options={termOptions}
                    selected={selectedTerms}
                    onChange={setSelectedTerms}
                    placeholder="All charters"
                    emptyMessage="No terms"
                  />
                  </div>
                  <div className="w-[140px] shrink-0">
                  <SearchableMultiSelect
                    label="Klip Transaction"
                    hideLabel
                    buttonClassName={FILTER_BUTTON_CLASS}
                    options={KLIP_TRANSACTION_FILTER_OPTIONS}
                    selected={selectedKlipTransaction}
                    onChange={setSelectedKlipTransaction}
                    placeholder="In KLIP: all"
                    emptyMessage="No options"
                  />
                  </div>
                </MasterFilterBar>

                <MasterListTable
                  rows={items}
                  columns={columns}
                  getRowId={(row) => row.id}
                  loading={loading}
                  emptyLabel={filtersOn ? 'No vessels match these filters' : 'No vessels yet'}
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onSort={handleSortChange}
                  onRowClick={openEdit}
                  minWidthPx={900}
                  renderActions={(row) => (
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-8 w-8 border-transparent bg-transparent text-blue-600 hover:bg-blue-50"
                      title={isAdmin ? 'Edit vessel' : 'View vessel'}
                      aria-label={`${isAdmin ? 'Edit' : 'View'} ${row.vessel_name}`}
                      onClick={() => openEdit(row)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                  )}
                />

                <MasterTableFooter
                  countText={`${masterCountText(items.length, total, summary?.total ?? total, 'vessels')} · click a row to ${isAdmin ? 'edit' : 'view'} it`}
                  kinds={['klip', 'dhm', 'pair']}
                  pager={{ page: currentPage, totalPages: totalPages, onPageChange: handlePageChange, disabled: loading }}
                />
              </div>
            </>
          ) : (
            <MasterVesselReviewPanel
              isAdmin={isAdmin}
              onChanged={() => {
                refreshReviewCount()
                refresh()
              }}
              onOpenInList={openInList}
            />
          )}

          <EditVesselModal
            open={modalOpen}
            mode={modalMode}
            vessel={editingVessel}
            isAdmin={isAdmin}
            onClose={() => {
              setModalOpen(false)
              setEditingVessel(null)
            }}
            onSaved={refresh}
          />
        </div>
      </StitchFields>
    </Layout>
  )
}
