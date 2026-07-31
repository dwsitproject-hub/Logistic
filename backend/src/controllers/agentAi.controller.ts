import { Response } from 'express'
import * as XLSX from 'xlsx'
import { query } from '../database/connection'
import { AuthRequest } from '../middleware/auth'
import logger from '../utils/logger'
import {
  AI_KLIP_AGENT,
  resolveAnthropicAgentApiKeyName,
  truncateActivityText,
} from '../constants/aiKlipAgent'
import { logAiKlipAgentActivity } from '../services/aiKlipAgentActivityLog.service'
import { sqlContractIsPresent } from '../utils/sapPresenceSql'
import {
  AgentLesson,
  detectStatedPreferences,
  distillLessonFromFeedback,
  loadLessons,
  markLessonsApplied,
  recordLesson,
  renderLessonsForPrompt,
} from '../services/agentAiMemory.service'
import { SQL_DELIVERED_BY_CONTRACT_CTE, SQL_DELIVERED_QTY } from '../services/agentGroupPlant.service'
import {
  breakdownDimensionLabel,
  BreakdownDimension,
  getContractAgingBuckets,
  getFlexibleBreakdown,
  listIncoterms,
  matchIncotermInText,
  getGroupPlantContractCounts,
  getGroupPlantPerformance,
  getGroupPlantProductBreakdown,
  getProductGroupPlantBreakdown,
  getProductPlantOutstandingMatrix,
  listGroupPlants,
  listProducts,
  matchGroupPlantInText,
  matchProductInText,
} from '../services/agentGroupPlant.service'
import {
  askKlipAgentClaude,
  describeAnthropicError,
  isAnthropicConfigured,
  isSupportedAgentImageMediaType,
  KlipAgentImage,
  MAX_IMAGE_BYTES,
} from '../services/klipAgentAi.service'

/**
 * Structured Report payload. The Report section used to be plain pre-wrapped text, which is hard
 * to scan for a breakdown; the frontend renders this as a real table plus a chart when one fits.
 * `report` stays populated as a text fallback.
 */
export type AgentReportTable = {
  title: string
  columns: Array<{ key: string; label: string; align?: 'left' | 'right' }>
  rows: Array<Record<string, string | number | null>>
  totals?: Record<string, string | number | null>
  chart?: {
    type: 'bar' | 'pie'
    labelKey: string
    valueKey: string
    valueLabel: string
  }
}

type AgentAiResult = {
  answer: string
  report: string
  insights: string
  comparison: string
  clarification?: string
  reportTable?: AgentReportTable | null
}

type DirectAnswer = {
  matched: boolean
  result?: AgentAiResult
  factText?: string
  sourceLabel?: string
}

const extractYear = (text: string): number | null => {
  const m = text.match(/\b(20\d{2})\b/)
  if (!m) return null
  const y = Number(m[1])
  if (!Number.isFinite(y) || y < 2000 || y > 2100) return null
  return y
}

const extractProductHintFromText = (text: string): string | null => {
  const q = text.toLowerCase()
  if (q.includes('cpo')) return 'cpo'
  const common = ['pko', 'olein', 'stearin', 'rbdpo', 'cpko', 'pome', 'pfad']
  const hit = common.find((k) => q.includes(k))
  return hit || null
}

const extractIncotermHint = (text: string): string | null => {
  const q = text.toUpperCase()
  const known = ['FOB', 'CIF', 'EXW', 'DAP', 'DDP', 'FCA', 'CFR', 'CNF', 'CPT', 'CIP']
  for (const k of known) {
    if (q.includes(k)) return k
  }
  return null
}

const tokenize = (text: string): string[] =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((x) => x.length >= 3)

const jaccard = (a: string[], b: string[]): number => {
  if (a.length === 0 || b.length === 0) return 0
  const sa = new Set(a)
  const sb = new Set(b)
  let inter = 0
  sa.forEach((x) => {
    if (sb.has(x)) inter += 1
  })
  const union = sa.size + sb.size - inter
  return union <= 0 ? 0 : inter / union
}

const truncateText = (value: string, maxChars: number): string => {
  if (!value) return ''
  return value.length <= maxChars ? value : `${value.slice(0, maxChars)}\n...[truncated]`
}

const extractJsonBlock = (raw: string): string => {
  const cleaned = raw.trim()
  if (!cleaned) return ''
  if (cleaned.startsWith('{') && cleaned.endsWith('}')) return cleaned
  const start = cleaned.indexOf('{')
  if (start === -1) return ''
  let depth = 0
  for (let i = start; i < cleaned.length; i += 1) {
    if (cleaned[i] === '{') depth += 1
    else if (cleaned[i] === '}') {
      depth -= 1
      if (depth === 0) return cleaned.slice(start, i + 1)
    }
  }
  return ''
}

const logChatAgentActivity = (
  req: AuthRequest,
  activity: string,
  status: 'success' | 'error',
  metadata?: Record<string, unknown>,
) => {
  void logAiKlipAgentActivity({
    agentName: AI_KLIP_AGENT.CHAT,
    apiKeyName: resolveAnthropicAgentApiKeyName(),
    userId: req.user?.id,
    status,
    activity: truncateActivityText(activity, 2000),
    metadata: metadata ?? null,
  })
}

/**
 * Escape raw control characters that appear *inside* JSON string literals.
 *
 * Safety net for hand-written JSON: a model writing long multi-line prose can emit a
 * literal newline inside a string, which makes JSON.parse fail ("Bad control character
 * in string literal") and used to collapse report/insights into one raw-text blob.
 * The primary defence is output_config.format in klipAgentAi.service.ts; this keeps a
 * bypassed or non-supporting model from silently degrading the response.
 */
export const escapeControlCharsInJsonStrings = (json: string): string => {
  let out = ''
  let inString = false
  let escaped = false
  for (const ch of json) {
    if (escaped) {
      out += ch
      escaped = false
      continue
    }
    if (ch === '\\') {
      out += ch
      escaped = inString
      continue
    }
    if (ch === '"') {
      inString = !inString
      out += ch
      continue
    }
    if (inString) {
      if (ch === '\n') { out += '\\n'; continue }
      if (ch === '\r') { out += '\\r'; continue }
      if (ch === '\t') { out += '\\t'; continue }
      const code = ch.charCodeAt(0)
      if (code < 0x20) { out += `\\u${code.toString(16).padStart(4, '0')}`; continue }
    }
    out += ch
  }
  return out
}

const parseAgentAiResponse = (text: string): AgentAiResult => {
  const fallback: AgentAiResult = {
    answer: text || 'No answer generated.',
    report: '',
    insights: '',
    comparison: '',
  }
  const block = extractJsonBlock(text)
  if (!block) return fallback

  const tryParse = (candidate: string): Partial<AgentAiResult> | null => {
    try {
      const parsed = JSON.parse(candidate) as unknown
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Partial<AgentAiResult>)
        : null
    } catch {
      return null
    }
  }

  const obj = tryParse(block) ?? tryParse(escapeControlCharsInJsonStrings(block))
  if (!obj) return fallback

  return {
    answer: typeof obj.answer === 'string' ? obj.answer : fallback.answer,
    report: typeof obj.report === 'string' ? obj.report : '',
    insights: typeof obj.insights === 'string' ? obj.insights : '',
    comparison: typeof obj.comparison === 'string' ? obj.comparison : '',
  }
}

const getAppDataContext = async () => {
  const [contractsRes, shipmentsRes, truckingRes, financeRes, productRes] = await Promise.all([
    // SAP-withdrawn contracts are excluded here for the same reason every page excludes them:
    // otherwise the agent's company-wide totals disagree with the dashboards and with its own
    // area/product breakdowns below.
    query(`
      SELECT
        COUNT(*)::int AS total_contracts,
        COUNT(*) FILTER (WHERE UPPER(COALESCE(status, '')) IN ('OPEN','ACTIVE'))::int AS open_contracts,
        COUNT(*) FILTER (WHERE UPPER(COALESCE(status, '')) IN ('CLOSE','CLOSED','COMPLETED'))::int AS closed_contracts,
        COALESCE(SUM(quantity_ordered), 0)::numeric AS total_quantity,
        COALESCE(SUM(contract_value), 0)::numeric AS total_contract_value
      FROM contracts c
      WHERE ${sqlContractIsPresent('c')}
    `),
    query(`
      SELECT
        COUNT(*)::int AS total_shipments,
        COUNT(*) FILTER (WHERE is_delayed = true)::int AS delayed_shipments
      FROM shipments
    `),
    query(`
      SELECT
        COUNT(*)::int AS total_trucking,
        COUNT(*) FILTER (WHERE UPPER(COALESCE(status, '')) = 'LATE')::int AS late_trucking
      FROM trucking_operations
    `),
    query(`
      SELECT
        COUNT(*)::int AS total_payments,
        COUNT(*) FILTER (WHERE payoff_date IS NULL)::int AS pending_payments,
        COUNT(*) FILTER (WHERE payoff_date IS NOT NULL)::int AS paid_payments,
        COALESCE(SUM(payment_amount), 0)::numeric AS total_payment_amount
      FROM payments
    `),
    query(`
      WITH${SQL_DELIVERED_BY_CONTRACT_CTE}
      SELECT
        c.product,
        COUNT(DISTINCT c.contract_id)::int AS contract_count,
        COALESCE(SUM(c.quantity_ordered), 0)::numeric AS total_quantity,
        COALESCE(SUM(
          (${SQL_DELIVERED_QTY})
        ), 0)::numeric AS delivered_quantity,
        COALESCE(SUM(c.quantity_ordered), 0)::numeric - COALESCE(SUM(
          (${SQL_DELIVERED_QTY})
        ), 0)::numeric AS outstanding_quantity
      FROM contracts c
      LEFT JOIN delivered_by_contract db ON db.contract_id = c.contract_id
      WHERE c.product IS NOT NULL AND TRIM(c.product) <> ''
        AND ${sqlContractIsPresent('c')}
      GROUP BY c.product
      ORDER BY outstanding_quantity DESC NULLS LAST
      LIMIT 150
    `),
  ])

  // Group Plant is how users name areas ("Bontang"). Without it in context the model reported
  // "no location dimension exists" and fell back to company-wide totals.
  let groupPlantSummary: Array<{ group_plant: string; contract_count: number; outstanding_quantity: number }> = []
  let groupPlantNames: string[] = []
  let productPlantMatrix: Array<{ product: string; group_plant: string; outstanding_quantity: number }> = []
  try {
    ;[groupPlantSummary, groupPlantNames, productPlantMatrix] = await Promise.all([
      getGroupPlantContractCounts(),
      listGroupPlants(),
      getProductPlantOutstandingMatrix(6),
    ])
  } catch (err) {
    logger.warn('Failed to load Group Plant context for Agent AI', err)
  }

  return {
    contracts: contractsRes.rows[0] || {},
    shipments: shipmentsRes.rows[0] || {},
    trucking: truckingRes.rows[0] || {},
    finance: financeRes.rows[0] || {},
    product_summary: productRes.rows || [],
    group_plant_dimension: {
      note:
        'Group Plant (master_plants.group_plant) is the area/site dimension used by Contracts, Shipments, ' +
        'Trucking, Contract Performance, Shipping Performance and Oil Loss. When the user names an area ' +
        '(e.g. "Bontang"), it means this Group Plant. Contracts resolve to it via (plant_code, company_name); ' +
        'unmapped contracts appear as "Blank".',
      available_group_plants: groupPlantNames,
      summary_by_group_plant: groupPlantSummary,
      outstanding_kg_by_product_and_group_plant: productPlantMatrix,
      unit_note: 'All quantities are Kg. 1 MT = 1,000 Kg — convert when the user asks for MT.',
    },
  }
}

