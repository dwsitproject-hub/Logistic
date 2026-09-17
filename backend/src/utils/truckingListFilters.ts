/**
 * Server-side global search + column filters for trucking list (`t` + `c` joins).
 */

import { sqlTruckingLateIndicatorSortExpr } from './truckingListSort';
import { sqlRealizationEndDate, sqlShellTruckingAtaEndDate } from './truckingRealizationSql';
import { ColumnFilterPayload, parseColumnFiltersQuery } from './contractListFilters'
import { appendContractPerfSourceTypeFilter } from '../controllers/contractSqlFragments'
import { sqlTruckingPagePipelineStageExpr } from './truckingPagePipelineSql'
import { TRUCKING_LIST_CONTRACT_EXT_NO_FULL, TRUCKING_LIST_SAP_DATES_ALIAS } from './truckingListSelectSql'
import { sqlB2bEndingBuyerExpr, sqlB2bEndingUnloadExpr } from './b2bOriginEndingSql'
import {
  sqlTruckingListBaseOutstandingQtyExpr,
  sqlTruckingListResolvedDeliveryQtyExpr,
  sqlTruckingListResolvedReceiveQtyExpr,
} from './truckingQuantitySql'
import { sqlNormalizeDischargeDestination } from './dischargeDestinationAlias'

export { parseColumnFiltersQuery }

/**
 * One definition of the Late Indicator, shared with the sort and with the snapshot form.
 *
 * This used to be a second, hand-copied CASE identical to
 * `sqlTruckingLateIndicatorSortExpr`. Two copies that agree are the dangerous state rather than
 * a safe one - nothing would have failed if either were edited - and the snapshot now applies
 * this rule to its own stored columns, so "the two agree" had to stop being something checked by
 * eye.
 */
/**
 * One definition of the Late Indicator, shared with the sort, the badge and the snapshot.
 *
 * Due date against **ATA** (SAP Trucking Last Receive Date, or the last WB date), falling back to
 * **ETA** (the last daily-planning deliverable date), and finally to today.
 *
 * All three places used to disagree on the inputs, so filtering Late could return rows whose
 * badge read On Time. This filter passed the *planning* date into the ATA slot, and every place
 * passed `eta_trucking_completion_date` as the ETA - a column that is 0 of 16,552 for trucking,
 * because ETA is a shipment concept, so the fallback never fired anywhere. Correcting it moves
 * 2,908 of 7,485 YTD rows.
 *
 * `skipSapJoin` decides only where ATA comes from: the shell has no sap_processed_data, so WB is
 * all there is; the hydrate adds the SAP receive date.
 */
function lateIndicatorTruckingExpr(skipSapJoin: boolean): string {
  const ata = skipSapJoin
    ? sqlShellTruckingAtaEndDate()
    : sqlRealizationEndDate('c', TRUCKING_LIST_SAP_DATES_ALIAS);
  return sqlTruckingLateIndicatorSortExpr(
    'c.delivery_end_date',
    ata,
    // ETA = last daily-planning deliverable date. The expansion aliases this same column
    // `planning_end_date`; here it is still the raw trucking_operations column.
    't.trucking_completion_date',
  );
}

/*
 * Column expression map.
 *
 * A function rather than a constant so `status` can be built with an optional precomputed
 * GR-close column: sqlTruckingPagePipelineStageExpr emits a correlated sap_processed_data
 * subquery, and the trucking list statement carries 54 copies of it (693KB total, measured
 * 2026-08-06). A module-level constant is evaluated once at import and cannot take a per-query
 * value, so it had to become a function before the CTE can be wired in.
 *
 * Passing no grClosedExpr reproduces the previous map exactly.
 */
