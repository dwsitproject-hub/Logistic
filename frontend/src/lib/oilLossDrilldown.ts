import type { OilLossSourceRow } from '@/lib/oilLossAllContractColumns'
import { aggregateOilLossRowsByGroup, type OilLossMergedRow } from '@/lib/oilLossGroupAggregation'

export type OilLossDrilldownCategory = 'product' | 'plant' | 'incoterm' | 'transporter' | 'supplier'

export const OIL_LOSS_DRILLDOWN_CATEGORIES: ReadonlyArray<{
  level: OilLossDrilldownCategory
  title: string
}> = [
  { level: 'product', title: 'Product' },
  { level: 'plant', title: 'Region/Site' },
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

function normalizeGroupLabel(value: unknown, fallback = 'Blank'): string {
  const trimmed = String(value ?? '').trim()
  return trimmed || fallback
}

/**
 * R4 basis (Qty Receive − Qty Delivery) on an already-merged group (one row per contract, or
 * one row per SEA voyage when it spans multiple contracts — quantities are pre-summed).
 */
function groupR4OilLossKg(group: OilLossMergedRow): number {
  if (group.quantity_delivery <= 0) return 0
  return group.quantity_received - group.quantity_delivery
}

function touchAgg(agg: { contracts: Set<string>; totalOilLossKg: number }, groupKey: string, lossKg: number) {
  // Count each group (voyage/contract) once — delivery/receive are already group-level totals.
  if (agg.contracts.has(groupKey)) return
  agg.contracts.add(groupKey)
  agg.totalOilLossKg += lossKg
}

export function groupLabelForRow(row: OilLossSourceRow, category: OilLossDrilldownCategory): string {
  switch (category) {
    case 'product':
      return normalizeGroupLabel(row.product)
    case 'plant':
      return normalizeGroupLabel(row.plant_site || row.group_plant)
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
        return 'Pick region/site first'
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

/**
 * Hierarchical drilldown tree — Product → Region/Site → Incoterm → Transporter → Supplier.
 * Rows are first merged into one row per group (SEA voyage or LAND contract/PO) so a
 * multi-PO SEA voyage contributes its summed R4 loss once, not once per member PO.
 */
export function buildOilLossDrilldownTree(rows: OilLossSourceRow[]): OilLossDrilldownTreeNode[] {
  const groups = aggregateOilLossRowsByGroup(rows)
  const root = new Map<string, ProductAcc>()

  for (const group of groups) {
    const contractKey = group.id
    const lossKg = groupR4OilLossKg(group)
    const prod = groupLabelForRow(group, 'product')
    const plant = groupLabelForRow(group, 'plant')
    const incoterm = groupLabelForRow(group, 'incoterm')
    const transporter = groupLabelForRow(group, 'transporter')
    const supplier = groupLabelForRow(group, 'supplier')

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

/** Counts distinct groups (SEA voyages / LAND contracts) — not raw SAP rows. */
export function countUniqueOilLossContracts(rows: OilLossSourceRow[]): number {
  return aggregateOilLossRowsByGroup(rows).length
}

export function sumOilLossKgFromRows(rows: OilLossSourceRow[]): number {
  const groups = aggregateOilLossRowsByGroup(rows)
  let sum = 0
  for (const group of groups) {
    sum += groupR4OilLossKg(group)
  }
  return sum
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
