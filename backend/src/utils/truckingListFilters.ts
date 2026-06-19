/**
 * Server-side global search + column filters for trucking list (`t` + `c` joins).
 */

import { ColumnFilterPayload, parseColumnFiltersQuery } from './contractListFilters'
import { sqlTruckingEffectiveStatus } from './truckingEffectiveStatus'

export { parseColumnFiltersQuery }

function lateIndicatorTruckingExpr(): string {
  return `(
  CASE
    WHEN c.delivery_end_date IS NULL THEN '-'
    WHEN t.trucking_completion_date IS NOT NULL THEN
      CASE
        WHEN c.delivery_end_date::date < t.trucking_completion_date::date THEN 'Late'
        ELSE 'On Time'
      END
    WHEN t.eta_trucking_completion_date IS NOT NULL THEN
      CASE
        WHEN c.delivery_end_date::date < t.eta_trucking_completion_date::date THEN 'Late'
        ELSE 'On Time'
      END
    WHEN c.delivery_end_date::date < CURRENT_DATE THEN 'Late'
    ELSE 'On Time'
  END
)`;
}

const TRUCK_COL: Record<string, string> = {
  late_indicator: lateIndicatorTruckingExpr(),
  operation_id: 't.operation_id',
  contract_number: 'c.contract_id',
  po_number: 'c.po_number',
  sto_number: 'c.sto_number',
  status: sqlTruckingEffectiveStatus('c'),
  location: 't.location',
  loading_location: 't.loading_location',
  unloading_location: 't.unloading_location',
  trucking_owner: 't.trucking_owner',
  supplier: 'c.supplier',
  product: 'c.product',
  incoterm: 'c.incoterm',
  buyer: 'c.buyer',
  group_name: 'c.group_name',
  contract_ext_no: `(SELECT COALESCE(spd.data->'raw'->>'Contract Ext No', spd.data->>'Contract Ext No') FROM sap_processed_data spd WHERE spd.contract_number = c.contract_id ORDER BY spd.created_at DESC NULLS LAST LIMIT 1)`,
  contract_qty: 'c.quantity_ordered',
  sto_quantity: 'c.quantity_ordered',
  quantity_sent: 't.quantity_sent',
  quantity_delivered: 't.quantity_delivered',
  quantity_receive: 'COALESCE(t.quantity_delivered, 0)',
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
  const contractExtExpr = `(SELECT COALESCE(spd.data->'raw'->>'Contract Ext No', spd.data->>'Contract Ext No') FROM sap_processed_data spd WHERE spd.contract_number = c.contract_id ORDER BY spd.created_at DESC NULLS LAST LIMIT 1)`
  const sql = `
    AND (
      COALESCE(t.operation_id::text, '') ILIKE ${likeExpr}
      OR COALESCE(c.contract_id::text, '') ILIKE ${likeExpr}
      OR COALESCE(${contractExtExpr}, '') ILIKE ${likeExpr}
      OR COALESCE(c.sto_number::text, '') ILIKE ${likeExpr}
      OR COALESCE(c.po_number::text, '') ILIKE ${likeExpr}
      OR COALESCE(t.loading_location::text, '') ILIKE ${likeExpr}
      OR COALESCE(t.unloading_location::text, '') ILIKE ${likeExpr}
      OR COALESCE(t.trucking_owner::text, '') ILIKE ${likeExpr}
      OR COALESCE(c.supplier::text, '') ILIKE ${likeExpr}
    )`
  return { sql, params: [`%${searchTrim}%`], nextIndex: startIndex + 1 }
}

export function appendTruckingColumnFilters(
  filters: ColumnFilterPayload,
  startIndex: number
): { sql: string; params: any[]; nextIndex: number } {
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
  startIndex: number
): { sql: string; params: any[]; nextIndex: number } {
  const v = String(lateIndicator ?? 'ALL').toUpperCase()
  if (v === 'ALL' || !v) {
    return { sql: '', params: [], nextIndex: startIndex }
  }
  const expr = lateIndicatorTruckingExpr()
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
