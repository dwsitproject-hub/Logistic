'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Layout from '@/components/Layout'
import api from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { ArrowDown, ArrowUp, Filter, SlidersHorizontal } from 'lucide-react'
import { SearchableMultiSelect } from '@/components/SearchableMultiSelect'

interface ShippingPerformanceRow {
  id: string
  shipment_id: string
  po_number?: string | null
  contract_ext_no?: string | null
  contract_number: string
  sto_number?: string | null
  contract_date?: string | null
  incoterm?: string | null
  product?: string | null
  status?: string | null
  plant_site?: string | null
  vessel_name: string | null
  group_name: string | null
  loading_delta_eta_etr_days: number | null
  loading_delta_eta_etb_days: number | null
  loading_delta_etb_etc_days: number | null
  discharge_delta_eta_etb_days: number | null
  discharge_delta_etb_etc_days: number | null
  total_delta_days: number | null
  cargo_readiness_date?: string | null
  loading_eta_arrival?: string | null
  loading_eta_berthed?: string | null
  loading_eta_completed?: string | null
  discharge_eta_arrival?: string | null
  discharge_eta_berthed?: string | null
  discharge_eta_completed?: string | null
}

type LatePerfNode = {
  key: string
  count: number
  totalDays: number
  children: LatePerfNode[]
}

type ColumnType = 'text' | 'number'

type ColumnDef = {
  key: keyof ShippingPerformanceRow
  label: string
  type: ColumnType
  defaultVisible?: boolean
}

const COLUMN_DEFS: ColumnDef[] = [
  { key: 'shipment_id', label: 'Shipment ID', type: 'text', defaultVisible: true },
  { key: 'vessel_name', label: 'Vessel Name', type: 'text', defaultVisible: true },
  { key: 'group_name', label: 'Group Name', type: 'text', defaultVisible: true },
  { key: 'po_number', label: 'PO No', type: 'text', defaultVisible: false },
  { key: 'contract_ext_no', label: 'Contract Ext No', type: 'text', defaultVisible: false },
  { key: 'contract_number', label: 'Contract No', type: 'text', defaultVisible: false },
  { key: 'sto_number', label: 'STO No', type: 'text', defaultVisible: false },
  { key: 'loading_delta_eta_etr_days', label: 'Loading ETA-ETR', type: 'number', defaultVisible: true },
  { key: 'loading_delta_eta_etb_days', label: 'Loading ETA-ETB', type: 'number', defaultVisible: true },
  { key: 'loading_delta_etb_etc_days', label: 'Loading ETB-ETC', type: 'number', defaultVisible: true },
  { key: 'discharge_delta_eta_etb_days', label: 'Discharge ETA-ETB', type: 'number', defaultVisible: true },
  { key: 'discharge_delta_etb_etc_days', label: 'Discharge ETB-ETC', type: 'number', defaultVisible: true },
  { key: 'total_delta_days', label: 'Total', type: 'number', defaultVisible: true },
]

const COLUMN_MAP = Object.fromEntries(COLUMN_DEFS.map((col) => [col.key, col])) as Record<string, ColumnDef>

function asDisplayValue(value: unknown): string {
  if (value === null || value === undefined) return ''
  return String(value)
}

function NumberCell({ value }: { value: unknown }) {
  if (value === null || value === undefined || value === '') return <span className="text-gray-400">-</span>
  const n = Number(value)
  if (Number.isNaN(n)) return <span className="text-gray-400">-</span>
  return <span>{n}</span>
}

