import type { OilLossSourceRow } from '@/lib/oilLossAllContractColumns'
import { aggregateOilLossRowsByGroup, type OilLossMergedRow } from '@/lib/oilLossGroupAggregation'
import { oilLossLoadingPortLabel } from '@/lib/oilLossLoadingPort'

/**
 * Oil Loss drilldown: Product > Vessel > Loading Port > Supplier.
 * (It was Product > Region/Plant > Incoterm > Transporter > Supplier. The page counts FOB vessel voyages only, so Incoterm and
 * Transporter no longer separate anything: the transporter of a vessel row IS the vessel. Region/Plant stays a filter of the page.)
 */
export type OilLossDrilldownCategory = 'product' | 'vessel' | 'loadingPort' | 'supplier'

export const OIL_LOSS_DRILLDOWN_CATEGORIES: ReadonlyArray<{
  level: OilLossDrilldownCategory
  title: string
}> = [
  { level: 'product', title: 'Product' },
  { level: 'vessel', title: 'Vessel' },
  { level: 'loadingPort', title: 'Loading Port' },
  { level: 'supplier', title: 'Supplier' },
] as const

export type OilLossDrilldownFilters = {
  product: string | null
  vessel: string | null
  loadingPort: string | null
  supplier: string | null
}

export const EMPTY_OIL_LOSS_DRILLDOWN_FILTERS: OilLossDrilldownFilters = {
  product: null,
  vessel: null,
  loadingPort: null,
  supplier: null,
}

export type OilLossDrilldownTreeNode = {
  key: string
  label: string
  contractCount: number
  /** Unweighted average Loss % across groups in this node. Null when no group has a measurable Loss (Qty Delivery and Qty Receive both above zero). */
  avgLossPct: number | null
  children: OilLossDrilldownTreeNode[]
}

function normalizeGroupLabel(value: unknown, fallback = 'Blank'): string {
  const trimmed = String(value ?? '').trim()
  return trimmed || fallback
}

/**
 * Whether a merged group has a measurable Loss. The same rule the table and the R1-Loss cards use: Qty Delivery AND Qty Receive both above zero.
 * A voyage whose receive is still 0 (not received yet, or never filled in) shows "-" in the table; it is not a 100% loss, so it must not
 * pull a drilldown average down either.
 */
function groupHasMeasurableLoss(group: OilLossMergedRow): boolean {
  return group.quantity_delivery > 0 && group.quantity_received > 0
}

/**
 * R4 / Loss kg (Qty Receive − Qty Delivery) on an already-merged group (one row per contract, or
 * one row per SEA voyage when it spans multiple contracts — quantities are pre-summed).
 * Zero when the group has no measurable Loss.
 */
function groupR4OilLossKg(group: OilLossMergedRow): number {
  if (!groupHasMeasurableLoss(group)) return 0
  return group.quantity_received - group.quantity_delivery
}

/** Loss % for one group. Null when the group has no measurable Loss (see groupHasMeasurableLoss). */
function groupLossPct(group: OilLossMergedRow): number | null {
  if (!groupHasMeasurableLoss(group)) return null
  return (groupR4OilLossKg(group) / group.quantity_delivery) * 100
}

type PctAcc = { contracts: Set<string>; pctSum: number; pctCount: number }

function touchAgg(agg: PctAcc, groupKey: string, pct: number | null) {
  // Count each group (voyage/contract) once — delivery/receive are already group-level totals.
  if (agg.contracts.has(groupKey)) return
  agg.contracts.add(groupKey)
  if (pct == null) return
  agg.pctSum += pct
  agg.pctCount += 1
}

function avgLossPctFromAcc(agg: PctAcc): number | null {
  if (agg.pctCount === 0) return null
  return agg.pctSum / agg.pctCount
}