function truckCol(
  grClosedExpr?: string,
  cancelledExpr?: string,
  /**
   * Shell requests have no `sapd` lateral, so the Late Indicator's ATA must come from WB alone.
   * Naming an alias the FROM does not emit is a 42P01 that empties the whole page rather than
   * failing loudly - see klip-trucking-skipsapjoin-alias-scope.
   */
  skipSapJoin = false,
): Record<string, string> {
  return {
  late_indicator: lateIndicatorTruckingExpr(skipSapJoin),
  operation_id: 't.operation_id',
  contract_number: 'c.contract_id',
  po_number: 'c.po_number',
  sto_number: 'c.sto_number',
    status: sqlTruckingPagePipelineStageExpr(
      'c',
      undefined,
      undefined,
      grClosedExpr,
      undefined,
      undefined,
      cancelledExpr,
    ),
  location: sqlNormalizeDischargeDestination('t.location'),
  loading_location: 't.loading_location',
  unloading_location: sqlB2bEndingUnloadExpr('t.unloading_location'),
  trucking_owner: 't.trucking_owner',
  supplier: 'c.supplier',
  product: 'c.product',
  incoterm: 'c.incoterm',
  buyer: sqlB2bEndingBuyerExpr('c.buyer'),
  group_name: 'c.group_name',
  contract_ext_no: TRUCKING_LIST_CONTRACT_EXT_NO_FULL,
  contract_qty: 'c.quantity_ordered',
  sto_quantity: 'c.quantity_ordered',
  quantity_sent: 't.quantity_sent',
  quantity_delivered: sqlTruckingListResolvedDeliveryQtyExpr('t.id', 'c', grClosedExpr),
  quantity_receive: sqlTruckingListResolvedReceiveQtyExpr('t.id', 'c', grClosedExpr),
  outstanding_quantity: sqlTruckingListBaseOutstandingQtyExpr('c', grClosedExpr),
  oa_budget: 't.oa_budget',
  oa_actual: 't.oa_actual',
  estimated_km: 's.estimated_km',
  gain_loss_percentage: 't.gain_loss_percentage',
  gain_loss_amount: 't.gain_loss_amount',
  cargo_readiness_date: 't.cargo_readiness_date',
  trucking_start_date: 't.trucking_start_date',
  trucking_completion_date: 't.trucking_completion_date',
  eta_trucking_start_date: 't.eta_trucking_start_date',
  eta_trucking_completion_date: 't.eta_trucking_completion_date',
  delivery_start_date: 'c.delivery_start_date',
  delivery_end_date: 'c.delivery_end_date',
    created_at: 't.created_at',
  };
}

export function appendTruckingGlobalSearch(
  searchTrim: string,
  startIndex: number
): { sql: string; params: any[]; nextIndex: number } {
  if (!searchTrim || searchTrim.length < 2) {
    return { sql: '', params: [], nextIndex: startIndex }
  }
  const p = startIndex
  const likeExpr = `$${p}::text`
  const contractExtExpr = TRUCKING_LIST_CONTRACT_EXT_NO_FULL
  const sql = `
    AND (
      COALESCE(${contractExtExpr}, '') ILIKE ${likeExpr}
      OR COALESCE(c.contract_id::text, '') ILIKE ${likeExpr}
      OR COALESCE(c.po_number::text, '') ILIKE ${likeExpr}
      OR COALESCE(c.sto_number::text, '') ILIKE ${likeExpr}
    )`
  return { sql, params: [`%${searchTrim}%`], nextIndex: startIndex + 1 }
}

