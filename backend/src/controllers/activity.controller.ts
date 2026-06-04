import { Response } from 'express';
import { query } from '../database/connection';
import { AuthRequest } from '../middleware/auth';
import logger from '../utils/logger';

/**
 * Map first URL segment (e.g. "contracts" from /contracts) to audit entity_type values.
 * null = no filter (all entity types).
 */
const PAGE_ENTITY_TYPES: Record<string, string[] | null> = {
  dashboard: [
    'CONTRACT',
    'SHIPMENT',
    'TRUCKING_OPERATION',
    'PAYMENT',
    'DOCUMENT',
    'LOADING_PORT',
    'STO_QTY_ASSIGNED',
  ],
  contracts: ['CONTRACT'],
  shipments: ['SHIPMENT', 'LOADING_PORT', 'STO_QTY_ASSIGNED'],
  trucking: ['TRUCKING_OPERATION'],
  finance: ['PAYMENT'],
  documents: ['DOCUMENT'],
  users: ['USER'],
  audit: null,
  'sap-imports': null,
  'sap-master-v2': null,
  'excel-import': null,
  supplier: ['CONTRACT', 'SHIPMENT'],
  'customer-360': ['CONTRACT', 'SHIPMENT'],
  'customer-360-company': ['CONTRACT'],
  'master-product-configuration': null,
  'master-vessel': null,
  'master-loading-port': null,
};

function resolveEntityTypes(pageKey: string): string[] | null {
  const k = pageKey.trim().toLowerCase();
  if (k in PAGE_ENTITY_TYPES) return PAGE_ENTITY_TYPES[k];
  return null;
}

/** Recent audit activity for the current "page" (top 20). All authenticated roles. */
export const getRecentPageActivity = async (req: AuthRequest, res: Response) => {
  try {
    const raw = String(req.query.page || 'dashboard').trim();
    const segment = raw.replace(/^\//, '').split('/')[0] || 'dashboard';
    const entityTypes = resolveEntityTypes(segment);

    let sql = `
      SELECT
        a.id,
        a.action,
        a.entity_type,
        a.entity_id,
        a.timestamp,
        COALESCE(u.username, '') AS username,
        COALESCE(u.full_name, '') AS full_name
      FROM audit_logs a
      LEFT JOIN users u ON a.user_id = u.id
    `;
    const params: unknown[] = [];

    if (entityTypes !== null && entityTypes.length > 0) {
      sql += ` WHERE a.entity_type = ANY($1::text[])`;
      params.push(entityTypes);
    }

    sql += ` ORDER BY a.timestamp DESC LIMIT 20`;

    const result = await query(sql, params);

    return res.json({
      success: true,
      data: {
        pageKey: segment,
        logs: result.rows,
      },
    });
  } catch (error) {
    logger.error('Get recent page activity error:', error);
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to load recent activity' },
    });
  }
};
