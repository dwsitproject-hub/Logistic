'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import Layout from '@/components/Layout'
import { StitchFields } from '@/components/shared/stitchField'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import api from '@/lib/api'
import {
  EditVesselModal,
  type MasterVesselFormData,
} from '@/components/master-vessel/EditVesselModal'
import {
  heatingFilterToApi,
  MasterVesselGlobalFiltersSection,
  termsFilterToApi,
  type MasterVesselFilterOptions,
} from '@/components/master-vessel/MasterVesselGlobalFiltersSection'
import { MasterVesselTable } from '@/components/master-vessel/MasterVesselTable'
import { ListPageColumnsMenu } from '@/components/shared/ListPageColumnsMenu'
import { MasterDhmSyncButton } from '@/components/shared/MasterDhmSyncButton'
import { MASTER_VESSEL_COLUMNS, type MasterVesselColumnId } from '@/lib/masterVesselColumns'
import { useListColumnLayout } from '@/lib/listColumnLayout'
import { Plus } from 'lucide-react'

const VESSEL_LAYOUT_COLUMNS = MASTER_VESSEL_COLUMNS.map((col) => ({ id: col.id, label: col.label }))

interface MasterVessel extends MasterVesselFormData {
  id: string
}

const VESSELS_PER_PAGE = 20

