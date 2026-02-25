import { Response } from 'express'
import { query } from '../database/connection'
import { AuthRequest } from '../middleware/auth'
import logger from '../utils/logger'

const toNumber = (value: any) => (value === null || value === undefined ? null : Number(value))

export const getPayments = async (req: AuthRequest, res: Response) => {
  try {
    const { status, search, contract_id } = req.query as { status?: string; search?: string; contract_id?: string }

    await query(
      `UPDATE payments p SET
         payment_amount = COALESCE(c.contract_value, c.quantity_ordered * c.unit_price, 0)
       FROM contracts c
       WHERE c.id = p.contract_id
         AND (p.payment_amount = 0 OR p.payment_amount IS NULL)
         AND (c.contract_value IS NOT NULL OR (c.quantity_ordered IS NOT NULL AND c.unit_price IS NOT NULL))`
    )

    const params: any[] = []
    const conditions: string[] = []

    if (status) {
      const statusUpper = status.toUpperCase()
      if (statusUpper === 'OVERDUE') {
        conditions.push(`(p.payment_status = 'OVERDUE' OR (p.payment_status = 'PENDING' AND p.payment_due_date IS NOT NULL AND p.payment_due_date < CURRENT_DATE))`)
      } else if (statusUpper === 'PENDING') {
        conditions.push(`(p.payment_status = 'PENDING' AND (p.payment_due_date IS NULL OR p.payment_due_date >= CURRENT_DATE))`)
      } else {
        params.push(statusUpper)
        conditions.push(`UPPER(p.payment_status) = $${params.length}`)
      }
    }

    if (search) {
      params.push(`%${search}%`.toLowerCase())
      conditions.push(
        `(LOWER(p.invoice_number) LIKE $${params.length} OR LOWER(c.contract_id) LIKE $${params.length} OR LOWER(c.supplier) LIKE $${params.length})`
      )
    }

    if (contract_id) {
      params.push(contract_id)
      conditions.push(`c.contract_id = $${params.length}`)
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

    const result = await query(
      `SELECT
         p.id,
         p.invoice_number,
         p.invoice_date,
         p.payment_amount,
         p.currency,
         p.payment_due_date,
         p.payment_date,
         p.payment_status,
         p.payment_method,
         p.bank_reference,
         p.created_at,
         p.updated_at,
         c.contract_id,
         c.supplier,
         c.product
       FROM payments p
       LEFT JOIN contracts c ON c.id = p.contract_id
       ${whereClause}
       ORDER BY p.payment_due_date NULLS LAST, p.created_at DESC`,
      params
    )

    const payments = result.rows.map((row) => ({
      ...row,
      payment_amount: toNumber(row.payment_amount),
      due_date_payment: row.payment_due_date ?? null,
      dp_date: row.dp_date ?? null,
      payoff_date: row.payoff_date ?? null,
      dp_date_deviation_days: null as number | null,
      payoff_date_deviation_days: null as number | null,
    }))

    const due = (d: unknown): Date | null => {
      if (d == null) return null
      if (d instanceof Date) return d
      if (typeof d === 'string') return new Date(d)
      return null
    }
    const addDays = (date: Date, days: number): Date => {
      const out = new Date(date)
      out.setUTCDate(out.getUTCDate() + days)
      return out
    }
    const daysBetween = (from: Date | string | null, to: Date | string | null): number | null => {
      const a = due(from)
      const b = due(to)
      if (!a || !b) return null
      const ms = b.getTime() - a.getTime()
      return Math.round(ms / (24 * 60 * 60 * 1000))
    }

    const contractIds = [...new Set(payments.map((r) => r.contract_id).filter(Boolean))] as string[]
    if (contractIds.length > 0) {
      try {
        const contractsRes = await query(
          `SELECT sub.contract_id, lat.due_date_payment, lat.dp_date, lat.payoff_date, lat.dp_date_deviation_days, lat.payoff_date_deviation_days
           FROM (
             SELECT c.contract_id, x.raw_due, x.raw_dp, x.raw_payoff, x.raw_dp_dev, x.raw_payoff_dev
             FROM contracts c
             LEFT JOIN LATERAL (
               SELECT
                 trim(COALESCE(NULLIF(trim(spd.data->'payment'->>'due_date_payment'), ''), NULLIF(trim(spd.data->'raw'->>'Due Date Payment'), ''), (SELECT e.v FROM jsonb_each_text(spd.data->'raw') AS e(k,v) WHERE lower(replace(trim(e.k), ' ', '')) = 'duedatepayment' AND trim(e.v) <> '' LIMIT 1))) AS raw_due,
                 trim(COALESCE(NULLIF(trim(spd.data->'payment'->>'dp_date'), ''), NULLIF(trim(spd.data->'raw'->>'DP Date'), ''), (SELECT e.v FROM jsonb_each_text(spd.data->'raw') AS e(k,v) WHERE lower(replace(trim(e.k), ' ', '')) = 'dpdate' AND trim(e.v) <> '' LIMIT 1))) AS raw_dp,
                 trim(COALESCE(NULLIF(trim(spd.data->'payment'->>'payoff_date'), ''), NULLIF(trim(spd.data->'raw'->>'Payoff Date'), ''), (SELECT e.v FROM jsonb_each_text(spd.data->'raw') AS e(k,v) WHERE lower(replace(trim(e.k), ' ', '')) = 'payoffdate' AND trim(e.v) <> '' LIMIT 1))) AS raw_payoff,
                 trim(COALESCE(NULLIF(trim(spd.data->'payment'->>'dp_date_deviation_days'), ''), NULLIF(trim(spd.data->'raw'->>'DP Date Deviation (Days) DP Date - Due Date'), ''), NULLIF(trim(spd.data->'raw'->>'DP Date - Due Date'), ''), (SELECT e.v FROM jsonb_each_text(spd.data->'raw') AS e(k,v) WHERE lower(replace(trim(e.k), ' ', '')) IN ('dpdatedeviation(days)dpdate-duedate','dpdate-duedate') AND trim(e.v) <> '' LIMIT 1))) AS raw_dp_dev,
                 trim(COALESCE(NULLIF(trim(spd.data->'payment'->>'payoff_date_deviation_days'), ''), NULLIF(trim(spd.data->'raw'->>'Payoff Date Deviation (Days) Payoff Date - Due Date'), ''), NULLIF(trim(spd.data->'raw'->>'Payoff Date - Due Date'), ''), (SELECT e.v FROM jsonb_each_text(spd.data->'raw') AS e(k,v) WHERE lower(replace(trim(e.k), ' ', '')) IN ('payoffdatedeviation(days)payoffdate-duedate','payoffdate-duedate') AND trim(e.v) <> '' LIMIT 1))) AS raw_payoff_dev
               FROM sap_processed_data spd
               WHERE spd.contract_number = c.contract_id
               ORDER BY (CASE WHEN trim(COALESCE(spd.data->'raw'->>'Due Date Payment', spd.data->'payment'->>'due_date_payment', '')) <> '' THEN 0 ELSE 1 END), (CASE WHEN trim(COALESCE(spd.data->'raw'->>'DP Date', spd.data->'payment'->>'dp_date', '')) <> '' THEN 0 ELSE 1 END), (CASE WHEN trim(COALESCE(spd.data->'raw'->>'Payoff Date', spd.data->'payment'->>'payoff_date', '')) <> '' THEN 0 ELSE 1 END), spd.created_at DESC NULLS LAST
               LIMIT 1
             ) x ON true
             WHERE c.contract_id = ANY($1::text[])
           ) sub
           CROSS JOIN LATERAL (
             SELECT
               (CASE WHEN sub.raw_due ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN sub.raw_due::date WHEN sub.raw_due ~ '^[0-9]{1,2}/[0-9]{1,2}/[0-9]{2}$' THEN to_date(sub.raw_due, 'MM/DD/YY') WHEN sub.raw_due ~ '^[0-9]{1,2}/[0-9]{1,2}/[0-9]{4}$' THEN to_date(sub.raw_due, 'MM/DD/YYYY') ELSE (SELECT p2.payment_due_date FROM payments p2 INNER JOIN contracts c2 ON c2.id = p2.contract_id WHERE c2.contract_id = sub.contract_id ORDER BY p2.created_at DESC LIMIT 1) END) AS due_date_payment,
               (CASE WHEN sub.raw_dp ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN sub.raw_dp::date WHEN sub.raw_dp ~ '^[0-9]{1,2}/[0-9]{1,2}/[0-9]{2}$' THEN to_date(sub.raw_dp, 'MM/DD/YY') WHEN sub.raw_dp ~ '^[0-9]{1,2}/[0-9]{1,2}/[0-9]{4}$' THEN to_date(sub.raw_dp, 'MM/DD/YYYY') ELSE (SELECT p2.dp_date FROM payments p2 INNER JOIN contracts c2 ON c2.id = p2.contract_id WHERE c2.contract_id = sub.contract_id ORDER BY p2.created_at DESC LIMIT 1) END) AS dp_date,
               (CASE WHEN sub.raw_payoff ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN sub.raw_payoff::date WHEN sub.raw_payoff ~ '^[0-9]{1,2}/[0-9]{1,2}/[0-9]{2}$' THEN to_date(sub.raw_payoff, 'MM/DD/YY') WHEN sub.raw_payoff ~ '^[0-9]{1,2}/[0-9]{1,2}/[0-9]{4}$' THEN to_date(sub.raw_payoff, 'MM/DD/YYYY') ELSE (SELECT p2.payoff_date FROM payments p2 INNER JOIN contracts c2 ON c2.id = p2.contract_id WHERE c2.contract_id = sub.contract_id ORDER BY p2.created_at DESC LIMIT 1) END) AS payoff_date,
               (CASE WHEN sub.raw_dp_dev ~ '^-?[0-9]+$' THEN sub.raw_dp_dev::int
                 ELSE (CASE WHEN sub.raw_dp ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' AND sub.raw_due ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN (sub.raw_dp::date - sub.raw_due::date) WHEN sub.raw_dp ~ '^[0-9]{1,2}/[0-9]{1,2}/[0-9]{2}$' AND sub.raw_due ~ '^[0-9]{1,2}/[0-9]{1,2}/[0-9]{2}$' THEN (to_date(sub.raw_dp, 'MM/DD/YY') - to_date(sub.raw_due, 'MM/DD/YY')) WHEN sub.raw_dp ~ '^[0-9]{1,2}/[0-9]{1,2}/[0-9]{4}$' AND sub.raw_due ~ '^[0-9]{1,2}/[0-9]{1,2}/[0-9]{4}$' THEN (to_date(sub.raw_dp, 'MM/DD/YYYY') - to_date(sub.raw_due, 'MM/DD/YYYY')) ELSE NULL END) END) AS dp_date_deviation_days,
               (CASE WHEN sub.raw_payoff_dev ~ '^-?[0-9]+$' THEN sub.raw_payoff_dev::int
                 ELSE (CASE WHEN sub.raw_payoff ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' AND sub.raw_due ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN (sub.raw_payoff::date - sub.raw_due::date) WHEN sub.raw_payoff ~ '^[0-9]{1,2}/[0-9]{1,2}/[0-9]{2}$' AND sub.raw_due ~ '^[0-9]{1,2}/[0-9]{1,2}/[0-9]{2}$' THEN (to_date(sub.raw_payoff, 'MM/DD/YY') - to_date(sub.raw_due, 'MM/DD/YY')) WHEN sub.raw_payoff ~ '^[0-9]{1,2}/[0-9]{1,2}/[0-9]{4}$' AND sub.raw_due ~ '^[0-9]{1,2}/[0-9]{1,2}/[0-9]{4}$' THEN (to_date(sub.raw_payoff, 'MM/DD/YYYY') - to_date(sub.raw_due, 'MM/DD/YYYY')) ELSE NULL END) END) AS payoff_date_deviation_days
           ) lat`,
          [contractIds]
        )
        const byContract = new Map<string, typeof contractsRes.rows[0]>()
        for (const r of contractsRes.rows) {
          byContract.set(r.contract_id, r)
        }
        for (const row of payments) {
          const contractId = row.contract_id
          if (!contractId) continue
          const info = byContract.get(contractId)
          if (info) {
            row.due_date_payment = info.due_date_payment ?? row.payment_due_date ?? null
            row.dp_date = info.dp_date
            row.payoff_date = info.payoff_date
            row.dp_date_deviation_days = info.dp_date_deviation_days
            row.payoff_date_deviation_days = info.payoff_date_deviation_days
          } else {
            row.due_date_payment = row.due_date_payment ?? row.payment_due_date ?? null
          }
          const dueDate = due(row.due_date_payment)
          if (dueDate) {
            if (row.dp_date == null && typeof row.dp_date_deviation_days === 'number') {
              row.dp_date = addDays(dueDate, row.dp_date_deviation_days)
            }
            if (row.payoff_date == null && typeof row.payoff_date_deviation_days === 'number') {
              row.payoff_date = addDays(dueDate, row.payoff_date_deviation_days)
            }
          }
          if (row.dp_date_deviation_days == null && row.due_date_payment != null && row.dp_date != null) {
            row.dp_date_deviation_days = daysBetween(row.due_date_payment, row.dp_date)
          }
          if (row.payoff_date_deviation_days == null && row.due_date_payment != null && row.payoff_date != null) {
            row.payoff_date_deviation_days = daysBetween(row.due_date_payment, row.payoff_date)
          }
        }
      } catch (err) {
        logger.warn('Finance: could not enrich payments with contract dates', err)
      }
    }

    const today = new Date()
    today.setHours(0, 0, 0, 0)
    for (const row of payments) {
      const effectiveDue = row.due_date_payment ?? row.payment_due_date
      if (row.payment_status === 'PENDING' && effectiveDue != null) {
        const d = due(effectiveDue)
        if (d) {
          d.setHours(0, 0, 0, 0)
          if (d.getTime() < today.getTime()) {
            row.payment_status = 'OVERDUE'
          }
        }
      }
    }

    return res.json({ success: true, data: payments })
  } catch (error) {
    logger.error('Get payments error:', error)
    return res.status(500).json({ success: false, error: { message: 'Failed to load payments' } })
  }
}

export const getPaymentById = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params
    const result = await query(
      `SELECT
         p.*,
         c.contract_id,
         c.supplier,
         c.product,
         c.quantity_ordered,
         c.unit,
         c.status AS contract_status
       FROM payments p
       LEFT JOIN contracts c ON c.id = p.contract_id
       WHERE p.id = $1
       LIMIT 1`,
      [id]
    )

    if (!result.rows.length) {
      return res.status(404).json({ success: false, error: { message: 'Payment not found' } })
    }

    const row = result.rows[0]
    const payment = {
      ...row,
      payment_amount: toNumber(row.payment_amount),
    }

    return res.json({ success: true, data: payment })
  } catch (error) {
    logger.error('Get payment detail error:', error)
    return res.status(500).json({ success: false, error: { message: 'Failed to load payment details' } })
  }
}

