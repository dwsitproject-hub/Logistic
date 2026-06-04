import { Response } from 'express'
import { query } from '../database/connection'
import { AuthRequest } from '../middleware/auth'
import logger from '../utils/logger'

export const getContractRemarks = async (req: AuthRequest, res: Response) => {
  try {
    const contractId = String(req.params.id || '').trim()
    if (!contractId) {
      return res.status(400).json({ success: false, error: { message: 'Contract id is required' } })
    }

    const result = await query(
      `
      SELECT
        r.id,
        r.text,
        r.category,
        r.related_entity_type,
        r.related_entity_id,
        r.created_at,
        r.updated_at,
        COALESCE(u.username, '') AS username,
        COALESCE(u.full_name, '') AS full_name
      FROM remarks r
      LEFT JOIN users u ON u.id = r.created_by
      WHERE r.related_entity_type = 'CONTRACT'
        AND r.related_entity_id = $1::uuid
      ORDER BY r.created_at DESC NULLS LAST
      `,
      [contractId]
    )

    return res.json({ success: true, data: result.rows })
  } catch (error) {
    logger.error('Get contract remarks error:', error)
    return res.status(500).json({ success: false, error: { message: 'Failed to load remarks' } })
  }
}

export const createContractRemark = async (req: AuthRequest, res: Response) => {
  try {
    const contractId = String(req.params.id || '').trim()
    const text = String(req.body?.text || '').trim()
    const category = req.body?.category != null ? String(req.body.category).trim() : null
    const userId = req.user?.id

    if (!contractId) {
      return res.status(400).json({ success: false, error: { message: 'Contract id is required' } })
    }
    if (!text) {
      return res.status(400).json({ success: false, error: { message: 'Comment text is required' } })
    }
    if (!userId) {
      return res.status(401).json({ success: false, error: { message: 'Unauthorized' } })
    }

    const result = await query(
      `
      INSERT INTO remarks (text, category, related_entity_type, related_entity_id, created_by)
      VALUES ($1, $2, 'CONTRACT', $3::uuid, $4::uuid)
      RETURNING id, text, category, related_entity_type, related_entity_id, created_at, updated_at
      `,
      [text, category, contractId, userId]
    )

    return res.json({ success: true, data: result.rows[0] })
  } catch (error) {
    logger.error('Create contract remark error:', error)
    return res.status(500).json({ success: false, error: { message: 'Failed to create comment' } })
  }
}