const EMPTY_FILTER_OPTIONS: MasterVesselFilterOptions = {
  owners: [],
  vesselTypes: ['BARGE', 'TANKER', 'SPOB', 'TUG BOAT'],
  lambungTypes: ['DHDB', 'SHSB', 'SHDB'],
  terms: ['T/C', 'V/C', 'CIF'],
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
  const [selectedHeating, setSelectedHeating] = useState<string[]>([])
  const [selectedLambungTypes, setSelectedLambungTypes] = useState<string[]>([])
  const [selectedTerms, setSelectedTerms] = useState<string[]>([])
  const [selectedKlipTransaction, setSelectedKlipTransaction] = useState<string[]>([])

  const [modalOpen, setModalOpen] = useState(false)
  const [modalMode, setModalMode] = useState<'create' | 'edit'>('create')
  const [editingVessel, setEditingVessel] = useState<MasterVessel | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [sortKey, setSortKey] = useState<MasterVesselColumnId>('vessel_name')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const vesselColumns = useListColumnLayout('master-vessel.visibleColumns.v1', VESSEL_LAYOUT_COLUMNS)

  const hasActiveFilters = useMemo(
    () =>
      searchTerm.length > 0 ||
      selectedOwners.length > 0 ||
      selectedVesselTypes.length > 0 ||
      selectedHeating.length > 0 ||
      selectedLambungTypes.length > 0 ||
      selectedTerms.length > 0 ||
      selectedKlipTransaction.length > 0,
    [
      searchTerm,
      selectedOwners,
      selectedVesselTypes,
      selectedHeating,
      selectedLambungTypes,
      selectedTerms,
      selectedKlipTransaction,
    ],
  )

  const fetchVessels = useCallback(
    async (page = 1) => {
      try {
        setLoading(true)
        const params: Record<string, unknown> = {
          page,
          limit: VESSELS_PER_PAGE,
        }
        if (searchTerm.length >= 2) params.search = searchTerm
        if (selectedOwners.length) params.owners = selectedOwners
        if (selectedVesselTypes.length) params.vesselTypes = selectedVesselTypes
        if (selectedHeating.length) params.heating = heatingFilterToApi(selectedHeating)
        if (selectedLambungTypes.length) params.lambungTypes = selectedLambungTypes
        if (selectedTerms.length) params.terms = termsFilterToApi(selectedTerms)
        if (selectedKlipTransaction.length) params.klipTransaction = heatingFilterToApi(selectedKlipTransaction)
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
    [
      searchTerm,
      selectedOwners,
      selectedVesselTypes,
      selectedHeating,
      selectedLambungTypes,
      selectedTerms,
      selectedKlipTransaction,
      sortKey,
      sortDir,
    ],
  )

  useEffect(() => {
    try {
      const u = JSON.parse(localStorage.getItem('user') || 'null')
      setIsAdmin(String(u?.role || '').toUpperCase() === 'ADMIN')
    } catch {
      setIsAdmin(false)
    }
  }, [])

  useEffect(() => {
    void api
      .get('/master-vessels/filter-options')
      .then((res) => {
        const data = res.data?.data
        if (data) {
          setFilterOptions({
            owners: data.owners ?? [],
            vesselTypes: data.vesselTypes ?? EMPTY_FILTER_OPTIONS.vesselTypes,
            lambungTypes: data.lambungTypes ?? EMPTY_FILTER_OPTIONS.lambungTypes,
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
  }, [
    searchTerm,
    selectedOwners,
    selectedVesselTypes,
    selectedHeating,
    selectedLambungTypes,
    selectedTerms,
    selectedKlipTransaction,
    sortKey,
    sortDir,
    fetchVessels,
  ])

  const handleSortChange = (colId: MasterVesselColumnId) => {
    setSortDir((prev) => (sortKey === colId ? (prev === 'asc' ? 'desc' : 'asc') : 'asc'))
    setSortKey(colId)
  }

  const applySearch = () => {
    setSearchTerm(searchDraft.trim().length >= 2 ? searchDraft.trim() : '')
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
    setSelectedHeating([])
    setSelectedLambungTypes([])
    setSelectedTerms([])
    setSelectedKlipTransaction([])
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

  const renderPagination = () => {
    if (totalPages <= 1) return null
    return (
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => handlePageChange(currentPage - 1)}
          disabled={currentPage <= 1 || loading}
        >
          Previous
        </Button>
        <div className="flex items-center gap-1">
          {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
            let pageNum: number
            if (totalPages <= 5) {
              pageNum = i + 1
            } else if (currentPage <= 3) {
              pageNum = i + 1
            } else if (currentPage >= totalPages - 2) {
              pageNum = totalPages - 4 + i
            } else {
              pageNum = currentPage - 2 + i
            }
            return (
              <Button
                key={pageNum}
                variant={currentPage === pageNum ? 'default' : 'outline'}
                size="sm"
                onClick={() => handlePageChange(pageNum)}
                disabled={loading}
                className="min-w-[40px]"
              >
                {pageNum}
              </Button>
            )
          })}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => handlePageChange(currentPage + 1)}
          disabled={currentPage >= totalPages || loading}
        >
          Next
        </Button>
      </div>
    )
  }

  return (
    <Layout>
      <StitchFields>
      <div className="space-y-6">
        <p className="text-gray-600">
          Maintain reference data for vessels used in shipments.
        </p>

        <MasterVesselGlobalFiltersSection
          searchDraft={searchDraft}
          searchTerm={searchTerm}
          onSearchDraftChange={setSearchDraft}
          onSearchApply={applySearch}
          onSearchClear={() => {
            setSearchDraft('')
            setSearchTerm('')
          }}
          filterOptions={filterOptions}
          selectedOwners={selectedOwners}
          onOwnersChange={setSelectedOwners}
          selectedVesselTypes={selectedVesselTypes}
          onVesselTypesChange={setSelectedVesselTypes}
          selectedHeating={selectedHeating}
          onHeatingChange={setSelectedHeating}
          selectedLambungTypes={selectedLambungTypes}
          onLambungTypesChange={setSelectedLambungTypes}
          selectedTerms={selectedTerms}
          onTermsChange={setSelectedTerms}
          selectedKlipTransaction={selectedKlipTransaction}
          onKlipTransactionChange={setSelectedKlipTransaction}
          hasActiveFilters={hasActiveFilters}
          onClearFilters={clearFilters}
          action={
            isAdmin ? (
              <div className="flex shrink-0 items-end gap-2">
                <Button size="sm" className="shrink-0" onClick={openNew}>
                  <Plus className="h-4 w-4 mr-2" />
                  New Vessel
                </Button>
                <MasterDhmSyncButton master="vessel" onDone={() => void fetchVessels(currentPage)} />
              </div>
            ) : null
          }
        />

        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <CardTitle className="text-base flex items-center gap-2 flex-wrap">
                  <span>All Vessel</span>
                </CardTitle>
                <p className="text-xs text-gray-500 mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0 max-w-full">
                  <span className="whitespace-nowrap tabular-nums text-gray-700">
                    <span className="font-semibold">{total.toLocaleString('en-US')}</span> vessels
                  </span>
                  <span className="text-gray-400" aria-hidden>·</span>
                  <span className="whitespace-nowrap tabular-nums">
                    Page {currentPage}/{totalPages} · {items.length} rows
                  </span>
                </p>
              </div>
              <div className="flex items-center gap-2">
                <ListPageColumnsMenu
                  columns={vesselColumns.menuColumns}
                  visibleIds={vesselColumns.visibleIds}
                  disabled={loading}
                  onToggle={vesselColumns.toggle}
                  onSelectAll={vesselColumns.selectAll}
                  onUnselectAll={vesselColumns.unselectAll}
                  onReset={vesselColumns.reset}
                  onReorder={vesselColumns.reorder}
                />
                {renderPagination()}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <MasterVesselTable
              items={items}
              loading={loading}
              sortKey={sortKey}
              sortDir={sortDir}
              isAdmin={isAdmin}
              onSortChange={handleSortChange}
              onEdit={openEdit}
              columnIds={vesselColumns.orderedVisibleIds as MasterVesselColumnId[]}
              dragColId={vesselColumns.dragColId}
              onColumnDragStart={(id) => vesselColumns.setDragColId(id)}
              onColumnDragEnd={() => vesselColumns.setDragColId(null)}
              onColumnDrop={(id) => {
                if (vesselColumns.dragColId) vesselColumns.reorder(vesselColumns.dragColId, id)
                vesselColumns.setDragColId(null)
              }}
            />
          </CardContent>
        </Card>

        <EditVesselModal
          open={modalOpen}
          mode={modalMode}
          vessel={editingVessel}
          isAdmin={isAdmin}
          onClose={() => {
            setModalOpen(false)
            setEditingVessel(null)
          }}
          onSaved={() => void fetchVessels(currentPage)}
        />
      </div>
      </StitchFields>
    </Layout>
  )
}