export default function ShippingPerformancePage() {
  const [rows, setRows] = useState<ShippingPerformanceRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showColumnManager, setShowColumnManager] = useState(false)
  const [columnOrder, setColumnOrder] = useState<Array<keyof ShippingPerformanceRow>>(
    COLUMN_DEFS.map((c) => c.key)
  )
  const [visibleColumns, setVisibleColumns] = useState<Record<string, boolean>>(
    Object.fromEntries(COLUMN_DEFS.map((c) => [c.key, c.defaultVisible !== false]))
  )
  const [columnFilters, setColumnFilters] = useState<Record<string, string>>({})
  const [openHeaderFilterId, setOpenHeaderFilterId] = useState<string | null>(null)
  const [draggingColumn, setDraggingColumn] = useState<string | null>(null)
  const [sortBy, setSortBy] = useState<keyof ShippingPerformanceRow>('total_delta_days')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc')
  const columnsMenuRef = useRef<HTMLDivElement | null>(null)
  const headerFilterPopoverRef = useRef<HTMLDivElement | null>(null)
  const [statusFilter, setStatusFilter] = useState<string>('ALL')
  const [selectedIncoterms, setSelectedIncoterms] = useState<string[]>([])
  const [selectedPlantSites, setSelectedPlantSites] = useState<string[]>([])
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date()
    return `${d.getFullYear()}-01-01`
  })
  const [dateTo, setDateTo] = useState(() => {
    const d = new Date()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${d.getFullYear()}-${m}-${day}`
  })
  const [lateOnTimeFilter, setLateOnTimeFilter] = useState<'ALL' | 'LATE' | 'ON_TIME'>('ALL')
  const [lateSelIncoterm, setLateSelIncoterm] = useState<string | null>(null)
  const [lateSelProduct, setLateSelProduct] = useState<string | null>(null)
  const [lateSelPlant, setLateSelPlant] = useState<string | null>(null)

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true)
        const res = await api.get('/shipments/performance')
        setRows(Array.isArray(res.data?.data) ? res.data.data : [])
      } catch (error) {
        console.error('Failed to load shipping performance:', error)
        setRows([])
      } finally {
        setLoading(false)
      }
    }
    fetchData()
  }, [])

  useEffect(() => {
    const onDocClick = (ev: MouseEvent) => {
      const t = ev.target as Node
      if (showColumnManager && columnsMenuRef.current && !columnsMenuRef.current.contains(t)) {
        setShowColumnManager(false)
      }
      if (openHeaderFilterId && headerFilterPopoverRef.current && !headerFilterPopoverRef.current.contains(t)) {
        setOpenHeaderFilterId(null)
      }
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [showColumnManager, openHeaderFilterId])

  const availableIncoterms = useMemo(
    () =>
      [...new Set(rows.map((r) => String(r.incoterm || '').trim() || 'Blank'))].sort((a, b) => a.localeCompare(b)),
    [rows]
  )

  const availablePlantSites = useMemo(
    () =>
      [...new Set(rows.map((r) => String(r.plant_site || '').trim() || 'Blank'))].sort((a, b) => a.localeCompare(b)),
    [rows]
  )

  const filteredByTopFilters = useMemo(() => {
    return rows.filter((row) => {
      if (statusFilter !== 'ALL') {
        const status = String(row.status || '').trim().toUpperCase()
        if (status !== statusFilter.toUpperCase()) return false
      }
      const inc = String(row.incoterm || '').trim() || 'Blank'
      if (selectedIncoterms.length > 0 && !selectedIncoterms.includes(inc)) return false
      const plant = String(row.plant_site || '').trim() || 'Blank'
      if (selectedPlantSites.length > 0 && !selectedPlantSites.includes(plant)) return false
      const cDate = String(row.contract_date || '').slice(0, 10)
      if (dateFrom && cDate && cDate < dateFrom) return false
      if (dateTo && cDate && cDate > dateTo) return false
      const total = Number(row.total_delta_days ?? 0)
      if (lateOnTimeFilter === 'LATE' && !(total > 0)) return false
      if (lateOnTimeFilter === 'ON_TIME' && !(total <= 0)) return false
      return true
    })
  }, [rows, statusFilter, selectedIncoterms, selectedPlantSites, dateFrom, dateTo, lateOnTimeFilter])

  const lateTree = useMemo(() => {
    const root = new Map<string, { count: number; totalDays: number; products: Map<string, { count: number; totalDays: number; plants: Map<string, { count: number; totalDays: number }> }> }>()
    for (const row of filteredByTopFilters) {
      const total = Number(row.total_delta_days ?? 0)
      if (total <= 0) continue
      const inc = String(row.incoterm || '').trim() || 'Blank'
      const prod = String(row.product || '').trim() || 'Blank'
      const plant = String(row.plant_site || '').trim() || 'Blank'
      if (!root.has(inc)) root.set(inc, { count: 0, totalDays: 0, products: new Map() })
      const incNode = root.get(inc)!
      incNode.count += 1
      incNode.totalDays += total
      if (!incNode.products.has(prod)) incNode.products.set(prod, { count: 0, totalDays: 0, plants: new Map() })
      const prodNode = incNode.products.get(prod)!
      prodNode.count += 1
      prodNode.totalDays += total
      if (!prodNode.plants.has(plant)) prodNode.plants.set(plant, { count: 0, totalDays: 0 })
      const plantNode = prodNode.plants.get(plant)!
      plantNode.count += 1
      plantNode.totalDays += total
    }
    const sortedInc = [...root.entries()].sort((a, b) => b[1].totalDays - a[1].totalDays)
    const out: LatePerfNode[] = sortedInc.map(([inc, incNode]) => ({
      key: inc,
      count: incNode.count,
      totalDays: incNode.totalDays,
      children: [...incNode.products.entries()]
        .sort((a, b) => b[1].totalDays - a[1].totalDays)
        .map(([prod, prodNode]) => ({
          key: prod,
          count: prodNode.count,
          totalDays: prodNode.totalDays,
          children: [...prodNode.plants.entries()]
            .sort((a, b) => b[1].totalDays - a[1].totalDays)
            .map(([plant, plantNode]) => ({
              key: plant,
              count: plantNode.count,
              totalDays: plantNode.totalDays,
              children: [],
            })),
        })),
    }))
    return out
  }, [filteredByTopFilters])

  const visibleOrderedColumns = useMemo(
    () => columnOrder.filter((key) => visibleColumns[String(key)] && COLUMN_MAP[String(key)]),
    [columnOrder, visibleColumns]
  )

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase()
    const scoped = filteredByTopFilters.filter((row) => {
      if (lateSelIncoterm && (String(row.incoterm || '').trim() || 'Blank') !== lateSelIncoterm) return false
      if (lateSelProduct && (String(row.product || '').trim() || 'Blank') !== lateSelProduct) return false
      if (lateSelPlant && (String(row.plant_site || '').trim() || 'Blank') !== lateSelPlant) return false
      return true
    })

    const base = !q
      ? scoped
      : scoped.filter((row) => {
      const vessel = row.vessel_name?.toLowerCase() ?? ''
      const group = row.group_name?.toLowerCase() ?? ''
      const shipmentId = row.shipment_id?.toLowerCase() ?? ''
      const contractNumber = row.contract_number?.toLowerCase() ?? ''
      const poNo = row.po_number?.toLowerCase() ?? ''
      const extNo = row.contract_ext_no?.toLowerCase() ?? ''
      const sto = row.sto_number?.toLowerCase() ?? ''
      return (
        vessel.includes(q) ||
        group.includes(q) ||
        shipmentId.includes(q) ||
        contractNumber.includes(q) ||
        poNo.includes(q) ||
        extNo.includes(q) ||
        sto.includes(q)
      )
    })

    const byColumns = base.filter((row) => {
      return COLUMN_DEFS.every((colDef) => {
        const key = colDef.key
        const filterText = (columnFilters[String(key)] || '').trim().toLowerCase()
        if (!filterText) return true
        const rowValue = row[key]
        const display = asDisplayValue(rowValue).toLowerCase()
        return display.includes(filterText)
      })
    })

    const sorted = [...byColumns].sort((a, b) => {
      const aVal = a[sortBy]
      const bVal = b[sortBy]
      const colType = COLUMN_MAP[String(sortBy)]?.type ?? 'text'
      if (colType === 'number') {
        const aNum = aVal === null || aVal === undefined || aVal === '' ? Number.NEGATIVE_INFINITY : Number(aVal)
        const bNum = bVal === null || bVal === undefined || bVal === '' ? Number.NEGATIVE_INFINITY : Number(bVal)
        return sortDirection === 'asc' ? aNum - bNum : bNum - aNum
      }
      const aStr = asDisplayValue(aVal).toLowerCase()
      const bStr = asDisplayValue(bVal).toLowerCase()
      if (aStr < bStr) return sortDirection === 'asc' ? -1 : 1
      if (aStr > bStr) return sortDirection === 'asc' ? 1 : -1
      return 0
    })
    return sorted
  }, [filteredByTopFilters, lateSelIncoterm, lateSelProduct, lateSelPlant, search, visibleOrderedColumns, columnFilters, sortBy, sortDirection])

  const onToggleColumn = (key: keyof ShippingPerformanceRow) => {
    setVisibleColumns((prev) => {
      const next = { ...prev, [String(key)]: !prev[String(key)] }
      const visibleCount = Object.values(next).filter(Boolean).length
      if (visibleCount === 0) return prev
      return next
    })
  }

  const onHeaderSort = (key: keyof ShippingPerformanceRow) => {
    if (sortBy === key) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'))
      return
    }
    setSortBy(key)
    setSortDirection('asc')
  }

  const moveColumn = (fromKey: string, toKey: string) => {
    if (!fromKey || !toKey || fromKey === toKey) return
    setColumnOrder((prev) => {
      const next = [...prev]
      const fromIdx = next.findIndex((k) => String(k) === fromKey)
      const toIdx = next.findIndex((k) => String(k) === toKey)
      if (fromIdx < 0 || toIdx < 0) return prev
      const [moved] = next.splice(fromIdx, 1)
      next.splice(toIdx, 0, moved)
      return next
    })
  }

  return (
    <Layout>
      <div className="space-y-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle>Shipping Performance</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3 mb-4">
              <div>
                <label className="text-xs text-gray-600 mb-1 block">Status</label>
                <select
                  className="w-full border rounded px-2 py-2 text-sm bg-white"
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                >
                  <option value="ALL">All</option>
                  <option value="PLANNED">PLANNED</option>
                  <option value="IN_PROGRESS">IN_PROGRESS</option>
                  <option value="LOADING">LOADING</option>
                  <option value="IN_TRANSIT">IN_TRANSIT</option>
                  <option value="ARRIVED">ARRIVED</option>
                  <option value="UNLOADING">UNLOADING</option>
                  <option value="COMPLETED">COMPLETED</option>
                  <option value="CANCELLED">CANCELLED</option>
                </select>
              </div>
              <SearchableMultiSelect
                label="Incoterm"
                options={availableIncoterms}
                selected={selectedIncoterms}
                onChange={setSelectedIncoterms}
                placeholder="Select incoterm(s)"
                emptyMessage="No incoterms"
              />
              <SearchableMultiSelect
                label="Plant/Site"
                options={availablePlantSites}
                selected={selectedPlantSites}
                onChange={setSelectedPlantSites}
                placeholder="Select plant/site(s)"
                emptyMessage="No plants"
              />
              <div>
                <label className="text-xs text-gray-600 mb-1 block">Contract Date From</label>
                <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="h-9" />
              </div>
              <div>
                <label className="text-xs text-gray-600 mb-1 block">Contract Date To</label>
                <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="h-9" />
              </div>
            </div>

            <div className="mb-4 flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-2">
                <label className="text-sm text-gray-700">Late/On Time</label>
                <select
                  className="border rounded px-2 py-2 text-sm bg-white"
                  value={lateOnTimeFilter}
                  onChange={(e) => setLateOnTimeFilter(e.target.value as 'ALL' | 'LATE' | 'ON_TIME')}
                >
                  <option value="ALL">All</option>
                  <option value="LATE">Late (Total &gt; 0)</option>
                  <option value="ON_TIME">On Time (Total &lt;= 0)</option>
                </select>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setLateSelIncoterm(null)
                  setLateSelProduct(null)
                  setLateSelPlant(null)
                }}
              >
                Reset Drilldown
              </Button>
            </div>

            <Card className="mb-4">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Late Performance (Shipping)</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-gray-500 mb-3">
                  Drilldown tree: <span className="font-medium">Total → Incoterm → Product → Plant</span>. Click number cards to filter table.
                </p>
                <div className="grid grid-cols-1 lg:grid-cols-4 gap-3">
                  <button
                    type="button"
                    className="border rounded-md p-3 text-left hover:bg-gray-50"
                    onClick={() => {
                      setLateSelIncoterm(null)
                      setLateSelProduct(null)
                      setLateSelPlant(null)
                    }}
                  >
                    <div className="text-xs text-gray-500">Total Late</div>
                    <div className="text-2xl font-semibold">{filteredByTopFilters.filter((r) => Number(r.total_delta_days ?? 0) > 0).length}</div>
                  </button>
                  <div className="border rounded-md p-3">
                    <div className="text-xs text-gray-500 mb-2">Incoterm</div>
                    <div className="space-y-2 max-h-48 overflow-auto">
                      {lateTree.map((n) => (
                        <button
                          key={n.key}
                          type="button"
                          className={`w-full text-left border rounded px-2 py-1 text-sm ${lateSelIncoterm === n.key ? 'bg-blue-50 border-blue-300' : 'hover:bg-gray-50'}`}
                          onClick={() => {
                            setLateSelIncoterm(n.key)
                            setLateSelProduct(null)
                            setLateSelPlant(null)
                          }}
                        >
                          <span className="font-medium">{n.key}</span> <span className="text-gray-500">({n.count})</span>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="border rounded-md p-3">
                    <div className="text-xs text-gray-500 mb-2">Product</div>
                    <div className="space-y-2 max-h-48 overflow-auto">
                      {(lateTree.find((n) => n.key === lateSelIncoterm)?.children || []).map((n) => (
                        <button
                          key={n.key}
                          type="button"
                          className={`w-full text-left border rounded px-2 py-1 text-sm ${lateSelProduct === n.key ? 'bg-blue-50 border-blue-300' : 'hover:bg-gray-50'}`}
                          onClick={() => {
                            setLateSelProduct(n.key)
                            setLateSelPlant(null)
                          }}
                        >
                          <span className="font-medium">{n.key}</span> <span className="text-gray-500">({n.count})</span>
                        </button>
                      ))}
                      {!lateSelIncoterm && <div className="text-sm text-gray-500">Select incoterm first</div>}
                    </div>
                  </div>
                  <div className="border rounded-md p-3">
                    <div className="text-xs text-gray-500 mb-2">Plant</div>
                    <div className="space-y-2 max-h-48 overflow-auto">
                      {(lateTree.find((n) => n.key === lateSelIncoterm)?.children.find((p) => p.key === lateSelProduct)?.children || []).map((n) => (
                        <button
                          key={n.key}
                          type="button"
                          className={`w-full text-left border rounded px-2 py-1 text-sm ${lateSelPlant === n.key ? 'bg-blue-50 border-blue-300' : 'hover:bg-gray-50'}`}
                          onClick={() => setLateSelPlant(n.key)}
                        >
                          <span className="font-medium">{n.key}</span> <span className="text-gray-500">({n.count})</span>
                        </button>
                      ))}
                      {!lateSelProduct && <div className="text-sm text-gray-500">Select product first</div>}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
              <Input
                placeholder="Search vessel, group, shipment ID, or contract..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="max-w-md"
              />
              <div className="flex items-center gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => setShowColumnManager((v) => !v)}>
                  <SlidersHorizontal className="h-4 w-4 mr-2" />
                  Columns
                </Button>
                <span className="text-sm text-gray-500">{filteredRows.length} row(s)</span>
              </div>
            </div>

            {showColumnManager && (
              <div ref={columnsMenuRef} className="mb-4 w-72 rounded-md border bg-white shadow-md z-20 p-3">
                <div className="text-xs font-semibold text-gray-600 mb-2">Visible columns</div>
                <div className="space-y-2 max-h-72 overflow-auto pr-1">
                  {COLUMN_DEFS.map((col) => (
                    <label key={String(col.key)} className="flex items-center gap-2 text-sm cursor-pointer select-none">
                      <Checkbox
                        checked={Boolean(visibleColumns[String(col.key)])}
                        onCheckedChange={() => onToggleColumn(col.key)}
                      />
                      {col.label}
                    </label>
                  ))}
                </div>
                <div className="mt-3 flex items-center justify-between gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      setVisibleColumns(Object.fromEntries(COLUMN_DEFS.map((c) => [c.key, c.defaultVisible !== false])))
                    }
                  >
                    Reset
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setShowColumnManager(false)}>
                    Close
                  </Button>
                </div>
              </div>
            )}

            <div className="overflow-auto border rounded-md">
              <table className="min-w-[1300px] w-full text-sm">
                <thead className="bg-gray-50">
                  <tr className="border-b">
                    {visibleOrderedColumns.map((key) => {
                      const col = COLUMN_MAP[String(key)]
                      const isSorted = sortBy === key
                      return (
                        <th
                          key={String(key)}
                          className="relative px-3 py-2 text-left font-medium whitespace-nowrap cursor-move select-none"
                          draggable
                          onDragStart={() => setDraggingColumn(String(key))}
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={() => {
                            if (draggingColumn) moveColumn(draggingColumn, String(key))
                            setDraggingColumn(null)
                          }}
                        >
                          <button
                            type="button"
                            className="inline-flex items-center gap-1"
                            onClick={() => onHeaderSort(key)}
                            title="Click to sort, drag to reorder"
                          >
                            <span>{col.label}</span>
                            <span className="text-xs text-gray-500">
                              {isSorted ? (sortDirection === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />) : null}
                            </span>
                          </button>
                          <button
                            type="button"
                            className={`ml-1 p-1 rounded hover:bg-gray-100 ${columnFilters[String(key)] ? 'text-blue-700' : 'text-gray-500'}`}
                            title="Filter"
                            onClick={(e) => {
                              e.stopPropagation()
                              setOpenHeaderFilterId((prev) => (prev === String(key) ? null : String(key)))
                            }}
                          >
                            <Filter className="h-3.5 w-3.5" />
                          </button>
                          {openHeaderFilterId === String(key) && (
                            <div
                              ref={headerFilterPopoverRef}
                              className="absolute left-0 top-full mt-2 w-[240px] bg-white border border-gray-200 rounded-lg shadow-lg p-3 z-30"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <div className="flex items-center justify-between mb-2">
                                <div className="text-xs font-semibold text-gray-700 truncate">{col.label} Filter</div>
                                <button
                                  type="button"
                                  className="text-xs text-gray-500 hover:text-gray-800"
                                  onClick={() => setOpenHeaderFilterId(null)}
                                >
                                  Close
                                </button>
                              </div>
                              <Input
                                value={columnFilters[String(key)] || ''}
                                onChange={(e) =>
                                  setColumnFilters((prev) => ({
                                    ...prev,
                                    [String(key)]: e.target.value,
                                  }))
                                }
                                placeholder={col.type === 'number' ? 'Type number text...' : 'Type to filter...'}
                                className="h-8 text-sm"
                              />
                              <div className="mt-2 flex justify-end">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  onClick={() =>
                                    setColumnFilters((prev) => {
                                      const next = { ...prev }
                                      delete next[String(key)]
                                      return next
                                    })
                                  }
                                >
                                  Clear
                                </Button>
                              </div>
                            </div>
                          )}
                        </th>
                      )
                    })}
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={visibleOrderedColumns.length || 1} className="px-3 py-6 text-center text-gray-500">
                        Loading shipping performance...
                      </td>
                    </tr>
                  ) : filteredRows.length === 0 ? (
                    <tr>
                      <td colSpan={visibleOrderedColumns.length || 1} className="px-3 py-6 text-center text-gray-500">
                        No data found
                      </td>
                    </tr>
                  ) : (
                    filteredRows.map((row) => (
                      <tr key={row.id} className="border-t hover:bg-gray-50">
                        {visibleOrderedColumns.map((key) => {
                          const col = COLUMN_MAP[String(key)]
                          const rawValue = row[key]
                          return (
                            <td key={`${row.id}-${String(key)}`} className="px-3 py-2 whitespace-nowrap">
                              {col.type === 'number' ? <NumberCell value={rawValue} /> : asDisplayValue(rawValue) || '-'}
                            </td>
                          )
                        })}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <p className="text-xs text-gray-500 mt-3">
              Delta unit is day difference. Records include transport mode SEA or MIX only.
            </p>
          </CardContent>
        </Card>
      </div>
    </Layout>
  )
}
