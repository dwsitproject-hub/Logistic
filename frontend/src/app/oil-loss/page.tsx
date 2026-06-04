'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Layout from '@/components/Layout'
import api from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { ArrowDown, ArrowUp, ArrowUpDown, Filter, Search, SlidersHorizontal, X } from 'lucide-react'
import { SearchableMultiSelect } from '@/components/SearchableMultiSelect'

interface OilLossRow {
  id: string
  transport_mode: 'LAND' | 'SEA'
  operation_id: string
  contract_number: string
  contract_ext_no?: string | null
  sto_number?: string | null
  po_number?: string | null
  supplier?: string | null
  buyer?: string | null
  product?: string | null
  group_name?: string | null
  plant_site?: string | null
  operation_date?: string | null
  quantity_sent?: number | null
  quantity_received?: number | null
  gain_loss_amount?: number | null
  gain_loss_percentage?: number | null
  status?: string | null
}

type OilLossNode = {
  key: string
  count: number
  totalLossKg: number
  children: OilLossNode[]
}

type ColumnType = 'text' | 'number'

type ColumnDef = {
  key: keyof OilLossRow
  label: string
  type: ColumnType
  defaultVisible?: boolean
}

const COLUMN_DEFS: ColumnDef[] = [
  { key: 'transport_mode',     label: 'Mode',            type: 'text',   defaultVisible: true },
  { key: 'group_name',         label: 'Group',           type: 'text',   defaultVisible: true },
  { key: 'supplier',           label: 'Supplier',        type: 'text',   defaultVisible: true },
  { key: 'product',            label: 'Product',         type: 'text',   defaultVisible: true },
  { key: 'plant_site',         label: 'Plant/Site',      type: 'text',   defaultVisible: true },
  { key: 'operation_id',       label: 'Operation ID',    type: 'text',   defaultVisible: true },
  { key: 'contract_number',    label: 'Contract No',     type: 'text',   defaultVisible: false },
  { key: 'contract_ext_no',    label: 'Contract Ext No', type: 'text',   defaultVisible: false },
  { key: 'sto_number',         label: 'STO No',          type: 'text',   defaultVisible: false },
  { key: 'po_number',          label: 'PO No',           type: 'text',   defaultVisible: false },
  { key: 'status',             label: 'Status',          type: 'text',   defaultVisible: true },
  { key: 'operation_date',     label: 'Date',            type: 'text',   defaultVisible: true },
  { key: 'quantity_sent',      label: 'Qty Sent (Kg)',   type: 'number', defaultVisible: true },
  { key: 'quantity_received',  label: 'Qty Received (Kg)', type: 'number', defaultVisible: true },
  { key: 'gain_loss_amount',   label: 'Oil Loss (Kg)',   type: 'number', defaultVisible: true },
  { key: 'gain_loss_percentage', label: 'Oil Loss %',   type: 'number', defaultVisible: true },
]

const COLUMN_MAP = Object.fromEntries(COLUMN_DEFS.map((c) => [c.key, c])) as Record<string, ColumnDef>

function asDisplay(v: unknown): string {
  if (v === null || v === undefined) return ''
  return String(v)
}

function fmt(n: unknown, decimals = 2): string {
  if (n === null || n === undefined || n === '') return '-'
  const num = Number(n)
  if (Number.isNaN(num)) return '-'
  return num.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: decimals, useGrouping: true })
}

function fmtDate(s: string | null | undefined): string {
  if (!s) return '-'
  return s.slice(0, 10)
}

function NumberCell({ value, isLoss = false }: { value: unknown; isLoss?: boolean }) {
  if (value === null || value === undefined || value === '') return <span className="text-gray-400">-</span>
  const n = Number(value)
  if (Number.isNaN(n)) return <span className="text-gray-400">-</span>
  const color = isLoss ? (n < 0 ? 'text-red-600' : n > 0 ? 'text-green-600' : '') : ''
  return <span className={color}>{fmt(n)}</span>
}

