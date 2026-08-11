'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import Layout from '@/components/Layout'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import api from '@/lib/api'
import { formatVesselCodeDisplay } from '@/lib/formatVesselCodeDisplay'
import { downloadMasterVesselTemplate } from '@/lib/masterVesselExcelTemplate'
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
import type { MasterVesselColumnId } from '@/lib/masterVesselColumns'
import { Plus, Upload, Download } from 'lucide-react'

interface MasterVessel extends MasterVesselFormData {
  id: string
}

interface JovinImportSummary {
  totalJovinRows: number
  resolvedFromKlip: number
  resolvedFromSap: number
  provisionalInserted: number
  inserted: number
  updated: number
  promoted: number
  pendingOfficialCount: number
  dryRun: boolean
}

const VESSELS_PER_PAGE = 20

const EMPTY_FILTER_OPTIONS: MasterVesselFilterOptions = {
  owners: [],
  vesselTypes: ['BARGE', 'TANKER', 'SPOB'],
  lambungTypes: ['DHDB', 'SHSB', 'SHDB'],
  terms: ['V/C', 'T/C'],
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

  const [modalOpen, setModalOpen] = useState(false)
  const [modalMode, setModalMode] = useState<'create' | 'edit'>('create')
  const [editingVessel, setEditingVessel] = useState<MasterVessel | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [importSummary, setImportSummary] = useState<JovinImportSummary | null>(null)
  const [sortKey, setSortKey] = useState<MasterVesselColumnId>('vessel_name')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  const hasActiveFilters = useMemo(
    () =>
      searchTerm.length > 0 ||
      selectedOwners.length > 0 ||
      selectedVesselTypes.length > 0 ||
      selectedHeating.length > 0 ||
      selectedLambungTypes.length > 0 ||
      selectedTerms.length > 0,
    [
      searchTerm,
      selectedOwners,
      selectedVesselTypes,
      selectedHeating,
      selectedLambungTypes,
      selectedTerms,
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

  const handleExcelUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const dryRun = !confirm('Apply import to database?\n\nOK = Apply\nCancel = Dry-run preview only')
      const formData = new FormData()
      formData.append('file', file)
      const res = await api.post(`/master-vessels/import-jovin?dryRun=${dryRun ? 'false' : 'true'}`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      setImportSummary(res.data?.data ?? null)
      if (!dryRun) {
        void fetchVessels(currentPage)
      }
    } catch (err) {
      console.error('Upload master vessel Excel error', err)
      alert('Failed to import Master Vessel Template.xlsx')
    } finally {
      e.target.value = ''
    }
  }

  const handleDownloadTemplate = async () => {
    try {
      const res = await api.get('/master-vessels', { params: { limit: 100000 } })
      const all: MasterVessel[] = res.data?.data?.items || []
      downloadMasterVesselTemplate(all)
    } catch (err) {
      console.error('Download master vessel template error', err)
      alert('Failed to download template')
    }
  }

  const handleDelete = async (v: MasterVessel) => {
    if (!isAdmin) return
    const codeLabel = formatVesselCodeDisplay(v.vessel_code)
    const ok = confirm(`Delete vessel?\n\n${codeLabel} - ${v.vessel_name}`)
    if (!ok) return
    try {
      await api.delete(`/master-vessels/${v.id}`)
      await fetchVessels(currentPage)
    } catch (err: unknown) {
      console.error('Delete master vessel error', err)
      const msg =
        (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error
          ?.message || 'Failed to delete master vessel'
      alert(msg)
    }
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
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Master Vessel</h1>
            <p className="text-gray-600 mt-2">
              Maintain reference data for vessels used in shipments.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => document.getElementById('master-vessel-excel-upload')?.click()}>
              <Upload className="h-4 w-4 mr-2" />
              Upload Excel
            </Button>
            <input
              id="master-vessel-excel-upload"
              type="file"
              accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
              className="hidden"
              onChange={handleExcelUpload}
            />
            <Button variant="outline" size="sm" onClick={handleDownloadTemplate}>
              <Download className="h-4 w-4 mr-2" />
              Download Template
            </Button>
            {isAdmin ? (
              <Button size="sm" onClick={openNew}>
                <Plus className="h-4 w-4 mr-2" />
                New Vessel
              </Button>
            ) : null}
          </div>
        </div>

        {importSummary && (
          <Card>
            <CardHeader>
              <CardTitle>Excel Import {importSummary.dryRun ? '(Dry Run)' : 'Summary'}</CardTitle>
            </CardHeader>
            <CardContent className="text-sm space-y-1">
              <p>Total Jovin rows: {importSummary.totalJovinRows}</p>
              <p>Resolved from KLIP: {importSummary.resolvedFromKlip}</p>
              <p>Resolved from SAP: {importSummary.resolvedFromSap}</p>
              <p>Pending official code: {importSummary.pendingOfficialCount}</p>
              <p>Inserted: {importSummary.inserted} · Updated: {importSummary.updated} · Promoted: {importSummary.promoted}</p>
            </CardContent>
          </Card>
        )}

        <MasterVesselGlobalFiltersSection
          searchDraft={searchDraft}
          onSearchDraftChange={setSearchDraft}
          onSearchApply={applySearch}
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
          hasActiveFilters={hasActiveFilters}
          onClearFilters={clearFilters}
        />

        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <CardTitle>All Vessel</CardTitle>
                <p className="text-xs text-gray-500 mt-1">
                  {total.toLocaleString('en-US')} vessels · Page {currentPage}/{totalPages} · {items.length} rows
                </p>
              </div>
              {renderPagination()}
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
              onDelete={handleDelete}
            />
            {totalPages > 1 && (
              <div className="flex items-center justify-end mt-4">{renderPagination()}</div>
            )}
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
    </Layout>
  )
}
