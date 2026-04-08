import { Response } from 'express'
import * as XLSX from 'xlsx'
import { query } from '../database/connection'
import { AuthRequest } from '../middleware/auth'
import logger from '../utils/logger'

type AgentAiResult = {
  answer: string
  report: string
  insights: string
  comparison: string
  clarification?: string
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

const parseAgentAiResponse = (text: string): AgentAiResult => {
  const fallback: AgentAiResult = {
    answer: text || 'No answer generated.',
    report: '',
    insights: '',
    comparison: '',
  }
  const block = extractJsonBlock(text)
  if (!block) return fallback
  try {
    const obj = JSON.parse(block) as Partial<AgentAiResult>
    return {
      answer: typeof obj.answer === 'string' ? obj.answer : fallback.answer,
      report: typeof obj.report === 'string' ? obj.report : '',
      insights: typeof obj.insights === 'string' ? obj.insights : '',
      comparison: typeof obj.comparison === 'string' ? obj.comparison : '',
    }
  } catch {
    return fallback
  }
}

const getAppDataContext = async () => {
  const [contractsRes, shipmentsRes, truckingRes, financeRes, productRes] = await Promise.all([
    query(`
      SELECT
        COUNT(*)::int AS total_contracts,
        COUNT(*) FILTER (WHERE UPPER(COALESCE(status, '')) IN ('OPEN','ACTIVE'))::int AS open_contracts,
        COUNT(*) FILTER (WHERE UPPER(COALESCE(status, '')) IN ('CLOSE','CLOSED','COMPLETED'))::int AS closed_contracts,
        COALESCE(SUM(quantity_ordered), 0)::numeric AS total_quantity,
        COALESCE(SUM(contract_value), 0)::numeric AS total_contract_value
      FROM contracts
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
      WITH delivered_by_contract AS (
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
      SELECT
        c.product,
        COUNT(DISTINCT c.contract_id)::int AS contract_count,
        COALESCE(SUM(c.quantity_ordered), 0)::numeric AS total_quantity,
        COALESCE(SUM(
          CASE
            WHEN UPPER(TRIM(COALESCE(c.incoterm, ''))) IN ('FRC', 'CIF', 'CFR') THEN COALESCE(db.quantity_receive, 0)
            WHEN UPPER(TRIM(COALESCE(c.incoterm, ''))) IN ('LCO', 'FOB') THEN COALESCE(db.quantity_delivery, 0)
            ELSE COALESCE(db.total_sto_quantity, 0)
          END
        ), 0)::numeric AS delivered_quantity,
        COALESCE(SUM(c.quantity_ordered), 0)::numeric - COALESCE(SUM(
          CASE
            WHEN UPPER(TRIM(COALESCE(c.incoterm, ''))) IN ('FRC', 'CIF', 'CFR') THEN COALESCE(db.quantity_receive, 0)
            WHEN UPPER(TRIM(COALESCE(c.incoterm, ''))) IN ('LCO', 'FOB') THEN COALESCE(db.quantity_delivery, 0)
            ELSE COALESCE(db.total_sto_quantity, 0)
          END
        ), 0)::numeric AS outstanding_quantity
      FROM contracts c
      LEFT JOIN delivered_by_contract db ON db.contract_id = c.contract_id
      WHERE c.product IS NOT NULL AND TRIM(c.product) <> ''
      GROUP BY c.product
      ORDER BY outstanding_quantity DESC NULLS LAST
      LIMIT 150
    `),
  ])

  return {
    contracts: contractsRes.rows[0] || {},
    shipments: shipmentsRes.rows[0] || {},
    trucking: truckingRes.rows[0] || {},
    finance: financeRes.rows[0] || {},
    product_summary: productRes.rows || [],
  }
}

const getProductMetrics = async (productHint: string, year?: number | null) => {
  const yearFilter = year ? ` AND EXTRACT(YEAR FROM c.contract_date) = $2 ` : ''
  const sql = `
    WITH delivered_by_contract AS (
      SELECT
        spd.contract_number AS contract_id,
        SUM(
          CAST(REPLACE(REPLACE(COALESCE(spd.data->'contract'->>'sto_quantity', ''), ',', ''), ' ', '') AS NUMERIC)
        ) AS delivered_quantity
      FROM sap_processed_data spd
      WHERE spd.sto_number IS NOT NULL
        AND spd.data->'contract'->>'sto_quantity' IS NOT NULL
        AND TRIM(spd.data->'contract'->>'sto_quantity') != ''
      GROUP BY spd.contract_number
    ),
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
      COALESCE(SUM(COALESCE(db.delivered_quantity, 0)), 0)::numeric AS delivered_quantity,
      COALESCE(SUM(c.quantity_ordered), 0)::numeric - COALESCE(SUM(COALESCE(db.delivered_quantity, 0)), 0)::numeric AS outstanding_quantity,
      COALESCE(SUM(CASE WHEN COALESCE(ps.has_blank_payoff, 0) = 1 THEN (c.quantity_ordered - COALESCE(db.delivered_quantity, 0)) ELSE 0 END), 0)::numeric AS outstanding_payment_quantity
    FROM contracts c
    LEFT JOIN delivered_by_contract db ON db.contract_id = c.contract_id
    LEFT JOIN payment_status_per_contract ps ON ps.contract_id = c.id
    WHERE c.product ILIKE $1
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
  const yearFilter = year ? ` WHERE EXTRACT(YEAR FROM c.contract_date) = $1 ` : ''
  const res = await query(`
    WITH delivered_by_contract AS (
      SELECT
        spd.contract_number AS contract_id,
        SUM(
          CAST(REPLACE(REPLACE(COALESCE(spd.data->'contract'->>'sto_quantity', ''), ',', ''), ' ', '') AS NUMERIC)
        ) AS delivered_quantity
      FROM sap_processed_data spd
      WHERE spd.sto_number IS NOT NULL
        AND spd.data->'contract'->>'sto_quantity' IS NOT NULL
        AND TRIM(spd.data->'contract'->>'sto_quantity') != ''
      GROUP BY spd.contract_number
    )
    SELECT
      COALESCE(NULLIF(TRIM(c.incoterm), ''), 'Blank') AS incoterm,
      COUNT(DISTINCT c.contract_id)::int AS contract_count,
      COALESCE(SUM(c.quantity_ordered), 0)::numeric AS total_quantity,
      COALESCE(SUM(COALESCE(db.delivered_quantity, 0)), 0)::numeric AS delivered_quantity,
      COALESCE(SUM(c.quantity_ordered), 0)::numeric - COALESCE(SUM(COALESCE(db.delivered_quantity, 0)), 0)::numeric AS outstanding_quantity
    FROM contracts c
    LEFT JOIN delivered_by_contract db ON db.contract_id = c.contract_id
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
  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''

  const res = await query(
    `
    WITH delivered_by_contract AS (
      SELECT
        spd.contract_number AS contract_id,
        SUM(
          CAST(REPLACE(REPLACE(COALESCE(spd.data->'contract'->>'sto_quantity', ''), ',', ''), ' ', '') AS NUMERIC)
        ) AS delivered_quantity
      FROM sap_processed_data spd
      WHERE spd.sto_number IS NOT NULL
        AND spd.data->'contract'->>'sto_quantity' IS NOT NULL
        AND TRIM(spd.data->'contract'->>'sto_quantity') != ''
      GROUP BY spd.contract_number
    ),
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
      COALESCE(SUM(COALESCE(db.delivered_quantity, 0)), 0)::numeric AS delivered_quantity,
      COALESCE(SUM(c.quantity_ordered), 0)::numeric - COALESCE(SUM(COALESCE(db.delivered_quantity, 0)), 0)::numeric AS outstanding_quantity,
      COALESCE(SUM(CASE WHEN COALESCE(ps.has_blank_payoff, 0) = 1 THEN (c.quantity_ordered - COALESCE(db.delivered_quantity, 0)) ELSE 0 END), 0)::numeric AS outstanding_payment_quantity
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
        `Outstanding quantity for ${product}: ${outstandingQuantity.toLocaleString('en-US')} Kg ` +
        `(Total: ${totalQuantity.toLocaleString('en-US')} Kg, Delivered: ${deliveredQuantity.toLocaleString('en-US')} Kg, Contracts: ${contractCount.toLocaleString('en-US')})` +
        `${year ? ` for ${year}.` : '.'}`,
      report: `${product} quantity report\n- Total: ${totalQuantity.toLocaleString('en-US')} Kg\n- Delivered: ${deliveredQuantity.toLocaleString('en-US')} Kg\n- Outstanding: ${outstandingQuantity.toLocaleString('en-US')} Kg\n- Contracts: ${contractCount.toLocaleString('en-US')}`,
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
        `Delivered quantity for ${product}: ${deliveredQuantity.toLocaleString('en-US')} Kg ` +
        `(Total: ${totalQuantity.toLocaleString('en-US')} Kg, Outstanding: ${outstandingQuantity.toLocaleString('en-US')} Kg, Contracts: ${contractCount.toLocaleString('en-US')}).`,
      report: `${product} delivery report\n- Total: ${totalQuantity.toLocaleString('en-US')} Kg\n- Delivered: ${deliveredQuantity.toLocaleString('en-US')} Kg\n- Outstanding: ${outstandingQuantity.toLocaleString('en-US')} Kg\n- Contracts: ${contractCount.toLocaleString('en-US')}`,
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
      answer: `Outstanding payment quantity for ${product}: ${opQty.toLocaleString('en-US')} Kg.`,
      report: `${product} payment-outstanding report\n- Outstanding payment quantity: ${opQty.toLocaleString('en-US')} Kg`,
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
    WITH delivered_by_contract AS (
      SELECT
        spd.contract_number AS contract_id,
        SUM(
          CAST(REPLACE(REPLACE(COALESCE(spd.data->'contract'->>'sto_quantity', ''), ',', ''), ' ', '') AS NUMERIC)
        ) AS delivered_quantity
      FROM sap_processed_data spd
      WHERE spd.sto_number IS NOT NULL
        AND spd.data->'contract'->>'sto_quantity' IS NOT NULL
        AND TRIM(spd.data->'contract'->>'sto_quantity') != ''
      GROUP BY spd.contract_number
    )
    SELECT
      c.supplier,
      COALESCE(SUM(c.quantity_ordered), 0)::numeric - COALESCE(SUM(COALESCE(db.delivered_quantity, 0)), 0)::numeric AS outstanding_quantity
    FROM contracts c
    LEFT JOIN delivered_by_contract db ON db.contract_id = c.contract_id
    WHERE c.supplier IS NOT NULL AND TRIM(c.supplier) <> ''
      ${yearFilter}
    GROUP BY c.supplier
    ORDER BY outstanding_quantity DESC NULLS LAST
    LIMIT 5
  `, year ? [year] : [])
  const rows = res.rows || []
  if (rows.length === 0) return { matched: false }
  const lines = rows.map((r: any, i: number) => `${i + 1}. ${r.supplier}: ${Number(r.outstanding_quantity || 0).toLocaleString('en-US')} Kg`)
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
    WITH delivered_by_contract AS (
      SELECT
        spd.contract_number AS contract_id,
        SUM(
          CAST(REPLACE(REPLACE(COALESCE(spd.data->'contract'->>'sto_quantity', ''), ',', ''), ' ', '') AS NUMERIC)
        ) AS delivered_quantity
      FROM sap_processed_data spd
      WHERE spd.sto_number IS NOT NULL
        AND spd.data->'contract'->>'sto_quantity' IS NOT NULL
        AND TRIM(spd.data->'contract'->>'sto_quantity') != ''
      GROUP BY spd.contract_number
    )
    SELECT
      COALESCE(NULLIF(TRIM(c.group_name), ''), NULLIF(TRIM(c.supplier), ''), 'Unknown') AS vendor,
      COALESCE(SUM(c.quantity_ordered), 0)::numeric - COALESCE(SUM(COALESCE(db.delivered_quantity, 0)), 0)::numeric AS outstanding_quantity
    FROM contracts c
    LEFT JOIN delivered_by_contract db ON db.contract_id = c.contract_id
    WHERE (c.group_name IS NOT NULL AND TRIM(c.group_name) <> '')
       OR (c.supplier IS NOT NULL AND TRIM(c.supplier) <> '')
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
    (r: any, i: number) => `${i + 1}. ${r.vendor}: ${Number(r.outstanding_quantity || 0).toLocaleString('en-US')} Kg`
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
  const lines = rows.map((r: any) => `${r.dim}: ${Number(r.total_payments || 0).toLocaleString('en-US')} payments, amount ${Number(r.total_amount || 0).toLocaleString('en-US')}`)
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
    return `${r.incoterm}: ${qty.toLocaleString('en-US')} Kg (${pct.toFixed(2)}%)`
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
    `${i + 1}. ${r.vendor_group}: outstanding ${Number(r.outstanding_quantity || 0).toLocaleString('en-US')} Kg, ` +
    `delivered ${Number(r.delivered_quantity || 0).toLocaleString('en-US')} Kg, total ${Number(r.total_quantity || 0).toLocaleString('en-US')} Kg`
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

const loadSimilarMemories = async (question: string) => {
  const qTokens = tokenize(question)
  const result = await query(
    `
    SELECT id, question, answer, report, insights, comparison, rating, created_at
    FROM agent_ai_memory
    ORDER BY created_at DESC
    LIMIT 200
    `
  )
  const scored = (result.rows || [])
    .map((r: any) => {
      const score = jaccard(qTokens, tokenize(String(r.question || '')))
      return { ...r, score }
    })
    .filter((r: any) => r.score > 0.08)
    .sort((a: any, b: any) => b.score - a.score)
    .slice(0, 5)
    .map((r: any) => ({
      question: r.question,
      answer: r.answer,
      report: r.report,
      insights: r.insights,
      rating: r.rating,
      created_at: r.created_at,
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
You are KLIP Agent AI for logistics + commercial analytics. You must be accurate, evidence-based, and operationally useful.

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
- In "answer", include:
  - Answer (1-3 sentences)
  - Evidence (what in the provided context supports it)
  - Assumptions (only if needed)
- In "insights", include:
  - Risks / exceptions to watch
  - Recommendations (each with rationale, how to implement in KLIP, risks/trade-offs, success KPIs)
  - Next checks (exact missing data or next query to confirm)

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
    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) {
      return res.status(500).json({
        success: false,
        error: { message: 'GEMINI_API_KEY is not configured on the server' },
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
    const parts: Array<Record<string, unknown>> = []

    if (file && file.buffer) {
      const mime = file.mimetype || 'application/octet-stream'
      const lowerName = String(file.originalname || '').toLowerCase()

      if (mime.startsWith('image/')) {
        parts.push({
          inline_data: {
            mime_type: mime,
            data: file.buffer.toString('base64'),
          },
        })
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
    parts.unshift({ text: prompt })

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts }],
        }),
      }
    )

    if (!response.ok) {
      const text = await response.text()
      logger.error('Agent AI Gemini API error', { status: response.status, body: text })
      return res.status(500).json({
        success: false,
        error: { message: 'Failed to generate AI response' },
      })
    }

    const data = await response.json() as any
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || ''
    const parsed = parseAgentAiResponse(text)
    const finalData = direct.matched && direct.result
      ? {
          // Keep deterministic values as source of truth for core KPI outputs.
          answer: direct.result.answer,
          report: direct.result.report,
          insights: direct.result.insights,
          // LLM can still help on file/image comparison narrative when upload exists.
          comparison: parsed.comparison || direct.result.comparison || '',
          clarification: direct.result.clarification,
        }
      : parsed

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
              label: 'gemini-2.5-flash',
              detail: 'Generated from app data context, similar-memory retrieval, and optional uploaded file/image.',
            },
        memoryId: await saveMemory({
          userId: req.user?.id,
          question,
          result: finalData,
          directUsed: !!direct.matched,
        }),
      },
    })
  } catch (error) {
    logger.error('Agent AI ask error:', error)
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

    await query(
      `
      UPDATE agent_ai_memory
      SET rating = $2, feedback = $3, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      `,
      [memoryId, rating, feedback || null]
    )

    return res.json({ success: true })
  } catch (error) {
    logger.error('Agent AI feedback error:', error)
    return res.status(500).json({ success: false, error: { message: 'Failed to save feedback' } })
  }
}