export default function OilLossPage() {
  const [rows, setRows] = useState<OilLossRow[]>([])
  const [gainSummary, setGainSummary] = useState({ totalGainKg: 0, gainCount: 0 })
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showColumnManager, setShowColumnManager] = useState(false)
  const [columnOrder, setColumnOrder] = useState<Array<keyof OilLossRow>>(COLUMN_DEFS.map((c) => c.key))
  const [visibleColumns, setVisibleColumns] = useState<Record<string, boolean>>(
    Object.fromEntries(COLUMN_DEFS.map((c) => [c.key, c.defaultVisible !== false]))
  )
  const [columnFilters, setColumnFilters] = useState<Record<string, string>>({})
  const [openHeaderFilterId, setOpenHeaderFilterId] = useState<string | null>(null)
  const [draggingColumn, setDraggingColumn] = useState<string | null>(null)
  const [sortBy, setSortBy] = useState<keyof OilLossRow>('gain_loss_amount')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc')
  const [currentPage, setCurrentPage] = useState(1)
  const pageSize = 20

  const columnsMenuRef = useRef<HTMLDivElement | null>(null)
  const headerFilterPopoverRef = useRef<HTMLDivElement | null>(null)
  const topScrollRef = useRef<HTMLDivElement | null>(null)
  const bottomScrollRef = useRef<HTMLDivElement | null>(null)
  const isSyncingScroll = useRef(false)
  const [tableScrollWidth, setTableScrollWidth] = useState(0)

  const [modeFilter, setModeFilter] = useState<string>('ALL')
  const [selectedPlantSites, setSelectedPlantSites] = useState<string[]>([])
  const [selectedProducts, setSelectedProducts] = useState<string[]>([])
  const [dateFrom, setDateFrom] = useState(() => { const d = new Date(); return `${d.getFullYear()}-01-01` })
  const [dateTo, setDateTo] = useState(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  })

  // Drilldown selections
  const [selMode, setSelMode] = useState<string | null>(null)
  const [selProduct, setSelProduct] = useState<string | null>(null)
  const [selPlant, setSelPlant] = useState<string | null>(null)
  const [selGroup, setSelGroup] = useState<string | null>(null)
  const [selSupplier, setSelSupplier] = useState<string | null>(null)

  useEffect(() => {
    const fetch = async () => {
      try {
        setLoading(true)
        const res = await api.get('/oil-loss')
        setRows(Array.isArray(res.data?.data) ? res.data.data : [])
        if (res.data?.gainSummary) setGainSummary(res.data.gainSummary)
      } catch (err) {
        console.error('Oil loss load error:', err)
        setRows([])
      } finally {
        setLoading(false)
      }
    }
    fetch()
  }, [])

  useEffect(() => {
    const handler = (ev: MouseEvent) => {
      const t = ev.target as Node
      if (showColumnManager && columnsMenuRef.current && !columnsMenuRef.current.contains(t)) setShowColumnManager(false)
      if (openHeaderFilterId && headerFilterPopoverRef.current && !headerFilterPopoverRef.current.contains(t)) setOpenHeaderFilterId(null)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showColumnManager, openHeaderFilterId])

  const availablePlantSites = useMemo(
    () => [...new Set(rows.map((r) => String(r.plant_site || '').trim() || 'Blank'))].sort((a, b) => a.localeCompare(b)),
    [rows]
  )
  const availableProducts = useMemo(
    () => [...new Set(rows.map((r) => String(r.product || '').trim() || 'Blank'))].sort((a, b) => a.localeCompare(b)),
    [rows]
  )

  const filteredByTopFilters = useMemo(() => {
    return rows.filter((row) => {
      if (modeFilter !== 'ALL' && row.transport_mode !== modeFilter) return false
      const plant = String(row.plant_site || '').trim() || 'Blank'
      if (selectedPlantSites.length > 0 && !selectedPlantSites.includes(plant)) return false
      const prod = String(row.product || '').trim() || 'Blank'
      if (selectedProducts.length > 0 && !selectedProducts.includes(prod)) return false
      const d = String(row.operation_date || '').slice(0, 10)
      if (dateFrom && d && d < dateFrom) return false
      if (dateTo && d && d > dateTo) return false
      return true
    })
  }, [rows, modeFilter, selectedPlantSites, selectedProducts, dateFrom, dateTo])

  // Drilldown tree: Mode → Product → Plant → Group → Supplier
  const lossTree = useMemo(() => {
    type SupplierMap = Map<string, { count: number; totalLossKg: number }>
    type GroupMap    = Map<string, { count: number; totalLossKg: number; suppliers: SupplierMap }>
    type PlantMap    = Map<string, { count: number; totalLossKg: number; groups: GroupMap }>
    type ProdMap     = Map<string, { count: number; totalLossKg: number; plants: PlantMap }>
    type ModeMap     = Map<string, { count: number; totalLossKg: number; products: ProdMap }>
    const root: ModeMap = new Map()

    for (const row of filteredByTopFilters) {
      const absLoss  = Math.abs(Number(row.gain_loss_amount ?? 0))
      const mode     = row.transport_mode || 'Unknown'
      const prod     = String(row.product    || '').trim() || 'Blank'
      const plant    = String(row.plant_site || '').trim() || 'Blank'
      const group    = String(row.group_name || '').trim() || 'Blank'
      const supplier = String(row.supplier   || '').trim() || 'Blank'

      if (!root.has(mode)) root.set(mode, { count: 0, totalLossKg: 0, products: new Map() })
      const modeNode = root.get(mode)!
      modeNode.count++; modeNode.totalLossKg += absLoss

      if (!modeNode.products.has(prod)) modeNode.products.set(prod, { count: 0, totalLossKg: 0, plants: new Map() })
      const prodNode = modeNode.products.get(prod)!
      prodNode.count++; prodNode.totalLossKg += absLoss

      if (!prodNode.plants.has(plant)) prodNode.plants.set(plant, { count: 0, totalLossKg: 0, groups: new Map() })
      const plantNode = prodNode.plants.get(plant)!
      plantNode.count++; plantNode.totalLossKg += absLoss

      if (!plantNode.groups.has(group)) plantNode.groups.set(group, { count: 0, totalLossKg: 0, suppliers: new Map() })
      const groupNode = plantNode.groups.get(group)!
      groupNode.count++; groupNode.totalLossKg += absLoss

      if (!groupNode.suppliers.has(supplier)) groupNode.suppliers.set(supplier, { count: 0, totalLossKg: 0 })
      const supplierNode = groupNode.suppliers.get(supplier)!
      supplierNode.count++; supplierNode.totalLossKg += absLoss
    }

    const srt = <T,>(m: Map<string, T & { totalLossKg: number }>) =>
      [...m.entries()].sort((a, b) => b[1].totalLossKg - a[1].totalLossKg)

    return srt(root).map(([mode, mn]) => ({
      key: mode, count: mn.count, totalLossKg: mn.totalLossKg,
      children: srt(mn.products).map(([prod, pn]) => ({
        key: prod, count: pn.count, totalLossKg: pn.totalLossKg,
        children: srt(pn.plants).map(([plant, pln]) => ({
          key: plant, count: pln.count, totalLossKg: pln.totalLossKg,
          children: srt(pln.groups).map(([group, gn]) => ({
            key: group, count: gn.count, totalLossKg: gn.totalLossKg,
            children: srt(gn.suppliers).map(([sup, sn]) => ({
              key: sup, count: sn.count, totalLossKg: sn.totalLossKg, children: [],
            })),
          })),
        })),
      })),
    })) as OilLossNode[]
  }, [filteredByTopFilters])

  const lossSummary = useMemo(() => {
    let count = 0, totalLossKg = 0, totalPct = 0, maxPct = 0
    for (const row of filteredByTopFilters) {
      const absLoss = Math.abs(Number(row.gain_loss_amount ?? 0))
      const pct = Math.abs(Number(row.gain_loss_percentage ?? 0))
      count++
      totalLossKg += absLoss
      totalPct += pct
      maxPct = Math.max(maxPct, pct)
    }
    return { count, totalLossKg, avgPct: count > 0 ? totalPct / count : 0, maxPct }
  }, [filteredByTopFilters])

  const visibleOrderedColumns = useMemo(
    () => columnOrder.filter((k) => visibleColumns[String(k)] && COLUMN_MAP[String(k)]),
    [columnOrder, visibleColumns]
  )

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase()
    const scoped = filteredByTopFilters.filter((row) => {
      if (selMode    && row.transport_mode !== selMode) return false
      if (selProduct && (String(row.product    || '').trim() || 'Blank') !== selProduct) return false
      if (selPlant   && (String(row.plant_site || '').trim() || 'Blank') !== selPlant) return false
      if (selGroup    && (String(row.group_name || '').trim() || 'Blank') !== selGroup) return false
      if (selSupplier && (String(row.supplier   || '').trim() || 'Blank') !== selSupplier) return false
      return true
    })

    const searched = !q ? scoped : scoped.filter((row) =>
      [row.operation_id, row.contract_number, row.contract_ext_no, row.sto_number,
       row.po_number, row.supplier, row.group_name]
        .some((v) => String(v || '').toLowerCase().includes(q))
    )

    const byColumns = searched.filter((row) =>
      COLUMN_DEFS.every((col) => {
        const filterText = (columnFilters[String(col.key)] || '').trim().toLowerCase()
        if (!filterText) return true
        return asDisplay(row[col.key]).toLowerCase().includes(filterText)
      })
    )

    return [...byColumns].sort((a, b) => {
      const aVal = a[sortBy], bVal = b[sortBy]
      const colType = COLUMN_MAP[String(sortBy)]?.type ?? 'text'
      if (colType === 'number') {
        const aN = aVal == null ? -Infinity : Number(aVal)
        const bN = bVal == null ? -Infinity : Number(bVal)
        return sortDirection === 'asc' ? aN - bN : bN - aN
      }
      const aS = asDisplay(aVal).toLowerCase(), bS = asDisplay(bVal).toLowerCase()
      return sortDirection === 'asc' ? aS.localeCompare(bS) : bS.localeCompare(aS)
    })
  }, [filteredByTopFilters, selMode, selProduct, selPlant, selGroup, selSupplier, search, columnFilters, sortBy, sortDirection])

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize))
  const paginatedRows = useMemo(
    () => filteredRows.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [filteredRows, currentPage]
  )

  useEffect(() => { setCurrentPage(1) }, [filteredRows.length])

  useEffect(() => {
    const calc = () => { if (bottomScrollRef.current) setTableScrollWidth(bottomScrollRef.current.scrollWidth) }
    calc()
    window.addEventListener('resize', calc)
    return () => window.removeEventListener('resize', calc)
  }, [visibleOrderedColumns, paginatedRows.length])

  const handlePageChange = (p: number) => {
    if (p >= 1 && p <= totalPages) { setCurrentPage(p); window.scrollTo({ top: 0, behavior: 'smooth' }) }
  }

  const onToggleColumn = (key: keyof OilLossRow) => {
    setVisibleColumns((prev) => {
      const next = { ...prev, [String(key)]: !prev[String(key)] }
      if (Object.values(next).filter(Boolean).length === 0) return prev
      return next
    })
  }

  const onHeaderSort = (key: keyof OilLossRow) => {
    if (sortBy === key) { setSortDirection((d) => d === 'asc' ? 'desc' : 'asc'); return }
    setSortBy(key); setSortDirection('asc')
  }

  const moveColumn = (fromKey: string, toKey: string) => {
    if (!fromKey || !toKey || fromKey === toKey) return
    setColumnOrder((prev) => {
      const next = [...prev]
      const fi = next.findIndex((k) => String(k) === fromKey)
      const ti = next.findIndex((k) => String(k) === toKey)
      if (fi < 0 || ti < 0) return prev
      const [moved] = next.splice(fi, 1)
      next.splice(ti, 0, moved)
      return next
    })
  }

  const resetDrilldown = () => { setSelMode(null); setSelProduct(null); setSelPlant(null); setSelGroup(null); setSelSupplier(null) }

  return (
    <Layout>
      <div className="space-y-6">

        {/* Section 1: Oil Loss Summary + Drilldown */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <CardTitle className="text-base">Oil Loss Performance (YTD)</CardTitle>
                <div className="text-sm text-gray-600 mt-1">
                  Records where <span className="font-medium">Qty Received &lt; Qty Sent</span> — quantity shortfall during transport (trucking &amp; sea shipments). Use drilldown to filter the table below.
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 w-full sm:w-auto">
                <div className="rounded border bg-white px-3 py-2">
                  <div className="text-[11px] text-gray-500">Records with loss</div>
                  <div className="text-lg font-semibold text-gray-900">{lossSummary.count.toLocaleString('en-US')}</div>
                </div>
                <div className="rounded border bg-white px-3 py-2">
                  <div className="text-[11px] text-gray-500">Total loss (MT)</div>
                  <div className="text-lg font-semibold text-red-600">{(lossSummary.totalLossKg / 1000).toLocaleString('en-US', { maximumFractionDigits: 2 })} MT</div>
                </div>
                <div className="rounded border bg-white px-3 py-2">
                  <div className="text-[11px] text-gray-500">Avg loss %</div>
                  <div className="text-lg font-semibold text-gray-900">{lossSummary.avgPct.toFixed(2)}%</div>
                </div>
                <div className="rounded border bg-white px-3 py-2">
                  <div className="text-[11px] text-gray-500">Max loss %</div>
                  <div className="text-lg font-semibold text-gray-900">{lossSummary.maxPct.toFixed(2)}%</div>
                </div>
                <div className="rounded border bg-white px-3 py-2">
                  <div className="text-[11px] text-gray-500">Total gain (MT)</div>
                  <div className="text-lg font-semibold text-green-600">
                    {(gainSummary.totalGainKg / 1000).toLocaleString('en-US', { maximumFractionDigits: 2 })} MT
                  </div>
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-2">
            {lossTree.length === 0 ? (
              <div className="text-sm text-gray-500">{loading ? 'Loading…' : 'No oil loss records found.'}</div>
            ) : (
              <div className="space-y-3">
                <div className="text-sm text-gray-600">
                  Navigate loss by: <span className="font-medium">Mode → Product → Plant → Group → Supplier</span>. Click a node to filter the table below.
                </div>
                <div className="rounded-xl border bg-white p-4">
                  <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
                    <div className="text-sm font-semibold text-gray-900">Oil Loss drilldown</div>
                    <button type="button" onClick={resetDrilldown} className="text-sm text-blue-700 hover:underline">
                      Reset selection
                    </button>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-5 gap-3">
                    {([
                      { title: 'Mode',     subtitle: 'Pick one',                                                       level: 'mode'     as const },
                      { title: 'Product',  subtitle: selMode    ? `Under ${selMode}`    : 'Pick mode first',           level: 'product'  as const },
                      { title: 'Plant',    subtitle: selProduct ? `Under ${selProduct}` : 'Pick product first',        level: 'plant'    as const },
                      { title: 'Group',    subtitle: selPlant   ? `Under ${selPlant}`   : 'Pick plant first',          level: 'group'    as const },
                      { title: 'Supplier', subtitle: selGroup   ? `Under ${selGroup}`   : 'Pick group first',          level: 'supplier' as const },
                    ] as const).map((col) => {
                      const totalLossKg = lossTree.reduce((s, n) => s + n.totalLossKg, 0)
                      const denom = totalLossKg || 1

                      const levelStyles: Record<string, { headerBg: string; badge: string; bar: string; border: string }> = {
                        mode:     { headerBg: 'bg-sky-50',     badge: 'bg-sky-100 text-sky-800',        bar: 'bg-sky-600',     border: 'border-sky-200' },
                        product:  { headerBg: 'bg-amber-50',   badge: 'bg-amber-100 text-amber-800',    bar: 'bg-amber-600',   border: 'border-amber-200' },
                        plant:    { headerBg: 'bg-violet-50',  badge: 'bg-violet-100 text-violet-800',  bar: 'bg-violet-600',  border: 'border-violet-200' },
                        group:    { headerBg: 'bg-emerald-50', badge: 'bg-emerald-100 text-emerald-800',bar: 'bg-emerald-600', border: 'border-emerald-200' },
                        supplier: { headerBg: 'bg-rose-50',    badge: 'bg-rose-100 text-rose-800',      bar: 'bg-rose-600',    border: 'border-rose-200' },
                      }
                      const style = levelStyles[col.level]
                      const itemClass = (selected: boolean) =>
                        `w-full text-left rounded-lg border px-3 py-2 hover:bg-gray-50 focus:outline-none ${selected ? `bg-white ${style.border}` : 'bg-white border-gray-200'}`

                      const renderNode = (node: OilLossNode, selected: boolean, onClick: () => void, isTotal = false) => {
                        const pct = Math.max(1, Math.round((node.totalLossKg / denom) * 100))
                        return (
                          <button key={node.key} type="button" className={itemClass(selected)} onClick={onClick}>
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0 flex-1 text-left">
                                <div className="text-sm font-semibold text-gray-900 truncate">{node.key}</div>
                                <div className="mt-1 h-1.5 rounded bg-gray-100 overflow-hidden">
                                  <div className={`h-full ${style.bar}`} style={{ width: `${pct}%` }} />
                                </div>
                                <div className="mt-1 text-xs text-gray-700 flex items-center justify-between gap-2">
                                  <span className="font-semibold">{node.count.toLocaleString('en-US')}</span>
                                  <span className="text-gray-500">records</span>
                                  <span className="ml-auto font-semibold whitespace-nowrap text-red-600">
                                    {(node.totalLossKg / 1000).toLocaleString('en-US', { maximumFractionDigits: 2 })} MT
                                  </span>
                                </div>
                              </div>
                              {isTotal && (
                                <span className={`shrink-0 px-2 py-1 rounded text-[11px] font-semibold ${style.badge}`}>Total</span>
                              )}
                            </div>
                          </button>
                        )
                      }

                      const panelHeader = (
                        <div className={`rounded-lg border px-3 py-2 ${style.headerBg} ${style.border}`}>
                          <div className="text-sm font-semibold text-gray-900">{col.title}</div>
                          <div className="text-[11px] text-gray-500">{col.subtitle}</div>
                        </div>
                      )

                      const modeNode    = lossTree.find((n) => n.key === selMode)
                      const productNode = modeNode?.children.find((n) => n.key === selProduct)
                      const plantNode   = productNode?.children.find((n) => n.key === selPlant)
                      const grpNode     = plantNode?.children.find((n) => n.key === selGroup)

                      const body = (() => {
                        if (col.level === 'mode') {
                          return <div className="space-y-2">{lossTree.map((n) => renderNode(n, selMode === n.key, () => { setSelMode(n.key); setSelProduct(null); setSelPlant(null); setSelGroup(null); setSelSupplier(null) }))}</div>
                        }
                        if (col.level === 'product') {
                          if (!selMode) return <div className="text-sm text-gray-500">Select a mode to see products.</div>
                          return <div className="space-y-2">{(modeNode?.children || []).map((n) => renderNode(n, selProduct === n.key, () => { setSelProduct(n.key); setSelPlant(null); setSelGroup(null); setSelSupplier(null) }))}</div>
                        }
                        if (col.level === 'plant') {
                          if (!selProduct) return <div className="text-sm text-gray-500">Select a product to see plants.</div>
                          return <div className="space-y-2">{(productNode?.children || []).map((n) => renderNode(n, selPlant === n.key, () => { setSelPlant(n.key); setSelGroup(null); setSelSupplier(null) }))}</div>
                        }
                        if (col.level === 'group') {
                          if (!selPlant) return <div className="text-sm text-gray-500">Select a plant to see groups.</div>
                          return <div className="space-y-2">{(plantNode?.children || []).map((n) => renderNode(n, selGroup === n.key, () => { setSelGroup(n.key); setSelSupplier(null) }))}</div>
                        }
                        if (!selGroup) return <div className="text-sm text-gray-500">Select a group to see suppliers.</div>
                        return <div className="space-y-2">{(grpNode?.children || []).map((n) => renderNode(n, selSupplier === n.key, () => setSelSupplier(n.key)))}</div>
                      })()

                      return (
                        <div key={col.level} className="space-y-2">
                          {panelHeader}
                          <div className="space-y-2 max-h-[420px] overflow-auto pr-1">{body}</div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Section 2: Filters */}
        <Card>
          <CardContent className="pt-6">
            <div className="space-y-4">
              <div className="flex gap-4 flex-wrap">
                <div className="flex-1 relative min-w-[200px]">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <Input
                    placeholder="Search operation ID, contract, STO, supplier, group..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="pl-10"
                  />
                </div>
                <select
                  value={modeFilter}
                  onChange={(e) => setModeFilter(e.target.value)}
                  className="px-4 py-2 border rounded-lg text-sm"
                >
                  <option value="ALL">All Modes</option>
                  <option value="LAND">LAND</option>
                  <option value="SEA">SEA</option>
                </select>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <SearchableMultiSelect
                  label="Product"
                  options={availableProducts}
                  selected={selectedProducts}
                  onChange={setSelectedProducts}
                  placeholder="Select product(s)"
                  emptyMessage="No products"
                />
                <SearchableMultiSelect
                  label="Plant/Site"
                  options={availablePlantSites}
                  selected={selectedPlantSites}
                  onChange={setSelectedPlantSites}
                  placeholder="Select plant/site(s)"
                  emptyMessage="No plants"
                />
              </div>
              <div className="flex gap-4 items-center flex-wrap">
                <div className="flex items-center gap-2">
                  <label className="text-sm font-medium text-gray-700">Operation Date:</label>
                  <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-40" />
                  <span className="text-gray-500">to</span>
                  <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-40" />
                  <Button variant="outline" size="sm" className="ml-2" onClick={() => setCurrentPage(1)}>
                    <Filter className="h-4 w-4 mr-1" />
                    Apply
                  </Button>
                  {(dateFrom || dateTo) && (
                    <Button onClick={() => { setDateFrom(''); setDateTo(''); setCurrentPage(1) }} variant="ghost" size="sm" className="text-gray-500">
                      <X className="h-4 w-4 mr-1" />
                      Clear
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Section 3: Table */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <CardTitle>All Records</CardTitle>
                <Badge variant="outline" className="hidden md:inline-flex">
                  {filteredRows.length} records
                </Badge>
              </div>
              <div className="flex items-center gap-2">
                <div ref={columnsMenuRef} className="relative">
                  <Button variant="outline" size="sm" onClick={() => setShowColumnManager((v) => !v)}>
                    <SlidersHorizontal className="h-4 w-4 mr-2" />
                    Columns
                  </Button>
                  {showColumnManager && (
                    <div className="absolute right-0 mt-2 w-64 rounded-md border bg-white shadow-md z-50 p-3">
                      <div className="text-xs font-semibold text-gray-600 mb-2">Visible columns</div>
                      <div className="space-y-2 max-h-72 overflow-auto pr-1">
                        {COLUMN_DEFS.map((col) => (
                          <label key={String(col.key)} className="flex items-center gap-2 text-sm cursor-pointer select-none">
                            <Checkbox checked={Boolean(visibleColumns[String(col.key)])} onCheckedChange={() => onToggleColumn(col.key)} />
                            <span>{col.label}</span>
                          </label>
                        ))}
                      </div>
                      <div className="mt-3 flex items-center justify-between gap-2">
                        <Button variant="ghost" size="sm" onClick={() => setVisibleColumns(Object.fromEntries(COLUMN_DEFS.map((c) => [c.key, c.defaultVisible !== false])))}>Reset</Button>
                        <Button variant="outline" size="sm" onClick={() => setShowColumnManager(false)}>Close</Button>
                      </div>
                    </div>
                  )}
                </div>
                {totalPages > 1 && (
                  <div className="flex items-center gap-1">
                    <Button variant="outline" size="sm" onClick={() => handlePageChange(currentPage - 1)} disabled={currentPage === 1}>Previous</Button>
                    {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                      let p: number
                      if (totalPages <= 5) p = i + 1
                      else if (currentPage <= 3) p = i + 1
                      else if (currentPage >= totalPages - 2) p = totalPages - 4 + i
                      else p = currentPage - 2 + i
                      return <Button key={p} variant={currentPage === p ? 'default' : 'outline'} size="sm" onClick={() => handlePageChange(p)} className="min-w-[36px]">{p}</Button>
                    })}
                    <Button variant="outline" size="sm" onClick={() => handlePageChange(currentPage + 1)} disabled={currentPage === totalPages}>Next</Button>
                  </div>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="border rounded-md">
              {/* Top scrollbar mirror */}
              <div
                ref={topScrollRef}
                className="overflow-x-auto border-b bg-white rounded-t-md"
                onScroll={() => {
                  if (isSyncingScroll.current) return
                  const top = topScrollRef.current, bot = bottomScrollRef.current
                  if (!top || !bot) return
                  isSyncingScroll.current = true
                  bot.scrollLeft = top.scrollLeft
                  window.requestAnimationFrame(() => { isSyncingScroll.current = false })
                }}
              >
                <div style={{ width: tableScrollWidth || 0, height: 1 }} />
              </div>

              <div
                ref={bottomScrollRef}
                className="overflow-x-auto"
                onScroll={() => {
                  if (isSyncingScroll.current) return
                  const top = topScrollRef.current, bot = bottomScrollRef.current
                  if (!top || !bot) return
                  isSyncingScroll.current = true
                  top.scrollLeft = bot.scrollLeft
                  window.requestAnimationFrame(() => { isSyncingScroll.current = false })
                }}
              >
                <table className="min-w-[1200px] w-full text-sm">
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
                            onDrop={() => { if (draggingColumn) moveColumn(draggingColumn, String(key)); setDraggingColumn(null) }}
                          >
                            <button type="button" className="inline-flex items-center gap-1" onClick={() => onHeaderSort(key)} title="Click to sort, drag to reorder">
                              <span>{col.label}</span>
                              <span className="text-xs text-gray-500">
                                {isSorted ? (sortDirection === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />) : null}
                              </span>
                            </button>
                            <button
                              type="button"
                              className={`ml-1 p-1 rounded hover:bg-gray-100 ${columnFilters[String(key)] ? 'text-blue-700' : 'text-gray-400'}`}
                              title="Filter"
                              onClick={(e) => { e.stopPropagation(); setOpenHeaderFilterId((prev) => (prev === String(key) ? null : String(key))) }}
                            >
                              <ArrowUpDown className="h-3.5 w-3.5" />
                            </button>
                            {openHeaderFilterId === String(key) && (
                              <div ref={headerFilterPopoverRef} className="absolute left-0 top-full mt-2 w-[240px] bg-white border border-gray-200 rounded-lg shadow-lg p-3 z-30" onClick={(e) => e.stopPropagation()}>
                                <div className="flex items-center justify-between mb-2">
                                  <div className="text-xs font-semibold text-gray-700 truncate">{col.label} Filter</div>
                                  <button type="button" className="text-xs text-gray-500 hover:text-gray-800" onClick={() => setOpenHeaderFilterId(null)}>Close</button>
                                </div>
                                <Input
                                  value={columnFilters[String(key)] || ''}
                                  onChange={(e) => setColumnFilters((prev) => ({ ...prev, [String(key)]: e.target.value }))}
                                  placeholder={col.type === 'number' ? 'Type number...' : 'Type to filter...'}
                                  className="h-8 text-sm"
                                />
                                <div className="mt-2 flex justify-end">
                                  <Button type="button" variant="ghost" size="sm" onClick={() => setColumnFilters((prev) => { const next = { ...prev }; delete next[String(key)]; return next })}>Clear</Button>
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
                      <tr><td colSpan={visibleOrderedColumns.length || 1} className="px-3 py-6 text-center text-gray-500">Loading oil loss data…</td></tr>
                    ) : filteredRows.length === 0 ? (
                      <tr><td colSpan={visibleOrderedColumns.length || 1} className="px-3 py-6 text-center text-gray-500">No records found</td></tr>
                    ) : (
                      paginatedRows.map((row) => (
                        <tr key={`${row.id}-${row.transport_mode}`} className="border-t hover:bg-gray-50">
                          {visibleOrderedColumns.map((key) => {
                            const rawValue = row[key]
                            return (
                              <td key={`${row.id}-${String(key)}`} className="px-3 py-2 whitespace-nowrap">
                                {key === 'transport_mode' ? (
                                  <Badge className={row.transport_mode === 'SEA' ? 'bg-blue-100 text-blue-800' : 'bg-orange-100 text-orange-800'}>
                                    {String(rawValue || '')}
                                  </Badge>
                                ) : key === 'operation_date' ? (
                                  <span>{fmtDate(String(rawValue || ''))}</span>
                                ) : key === 'gain_loss_amount' || key === 'gain_loss_percentage' || key === 'quantity_sent' || key === 'quantity_received' ? (
                                  <NumberCell value={rawValue} isLoss={key === 'gain_loss_amount' || key === 'gain_loss_percentage'} />
                                ) : (
                                  <span>{asDisplay(rawValue) || '-'}</span>
                                )}
                              </td>
                            )
                          })}
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {totalPages > 1 && (
              <div className="mt-4 flex items-center justify-between border-t pt-4">
                <div className="text-sm text-gray-700">Page {currentPage} of {totalPages} ({filteredRows.length} total records)</div>
                <div className="flex items-center gap-1">
                  <Button variant="outline" size="sm" onClick={() => handlePageChange(currentPage - 1)} disabled={currentPage === 1}>Previous</Button>
                  {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                    let p: number
                    if (totalPages <= 5) p = i + 1
                    else if (currentPage <= 3) p = i + 1
                    else if (currentPage >= totalPages - 2) p = totalPages - 4 + i
                    else p = currentPage - 2 + i
                    return <Button key={p} variant={currentPage === p ? 'default' : 'outline'} size="sm" onClick={() => handlePageChange(p)} className="min-w-[36px]">{p}</Button>
                  })}
                  <Button variant="outline" size="sm" onClick={() => handlePageChange(currentPage + 1)} disabled={currentPage === totalPages}>Next</Button>
                </div>
              </div>
            )}

            <p className="text-xs text-gray-500 mt-3">
              Hanya menampilkan data dengan selisih kurang: Qty Received &lt; Qty Sent. Oil Loss (Kg) = Qty Sent − Qty Received. Mencakup LAND (trucking) dan SEA (shipments).
            </p>
          </CardContent>
        </Card>

      </div>
    </Layout>
  )
}
