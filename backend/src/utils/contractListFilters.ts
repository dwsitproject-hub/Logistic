/**
 * Server-side global search + column filters for contracts list (base CTE scope).
 */

import { sqlContractOutstandingSignedExpr } from './sapIncotermMetrics';

export type ColumnFilterPayload = Record<
  string,
  {
    type?: string
    value?: string
    exact?: boolean
    emptyOnly?: boolean
    notBlankOnly?: boolean
    min?: string
    max?: string
    from?: string
    to?: string
    values?: string[]
    includeBlank?: boolean
  }
>

export function parseColumnFiltersQuery(raw: unknown): ColumnFilterPayload {
  if (raw == null || raw === '') return {}
  if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
    return raw as ColumnFilterPayload
  }
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw) as ColumnFilterPayload
      return parsed && typeof parsed === 'object' ? parsed : {}
    } catch {
      return {}
    }
  }
  return {}
}

/** SQL expressions on `base` (must match getContracts SELECT/WHERE scope). */
const BASE_COL_SQL: Record<string, string> = {
  contract_id: 'base.contract_id',
  contract_ext_no: `COALESCE(base.latest_spd_data->'raw'->>'Contract Ext No', base.latest_spd_data->>'Contract Ext No', '')`,
  product: 'base.product',
  supplier: 'base.supplier',
  buyer: 'base.buyer',
  group_name: 'base.group_name',
  transport_mode: 'base.transport_mode',
  incoterm: 'base.incoterm',
  company_name: `COALESCE(NULLIF(TRIM(base.company_name), ''), base.latest_spd_data->'raw'->>'Buyer', base.latest_spd_data->>'Buyer', '')`,
  lt_spot: `COALESCE(base.latest_spd_data->'contract'->>'ltc_spot', base.contract_type::text, '')`,
  po_number: `COALESCE(base.po_numbers, '')`,
  sto_number: `COALESCE(base.sto_numbers_agg::text, base.sto_number::text, '')`,
  b2b_flag: `COALESCE(base.latest_spd_data->'contract'->>'contract_type', base.latest_spd_data->>'B2B Flag', '')`,
  contract_date: 'base.contract_date',
  delivery_start: 'base.delivery_start_date',
  delivery_end: 'base.delivery_end_date',
  cargo_readiness_date: 'base.cargo_readiness_date',
  created_at: 'base.created_at',
  contract_qty: 'base.quantity_ordered',
  outstanding_qty: sqlContractOutstandingSignedExpr({
    contractQtyExpr: 'base.quantity_ordered',
    incotermExpr: 'base.incoterm',
    receiveExpr: 'base.quantity_receive',
    deliveryExpr: 'base.quantity_delivery_sap',
  }),
  delivery_status: `COALESCE(base.import_status, base.status::text, '')`,
}

export function appendGlobalSearchBase(
  searchTrim: string,
  paramIndex: number
): { sql: string; params: any[]; nextIndex: number } {
  if (!searchTrim || searchTrim.length < 2) {
    return { sql: '', params: [], nextIndex: paramIndex }
  }
  const p = paramIndex
  const likeExpr = `$${p}::text`
  const sql = `
    AND (
      base.contract_id::text ILIKE ${likeExpr}
      OR COALESCE(base.po_numbers, '') ILIKE ${likeExpr}
      OR COALESCE(base.sto_number::text, '') ILIKE ${likeExpr}
      OR COALESCE(base.sto_numbers_agg::text, '') ILIKE ${likeExpr}
      OR COALESCE(base.supplier, '') ILIKE ${likeExpr}
      OR COALESCE(base.product, '') ILIKE ${likeExpr}
      OR COALESCE(base.buyer, '') ILIKE ${likeExpr}
      OR COALESCE(base.group_name, '') ILIKE ${likeExpr}
      OR COALESCE(base.latest_spd_data->'raw'->>'Contract Ext No', base.latest_spd_data->>'Contract Ext No', '') ILIKE ${likeExpr}
    )`
  return { sql, params: [`%${searchTrim}%`], nextIndex: paramIndex + 1 }
}

export function appendColumnFiltersBase(
  filters: ColumnFilterPayload,
  startParamIndex: number
): { sql: string; params: any[]; nextIndex: number } {
  const parts: string[] = []
  const params: any[] = []
  let pi = startParamIndex

  for (const [colId, raw] of Object.entries(filters)) {
    const expr = BASE_COL_SQL[colId]
    if (!expr || !raw || typeof raw !== 'object') continue

    const f = raw as ColumnFilterPayload[string]
    if (f.emptyOnly) {
      parts.push(` AND (${expr} IS NULL OR TRIM(${expr}::text) = '')`)
      continue
    }
    if (f.notBlankOnly) {
      parts.push(` AND (${expr} IS NOT NULL AND TRIM(${expr}::text) != '')`)
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
