import { Response } from 'express';
import { query } from '../database/connection';
import { AuthRequest } from '../middleware/auth';
import logger from '../utils/logger';

// Normalize query param to string[] (Express sends array for ?key=a&key=b)
const toFilterArray = (v: unknown): string[] => {
  if (v == null || v === '') return [];
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string' && String(x).trim() !== '');
  const s = String(v).trim();
  return s ? [s] : [];
};

const plantSimilarity = (a: string, b: string): number => {
  const A = a.trim().replace(/\s+/g, ' ').toUpperCase();
  const B = b.trim().replace(/\s+/g, ' ').toUpperCase();
  if (!A || !B) return A === B ? 1 : 0;
  if (A === B) return 1;
  const longer = A.length >= B.length ? A : B;
  const shorter = A.length >= B.length ? B : A;
  if (longer.includes(shorter) && shorter.length >= 4) return Math.min(1, Math.max(0.62, shorter.length / longer.length));
  const m = A.length;
  const n = B.length;
  const dp = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      dp[j] = A[i - 1] === B[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = tmp;
    }
  }
  return 1 - dp[n] / Math.max(m, n);
};

// Helper function to build filter key (stable representation of filters for caching AI insights)
const buildFilterKey = (req: AuthRequest): { key: string; params: Record<string, unknown> } => {
  const { dateFrom, dateTo, plant, supplier, product, groupName, incoterm } = req.query;
  const filters = {
    dateFrom: dateFrom || null,
    dateTo: dateTo || null,
    plant: toFilterArray(plant),
    supplier: toFilterArray(supplier),
    product: toFilterArray(product),
    groupName: toFilterArray(groupName),
    incoterm: toFilterArray(incoterm),
  };
  // Stable JSON string as key
  const key = JSON.stringify(filters);
  return { key, params: filters };
};

// Helper function to build filter WHERE clauses (multi-value filters use OR)
const buildFilterConditions = (req: AuthRequest): { contractFilter: string; shipmentFilter: string; truckingFilter: string; params: any[] } => {
  const { dateFrom, dateTo, plant, supplier, product, groupName, incoterm } = req.query;
  const params: any[] = [];
  let paramIndex = 1;
  let contractFilter = '';
  let shipmentFilter = '';
  let truckingFilter = '';

  const plants = toFilterArray(plant);
  const suppliers = toFilterArray(supplier);
  const products = toFilterArray(product);
  const groups = toFilterArray(groupName);
  const incoterms = toFilterArray(incoterm);

  // Contract date range filter
  if (dateFrom) {
    contractFilter += ` AND c.contract_date >= $${paramIndex}`;
    params.push(dateFrom);
    paramIndex++;
  }
  if (dateTo) {
    contractFilter += ` AND c.contract_date <= $${paramIndex}`;
    params.push(dateTo);
    paramIndex++;
  }

  // Supplier filter (OR)
  if (suppliers.length > 0) {
    const placeholders = suppliers.map(() => `$${paramIndex++}`).join(', ');
    contractFilter += ` AND c.supplier IN (${placeholders})`;
    params.push(...suppliers);
  }

  // Product filter (OR)
  if (products.length > 0) {
    const placeholders = products.map(() => `$${paramIndex++}`).join(', ');
    contractFilter += ` AND c.product IN (${placeholders})`;
    params.push(...products);
  }

  // Group Name filter (OR)
  if (groups.length > 0) {
    const placeholders = groups.map(() => `$${paramIndex++}`).join(', ');
    contractFilter += ` AND c.group_name IN (${placeholders})`;
    params.push(...groups);
  }

  // Incoterm filter (OR) - normalized: Blank for null/empty
  if (incoterms.length > 0) {
    const placeholders = incoterms.map(() => `$${paramIndex++}`).join(', ');
    contractFilter += ` AND COALESCE(NULLIF(TRIM(c.incoterm), ''), 'Blank') IN (${placeholders})`;
    params.push(...incoterms);
  }

  // Plant/Site filter (OR: match any selected plant)
  if (plants.length > 0) {
    const blankIncluded = plants.includes('Blank');
    const nonBlank = plants.filter((p) => p !== 'Blank');
    const shipParts: string[] = [];
    const truckParts: string[] = [];
    const contractShipParts: string[] = [];
    const contractTruckParts: string[] = [];
    if (blankIncluded) {
      shipParts.push('(s.port_of_discharge IS NULL OR s.port_of_discharge = \'\')');
      truckParts.push('(t.location IS NULL OR t.location = \'\')');
      contractShipParts.push('(s.port_of_discharge IS NULL OR s.port_of_discharge = \'\')');
      contractTruckParts.push('(t.location IS NULL OR t.location = \'\')');
    }
    if (nonBlank.length > 0) {
      const ph = nonBlank.map(() => `$${paramIndex++}`).join(', ');
      shipParts.push(`s.port_of_discharge IN (${ph})`);
      truckParts.push(`t.location IN (${ph})`);
      contractShipParts.push(`s.port_of_discharge IN (${ph})`);
      contractTruckParts.push(`t.location IN (${ph})`);
      params.push(...nonBlank);
    }
    shipmentFilter = ` AND (${shipParts.join(' OR ')})`;
    truckingFilter = ` AND (${truckParts.join(' OR ')})`;
    contractFilter += ` AND (
      EXISTS (SELECT 1 FROM shipments s WHERE s.contract_id = c.id AND (${contractShipParts.join(' OR ')}))
      OR EXISTS (SELECT 1 FROM trucking_operations t WHERE t.contract_id = c.id AND (${contractTruckParts.join(' OR ')}))
    )`;
  }

  return { contractFilter, shipmentFilter, truckingFilter, params };
};

