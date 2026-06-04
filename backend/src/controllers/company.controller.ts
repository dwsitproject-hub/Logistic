import { Response } from 'express'
import { query } from '../database/connection'
import { AuthRequest } from '../middleware/auth'
import logger from '../utils/logger'
import * as XLSX from 'xlsx'

export const listCompanies = async (_req: AuthRequest, res: Response) => {
  try {
    const result = await query('SELECT * FROM companies ORDER BY name')
    return res.json({ success: true, data: result.rows })
  } catch (error) {
    logger.error('List companies error:', error)
    return res.status(500).json({ success: false, error: { message: 'Failed to list companies' } })
  }
}

export const createCompany = async (req: AuthRequest, res: Response) => {
  try {
    const { name, primary_contact, email, phone, latest_interaction_notes } = req.body || {}
    const result = await query(
      `INSERT INTO companies (name, primary_contact, email, phone, latest_interaction_notes)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING *`,
      [name, primary_contact || null, email || null, phone || null, latest_interaction_notes || null]
    )
    return res.json({ success: true, data: result.rows[0] })
  } catch (error) {
    logger.error('Create company error:', error)
    return res.status(500).json({ success: false, error: { message: 'Failed to create company' } })
  }
}

export const updateCompany = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params as any
    const { name, primary_contact, email, phone, latest_interaction_notes } = req.body || {}
    const result = await query(
      `UPDATE companies SET 
         name = COALESCE($1, name),
         primary_contact = $2,
         email = $3,
         phone = $4,
         latest_interaction_notes = $5,
         updated_at = NOW()
       WHERE id = $6
       RETURNING *`,
      [name || null, primary_contact || null, email || null, phone || null, latest_interaction_notes || null, id]
    )
    return res.json({ success: true, data: result.rows[0] })
  } catch (error) {
    logger.error('Update company error:', error)
    return res.status(500).json({ success: false, error: { message: 'Failed to update company' } })
  }
}

export const addCompanyNote = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params as any
    const { note } = req.body || {}
    if (!note) return res.status(400).json({ success: false, error: { message: 'Note is required' } })
    const userId = (req as any).user?.id || null
    const result = await query(`INSERT INTO company_notes (company_id, note, user_id) VALUES ($1,$2,$3) RETURNING *`, [id, note, userId])
    return res.json({ success: true, data: result.rows[0] })
  } catch (error) {
    logger.error('Add company note error:', error)
    return res.status(500).json({ success: false, error: { message: 'Failed to add note' } })
  }
}

export const listCompanyNotes = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params as any
    const result = await query(`
      SELECT cn.id, cn.note, cn.created_at, u.full_name as user_full_name
      FROM company_notes cn
      LEFT JOIN users u ON u.id = cn.user_id
      WHERE cn.company_id = $1
      ORDER BY cn.created_at DESC
    `, [id])
    return res.json({ success: true, data: result.rows })
  } catch (error) {
    logger.error('List company notes error:', error)
    return res.status(500).json({ success: false, error: { message: 'Failed to list notes' } })
  }
}

