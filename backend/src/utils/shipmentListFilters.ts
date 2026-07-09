/**
 * Server-side global search + column filters on grouped shipment list (`shipment_base` alias `sb`).
 */

import { ColumnFilterPayload, parseColumnFiltersQuery } from './contractListFilters'
import {
  LEGACY_SHIPMENT_STATUS_ALIASES,
  SHIPMENT_AUTO_STATUSES,
  SHIPMENT_DISCHARGE_ETA_PHASE_STATUSES,
  SHIPMENT_LOADING_ETA_PHASE_STATUSES,
  type ShipmentAutoStatus,
} from './shipmentStatus'

export { parseColumnFiltersQuery }

function sqlQuoteStatusList(statuses: readonly ShipmentAutoStatus[]): string {
  return statuses.map((s) => `'${s}'`).join(', ')
}

function resolveShipmentStatusFilterParam(raw: string | undefined): ShipmentAutoStatus | null {
  const normalized = String(raw ?? '')
    .trim()
    .toUpperCase()
  if (!normalized || normalized === 'ALL') return null
  const legacy = LEGACY_SHIPMENT_STATUS_ALIASES[normalized]
  if (legacy) return legacy
  if ((SHIPMENT_AUTO_STATUSES as readonly string[]).includes(normalized)) {
    return normalized as ShipmentAutoStatus
  }
  return null
}

/** Late indicator: compare actual/ETA first; same calendar day = On Time. */
function lateIndicatorExpr(alias: string): string {
  return shipmentLateIndicatorCaseSql(alias);
}

export function shipmentLateIndicatorCaseSql(
  alias: string,
  cols: { ata?: string; eta?: string } = {},
): string {
  const ata = cols.ata ?? `${alias}.ata_vessel_complete_discharge`;
  const eta = cols.eta ?? `${alias}.eta_vessel_complete_discharge`;
  return `(
  CASE
    WHEN ${alias}.delivery_end_date IS NULL THEN '-'
    WHEN ${ata} IS NOT NULL THEN
      CASE
        WHEN (${alias}.delivery_end_date::date) < (${ata}::date) THEN 'Late'
        ELSE 'On Time'
      END
    WHEN ${eta} IS NOT NULL THEN
      CASE
        WHEN (${alias}.delivery_end_date::date) < (${eta}::date) THEN 'Late'
        ELSE 'On Time'
      END
    WHEN (${alias}.delivery_end_date::date) < CURRENT_DATE THEN 'Late'
    ELSE 'On Time'
  END
)`;
}

/** Boolean late filter for dashboard aggregates (matches lateIndicatorExpr). */
export function shipmentIsLateSql(
  alias: string,
  cols: { ata?: string; eta?: string } = {},
): string {
  const ata = cols.ata ?? `${alias}.ata_vessel_complete_discharge`;
  const eta = cols.eta ?? `${alias}.eta_vessel_complete_discharge`;
  return `(
    ${alias}.delivery_end_date IS NOT NULL
    AND (
      (${ata} IS NOT NULL AND (${alias}.delivery_end_date::date) < (${ata}::date))
      OR (${ata} IS NULL AND ${eta} IS NOT NULL AND (${alias}.delivery_end_date::date) < (${eta}::date))
      OR (${ata} IS NULL AND ${eta} IS NULL AND (${alias}.delivery_end_date::date) < CURRENT_DATE)
    )
  )`;
}