export const getDashboardStats = async (req: AuthRequest, res: Response) => {
  try {
    const { contractFilter, shipmentFilter, truckingFilter, params } = buildFilterConditions(req);
    
    // Get basic contract statistics (status derived from latest SAP data where available)
    const contractsStats = await query(`
      WITH latest_spd AS (
        SELECT DISTINCT ON (spd.contract_number)
          spd.contract_number,
          spd.data
        FROM sap_processed_data spd
        ORDER BY spd.contract_number, spd.created_at DESC NULLS LAST
      )
      SELECT 
        COUNT(DISTINCT c.contract_id) as total_contracts,
        -- Open contracts (status = Open/ACTIVE from SAP, fallback to contracts.status)
        COUNT(DISTINCT c.contract_id) FILTER (
          WHERE
            (
              l.data->'contract'->>'status' = 'Open'
              OR UPPER(l.data->'contract'->>'status') = 'ACTIVE'
            )
            OR (
              l.data IS NULL
              AND UPPER(COALESCE(c.status, '')) IN ('ACTIVE', 'OPEN')
            )
        ) as open_contracts,
        -- Closed contracts (Close/CLOSED/COMPLETED/CANCELLED from SAP, fallback to contracts.status)
        COUNT(DISTINCT c.contract_id) FILTER (
          WHERE
            (
              l.data->'contract'->>'status' = 'Close'
              OR UPPER(l.data->'contract'->>'status') IN ('CLOSE', 'CLOSED', 'COMPLETED', 'CANCELLED')
            )
            OR (
              l.data IS NULL
              AND UPPER(COALESCE(c.status, '')) IN ('CLOSE', 'CLOSED', 'COMPLETED', 'CANCELLED')
            )
        ) as closed_contracts
      FROM contracts c
      LEFT JOIN latest_spd l ON l.contract_number = c.contract_id
      WHERE 1=1 ${contractFilter}
    `, params);

    // Open contract breakdown:
    // - outstanding_logistics: has shipment/trucking work not completed/cancelled yet
    // - outstanding_payment: has at least one payment with blank payoff_date
    const openBreakdownStats = await query(`
      WITH latest_spd AS (
        SELECT DISTINCT ON (spd.contract_number)
          spd.contract_number,
          spd.data
        FROM sap_processed_data spd
        ORDER BY spd.contract_number, spd.created_at DESC NULLS LAST
      ),
      open_contracts AS (
        SELECT c.id, c.contract_id
        FROM contracts c
        LEFT JOIN latest_spd l ON l.contract_number = c.contract_id
        WHERE 1=1 ${contractFilter}
          AND (
            (l.data IS NOT NULL AND (
              l.data->'contract'->>'status' = 'Open'
              OR UPPER(l.data->'contract'->>'status') = 'ACTIVE'
            ))
            OR (l.data IS NULL AND UPPER(COALESCE(c.status, '')) IN ('OPEN', 'ACTIVE'))
          )
      )
      SELECT
        COUNT(*) FILTER (
          WHERE EXISTS (
            SELECT 1
            FROM shipments s
            WHERE s.contract_id = oc.id
              AND UPPER(COALESCE(s.status, '')) NOT IN ('COMPLETED', 'CANCELLED', 'CANCELED')
          )
          OR EXISTS (
            SELECT 1
            FROM trucking_operations t
            WHERE t.contract_id = oc.id
              AND UPPER(COALESCE(t.status, '')) NOT IN ('COMPLETED', 'CANCELLED', 'CANCELED')
          )
        ) AS open_outstanding_logistics,
        COUNT(*) FILTER (
          WHERE EXISTS (
            SELECT 1
            FROM payments p
            WHERE p.contract_id = oc.id
              AND (p.payoff_date IS NULL OR TRIM(p.payoff_date::text) = '')
          )
        ) AS open_outstanding_payment
      FROM open_contracts oc
    `, params);

    // Quantity statistics across all contracts
    // Total Quantity = sum of contract quantities
    // Quantity Delivered = sum of STO quantities from sap_processed_data
    // Outstanding Quantity = Total Quantity - Quantity Delivered
    // Also break down delivered/outstanding by payoff status:
    // - paid: has at least one non-empty payoff_date
    // - outstanding payment: has at least one empty payoff_date
    const outstandingStats = await query(`
      WITH contract_qty AS (
        SELECT 
          c.id AS contract_pk,
          c.contract_id,
          MAX(c.quantity_ordered) AS contract_quantity,
          COALESCE((
            SELECT SUM(CAST(REPLACE(REPLACE(spd.data->'contract'->>'sto_quantity', ',', ''), ' ', '') AS NUMERIC))
            FROM sap_processed_data spd
            WHERE spd.contract_number = c.contract_id 
              AND spd.data->'contract'->>'sto_quantity' IS NOT NULL
          ), 0) AS delivered_quantity
        FROM contracts c
        WHERE 1=1 ${contractFilter}
        GROUP BY c.id, c.contract_id
      ),
      payment_status_per_contract AS (
        SELECT
          p.contract_id,
          MAX(CASE WHEN p.payment_status = 'PAID' THEN 1 ELSE 0 END) AS has_paid,
          MAX(CASE WHEN p.payoff_date IS NULL THEN 1 ELSE 0 END) AS has_blank_payoff
        FROM payments p
        GROUP BY p.contract_id
      )
      SELECT 
        COALESCE(SUM(q.contract_quantity), 0) AS total_quantity,
        COALESCE(SUM(q.delivered_quantity), 0) AS delivered_quantity,
        COALESCE(SUM(q.contract_quantity - q.delivered_quantity), 0) AS outstanding_quantity,
        COALESCE(SUM(CASE WHEN COALESCE(ps.has_paid, 0) = 1 THEN q.delivered_quantity ELSE 0 END), 0) AS delivered_paid_quantity,
        COALESCE(SUM(CASE WHEN COALESCE(ps.has_blank_payoff, 0) = 1 THEN q.delivered_quantity ELSE 0 END), 0) AS delivered_pending_quantity,
        COALESCE(SUM(CASE WHEN COALESCE(ps.has_paid, 0) = 1 THEN (q.contract_quantity - q.delivered_quantity) ELSE 0 END), 0) AS outstanding_paid_quantity,
        COALESCE(SUM(CASE WHEN COALESCE(ps.has_blank_payoff, 0) = 1 THEN (q.contract_quantity - q.delivered_quantity) ELSE 0 END), 0) AS outstanding_pending_quantity
      FROM contract_qty q
      LEFT JOIN payment_status_per_contract ps ON ps.contract_id = q.contract_pk
    `, params);

    // Get shipment statistics by status
    const shipmentsStats = await query(`
      SELECT 
        COUNT(*) as total_shipments,
        COUNT(*) FILTER (WHERE s.status = 'PLANNED') as planned_shipments,
        COUNT(*) FILTER (WHERE s.status = 'IN_PROGRESS') as in_progress_shipments,
        COUNT(*) FILTER (WHERE s.status = 'LOADING') as loading_shipments,
        COUNT(*) FILTER (WHERE s.status = 'IN_TRANSIT') as in_transit_shipments,
        COUNT(*) FILTER (WHERE s.status = 'ARRIVED') as arrived_shipments,
        COUNT(*) FILTER (WHERE s.status = 'UNLOADING') as unloading_shipments,
        COUNT(*) FILTER (WHERE s.status = 'COMPLETED') as completed_shipments,
        COUNT(*) FILTER (WHERE s.status = 'CANCELLED') as cancelled_shipments,
        COUNT(*) FILTER (
          WHERE
            c.delivery_end_date IS NOT NULL
            AND (
              c.delivery_end_date::date < CURRENT_DATE
              OR (
                (s.ata_discharge_complete IS NOT NULL OR s.eta_discharge_complete IS NOT NULL)
                AND (
                  (s.ata_discharge_complete IS NOT NULL AND c.delivery_end_date::date < s.ata_discharge_complete::date)
                  OR (s.eta_discharge_complete IS NOT NULL AND c.delivery_end_date::date < s.eta_discharge_complete::date)
                )
              )
            )
        ) as late_shipments
      FROM shipments s
      LEFT JOIN contracts c ON s.contract_id = c.id
      WHERE 1=1 ${contractFilter} ${shipmentFilter}
    `, params);

    // Get trucking operations statistics by status
    // Late = same logic as Trucking page: delivery_end vs eta_completion OR effective_actual_completion (on time if delivery_end >= either; else late)
    // effective_actual = COALESCE(t.trucking_completion_date, SAP "Trucking Last Receive Date") to match Trucking page
    const truckingStats = await query(`
      WITH trucking_with_completion AS (
        SELECT
          t.id,
          t.operation_id,
          t.status,
          t.eta_trucking_completion_date,
          c.delivery_end_date,
          COALESCE(NULLIF(TRIM(c.sto_number::text), ''), NULLIF(TRIM(t.operation_id), ''), t.id::text) AS late_key,
          COALESCE(
            t.trucking_completion_date,
            (
              SELECT (CASE
                WHEN trim(v.val) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN trim(v.val)::date
                WHEN trim(v.val) ~ '^[0-9]{1,2}/[0-9]{1,2}/[0-9]{2}$' THEN to_date(trim(v.val), 'MM/DD/YY')
                ELSE NULL
              END)
              FROM (
                SELECT COALESCE(spd.data->'raw'->>'Trucking Last Receive Date', spd.data->>'Trucking Last Receive Date') AS val
                FROM sap_processed_data spd
                WHERE spd.contract_number = c.contract_id
                ORDER BY spd.created_at DESC NULLS LAST
                LIMIT 1
              ) v
              WHERE v.val IS NOT NULL AND length(trim(v.val)) >= 6
            )
          ) AS effective_completion_date
        FROM trucking_operations t
        LEFT JOIN contracts c ON t.contract_id = c.id
        WHERE 1=1 ${contractFilter} ${truckingFilter}
      )
      SELECT 
        COUNT(*) as total_trucking_operations,
        COUNT(*) FILTER (WHERE status = 'PLANNED') as planned_trucking_operations,
        COUNT(*) FILTER (WHERE status = 'IN_PROGRESS') as in_progress_trucking_operations,
        COUNT(*) FILTER (WHERE status = 'LOADING') as loading_trucking_operations,
        COUNT(*) FILTER (WHERE status = 'IN_TRANSIT') as in_transit_trucking_operations,
        COUNT(*) FILTER (WHERE status = 'UNLOADING') as unloading_trucking_operations,
        COUNT(*) FILTER (WHERE status = 'COMPLETED') as completed_trucking_operations,
        COUNT(*) FILTER (WHERE status = 'CANCELLED') as cancelled_trucking_operations,
        COUNT(DISTINCT late_key) FILTER (WHERE
          delivery_end_date IS NOT NULL
          AND (eta_trucking_completion_date IS NOT NULL OR effective_completion_date IS NOT NULL)
          AND NOT (
            (eta_trucking_completion_date IS NOT NULL AND delivery_end_date::date >= eta_trucking_completion_date::date)
            OR (effective_completion_date IS NOT NULL AND delivery_end_date::date >= effective_completion_date::date)
          )
        ) as late_trucking_operations
      FROM trucking_with_completion
    `, params);

    // Get finance statistics aligned to contract value and payoff behavior
    const financeStats = await query(`
      WITH contract_payment AS (
        SELECT
          c.id AS contract_pk,
          c.contract_id,
          COALESCE(c.contract_value, 0) AS contract_value,
          MAX(CASE WHEN p.payoff_date IS NULL THEN 1 ELSE 0 END) AS has_blank_payoff,
          MAX(CASE WHEN p.payoff_date IS NOT NULL THEN 1 ELSE 0 END) AS has_paid,
          MAX(CASE
            WHEN p.payoff_date IS NULL
                 AND p.payment_due_date IS NOT NULL
                 AND p.payment_due_date::date < CURRENT_DATE
              THEN 1
            WHEN p.payoff_date IS NOT NULL
                 AND p.payment_due_date IS NOT NULL
                 AND p.payoff_date::date > p.payment_due_date::date
              THEN 1
            ELSE 0
          END) AS has_late_payment
        FROM contracts c
        LEFT JOIN payments p ON p.contract_id = c.id
        WHERE 1=1 ${contractFilter}
        GROUP BY c.id, c.contract_id, c.contract_value
        HAVING COUNT(p.id) > 0
      )
      SELECT
        COUNT(*) AS total_payments,
        COUNT(*) FILTER (WHERE has_blank_payoff = 1) AS pending_payments,
        COUNT(*) FILTER (WHERE has_paid = 1) AS paid_payments,
        COUNT(*) FILTER (WHERE has_late_payment = 1) AS late_payments,
        COALESCE(SUM(contract_value), 0) AS total_amount,
        COALESCE(SUM(contract_value) FILTER (WHERE has_blank_payoff = 1), 0) AS pending_amount,
        COALESCE(SUM(contract_value) FILTER (WHERE has_paid = 1), 0) AS paid_amount,
        COALESCE(SUM(contract_value) FILTER (WHERE has_late_payment = 1), 0) AS late_amount
      FROM contract_payment
    `, params);

    const cr = contractsStats.rows[0] || {};
    const or_ = outstandingStats.rows[0] || {};
    const sr = shipmentsStats.rows[0] || {};
    const tr = truckingStats.rows[0] || {};
    const fr = financeStats.rows[0] || {};
    const obr = openBreakdownStats.rows[0] || {};

    const stats = {
      contracts: {
        total: parseInt(cr.total_contracts) || 0,
        active: parseInt(cr.open_contracts) || 0,
        closed: parseInt(cr.closed_contracts) || 0,
        completed: 0,
        cancelled: 0,
        outstanding: parseInt(cr.open_contracts) || 0,
        openOutstandingLogistics: parseInt(obr.open_outstanding_logistics) || 0,
        openOutstandingPayment: parseInt(obr.open_outstanding_payment) || 0,
        totalQuantity: parseFloat(or_.total_quantity) || 0,
        deliveredQuantity: parseFloat(or_.delivered_quantity) || 0,
        outstandingQuantity: parseFloat(or_.outstanding_quantity) || 0,
        deliveredPaidQuantity: parseFloat(or_.delivered_paid_quantity) || 0,
        deliveredPendingQuantity: parseFloat(or_.delivered_pending_quantity) || 0,
        outstandingPaidQuantity: parseFloat(or_.outstanding_paid_quantity) || 0,
        outstandingPendingQuantity: parseFloat(or_.outstanding_pending_quantity) || 0
      },
      shipments: {
        total: parseInt(sr.total_shipments) || 0,
        planned: parseInt(sr.planned_shipments) || 0,
        inProgress: parseInt(sr.in_progress_shipments) || 0,
        loading: parseInt(sr.loading_shipments) || 0,
        inTransit: parseInt(sr.in_transit_shipments) || 0,
        arrived: parseInt(sr.arrived_shipments) || 0,
        unloading: parseInt(sr.unloading_shipments) || 0,
        completed: parseInt(sr.completed_shipments) || 0,
        cancelled: parseInt(sr.cancelled_shipments) || 0,
        late: parseInt(sr.late_shipments) || 0
      },
      trucking: {
        total: parseInt(tr.total_trucking_operations) || 0,
        planned: parseInt(tr.planned_trucking_operations) || 0,
        inProgress: parseInt(tr.in_progress_trucking_operations) || 0,
        loading: parseInt(tr.loading_trucking_operations) || 0,
        inTransit: parseInt(tr.in_transit_trucking_operations) || 0,
        unloading: parseInt(tr.unloading_trucking_operations) || 0,
        completed: parseInt(tr.completed_trucking_operations) || 0,
        cancelled: parseInt(tr.cancelled_trucking_operations) || 0,
        late: parseInt(tr.late_trucking_operations) || 0
      },
      finance: {
        total: parseInt(fr.total_payments) || 0,
        pending: parseInt(fr.pending_payments) || 0,
        paid: parseInt(fr.paid_payments) || 0,
        overdue: parseInt(fr.late_payments) || 0,
        totalAmount: parseFloat(fr.total_amount) || 0,
        pendingAmount: parseFloat(fr.pending_amount) || 0,
        paidAmount: parseFloat(fr.paid_amount) || 0,
        overdueAmount: parseFloat(fr.late_amount) || 0,
        revenue: parseFloat(fr.paid_amount) || 0
      }
    };

    return res.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    logger.error('Get dashboard stats error:', error);
    const message =
      error instanceof Error
        ? error.message
        : (error as any)?.message || 'Failed to fetch dashboard statistics';
    return res.status(500).json({
      success: false,
      error: { message },
    });
  }
};

// --- AI Insights (Gemini) ---

interface DashboardAiInsight {
  summary: string;
  highlights: string;
  recommendations: string;
}

const callGeminiForDashboardInsight = async (payload: unknown): Promise<DashboardAiInsight> => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured on the server');
  }

  const prompt = `
You are a senior logistics and supply chain expert for the **manufacturing industry**, specialized in **palm oil downstream** (oleochemicals, fats & oils, consumer products).

You are helping a logistics control tower interpret a dashboard that shows:
- Contracts (quantities, status, outstanding vs delivered, payment status).
- Shipments (sea logistics, late vs on-time).
- Trucking (land logistics, late vs on-time).
- Finance (payments, pending vs paid vs overdue).
- Product x Incoterm mix.
- Plant/Site distribution and performance.

TASK:
Given the JSON payload below (dashboard metrics + aggregates), produce:
1. **Summary**: 2–4 sentences describing the overall situation and recent performance.
2. **Highlights**: 3–7 concise bullet points (written as plain text lines, not with '-' characters) calling out key patterns, risks, or opportunities (e.g., late shipments to certain plants, high outstanding vs delivered, payment bottlenecks, unusual Incoterm mix).
3. **Recommendations**: 3–7 actionable recommendations from the perspective of a logistics manager in palm oil downstream manufacturing, aligned with best practices (e.g., shipment planning, trucking scheduling, supplier collaboration, port strategy, inventory buffers, contract structuring).

RULES:
- Focus on **palm oil downstream manufacturing logistics** (not generic supply chain).
- Be pragmatic and operational, not just descriptive.
- If data is limited or very balanced, say that briefly and still suggest sensible checks or improvements.
- NEVER invent specific numbers; only reference trends that are logically derivable (e.g., "outstanding is high compared to delivered", "late shipments are concentrated in LAND trucking").

Return your answer as **pure JSON** with this exact shape:
{
  "summary": "string",
  "highlights": "multiline string, each highlight on a new line",
  "recommendations": "multiline string, each recommendation on a new line"
}

Now here is the dashboard payload:
${JSON.stringify(payload, null, 2)}
`;

  const response = await fetch(
    // Use Gemini 2.5 Flash for dashboard insights
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [{ text: prompt }],
          },
        ],
      }),
    }
  );

  if (!response.ok) {
    const text = await response.text();
    logger.error('Gemini API error:', { status: response.status, body: text });
    throw new Error('Failed to generate insight from Gemini');
  }

  const data = (await response.json()) as any;
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';

  // Extract first complete JSON object (brace-balanced) so we never store raw JSON in summary
  const extractJsonBlock = (s: string): string => {
    let raw = s.trim();
    if (raw.startsWith('```')) {
      raw = raw.replace(/^```[a-zA-Z]*\s*/, '').replace(/```\s*$/, '').trim();
    }
    const start = raw.indexOf('{');
    if (start === -1) return '';
    let depth = 0;
    for (let i = start; i < raw.length; i++) {
      if (raw[i] === '{') depth++;
      else if (raw[i] === '}') {
        depth--;
        if (depth === 0) return raw.slice(start, i + 1);
      }
    }
    return raw.slice(start, raw.lastIndexOf('}') + 1);
  };

  const normalize = (v: unknown): string => {
    if (v == null) return '';
    if (typeof v === 'string') return v;
    if (Array.isArray(v)) return v.map((x) => (typeof x === 'string' ? x : String(x))).join('\n');
    return String(v);
  };

  let parsed: Partial<DashboardAiInsight> = {};
  const jsonBlock = extractJsonBlock(text);
  if (jsonBlock) {
    try {
      const obj = JSON.parse(jsonBlock) as Record<string, unknown>;
      parsed = {
        summary: normalize(obj.summary),
        highlights: normalize(obj.highlights),
        recommendations: normalize(obj.recommendations),
      };
    } catch {
      // leave parsed empty
    }
  }

  // Never put raw API text into summary; use parsed fields only or a safe message
  const summary = parsed.summary && !parsed.summary.trim().startsWith('{')
    ? parsed.summary
    : (parsed.summary || 'No summary generated.');
  return {
    summary,
    highlights: parsed.highlights ?? '',
    recommendations: parsed.recommendations ?? '',
  };
};