const getProductMetrics = async (productHint: string, year?: number | null) => {
  const yearFilter = year ? ` AND EXTRACT(YEAR FROM c.contract_date) = $2 ` : ''
  const sql = `
    WITH${SQL_DELIVERED_BY_CONTRACT_CTE},
    payment_status_per_contract AS (
      SELECT
        p.contract_id,
        MAX(CASE WHEN p.payoff_date IS NULL THEN 1 ELSE 0 END) AS has_blank_payoff
      FROM payments p
      GROUP BY p.contract_id
    )
    SELECT
      c.product,
      COUNT(DISTINCT c.contract_id)::int AS contract_count,
      COALESCE(SUM(c.quantity_ordered), 0)::numeric AS total_quantity,
      COALESCE(SUM((${SQL_DELIVERED_QTY})), 0)::numeric AS delivered_quantity,
      COALESCE(SUM(c.quantity_ordered), 0)::numeric - COALESCE(SUM((${SQL_DELIVERED_QTY})), 0)::numeric AS outstanding_quantity,
      COALESCE(SUM(CASE WHEN COALESCE(ps.has_blank_payoff, 0) = 1 THEN (c.quantity_ordered - (${SQL_DELIVERED_QTY})) ELSE 0 END), 0)::numeric AS outstanding_payment_quantity
    FROM contracts c
    LEFT JOIN delivered_by_contract db ON db.contract_id = c.contract_id
    LEFT JOIN payment_status_per_contract ps ON ps.contract_id = c.id
    WHERE ${sqlContractIsPresent('c')}
      AND c.product ILIKE $1
      ${yearFilter}
    GROUP BY c.product
    ORDER BY outstanding_quantity DESC NULLS LAST
    LIMIT 1
  `
  const params = year ? [`%${productHint}%`, year] : [`%${productHint}%`]
  const res = await query(sql, params)
  return res.rows?.[0] || null
}

const getIncotermBreakdown = async (year?: number | null) => {
  // Presence is always filtered, so the year clause is an AND rather than the WHERE.
  const yearFilter = year ? ` AND EXTRACT(YEAR FROM c.contract_date) = $1 ` : ''
  const res = await query(`
    WITH${SQL_DELIVERED_BY_CONTRACT_CTE}
    SELECT
      COALESCE(NULLIF(TRIM(c.incoterm), ''), 'Blank') AS incoterm,
      COUNT(DISTINCT c.contract_id)::int AS contract_count,
      COALESCE(SUM(c.quantity_ordered), 0)::numeric AS total_quantity,
      COALESCE(SUM((${SQL_DELIVERED_QTY})), 0)::numeric AS delivered_quantity,
      COALESCE(SUM(c.quantity_ordered), 0)::numeric - COALESCE(SUM((${SQL_DELIVERED_QTY})), 0)::numeric AS outstanding_quantity
    FROM contracts c
    LEFT JOIN delivered_by_contract db ON db.contract_id = c.contract_id
    WHERE ${sqlContractIsPresent('c')}
    ${yearFilter}
    GROUP BY COALESCE(NULLIF(TRIM(c.incoterm), ''), 'Blank')
    ORDER BY total_quantity DESC NULLS LAST
  `, year ? [year] : [])
  return res.rows || []
}

const getVendorGroupBreakdown = async (opts?: {
  year?: number | null
  productHint?: string | null
  incotermHint?: string | null
}) => {
  const where: string[] = []
  const params: Array<string | number> = []
  if (opts?.year) {
    params.push(opts.year)
    where.push(`EXTRACT(YEAR FROM c.contract_date) = $${params.length}`)
  }
  if (opts?.productHint) {
    params.push(`%${opts.productHint}%`)
    where.push(`c.product ILIKE $${params.length}`)
  }
  if (opts?.incotermHint) {
    params.push(opts.incotermHint)
    where.push(`UPPER(COALESCE(NULLIF(TRIM(c.incoterm), ''), 'BLANK')) = UPPER($${params.length})`)
  }
  // Always exclude SAP-withdrawn contracts, same as every page.
  where.unshift(sqlContractIsPresent('c'))
  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''

  const res = await query(
    `
    WITH${SQL_DELIVERED_BY_CONTRACT_CTE},
    payment_status_per_contract AS (
      SELECT
        p.contract_id,
        MAX(CASE WHEN p.payoff_date IS NULL THEN 1 ELSE 0 END) AS has_blank_payoff
      FROM payments p
      GROUP BY p.contract_id
    )
    SELECT
      COALESCE(NULLIF(TRIM(c.group_name), ''), 'Ungrouped') AS vendor_group,
      COUNT(DISTINCT c.contract_id)::int AS contract_count,
      COALESCE(SUM(c.quantity_ordered), 0)::numeric AS total_quantity,
      COALESCE(SUM((${SQL_DELIVERED_QTY})), 0)::numeric AS delivered_quantity,
      COALESCE(SUM(c.quantity_ordered), 0)::numeric - COALESCE(SUM((${SQL_DELIVERED_QTY})), 0)::numeric AS outstanding_quantity,
      COALESCE(SUM(CASE WHEN COALESCE(ps.has_blank_payoff, 0) = 1 THEN (c.quantity_ordered - (${SQL_DELIVERED_QTY})) ELSE 0 END), 0)::numeric AS outstanding_payment_quantity
    FROM contracts c
    LEFT JOIN delivered_by_contract db ON db.contract_id = c.contract_id
    LEFT JOIN payment_status_per_contract ps ON ps.contract_id = c.id
    ${whereSql}
    GROUP BY COALESCE(NULLIF(TRIM(c.group_name), ''), 'Ungrouped')
    ORDER BY outstanding_quantity DESC NULLS LAST
    LIMIT 30
    `,
    params
  )
  return res.rows || []
}

const tryDirectProductOutstandingAnswer = async (question: string, year?: number | null): Promise<DirectAnswer> => {
  const q = question.trim().toLowerCase()
  if (!q) return { matched: false }

  const asksOutstanding = q.includes('outstanding') && q.includes('quantity')
  if (!asksOutstanding) return { matched: false }

  const knownMetricWords = ['outstanding', 'quantity', 'for', 'product', 'how', 'many', 'what', 'total', 'cpo']
  const tokenized = q.replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean)
  const candidates = tokenized.filter((t) => !knownMetricWords.includes(t) && t.length >= 3)

  // If question explicitly mentions CPO, prefer that; otherwise use first likely token.
  const productHint = q.includes('cpo') ? 'cpo' : (candidates[0] || '')
  if (!productHint) return { matched: false }

  const row = await getProductMetrics(productHint, year)
  if (!row) return { matched: false }

  const product = String(row.product || productHint).trim()
  const totalQuantity = Number(row.total_quantity || 0)
  const deliveredQuantity = Number(row.delivered_quantity || 0)
  const outstandingQuantity = Number(row.outstanding_quantity || 0)
  const contractCount = Number(row.contract_count || 0)

  const factText =
    `Direct metric from app data: product=${product}, outstanding_quantity=${outstandingQuantity.toLocaleString('en-US')}, ` +
    `total_quantity=${totalQuantity.toLocaleString('en-US')}, delivered_quantity=${deliveredQuantity.toLocaleString('en-US')}, contracts=${contractCount.toLocaleString('en-US')}.`

  return {
    matched: true,
    factText,
    sourceLabel: 'deterministic.product_outstanding_quantity',
    result: {
      answer:
        `Outstanding quantity for ${product}: ${fmtQty(outstandingQuantity, POLICY_QTY_UNIT)} ` +
        `(Total: ${fmtQty(totalQuantity, POLICY_QTY_UNIT)}, Delivered: ${fmtQty(deliveredQuantity, POLICY_QTY_UNIT)}, Contracts: ${contractCount.toLocaleString('en-US')})` +
        `${year ? ` for ${year}.` : '.'}`,
      report: `${product} quantity report\n- Total: ${fmtQty(totalQuantity, POLICY_QTY_UNIT)}\n- Delivered: ${fmtQty(deliveredQuantity, POLICY_QTY_UNIT)}\n- Outstanding: ${fmtQty(outstandingQuantity, POLICY_QTY_UNIT)}\n- Contracts: ${contractCount.toLocaleString('en-US')}`,
      insights:
        outstandingQuantity > 0
          ? `${product} still has outstanding quantity, so delivery execution and follow-up should remain prioritized on open contracts.`
          : `${product} has no outstanding quantity in current app data.`,
      comparison: '',
    },
  }
}

