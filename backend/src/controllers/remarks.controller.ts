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

export const getShipmentRemarks = async (req: AuthRequest, res: Response) => {
  try {
    const shipmentId = String(req.params.id || '').trim()
    if (!shipmentId) {
      return res.status(400).json({ success: false, error: { message: 'Shipment id is required' } })
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
      WHERE r.related_entity_type = 'SHIPMENT'
        AND r.related_entity_id = $1::uuid
      ORDER BY r.created_at DESC NULLS LAST
      `,
      [shipmentId],
    )

    return res.json({ success: true, data: result.rows })
  } catch (error) {
    logger.error('Get shipment remarks error:', error)
    return res.status(500).json({ success: false, error: { message: 'Failed to load remarks' } })
  }
}

export const createShipmentRemark = async (req: AuthRequest, res: Response) => {
  try {
    const shipmentId = String(req.params.id || '').trim()
    const text = String(req.body?.text || '').trim()
    const category = req.body?.category != null ? String(req.body.category).trim() : 'EDIT_SHIPMENT'
    const userId = req.user?.id

    if (!shipmentId) {
      return res.status(400).json({ success: false, error: { message: 'Shipment id is required' } })
    }
    if (!text) {
      return res.status(400).json({ success: false, error: { message: 'Remark text is required' } })
    }
    if (!userId) {
      return res.status(401).json({ success: false, error: { message: 'Unauthorized' } })
    }

    const exists = await query(`SELECT id FROM shipments WHERE id = $1::uuid LIMIT 1`, [shipmentId])
    if (exists.rows.length === 0) {
      return res.status(404).json({ success: false, error: { message: 'Shipment not found' } })
    }

    const result = await query(
      `
      INSERT INTO remarks (text, category, related_entity_type, related_entity_id, created_by)
      VALUES ($1, $2, 'SHIPMENT', $3::uuid, $4::uuid)
      RETURNING id, text, category, related_entity_type, related_entity_id, created_at, updated_at
      `,
      [text, category, shipmentId, userId],
    )

    return res.json({ success: true, data: result.rows[0] })
  } catch (error) {
    logger.error('Create shipment remark error:', error)
    return res.status(500).json({ success: false, error: { message: 'Failed to create remark' } })
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