export const getDashboardAiInsight = async (req: AuthRequest, res: Response) => {
  try {
    const { key } = buildFilterKey(req);
    const result = await query(
      'SELECT summary, highlights, recommendations FROM dashboard_ai_insights WHERE filter_key = $1',
      [key]
    );

    if (result.rows.length === 0) {
      return res.json({
        success: true,
        data: null,
      });
    }

    return res.json({
      success: true,
      data: result.rows[0],
    });
  } catch (error) {
    logger.error('Get dashboard AI insight error:', error);
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to load dashboard AI insight' },
    });
  }
};

export const generateDashboardAiInsight = async (req: AuthRequest, res: Response) => {
  try {
    const { key, params } = buildFilterKey(req);
    const payload = {
      filters: params,
      // Frontend may optionally send rich dashboard data to include in the prompt
      dashboard: req.body?.dashboard ?? null,
    };

    const insight = await callGeminiForDashboardInsight(payload);

    const upsertQuery = `
      INSERT INTO dashboard_ai_insights (filter_key, filter_params, summary, highlights, recommendations, model_provider, model_name, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT (filter_key) DO UPDATE
      SET summary = EXCLUDED.summary,
          highlights = EXCLUDED.highlights,
          recommendations = EXCLUDED.recommendations,
          model_provider = EXCLUDED.model_provider,
          model_name = EXCLUDED.model_name,
          updated_at = CURRENT_TIMESTAMP
      RETURNING summary, highlights, recommendations
    `;

    const upsertResult = await query(upsertQuery, [
      key,
      JSON.stringify(params),
      insight.summary,
      insight.highlights,
      insight.recommendations,
      'gemini',
      'gemini-2.5-flash',
    ]);

    return res.json({
      success: true,
      data: upsertResult.rows[0],
    });
  } catch (error: any) {
    logger.error('Generate dashboard AI insight error:', error);
    const message =
      error?.message === 'GEMINI_API_KEY is not configured on the server'
        ? error.message
        : 'Failed to generate dashboard AI insight';
    return res.status(500).json({
      success: false,
      error: { message },
    });
  }
};

export const getTopSuppliers = async (req: AuthRequest, res: Response) => {
  try {
    const { contractFilter, params } = buildFilterConditions(req);
    
    const result = await query(`
      SELECT 
        c.supplier,
        COUNT(DISTINCT c.contract_id) as contract_count,
        SUM(c.quantity_ordered) as total_quantity,
        AVG(c.unit_price) as avg_unit_price,
        SUM(c.contract_value) as total_contract_value
      FROM contracts c
      WHERE c.supplier IS NOT NULL AND c.supplier != '' ${contractFilter}
      GROUP BY c.supplier
      ORDER BY total_quantity DESC
      LIMIT 5
    `, params);

    return res.json({
      success: true,
      data: result.rows,
    });
  } catch (error) {
    logger.error('Get top suppliers error:', error);
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch top suppliers' },
    });
  }
};

export const getTopTruckingOwners = async (req: AuthRequest, res: Response) => {
  try {
    const { contractFilter, truckingFilter, params } = buildFilterConditions(req);
    
    const result = await query(`
      SELECT 
        t.trucking_owner,
        COUNT(*) as operation_count,
        SUM(t.quantity_sent) as total_quantity_sent,
        SUM(t.quantity_delivered) as total_quantity_delivered,
        AVG(t.gain_loss_percentage) as avg_gain_loss_percentage,
        SUM(t.oa_actual) as total_oa_actual
      FROM trucking_operations t
      LEFT JOIN contracts c ON t.contract_id = c.id
      WHERE t.trucking_owner IS NOT NULL AND t.trucking_owner != '' ${contractFilter} ${truckingFilter}
      GROUP BY t.trucking_owner
      ORDER BY total_quantity_sent DESC
      LIMIT 5
    `, params);

    return res.json({
      success: true,
      data: result.rows,
    });
  } catch (error) {
    logger.error('Get top trucking owners error:', error);
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch top trucking owners' },
    });
  }
};

export const getTopVessels = async (req: AuthRequest, res: Response) => {
  try {
    const { contractFilter, shipmentFilter, params } = buildFilterConditions(req);
    
    const result = await query(`
      SELECT 
        s.vessel_name,
        COUNT(*) as shipment_count,
        SUM(s.quantity_shipped) as total_quantity_shipped,
        SUM(s.quantity_delivered) as total_quantity_delivered,
        AVG(s.gain_loss_percentage) as avg_gain_loss_percentage,
        COUNT(*) FILTER (WHERE s.is_delayed = true) as delayed_count
      FROM shipments s
      LEFT JOIN contracts c ON s.contract_id = c.id
      WHERE s.vessel_name IS NOT NULL AND s.vessel_name != '' ${contractFilter} ${shipmentFilter}
      GROUP BY s.vessel_name
      ORDER BY total_quantity_shipped DESC
      LIMIT 5
    `, params);

    return res.json({
      success: true,
      data: result.rows,
    });
  } catch (error) {
    logger.error('Get top vessels error:', error);
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch top vessels' },
    });
  }
};

export const getContractsByStatus = async (req: AuthRequest, res: Response) => {
  try {
    const { status } = req.query as { status?: string };
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 100;

    const { contractFilter, params } = buildFilterConditions(req);
    let paramIndex = params.length + 1;

    let queryText = `
      SELECT 
        c.contract_id,
        c.supplier,
        c.buyer,
        c.product,
        c.quantity_ordered,
        c.unit,
        c.contract_value,
        c.currency,
        c.status,
        c.contract_date,
        c.delivery_start_date,
        c.delivery_end_date
      FROM contracts c
      WHERE 1=1 ${contractFilter}
    `;
    const finalParams: any[] = [...params];

    if (status) {
      queryText += ` AND c.status = $${paramIndex}`;
      finalParams.push(status);
      paramIndex++;
    }

    queryText += ` ORDER BY c.contract_date DESC LIMIT $${paramIndex}`;
    finalParams.push(limit);

    const result = await query(queryText, finalParams);

    return res.json({
      success: true,
      data: result.rows,
    });
  } catch (error) {
    logger.error('Get contracts by status error:', error);
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch contracts' },
    });
  }
};

export const getShipmentsByStatus = async (req: AuthRequest, res: Response) => {
  try {
    const { status, delayed } = req.query as { status?: string; delayed?: string };
    const statusNorm = String(status || '').trim().toUpperCase();
    const limitRaw = req.query.limit ? parseInt(req.query.limit as string) : 100;
    const offsetRaw = req.query.offset ? parseInt(req.query.offset as string) : 0;
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(500, limitRaw)) : 100;
    const offset = Number.isFinite(offsetRaw) ? Math.max(0, offsetRaw) : 0;

    // Reuse dashboard filter conditions
    const { contractFilter, shipmentFilter, params } = buildFilterConditions(req);
    let paramIndex = params.length + 1;

    // Same "late" logic as dashboard stats and Shipments page: delivery_end_date vs today / ATA/ETA discharge
    const lateCondition = `
      c.delivery_end_date IS NOT NULL
      AND (
        c.delivery_end_date::date < CURRENT_DATE
        OR (
          (s.ata_discharge_complete IS NOT NULL OR s.eta_discharge_complete IS NOT NULL)
          AND (
            (s.ata_discharge_complete IS NOT NULL AND c.delivery_end_date::date < s.ata_discharge_complete::date)
            OR (s.eta_discharge_complete IS NOT NULL AND c.delivery_end_date::date < s.eta_discharge_complete::date)
          )
        )
      )
    `;

    const baseWhere: string[] = [`1=1 ${contractFilter} ${shipmentFilter}`];
    const finalParams: any[] = [...params];

    if (status) {
      baseWhere.push(`s.status = $${paramIndex}`);
      finalParams.push(status);
      paramIndex++;
    }

    if (delayed === 'true') {
      baseWhere.push(lateCondition);
    }

    const whereSql = baseWhere.join(' AND ');

    const queryText = `
      WITH base AS (
        SELECT 
          s.id,
          s.shipment_id,
          s.operation_id,
          c.sto_number,
          s.vessel_name,
          s.status,
          s.port_of_loading,
          s.port_of_discharge,
          s.is_delayed,
          c.contract_id,
          c.supplier,
          c.product,
          c.delivery_end_date,
          CASE
            WHEN c.delivery_end_date IS NULL THEN '-'
            WHEN (${lateCondition}) THEN 'Late'
            ELSE 'On Time'
          END AS late_indicator
        FROM shipments s
        LEFT JOIN contracts c ON s.contract_id = c.id
        WHERE ${whereSql}
      ),
      total AS (
        SELECT COUNT(*)::int AS total_count FROM base
      ),
      paged AS (
        SELECT *
        FROM base
        ORDER BY delivery_end_date DESC NULLS LAST, id DESC
        LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
      )
      SELECT
        (SELECT total_count FROM total) AS total_count,
        p.*
      FROM paged p
    `;

    finalParams.push(limit, offset);

    const result = await query(queryText, finalParams);
    const totalCount = result.rows.length ? (result.rows[0] as any).total_count : 0;
    const rows = result.rows.map(r => {
      const copy: any = { ...r };
      delete copy.total_count;
      return copy;
    });

    // Plant summary for full filtered payment scope (not page-limited)
    const summaryParams: any[] = [...params];
    let summaryParamIndex = params.length + 1;
    let summaryStatusFilterSql = '';
    if (statusNorm === 'PENDING_PAYMENT') {
      summaryStatusFilterSql = ` AND (p.payoff_date IS NULL)`;
    } else if (statusNorm === 'LATE_PAYMENT') {
      summaryStatusFilterSql = ` AND (
        (p.payoff_date IS NULL AND p.payment_due_date IS NOT NULL AND p.payment_due_date::date < CURRENT_DATE)
        OR (p.payoff_date IS NOT NULL AND p.payment_due_date IS NOT NULL AND p.payoff_date::date > p.payment_due_date::date)
      )`;
    } else if (status) {
      summaryStatusFilterSql = ` AND p.payment_status = $${summaryParamIndex}`;
      summaryParams.push(status);
      summaryParamIndex++;
    }

    const summaryResult = await query(`
      WITH base AS (
        SELECT
          c.contract_id,
          COALESCE(c.contract_value, 0) AS contract_value,
          COALESCE(NULLIF(TRIM(ps.plant_site), ''), 'Blank') AS plant_site
        FROM payments p
        LEFT JOIN contracts c ON p.contract_id = c.id
        LEFT JOIN LATERAL (
          SELECT UPPER(TRIM(COALESCE(
            NULLIF(TRIM(c.transport_mode), ''),
            (SELECT spd.data->'contract'->>'transport_mode' FROM sap_processed_data spd
             WHERE spd.contract_number = c.contract_id ORDER BY spd.created_at DESC NULLS LAST LIMIT 1),
            (SELECT spd.data->'raw'->>'Sea / Land' FROM sap_processed_data spd
             WHERE spd.contract_number = c.contract_id ORDER BY spd.created_at DESC NULLS LAST LIMIT 1),
            ''
          ))) AS tm_upper
        ) tx ON true
        LEFT JOIN LATERAL (
          SELECT COALESCE(
            CASE
              WHEN tx.tm_upper LIKE 'LAND%' THEN (
                SELECT COALESCE(NULLIF(TRIM(t.unloading_location), ''), NULLIF(TRIM(t.location), ''))
                FROM trucking_operations t
                WHERE t.contract_id = c.id
                ORDER BY t.created_at DESC NULLS LAST
                LIMIT 1
              )
              WHEN tx.tm_upper LIKE 'SEA%' THEN (
                SELECT NULLIF(TRIM(s.port_of_discharge), '')
                FROM shipments s
                WHERE s.contract_id = c.id
                ORDER BY s.created_at DESC NULLS LAST
                LIMIT 1
              )
              ELSE NULL
            END,
            NULLIF(TRIM(c.unloading_site), ''),
            NULLIF(TRIM(c.loading_site), '')
          ) AS plant_site
        ) ps ON true
        WHERE 1=1 ${contractFilter}${summaryStatusFilterSql}
      ),
      dedup AS (
        SELECT contract_id, plant_site, MAX(contract_value) AS contract_value
        FROM base
        GROUP BY contract_id, plant_site
      )
      SELECT
        plant_site,
        COUNT(*)::int AS contracts,
        COALESCE(SUM(contract_value), 0)::numeric AS total_contract_value
      FROM dedup
      GROUP BY plant_site
      ORDER BY total_contract_value DESC
    `, summaryParams);

    return res.json({
      success: true,
      data: rows,
      meta: { totalCount, limit, offset, plantSummary: summaryResult.rows || [] },
    });
  } catch (error) {
    logger.error('Get shipments by status error:', error);
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch shipments' },
    });
  }
};