const tryDirectProductDeliveredAnswer = async (question: string, year?: number | null): Promise<DirectAnswer> => {
  const q = question.trim().toLowerCase()
  if (!(q.includes('delivered') && q.includes('quantity'))) return { matched: false }
  const productHint = q.includes('cpo') ? 'cpo' : (tokenize(q).find((t) => !['delivered', 'quantity', 'total', 'product', 'for', 'what', 'how', 'much', 'many'].includes(t)) || '')
  if (!productHint) return { matched: false }
  const row = await getProductMetrics(productHint, year)
  if (!row) return { matched: false }
  const product = String(row.product || productHint).trim()
  const deliveredQuantity = Number(row.delivered_quantity || 0)
  const totalQuantity = Number(row.total_quantity || 0)
  const outstandingQuantity = Number(row.outstanding_quantity || 0)
  const contractCount = Number(row.contract_count || 0)
  return {
    matched: true,
    sourceLabel: 'deterministic.product_delivered_quantity',
    factText:
      `Direct metric from app data: product=${product}, delivered_quantity=${deliveredQuantity.toLocaleString('en-US')}, ` +
      `total_quantity=${totalQuantity.toLocaleString('en-US')}, outstanding_quantity=${outstandingQuantity.toLocaleString('en-US')}, contracts=${contractCount.toLocaleString('en-US')}.`,
    result: {
      answer:
        `Delivered quantity for ${product}: ${fmtQty(deliveredQuantity, POLICY_QTY_UNIT)} ` +
        `(Total: ${fmtQty(totalQuantity, POLICY_QTY_UNIT)}, Outstanding: ${fmtQty(outstandingQuantity, POLICY_QTY_UNIT)}, Contracts: ${contractCount.toLocaleString('en-US')}).`,
      report: `${product} delivery report\n- Total: ${fmtQty(totalQuantity, POLICY_QTY_UNIT)}\n- Delivered: ${fmtQty(deliveredQuantity, POLICY_QTY_UNIT)}\n- Outstanding: ${fmtQty(outstandingQuantity, POLICY_QTY_UNIT)}\n- Contracts: ${contractCount.toLocaleString('en-US')}`,
      insights: deliveredQuantity > 0 ? `${product} already has delivered volume, but remaining outstanding quantity should be tracked for completion risk.` : `${product} has no delivered quantity recorded yet.`,
      comparison: '',
    },
  }
}

const tryDirectOutstandingPaymentAnswer = async (question: string, year?: number | null): Promise<DirectAnswer> => {
  const q = question.trim().toLowerCase()
  if (!(q.includes('outstanding') && q.includes('payment') && q.includes('quantity'))) return { matched: false }
  const productHint = q.includes('cpo') ? 'cpo' : (tokenize(q).find((t) => !['outstanding', 'payment', 'quantity', 'total', 'product', 'for', 'what', 'how', 'much', 'many'].includes(t)) || '')
  if (!productHint) return { matched: false }
  const row = await getProductMetrics(productHint, year)
  if (!row) return { matched: false }
  const product = String(row.product || productHint).trim()
  const opQty = Number(row.outstanding_payment_quantity || 0)
  return {
    matched: true,
    sourceLabel: 'deterministic.product_outstanding_payment_quantity',
    factText: `Direct metric from app data: product=${product}, outstanding_payment_quantity=${opQty.toLocaleString('en-US')}.`,
    result: {
      answer: `Outstanding payment quantity for ${product}: ${fmtQty(opQty, POLICY_QTY_UNIT)}.`,
      report: `${product} payment-outstanding report\n- Outstanding payment quantity: ${fmtQty(opQty, POLICY_QTY_UNIT)}`,
      insights: opQty > 0 ? `${product} has quantity already delivered but still pending payment closure.` : `${product} currently has no outstanding payment quantity.`,
      comparison: '',
    },
  }
}

const tryDirectTopSuppliersOutstanding = async (question: string, year?: number | null): Promise<DirectAnswer> => {
  const q = question.trim().toLowerCase()
  if (!(q.includes('top') && q.includes('supplier') && q.includes('outstanding'))) return { matched: false }
  const yearFilter = year ? ` AND EXTRACT(YEAR FROM c.contract_date) = $1 ` : ''
  const res = await query(`
    WITH${SQL_DELIVERED_BY_CONTRACT_CTE}
    SELECT
      c.supplier,
      COALESCE(SUM(c.quantity_ordered), 0)::numeric - COALESCE(SUM((${SQL_DELIVERED_QTY})), 0)::numeric AS outstanding_quantity
    FROM contracts c
    LEFT JOIN delivered_by_contract db ON db.contract_id = c.contract_id
    WHERE ${sqlContractIsPresent('c')}
      AND c.supplier IS NOT NULL AND TRIM(c.supplier) <> ''
      ${yearFilter}
    GROUP BY c.supplier
    ORDER BY outstanding_quantity DESC NULLS LAST
    LIMIT 5
  `, year ? [year] : [])
  const rows = res.rows || []
  if (rows.length === 0) return { matched: false }
  const lines = rows.map((r: any, i: number) => `${i + 1}. ${r.supplier}: ${fmtQty(Number(r.outstanding_quantity || 0), POLICY_QTY_UNIT)}`)
  return {
    matched: true,
    sourceLabel: 'deterministic.top_suppliers_outstanding_quantity',
    factText: `Direct metric from app data: top suppliers by outstanding quantity computed.`,
    result: {
      answer: `Top suppliers by outstanding quantity:\n${lines.join('\n')}`,
      report: `Top 5 suppliers by outstanding quantity\n${lines.join('\n')}`,
      insights: 'Suppliers at the top of this list should be prioritized for delivery follow-up and bottleneck resolution.',
      comparison: '',
    },
  }
}

const tryDirectTopVendorsOutstanding = async (question: string, year?: number | null): Promise<DirectAnswer> => {
  const q = question.trim().toLowerCase()
  const asksTop = q.includes('top')
  const asksOutstanding = q.includes('outstanding')
  const asksVendorish =
    q.includes('vendor') ||
    q.includes('vendor group') ||
    q.includes('group') ||
    q.includes('supplier') // allow "vendor" questions to still work even if user says supplier/vender interchangeably

  if (!(asksTop && asksOutstanding && asksVendorish)) return { matched: false }

  // Prefer vendor group if it exists; otherwise fall back to supplier name.
  const yearFilter = year ? ` AND EXTRACT(YEAR FROM c.contract_date) = $1 ` : ''
  const res = await query(
    `
    WITH${SQL_DELIVERED_BY_CONTRACT_CTE}
    SELECT
      COALESCE(NULLIF(TRIM(c.group_name), ''), NULLIF(TRIM(c.supplier), ''), 'Unknown') AS vendor,
      COALESCE(SUM(c.quantity_ordered), 0)::numeric - COALESCE(SUM((${SQL_DELIVERED_QTY})), 0)::numeric AS outstanding_quantity
    FROM contracts c
    LEFT JOIN delivered_by_contract db ON db.contract_id = c.contract_id
    WHERE ${sqlContractIsPresent('c')}
      AND (
        (c.group_name IS NOT NULL AND TRIM(c.group_name) <> '')
        OR (c.supplier IS NOT NULL AND TRIM(c.supplier) <> '')
      )
      ${yearFilter}
    GROUP BY COALESCE(NULLIF(TRIM(c.group_name), ''), NULLIF(TRIM(c.supplier), ''), 'Unknown')
    ORDER BY outstanding_quantity DESC NULLS LAST
    LIMIT 5
    `,
    year ? [year] : []
  )

  const rows = res.rows || []
  if (rows.length === 0) {
    return {
      matched: true,
      sourceLabel: 'deterministic.top_vendors_outstanding_quantity',
      factText: `Direct metric from app data: no vendor rows found${year ? ` for ${year}` : ''}.`,
      result: {
        answer: `Top vendors by outstanding quantity${year ? ` for ${year}` : ''}: no data found.`,
        report: `Top 5 vendors by outstanding quantity${year ? ` (${year})` : ''}\n(no rows)`,
        insights:
          'No matching vendors were found for this filter. If you expected results, check whether contracts have contract_date set and whether vendor group/supplier fields are populated.',
        comparison: '',
      },
    }
  }

  const lines = rows.map(
    (r: any, i: number) => `${i + 1}. ${r.vendor}: ${fmtQty(Number(r.outstanding_quantity || 0), POLICY_QTY_UNIT)}`
  )

  return {
    matched: true,
    sourceLabel: 'deterministic.top_vendors_outstanding_quantity',
    factText: `Direct metric from app data: top vendors by outstanding quantity computed${year ? ` for ${year}` : ''}.`,
    result: {
      answer: `Top vendors by outstanding quantity${year ? ` for ${year}` : ''}:\n${lines.join('\n')}`,
      report: `Top 5 vendors by outstanding quantity${year ? ` (${year})` : ''}\n${lines.join('\n')}`,
      insights:
        'Prioritize the top vendors for delivery follow-up and contract execution. If outstanding stays high, add an exception list by vendor with aging buckets and “next milestone date” to focus action.',
      comparison: '',
    },
  }
}