export function groupLabelForRow(row: OilLossSourceRow, category: OilLossDrilldownCategory): string {
  switch (category) {
    case 'product':
      return normalizeGroupLabel(row.product)
    case 'vessel':
      // transporter is the vessel name for a vessel row; it only covers a row whose vessel_name came through blank
      return normalizeGroupLabel(row.vessel_name || row.transporter)
    case 'loadingPort':
      return oilLossLoadingPortLabel(row)
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
    isOilLossDrilldownValueSet(filters.vessel) ||
    isOilLossDrilldownValueSet(filters.loadingPort) ||
    isOilLossDrilldownValueSet(filters.supplier)
  )
}

export function oilLossDrilldownSelectionsEqual(a: OilLossDrilldownFilters, b: OilLossDrilldownFilters): boolean {
  return (
    a.product === b.product &&
    a.vessel === b.vessel &&
    a.loadingPort === b.loadingPort &&
    a.supplier === b.supplier
  )
}

/** Picking a level keeps the levels above it and clears the ones below, so the path stays a path. */
export function buildNextOilLossDrilldownSelection(
  prev: OilLossDrilldownFilters,
  level: OilLossDrilldownCategory,
  label: string,
): OilLossDrilldownFilters {
  if (level === 'product') {
    return { product: label, vessel: null, loadingPort: null, supplier: null }
  }
  if (level === 'vessel') {
    return { ...prev, vessel: label, loadingPort: null, supplier: null }
  }
  if (level === 'loadingPort') {
    return { ...prev, loadingPort: label, supplier: null }
  }
  return { ...prev, supplier: label }
}

/** The labels picked so far, in level order, as the subtitle of a column shows them. */
function pathLabels(filters: OilLossDrilldownFilters, upTo: OilLossDrilldownCategory): string {
  const order: OilLossDrilldownCategory[] = ['product', 'vessel', 'loadingPort', 'supplier']
  return order
    .slice(0, order.indexOf(upTo) + 1)
    .map((level) => filters[level])
    .filter(isOilLossDrilldownValueSet)
    .map(displayOilLossGroupLabel)
    .join(' › ')
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
    case 'vessel': {
      if (!isOilLossDrilldownValueSet(filters.product)) return 'Pick product first'
      return isOilLossDrilldownValueSet(filters.vessel)
        ? pathLabels(filters, 'vessel')
        : `Under ${displayOilLossGroupLabel(filters.product)}`
    }
    case 'loadingPort': {
      if (!isOilLossDrilldownValueSet(filters.vessel)) return 'Pick vessel first'
      return isOilLossDrilldownValueSet(filters.loadingPort)
        ? pathLabels(filters, 'loadingPort')
        : `Under ${pathLabels(filters, 'vessel')}`
    }
    case 'supplier': {
      if (!isOilLossDrilldownValueSet(filters.loadingPort)) return 'Pick loading port first'
      return isOilLossDrilldownValueSet(filters.supplier)
        ? pathLabels(filters, 'supplier')
        : `Under ${pathLabels(filters, 'loadingPort')}`
    }
  }
}

export function formatOilLossDrilldownPath(filters: OilLossDrilldownFilters): string {
  return pathLabels(filters, 'supplier')
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
    if (isOilLossDrilldownValueSet(filters.vessel) && groupLabelForRow(row, 'vessel') !== filters.vessel) {
      return false
    }
    if (
      isOilLossDrilldownValueSet(filters.loadingPort) &&
      groupLabelForRow(row, 'loadingPort') !== filters.loadingPort
    ) {
      return false
    }
    if (isOilLossDrilldownValueSet(filters.supplier) && groupLabelForRow(row, 'supplier') !== filters.supplier) {
      return false
    }
    return true
  })
}

type SupplierAcc = PctAcc
type LoadingPortAcc = PctAcc & { suppliers: Map<string, SupplierAcc> }
type VesselAcc = PctAcc & { loadingPorts: Map<string, LoadingPortAcc> }
type ProductAcc = PctAcc & { vessels: Map<string, VesselAcc> }

function emptyPctAcc(): PctAcc {
  return { contracts: new Set(), pctSum: 0, pctCount: 0 }
}

function sortTreeNodes(nodes: OilLossDrilldownTreeNode[]): OilLossDrilldownTreeNode[] {
  return [...nodes].sort(
    (a, b) => Math.abs(b.avgLossPct ?? 0) - Math.abs(a.avgLossPct ?? 0) || b.contractCount - a.contractCount,
  )
}

