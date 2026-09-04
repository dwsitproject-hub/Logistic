import { query } from '../database/connection'
import { sqlContractIsPresent } from '../utils/sapPresenceSql'
import {
  aggregateLatePerformanceRows,
  loadLatePerformanceRows,
  LatePerformanceFilters,
} from './latePerformance.service'
import { sqlB2bOriginEndingChildLateralJoin } from '../utils/b2bOriginEndingSql'
import { REGION_SITE_FILTER_OPTIONS_SQL, sqlRegionSiteDisplayFromJsonAndB2b } from '../utils/regionSiteSql'

/**
 * Region/Site = SAP Discharge Destination (same dimension as operational filters).
 * Keep this in step with latePerformance.service plant_site.
 */

export const SQL_GROUP_PLANT_LATERAL_JOINS = `
  LEFT JOIN LATERAL (
    SELECT spd.data
    FROM sap_processed_data spd
    WHERE spd.contract_number = c.contract_id
    ORDER BY spd.created_at DESC NULLS LAST
    LIMIT 1
  ) spd_rs ON TRUE
  ${sqlB2bOriginEndingChildLateralJoin({ originPoExpr: 'c.po_number', alias: 'b2b_end_rs' })}
`

export const SQL_RESOLVED_GROUP_PLANT = sqlRegionSiteDisplayFromJsonAndB2b('spd_rs.data', 'b2b_end_rs')

function sqlRegionSiteEqualsParam(paramSql: string): string {
  return `UPPER(NULLIF(TRIM(${SQL_RESOLVED_GROUP_PLANT}), 'Blank')) = UPPER(${paramSql})`
}

/**
 * Delivered quantity by incoterm, matching the expression already used for the agent's
 * global product summary so an area breakdown and the global one stay comparable.
 */
export const SQL_DELIVERED_QTY = `
  CASE
    WHEN UPPER(TRIM(COALESCE(c.incoterm, ''))) IN ('FRC', 'CIF', 'CFR') THEN COALESCE(db.quantity_receive, 0)
    WHEN UPPER(TRIM(COALESCE(c.incoterm, ''))) IN ('LCO', 'FOB') THEN COALESCE(db.quantity_delivery, 0)
    ELSE COALESCE(db.total_sto_quantity, 0)
  END
`

export const SQL_DELIVERED_BY_CONTRACT_CTE = `
  delivered_by_contract AS (
    SELECT
      spd.contract_number AS contract_id,
      COALESCE(SUM(
        CAST(REPLACE(REPLACE(COALESCE(spd.data->'raw'->>'Quantity Receive', spd.data->'raw'->>'Qty Receive'), ',', ''), ' ', '') AS NUMERIC)
      ) FILTER (
        WHERE NULLIF(TRIM(COALESCE(spd.data->'raw'->>'Quantity Receive', spd.data->'raw'->>'Qty Receive')), '') IS NOT NULL
      ), 0)::numeric AS quantity_receive,
      COALESCE(SUM(
        CAST(REPLACE(REPLACE(COALESCE(spd.data->'raw'->>'Quantity Delivered', spd.data->'raw'->>'Quantity Delivery'), ',', ''), ' ', '') AS NUMERIC)
      ) FILTER (
        WHERE NULLIF(TRIM(COALESCE(spd.data->'raw'->>'Quantity Delivered', spd.data->'raw'->>'Quantity Delivery')), '') IS NOT NULL
      ), 0)::numeric AS quantity_delivery,
      COALESCE(SUM(
        CAST(REPLACE(REPLACE(COALESCE(spd.data->'contract'->>'sto_quantity', ''), ',', ''), ' ', '') AS NUMERIC)
      ) FILTER (
        WHERE spd.data->'contract'->>'sto_quantity' IS NOT NULL AND TRIM(spd.data->'contract'->>'sto_quantity') != ''
      ), 0)::numeric AS total_sto_quantity
    FROM sap_processed_data spd
    WHERE spd.contract_number IS NOT NULL AND TRIM(spd.contract_number) != ''
    GROUP BY spd.contract_number
  )
`

export type GroupPlantProductRow = {
  product: string
  contract_count: number
  total_quantity: number
  delivered_quantity: number
  outstanding_quantity: number
}

const GROUP_PLANT_TTL_MS = 10 * 60 * 1000
let groupPlantCache: { names: string[]; expiresAt: number } | null = null