const SB_COL: Record<string, string> = {
  late_indicator: lateIndicatorExpr('sb'),
  operation_id: 'sb.operation_id',
  shipment_id: 'sb.shipment_id',
  sto_number: 'sb.sto_number',
  status: 'sb.status',
  contract_numbers: 'sb.contract_numbers',
  contract_number: 'sb.contract_numbers',
  po_numbers: 'sb.po_numbers',
  contract_reference_po: 'sb.contract_reference_po',
  contract_ext_no: 'sb.contract_ext_no',
  vessel_name: 'sb.vessel_name',
  vessel_code: 'sb.vessel_code',
  voyage_no: 'sb.voyage_no',
  vessel_owner: 'sb.vessel_owner',
  port_of_loading: 'sb.port_of_loading',
  port_of_discharge: 'sb.port_of_discharge',
  plant_site: 'sb.plant_site',
  supplier: 'sb.supplier',
  suppliers: 'sb.suppliers',
  buyer: 'sb.buyer',
  buyers: 'sb.buyers',
  product: 'sb.product',
  products: 'sb.products',
  incoterm: 'sb.incoterm',
  group_name: 'sb.group_name',
  group_names: 'sb.group_names',
  charter_type: 'sb.charter_type',
  shipment_date: 'sb.shipment_date',
  arrival_date: 'sb.arrival_date',
  delivery_start: 'sb.delivery_start_date',
  delivery_end: 'sb.delivery_end_date',
  delivery_start_date: 'sb.delivery_start_date',
  delivery_end_date: 'sb.delivery_end_date',
  ata_vessel_completed_loading: 'sb.ata_vessel_completed_loading',
  ata_vessel_complete_discharge: 'sb.ata_vessel_complete_discharge',
  eta_vessel_complete_discharge: 'sb.eta_vessel_complete_discharge',
  eta_discharge_complete: 'sb.eta_discharge_complete',
  quantity_shipped: 'sb.quantity_shipped',
  quantity_delivered: 'sb.quantity_delivered',
  inbound_weight: 'sb.inbound_weight',
  outbound_weight: 'sb.outbound_weight',
  gain_loss_percentage: 'sb.gain_loss_percentage',
  gain_loss_amount: 'sb.gain_loss_amount',
  estimated_km: 'sb.estimated_km',
  estimated_nautical_miles: 'sb.estimated_nautical_miles',
  vessel_oa_budget: 'sb.vessel_oa_budget',
  vessel_oa_actual: 'sb.vessel_oa_actual',
  bl_quantity: 'sb.bl_quantity',
  actual_vessel_qty_receive: 'sb.actual_vessel_qty_receive',
  difference_final_qty_vs_bl_qty: 'sb.difference_final_qty_vs_bl_qty',
  average_vessel_speed: 'sb.average_vessel_speed',
  vessel_draft: 'sb.vessel_draft',
  vessel_loa: 'sb.vessel_loa',
  vessel_capacity: 'sb.vessel_capacity',
  vessel_hull_type: 'sb.vessel_hull_type',
  vessel_registration_year: 'sb.vessel_registration_year',
  sla_days: 'sb.sla_days',
  created_at: 'sb.created_at',
}

export function appendShipmentGlobalSearch(
  searchTrim: string,
  startIndex: number
): { sql: string; params: any[]; nextIndex: number } {
  if (!searchTrim || searchTrim.length < 2) {
    return { sql: '', params: [], nextIndex: startIndex }
  }
  const p = startIndex
  const likeExpr = `$${p}::text`
  const sql = `
    AND (
      COALESCE(sb.contract_ext_no::text, '') ILIKE ${likeExpr}
      OR COALESCE(sb.contract_numbers::text, '') ILIKE ${likeExpr}
      OR COALESCE(sb.po_numbers::text, '') ILIKE ${likeExpr}
      OR COALESCE(sb.sto_number::text, '') ILIKE ${likeExpr}
      OR COALESCE(sb.vessel_name::text, '') ILIKE ${likeExpr}
    )`
  return { sql, params: [`%${searchTrim}%`], nextIndex: startIndex + 1 }
}

