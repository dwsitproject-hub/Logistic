export type ColumnFilterPayload = Record<
  string,
  {
    type?: 'text' | 'number' | 'date' | 'multi'
    value?: string
    exact?: boolean
    emptyOnly?: boolean
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
  if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) return raw as ColumnFilterPayload
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

/**
 * SQL expressions on claim_mutu_rows scope.
 * NOTE: aging buckets are computed in SELECT as aliases; use full CASE expressions here.
 */
const COL_SQL: Record<string, string> = {
  vendor: `COALESCE(vendor_name,'') || ' ' || COALESCE(vendor_code,'')`,
  vendor_code: `vendor_code`,
  vendor_name: `vendor_name`,
  group_name: `group_name`,
  cargo_source: `cargo_source`,
  created_by: `created_by`,
  sta: `sta`,
  crno: `crno`,
  cr_date: `cr_date`,
  os_days: `os_days`,
  dest: `dest`,
  po_number: `po_number`,
  contract_ext_no: `contract_ext_no`,
  comm: `comm`,
  product: `product`,
  uom: `uom`,
  currency: `currency`,
  company_code: `company_code`,
  mutu_klaim_ffa: `mutu_klaim_ffa`,
  mutu_klaim_mi: `mutu_klaim_mi`,
  mutu_klaim_dns: `mutu_klaim_dns`,
  mutu_klaim_dobi: `mutu_klaim_dobi`,
  mutu_klaim_stone: `mutu_klaim_stone`,
  qty_claim_kg: `qty_claim_kg`,
  amount_after_tax_idr: `amount_after_tax_idr`,
  a_lt_30: `CASE WHEN os_days IS NOT NULL AND os_days < 30 THEN COALESCE(amount_after_tax_idr, 0) ELSE 0 END`,
  a_30_60: `CASE WHEN os_days IS NOT NULL AND os_days >= 30 AND os_days <= 60 THEN COALESCE(amount_after_tax_idr, 0) ELSE 0 END`,
  a_61_90: `CASE WHEN os_days IS NOT NULL AND os_days > 60 AND os_days <= 90 THEN COALESCE(amount_after_tax_idr, 0) ELSE 0 END`,
  a_gt_90: `CASE WHEN os_days IS NOT NULL AND os_days > 90 THEN COALESCE(amount_after_tax_idr, 0) ELSE 0 END`,
}

export function appendColumnFiltersClaimMutu(
  filters: ColumnFilterPayload,
  startParamIndex: number
): { sql: string; params: any[]; nextIndex: number } {
  const parts: string[] = []
  const params: any[] = []
  let pi = startParamIndex

  for (const [colId, raw] of Object.entries(filters)) {
    const expr = COL_SQL[colId]
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
        params.push(vals.map((v) => String(v)))
        pi += 1
      }
      if (ors.length > 0) {
        parts.push(` AND (${ors.join(' OR ')})`)
      }
      continue
    }
  }

  return { sql: parts.join(''), params, nextIndex: pi }
}