/** Reset the memoized Region/Site list (tests, or after SAP import). */
export function resetGroupPlantCache(): void {
  groupPlantCache = null
}

/** Distinct SAP Discharge Destination values (operational Region/Site). */
export async function listGroupPlants(): Promise<string[]> {
  if (groupPlantCache && Date.now() < groupPlantCache.expiresAt) {
    return groupPlantCache.names
  }
  const res = await query(REGION_SITE_FILTER_OPTIONS_SQL)
  const names = (res.rows || []).map((r: { group_plant: string }) => String(r.group_plant)).filter(Boolean)
  groupPlantCache = { names, expiresAt: Date.now() + GROUP_PLANT_TTL_MS }
  return names
}

/**
 * Find a Group Plant mentioned in free text. Data-driven rather than a hardcoded list of
 * area names, so adding a plant group in Master Plant List needs no code change.
 * Longest match wins so "Bulking Batam" beats a bare "Batam".
 */
export function matchGroupPlantInText(text: string, groupPlants: string[]): string | null {
  const haystack = ` ${String(text || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ')} `
  const matches = groupPlants
    .filter((name) => {
      const needle = ` ${name.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ')} `
      return haystack.includes(needle)
    })
    .sort((a, b) => b.length - a.length)
  return matches[0] ?? null
}

/**
 * Per-product contract totals for one Group Plant. Withdrawn contracts are excluded so the
 * numbers line up with Contract Performance rather than the agent's unfiltered global summary.
 */
export async function getGroupPlantProductBreakdown(
  groupPlant: string,
): Promise<GroupPlantProductRow[]> {
  const res = await query(
    `
    WITH ${SQL_DELIVERED_BY_CONTRACT_CTE}
    SELECT
      COALESCE(NULLIF(TRIM(c.product), ''), 'Blank') AS product,
      COUNT(DISTINCT c.contract_id)::int AS contract_count,
      COALESCE(SUM(c.quantity_ordered), 0)::numeric AS total_quantity,
      COALESCE(SUM(${SQL_DELIVERED_QTY}), 0)::numeric AS delivered_quantity,
      COALESCE(SUM(c.quantity_ordered), 0)::numeric - COALESCE(SUM(${SQL_DELIVERED_QTY}), 0)::numeric AS outstanding_quantity
    FROM contracts c
    LEFT JOIN delivered_by_contract db ON db.contract_id = c.contract_id
    ${SQL_GROUP_PLANT_LATERAL_JOINS}
    WHERE ${sqlContractIsPresent('c')}
      AND ${sqlRegionSiteEqualsParam('$1')}
    GROUP BY COALESCE(NULLIF(TRIM(c.product), ''), 'Blank')
    ORDER BY outstanding_quantity DESC NULLS LAST
    `,
    [groupPlant],
  )
  return (res.rows || []).map((r: any) => ({
    product: String(r.product),
    contract_count: Number(r.contract_count || 0),
    total_quantity: Number(r.total_quantity || 0),
    delivered_quantity: Number(r.delivered_quantity || 0),
    outstanding_quantity: Number(r.outstanding_quantity || 0),
  }))
}

/** Contract counts per Group Plant, so the LLM path knows the dimension and its values. */
export async function getGroupPlantContractCounts(): Promise<
  Array<{ group_plant: string; contract_count: number; outstanding_quantity: number }>
> {
  const res = await query(`
    WITH ${SQL_DELIVERED_BY_CONTRACT_CTE}
    SELECT
      ${SQL_RESOLVED_GROUP_PLANT} AS group_plant,
      COUNT(DISTINCT c.contract_id)::int AS contract_count,
      COALESCE(SUM(c.quantity_ordered), 0)::numeric - COALESCE(SUM(${SQL_DELIVERED_QTY}), 0)::numeric AS outstanding_quantity
    FROM contracts c
    LEFT JOIN delivered_by_contract db ON db.contract_id = c.contract_id
    ${SQL_GROUP_PLANT_LATERAL_JOINS}
    WHERE ${sqlContractIsPresent('c')}
    GROUP BY ${SQL_RESOLVED_GROUP_PLANT}
    ORDER BY outstanding_quantity DESC NULLS LAST
  `)
  return (res.rows || []).map((r: any) => ({
    group_plant: String(r.group_plant),
    contract_count: Number(r.contract_count || 0),
    outstanding_quantity: Number(r.outstanding_quantity || 0),
  }))
}