export const getTruckingOperationsByStatus = async (req: AuthRequest, res: Response) => {
  try {
    const { status } = req.query as { status?: string };
    const statusNorm = String(status || '').trim().toUpperCase();
    const limitRaw = req.query.limit ? parseInt(req.query.limit as string) : 100;
    const offsetRaw = req.query.offset ? parseInt(req.query.offset as string) : 0;
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(500, limitRaw)) : 100;
    const offset = Number.isFinite(offsetRaw) ? Math.max(0, offsetRaw) : 0;

    const { contractFilter, truckingFilter, params } = buildFilterConditions(req);
    const finalParams: any[] = [...params];
    let paramIndex = params.length + 1;

    // When filtering for LATE, use same logic as Trucking page (effective_completion = COALESCE(t.trucking_completion_date, SAP Trucking Last Receive Date))
    const useLateFilter = status === 'LATE';
    const statusFilterSql = status && !useLateFilter ? ` AND t.status = $${paramIndex}` : '';
    if (status && !useLateFilter) {
      finalParams.push(status);
      paramIndex++;
    }

    const baseWhere = `1=1 ${contractFilter} ${truckingFilter}${statusFilterSql}`;

    const queryText = `
      WITH trucking_with_completion AS (
        SELECT
          t.id,
          t.operation_id,
          t.location,
          t.trucking_owner,
          t.status,
          t.quantity_sent,
          t.quantity_delivered,
          t.gain_loss_percentage,
          t.created_at,
          c.contract_id,
          c.sto_number,
          c.supplier,
          c.product,
          c.delivery_end_date,
          t.eta_trucking_completion_date,
          COALESCE(NULLIF(TRIM(c.sto_number::text), ''), NULLIF(TRIM(t.operation_id), ''), t.id::text) AS late_key,
          COALESCE(
            t.trucking_completion_date,
            (
              SELECT (CASE
                WHEN trim(v.val) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN trim(v.val)::date
                WHEN trim(v.val) ~ '^[0-9]{1,2}/[0-9]{1,2}/[0-9]{2}$' THEN to_date(trim(v.val), 'MM/DD/YY')
                ELSE NULL
              END)
              FROM (
                SELECT COALESCE(spd.data->'raw'->>'Trucking Last Receive Date', spd.data->>'Trucking Last Receive Date') AS val
                FROM sap_processed_data spd
                WHERE spd.contract_number = c.contract_id
                ORDER BY spd.created_at DESC NULLS LAST
                LIMIT 1
              ) v
              WHERE v.val IS NOT NULL AND length(trim(v.val)) >= 6
            )
          ) AS effective_completion_date,
          (SELECT COALESCE(spd.data->'raw'->>'Contract Ext No', spd.data->>'Contract Ext No')
           FROM sap_processed_data spd
           WHERE spd.contract_number = c.contract_id
           ORDER BY spd.created_at DESC NULLS LAST
           LIMIT 1) AS contract_ext_no
        FROM trucking_operations t
        LEFT JOIN contracts c ON t.contract_id = c.id
        WHERE ${baseWhere}
      ),
      base AS (
        ${useLateFilter ? `
        SELECT DISTINCT ON (late_key)
          id,
          operation_id,
          location,
          trucking_owner,
          status,
          quantity_sent,
          quantity_delivered,
          gain_loss_percentage,
          created_at,
          contract_id,
          sto_number,
          supplier,
          product,
          contract_ext_no
        FROM trucking_with_completion
        WHERE
          delivery_end_date IS NOT NULL
          AND (eta_trucking_completion_date IS NOT NULL OR effective_completion_date IS NOT NULL)
          AND NOT (
            (eta_trucking_completion_date IS NOT NULL AND delivery_end_date::date >= eta_trucking_completion_date::date)
            OR (effective_completion_date IS NOT NULL AND delivery_end_date::date >= effective_completion_date::date)
          )
        ORDER BY late_key, created_at DESC NULLS LAST, id DESC
        ` : `
        SELECT
          id,
          operation_id,
          location,
          trucking_owner,
          status,
          quantity_sent,
          quantity_delivered,
          gain_loss_percentage,
          created_at,
          contract_id,
          sto_number,
          supplier,
          product,
          contract_ext_no
        FROM trucking_with_completion
        WHERE 1=1
        `}
      ),
      total AS (
        SELECT COUNT(*)::int AS total_count FROM base
      ),
      paged AS (
        SELECT *
        FROM base
        ORDER BY created_at DESC NULLS LAST, id DESC
        LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
      )
      SELECT
        (SELECT total_count FROM total) AS total_count,
        p.*
      FROM paged p
    `;

    finalParams.push(limit, offset);

    const result = await query(queryText, finalParams);
    const totalCount = result.rows.length ? (result.rows[0] as any).total_count : 0;
    const rows = result.rows.map(r => {
      const copy: any = { ...r };
      delete copy.total_count;
      return copy;
    });

    // Plant summary for full filtered payment scope (not page-limited)
    const summaryParams: any[] = [...params];
    let summaryParamIndex = params.length + 1;
    let summaryStatusFilterSql = '';
    if (statusNorm === 'PENDING_PAYMENT') {
      summaryStatusFilterSql = ` AND (p.payoff_date IS NULL)`;
    } else if (statusNorm === 'LATE_PAYMENT') {
      summaryStatusFilterSql = ` AND (
        (p.payoff_date IS NULL AND p.payment_due_date IS NOT NULL AND p.payment_due_date::date < CURRENT_DATE)
        OR (p.payoff_date IS NOT NULL AND p.payment_due_date IS NOT NULL AND p.payoff_date::date > p.payment_due_date::date)
      )`;
    } else if (status) {
      summaryStatusFilterSql = ` AND p.payment_status = $${summaryParamIndex}`;
      summaryParams.push(status);
      summaryParamIndex++;
    }

    const summaryResult = await query(`
      WITH base AS (
        SELECT
          c.contract_id,
          COALESCE(c.contract_value, 0) AS contract_value,
          COALESCE(NULLIF(TRIM(ps.plant_site), ''), 'Blank') AS plant_site
        FROM payments p
        LEFT JOIN contracts c ON p.contract_id = c.id
        LEFT JOIN LATERAL (
          SELECT UPPER(TRIM(COALESCE(
            NULLIF(TRIM(c.transport_mode), ''),
            (SELECT spd.data->'contract'->>'transport_mode' FROM sap_processed_data spd
             WHERE spd.contract_number = c.contract_id ORDER BY spd.created_at DESC NULLS LAST LIMIT 1),
            (SELECT spd.data->'raw'->>'Sea / Land' FROM sap_processed_data spd
             WHERE spd.contract_number = c.contract_id ORDER BY spd.created_at DESC NULLS LAST LIMIT 1),
            ''
          ))) AS tm_upper
        ) tx ON true
        LEFT JOIN LATERAL (
          SELECT COALESCE(
            CASE
              WHEN tx.tm_upper LIKE 'LAND%' THEN (
                SELECT COALESCE(NULLIF(TRIM(t.unloading_location), ''), NULLIF(TRIM(t.location), ''))
                FROM trucking_operations t
                WHERE t.contract_id = c.id
                ORDER BY t.created_at DESC NULLS LAST
                LIMIT 1
              )
              WHEN tx.tm_upper LIKE 'SEA%' THEN (
                SELECT NULLIF(TRIM(s.port_of_discharge), '')
                FROM shipments s
                WHERE s.contract_id = c.id
                ORDER BY s.created_at DESC NULLS LAST
                LIMIT 1
              )
              ELSE NULL
            END,
            NULLIF(TRIM(c.unloading_site), ''),
            NULLIF(TRIM(c.loading_site), '')
          ) AS plant_site
        ) ps ON true
        WHERE 1=1 ${contractFilter}${summaryStatusFilterSql}
      ),
      dedup AS (
        SELECT contract_id, plant_site, MAX(contract_value) AS contract_value
        FROM base
        GROUP BY contract_id, plant_site
      )
      SELECT
        plant_site,
        COUNT(*)::int AS contracts,
        COALESCE(SUM(contract_value), 0)::numeric AS total_contract_value
      FROM dedup
      GROUP BY plant_site
      ORDER BY total_contract_value DESC
    `, summaryParams);

    return res.json({
      success: true,
      data: rows,
      meta: { totalCount, limit, offset, plantSummary: summaryResult.rows || [] },
    });
  } catch (error) {
    logger.error('Get trucking operations by status error:', error);
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch trucking operations' },
    });
  }
};

