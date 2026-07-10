import type { OilLossSourceRow } from '@/lib/oilLossAllContractColumns'

export type OilLossDrilldownCategory = 'product' | 'plant' | 'incoterm' | 'transporter' | 'supplier'

export const OIL_LOSS_DRILLDOWN_CATEGORIES: ReadonlyArray<{
  level: OilLossDrilldownCategory
  title: string
}> = [
  { level: 'product', title: 'Product' },
  { level: 'plant', title: 'Plant' },
  { level: 'incoterm', title: 'Incoterm' },
  { level: 'transporter', title: 'Transporter' },
  { level: 'supplier', title: 'Supplier' },
] as const

export type OilLossDrilldownFilters = {
  product: string | null
  plant: string | null
  incoterm: string | null
  transporter: string | null
  supplier: string | null
}

export const EMPTY_OIL_LOSS_DRILLDOWN_FILTERS: OilLossDrilldownFilters = {
  product: null,
  plant: null,
  incoterm: null,
  transporter: null,
  supplier: null,
}

export type OilLossDrilldownTreeNode = {
  key: string
  label: string
  contractCount: number
  totalOilLossKg: number
  children: OilLossDrilldownTreeNode[]
}

function contractGroupKey(row: OilLossSourceRow): string {
  const cn = String(row.contract_number ?? '').trim()
  if (cn) return `cn:${cn}`
  const ext = String(row.contract_ext_no ?? '').trim()
  if (ext) return `ext:${ext}`
  return `row:${row.id}`
}

function normalizeGroupLabel(value: unknown, fallback = 'Blank'): string {
  const trimmed = String(value ?? '').trim()
  return trimmed || fallback
}