const PRODUCT_TTL_MS = 10 * 60 * 1000
let productCache: { names: string[]; expiresAt: number } | null = null

/** Reset the memoized product list (tests). */
export function resetProductCache(): void {
  productCache = null
}

/** Product names that actually exist on contracts. */
export async function listProducts(): Promise<string[]> {
  if (productCache && Date.now() < productCache.expiresAt) return productCache.names
  const res = await query(`
    SELECT DISTINCT TRIM(product) AS product
    FROM contracts
    WHERE NULLIF(TRIM(product), '') IS NOT NULL
    ORDER BY 1
  `)
  const names = (res.rows || []).map((r: any) => String(r.product)).filter(Boolean)
  productCache = { names, expiresAt: Date.now() + PRODUCT_TTL_MS }
  return names
}

/** Longest-match product lookup, so "WASTE OIL (POME)" wins over a bare "OIL". */
export function matchProductInText(text: string, products: string[]): string | null {
  const norm = (v: string) => ` ${v.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()} `
  const haystack = norm(text)
  const matches = products
    .filter((p) => {
      const needle = norm(p)
      return needle.trim().length >= 2 && haystack.includes(needle)
    })
    .sort((a, b) => b.length - a.length)
  return matches[0] ?? null
}

export type ProductPlantRow = {
  group_plant: string
  contract_count: number
  total_quantity: number
  delivered_quantity: number
  outstanding_quantity: number
}

/**
 * One product broken down by Group Plant — the product x plant crosstab the agent previously
 * lacked, which forced it to say "I cannot tell you which site is driving the outstanding".
 */
export async function getProductGroupPlantBreakdown(product: string): Promise<ProductPlantRow[]> {
  const res = await query(
    `
    WITH ${SQL_DELIVERED_BY_CONTRACT_CTE}
    SELECT
      ${SQL_RESOLVED_GROUP_PLANT} AS group_plant,
      COUNT(DISTINCT c.contract_id)::int AS contract_count,
      COALESCE(SUM(c.quantity_ordered), 0)::numeric AS total_quantity,
      COALESCE(SUM(${SQL_DELIVERED_QTY}), 0)::numeric AS delivered_quantity,
      COALESCE(SUM(c.quantity_ordered), 0)::numeric - COALESCE(SUM(${SQL_DELIVERED_QTY}), 0)::numeric AS outstanding_quantity
    FROM contracts c
    LEFT JOIN delivered_by_contract db ON db.contract_id = c.contract_id
    ${SQL_GROUP_PLANT_LATERAL_JOINS}
    WHERE ${sqlContractIsPresent('c')}
      AND TRIM(UPPER(COALESCE(c.product, ''))) = TRIM(UPPER($1))
    GROUP BY ${SQL_RESOLVED_GROUP_PLANT}
    ORDER BY outstanding_quantity DESC NULLS LAST
    `,
    [product],
  )
  return (res.rows || []).map((r: any) => ({
    group_plant: String(r.group_plant),
    contract_count: Number(r.contract_count || 0),
    total_quantity: Number(r.total_quantity || 0),
    delivered_quantity: Number(r.delivered_quantity || 0),
    outstanding_quantity: Number(r.outstanding_quantity || 0),
  }))
}

/**
 * Compact product x Group Plant outstanding matrix for the LLM context.
 *
 * Without this the model has product totals and plant totals but no crosstab, so a "deep dive on
 * CPO" ends in "I cannot tell you which site is driving the outstanding". Capped to the largest
 * products and outstanding-only to keep the prompt small.
 */
export async function getProductPlantOutstandingMatrix(
  productLimit = 6,
): Promise<Array<{ product: string; group_plant: string; outstanding_quantity: number }>> {
  const res = await query(
    `
    WITH ${SQL_DELIVERED_BY_CONTRACT_CTE},
    scoped AS (
      SELECT
        COALESCE(NULLIF(TRIM(c.product), ''), 'Blank') AS product,
        ${SQL_RESOLVED_GROUP_PLANT} AS group_plant,
        c.quantity_ordered - ${SQL_DELIVERED_QTY} AS outstanding_quantity
      FROM contracts c
      LEFT JOIN delivered_by_contract db ON db.contract_id = c.contract_id
      ${SQL_GROUP_PLANT_LATERAL_JOINS}
      WHERE ${sqlContractIsPresent('c')}
    ),
    top_products AS (
      SELECT product
      FROM scoped
      GROUP BY product
      ORDER BY SUM(outstanding_quantity) DESC NULLS LAST
      LIMIT $1
    )
    SELECT s.product, s.group_plant, ROUND(SUM(s.outstanding_quantity))::numeric AS outstanding_quantity
    FROM scoped s
    INNER JOIN top_products tp ON tp.product = s.product
    GROUP BY s.product, s.group_plant
    ORDER BY s.product, outstanding_quantity DESC NULLS LAST
    `,
    [productLimit],
  )
  return (res.rows || []).map((r: any) => ({
    product: String(r.product),
    group_plant: String(r.group_plant),
    outstanding_quantity: Number(r.outstanding_quantity || 0),
  }))
}