const tryDirectOverduePayments = async (question: string, year?: number | null): Promise<DirectAnswer> => {
  const q = question.trim().toLowerCase()
  if (!(q.includes('overdue') && q.includes('payment'))) return { matched: false }
  const byMonth = q.includes('month')
  const bySupplier = q.includes('supplier')
  const byGroup = q.includes('group')

  let selectDim = `'ALL'::text AS dim`
  let groupBy = ''
  if (byMonth) {
    selectDim = `TO_CHAR(p.payment_due_date, 'YYYY-MM') AS dim`
    groupBy = `GROUP BY TO_CHAR(p.payment_due_date, 'YYYY-MM')`
  } else if (bySupplier) {
    selectDim = `COALESCE(c.supplier, 'Unknown') AS dim`
    groupBy = `GROUP BY COALESCE(c.supplier, 'Unknown')`
  } else if (byGroup) {
    selectDim = `COALESCE(c.group_name, 'Unknown') AS dim`
    groupBy = `GROUP BY COALESCE(c.group_name, 'Unknown')`
  }

  const yearFilter = year ? ` AND EXTRACT(YEAR FROM p.payment_due_date) = $1 ` : ''
  const sql = `
    SELECT
      ${selectDim},
      COUNT(*)::int AS total_payments,
      COALESCE(SUM(COALESCE(p.payment_amount, 0)), 0)::numeric AS total_amount
    FROM payments p
    LEFT JOIN contracts c ON c.id = p.contract_id
    WHERE p.payoff_date IS NULL
      AND p.payment_due_date IS NOT NULL
      AND p.payment_due_date::date < CURRENT_DATE
      ${yearFilter}
    ${groupBy}
    ORDER BY total_amount DESC NULLS LAST
    LIMIT 12
  `
  const res = await query(sql, year ? [year] : [])
  const rows = res.rows || []
  if (rows.length === 0) return { matched: false }
  // fmt() rounds — money follows the same no-decimals rule as quantities.
  const lines = rows.map(
    (r: any) => `${r.dim}: ${fmt(Number(r.total_payments || 0))} payments, amount ${fmt(Number(r.total_amount || 0))}`,
  )
  const dimLabel = byMonth ? 'month' : bySupplier ? 'supplier' : byGroup ? 'vendor group' : 'overall'
  return {
    matched: true,
    sourceLabel: byMonth
      ? 'deterministic.overdue_payments_by_month'
      : bySupplier
        ? 'deterministic.overdue_payments_by_supplier'
        : byGroup
          ? 'deterministic.overdue_payments_by_group'
          : 'deterministic.overdue_payments_overall',
    factText: `Direct metric from app data: overdue payments by ${dimLabel}.`,
    result: {
      answer: `Overdue payments by ${dimLabel}:\n${lines.join('\n')}`,
      report: `Overdue payment report (${dimLabel})\n${lines.join('\n')}`,
      insights: 'Focus collections and payment resolution on the largest overdue buckets first.',
      comparison: '',
    },
  }
}

const tryDirectIncotermBreakdown = async (question: string, year?: number | null): Promise<DirectAnswer> => {
  const q = question.trim().toLowerCase()
  const asksIncoterm = q.includes('incoterm')
  const asksBreakdown = q.includes('break') || q.includes('split') || q.includes('distribution') || q.includes('pie') || q.includes('chart')
  if (!(asksIncoterm && asksBreakdown)) return { matched: false }

  const rows = await getIncotermBreakdown(year)
  if (!rows.length) return { matched: false }

  const total = rows.reduce((s: number, r: any) => s + Number(r.total_quantity || 0), 0)
  const lines = rows.map((r: any) => {
    const qty = Number(r.total_quantity || 0)
    const pct = total > 0 ? (qty / total) * 100 : 0
    return `${r.incoterm}: ${fmtQty(qty, POLICY_QTY_UNIT)} (${Math.round(pct)}%)`
  })

  return {
    matched: true,
    sourceLabel: 'deterministic.incoterm_quantity_breakdown',
    factText: `Direct metric from app data: incoterm breakdown computed across ${rows.length} incoterms.`,
    result: {
      answer: `Incoterm quantity breakdown${year ? ` for ${year}` : ''}:\n${lines.join('\n')}`,
      report: `Incoterm breakdown report (quantity + share)${year ? ` for ${year}` : ''}\n${lines.join('\n')}`,
      insights: 'You can directly use the percentage shares as pie-chart segments.',
      comparison: '',
    },
  }
}

const tryDirectVendorGroupBreakdown = async (
  question: string,
  contextQuestion?: string,
  year?: number | null
): Promise<DirectAnswer> => {
  const q = question.trim().toLowerCase()
  const cq = String(contextQuestion || '').trim().toLowerCase()
  const asksVendorGroup = q.includes('vendor group') || q.includes('group name') || q.includes('by group')
  if (!asksVendorGroup) return { matched: false }

  const productHint = extractProductHintFromText(`${cq} ${q}`)
  const incotermHint = extractIncotermHint(`${contextQuestion || ''} ${question}`)
  const rows = await getVendorGroupBreakdown({ year, productHint, incotermHint })
  if (!rows.length) return { matched: false }

  const lines = rows.slice(0, 15).map((r: any, i: number) =>
    `${i + 1}. ${r.vendor_group}: outstanding ${fmtQty(Number(r.outstanding_quantity || 0), POLICY_QTY_UNIT)}, ` +
    `delivered ${fmtQty(Number(r.delivered_quantity || 0), POLICY_QTY_UNIT)}, total ${fmtQty(Number(r.total_quantity || 0), POLICY_QTY_UNIT)}`
  )

  return {
    matched: true,
    sourceLabel: 'deterministic.vendor_group_breakdown',
    factText:
      `Direct metric from app data: vendor-group breakdown computed` +
      `${year ? ` for ${year}` : ''}` +
      `${productHint ? ` filtered product~${productHint}` : ''}` +
      `${incotermHint ? ` filtered incoterm=${incotermHint}` : ''}.`,
    result: {
      answer:
        `Vendor group breakdown${year ? ` for ${year}` : ''}` +
        `${productHint ? ` (product~${productHint})` : ''}` +
        `${incotermHint ? ` (incoterm=${incotermHint})` : ''}:\n${lines.join('\n')}`,
      report:
        `Vendor group report${year ? ` (${year})` : ''}\n${lines.join('\n')}`,
      insights:
        'Prioritize vendor groups with the largest outstanding quantity for execution and follow-up.',
      comparison: '',
    },
  }
}

const fmt = (n: number): string => Math.round(n).toLocaleString('en-US')

/**
 * KLIP stores quantity in Kg, but MT is the working unit in downstream palm oil. Honour an
 * explicit MT/tonne request and otherwise show Kg, with the other unit in brackets so a
 * figure is never ambiguous and nobody has to redo the arithmetic.
 */
type QtyUnit = 'MT' | 'KG'

/**
 * Reporting unit for the older single-dimension answers.
 *
 * Those built their strings with a hardcoded " Kg" suffix, which contradicted the standing MT rule
 * once it was introduced. They do not thread the question far enough to honour an explicit
 * "in kg" request, so they follow the policy unit unconditionally. Used only inside request
 * handlers, so the module-level order is not a problem.
 */
const POLICY_QTY_UNIT: QtyUnit = 'MT'

/**
 * MT is the reporting unit, always. KLIP stores Kg, but the business works in MT, so this is a
 * standing rule rather than something the user has to ask for each time — which also means it
 * cannot be switched off accidentally by a stray phrase in one question.
 * An explicit request for Kg still wins, for that one answer only.
 */
const detectExplicitKgRequest = (...texts: Array<string | null | undefined>): boolean => {
  const joined = texts.filter(Boolean).join(' ')
  return /\b(in|into|as)\s+(kg|kgs|kilogram|kilograms)\b|\bkg\s+instead\b/i.test(joined)
}

const resolveQtyUnit = (...texts: Array<string | null | undefined>): QtyUnit =>
  detectExplicitKgRequest(...texts) ? 'KG' : 'MT'

const fmtQty = (kg: number, unit: QtyUnit): string => {
  const mt = kg / 1000
  // Whole numbers only - decimals are noise at MT scale.
  return unit === 'MT' ? `${fmt(mt)} MT` : `${fmt(kg)} Kg`
}

/**
 * Headline figures. Previously showed the other unit in brackets; dropped because MT is now the
 * standing unit and the bracketed Kg was pure clutter on every line.
 */
const fmtQtyBoth = (kg: number, unit: QtyUnit): string => fmtQty(kg, unit)

/**
 * Area names like "Bontang" are Group Plant values from the Master Plant List, the same
 * dimension Contracts / Shipments / Trucking / Contract Performance / Shipping Performance /
 * Oil Loss filter on. Before this matcher the agent had no location dimension in its context
 * and correctly-but-uselessly answered "unknown" while showing company-wide totals.
 *
 * Ordered ahead of the global product matchers so an area-scoped question can never be
 * answered with company-wide numbers.
 */