export const getPaymentsByStatus = async (req: AuthRequest, res: Response) => {
  try {
    const { status, plantSite } = req.query as { status?: string; plantSite?: string };
    const limitRaw = req.query.limit ? parseInt(req.query.limit as string) : 100;
    const offsetRaw = req.query.offset ? parseInt(req.query.offset as string) : 0;
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(500, limitRaw)) : 100;
    const offset = Number.isFinite(offsetRaw) ? Math.max(0, offsetRaw) : 0;

    const { contractFilter, params } = buildFilterConditions(req);
    const finalParams: any[] = [...params];
    let paramIndex = params.length + 1;

    let statusFilterSql = '';
    const statusNorm = String(status || '').trim().toUpperCase();
    if (statusNorm === 'PENDING_PAYMENT') {
      statusFilterSql = ` AND (p.payoff_date IS NULL)`;
    } else if (statusNorm === 'PAID_PAYMENT') {
      statusFilterSql = ` AND (p.payoff_date IS NOT NULL)`;
    } else if (statusNorm === 'LATE_PAYMENT') {
      statusFilterSql = ` AND (
        (p.payoff_date IS NULL AND p.payment_due_date IS NOT NULL AND p.payment_due_date::date < CURRENT_DATE)
        OR (p.payoff_date IS NOT NULL AND p.payment_due_date IS NOT NULL AND p.payoff_date::date > p.payment_due_date::date)
      )`;
    } else if (status) {
      statusFilterSql = ` AND p.payment_status = $${paramIndex}`;
      finalParams.push(status);
      paramIndex++;
    }
    const plantSiteFilterSql = plantSite ? ` AND UPPER(COALESCE(plant_site, 'Blank')) = UPPER($${paramIndex})` : '';
    if (plantSite) {
      finalParams.push(String(plantSite));
      paramIndex++;
    }

    const queryText = `
      WITH base AS (
        SELECT
          p.id,
          c.contract_id,
          c.po_number,
          c.sto_number,
          COALESCE(
            (SELECT COALESCE(spd.data->'raw'->>'Contract Ext No', spd.data->>'Contract Ext No')
             FROM sap_processed_data spd
             WHERE spd.contract_number = c.contract_id
             ORDER BY spd.created_at DESC NULLS LAST
             LIMIT 1),
            NULL
          ) AS contract_ext_no,
          c.unit_price,
          c.contract_value,
          c.group_name,
          COALESCE(NULLIF(TRIM(ps.plant_site), ''), 'Blank') AS plant_site,
          p.invoice_number,
          p.invoice_date,
          p.payment_amount,
          p.currency,
          p.payment_status,
          p.payment_due_date,
          p.dp_date,
          p.payoff_date,
          p.payment_date,
          -- Deviations in days (positive = late)
          CASE
            WHEN p.payment_due_date IS NULL OR p.dp_date IS NULL THEN NULL
            ELSE (p.dp_date::date - p.payment_due_date::date)
          END AS dp_date_deviation_days,
          CASE
            WHEN p.payment_due_date IS NULL OR p.payoff_date IS NULL THEN NULL
            ELSE (p.payoff_date::date - p.payment_due_date::date)
          END AS payoff_date_deviation_days
        FROM payments p
        LEFT JOIN contracts c ON p.contract_id = c.id
        LEFT JOIN LATERAL (
          SELECT UPPER(TRIM(COALESCE(
            NULLIF(TRIM(c.transport_mode), ''),
            (SELECT spd.data->'contract'->>'transport_mode' FROM sap_processed_data spd
             WHERE spd.contract_number = c.contract_id ORDER BY spd.created_at DESC NULLS LAST LIMIT 1),
            (SELECT spd.data->'raw'->>'Sea / Land' FROM sap_processed_data spd
             WHERE spd.contract_number = c.contract_id ORDER BY spd.created_at DESC NULLS LAST LIMIT 1),
            ''
          ))) AS tm_upper
        ) tx ON true
        LEFT JOIN LATERAL (
          SELECT COALESCE(
            CASE
              WHEN tx.tm_upper LIKE 'LAND%' THEN (
                SELECT COALESCE(NULLIF(TRIM(t.unloading_location), ''), NULLIF(TRIM(t.location), ''))
                FROM trucking_operations t
                WHERE t.contract_id = c.id
                  AND COALESCE(NULLIF(TRIM(t.unloading_location), ''), NULLIF(TRIM(t.location), '')) IS NOT NULL
                  AND TRIM(COALESCE(t.unloading_location, t.location, '')) <> ''
                  AND UPPER(TRIM(COALESCE(t.unloading_location, t.location, ''))) <> 'N/A'
                ORDER BY t.created_at DESC NULLS LAST
                LIMIT 1
              )
              WHEN tx.tm_upper LIKE 'SEA%' THEN (
                SELECT NULLIF(TRIM(s.port_of_discharge), '')
                FROM shipments s
                WHERE s.contract_id = c.id
                  AND s.port_of_discharge IS NOT NULL
                  AND TRIM(s.port_of_discharge) <> ''
                  AND UPPER(TRIM(s.port_of_discharge)) <> 'N/A'
                ORDER BY s.created_at DESC NULLS LAST
                LIMIT 1
              )
              ELSE NULL
            END,
            (
              SELECT COALESCE(NULLIF(TRIM(t.unloading_location), ''), NULLIF(TRIM(t.location), ''))
              FROM trucking_operations t
              WHERE t.contract_id = c.id
                AND COALESCE(NULLIF(TRIM(t.unloading_location), ''), NULLIF(TRIM(t.location), '')) IS NOT NULL
                AND TRIM(COALESCE(t.unloading_location, t.location, '')) <> ''
                AND UPPER(TRIM(COALESCE(t.unloading_location, t.location, ''))) <> 'N/A'
              ORDER BY t.created_at DESC NULLS LAST
              LIMIT 1
            ),
            (
              SELECT NULLIF(TRIM(s.port_of_discharge), '')
              FROM shipments s
              WHERE s.contract_id = c.id
                AND s.port_of_discharge IS NOT NULL
                AND TRIM(s.port_of_discharge) <> ''
                AND UPPER(TRIM(s.port_of_discharge)) <> 'N/A'
              ORDER BY s.created_at DESC NULLS LAST
              LIMIT 1
            ),
            NULLIF(TRIM(c.unloading_site), ''),
            NULLIF(TRIM(c.loading_site), '')
          ) AS plant_site
        ) ps ON true
        WHERE 1=1 ${contractFilter}${statusFilterSql}
      ),
      filtered AS (
        SELECT * FROM base
        WHERE 1=1 ${plantSiteFilterSql}
      ),
      total AS (
        SELECT COUNT(*)::int AS total_count FROM filtered
      ),
      paged AS (
        SELECT *
        FROM filtered
        ORDER BY payment_due_date DESC NULLS LAST, invoice_date DESC NULLS LAST, id DESC
        LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
      )
      SELECT
        (SELECT total_count FROM total) AS total_count,
        p.*
      FROM paged p
    `;

    finalParams.push(limit, offset);
    const result = await query(queryText, finalParams);
    const totalCount = result.rows.length ? (result.rows[0] as any).total_count : 0;
    const rows = result.rows.map(r => {
      const copy: any = { ...r };
      delete copy.total_count;
      return copy;
    });

    // Full-scope plant summary for this payment filter (not page-limited)
    const summaryParams: any[] = [...params];
    let summaryParamIndex = params.length + 1;
    let summaryStatusFilterSql = '';
    if (statusNorm === 'PENDING_PAYMENT') {
      summaryStatusFilterSql = ` AND (p.payoff_date IS NULL)`;
    } else if (statusNorm === 'PAID_PAYMENT') {
      summaryStatusFilterSql = ` AND (p.payoff_date IS NOT NULL)`;
    } else if (statusNorm === 'LATE_PAYMENT') {
      summaryStatusFilterSql = ` AND (
        (p.payoff_date IS NULL AND p.payment_due_date IS NOT NULL AND p.payment_due_date::date < CURRENT_DATE)
        OR (p.payoff_date IS NOT NULL AND p.payment_due_date IS NOT NULL AND p.payoff_date::date > p.payment_due_date::date)
      )`;
    } else if (status) {
      summaryStatusFilterSql = ` AND p.payment_status = $${summaryParamIndex}`;
      summaryParams.push(status);
      summaryParamIndex++;
    }

    const summaryResult = await query(`
      WITH base AS (
        SELECT
          c.contract_id,
          COALESCE(c.contract_value, 0) AS contract_value,
          COALESCE(NULLIF(TRIM(ps.plant_site), ''), 'Blank') AS plant_site
        FROM payments p
        LEFT JOIN contracts c ON p.contract_id = c.id
        LEFT JOIN LATERAL (
          SELECT UPPER(TRIM(COALESCE(
            NULLIF(TRIM(c.transport_mode), ''),
            (SELECT spd.data->'contract'->>'transport_mode' FROM sap_processed_data spd
             WHERE spd.contract_number = c.contract_id ORDER BY spd.created_at DESC NULLS LAST LIMIT 1),
            (SELECT spd.data->'raw'->>'Sea / Land' FROM sap_processed_data spd
             WHERE spd.contract_number = c.contract_id ORDER BY spd.created_at DESC NULLS LAST LIMIT 1),
            ''
          ))) AS tm_upper
        ) tx ON true
        LEFT JOIN LATERAL (
          SELECT COALESCE(
            CASE
              WHEN tx.tm_upper LIKE 'LAND%' THEN (
                SELECT COALESCE(NULLIF(TRIM(t.unloading_location), ''), NULLIF(TRIM(t.location), ''))
                FROM trucking_operations t
                WHERE t.contract_id = c.id
                ORDER BY t.created_at DESC NULLS LAST
                LIMIT 1
              )
              WHEN tx.tm_upper LIKE 'SEA%' THEN (
                SELECT NULLIF(TRIM(s.port_of_discharge), '')
                FROM shipments s
                WHERE s.contract_id = c.id
                ORDER BY s.created_at DESC NULLS LAST
                LIMIT 1
              )
              ELSE NULL
            END,
            NULLIF(TRIM(c.unloading_site), ''),
            NULLIF(TRIM(c.loading_site), '')
          ) AS plant_site
        ) ps ON true
        WHERE 1=1 ${contractFilter}${summaryStatusFilterSql}
      ),
      dedup AS (
        SELECT contract_id, plant_site, MAX(contract_value) AS contract_value
        FROM base
        GROUP BY contract_id, plant_site
      )
      SELECT
        plant_site,
        COUNT(*)::int AS contracts,
        COALESCE(SUM(contract_value), 0)::numeric AS total_contract_value
      FROM dedup
      GROUP BY plant_site
      ORDER BY total_contract_value DESC
    `, summaryParams);

    return res.json({
      success: true,
      data: rows,
      meta: { totalCount, limit, offset, plantSummary: summaryResult.rows || [] },
    });
  } catch (error) {
    logger.error('Get payments by status error:', error);
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch payments' },
    });
  }
};

// Get contract quantity by product materials
export const getContractQuantityByProduct = async (req: AuthRequest, res: Response) => {
  try {
    const { contractFilter, params } = buildFilterConditions(req);
    
    const result = await query(`
      SELECT 
        product,
        contract_count,
        total_quantity,
        completed_quantity,
        total_quantity - completed_quantity as outstanding_quantity,
        avg_unit_price,
        total_contract_value,
        supplier_count
      FROM (
        SELECT 
          c.product,
          COUNT(DISTINCT c.contract_id) as contract_count,
          SUM(c.quantity_ordered) as total_quantity,
          COALESCE((
            SELECT SUM(CAST(REPLACE(REPLACE(s.data->'contract'->>'sto_quantity', ',', ''), ' ', '') AS NUMERIC))
            FROM sap_processed_data s
            WHERE s.product = c.product
            AND s.sto_number IS NOT NULL 
            AND s.data->'contract'->>'sto_quantity' IS NOT NULL
          ), 0) as completed_quantity,
          AVG(c.unit_price) as avg_unit_price,
          SUM(c.contract_value) as total_contract_value,
          COUNT(DISTINCT c.supplier) as supplier_count
        FROM contracts c
        WHERE c.product IS NOT NULL AND c.product != '' ${contractFilter}
        GROUP BY c.product
      ) product_data
      ORDER BY total_quantity DESC
    `, params);

    return res.json({
      success: true,
      data: result.rows,
    });
  } catch (error) {
    logger.error('Get contract quantity by product error:', error);
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch contract quantity by product' },
    });
  }
};

// Combined: breakdown each Product by Incoterm
export const getContractQuantityByProductIncoterm = async (req: AuthRequest, res: Response) => {
  try {
    const { contractFilter, params } = buildFilterConditions(req);

    const result = await query(
      `
      WITH base_contracts AS (
        SELECT
          c.id AS contract_pk,
          c.contract_id,
          c.product,
          COALESCE(NULLIF(TRIM(c.incoterm), ''), 'Blank') AS incoterm,
          c.supplier,
          c.quantity_ordered,
          c.unit_price,
          c.contract_value
        FROM contracts c
        WHERE c.product IS NOT NULL AND TRIM(c.product) != '' ${contractFilter}
      ),
      delivered_by_contract AS (
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
      ),
      agg AS (
        SELECT
          bc.product,
          bc.incoterm,
          COUNT(DISTINCT bc.contract_id) AS contract_count,
          COUNT(DISTINCT bc.supplier) AS supplier_count,
          SUM(bc.quantity_ordered) AS total_quantity,
          SUM(COALESCE(db.delivered_quantity, 0)) AS completed_quantity,
          SUM(bc.quantity_ordered) - SUM(COALESCE(db.delivered_quantity, 0)) AS outstanding_quantity,
          SUM(
            CASE
              WHEN COALESCE(ps.has_blank_payoff, 0) = 1
              THEN (bc.quantity_ordered - COALESCE(db.delivered_quantity, 0))
              ELSE 0
            END
          ) AS outstanding_payment_quantity,
          AVG(bc.unit_price) AS avg_unit_price,
          SUM(bc.contract_value) AS total_contract_value
        FROM base_contracts bc
        LEFT JOIN delivered_by_contract db ON db.contract_id = bc.contract_id
        LEFT JOIN payment_status_per_contract ps ON ps.contract_id = bc.contract_pk
        GROUP BY bc.product, bc.incoterm
      )
      SELECT
        a.product,
        a.incoterm,
        a.contract_count,
        a.supplier_count,
        a.total_quantity,
        a.completed_quantity,
        a.outstanding_quantity,
        a.outstanding_payment_quantity,
        a.avg_unit_price,
        a.total_contract_value
      FROM agg a
      ORDER BY a.product, a.total_quantity DESC NULLS LAST, a.incoterm
      `,
      params
    );

    return res.json({
      success: true,
      data: result.rows,
    });
  } catch (error) {
    logger.error('Get contract quantity by product incoterm error:', error);
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch contract quantity by product incoterm' },
    });
  }
};

