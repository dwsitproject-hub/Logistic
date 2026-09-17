/**
 * Oil Loss — Section 3 "All Contract" compact table column order, visibility, and aggregation.
 * Scoped to `/oil-loss` when viewMode === 'all_contract' only.
 */

import { mergePreservedColumnOrder } from '@/lib/columnLayoutMigration'
import { resolveCompactColumnWidthPx } from '@/lib/compactTableUi'
import {
  aggregateOilLossRowsByGroup,
  oilLossContractGroupKey as sharedOilLossContractGroupKey,
  sumNullableOilLossQtyKg as sharedSumNullableOilLossQtyKg,
  type OilLossMergedRow,
} from '@/lib/oilLossGroupAggregation'

export const OIL_LOSS_ALL_CONTRACT_COLUMN_LAYOUT_VERSION = 'oil-loss-all-contract-v3'
export const OIL_LOSS_ALL_CONTRACT_COLUMN_LAYOUT_VERSION_KEY =
  'oil-loss.all-contract.compact.columnLayoutVersion'

/** Default visible columns in left-to-right table order. */
export const OIL_LOSS_ALL_CONTRACT_DEFAULT_VISIBLE_COLUMN_IDS: readonly string[] = [
  'contract_date',
  'contract_ext_no',
  'po_number',
  'sto_number',
  'product',
  'incoterm',
  'quantity_contract',
  'quantity_delivery',
  'quantity_received',
  'r1',
  'r2',
  'r3',
  'r4',
  'status',
] as const

export const OIL_LOSS_ALL_CONTRACT_COLUMN_WIDTH_PX: Readonly<Record<string, number>> = {
  contract_date: 100,
  contract_ext_no: 120,
  po_number: 110,
  sto_number: 110,
  product: 120,
  incoterm: 72,
  quantity_contract: 96,
  quantity_delivery: 96,
  quantity_received: 96,
  r1: 96,
  r2: 96,
  r3: 96,
  r4: 96,
  status: 80,
  transport_mode: 72,
  group_name: 88,
  supplier: 120,
  buyer: 88,
  plant_site: 100,
  operation_id: 120,
  contract_number: 110,
  quantity_sfal: 96,
  quantity_sfbd: 96,
}

export type OilLossSourceRow = {
  id: string
  transport_mode?: 'LAND' | 'SEA' | string | null
  /** SAP STO Type — V (vessel) or T (trucking). */
  sto_type?: string | null
  operation_id?: string | null
  contract_number?: string | null
  contract_ext_no?: string | null
  contract_date?: string | null
  operation_date?: string | null
  sto_number?: string | null
  po_number?: string | null
  supplier?: string | null
  buyer?: string | null
  product?: string | null
  group_name?: string | null
  plant_site?: string | null
  vessel_name?: string | null
  incoterm?: string | null
  group_plant?: string | null
  quantity_contract?: number | null
  /** Qty Delivery from SAP Data (Kg). */
  quantity_delivery?: number | null
  /** Alias of quantity_delivery for legacy consumers. */
  quantity_sent?: number | null
  /** Qty Receive from SAP Data (Kg). */
  quantity_received?: number | null
  quantity_sfal?: number | null
  quantity_sfbd?: number | null
  gain_loss_amount?: number | null
  gain_loss_percentage?: number | null
  status?: string | null
  transporter?: string | null
  loading_location?: string | null
  unloading_location?: string | null
}

/**
 * SEA rows sharing one STO/voyage Operation ID are merged into a single row (summed quantities);
 * LAND rows stay one row per PO (unchanged). See `oilLossGroupAggregation.ts` for the shared logic.
 */
export type OilLossAllContractRow = OilLossMergedRow

/**
 * Sum SFAL/SFBD across rows without coercing missing values to 0.
 * All null/undefined → null (so R1–R3 stay —); genuine 0 is kept and summed.
 */
export const sumNullableOilLossQtyKg = sharedSumNullableOilLossQtyKg

/** Group key for All Contract / drilldown / R summary — prefer contract_number. */
export const oilLossContractGroupKey = sharedOilLossContractGroupKey

/**
 * All Contract rows: level 1 dedupes duplicate SAP rows of the same contract (take
 * delivery/receive once, sum SFAL/SFBD); level 2 merges distinct contracts sharing one SEA
 * voyage Operation ID into a single row (summed quantities, comma-merged PO/STO/Contract Ext No).
 * LAND rows are unaffected — see `oilLossGroupAggregation.ts`.
 */
export function aggregateOilLossByContract(rows: OilLossSourceRow[]): OilLossAllContractRow[] {
  return aggregateOilLossRowsByGroup(rows)
}

export function oilLossAllContractDefaultVisibleColumnIds(allIds: string[]): string[] {
  return OIL_LOSS_ALL_CONTRACT_DEFAULT_VISIBLE_COLUMN_IDS.filter((id) => allIds.includes(id))
}

export function oilLossAllContractCompactColumnFallbackOrder(allIds: string[]): string[] {
  const primary = [...OIL_LOSS_ALL_CONTRACT_DEFAULT_VISIBLE_COLUMN_IDS]
  const hiddenOrder = [
    'transport_mode',
    'group_name',
    'supplier',
    'buyer',
    'plant_site',
    'operation_id',
    'contract_number',
    'quantity_sfal',
    'quantity_sfbd',
  ]
  const seen = new Set<string>()
  const out: string[] = []
  for (const id of [...primary, ...hiddenOrder]) {
    if (allIds.includes(id) && !seen.has(id)) {
      out.push(id)
      seen.add(id)
    }
  }
  for (const id of allIds) {
    if (!seen.has(id)) {
      out.push(id)
      seen.add(id)
    }
  }
  return out
}

export function mergeOilLossAllContractColumnOrder(saved: string[], allIds: string[]): string[] {
  return mergePreservedColumnOrder(saved, allIds, oilLossAllContractCompactColumnFallbackOrder(allIds))
}

export function buildOilLossAllContractVisibleColumns<T extends { id: string }>(
  columns: T[],
  visibleIds: ReadonlySet<string>,
  orderIds: readonly string[],
): T[] {
  const byId = new Map(columns.map((c) => [c.id, c]))
  const order =
    orderIds.length > 0 ? orderIds : oilLossAllContractCompactColumnFallbackOrder(columns.map((c) => c.id))
  const out: T[] = []
  for (const id of order) {
    if (!visibleIds.has(id)) continue
    const col = byId.get(id)
    if (col) out.push(col)
  }
  return out
}

const OIL_LOSS_ALL_CONTRACT_DEFAULT_COLUMN_WIDTH_PX = 96

/** Match Contract/Shipping Performance: base map + header longest-word floor. */
export function oilLossAllContractTableColumnWidthPx(
  colId: string,
  headerLabel?: string,
  options?: { hasFormulaHelp?: boolean },
): number {
  const base = OIL_LOSS_ALL_CONTRACT_COLUMN_WIDTH_PX[colId] ?? OIL_LOSS_ALL_CONTRACT_DEFAULT_COLUMN_WIDTH_PX
  return resolveCompactColumnWidthPx(base, headerLabel, {
    hasFormulaHelp: options?.hasFormulaHelp,
    hasSort: true,
  })
}