const tryDirectGroupPlantContractPerformance = async (
  question: string,
  contextQuestion?: string,
): Promise<DirectAnswer> => {
  const q = question.trim().toLowerCase()
  if (!q) return { matched: false }

  const groupPlants = await listGroupPlants()
  const area = matchGroupPlantInText(`${question} ${contextQuestion || ''}`, groupPlants)
  if (!area) return { matched: false }

  const asksContractScope =
    q.includes('performance') ||
    q.includes('product') ||
    q.includes('contract') ||
    q.includes('outstanding') ||
    q.includes('delivered') ||
    q.includes('quantity')
  if (!asksContractScope) return { matched: false }

  const unit = resolveQtyUnit(question, contextQuestion)
  const rows = await getGroupPlantProductBreakdown(area)
  const today = new Date().toISOString().slice(0, 10)

  if (rows.length === 0) {
    return {
      matched: true,
      sourceLabel: 'deterministic.group_plant_contract_performance',
      factText: `Direct metric from app data: Group Plant ${area} has no contracts (SAP-present) as of ${today}.`,
      result: {
        answer: `${area} has no active contracts in KLIP as of ${today} (SAP-withdrawn contracts excluded). Group Plant "${area}" exists in the Master Plant List, so this is an empty result, not a missing filter.`,
        report: '',
        insights: `If you expected contracts here, check that those contracts carry a plant_code/company_name that maps to Group Plant "${area}" in Master Plant List — unmapped contracts fall into "Blank".`,
        comparison: '',
      },
    }
  }

  const totals = rows.reduce(
    (acc, r) => ({
      contracts: acc.contracts + r.contract_count,
      total: acc.total + r.total_quantity,
      delivered: acc.delivered + r.delivered_quantity,
      outstanding: acc.outstanding + r.outstanding_quantity,
    }),
    { contracts: 0, total: 0, delivered: 0, outstanding: 0 },
  )
  const pct = (n: number, d: number) => (d > 0 ? `${Math.round((n / d) * 100)}%` : 'n/a')

  const lines = rows.map(
    (r) =>
      `${r.product}: ${fmt(r.contract_count)} contracts | total ${fmtQty(r.total_quantity, unit)} | delivered ${fmtQty(r.delivered_quantity, unit)} (${pct(r.delivered_quantity, r.total_quantity)}) | outstanding ${fmtQty(r.outstanding_quantity, unit)}`,
  )

  // Timeliness comes from the Contract Performance service itself so the figures agree with
  // that page. Degrade gracefully: a breakdown without timeliness beats no answer.
  let timeliness = ''
  try {
    const perf = await getGroupPlantPerformance(area)
    const scored = perf.lateCount + perf.onTrackCount
    timeliness = scored > 0
      ? `Delivery timeliness (Contract Performance): ${fmt(perf.lateCount)} late (avg ${fmt(perf.lateAvgDays)} days), ${fmt(perf.onTrackCount)} on track — ${pct(perf.onTrackCount, scored)} on track.`
      : 'Delivery timeliness: no contracts in this area currently have a schedule to score.'
  } catch (err) {
    logger.warn('Group Plant timeliness lookup failed; returning breakdown only', err)
    timeliness = 'Delivery timeliness: unavailable (Contract Performance lookup failed) — quantities above are unaffected.'
  }

  const topProduct = rows[0]

  return {
    matched: true,
    sourceLabel: 'deterministic.group_plant_contract_performance',
    factText:
      `Direct metric from app data: Group Plant=${area}, products=${rows.length}, contracts=${totals.contracts}, ` +
      `total=${fmtQty(totals.total, unit)}, delivered=${fmtQty(totals.delivered, unit)}, outstanding=${fmtQty(totals.outstanding, unit)}.`,
    result: {
      answer:
        `${area} — contract performance by product as of ${today}: ${fmt(totals.contracts)} contracts across ${rows.length} products, ` +
        `${fmtQtyBoth(totals.total, unit)} contracted, ${fmtQty(totals.delivered, unit)} delivered (${pct(totals.delivered, totals.total)}), ` +
        `${fmtQtyBoth(totals.outstanding, unit)} outstanding.\n` +
        `Largest outstanding: ${topProduct.product} at ${fmtQty(topProduct.outstanding_quantity, unit)}.\n` +
        `${timeliness}\n` +
        `Scope: Group Plant "${area}" from Master Plant List, all contract dates, SAP-withdrawn contracts excluded.`,
      report:
        `Contract performance — ${area} by product (as of ${today})\n${lines.join('\n')}\n` +
        `TOTAL: ${fmt(totals.contracts)} contracts | total ${fmtQty(totals.total, unit)} | delivered ${fmtQty(totals.delivered, unit)} | outstanding ${fmtQty(totals.outstanding, unit)}`,
      insights:
        `Focus on ${topProduct.product} — it carries the largest outstanding volume in ${area}. ` +
        `Note the delivered figure follows incoterm (CIF/CFR/FRC use SAP Quantity Receive, FOB/LCO use Quantity Delivered, otherwise STO quantity), ` +
        `so mixed-incoterm products are not directly comparable. Contracts whose plant_code/company_name do not map to a Group Plant fall into "Blank" and are not counted here.`,
      comparison: '',
    },
  }
}

/**
 * Multi-dimension breakdown: "outstanding CPO in Bontang by Incoterm and Group Supplier".
 *
 * Runs BEFORE the single-dimension matchers. Each of those handled exactly one dimension but still
 * claimed multi-dimension questions, so the question above was answered with company-wide incoterm
 * totals - wrong product, wrong area, and the second dimension silently dropped.
 */
const BREAKDOWN_DIMENSION_PATTERNS: Array<{ dim: BreakdownDimension; re: RegExp }> = [
  // Group supplier before supplier so "group supplier" is not consumed as plain "supplier".
  { dim: 'group_supplier', re: /\b(group supplier|supplier group|vendor group|group name|group vendor)\b/i },
  { dim: 'incoterm', re: /\bincoterms?\b/i },
  { dim: 'supplier', re: /\b(supplier|vendor)s?\b/i },
  { dim: 'product', re: /\bproducts?\b/i },
  { dim: 'group_plant', re: /\b(group plant|plant|area|site|location)s?\b/i },
]

const detectBreakdownDimensions = (text: string): BreakdownDimension[] => {
  const out: BreakdownDimension[] = []
  let remaining = String(text || '')
  for (const { dim, re } of BREAKDOWN_DIMENSION_PATTERNS) {
    if (re.test(remaining)) {
      out.push(dim)
      // Consume the match so "group supplier" does not also register as "supplier".
      remaining = remaining.replace(new RegExp(re.source, 'gi'), ' ')
    }
  }
  return out
}

const tryDirectFlexibleBreakdown = async (
  question: string,
  contextQuestion?: string,
): Promise<DirectAnswer> => {
  const q = question.trim()
  if (!q) return { matched: false }

  const asksBreakdown =
    // Includes chart/pie/graph so those phrasings are handled here too, rather than falling
    // through to the older single-dimension matchers that still report in Kg.
    /\b(break ?down|breakdown|based on|group(ed)? by|by |per |split|distribution|share|chart|pie|graph)\b/i.test(q) ||
    /\bwhich (supplier|vendor|incoterm|product|plant|area)\b/i.test(q)
  if (!asksBreakdown) return { matched: false }

  const dimensions = detectBreakdownDimensions(q)
  if (dimensions.length === 0) return { matched: false }

  /*
   * Stand down for "contract performance for <area> by product". The Group Plant matcher answers
   * that with delivery timeliness from the Contract Performance service (late / on-track counts),
   * which this generic breakdown cannot produce - claiming it here would drop the very figures
   * that make it an answer about performance.
   */
  const asksPerformance = /\bperformance\b/i.test(q)
  if (asksPerformance && dimensions.length === 1 && dimensions[0] === 'product') {
    return { matched: false }
  }

  const combined = `${question} ${contextQuestion || ''}`
  const [products, groupPlants, incoterms] = await Promise.all([
    listProducts(),
    listGroupPlants(),
    listIncoterms(),
  ])
  const product = matchProductInText(combined, products)
  const area = matchGroupPlantInText(combined, groupPlants)
  // Data-driven: the old hardcoded incoterm list omitted FRC and LCO, this deployment's two
  // largest, so an incoterm filter named in the question was silently ignored.
  const incoterm = matchIncotermInText(combined, incoterms)

  // An incoterm named as a FILTER must not also be a grouping dimension ("for FRC, which supplier").
  const dims = incoterm && dimensions.includes('incoterm') && !/\bby incoterm|per incoterm|incoterms\b/i.test(q)
    ? dimensions.filter((d) => d !== 'incoterm')
    : dimensions
  if (dims.length === 0) return { matched: false }

  const unit = resolveQtyUnit(question, contextQuestion)
  const wantsDueDate = /\b(due|delivery end|deadline|expiry|overdue|aging|ageing|late)\b/i.test(q)

  const rows = await getFlexibleBreakdown({
    dimensions: dims,
    product,
    groupPlant: area,
    incoterm,
    limit: 40,
  })

  const scopeBits = [
    product ? `product ${product}` : null,
    area ? `Group Plant ${area}` : null,
    incoterm ? `incoterm ${incoterm}` : null,
  ].filter(Boolean)
  const scopeLabel = scopeBits.length > 0 ? scopeBits.join(', ') : 'all products and areas'
  const dimLabel = dims.map((d) => breakdownDimensionLabel(d)).join(' x ')
  const today = new Date().toISOString().slice(0, 10)

  if (rows.length === 0) {
    return {
      matched: true,
      sourceLabel: 'deterministic.flexible_breakdown',
      factText: `Direct metric from app data: no contracts for ${scopeLabel}.`,
      result: {
        answer: `No contracts found for ${scopeLabel} as of ${today}, so there is nothing to break down by ${dimLabel}.`,
        report: '',
        insights: '',
        comparison: '',
        reportTable: null,
      },
    }
  }

  const totals = rows.reduce(
    (a, r) => ({
      contracts: a.contracts + r.contract_count,
      total: a.total + r.total_quantity,
      delivered: a.delivered + r.delivered_quantity,
      outstanding: a.outstanding + r.outstanding_quantity,
      overdue: a.overdue + r.overdue_contracts,
    }),
    { contracts: 0, total: 0, delivered: 0, outstanding: 0, overdue: 0 },
  )
  const pct = (n: number, d: number) => (d > 0 ? `${Math.round((n / d) * 100)}%` : 'n/a')

  const columns: AgentReportTable['columns'] = [
    ...dims.map((d, i) => ({ key: `dim_${i}`, label: breakdownDimensionLabel(d), align: 'left' as const })),
    { key: 'contracts', label: 'Contracts', align: 'right' as const },
    { key: 'outstanding', label: `Outstanding (${unit})`, align: 'right' as const },
    { key: 'share', label: 'Share', align: 'right' as const },
    { key: 'delivered', label: `Delivered (${unit})`, align: 'right' as const },
    { key: 'total', label: `Contracted (${unit})`, align: 'right' as const },
  ]
  if (wantsDueDate) {
    columns.push(
      { key: 'earliest_due', label: 'Earliest due', align: 'left' as const },
      { key: 'overdue', label: 'Overdue', align: 'right' as const },
    )
  }

  const asUnit = (kg: number) => (unit === 'MT' ? Math.round(kg / 1000) : Math.round(kg))
  const tableRows = rows.map((r) => {
    const row: Record<string, string | number | null> = {}
    r.dims.forEach((v, i) => {
      row[`dim_${i}`] = v
    })
    row.contracts = r.contract_count
    row.outstanding = asUnit(r.outstanding_quantity)
    row.share = pct(r.outstanding_quantity, totals.outstanding)
    row.delivered = asUnit(r.delivered_quantity)
    row.total = asUnit(r.total_quantity)
    if (wantsDueDate) {
      row.earliest_due = r.earliest_due_date ?? '-'
      row.overdue = r.overdue_contracts
    }
    return row
  })

  const top = rows[0]
  const topLabel = top.dims.join(' / ')
  const lines = rows
    .slice(0, 15)
    .map(
      (r) =>
        `${r.dims.join(' / ')}: outstanding ${fmtQty(r.outstanding_quantity, unit)} (${pct(r.outstanding_quantity, totals.outstanding)}) | ${fmt(r.contract_count)} contracts` +
        (wantsDueDate
          ? ` | earliest due ${r.earliest_due_date ?? '-'} | ${fmt(r.overdue_contracts)} overdue`
          : ''),
    )

  return {
    matched: true,
    sourceLabel: 'deterministic.flexible_breakdown',
    factText:
      `Direct metric from app data: breakdown by ${dimLabel} for ${scopeLabel} - ${rows.length} group(s), ` +
      `outstanding ${fmtQty(totals.outstanding, unit)}.`,
    result: {
      answer:
        `Outstanding by ${dimLabel} - ${scopeLabel}, as of ${today}: ${fmtQtyBoth(totals.outstanding, unit)} outstanding ` +
        `across ${fmt(totals.contracts)} contracts in ${rows.length} group(s).\n` +
        `Largest: ${topLabel} at ${fmtQty(top.outstanding_quantity, unit)} (${pct(top.outstanding_quantity, totals.outstanding)} of the total)` +
        (wantsDueDate && top.earliest_due_date ? `, earliest delivery end ${top.earliest_due_date}` : '') +
        `.\n` +
        (wantsDueDate ? `${fmt(totals.overdue)} open contracts are already past their delivery end date.\n` : '') +
        `Scope: SAP-withdrawn contracts excluded; see the Report table for the full split.`,
      report: `Outstanding by ${dimLabel} - ${scopeLabel} (as of ${today})\n${lines.join('\n')}` +
        (rows.length > 15 ? `\n... and ${rows.length - 15} more group(s)` : ''),
      insights:
        `Start with ${topLabel} — it carries ${pct(top.outstanding_quantity, totals.outstanding)} of the outstanding volume in this scope.` +
        (wantsDueDate
          ? ` Prioritise groups whose earliest delivery end has already passed; those are live exposure rather than future commitments.`
          : '') +
        ` Delivered follows incoterm (CIF/CFR/FRC use SAP Quantity Receive, FOB/LCO use Quantity Delivered, otherwise STO quantity), so groups on different incoterms are not directly comparable.`,
      comparison: '',
      reportTable: {
        title: `Outstanding by ${dimLabel} — ${scopeLabel}`,
        columns,
        rows: tableRows,
        totals: {
          [`dim_0`]: 'TOTAL',
          contracts: totals.contracts,
          outstanding: asUnit(totals.outstanding),
          share: '100%',
          delivered: asUnit(totals.delivered),
          total: asUnit(totals.total),
          ...(wantsDueDate ? { earliest_due: '', overdue: totals.overdue } : {}),
        },
        chart: {
          type: rows.length <= 8 ? 'pie' : 'bar',
          labelKey: 'dim_0',
          valueKey: 'outstanding',
          valueLabel: `Outstanding (${unit})`,
        },
      },
    },
  }
}