// Get contract quantity by Incoterm (same logic pattern as product, but grouped by incoterm)
export const getContractQuantityByIncoterm = async (req: AuthRequest, res: Response) => {
  try {
    const { contractFilter, params } = buildFilterConditions(req);

    const result = await query(`
      SELECT
        incoterm,
        contract_count,
        total_quantity,
        completed_quantity,
        total_quantity - completed_quantity AS outstanding_quantity,
        avg_unit_price,
        total_contract_value,
        supplier_count
      FROM (
        SELECT
          COALESCE(c.incoterm, 'Blank') AS incoterm,
          COUNT(DISTINCT c.contract_id) AS contract_count,
          SUM(c.quantity_ordered) AS total_quantity,
          -- Sum of STO quantities from SAP data for all contracts under this incoterm
          SUM(
            COALESCE((
              SELECT SUM(CAST(REPLACE(REPLACE(spd.data->'contract'->>'sto_quantity', ',', ''), ' ', '') AS NUMERIC))
              FROM sap_processed_data spd
              WHERE spd.contract_number = c.contract_id
                AND spd.sto_number IS NOT NULL
                AND spd.data->'contract'->>'sto_quantity' IS NOT NULL
            ), 0)
          ) AS completed_quantity,
          AVG(c.unit_price) AS avg_unit_price,
          SUM(c.contract_value) AS total_contract_value,
          COUNT(DISTINCT c.supplier) AS supplier_count
        FROM contracts c
        WHERE 1=1 ${contractFilter}
        GROUP BY COALESCE(c.incoterm, 'Blank')
      ) incoterm_data
      ORDER BY total_quantity DESC
      LIMIT 10
    `, params);

    return res.json({
      success: true,
      data: result.rows,
    });
  } catch (error) {
    logger.error('Get contract quantity by incoterm error:', error);
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch contract quantity by incoterm' },
    });
  }
};

// Get contract quantity by plant (Sea/Land logic)
// Updated to use actual shipped/delivered quantities from Shipments and Trucking
export const getContractQuantityByPlant = async (req: AuthRequest, res: Response) => {
  try {
    const { contractFilter, params } = buildFilterConditions(req);
    const result = await query(`
      WITH filtered_contracts AS (
        SELECT
          c.id AS contract_pk,
          c.contract_id,
          c.supplier,
          COALESCE(c.quantity_ordered, 0) AS quantity_ordered,
          COALESCE(c.contract_value, 0) AS contract_value,
          COALESCE(NULLIF(TRIM(ps.plant_site), ''), 'Blank') AS plant_location
        FROM contracts c
        LEFT JOIN LATERAL (
          SELECT UPPER(TRIM(COALESCE(
            NULLIF(TRIM(c.transport_mode), ''),
            (SELECT spd.data->'contract'->>'transport_mode' FROM sap_processed_data spd
             WHERE spd.contract_number = c.contract_id ORDER BY spd.created_at DESC NULLS LAST LIMIT 1),
            (SELECT spd.data->'raw'->>'Sea / Land' FROM sap_processed_data spd
             WHERE spd.contract_number = c.contract_id ORDER BY spd.created_at DESC NULLS LAST LIMIT 1),
            ''
          ))) AS tm_upper
        ) tx ON true
        LEFT JOIN LATERAL (
          SELECT COALESCE(
            CASE
              WHEN tx.tm_upper LIKE 'LAND%' THEN (
                SELECT COALESCE(NULLIF(TRIM(t.unloading_location), ''), NULLIF(TRIM(t.location), ''))
                FROM trucking_operations t
                WHERE t.contract_id = c.id
                ORDER BY t.created_at DESC NULLS LAST
                LIMIT 1
              )
              WHEN tx.tm_upper LIKE 'SEA%' THEN (
                SELECT NULLIF(TRIM(s.port_of_discharge), '')
                FROM shipments s
                WHERE s.contract_id = c.id
                ORDER BY s.created_at DESC NULLS LAST
                LIMIT 1
              )
              ELSE NULL
            END,
            NULLIF(TRIM(c.unloading_site), ''),
            NULLIF(TRIM(c.loading_site), '')
          ) AS plant_site
        ) ps ON true
        WHERE 1=1 ${contractFilter}
      ),
      delivered_by_contract AS (
        SELECT
          spd.contract_number AS contract_id,
          SUM(
            CAST(REPLACE(REPLACE(COALESCE(spd.data->'contract'->>'sto_quantity', ''), ',', ''), ' ', '') AS NUMERIC)
          ) AS completed_quantity
        FROM sap_processed_data spd
        WHERE spd.sto_number IS NOT NULL
          AND spd.data->'contract'->>'sto_quantity' IS NOT NULL
          AND TRIM(spd.data->'contract'->>'sto_quantity') != ''
        GROUP BY spd.contract_number
      ),
      per_contract AS (
        SELECT
          fc.contract_id,
          fc.supplier,
          fc.plant_location,
          fc.quantity_ordered,
          LEAST(fc.quantity_ordered, COALESCE(db.completed_quantity, 0)) AS completed_quantity,
          fc.contract_value
        FROM filtered_contracts fc
        LEFT JOIN delivered_by_contract db ON db.contract_id = fc.contract_id
      )
      SELECT
        plant_location,
        COUNT(DISTINCT contract_id)::int AS contract_count,
        COALESCE(SUM(quantity_ordered), 0)::numeric AS total_quantity,
        COALESCE(SUM(completed_quantity), 0)::numeric AS total_quantity_delivered,
        COALESCE(SUM(GREATEST(quantity_ordered - completed_quantity, 0)), 0)::numeric AS total_quantity_shipped,
        COALESCE(SUM(contract_value), 0)::numeric AS total_contract_value,
        COUNT(DISTINCT supplier)::int AS supplier_count
      FROM per_contract
      GROUP BY plant_location
      ORDER BY total_quantity DESC
    `, params);

    let combined = result.rows.map((p: any) => ({
      plant_location: p.plant_location,
      contract_count: parseInt(p.contract_count, 10) || 0,
      total_quantity: parseFloat(p.total_quantity) || 0,
      total_quantity_shipped: parseFloat(p.total_quantity_shipped) || 0,
      total_quantity_delivered: parseFloat(p.total_quantity_delivered) || 0,
      avg_unit_price: (parseFloat(p.total_quantity) || 0) > 0 ? (parseFloat(p.total_contract_value) || 0) / (parseFloat(p.total_quantity) || 1) : 0,
      total_contract_value: parseFloat(p.total_contract_value) || 0,
      supplier_count: parseInt(p.supplier_count, 10) || 0,
    }));

    // Merge similar plant/site labels (>= 60% similarity)
    const merged: typeof combined = [];
    const blank = combined.filter((r) => !r.plant_location || r.plant_location === 'Blank')
      .reduce((acc, r) => ({
        plant_location: 'Blank',
        contract_count: acc.contract_count + r.contract_count,
        total_quantity: acc.total_quantity + r.total_quantity,
        total_quantity_shipped: acc.total_quantity_shipped + r.total_quantity_shipped,
        total_quantity_delivered: acc.total_quantity_delivered + r.total_quantity_delivered,
        avg_unit_price: 0,
        total_contract_value: acc.total_contract_value + r.total_contract_value,
        supplier_count: acc.supplier_count + r.supplier_count,
      }), { plant_location: 'Blank', contract_count: 0, total_quantity: 0, total_quantity_shipped: 0, total_quantity_delivered: 0, avg_unit_price: 0, total_contract_value: 0, supplier_count: 0 });
    const nonBlank = combined.filter((r) => r.plant_location && r.plant_location !== 'Blank').sort((a, b) => b.total_contract_value - a.total_contract_value);
    nonBlank.forEach((row) => {
      const idx = merged.findIndex((m) => plantSimilarity(m.plant_location, row.plant_location) >= 0.6);
      if (idx >= 0) {
        merged[idx] = {
          ...merged[idx],
          plant_location: row.plant_location.length > merged[idx].plant_location.length ? row.plant_location : merged[idx].plant_location,
          contract_count: merged[idx].contract_count + row.contract_count,
          total_quantity: merged[idx].total_quantity + row.total_quantity,
          total_quantity_shipped: merged[idx].total_quantity_shipped + row.total_quantity_shipped,
          total_quantity_delivered: merged[idx].total_quantity_delivered + row.total_quantity_delivered,
          total_contract_value: merged[idx].total_contract_value + row.total_contract_value,
          supplier_count: merged[idx].supplier_count + row.supplier_count,
        };
      } else {
        merged.push(row);
      }
    });
    if (blank.contract_count > 0 || blank.total_contract_value > 0 || blank.total_quantity > 0) merged.push(blank);
    combined = merged.map((p) => ({
      ...p,
      avg_unit_price: p.total_quantity > 0 ? p.total_contract_value / p.total_quantity : 0,
    }));

    // Sort by total_quantity descending and limit to top 10
    combined.sort((a, b) => b.total_quantity - a.total_quantity);
    const topPlants = combined.slice(0, 10);

    return res.json({
      success: true,
      data: topPlants,
    });
  } catch (error) {
    logger.error('Get contract quantity by plant error:', error);
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch contract quantity by plant' },
    });
  }
};

// Combined: breakdown each Plant/Site by Incoterm
export const getContractQuantityByPlantIncoterm = async (req: AuthRequest, res: Response) => {
  try {
    const { contractFilter, params } = buildFilterConditions(req);

    const result = await query(
      `
      WITH base_contracts AS (
        SELECT
          c.id AS contract_pk,
          c.contract_id,
          c.supplier,
          COALESCE(c.quantity_ordered, 0) AS quantity_ordered,
          COALESCE(NULLIF(TRIM(c.incoterm), ''), 'Blank') AS incoterm,
          COALESCE(NULLIF(TRIM(ps.plant_site), ''), 'Blank') AS plant_location
        FROM contracts c
        LEFT JOIN LATERAL (
          SELECT UPPER(TRIM(COALESCE(
            NULLIF(TRIM(c.transport_mode), ''),
            (SELECT spd.data->'contract'->>'transport_mode' FROM sap_processed_data spd
             WHERE spd.contract_number = c.contract_id ORDER BY spd.created_at DESC NULLS LAST LIMIT 1),
            (SELECT spd.data->'raw'->>'Sea / Land' FROM sap_processed_data spd
             WHERE spd.contract_number = c.contract_id ORDER BY spd.created_at DESC NULLS LAST LIMIT 1),
            ''
          ))) AS tm_upper
        ) tx ON true
        LEFT JOIN LATERAL (
          SELECT COALESCE(
            CASE
              WHEN tx.tm_upper LIKE 'LAND%' THEN (
                SELECT COALESCE(NULLIF(TRIM(t.unloading_location), ''), NULLIF(TRIM(t.location), ''))
                FROM trucking_operations t
                WHERE t.contract_id = c.id
                ORDER BY t.created_at DESC NULLS LAST
                LIMIT 1
              )
              WHEN tx.tm_upper LIKE 'SEA%' THEN (
                SELECT NULLIF(TRIM(s.port_of_discharge), '')
                FROM shipments s
                WHERE s.contract_id = c.id
                ORDER BY s.created_at DESC NULLS LAST
                LIMIT 1
              )
              ELSE NULL
            END,
            NULLIF(TRIM(c.unloading_site), ''),
            NULLIF(TRIM(c.loading_site), '')
          ) AS plant_site
        ) ps ON true
        WHERE 1=1 ${contractFilter}
      ),
      delivered_by_contract AS (
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
      ),
      agg AS (
        SELECT
          bc.plant_location,
          bc.incoterm,
          COUNT(DISTINCT bc.contract_id) AS contract_count,
          COUNT(DISTINCT bc.supplier) AS supplier_count,
          SUM(bc.quantity_ordered) AS total_quantity,
          SUM(COALESCE(db.delivered_quantity, 0)) AS completed_quantity,
          SUM(bc.quantity_ordered) - SUM(COALESCE(db.delivered_quantity, 0)) AS outstanding_quantity,
          SUM(
            CASE
              WHEN COALESCE(ps.has_blank_payoff, 0) = 1
              THEN (bc.quantity_ordered - COALESCE(db.delivered_quantity, 0))
              ELSE 0
            END
          ) AS outstanding_payment_quantity
        FROM base_contracts bc
        LEFT JOIN delivered_by_contract db ON db.contract_id = bc.contract_id
        LEFT JOIN payment_status_per_contract ps ON ps.contract_id = bc.contract_pk
        GROUP BY bc.plant_location, bc.incoterm
      )
      SELECT
        a.plant_location,
        a.incoterm,
        a.contract_count,
        a.supplier_count,
        a.total_quantity,
        a.completed_quantity,
        a.outstanding_quantity,
        a.outstanding_payment_quantity
      FROM agg a
      ORDER BY a.plant_location, a.total_quantity DESC NULLS LAST, a.incoterm
      `,
      params
    );

    return res.json({
      success: true,
      data: result.rows,
    });
  } catch (error) {
    logger.error('Get contract quantity by plant incoterm error:', error);
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch contract quantity by plant incoterm' },
    });
  }
};