// Bulk upload (CSV/XLSX) handler
export const uploadCompanies = async (req: AuthRequest & { file?: Express.Multer.File }, res: Response) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, error: { message: 'File is required' } })
    const wb = XLSX.read(req.file.buffer, { type: 'buffer' })
    const ws = wb.Sheets[wb.SheetNames[0]]
    const rows = XLSX.utils.sheet_to_json<any>(ws, { header: 1 }) as any[][]
    const headers = (rows[0] || []).map(String)
    const needed = ['Parent Company Name','Primary Contact','Email','Phone','Latest Interaction Notes']
    const missing = needed.filter(h => !headers.includes(h))
    if (missing.length) return res.status(400).json({ success: false, error: { message: 'Missing headers: ' + missing.join(', ') } })
    const idx = (name: string) => headers.indexOf(name)
    let created = 0, updated = 0, failed = 0
    const errors: string[] = []
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i]
      if (!r || r.length === 0) continue
      const name = String(r[idx('Parent Company Name')] || '').trim()
      const primary = String(r[idx('Primary Contact')] || '').trim() || null
      const email = String(r[idx('Email')] || '').trim() || null
      const phone = String(r[idx('Phone')] || '').trim() || null
      const notes = String(r[idx('Latest Interaction Notes')] || '').trim() || null
      if (!name) { failed++; errors.push(`Row ${i+1}: Missing Parent Company Name`); continue }
      try {
        const existing = await query(`SELECT id FROM companies WHERE TRIM(name) ILIKE TRIM($1) LIMIT 1`, [name])
        if (existing.rows.length) {
          await query(`UPDATE companies SET primary_contact=$1, email=$2, phone=$3, updated_at=NOW() WHERE id=$4`, [primary, email, phone, existing.rows[0].id])
          if (notes) await query(`INSERT INTO company_notes (company_id, note) VALUES ($1,$2)`, [existing.rows[0].id, notes])
          updated++
        } else {
          await query(`INSERT INTO companies (name, primary_contact, email, phone, latest_interaction_notes) VALUES ($1,$2,$3,$4,$5) RETURNING id`, [name, primary, email, phone, notes])
          created++
        }
      } catch (e:any) {
        failed++; errors.push(`Row ${i+1} (${name || 'UNKNOWN'}): ${e.message || 'error'}`)
      }
    }
    return res.json({ success: true, data: { created, updated, failed, errors: errors.slice(0, 100) } })
  } catch (error) {
    logger.error('Upload companies error:', error)
    return res.status(500).json({ success: false, error: { message: 'Failed to upload companies' } })
  }
}
export const getCompanyStats = async (req: AuthRequest, res: Response) => {
  try {
    const { name } = req.query as { name?: string }
    if (!name) return res.status(400).json({ success: false, error: { message: 'Parent company name is required' } })

    // Total and Active contracts
    const totals = await query(
      `SELECT 
         COUNT(DISTINCT c.contract_id) AS total_contracts,
         COUNT(DISTINCT c.contract_id) FILTER (WHERE c.status = 'ACTIVE') AS active_contracts
       FROM contracts c
       WHERE TRIM(c.supplier) ILIKE TRIM($1)`,
      [name]
    )

    // Quantity by product and outstanding by product
    const byProduct = await query(
      `SELECT 
         c.product,
         SUM(c.quantity_ordered) AS total_quantity,
         COALESCE(SUM(CAST(REPLACE(REPLACE(s.data->'contract'->>'sto_quantity', ',', ''), ' ', '') AS NUMERIC)), 0) AS completed_quantity
       FROM contracts c
       LEFT JOIN sap_processed_data s
         ON s.contract_number = c.contract_id
        AND s.sto_number IS NOT NULL
        AND s.data->'contract'->>'sto_quantity' IS NOT NULL
       WHERE TRIM(c.supplier) ILIKE TRIM($1) AND c.product IS NOT NULL AND c.product != ''
       GROUP BY c.product
       ORDER BY SUM(c.quantity_ordered) DESC`,
      [name]
    )

    // Capacity per product from suppliers table (yearly)
    const cap = await query(
      `SELECT 
         COALESCE(SUM(cpo_prod_est_year),0) AS cpo_year,
         COALESCE(SUM(pk_prod_est_year),0) AS pk_year,
         COALESCE(SUM(pome_prod_est_year),0) AS pome_year,
         COALESCE(SUM(shell_prod_est_year),0) AS shell_year
       FROM suppliers
       WHERE TRIM(parent_company) ILIKE TRIM($1)`,
      [name]
    )

    const stats = {
      totalContracts: parseInt(totals.rows[0]?.total_contracts || '0', 10),
      totalActiveContracts: parseInt(totals.rows[0]?.active_contracts || '0', 10),
      byProduct: byProduct.rows.map(r => ({
        product: r.product,
        total_quantity: Number(r.total_quantity || 0),
        outstanding_quantity: Number(r.total_quantity || 0) - Number(r.completed_quantity || 0)
      })),
      capacity: {
        CPO: Number(cap.rows[0]?.cpo_year || 0),
        PK: Number(cap.rows[0]?.pk_year || 0),
        POME: Number(cap.rows[0]?.pome_year || 0),
        SHELL: Number(cap.rows[0]?.shell_year || 0)
      }
    }

    return res.json({ success: true, data: stats })
  } catch (error) {
    logger.error('Get company stats error:', error)
    return res.status(500).json({ success: false, error: { message: 'Failed to fetch company stats' } })
  }
}