/**
 * Aging of open contracts, optionally scoped to a product and/or Group Plant.
 *
 * Previously the agent had no contract-date dimension, so a request for aging buckets came back
 * as "please pull CPO open contracts with contract_date so I can bucket them" — handing the work
 * back to the user. This answers it instead.
 */
const tryDirectContractAging = async (
  question: string,
  contextQuestion?: string,
): Promise<DirectAnswer> => {
  const q = question.trim().toLowerCase()
  const asksAging =
    q.includes('aging') || q.includes('ageing') || q.includes('age of') || q.includes('overdue contract') ||
    (q.includes('bucket') && (q.includes('day') || q.includes('age')))
  if (!asksAging) return { matched: false }

  const combined = `${question} ${contextQuestion || ''}`
  const [products, groupPlants] = await Promise.all([listProducts(), listGroupPlants()])
  const product = matchProductInText(combined, products)
  const area = matchGroupPlantInText(combined, groupPlants)
  const unit = resolveQtyUnit(question, contextQuestion)

  const rows = await getContractAgingBuckets({ product, groupPlant: area })
  const scopeBits = [product ? `product ${product}` : null, area ? `Group Plant ${area}` : null]
    .filter(Boolean)
    .join(', ')
  const scopeLabel = scopeBits || 'all products and areas'
  const today = new Date().toISOString().slice(0, 10)

  const totalContracts = rows.reduce((s, r) => s + r.contract_count, 0)
  if (totalContracts === 0) {
    return {
      matched: true,
      sourceLabel: 'deterministic.contract_aging',
      factText: `Direct metric from app data: no open (ACTIVE) contracts for ${scopeLabel}.`,
      result: {
        answer: `No open (ACTIVE) contracts for ${scopeLabel} as of ${today}, so there is nothing to age.`,
        report: '',
        insights: '',
        comparison: '',
      },
    }
  }

  const totalOutstanding = rows.reduce((s, r) => s + r.outstanding_quantity, 0)
  const overdue = rows.filter((r) => r.sort_order >= 1 && r.sort_order <= 4)
  const overdueContracts = overdue.reduce((s, r) => s + r.contract_count, 0)
  const overdueQty = overdue.reduce((s, r) => s + r.outstanding_quantity, 0)
  const worst = rows.find((r) => r.sort_order === 4)
  const pct = (n: number, d: number) => (d > 0 ? `${Math.round((n / d) * 100)}%` : 'n/a')

  const lines = rows.map(
    (r) =>
      `${r.bucket}: ${fmt(r.contract_count)} contracts | outstanding ${fmtQty(r.outstanding_quantity, unit)}` +
      (r.oldest_delivery_end && r.sort_order >= 1 && r.sort_order <= 4
        ? ` | oldest delivery end ${r.oldest_delivery_end}`
        : ''),
  )

  return {
    matched: true,
    sourceLabel: 'deterministic.contract_aging',
    factText:
      `Direct metric from app data: aging of open contracts for ${scopeLabel} — ${totalContracts} open, ` +
      `${overdueContracts} overdue, overdue outstanding ${fmtQty(overdueQty, unit)}.`,
    result: {
      answer:
        `Aging of open contracts — ${scopeLabel}, as of ${today}: ${fmt(totalContracts)} open contracts carrying ` +
        `${fmtQtyBoth(totalOutstanding, unit)} outstanding. ` +
        `${fmt(overdueContracts)} of them (${pct(overdueContracts, totalContracts)}) are already past their delivery end date, ` +
        `covering ${fmtQty(overdueQty, unit)}.\n` +
        (worst && worst.contract_count > 0
          ? `Worst bucket: over 90 days overdue — ${fmt(worst.contract_count)} contracts, ${fmtQty(worst.outstanding_quantity, unit)}${worst.oldest_delivery_end ? `, oldest delivery end ${worst.oldest_delivery_end}` : ''}.\n`
          : '') +
        `Aging is measured against delivery_end_date (the delivery window), not contract_date; open = status ACTIVE, SAP-withdrawn excluded.`,
      report: `Open-contract aging — ${scopeLabel} (as of ${today})\n${lines.join('\n')}\nTOTAL: ${fmt(totalContracts)} open contracts | outstanding ${fmtQty(totalOutstanding, unit)}`,
      insights:
        (worst && worst.contract_count > 0
          ? `The over-90-day bucket is the escalation list — ${fmt(worst.contract_count)} contracts past their delivery window by more than a quarter. `
          : `Nothing has slipped past 90 days, so exposure is still recoverable. `) +
        `A negative outstanding figure in any bucket means over-delivery against the contracted quantity and should be checked against contract amendments rather than netted off. ` +
        `Contracts with no delivery end date cannot be aged and are listed separately.`,
      comparison: '',
    },
  }
}

/**
 * A single product broken down by Group Plant — answers "which site is driving CPO's outstanding".
 */