// Get detailed contract information for a specific plant
export const getPlantDetails = async (req: AuthRequest, res: Response) => {
  try {
    const { plant } = req.query;

    if (!plant) {
      return res.status(400).json({
        success: false,
        error: { message: 'Plant location is required' },
      });
    }

    let shipmentsResult;
    let truckingResult;

    if (plant === 'Blank') {
      // For blank plant locations, get records where port_of_discharge/location is NULL or empty
      shipmentsResult = await query(`
        SELECT 
          c.contract_id,
          c.sto_number,
          c.supplier,
          c.product,
          COALESCE(s.quantity_shipped, 0) as quantity_shipped,
          COALESCE(s.quantity_delivered, 0) as quantity_delivered,
          COALESCE(s.quantity_shipped, 0) + COALESCE(s.quantity_delivered, 0) as total_quantity,
          COALESCE(s.status, 'UNKNOWN') as status
        FROM shipments s
        LEFT JOIN contracts c ON s.contract_id = c.id
        WHERE s.port_of_discharge IS NULL OR s.port_of_discharge = ''
        ORDER BY c.contract_id
      `);

      truckingResult = await query(`
        SELECT 
          c.contract_id,
          c.sto_number,
          c.supplier,
          c.product,
          COALESCE(t.quantity_sent, 0) as quantity_shipped,
          COALESCE(t.quantity_delivered, 0) as quantity_delivered,
          COALESCE(t.quantity_sent, 0) + COALESCE(t.quantity_delivered, 0) as total_quantity,
          COALESCE(t.status, 'UNKNOWN') as status
        FROM trucking_operations t
        LEFT JOIN contracts c ON t.contract_id = c.id
        WHERE t.location IS NULL OR t.location = ''
        ORDER BY c.contract_id
      `);
    } else {
      shipmentsResult = await query(`
        SELECT 
          c.contract_id,
          c.sto_number,
          c.supplier,
          c.product,
          COALESCE(s.quantity_shipped, 0) as quantity_shipped,
          COALESCE(s.quantity_delivered, 0) as quantity_delivered,
          COALESCE(s.quantity_shipped, 0) + COALESCE(s.quantity_delivered, 0) as total_quantity,
          COALESCE(s.status, 'UNKNOWN') as status
        FROM shipments s
        LEFT JOIN contracts c ON s.contract_id = c.id
        WHERE s.port_of_discharge = $1
        ORDER BY c.contract_id
      `, [plant]);

      truckingResult = await query(`
        SELECT 
          c.contract_id,
          c.sto_number,
          c.supplier,
          c.product,
          COALESCE(t.quantity_sent, 0) as quantity_shipped,
          COALESCE(t.quantity_delivered, 0) as quantity_delivered,
          COALESCE(t.quantity_sent, 0) + COALESCE(t.quantity_delivered, 0) as total_quantity,
          COALESCE(t.status, 'UNKNOWN') as status
        FROM trucking_operations t
        LEFT JOIN contracts c ON t.contract_id = c.id
        WHERE t.location = $1
        ORDER BY c.contract_id
      `, [plant]);
    }

    const resultRows = [...shipmentsResult.rows, ...truckingResult.rows];

    return res.json({
      success: true,
      data: resultRows,
    });
  } catch (error) {
    logger.error('Get plant details error:', error);
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch plant details' },
    });
  }
};

// Get detailed contract information for a specific product
export const getProductDetails = async (req: AuthRequest, res: Response) => {
  try {
    const { product } = req.query;

    if (!product) {
      return res.status(400).json({
        success: false,
        error: { message: 'Product name is required' },
      });
    }

    // Get contract details for the product including completed and outstanding quantities
    const result = await query(`
      SELECT 
        c.contract_id,
        c.sto_number,
        c.supplier,
        c.product,
        c.quantity_ordered as total_quantity,
        COALESCE((
          SELECT SUM(CAST(REPLACE(REPLACE(s.data->'contract'->>'sto_quantity', ',', ''), ' ', '') AS NUMERIC))
          FROM sap_processed_data s
          WHERE s.contract_number = c.contract_id
          AND s.sto_number IS NOT NULL 
          AND s.data->'contract'->>'sto_quantity' IS NOT NULL
        ), 0) as quantity_delivered,
        c.quantity_ordered - COALESCE((
          SELECT SUM(CAST(REPLACE(REPLACE(s.data->'contract'->>'sto_quantity', ',', ''), ' ', '') AS NUMERIC))
          FROM sap_processed_data s
          WHERE s.contract_number = c.contract_id
          AND s.sto_number IS NOT NULL 
          AND s.data->'contract'->>'sto_quantity' IS NOT NULL
        ), 0) as quantity_shipped,
        c.status
      FROM contracts c
      WHERE c.product = $1
      ORDER BY c.contract_id
    `, [product]);

    return res.json({
      success: true,
      data: result.rows,
    });
  } catch (error) {
    logger.error('Get product details error:', error);
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch product details' },
    });
  }
};

// Get detailed contract information for a specific incoterm
export const getIncotermDetails = async (req: AuthRequest, res: Response) => {
  try {
    const { incoterm } = req.query;

    if (!incoterm) {
      return res.status(400).json({
        success: false,
        error: { message: 'Incoterm is required' },
      });
    }

    const result = await query(
      `
      SELECT
        c.contract_id,
        c.sto_number,
        c.supplier,
        c.product,
        c.quantity_ordered AS total_quantity,
        COALESCE((
          SELECT SUM(CAST(REPLACE(REPLACE(s.data->'contract'->>'sto_quantity', ',', ''), ' ', '') AS NUMERIC))
          FROM sap_processed_data s
          WHERE s.contract_number = c.contract_id
            AND s.sto_number IS NOT NULL
            AND s.data->'contract'->>'sto_quantity' IS NOT NULL
        ), 0) AS quantity_delivered,
        c.quantity_ordered - COALESCE((
          SELECT SUM(CAST(REPLACE(REPLACE(s.data->'contract'->>'sto_quantity', ',', ''), ' ', '') AS NUMERIC))
          FROM sap_processed_data s
          WHERE s.contract_number = c.contract_id
            AND s.sto_number IS NOT NULL
            AND s.data->'contract'->>'sto_quantity' IS NOT NULL
        ), 0) AS quantity_shipped,
        c.status
      FROM contracts c
      WHERE COALESCE(c.incoterm, 'Blank') = $1
      ORDER BY c.contract_id
      `,
      [incoterm],
    );

    return res.json({
      success: true,
      data: result.rows,
    });
  } catch (error) {
    logger.error('Get incoterm details error:', error);
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch incoterm details' },
    });
  }
};

// Get filter options for plants
export const getFilterPlants = async (_req: AuthRequest, res: Response) => {
  try {
    // Get unique plants from both shipments and trucking operations
    const result = await query(`
      SELECT DISTINCT plant_location 
      FROM (
        SELECT 
          CASE 
            WHEN s.port_of_discharge IS NULL OR s.port_of_discharge = '' THEN 'Blank'
            ELSE s.port_of_discharge
          END as plant_location
        FROM shipments s
        UNION
        SELECT 
          CASE 
            WHEN t.location IS NULL OR t.location = '' THEN 'Blank'
            ELSE t.location
          END as plant_location
        FROM trucking_operations t
      ) plants
      WHERE plant_location IS NOT NULL
      ORDER BY plant_location
    `);

    return res.json({
      success: true,
      data: result.rows.map(row => row.plant_location),
    });
  } catch (error) {
    logger.error('Get filter plants error:', error);
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch plant filter options' },
    });
  }
};

// Get filter options for suppliers
export const getFilterSuppliers = async (_req: AuthRequest, res: Response) => {
  try {
    const result = await query(`
      SELECT DISTINCT supplier
      FROM contracts
      WHERE supplier IS NOT NULL AND supplier != ''
      ORDER BY supplier
    `);

    return res.json({
      success: true,
      data: result.rows.map(row => row.supplier),
    });
  } catch (error) {
    logger.error('Get filter suppliers error:', error);
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch supplier filter options' },
    });
  }
};

// Get filter options for products
export const getFilterProducts = async (_req: AuthRequest, res: Response) => {
  try {
    const result = await query(`
      SELECT DISTINCT product
      FROM contracts
      WHERE product IS NOT NULL AND product != ''
      ORDER BY product
    `);

    return res.json({
      success: true,
      data: result.rows.map(row => row.product),
    });
  } catch (error) {
    logger.error('Get filter products error:', error);
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch product filter options' },
    });
  }
};

// Get filter options for group names
export const getFilterGroups = async (_req: AuthRequest, res: Response) => {
  try {
    const result = await query(`
      SELECT DISTINCT group_name
      FROM contracts
      WHERE group_name IS NOT NULL AND group_name != ''
      ORDER BY group_name
    `);

    return res.json({
      success: true,
      data: result.rows.map(row => row.group_name),
    });
  } catch (error) {
    logger.error('Get filter groups error:', error);
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch group filter options' },
    });
  }
};