export type AgingBucketRow = {
  bucket: string
  sort_order: number
  contract_count: number
  outstanding_quantity: number
  oldest_delivery_end: string | null
}

/**
 * Aging of OPEN (status ACTIVE) contracts, bucketed by how far past delivery_end_date they are.
 *
 * Overdue-against-the-delivery-window is the exposure that matters commercially (fulfilment and
 * penalty risk), so that is the definition used — not age since contract_date. Contracts still
 * inside their window are reported as "Not yet due" so the buckets always sum to the open book.
 * Outstanding is summed as-is and can be negative where a contract over-delivered.
 */
export async function getContractAgingBuckets(opts?: {
  product?: string | null
  groupPlant?: string | null
}): Promise<AgingBucketRow[]> {
  const params: string[] = []
  let where = ''
  if (opts?.product) {
    params.push(opts.product)
    where += ` AND TRIM(UPPER(COALESCE(c.product, ''))) = TRIM(UPPER($${params.length}))`
  }
  if (opts?.groupPlant) {
    params.push(opts.groupPlant)
    where += ` AND ${sqlRegionSiteEqualsParam(`$${params.length}`)}`
  }

  const res = await query(
    `
    WITH ${SQL_DELIVERED_BY_CONTRACT_CTE},
    open_contracts AS (
      SELECT
        c.contract_id,
        c.delivery_end_date,
        c.quantity_ordered - ${SQL_DELIVERED_QTY} AS outstanding_quantity,
        CASE
          WHEN c.delivery_end_date IS NULL THEN 5
          WHEN c.delivery_end_date >= CURRENT_DATE THEN 0
          WHEN CURRENT_DATE - c.delivery_end_date <= 30 THEN 1
          WHEN CURRENT_DATE - c.delivery_end_date <= 60 THEN 2
          WHEN CURRENT_DATE - c.delivery_end_date <= 90 THEN 3
          ELSE 4
        END AS sort_order
      FROM contracts c
      LEFT JOIN delivered_by_contract db ON db.contract_id = c.contract_id
      ${SQL_GROUP_PLANT_LATERAL_JOINS}
      WHERE ${sqlContractIsPresent('c')}
        AND UPPER(TRIM(COALESCE(c.status, ''))) = 'ACTIVE'
        ${where}
    )
    SELECT
      sort_order,
      CASE sort_order
        WHEN 0 THEN 'Not yet due'
        WHEN 1 THEN '1-30 days overdue'
        WHEN 2 THEN '31-60 days overdue'
        WHEN 3 THEN '61-90 days overdue'
        WHEN 4 THEN 'Over 90 days overdue'
        ELSE 'No delivery end date'
      END AS bucket,
      COUNT(DISTINCT contract_id)::int AS contract_count,
      COALESCE(SUM(outstanding_quantity), 0)::numeric AS outstanding_quantity,
      MIN(delivery_end_date)::text AS oldest_delivery_end
    FROM open_contracts
    GROUP BY sort_order
    ORDER BY sort_order
    `,
    params,
  )
  return (res.rows || []).map((r: any) => ({
    bucket: String(r.bucket),
    sort_order: Number(r.sort_order),
    contract_count: Number(r.contract_count || 0),
    outstanding_quantity: Number(r.outstanding_quantity || 0),
    oldest_delivery_end: r.oldest_delivery_end ? String(r.oldest_delivery_end) : null,
  }))
}

const INCOTERM_TTL_MS = 10 * 60 * 1000
let incotermCache: { names: string[]; expiresAt: number } | null = null

/** Reset the memoized incoterm list (tests). */
export function resetIncotermCache(): void {
  incotermCache = null
}