export function appendShipmentColumnFilters(
  filters: ColumnFilterPayload,
  startIndex: number
): { sql: string; params: any[]; nextIndex: number } {
  const parts: string[] = []
  const params: any[] = []
  let pi = startIndex

  for (const [colId, raw] of Object.entries(filters)) {
    const expr =
      colId === 'status' ? shipmentEffectiveStatusExpr('sb') : SB_COL[colId]
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

/** Toolbar late-indicator filter (matches `late_indicator` text). */
export function appendShipmentLateIndicatorFilter(
  lateIndicator: string | undefined,
  startIndex: number
): { sql: string; params: any[]; nextIndex: number } {
  const v = String(lateIndicator ?? 'ALL').toUpperCase()
  if (v === 'ALL' || !v) {
    return { sql: '', params: [], nextIndex: startIndex }
  }
  const expr = lateIndicatorExpr('sb')
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

/** View-by dropdown: narrow to one dimension (optional). */
export function appendShipmentViewOptionFilter(
  viewOption: string | undefined,
  viewQuery: string | undefined,
  startIndex: number
): { sql: string; params: any[]; nextIndex: number } {
  const mode = String(viewOption ?? 'all').toLowerCase()
  const q = String(viewQuery ?? '').trim()
  if (mode === 'all' || q.length < 1) {
    return { sql: '', params: [], nextIndex: startIndex }
  }
  const p = startIndex
  if (mode === 'sto') {
    return {
      // STO view should also match synthetic operation_id and shipment_id.
      sql: ` AND (
        COALESCE(sb.sto_number::text, '') ILIKE $${p}
        OR COALESCE(sb.operation_id::text, '') ILIKE $${p}
        OR COALESCE(sb.shipment_id::text, '') ILIKE $${p}
      )`,
      params: [`%${q}%`],
      nextIndex: startIndex + 1,
    }
  }
  if (mode === 'contract') {
    return {
      sql: ` AND COALESCE(sb.contract_numbers::text, '') ILIKE $${p}`,
      params: [`%${q}%`],
      nextIndex: startIndex + 1,
    }
  }
  if (mode === 'contract_ext' || mode === 'contract_ext_no') {
    return {
      sql: ` AND COALESCE(sb.contract_ext_no::text, '') ILIKE $${p}`,
      params: [`%${q}%`],
      nextIndex: startIndex + 1,
    }
  }
  if (mode === 'vessel') {
    return {
      sql: ` AND COALESCE(sb.vessel_name::text, '') ILIKE $${p}`,
      params: [`%${q}%`],
      nextIndex: startIndex + 1,
    }
  }
  if (mode === 'port_loading') {
    return {
      sql: ` AND COALESCE(sb.port_of_loading::text, '') ILIKE $${p}`,
      params: [`%${q}%`],
      nextIndex: startIndex + 1,
    }
  }
  if (mode === 'port_discharge') {
    const p2 = startIndex + 1
    return {
      sql: ` AND (COALESCE(sb.port_of_discharge::text, '') ILIKE $${p} OR COALESCE(sb.plant_site::text, '') ILIKE $${p2})`,
      params: [`%${q}%`, `%${q}%`],
      nextIndex: startIndex + 2,
    }
  }
  return { sql: '', params: [], nextIndex: startIndex }
}

/** Whitelist for GET ?etaLoading= / ?etaDischarge= (mirrors shipments page toolbar). */
const ETA_BUCKET_CODES = new Set(['MORE_THAN_7D', 'D_MINUS_2', 'D', 'DELAY', 'NO_ETA'])

export function normalizeShipmentEtaBucketParam(raw: unknown): string | null {
  const s = String(raw ?? '')
    .trim()
    .toUpperCase()
  if (!s || s === 'ALL') return null
  return ETA_BUCKET_CODES.has(s) ? s : null
}

/**
 * Matches frontend ETA Loading / ETA Discharge bucket rules on grouped `shipment_base` (`sb`):
 * - Uses calendar day diff: (eta::date - CURRENT_DATE), same as JS Date midnights on the server TZ.
 * - Skips rows that would show as COMPLETED after ATA derivation (all 9 ATA milestones present on sb).
 * - Priority: NO_ETA → DELAY → D → D_MINUS_2 → MORE_THAN_7D; else GAP (matches no toolbar bucket).
 */
/** True when grouped row has at least one shipment-level ETA milestone. */
export function shipmentHasAnyEtaExpr(alias: string): string {
  const f = alias
  return `(
    ${f}.eta_arrival IS NOT NULL OR ${f}.eta_berthed IS NOT NULL OR ${f}.eta_loading_start IS NOT NULL OR ${f}.eta_loading_complete IS NOT NULL OR ${f}.eta_sailed IS NOT NULL
    OR ${f}.eta_discharge_arrival IS NOT NULL OR ${f}.eta_discharge_berthed IS NOT NULL OR ${f}.eta_discharge_start IS NOT NULL OR ${f}.eta_vessel_complete_discharge IS NOT NULL
  )`
}

/**
 * Effective SEA shipment status on grouped list rows (`shipment_base` / `filtered_shipments`).
 * Mirrors deriveShipmentStatus — granular ATA tiers for Shipments module.
 */
export function shipmentEffectiveStatusExpr(alias: string): string {
  const f = alias
  return `(
    CASE
      WHEN UPPER(TRIM(COALESCE(${f}.status, ''))) = 'CANCELLED' THEN 'CANCELLED'
      WHEN COALESCE(${f}.is_contract_sap_closed, FALSE) IS TRUE THEN 'COMPLETED'
      WHEN ${f}.ata_vessel_complete_discharge IS NOT NULL THEN 'COMPLETED'
      WHEN ${f}.ata_vessel_start_discharging IS NOT NULL THEN 'UNLOADING'
      WHEN ${f}.ata_vessel_berthed_at_discharge_port IS NOT NULL THEN 'BERTHED_DP'
      WHEN ${f}.ata_vessel_arrive_at_discharge_port IS NOT NULL THEN 'ARRIVED_DP'
      WHEN ${f}.ata_vessel_sailed_from_loading_port IS NOT NULL THEN 'SAILED'
      WHEN ${f}.ata_vessel_completed_loading IS NOT NULL THEN 'COMPLETED_LOADING'
      WHEN ${f}.ata_vessel_start_loading IS NOT NULL THEN 'LOADING'
      WHEN ${f}.ata_vessel_berthed_at_loading_port IS NOT NULL THEN 'BERTHED_LP'
      WHEN ${f}.ata_vessel_arrival_at_loading_port IS NOT NULL THEN 'ARRIVED_LP'
      WHEN ${shipmentHasAnyEtaExpr(f)} THEN 'PLANNED'
      ELSE 'UNPLANNED'
    END
  )`
}

/** Statuses that contribute to ETA Loading buckets (matches shipmentsPageDerivedData). */
export function shipmentLoadingEtaPhaseExpr(alias: string): string {
  return `${shipmentEffectiveStatusExpr(alias)} IN (${sqlQuoteStatusList(SHIPMENT_LOADING_ETA_PHASE_STATUSES)})`
}

/** Statuses that contribute to ETA Discharge buckets (matches shipmentsPageDerivedData). */
export function shipmentDischargeEtaPhaseExpr(alias: string): string {
  return `${shipmentEffectiveStatusExpr(alias)} IN (${sqlQuoteStatusList(SHIPMENT_DISCHARGE_ETA_PHASE_STATUSES)})`
}

/** Filter list rows by derived status (matches deriveShipmentStatus / shipmentEffectiveStatusExpr). */
export function appendShipmentStatusFilter(
  statusParam: string | undefined,
  startIndex: number
): { sql: string; params: unknown[]; nextIndex: number } {
  const resolved = resolveShipmentStatusFilterParam(statusParam)
  if (!resolved) {
    return { sql: '', params: [], nextIndex: startIndex }
  }

  return {
    sql: ` AND ${shipmentEffectiveStatusExpr('sb')} = $${startIndex}`,
    params: [resolved],
    nextIndex: startIndex + 1,
  }
}

/** Section 2 ETA summary scope when a status card is active (toolbar scope unchanged). */
export function appendShipmentScopeStatusFilter(
  scopeStatusParam: string | undefined,
  startIndex: number
): { sql: string; params: unknown[]; nextIndex: number } {
  const resolved = resolveShipmentStatusFilterParam(scopeStatusParam)
  if (!resolved) {
    return { sql: '', params: [], nextIndex: startIndex }
  }

  return {
    sql: ` AND ${shipmentEffectiveStatusExpr('sb')} = $${startIndex}`,
    params: [resolved],
    nextIndex: startIndex + 1,
  }
}

export function appendShipmentEtaBucketFilters(
  etaLoading: string | null,
  etaDischarge: string | null
): { sql: string; params: any[]; nextIndex: number } {
  if (!etaLoading && !etaDischarge) {
    return { sql: '', params: [], nextIndex: 0 }
  }

  const ataCompleted = `(
    sb.ata_vessel_arrival_at_loading_port IS NOT NULL
    AND sb.ata_vessel_berthed_at_loading_port IS NOT NULL
    AND sb.ata_vessel_start_loading IS NOT NULL
    AND sb.ata_vessel_completed_loading IS NOT NULL
    AND sb.ata_vessel_sailed_from_loading_port IS NOT NULL
    AND sb.ata_vessel_arrive_at_discharge_port IS NOT NULL
    AND sb.ata_vessel_berthed_at_discharge_port IS NOT NULL
    AND sb.ata_vessel_start_discharging IS NOT NULL
    AND sb.ata_vessel_complete_discharge IS NOT NULL
  )`

  const loadingEtasAllNull = `(
    sb.eta_arrival IS NULL
    AND sb.eta_berthed IS NULL
    AND sb.eta_loading_start IS NULL
    AND sb.eta_loading_complete IS NULL
    AND sb.eta_sailed IS NULL
  )`

  const dischargeEtasAllNull = `(
    sb.eta_discharge_arrival IS NULL
    AND sb.eta_discharge_berthed IS NULL
    AND sb.eta_discharge_start IS NULL
    AND sb.eta_discharge_complete IS NULL
  )`

  const mkDiff = (col: string) => `(${col}::date - CURRENT_DATE)`

  const loadingCols = [
    'sb.eta_arrival',
    'sb.eta_berthed',
    'sb.eta_loading_start',
    'sb.eta_loading_complete',
    'sb.eta_sailed',
  ]
  const dischargeCols = [
    'sb.eta_discharge_arrival',
    'sb.eta_discharge_berthed',
    'sb.eta_discharge_start',
    'sb.eta_discharge_complete',
  ]

  const anyLoading = (pred: (d: string) => string) =>
    loadingCols
      .map((c) => {
        const d = mkDiff(c)
        return `(${c} IS NOT NULL AND ${pred(d)})`
      })
      .join(' OR ')

  const anyDischarge = (pred: (d: string) => string) =>
    dischargeCols
      .map((c) => {
        const d = mkDiff(c)
        return `(${c} IS NOT NULL AND ${pred(d)})`
      })
      .join(' OR ')

  const loadingDelay = anyLoading((d) => `${d} < 0`)
  const loadingToday = anyLoading((d) => `${d} = 0`)
  const loadingDMinus2 = anyLoading((d) => `${d} >= 1 AND ${d} <= 2`)
  const loadingM7 = anyLoading((d) => `${d} > 7`)

  const dischargeDelay = anyDischarge((d) => `${d} < 0`)
  const dischargeToday = anyDischarge((d) => `${d} = 0`)
  const dischargeDMinus2 = anyDischarge((d) => `${d} >= 1 AND ${d} <= 2`)
  const dischargeM7 = anyDischarge((d) => `${d} > 7`)

  const loadingBucket = `
    CASE
      WHEN ${ataCompleted} THEN NULL
      WHEN ${loadingEtasAllNull} THEN 'NO_ETA'
      WHEN (${loadingDelay}) THEN 'DELAY'
      WHEN (${loadingToday}) THEN 'D'
      WHEN (${loadingDMinus2}) THEN 'D_MINUS_2'
      WHEN (${loadingM7}) THEN 'MORE_THAN_7D'
      ELSE 'GAP'
    END
  `

  const dischargeBucket = `
    CASE
      WHEN ${ataCompleted} THEN NULL
      WHEN ${dischargeEtasAllNull} THEN 'NO_ETA'
      WHEN (${dischargeDelay}) THEN 'DELAY'
      WHEN (${dischargeToday}) THEN 'D'
      WHEN (${dischargeDMinus2}) THEN 'D_MINUS_2'
      WHEN (${dischargeM7}) THEN 'MORE_THAN_7D'
      ELSE 'GAP'
    END
  `

  const parts: string[] = []
  if (etaLoading) {
    parts.push(` AND ${shipmentLoadingEtaPhaseExpr('sb')} AND (${loadingBucket}) = '${etaLoading}'`)
  }
  if (etaDischarge) {
    parts.push(` AND ${shipmentDischargeEtaPhaseExpr('sb')} AND (${dischargeBucket}) = '${etaDischarge}'`)
  }

  return { sql: parts.join(''), params: [], nextIndex: 0 }
}