// Return contracts list respecting dashboard filters
export const getFilteredContracts = async (req: AuthRequest, res: Response) => {
  try {
    const { contractFilter, params } = buildFilterConditions(req);
    const {
      contractStatus,
      shipmentStatus,
      hasShipment,
      truckingStatus,
      hasTrucking,
      paymentStatus,
      hasPayment,
      delayed,
      delivered,
      outstanding,
      outstandingLogistics,
      outstandingPayment,
      limit,
      offset,
    } = req.query as any;

    const extraParams = [...params];
    let whereExtra = '';

    // Contract status filter (aligned with dashboard stats logic)
    if (contractStatus) {
      const v = String(contractStatus).trim().toUpperCase();
      if (v === 'OPEN' || v === 'ACTIVE') {
        whereExtra += ` AND (
          (l.data IS NOT NULL AND (l.data->'contract'->>'status' = 'Open' OR UPPER(l.data->'contract'->>'status') = 'ACTIVE'))
          OR (l.data IS NULL AND UPPER(COALESCE(c.status, '')) IN ('OPEN','ACTIVE'))
        )`;
      } else if (v === 'CLOSE' || v === 'CLOSED' || v === 'COMPLETED') {
        whereExtra += ` AND (
          (l.data IS NOT NULL AND (l.data->'contract'->>'status' = 'Close' OR UPPER(l.data->'contract'->>'status') IN ('CLOSE','CLOSED','COMPLETED')))
          OR (l.data IS NULL AND UPPER(COALESCE(c.status, '')) IN ('CLOSE','CLOSED','COMPLETED'))
        )`;
      } else if (v === 'CANCELLED' || v === 'CANCELED') {
        whereExtra += ` AND (
          (l.data IS NOT NULL AND UPPER(l.data->'contract'->>'status') IN ('CANCELLED','CANCELED','CANCEL'))
          OR (l.data IS NULL AND UPPER(COALESCE(c.status, '')) IN ('CANCELLED','CANCELED'))
        )`;
      }
    }

    // Shipment status / delayed filter (contract must have at least one matching shipment)
    if (hasShipment && String(hasShipment).toLowerCase() === 'true') {
      whereExtra += ` AND EXISTS (
        SELECT 1 FROM shipments s
        WHERE s.contract_id = c.id
      )`;
    }
    if (shipmentStatus) {
      extraParams.push(String(shipmentStatus).trim().toUpperCase());
      whereExtra += ` AND EXISTS (
        SELECT 1 FROM shipments s
        WHERE s.contract_id = c.id AND s.status = $${extraParams.length}
      )`;
    }
    if (delayed && String(delayed).toLowerCase() === 'true') {
      whereExtra += ` AND EXISTS (
        SELECT 1 FROM shipments s
        WHERE s.contract_id = c.id AND s.is_delayed = true
      )`;
    }

    // Trucking status filter (contract must have at least one matching trucking operation)
    if (hasTrucking && String(hasTrucking).toLowerCase() === 'true') {
      whereExtra += ` AND EXISTS (
        SELECT 1 FROM trucking_operations t
        WHERE t.contract_id = c.id
      )`;
    }
    if (truckingStatus) {
      extraParams.push(String(truckingStatus).trim().toUpperCase());
      whereExtra += ` AND EXISTS (
        SELECT 1 FROM trucking_operations t
        WHERE t.contract_id = c.id AND t.status = $${extraParams.length}
      )`;
    }

    // Payment status filter (contract must have at least one matching payment)
    if (hasPayment && String(hasPayment).toLowerCase() === 'true') {
      whereExtra += ` AND EXISTS (
        SELECT 1 FROM payments p
        WHERE p.contract_id = c.id
      )`;
    }
    if (paymentStatus) {
      extraParams.push(String(paymentStatus).trim().toUpperCase());
      whereExtra += ` AND EXISTS (
        SELECT 1 FROM payments p
        WHERE p.contract_id = c.id AND UPPER(COALESCE(p.payment_status, '')) = $${extraParams.length}
      )`;
    }

    // Delivered / outstanding quantity filters (based on sap_processed_data STO quantity aggregation)
    // delivered=true  -> delivered_quantity > 0
    // outstanding=true -> (quantity_ordered - delivered_quantity) > 0
    if (delivered && String(delivered).toLowerCase() === 'true') {
      whereExtra += ` AND COALESCE(q.delivered_quantity, 0) > 0`;
    }
    if (outstanding && String(outstanding).toLowerCase() === 'true') {
      whereExtra += ` AND (COALESCE(c.quantity_ordered, 0) - COALESCE(q.delivered_quantity, 0)) > 0`;
    }

    // Open contract sub-breakdown filters used by Dashboard card
    if (outstandingLogistics && String(outstandingLogistics).toLowerCase() === 'true') {
      whereExtra += ` AND (
        EXISTS (
          SELECT 1 FROM shipments s
          WHERE s.contract_id = c.id
            AND UPPER(COALESCE(s.status, '')) NOT IN ('COMPLETED', 'CANCELLED', 'CANCELED')
        )
        OR EXISTS (
          SELECT 1 FROM trucking_operations t
          WHERE t.contract_id = c.id
            AND UPPER(COALESCE(t.status, '')) NOT IN ('COMPLETED', 'CANCELLED', 'CANCELED')
        )
      )`;
    }
    if (outstandingPayment && String(outstandingPayment).toLowerCase() === 'true') {
      whereExtra += ` AND EXISTS (
        SELECT 1 FROM payments p
        WHERE p.contract_id = c.id
          AND (p.payoff_date IS NULL OR TRIM(p.payoff_date::text) = '')
      )`;
    }

    // Allow paging for dashboard drilldowns (default limit 100, max 500)
    const limitNumRaw = parseInt(String(limit ?? ''), 10);
    const limitNum = Number.isFinite(limitNumRaw)
      ? Math.min(Math.max(limitNumRaw, 1), 500)
      : 100;

    const offsetNumRaw = parseInt(String(offset ?? ''), 10);
    const offsetNum = Number.isFinite(offsetNumRaw)
      ? Math.max(offsetNumRaw, 0)
      : 0;

    extraParams.push(limitNum);
    extraParams.push(offsetNum);

    const result = await query(`
      WITH latest_spd AS (
        SELECT DISTINCT ON (spd.contract_number)
          spd.contract_number,
          spd.data
        FROM sap_processed_data spd
        ORDER BY spd.contract_number, spd.created_at DESC NULLS LAST
      ),
      qty AS (
        SELECT
          spd.contract_number,
          COALESCE(SUM(CAST(REPLACE(REPLACE(spd.data->'contract'->>'sto_quantity', ',', ''), ' ', '') AS NUMERIC)), 0) AS delivered_quantity
        FROM sap_processed_data spd
        WHERE spd.data->'contract'->>'sto_quantity' IS NOT NULL
        GROUP BY spd.contract_number
      ),
      base AS (
        SELECT
          c.id,
          c.contract_id,
          c.buyer,
          c.supplier,
          c.group_name,
          c.product,
          c.quantity_ordered,
          c.unit,
          c.incoterm,
          c.loading_site,
          c.unloading_site,
          c.contract_date,
          c.delivery_start_date,
          c.delivery_end_date,
          c.cargo_readiness_date,
          COALESCE(
            NULLIF(TRIM(COALESCE(c.transport_mode, '')), ''),
            l.data->'contract'->>'transport_mode',
            l.data->'contract'->>'sea_land',
            l.data->'raw'->>'Sea / Land',
            l.data->'raw'->>'Sea_Land',
            ''
          ) AS transport_mode,
          l.data AS latest_spd_data,
          COALESCE(l.data->'raw'->>'Contract Ext No', l.data->>'Contract Ext No') AS contract_ext_no,
          c.contract_value,
          pinfo.payment_due_date,
          pinfo.payoff_date,
          pinfo.last_trucking_completion_date,
          pinfo.last_ata_vessel_complete_discharge,
          c.currency,
          -- Status displayed should match dashboard logic and Contracts page conventions
          CASE
            WHEN l.data IS NOT NULL AND (
              l.data->'contract'->>'status' = 'Open'
              OR UPPER(l.data->'contract'->>'status') = 'ACTIVE'
            ) THEN 'Open'
            WHEN l.data IS NOT NULL AND (
              l.data->'contract'->>'status' = 'Close'
              OR UPPER(l.data->'contract'->>'status') IN ('CLOSE','CLOSED','COMPLETED')
            ) THEN 'Close'
            WHEN l.data IS NOT NULL AND (
              UPPER(l.data->'contract'->>'status') IN ('CANCELLED','CANCELED','CANCEL')
            ) THEN 'Cancelled'
            WHEN l.data IS NULL AND UPPER(COALESCE(c.status, '')) IN ('OPEN','ACTIVE') THEN 'Open'
            WHEN l.data IS NULL AND UPPER(COALESCE(c.status, '')) IN ('CLOSE','CLOSED','COMPLETED') THEN 'Close'
            WHEN l.data IS NULL AND UPPER(COALESCE(c.status, '')) IN ('CANCELLED','CANCELED','CANCEL') THEN 'Cancelled'
            ELSE COALESCE(c.status, '')
          END AS status,
          COALESCE(q.delivered_quantity, 0) AS delivered_quantity,
          (COALESCE(c.quantity_ordered, 0) - COALESCE(q.delivered_quantity, 0)) AS outstanding_quantity
        FROM contracts c
        LEFT JOIN latest_spd l ON l.contract_number = c.contract_id
        LEFT JOIN qty q ON q.contract_number = c.contract_id
        LEFT JOIN LATERAL (
          SELECT
            MIN(p.payment_due_date) FILTER (WHERE p.payoff_date IS NULL) AS payment_due_date,
            MAX(p.payoff_date) AS payoff_date,
            (SELECT MAX(t.trucking_completion_date) FROM trucking_operations t WHERE t.contract_id = c.id) AS last_trucking_completion_date,
            (SELECT MAX(s.ata_discharge_complete::date) FROM shipments s WHERE s.contract_id = c.id AND s.ata_discharge_complete IS NOT NULL) AS last_ata_vessel_complete_discharge
          FROM payments p
          WHERE p.contract_id = c.id
        ) pinfo ON true
        WHERE 1=1 ${contractFilter} ${whereExtra}
      )
      SELECT
        (SELECT COUNT(*)::int FROM base) AS total_count,
        jsonb_agg(to_jsonb(r) ORDER BY r.contract_date DESC, r.contract_id ASC) AS rows
      FROM (
        SELECT *
        FROM base
        ORDER BY contract_date DESC, contract_id ASC
        LIMIT $${extraParams.length - 1}
        OFFSET $${extraParams.length}
      ) r
    `, extraParams);

    const row0 = result.rows?.[0] as any;
    const totalCount = Number(row0?.total_count) || 0;
    const rows = Array.isArray(row0?.rows) ? row0.rows : [];

    const asDate = (d: unknown): Date | null => {
      if (d == null) return null;
      if (d instanceof Date) return d;
      if (typeof d === 'string') {
        const t = Date.parse(d);
        if (Number.isNaN(t)) return null;
        return new Date(t);
      }
      return null;
    };
    const parseFlexibleDate = (v: unknown): Date | null => {
      if (v == null) return null;
      if (v instanceof Date) return v;
      const s = String(v).trim();
      if (!s) return null;
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(`${s}T00:00:00`);
      const mmddyy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
      if (mmddyy) {
        const mm = Number(mmddyy[1]);
        const dd = Number(mmddyy[2]);
        const yy = Number(mmddyy[3]);
        const fullYear = yy >= 70 ? 1900 + yy : 2000 + yy;
        return new Date(Date.UTC(fullYear, mm - 1, dd));
      }
      const mmddyyyy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      if (mmddyyyy) {
        const mm = Number(mmddyyyy[1]);
        const dd = Number(mmddyyyy[2]);
        const yyyy = Number(mmddyyyy[3]);
        return new Date(Date.UTC(yyyy, mm - 1, dd));
      }
      const t = Date.parse(s);
      if (!Number.isNaN(t)) return new Date(t);
      return null;
    };
    const diffInDays = (start: unknown, end: unknown): number | null => {
      const s = asDate(start);
      const e = asDate(end);
      if (!s || !e) return null;
      const msPerDay = 24 * 60 * 60 * 1000;
      const sMid = new Date(s.getFullYear(), s.getMonth(), s.getDate());
      const eMid = new Date(e.getFullYear(), e.getMonth(), e.getDate());
      return Math.round((eMid.getTime() - sMid.getTime()) / msPerDay);
    };

    // Compute log_cycle_days + cash_cycle_days for drilldown weighted averages
    const today = new Date();
    const todayMidIso = new Date(today.getFullYear(), today.getMonth(), today.getDate()).toISOString();
    for (const r of rows) {
      const spd = (r as any).latest_spd_data || {};
      const spdPayment = (spd && typeof spd === 'object') ? (spd as any).payment || {} : {};
      const spdRaw = (spd && typeof spd === 'object') ? (spd as any).raw || {} : {};
      const statusText = String(r.status || '').trim().toUpperCase();
      const transport = String(r.transport_mode || '').toUpperCase();
      const cargoReadyRaw =
        r.cargo_readiness_date ||
        spdPayment?.cargo_readiness_date ||
        spdRaw?.['Cargo Readiness Date'] ||
        spdRaw?.['Contract Readiness Date'] ||
        null;
      const cargoReady = cargoReadyRaw || r.contract_date || r.delivery_start_date || null;
      const lastTruck = r.last_trucking_completion_date;
      const lastAtaDischarge = r.last_ata_vessel_complete_discharge;
      const payoffDate =
        r.payoff_date ||
        parseFlexibleDate(spdPayment?.payoff_date) ||
        parseFlexibleDate(spdRaw?.['Payoff Date']) ||
        null;
      const dueDatePayment =
        r.payment_due_date ||
        parseFlexibleDate(spdPayment?.due_date_payment) ||
        parseFlexibleDate(spdRaw?.['Due Date Payment']) ||
        null;
      const cashStartLand = lastTruck || cargoReady || r.contract_date || r.delivery_start_date || null;
      const cashStartSea = lastAtaDischarge || cargoReady || r.contract_date || r.delivery_start_date || null;

      let logCycle: number | null = null;
      if (transport.startsWith('LAND')) {
        if (statusText === 'CLOSE' || statusText === 'CLOSED' || statusText === 'COMPLETED') {
          const d = diffInDays(cargoReady, lastTruck);
          if (d != null) logCycle = d;
        } else if (statusText === 'OPEN' || statusText === 'ACTIVE') {
          const d = diffInDays(cargoReady, todayMidIso);
          if (d != null) logCycle = d;
        }
      } else if (transport.startsWith('SEA')) {
        if (statusText === 'OPEN' || statusText === 'ACTIVE') {
          const d = diffInDays(cargoReady, todayMidIso);
          if (d != null) logCycle = d;
        } else if (statusText === 'CLOSE' || statusText === 'CLOSED' || statusText === 'COMPLETED') {
          const d = diffInDays(cargoReady, lastAtaDischarge);
          if (d != null) logCycle = d;
        }
      }
      (r as any).log_cycle_days = logCycle;

      let cashCycle: number | null = null;
      if ((statusText === 'CLOSE' || statusText === 'CLOSED' || statusText === 'COMPLETED') && payoffDate) {
        if (transport.startsWith('LAND')) {
          const d = diffInDays(cashStartLand, payoffDate);
          if (d != null) cashCycle = d;
        } else if (transport.startsWith('SEA')) {
          const d = diffInDays(cashStartSea, payoffDate);
          if (d != null) cashCycle = d;
        }
      } else if (dueDatePayment) {
        // Fallback for unpaid / open contracts: expected payment cycle to due date
        if (transport.startsWith('LAND')) {
          const d = diffInDays(cashStartLand, dueDatePayment);
          if (d != null) cashCycle = d;
        } else if (transport.startsWith('SEA')) {
          const d = diffInDays(cashStartSea, dueDatePayment);
          if (d != null) cashCycle = d;
        }
      }
      (r as any).cash_cycle_days = cashCycle;
      delete (r as any).latest_spd_data;
    }
    return res.json({
      success: true,
      data: rows,
      meta: { totalCount, limit: limitNum, offset: offsetNum },
    });
  } catch (error) {
    logger.error('Get filtered contracts error:', error);
    return res.status(500).json({ success: false, error: { message: 'Failed to get filtered contracts' } });
  }
};