/**
 * Incoterms that actually exist on contracts.
 *
 * Data-driven on purpose: the previous hardcoded list omitted FRC and LCO — the two largest
 * incoterms in this deployment — so "for FRC, which supplier..." silently dropped the filter and
 * answered across every incoterm.
 */
export async function listIncoterms(): Promise<string[]> {
  if (incotermCache && Date.now() < incotermCache.expiresAt) return incotermCache.names
  const res = await query(`
    SELECT DISTINCT UPPER(TRIM(incoterm)) AS incoterm
    FROM contracts
    WHERE NULLIF(TRIM(incoterm), '') IS NOT NULL
    ORDER BY 1
  `)
  const names = (res.rows || []).map((r: any) => String(r.incoterm)).filter(Boolean)
  incotermCache = { names, expiresAt: Date.now() + INCOTERM_TTL_MS }
  return names
}

/** Whole-word incoterm lookup, longest match first. */
export function matchIncotermInText(text: string, incoterms: string[]): string | null {
  const haystack = ` ${String(text || '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').replace(/\s+/g, ' ')} `
  const hits = incoterms
    .filter((code) => code.trim().length >= 2 && haystack.includes(` ${code.trim()} `))
    .sort((a, b) => b.length - a.length)
  return hits[0] ?? null
}

/** Dimensions the agent can group a breakdown by. */
export type BreakdownDimension = 'incoterm' | 'supplier' | 'group_supplier' | 'product' | 'group_plant';

const DIMENSION_SQL: Record<BreakdownDimension, { expr: string; label: string }> = {
  incoterm: { expr: `COALESCE(NULLIF(TRIM(c.incoterm), ''), 'Blank')`, label: 'Incoterm' },
  supplier: { expr: `COALESCE(NULLIF(TRIM(c.supplier), ''), 'Unknown')`, label: 'Supplier' },
  group_supplier: { expr: `COALESCE(NULLIF(TRIM(c.group_name), ''), 'Ungrouped')`, label: 'Group Supplier' },
  product: { expr: `COALESCE(NULLIF(TRIM(c.product), ''), 'Blank')`, label: 'Product' },
  group_plant: { expr: SQL_RESOLVED_GROUP_PLANT, label: 'Region/Plant' },
};

export type BreakdownRow = {
  dims: string[]
  contract_count: number
  total_quantity: number
  delivered_quantity: number
  outstanding_quantity: number
  earliest_due_date: string | null
  latest_due_date: string | null
  overdue_contracts: number
}

export type BreakdownRequest = {
  dimensions: BreakdownDimension[]
  product?: string | null
  groupPlant?: string | null
  incoterm?: string | null
  limit?: number
}

/**
 * Group-by breakdown over any combination of dimensions, with optional product / area / incoterm
 * filters.
 *
 * Added because the single-purpose matchers each handled exactly one dimension and would claim a
 * multi-dimension question anyway: "outstanding CPO in Bontang by Incoterm and Group Supplier"
 * was answered with company-wide incoterm totals — ignoring the product, the area and the second
 * dimension entirely. One flexible query answers the question actually asked.
 *
 * Due-date columns come from open (ACTIVE) contracts only, so "what should I chase" reflects live
 * commitments rather than closed history.
 */