function parseQty(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** R4 basis (Qty Receive − Qty Delivery) — matches Section 1 R4 totalMt aggregation. */
function rowR4OilLossKg(row: OilLossSourceRow): number {
  const delivery = parseQty(row.quantity_sent)
  const receive = parseQty(row.quantity_received)
  if (receive == null || delivery == null || delivery <= 0) return 0
  return receive - delivery
}

export function groupLabelForRow(row: OilLossSourceRow, category: OilLossDrilldownCategory): string {
  switch (category) {
    case 'product':
      return normalizeGroupLabel(row.product)
    case 'plant':
      return normalizeGroupLabel(row.group_plant)
    case 'incoterm':
      return normalizeGroupLabel(row.incoterm)
    case 'transporter':
      return normalizeGroupLabel(row.transporter, '-')
    case 'supplier':
      return normalizeGroupLabel(row.supplier, '-')
    default:
      return 'Blank'
  }
}

export function displayOilLossGroupLabel(key: string): string {
  if (key === 'Blank') return '(Blank)'
  if (key === '-') return '-'
  return key
}

export function isOilLossDrilldownValueSet(value: string | null | undefined): value is string {
  return value != null && value !== ''
}

export function hasOilLossDrilldownSelection(filters: OilLossDrilldownFilters): boolean {
  return (
    isOilLossDrilldownValueSet(filters.product) ||
    isOilLossDrilldownValueSet(filters.plant) ||
    isOilLossDrilldownValueSet(filters.incoterm) ||
    isOilLossDrilldownValueSet(filters.transporter) ||
    isOilLossDrilldownValueSet(filters.supplier)
  )
}

export function oilLossDrilldownSelectionsEqual(a: OilLossDrilldownFilters, b: OilLossDrilldownFilters): boolean {
  return (
    a.product === b.product &&
    a.plant === b.plant &&
    a.incoterm === b.incoterm &&
    a.transporter === b.transporter &&
    a.supplier === b.supplier
  )
}

export function buildNextOilLossDrilldownSelection(
  prev: OilLossDrilldownFilters,
  level: OilLossDrilldownCategory,
  label: string,
): OilLossDrilldownFilters {
  if (level === 'product') {
    return { product: label, plant: null, incoterm: null, transporter: null, supplier: null }
  }
  if (level === 'plant') {
    return { ...prev, plant: label, incoterm: null, transporter: null, supplier: null }
  }
  if (level === 'incoterm') {
    return { ...prev, incoterm: label, transporter: null, supplier: null }
  }
  if (level === 'transporter') {
    return { ...prev, transporter: label, supplier: null }
  }
  return { ...prev, supplier: label }
}

export function oilLossDrilldownColumnSubtitle(
  level: OilLossDrilldownCategory,
  filters: OilLossDrilldownFilters,
): string {
  switch (level) {
    case 'product':
      return isOilLossDrilldownValueSet(filters.product)
        ? `Selected: ${displayOilLossGroupLabel(filters.product)}`
        : 'Pick one'
    case 'plant':
      if (!isOilLossDrilldownValueSet(filters.product)) return 'Pick product first'
      return isOilLossDrilldownValueSet(filters.plant)
        ? `${displayOilLossGroupLabel(filters.product)} › ${displayOilLossGroupLabel(filters.plant)}`
        : `Under ${displayOilLossGroupLabel(filters.product)}`
    case 'incoterm':
      if (!isOilLossDrilldownValueSet(filters.product) || !isOilLossDrilldownValueSet(filters.plant)) {
        return 'Pick plant first'
      }
      return isOilLossDrilldownValueSet(filters.incoterm)
        ? `${displayOilLossGroupLabel(filters.product)} › ${displayOilLossGroupLabel(filters.plant)} › ${displayOilLossGroupLabel(filters.incoterm)}`
        : `Under ${displayOilLossGroupLabel(filters.product)} › ${displayOilLossGroupLabel(filters.plant)}`
    case 'transporter': {
      if (!isOilLossDrilldownValueSet(filters.incoterm)) return 'Pick incoterm first'
      const base = [filters.product, filters.plant, filters.incoterm]
        .filter(isOilLossDrilldownValueSet)
        .map(displayOilLossGroupLabel)
        .join(' › ')
      return isOilLossDrilldownValueSet(filters.transporter)
        ? `${base} › ${displayOilLossGroupLabel(filters.transporter)}`
        : `Under ${base}`
    }
    case 'supplier': {
      if (!isOilLossDrilldownValueSet(filters.transporter)) return 'Pick transporter first'
      const base = [filters.product, filters.plant, filters.incoterm, filters.transporter]
        .filter(isOilLossDrilldownValueSet)
        .map(displayOilLossGroupLabel)
        .join(' › ')
      return isOilLossDrilldownValueSet(filters.supplier)
        ? `${base} › ${displayOilLossGroupLabel(filters.supplier)}`
        : `Under ${base}`
    }
  }
}

export function formatOilLossDrilldownPath(filters: OilLossDrilldownFilters): string {
  const parts: string[] = []
  if (isOilLossDrilldownValueSet(filters.product)) parts.push(displayOilLossGroupLabel(filters.product))
  if (isOilLossDrilldownValueSet(filters.plant)) parts.push(displayOilLossGroupLabel(filters.plant))
  if (isOilLossDrilldownValueSet(filters.incoterm)) parts.push(displayOilLossGroupLabel(filters.incoterm))
  if (isOilLossDrilldownValueSet(filters.transporter)) parts.push(displayOilLossGroupLabel(filters.transporter))
  if (isOilLossDrilldownValueSet(filters.supplier)) parts.push(displayOilLossGroupLabel(filters.supplier))
  return parts.join(' › ')
}

export function applyOilLossDrilldownFilters(
  rows: OilLossSourceRow[],
  filters: OilLossDrilldownFilters,
): OilLossSourceRow[] {
  if (!hasOilLossDrilldownSelection(filters)) return rows
  return rows.filter((row) => {
    if (isOilLossDrilldownValueSet(filters.product) && groupLabelForRow(row, 'product') !== filters.product) {
      return false
    }
    if (isOilLossDrilldownValueSet(filters.plant) && groupLabelForRow(row, 'plant') !== filters.plant) {
      return false
    }
    if (isOilLossDrilldownValueSet(filters.incoterm) && groupLabelForRow(row, 'incoterm') !== filters.incoterm) {
      return false
    }
    if (
      isOilLossDrilldownValueSet(filters.transporter) &&
      groupLabelForRow(row, 'transporter') !== filters.transporter
    ) {
      return false
    }
    if (isOilLossDrilldownValueSet(filters.supplier) && groupLabelForRow(row, 'supplier') !== filters.supplier) {
      return false
    }
    return true
  })
}

type SupplierAcc = { contracts: Set<string>; totalOilLossKg: number }
type TransporterAcc = { contracts: Set<string>; totalOilLossKg: number; suppliers: Map<string, SupplierAcc> }
type IncotermAcc = { contracts: Set<string>; totalOilLossKg: number; transporters: Map<string, TransporterAcc> }
type PlantAcc = { contracts: Set<string>; totalOilLossKg: number; incoterms: Map<string, IncotermAcc> }
type ProductAcc = { contracts: Set<string>; totalOilLossKg: number; plants: Map<string, PlantAcc> }

function touchAgg(agg: { contracts: Set<string>; totalOilLossKg: number }, contractKey: string, lossKg: number) {
  agg.contracts.add(contractKey)
  agg.totalOilLossKg += lossKg
}

function sortTreeNodes(nodes: OilLossDrilldownTreeNode[]): OilLossDrilldownTreeNode[] {
  return [...nodes].sort(
    (a, b) => Math.abs(b.totalOilLossKg) - Math.abs(a.totalOilLossKg) || b.contractCount - a.contractCount,
  )
}

function suppliersToNodes(map: Map<string, SupplierAcc>): OilLossDrilldownTreeNode[] {
  return sortTreeNodes(
    [...map.entries()].map(([key, agg]) => ({
      key,
      label: key,
      contractCount: agg.contracts.size,
      totalOilLossKg: agg.totalOilLossKg,
      children: [],
    })),
  )
}

function transportersToNodes(map: Map<string, TransporterAcc>): OilLossDrilldownTreeNode[] {
  return sortTreeNodes(
    [...map.entries()].map(([key, agg]) => ({
      key,
      label: key,
      contractCount: agg.contracts.size,
      totalOilLossKg: agg.totalOilLossKg,
      children: suppliersToNodes(agg.suppliers),
    })),
  )
}

function incotermsToNodes(map: Map<string, IncotermAcc>): OilLossDrilldownTreeNode[] {
  return sortTreeNodes(
    [...map.entries()].map(([key, agg]) => ({
      key,
      label: key,
      contractCount: agg.contracts.size,
      totalOilLossKg: agg.totalOilLossKg,
      children: transportersToNodes(agg.transporters),
    })),
  )
}

function plantsToNodes(map: Map<string, PlantAcc>): OilLossDrilldownTreeNode[] {
  return sortTreeNodes(
    [...map.entries()].map(([key, agg]) => ({
      key,
      label: key,
      contractCount: agg.contracts.size,
      totalOilLossKg: agg.totalOilLossKg,
      children: incotermsToNodes(agg.incoterms),
    })),
  )
}

/** Hierarchical drilldown tree — Product → Plant → Incoterm → Transporter → Supplier. */
export function buildOilLossDrilldownTree(rows: OilLossSourceRow[]): OilLossDrilldownTreeNode[] {
  const root = new Map<string, ProductAcc>()

  for (const row of rows) {
    const contractKey = contractGroupKey(row)
    const lossKg = rowR4OilLossKg(row)
    const prod = groupLabelForRow(row, 'product')
    const plant = groupLabelForRow(row, 'plant')
    const incoterm = groupLabelForRow(row, 'incoterm')
    const transporter = groupLabelForRow(row, 'transporter')
    const supplier = groupLabelForRow(row, 'supplier')

    if (!root.has(prod)) {
      root.set(prod, { contracts: new Set(), totalOilLossKg: 0, plants: new Map() })
    }
    const pN = root.get(prod)!
    touchAgg(pN, contractKey, lossKg)

    if (!pN.plants.has(plant)) {
      pN.plants.set(plant, { contracts: new Set(), totalOilLossKg: 0, incoterms: new Map() })
    }
    const plN = pN.plants.get(plant)!
    touchAgg(plN, contractKey, lossKg)

    if (!plN.incoterms.has(incoterm)) {
      plN.incoterms.set(incoterm, { contracts: new Set(), totalOilLossKg: 0, transporters: new Map() })
    }
    const iN = plN.incoterms.get(incoterm)!
    touchAgg(iN, contractKey, lossKg)

    if (!iN.transporters.has(transporter)) {
      iN.transporters.set(transporter, { contracts: new Set(), totalOilLossKg: 0, suppliers: new Map() })
    }
    const tN = iN.transporters.get(transporter)!
    touchAgg(tN, contractKey, lossKg)

    if (!tN.suppliers.has(supplier)) {
      tN.suppliers.set(supplier, { contracts: new Set(), totalOilLossKg: 0 })
    }
    const sN = tN.suppliers.get(supplier)!
    touchAgg(sN, contractKey, lossKg)
  }

  return sortTreeNodes(
    [...root.entries()].map(([key, agg]) => ({
      key,
      label: key,
      contractCount: agg.contracts.size,
      totalOilLossKg: agg.totalOilLossKg,
      children: plantsToNodes(agg.plants),
    })),
  )
}

export function countUniqueOilLossContracts(rows: OilLossSourceRow[]): number {
  const keys = new Set<string>()
  for (const row of rows) {
    keys.add(contractGroupKey(row))
  }
  return keys.size
}

export function sumOilLossKgFromRows(rows: OilLossSourceRow[]): number {
  return rows.reduce((sum, row) => sum + rowR4OilLossKg(row), 0)
}

export const OIL_LOSS_DRILLDOWN_LEVEL_STYLES: Record<
  OilLossDrilldownCategory,
  { headerBg: string; badge: string; bar: string; border: string; selectedBorder: string }
> = {
  product: {
    headerBg: 'bg-amber-50',
    badge: 'bg-amber-100 text-amber-800',
    bar: 'bg-amber-600',
    border: 'border-amber-200',
    selectedBorder: 'border-amber-500',
  },
  plant: {
    headerBg: 'bg-emerald-50',
    badge: 'bg-emerald-100 text-emerald-800',
    bar: 'bg-emerald-600',
    border: 'border-emerald-200',
    selectedBorder: 'border-emerald-500',
  },
  incoterm: {
    headerBg: 'bg-violet-50',
    badge: 'bg-violet-100 text-violet-800',
    bar: 'bg-violet-600',
    border: 'border-violet-200',
    selectedBorder: 'border-violet-500',
  },
  transporter: {
    headerBg: 'bg-sky-50',
    badge: 'bg-sky-100 text-sky-800',
    bar: 'bg-sky-600',
    border: 'border-sky-200',
    selectedBorder: 'border-sky-500',
  },
  supplier: {
    headerBg: 'bg-rose-50',
    badge: 'bg-rose-100 text-rose-800',
    bar: 'bg-rose-600',
    border: 'border-rose-200',
    selectedBorder: 'border-rose-500',
  },
}