function suppliersToNodes(map: Map<string, SupplierAcc>): OilLossDrilldownTreeNode[] {
  return sortTreeNodes(
    [...map.entries()].map(([key, agg]) => ({
      key,
      label: key,
      contractCount: agg.contracts.size,
      avgLossPct: avgLossPctFromAcc(agg),
      children: [],
    })),
  )
}

function loadingPortsToNodes(map: Map<string, LoadingPortAcc>): OilLossDrilldownTreeNode[] {
  return sortTreeNodes(
    [...map.entries()].map(([key, agg]) => ({
      key,
      label: key,
      contractCount: agg.contracts.size,
      avgLossPct: avgLossPctFromAcc(agg),
      children: suppliersToNodes(agg.suppliers),
    })),
  )
}

function vesselsToNodes(map: Map<string, VesselAcc>): OilLossDrilldownTreeNode[] {
  return sortTreeNodes(
    [...map.entries()].map(([key, agg]) => ({
      key,
      label: key,
      contractCount: agg.contracts.size,
      avgLossPct: avgLossPctFromAcc(agg),
      children: loadingPortsToNodes(agg.loadingPorts),
    })),
  )
}

/**
 * Hierarchical drilldown tree — Product → Vessel → Loading Port → Supplier.
 * Rows are first merged into one row per voyage (one STO, or its Operation ID) so a multi-PO STO
 * contributes one Loss % sample, not one per member PO.
 */
export function buildOilLossDrilldownTree(rows: OilLossSourceRow[]): OilLossDrilldownTreeNode[] {
  const groups = aggregateOilLossRowsByGroup(rows)
  const root = new Map<string, ProductAcc>()

  for (const group of groups) {
    const contractKey = group.id
    const pct = groupLossPct(group)
    const prod = groupLabelForRow(group, 'product')
    const vessel = groupLabelForRow(group, 'vessel')
    const loadingPort = groupLabelForRow(group, 'loadingPort')
    const supplier = groupLabelForRow(group, 'supplier')

    if (!root.has(prod)) {
      root.set(prod, { ...emptyPctAcc(), vessels: new Map() })
    }
    const pN = root.get(prod)!
    touchAgg(pN, contractKey, pct)

    if (!pN.vessels.has(vessel)) {
      pN.vessels.set(vessel, { ...emptyPctAcc(), loadingPorts: new Map() })
    }
    const vN = pN.vessels.get(vessel)!
    touchAgg(vN, contractKey, pct)

    if (!vN.loadingPorts.has(loadingPort)) {
      vN.loadingPorts.set(loadingPort, { ...emptyPctAcc(), suppliers: new Map() })
    }
    const lN = vN.loadingPorts.get(loadingPort)!
    touchAgg(lN, contractKey, pct)

    if (!lN.suppliers.has(supplier)) {
      lN.suppliers.set(supplier, emptyPctAcc())
    }
    const sN = lN.suppliers.get(supplier)!
    touchAgg(sN, contractKey, pct)
  }

  return sortTreeNodes(
    [...root.entries()].map(([key, agg]) => ({
      key,
      label: key,
      contractCount: agg.contracts.size,
      avgLossPct: avgLossPctFromAcc(agg),
      children: vesselsToNodes(agg.vessels),
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
  vessel: {
    headerBg: 'bg-sky-50',
    badge: 'bg-sky-100 text-sky-800',
    bar: 'bg-sky-600',
    border: 'border-sky-200',
    selectedBorder: 'border-sky-500',
  },
  loadingPort: {
    headerBg: 'bg-emerald-50',
    badge: 'bg-emerald-100 text-emerald-800',
    bar: 'bg-emerald-600',
    border: 'border-emerald-200',
    selectedBorder: 'border-emerald-500',
  },
  supplier: {
    headerBg: 'bg-rose-50',
    badge: 'bg-rose-100 text-rose-800',
    bar: 'bg-rose-600',
    border: 'border-rose-200',
    selectedBorder: 'border-rose-500',
  },
}