export const updatePayment = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params
    const { payment_status, payment_method } = req.body as {
      payment_status?: string
      payment_method?: string | null
    }

    if (!payment_status && payment_method === undefined) {
      return res.status(400).json({
        success: false,
        error: { message: 'Nothing to update' },
      })
    }

    const allowedStatuses = ['PENDING', 'PARTIAL', 'PAID', 'OVERDUE']
    let normalizedStatus: string | undefined
    if (payment_status !== undefined) {
      normalizedStatus = payment_status.toUpperCase()
      if (!allowedStatuses.includes(normalizedStatus)) {
        return res.status(400).json({
          success: false,
          error: { message: 'Invalid payment status' },
        })
      }
    }

    const setClauses: string[] = []
    const params: any[] = []
    let idx = 1

    if (normalizedStatus !== undefined) {
      setClauses.push(`payment_status = $${idx++}`)
      params.push(normalizedStatus)
    }
    if (payment_method !== undefined) {
      setClauses.push(`payment_method = $${idx++}`)
      params.push(payment_method === null ? null : String(payment_method).trim())
    }

    if (setClauses.length === 0) {
      return res.status(400).json({
        success: false,
        error: { message: 'Nothing to update' },
      })
    }

    params.push(id)

    const result = await query(
      `UPDATE payments
         SET ${setClauses.join(', ')},
             updated_at = CURRENT_TIMESTAMP
       WHERE id = $${idx}
       RETURNING *`,
      params
    )

    if (!result.rows.length) {
      return res.status(404).json({
        success: false,
        error: { message: 'Payment not found' },
      })
    }

    const row = result.rows[0]
    const payment = {
      ...row,
      payment_amount: toNumber(row.payment_amount),
    }

    return res.json({ success: true, data: payment })
  } catch (error) {
    logger.error('Update payment error:', error)
    return res.status(500).json({ success: false, error: { message: 'Failed to update payment' } })
  }
}

