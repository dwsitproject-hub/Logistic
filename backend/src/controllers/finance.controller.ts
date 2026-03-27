import { Response } from 'express'
import { query } from '../database/connection'
import { AuthRequest } from '../middleware/auth'
import logger from '../utils/logger'

const toNumber = (value: any) => (value === null || value === undefined ? null : Number(value))

export const getPayments = async (req: AuthRequest, res: Response) => {
  try {
    const {
      status,
      search,
      contract_id,
      page = '1',
      limit = '100',
      sortKey,
      sortDir,
      invoice_number,
      supplier,
      product,
      currency,
      due_from,
      due_to,
      dp_from,
      dp_to,
      payoff_from,
      payoff_to,
    } = req.query as Record<string, string | undefined>

    // Avoid doing writes on every read request (this can be slow and cause locks).
    // We compute an effective payment amount in the SELECT instead.

    const parsedLimit = Math.min(Math.max(Number(limit) || 100, 1), 500)
    const parsedPage = Math.max(Number(page) || 1, 1)
    const offset = (parsedPage - 1) * parsedLimit

    const params: any[] = []
    const where: string[] = []

    const pushLike = (value: string | undefined, expr: string) => {
      if (!value) return
      params.push(`%${value}%`.toLowerCase())
      where.push(`LOWER(${expr}) LIKE $${params.length}`)
    }

    if (search) {
      params.push(`%${search}%`.toLowerCase())
      where.push(`(LOWER(p.invoice_number) LIKE $${params.length} OR LOWER(c.contract_id) LIKE $${params.length} OR LOWER(c.supplier) LIKE $${params.length} OR LOWER(c.product) LIKE $${params.length})`)
    }
    if (contract_id) {
      params.push(contract_id)
      where.push(`c.contract_id = $${params.length}`)
    }

    pushLike(invoice_number, 'p.invoice_number')
    pushLike(supplier, 'c.supplier')
    pushLike(product, 'c.product')

    if (currency) {
      params.push(currency.toUpperCase())
      where.push(`UPPER(COALESCE(p.currency, '')) = $${params.length}`)
    }


    const allowedSort: Record<string, string> = {
      invoice_number: 'invoice_number',
      contract_id: 'contract_id',
      supplier: 'supplier',
      product: 'product',
      currency: 'currency',
      payment_amount: 'payment_amount',
      due_date_payment: 'due_date_payment',
      dp_date: 'dp_date',
      payoff_date: 'payoff_date',
      payment_status: 'payment_status',
      created_at: 'created_at',
    }
    const orderKey = sortKey && allowedSort[sortKey] ? allowedSort[sortKey] : 'due_date_payment'
    const dir = String(sortDir || 'asc').toLowerCase() === 'desc' ? 'DESC' : 'ASC'

    const baseWhere = where.length ? `WHERE ${where.join(' AND ')}` : ''

    // Build a computed view so filters/sort apply across all records (fast + consistent).
    // Note: dp_date & payoff_date are enriched from sap_processed_data per contract_id.
    const computedCte = `
      WITH computed AS (
        SELECT
          p.id,
          p.invoice_number,
          p.invoice_date,
          COALESCE(NULLIF(p.payment_amount, 0), c.contract_value, (c.quantity_ordered * c.unit_price), p.payment_amount) AS payment_amount,
          p.currency,
          p.payment_due_date,
          p.payment_date,
          p.payment_method,
          p.bank_reference,
          p.created_at,
          p.updated_at,
          c.contract_id,
          c.supplier,
          c.product,
          COALESCE(mv.due_date_payment, p.payment_due_date) AS due_date_payment,
          mv.dp_date,
          mv.payoff_date,
          mv.dp_date_deviation_days,
          mv.payoff_date_deviation_days,
          (CASE
            WHEN mv.dp_date IS NOT NULL AND mv.payoff_date IS NOT NULL THEN 'PAID'
            WHEN mv.payoff_date IS NULL AND COALESCE(mv.due_date_payment, p.payment_due_date) IS NOT NULL AND COALESCE(mv.due_date_payment, p.payment_due_date) <= CURRENT_DATE AND mv.dp_date IS NOT NULL THEN 'PARTIAL'
            WHEN mv.payoff_date IS NULL AND COALESCE(mv.due_date_payment, p.payment_due_date) IS NOT NULL AND COALESCE(mv.due_date_payment, p.payment_due_date) <= CURRENT_DATE AND mv.dp_date IS NULL THEN 'PENDING'
            WHEN mv.payoff_date IS NULL AND COALESCE(mv.due_date_payment, p.payment_due_date) IS NOT NULL AND COALESCE(mv.due_date_payment, p.payment_due_date) > CURRENT_DATE THEN 'OVERDUE'
            ELSE UPPER(COALESCE(p.payment_status, 'PENDING'))
          END) AS payment_status
        FROM payments p
        LEFT JOIN contracts c ON c.id = p.contract_id
        LEFT JOIN mv_contract_payment_dates mv ON mv.contract_id = c.contract_id
        ${baseWhere}
      )
    `

    // Column filters that depend on computed fields
    const computedWhere: string[] = []
    const computedParams: any[] = [...params]
    const addComputed = (clause: string, value?: any) => {
      if (value !== undefined) computedParams.push(value)
      const idx = computedParams.length
      computedWhere.push(clause.replace(/\$X/g, `$${idx}`))
    }

    if (status) {
      addComputed(`UPPER(payment_status) = $X`, status.toUpperCase())
    }

    // Date filters are applied on computed fields below.
    const applyRange = (from: string | undefined, to: string | undefined, col: string) => {
      if (from) addComputed(`${col} >= $X::date`, from)
      if (to) addComputed(`${col} <= $X::date`, to)
    }
    applyRange(due_from, due_to, 'due_date_payment')
    applyRange(dp_from, dp_to, 'dp_date')
    applyRange(payoff_from, payoff_to, 'payoff_date')

    const computedWhereClause = computedWhere.length ? `WHERE ${computedWhere.join(' AND ')}` : ''

    const countRes = await query(
      `${computedCte} SELECT COUNT(*) AS total FROM computed ${computedWhereClause}`,
      computedParams
    )
    const total = Number(countRes.rows[0]?.total || 0)

    computedParams.push(parsedLimit)
    computedParams.push(offset)

    const listRes = await query(
      `${computedCte}
       SELECT
         id, invoice_number, invoice_date, payment_amount, currency,
         payment_due_date, payment_date, payment_status, payment_method, bank_reference,
         created_at, updated_at, contract_id, supplier, product,
         due_date_payment, dp_date, payoff_date,
         dp_date_deviation_days,
         payoff_date_deviation_days
       FROM computed
       ${computedWhereClause}
       ORDER BY ${orderKey} ${dir} NULLS LAST
       LIMIT $${computedParams.length - 1} OFFSET $${computedParams.length}`,
      computedParams
    )

    const rows = listRes.rows.map((row) => ({
      ...row,
      payment_amount: toNumber(row.payment_amount),
    }))

    return res.json({
      success: true,
      data: rows,
      pagination: {
        page: parsedPage,
        limit: parsedLimit,
        total,
        totalPages: Math.max(1, Math.ceil(total / parsedLimit)),
      },
    })
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
    // Summary must match the same computed status logic used in /finance/payments.
    const computedCte = `
      WITH computed AS (
        SELECT
          COALESCE(NULLIF(p.payment_amount, 0), c.contract_value, (c.quantity_ordered * c.unit_price), p.payment_amount) AS payment_amount,
          COALESCE(mv.due_date_payment, p.payment_due_date) AS due_date_payment,
          mv.dp_date,
          mv.payoff_date,
          (CASE
            WHEN mv.dp_date IS NOT NULL AND mv.payoff_date IS NOT NULL THEN 'PAID'
            WHEN mv.payoff_date IS NULL AND COALESCE(mv.due_date_payment, p.payment_due_date) IS NOT NULL AND COALESCE(mv.due_date_payment, p.payment_due_date) <= CURRENT_DATE AND mv.dp_date IS NOT NULL THEN 'PARTIAL'
            WHEN mv.payoff_date IS NULL AND COALESCE(mv.due_date_payment, p.payment_due_date) IS NOT NULL AND COALESCE(mv.due_date_payment, p.payment_due_date) <= CURRENT_DATE AND mv.dp_date IS NULL THEN 'PENDING'
            WHEN mv.payoff_date IS NULL AND COALESCE(mv.due_date_payment, p.payment_due_date) IS NOT NULL AND COALESCE(mv.due_date_payment, p.payment_due_date) > CURRENT_DATE THEN 'OVERDUE'
            ELSE UPPER(COALESCE(p.payment_status, 'PENDING'))
          END) AS payment_status
        FROM payments p
        LEFT JOIN contracts c ON c.id = p.contract_id
        LEFT JOIN mv_contract_payment_dates mv ON mv.contract_id = c.contract_id
      )
    `

    const totalsRes = await query(
      `${computedCte}
       SELECT
         COUNT(*) AS total_records,
         COALESCE(SUM(payment_amount), 0) AS total_amount,
         COALESCE(SUM(payment_amount) FILTER (WHERE payment_status = 'PENDING'), 0) AS pending_amount,
         COALESCE(SUM(payment_amount) FILTER (WHERE payment_status = 'PARTIAL'), 0) AS partial_amount,
         COALESCE(SUM(payment_amount) FILTER (WHERE payment_status = 'PAID'), 0) AS paid_amount,
         COALESCE(SUM(payment_amount) FILTER (WHERE payment_status = 'OVERDUE'), 0) AS overdue_amount
       FROM computed`
    )

    const monthlyRes = await query(
      `${computedCte}
       SELECT
         TO_CHAR(due_date_payment, 'YYYY-MM') AS month,
         COALESCE(SUM(payment_amount), 0) AS due_amount,
         COALESCE(SUM(payment_amount) FILTER (WHERE payment_status = 'PAID'), 0) AS paid_amount
       FROM computed
       WHERE due_date_payment IS NOT NULL
       GROUP BY TO_CHAR(due_date_payment, 'YYYY-MM')
       ORDER BY month ASC
       LIMIT 12`
    )

    const statusBreakdownRes = await query(
      `${computedCte}
       SELECT
         payment_status AS status,
         COUNT(*) AS count,
         COALESCE(SUM(payment_amount), 0) AS amount
       FROM computed
       GROUP BY payment_status`
    )

    const summary = {
      totals: {
        totalRecords: Number(totalsRes.rows[0]?.total_records || 0),
        totalAmount: toNumber(totalsRes.rows[0]?.total_amount),
        pendingAmount: toNumber(totalsRes.rows[0]?.pending_amount),
        partialAmount: toNumber(totalsRes.rows[0]?.partial_amount),
        paidAmount: toNumber(totalsRes.rows[0]?.paid_amount),
        overdueAmount: toNumber(totalsRes.rows[0]?.overdue_amount),
      },
      byStatus: statusBreakdownRes.rows.map((row) => ({
        status: row.status,
        count: Number(row.count || 0),
        amount: toNumber(row.amount),
      })),
      byMonth: monthlyRes.rows.map((row) => ({
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