const tryDirectProductByGroupPlant = async (
  question: string,
  contextQuestion?: string,
): Promise<DirectAnswer> => {
  const q = question.trim().toLowerCase()
  const combined = `${question} ${contextQuestion || ''}`

  const products = await listProducts()
  // Read the product from the previous turn too, so "now break it down by plant" after a CPO
  // question keeps the CPO scope instead of silently widening to all products.
  const product = matchProductInText(combined, products)
  if (!product) return { matched: false }

  const asksByPlant =
    q.includes('group plant') || q.includes('by plant') || q.includes('per plant') ||
    q.includes('by area') || q.includes('per area') || q.includes('by site') || q.includes('per site') ||
    q.includes('which site') || q.includes('which plant') || q.includes('which area') ||
    q.includes('by location') || q.includes('breakdown by')
  if (!asksByPlant) return { matched: false }

  const unit = resolveQtyUnit(question, contextQuestion)
  const rows = await getProductGroupPlantBreakdown(product)
  const today = new Date().toISOString().slice(0, 10)

  if (rows.length === 0) {
    return {
      matched: true,
      sourceLabel: 'deterministic.product_by_group_plant',
      factText: `Direct metric from app data: no SAP-present contracts for product ${product}.`,
      result: {
        answer: `No active contracts found for product "${product}" as of ${today} (SAP-withdrawn excluded).`,
        report: '',
        insights: '',
        comparison: '',
      },
    }
  }

  const totals = rows.reduce(
    (acc, r) => ({
      contracts: acc.contracts + r.contract_count,
      total: acc.total + r.total_quantity,
      delivered: acc.delivered + r.delivered_quantity,
      outstanding: acc.outstanding + r.outstanding_quantity,
    }),
    { contracts: 0, total: 0, delivered: 0, outstanding: 0 },
  )
  const pct = (n: number, d: number) => (d > 0 ? `${Math.round((n / d) * 100)}%` : 'n/a')
  const top = rows[0]

  const lines = rows.map(
    (r) =>
      `${r.group_plant}: ${fmt(r.contract_count)} contracts | total ${fmtQty(r.total_quantity, unit)} | delivered ${fmtQty(r.delivered_quantity, unit)} (${pct(r.delivered_quantity, r.total_quantity)}) | outstanding ${fmtQty(r.outstanding_quantity, unit)}`,
  )

  return {
    matched: true,
    sourceLabel: 'deterministic.product_by_group_plant',
    factText:
      `Direct metric from app data: product=${product} across ${rows.length} Group Plants, ` +
      `contracts=${totals.contracts}, outstanding=${fmtQty(totals.outstanding, unit)}.`,
    result: {
      answer:
        `${product} by Group Plant as of ${today}: ${fmt(totals.contracts)} contracts across ${rows.length} areas, ` +
        `${fmtQtyBoth(totals.total, unit)} contracted, ${fmtQty(totals.delivered, unit)} delivered (${pct(totals.delivered, totals.total)}), ` +
        `${fmtQtyBoth(totals.outstanding, unit)} outstanding.\n` +
        `${top.group_plant} carries the largest outstanding balance at ${fmtQty(top.outstanding_quantity, unit)} (${pct(top.outstanding_quantity, totals.outstanding)} of ${product} outstanding).\n` +
        `Scope: Group Plant from Master Plant List, all contract dates, SAP-withdrawn excluded.`,
      report: `${product} by Group Plant (as of ${today})\n${lines.join('\n')}\nTOTAL: ${fmt(totals.contracts)} contracts | total ${fmtQty(totals.total, unit)} | delivered ${fmtQty(totals.delivered, unit)} | outstanding ${fmtQty(totals.outstanding, unit)}`,
      insights:
        `${top.group_plant} is where ${product} follow-up pays off most. ` +
        `Contracts whose plant_code/company_name do not map to Master Plant List land in "Blank" — if that row is large, fix the plant mapping before drawing site conclusions. ` +
        `Delivered follows incoterm (CIF/CFR/FRC use SAP Quantity Receive, FOB/LCO use Quantity Delivered, otherwise STO quantity).`,
      comparison: '',
    },
  }
}

const needsClarification = (question: string): { needed: boolean; text?: string } => {
  const q = question.trim().toLowerCase()
  const ambiguousMetricWords = ['score', 'index', 'health', 'efficiency', 'quality score', 'risk score', 'readiness score']
  const hasAmbiguous = ambiguousMetricWords.some((w) => q.includes(w))
  if (!hasAmbiguous) return { needed: false }

  return {
    needed: true,
    text:
      'I can calculate this, but I need your formula first. Please confirm the exact formula (numerator/denominator, filters, and period). ' +
      'If you want, I can use a proposed default formula and you can approve it before I run.',
  }
}

/**
 * Episodic recall: which questions have been asked before, and how they were answered.
 *
 * Two deliberate constraints:
 *  - Answers rated 1-2 are excluded. Previously every past answer was replayed as an example,
 *    including ones a user had explicitly marked wrong, which taught the agent its own mistakes.
 *  - Only a short gist of each past answer is passed, not the full text. Stored figures go stale
 *    as soon as SAP posts a GR or a formula is corrected, and replaying them in full made the
 *    agent spend its output arguing with itself about "discrepancies". Durable guidance belongs
 *    in agent_ai_lessons instead.
 */
const MEMORY_GIST_CHARS = 400

const loadSimilarMemories = async (question: string) => {
  const qTokens = tokenize(question)
  const result = await query(
    `
    SELECT id, question, answer, rating, created_at
    FROM agent_ai_memory
    WHERE (rating IS NULL OR rating >= 3)
    ORDER BY created_at DESC
    LIMIT 300
    `
  )
  const scored = (result.rows || [])
    .map((r: any) => {
      const base = jaccard(qTokens, tokenize(String(r.question || '')))
      // A thumbs-up answer is a better template than an unrated one.
      const ratingBoost = Number(r.rating) >= 4 ? 0.05 : 0
      return { ...r, score: base + ratingBoost }
    })
    .filter((r: any) => r.score > 0.08)
    .sort((a: any, b: any) => b.score - a.score)
    .slice(0, 5)
    .map((r: any) => ({
      question: r.question,
      answer_gist: truncateText(String(r.answer || ''), MEMORY_GIST_CHARS),
      rating: r.rating,
      asked_at: r.created_at,
    }))

  return scored
}

const saveMemory = async (args: {
  userId?: string
  question: string
  result: AgentAiResult
  directUsed: boolean
}) => {
  const insert = await query(
    `
    INSERT INTO agent_ai_memory (question, answer, report, insights, comparison, direct_used, created_by)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING id
    `,
    [
      args.question,
      args.result.answer || null,
      args.result.report || null,
      args.result.insights || null,
      args.result.comparison || null,
      args.directUsed,
      args.userId || null,
    ]
  )
  return insert.rows?.[0]?.id || null
}

const buildPrompt = (question: string, appData: unknown, uploadedText?: string) => `
Answer as the KLIP Agent AI persona defined in your system instruction. Be accurate, evidence-based, and operationally useful.

User question:
${question}

Application data summary (live database; treat as the only source of exact values):
${JSON.stringify(appData, null, 2)}

${uploadedText ? `Uploaded user data excerpt:\n${uploadedText}\n` : 'No uploaded file text provided.\n'}

Tasks:
1) Answer the user question using ONLY the application data context and uploaded excerpt.
2) If the question is asking for "what should we do" / improvements / root-cause, include logistics best-practice recommendations.
3) If user asks for report/dashboard output, provide a concise report format.
4) If uploaded data exists, compare uploaded data vs app data and describe key mismatches.

Hard rules (do not break these):
- Do NOT invent exact values. If a value is not present in context, say "unknown" and explain what data is needed.
- Prefer deterministic facts provided in context (e.g. "direct_fact") over narrative. Never contradict them.
- "similar_memories" are NOT a data source. They may be used only as phrasing examples or to recall which metric/query to run next. Do not copy their numbers unless those numbers also appear in the application data summary.
- Separate facts vs assumptions clearly.
- Keep it practical for operations, finance, and management stakeholders.

Output format requirements (put these headings INSIDE the strings you return):
- In "answer": the direct answer first (max 3 sentences, lead with the number if one was asked
  for), then only the step-by-step steps that carry it, then evidence, assumptions if any, and
  one concrete next step. Keep it tight.
- In "insights": your double-check of the numbers, the failure modes that could realistically
  change this answer, and recommendations only if the user asked what to do or the data shows a
  clear problem. A few lines each — no generic risk lists.
- Leave "report" or "comparison" as an empty string when not applicable. Do not explain the
  absence, and do not repeat content across fields.

Return strict JSON ONLY:
{
  "answer": "string",
  "report": "string",
  "insights": "string",
  "comparison": "string"
}
`