export function appendTruckingColumnFilters(
  filters: ColumnFilterPayload,
  startIndex: number,
  /** Optional precomputed GR-close and SAP-cancelled columns; see truckCol(). */
  grClosedExpr?: string,
  cancelledExpr?: string,
  /** Shell requests cannot reference the SAP dates lateral - see truckCol(). */
  skipSapJoin = false,
): { sql: string; params: any[]; nextIndex: number } {
  const TRUCK_COL = truckCol(grClosedExpr, cancelledExpr, skipSapJoin)
  const parts: string[] = []
  const params: any[] = []
  let pi = startIndex

  for (const [colId, raw] of Object.entries(filters)) {
    const expr = TRUCK_COL[colId]
    if (!expr || !raw || typeof raw !== 'object') continue

    const f = raw as ColumnFilterPayload[string]
    if (f.emptyOnly) {
      parts.push(` AND (${expr} IS NULL OR TRIM(${expr}::text) = '')`)
      continue
    }

    if (f.type === 'text') {
      const v = String(f.value ?? '').trim()
      if (!v) continue
      if (f.exact) {
        parts.push(` AND LOWER(TRIM(${expr}::text)) = LOWER($${pi}::text)`)
        params.push(v)
        pi += 1
      } else {
        parts.push(` AND ${expr}::text ILIKE $${pi}`)
        params.push(`%${v}%`)
        pi += 1
      }
      continue
    }

    if (f.type === 'number') {
      const minRaw = f.min !== undefined && f.min !== '' ? Number(f.min) : null
      const maxRaw = f.max !== undefined && f.max !== '' ? Number(f.max) : null
      if (minRaw !== null && !Number.isNaN(minRaw)) {
        parts.push(` AND (${expr})::numeric >= $${pi}`)
        params.push(minRaw)
        pi += 1
      }
      if (maxRaw !== null && !Number.isNaN(maxRaw)) {
        parts.push(` AND (${expr})::numeric <= $${pi}`)
        params.push(maxRaw)
        pi += 1
      }
      continue
    }

    if (f.type === 'date') {
      if (f.from) {
        parts.push(` AND (${expr})::date >= $${pi}::date`)
        params.push(f.from)
        pi += 1
      }
      if (f.to) {
        parts.push(` AND (${expr})::date <= $${pi}::date`)
        params.push(f.to)
        pi += 1
      }
      continue
    }

    if (f.type === 'multi') {
      const vals = Array.isArray(f.values) ? f.values.filter((x) => x != null && String(x).trim() !== '') : []
      const incBlank = Boolean(f.includeBlank)
      const ors: string[] = []
      if (incBlank) {
        ors.push(`(${expr} IS NULL OR TRIM(${expr}::text) = '')`)
      }
      if (vals.length > 0) {
        ors.push(`${expr}::text = ANY($${pi}::text[])`)
        params.push(vals)
        pi += 1
      }
      if (ors.length > 0) {
        parts.push(` AND (${ors.join(' OR ')})`)
      }
    }
  }

  return { sql: parts.join(''), params, nextIndex: pi }
}

export function appendTruckingLateIndicatorFilter(
  lateIndicator: string | undefined,
  startIndex: number,
  skipSapJoin = false
): { sql: string; params: any[]; nextIndex: number } {
  const v = String(lateIndicator ?? 'ALL').toUpperCase()
  if (v === 'ALL' || !v) {
    return { sql: '', params: [], nextIndex: startIndex }
  }
  const expr = lateIndicatorTruckingExpr(skipSapJoin)
  if (v === 'ON_TIME') {
    return {
      sql: ` AND ${expr} = $${startIndex}::text`,
      params: ['On Time'],
      nextIndex: startIndex + 1,
    }
  }
  if (v === 'LATE') {
    return {
      sql: ` AND ${expr} = $${startIndex}::text`,
      params: ['Late'],
      nextIndex: startIndex + 1,
    }
  }
  if (v === 'NA') {
    return {
      sql: ` AND ${expr} = $${startIndex}::text`,
      params: ['-'],
      nextIndex: startIndex + 1,
    }
  }
  return { sql: '', params: [], nextIndex: startIndex }
}

/** Toolbar source filter (Interco / 3rd Party) on contracts.source_type. */
export function appendTruckingSourceTypeFilter(
  sourceType: string | undefined,
  startIndex: number,
  columnExpr = 'c.source_type',
): { sql: string; params: any[]; nextIndex: number } {
  const sql = appendContractPerfSourceTypeFilter(sourceType, columnExpr)
  return { sql, params: [], nextIndex: startIndex }
}