export async function getFlexibleBreakdown(req: BreakdownRequest): Promise<BreakdownRow[]> {
  const dims = req.dimensions.length > 0 ? req.dimensions : ['incoterm' as BreakdownDimension]
  const needsPlantJoin = dims.includes('group_plant') || Boolean(req.groupPlant)

  const params: string[] = []
  const where: string[] = [sqlContractIsPresent('c')]
  if (req.product) {
    params.push(req.product)
    where.push(`TRIM(UPPER(COALESCE(c.product, ''))) = TRIM(UPPER($${params.length}))`)
  }
  if (req.groupPlant) {
    params.push(req.groupPlant)
    where.push(sqlRegionSiteEqualsParam(`$${params.length}`))
  }
  if (req.incoterm) {
    params.push(req.incoterm)
    where.push(`UPPER(COALESCE(NULLIF(TRIM(c.incoterm), ''), 'BLANK')) = UPPER($${params.length})`)
  }

  const dimExprs = dims.map((d) => DIMENSION_SQL[d].expr)
  const selectDims = dimExprs.map((e, i) => `${e} AS dim_${i}`).join(',\n      ')
  const groupBy = dimExprs.join(', ')
  const openPred = `UPPER(TRIM(COALESCE(c.status, ''))) = 'ACTIVE'`

  const res = await query(
    `
    WITH ${SQL_DELIVERED_BY_CONTRACT_CTE}
    SELECT
      ${selectDims},
      COUNT(DISTINCT c.contract_id)::int AS contract_count,
      COALESCE(SUM(c.quantity_ordered), 0)::numeric AS total_quantity,
      COALESCE(SUM(${SQL_DELIVERED_QTY}), 0)::numeric AS delivered_quantity,
      COALESCE(SUM(c.quantity_ordered), 0)::numeric - COALESCE(SUM(${SQL_DELIVERED_QTY}), 0)::numeric AS outstanding_quantity,
      MIN(c.delivery_end_date) FILTER (WHERE ${openPred})::text AS earliest_due_date,
      MAX(c.delivery_end_date) FILTER (WHERE ${openPred})::text AS latest_due_date,
      COUNT(DISTINCT c.contract_id) FILTER (
        WHERE ${openPred} AND c.delivery_end_date IS NOT NULL AND c.delivery_end_date < CURRENT_DATE
      )::int AS overdue_contracts
    FROM contracts c
    LEFT JOIN delivered_by_contract db ON db.contract_id = c.contract_id
    ${needsPlantJoin ? SQL_GROUP_PLANT_LATERAL_JOINS : ''}
    WHERE ${where.join('\n      AND ')}
    GROUP BY ${groupBy}
    ORDER BY outstanding_quantity DESC NULLS LAST
    LIMIT ${Math.max(1, Math.min(req.limit ?? 40, 200))}
    `,
    params,
  )

  return (res.rows || []).map((r: any) => ({
    dims: dims.map((_, i) => String(r[`dim_${i}`] ?? '')),
    contract_count: Number(r.contract_count || 0),
    total_quantity: Number(r.total_quantity || 0),
    delivered_quantity: Number(r.delivered_quantity || 0),
    outstanding_quantity: Number(r.outstanding_quantity || 0),
    earliest_due_date: r.earliest_due_date ? String(r.earliest_due_date) : null,
    latest_due_date: r.latest_due_date ? String(r.latest_due_date) : null,
    overdue_contracts: Number(r.overdue_contracts || 0),
  }))
}

export function breakdownDimensionLabel(dim: BreakdownDimension): string {
  return DIMENSION_SQL[dim].label
}

export type GroupPlantPerformance = {
  lateCount: number
  onTrackCount: number
  lateAvgDays: number
}

/**
 * Late / on-track counts for one Group Plant, taken from the same service and aggregator the
 * Contract Performance page uses. The on-time rule lives in JS (trade-cycle comparison), so
 * re-deriving it in SQL here would risk numbers that disagree with the page — hence the reuse.
 *
 * `plants` is only honoured when scope is 'filtered', and leaving the date bounds undefined
 * means "all contract dates" rather than the page's YTD default — callers must say so.
 */
export async function getGroupPlantPerformance(groupPlant: string): Promise<GroupPlantPerformance> {
  const filters: LatePerformanceFilters = {
    scope: 'filtered',
    effectiveDateFrom: undefined,
    effectiveDateTo: undefined,
    debug: false,
    // Distinct namespace so the agent can never read or evict the page's cached rows.
    cacheKey: `agent:groupPlantPerf:${groupPlant}`,
    status: undefined,
    supplier: undefined,
    buyer: undefined,
    dateFrom: undefined,
    dateTo: undefined,
    companyCode: undefined,
    transportMode: undefined,
    plant: [groupPlant],
    globalSearch: '',
    selectedIncoterms: undefined,
    b2bFlag: undefined,
    productFilter: undefined,
    productFilters: [],
    sourceTypeFilter: undefined,
    sourceTypeFilters: [],
    statusNorm: '',
    sqlStatusNorm: '',
    plants: [groupPlant],
  }

  const rows = await loadLatePerformanceRows(filters)
  const agg = aggregateLatePerformanceRows(rows, filters, 'summary') as {
    summary?: { count?: number; avgDays?: number }
    onTrackSummary?: { count?: number }
  }

  return {
    lateCount: Number(agg?.summary?.count || 0),
    onTrackCount: Number(agg?.onTrackSummary?.count || 0),
    lateAvgDays: Number(agg?.summary?.avgDays || 0),
  }
}