export const askAgentAi = async (req: AuthRequest, res: Response) => {
  try {
    if (!isAnthropicConfigured()) {
      return res.status(500).json({
        success: false,
        error: { message: 'ANTHROPIC_API_KEY is not configured on the server' },
      })
    }

    const question = String(req.body?.question || '').trim()
    const contextRaw = String(req.body?.context || '').trim()
    let context: { lastUserQuestion?: string | null; lastSourceLabel?: string | null } = {}
    if (contextRaw) {
      try {
        context = JSON.parse(contextRaw)
      } catch {
        context = {}
      }
    }
    if (!question) {
      return res.status(400).json({
        success: false,
        error: { message: 'Question is required' },
      })
    }

    const clarification = needsClarification(question)
    if (clarification.needed) {
      return res.json({
        success: true,
        data: {
          answer: clarification.text,
          report: '',
          insights: '',
          comparison: '',
          clarification: clarification.text,
        },
        meta: {
          hasUpload: !!(req as any).file,
          uploadedFileName: (req as any).file?.originalname || null,
          usedDirectMetric: false,
          source: {
            mode: 'clarification_needed',
            label: 'formula_confirmation_required',
            detail: clarification.text,
          },
          memoryId: null,
        },
      })
    }

    // Memory: durable lessons shape this answer, and any preference stated in this question is
    // captured now so it also applies to the next one. Lessons are team-wide - what one person
    // teaches the agent applies to everyone, so nobody has to re-teach it.
    let lessons: AgentLesson[] = []
    try {
      for (const pref of detectStatedPreferences(question)) {
        await recordLesson({ userId: req.user?.id, kind: pref.kind, lesson: pref.lesson })
      }
      lessons = await loadLessons()
    } catch (err) {
      logger.warn('Agent AI lessons unavailable; answering without them', err)
    }

    const requestedYear = extractYear(question) || extractYear(String(context.lastUserQuestion || '')) || null
    const isYearOnlyFollowup =
      !!requestedYear &&
      /\b(show|only|just|filter|for)\b/i.test(question) &&
      !/\b(product|supplier|incoterm|outstanding|delivered|payment|overdue|top)\b/i.test(question)

    const normalizedQuestion =
      isYearOnlyFollowup && context.lastSourceLabel === 'deterministic.incoterm_quantity_breakdown'
        ? `incoterm breakdown for ${requestedYear}`
        : question

    const directCandidates = await Promise.all([
      // First: a scoped question (area, product x area, aging) must never fall through to
      // company-wide numbers or to asking the user to run the query themselves.
      // Multi-dimension questions first: a narrow single-dimension matcher must never claim
      // "outstanding CPO in Bontang by Incoterm and Group Supplier" and drop half the question.
      tryDirectFlexibleBreakdown(normalizedQuestion, String(context.lastUserQuestion || '')),
      tryDirectContractAging(normalizedQuestion, String(context.lastUserQuestion || '')),
      tryDirectProductByGroupPlant(normalizedQuestion, String(context.lastUserQuestion || '')),
      tryDirectGroupPlantContractPerformance(normalizedQuestion, String(context.lastUserQuestion || '')),
      tryDirectProductOutstandingAnswer(normalizedQuestion, requestedYear),
      tryDirectProductDeliveredAnswer(normalizedQuestion, requestedYear),
      tryDirectOutstandingPaymentAnswer(normalizedQuestion, requestedYear),
      tryDirectTopVendorsOutstanding(normalizedQuestion, requestedYear),
      tryDirectTopSuppliersOutstanding(normalizedQuestion, requestedYear),
      tryDirectOverduePayments(normalizedQuestion, requestedYear),
      tryDirectIncotermBreakdown(normalizedQuestion, requestedYear),
      tryDirectVendorGroupBreakdown(normalizedQuestion, String(context.lastUserQuestion || ''), requestedYear),
    ])
    const direct = directCandidates.find((d) => d.matched) || { matched: false as const }
    const appData = await getAppDataContext()
    const similarMemories = await loadSimilarMemories(question)

    const file = (req as any).file as Express.Multer.File | undefined
    let uploadedText = ''
    const images: KlipAgentImage[] = []

    if (file && file.buffer) {
      const mime = file.mimetype || 'application/octet-stream'
      const lowerName = String(file.originalname || '').toLowerCase()

      if (mime.startsWith('image/')) {
        // Claude accepts jpeg/png/gif/webp only, and one oversized upload must not
        // blow the request limit — anything else degrades to a text note.
        if (!isSupportedAgentImageMediaType(mime)) {
          uploadedText = `Uploaded image: ${file.originalname} (${mime}). Unsupported image format for vision analysis (use JPEG, PNG, GIF, or WebP); use for high-level comparison only.`
        } else if (file.buffer.length > MAX_IMAGE_BYTES) {
          uploadedText = `Uploaded image: ${file.originalname} (${mime}, ${(file.buffer.length / (1024 * 1024)).toFixed(1)} MB). Too large for vision analysis (limit ${MAX_IMAGE_BYTES / (1024 * 1024)} MB); use for high-level comparison only.`
        } else {
          images.push({ mediaType: mime, base64: file.buffer.toString('base64') })
        }
      } else if (
        mime.includes('json') ||
        mime.includes('text') ||
        lowerName.endsWith('.csv') ||
        lowerName.endsWith('.txt')
      ) {
        uploadedText = truncateText(file.buffer.toString('utf-8'), 12000)
      } else if (lowerName.endsWith('.xlsx') || lowerName.endsWith('.xls')) {
        try {
          const wb = XLSX.read(file.buffer, { type: 'buffer' })
          const first = wb.SheetNames[0]
          const sheet = first ? wb.Sheets[first] : undefined
          if (sheet) {
            const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as unknown[][]
            const preview = rows.slice(0, 200).map((r) => r.map((c) => String(c ?? '')).join(',')).join('\n')
            uploadedText = truncateText(preview, 12000)
          }
        } catch (err) {
          logger.warn('Failed to parse uploaded excel for Agent AI', err)
        }
      } else {
        uploadedText = `Uploaded file: ${file.originalname} (${mime}). Unsupported for text parsing; use for high-level comparison only.`
      }
    }

    // Deterministic-first behavior:
    // If we already have an exact metric answer and there is no uploaded file to compare,
    // return immediately (no LLM post-processing to avoid contradictory narrative).
    if (direct.matched && direct.result && !file) {
      const memoryId = await saveMemory({
        userId: req.user?.id,
        question,
        result: direct.result,
        directUsed: true,
      })
      logChatAgentActivity(
        req,
        `Answered question: ${question}`,
        'success',
        { mode: 'deterministic', memoryId, source: direct.sourceLabel || null },
      )
      return res.json({
        success: true,
        data: direct.result,
        meta: {
          hasUpload: false,
          uploadedFileName: null,
          usedDirectMetric: true,
          source: {
            mode: 'deterministic',
            label: direct.sourceLabel || 'deterministic.metric_query',
            detail: direct.factText || null,
          },
          memoryId,
        },
      })
    }

    const prompt = buildPrompt(
      question,
      {
        ...appData,
        direct_fact: direct.factText || null,
        similar_memories: similarMemories,
      },
      uploadedText
    )

    let claude
    try {
      claude = await askKlipAgentClaude({
        userPrompt: prompt,
        images,
        extraSystemInstructions: renderLessonsForPrompt(lessons),
      })
    } catch (err) {
      const detail = describeAnthropicError(err)
      logger.error('Agent AI Claude API error', { detail, error: err })
      logChatAgentActivity(
        req,
        `Chat request failed (${detail}): ${truncateActivityText(question, 200)}`,
        'error',
        { question, detail },
      )
      return res.status(500).json({
        success: false,
        error: { message: 'Failed to generate AI response' },
      })
    }

    if (claude.refused || !claude.text) {
      const detail = claude.refused
        ? 'Claude declined to answer this request'
        : 'Claude returned an empty response'
      logger.error('Agent AI Claude produced no usable answer', {
        detail,
        stopReason: claude.stopReason,
      })
      logChatAgentActivity(
        req,
        `Chat request failed (${detail}): ${truncateActivityText(question, 200)}`,
        'error',
        { question, stopReason: claude.stopReason },
      )
      return res.status(500).json({
        success: false,
        error: { message: 'Failed to generate AI response' },
      })
    }

    const parsed = parseAgentAiResponse(claude.text)
    const finalData = direct.matched && direct.result
      ? {
          // Keep deterministic values as source of truth for core KPI outputs.
          answer: direct.result.answer,
          report: direct.result.report,
          insights: direct.result.insights,
          // LLM can still help on file/image comparison narrative when upload exists.
          comparison: parsed.comparison || direct.result.comparison || '',
          clarification: direct.result.clarification,
          reportTable: direct.result.reportTable ?? null,
        }
      : parsed

    const memoryId = await saveMemory({
      userId: req.user?.id,
      question,
      result: finalData,
      directUsed: !!direct.matched,
    })
    void markLessonsApplied(lessons.map((l) => l.id))
    logChatAgentActivity(
      req,
      `Answered question: ${question}`,
      'success',
      {
        mode: direct.matched ? 'deterministic' : 'llm_with_context',
        memoryId,
        hasUpload: !!file,
        lessonsApplied: lessons.length,
        model: claude.model,
        inputTokens: claude.inputTokens,
        outputTokens: claude.outputTokens,
      },
    )

    return res.json({
      success: true,
      data: finalData,
      meta: {
        hasUpload: !!file,
        uploadedFileName: file?.originalname || null,
        usedDirectMetric: direct.matched,
        source: direct.matched
          ? {
              mode: 'deterministic',
              label: direct.sourceLabel || 'deterministic.metric_query',
              detail: direct.factText || null,
            }
          : {
              mode: 'llm_with_context',
              label: claude.model,
              detail: 'Generated from app data context, similar-memory retrieval, and optional uploaded file/image.',
            },
        memoryId,
      },
    })
  } catch (error) {
    logger.error('Agent AI ask error:', error)
    const message = error instanceof Error ? error.message : 'Failed to process Agent AI request'
    logChatAgentActivity(
      req,
      `Chat request failed: ${message}`,
      'error',
      { question: String(req.body?.question || '').trim() || null },
    )
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to process Agent AI request' },
    })
  }
}

export const rateAgentAiAnswer = async (req: AuthRequest, res: Response) => {
  try {
    const memoryId = String(req.body?.memoryId || '').trim()
    const ratingRaw = req.body?.rating
    const feedback = String(req.body?.feedback || '').trim()
    const rating = ratingRaw == null ? null : Number(ratingRaw)

    if (!memoryId) {
      return res.status(400).json({ success: false, error: { message: 'memoryId is required' } })
    }
    if (rating != null && (!Number.isFinite(rating) || rating < 1 || rating > 5)) {
      return res.status(400).json({ success: false, error: { message: 'rating must be between 1 and 5' } })
    }

    const updated = await query(
      `
      UPDATE agent_ai_memory
      SET rating = $2, feedback = $3, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING question, answer
      `,
      [memoryId, rating, feedback || null]
    )

    // Close the loop: a thumbs-down (or any written feedback) becomes a durable, number-free
    // lesson replayed into future answers. Fire-and-forget — feedback is already saved, and the
    // user must not wait on an LLM call to see their rating accepted.
    const row = updated.rows?.[0]
    if (row) {
      void distillLessonFromFeedback({
        userId: req.user?.id,
        memoryId,
        question: String(row.question || ''),
        answer: String(row.answer || ''),
        feedback,
        rating,
      })
    }

    return res.json({ success: true })
  } catch (error) {
    logger.error('Agent AI feedback error:', error)
    return res.status(500).json({ success: false, error: { message: 'Failed to save feedback' } })
  }
}