export const getFinanceSummary = async (_req: AuthRequest, res: Response) => {
  try {
    const [totals, statusBreakdown, monthly] = await Promise.all([
      query(
        `SELECT
           COUNT(*) AS total_records,
           COALESCE(SUM(payment_amount), 0) AS total_amount,
           COALESCE(SUM(payment_amount) FILTER (WHERE payment_status = 'PENDING' AND (payment_due_date IS NULL OR payment_due_date >= CURRENT_DATE)), 0) AS pending_amount,
           COALESCE(SUM(payment_amount) FILTER (WHERE payment_status = 'PARTIAL'), 0) AS partial_amount,
           COALESCE(SUM(payment_amount) FILTER (WHERE payment_status = 'PAID'), 0) AS paid_amount,
           COALESCE(SUM(payment_amount) FILTER (WHERE payment_status = 'OVERDUE' OR (payment_status = 'PENDING' AND payment_due_date IS NOT NULL AND payment_due_date < CURRENT_DATE)), 0) AS overdue_amount
         FROM payments`
      ),
      query(
        `SELECT
           CASE WHEN payment_status = 'PENDING' AND payment_due_date IS NOT NULL AND payment_due_date < CURRENT_DATE THEN 'OVERDUE' ELSE payment_status END AS status,
           COUNT(*) AS count,
           COALESCE(SUM(payment_amount), 0) AS amount
         FROM payments
         GROUP BY (CASE WHEN payment_status = 'PENDING' AND payment_due_date IS NOT NULL AND payment_due_date < CURRENT_DATE THEN 'OVERDUE' ELSE payment_status END)`
      ),
      query(
        `SELECT
           TO_CHAR(payment_due_date, 'YYYY-MM') AS month,
           COALESCE(SUM(payment_amount), 0) AS due_amount,
           COALESCE(SUM(payment_amount) FILTER (WHERE payment_status = 'PAID'), 0) AS paid_amount
         FROM payments
         WHERE payment_due_date IS NOT NULL
         GROUP BY TO_CHAR(payment_due_date, 'YYYY-MM')
         ORDER BY month ASC
         LIMIT 12`
      ),
    ])

    const summary = {
      totals: {
        totalRecords: Number(totals.rows[0]?.total_records || 0),
        totalAmount: toNumber(totals.rows[0]?.total_amount),
        pendingAmount: toNumber(totals.rows[0]?.pending_amount),
        partialAmount: toNumber(totals.rows[0]?.partial_amount),
        paidAmount: toNumber(totals.rows[0]?.paid_amount),
        overdueAmount: toNumber(totals.rows[0]?.overdue_amount),
      },
      byStatus: statusBreakdown.rows.map((row) => ({
        status: row.status,
        count: Number(row.count || 0),
        amount: toNumber(row.amount),
      })),
      byMonth: monthly.rows.map((row) => ({
        month: row.month,
        dueAmount: toNumber(row.due_amount),
        paidAmount: toNumber(row.paid_amount),
      })),
    }

    return res.json({ success: true, data: summary })
  } catch (error) {
    logger.error('Get finance summary error:', error)
    return res.status(500).json({ success: false, error: { message: 'Failed to load finance summary' } })
  }
}

