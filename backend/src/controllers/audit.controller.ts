import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { AuditService } from '../services/audit.service';
import logger from '../utils/logger';

export const getAuditLogs = async (req: AuthRequest, res: Response) => {
  try {
    const {
      userId,
      action,
      entityType,
      dateFrom,
      dateTo,
      page = 1,
      limit = 50
    } = req.query;

    const offset = (Number(page) - 1) * Number(limit);

    const result = await AuditService.getLogs({
      userId: userId as string,
      action: action as string,
      entityType: entityType as string,
      dateFrom: dateFrom as string,
      dateTo: dateTo as string,
      limit: Number(limit),
      offset
    });

    return res.json({
      success: true,
      data: {
        logs: result.logs,
        pagination: {
          total: result.total,
          page: Number(page),
          limit: Number(limit),
          totalPages: Math.ceil(result.total / Number(limit))
        }
      }
    });
  } catch (error) {
    logger.error('Get audit logs error:', error);
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch audit logs' }
    });
  }
};

export const getAuditLogStats = async (_req: AuthRequest, res: Response) => {
  try {
    const { query } = await import('../database/connection');
    
    // Get statistics
    const stats = await query(`
      SELECT 
        COUNT(*) as total_logs,
        COUNT(DISTINCT user_id) as unique_users,
        COUNT(DISTINCT entity_type) as entity_types,
        COUNT(*) FILTER (WHERE timestamp >= NOW() - INTERVAL '24 hours') as logs_last_24h,
        COUNT(*) FILTER (WHERE timestamp >= NOW() - INTERVAL '7 days') as logs_last_7days
      FROM audit_logs
    `);

    // Get top actions
    const topActions = await query(`
      SELECT action, COUNT(*) as count
      FROM audit_logs
      GROUP BY action
      ORDER BY count DESC
      LIMIT 5
    `);

    // Get top users
    const topUsers = await query(`
      SELECT 
        u.username,
        u.full_name,
        u.role,
        COUNT(a.id) as action_count
      FROM audit_logs a
      LEFT JOIN users u ON a.user_id = u.id
      GROUP BY u.id, u.username, u.full_name, u.role
      ORDER BY action_count DESC
      LIMIT 5
    `);

    // Get activity by entity type
    const entityActivity = await query(`
      SELECT entity_type, COUNT(*) as count
      FROM audit_logs
      GROUP BY entity_type
      ORDER BY count DESC
    `);

    return res.json({
      success: true,
      data: {
        stats: stats.rows[0],
        topActions: topActions.rows,
        topUsers: topUsers.rows,
        entityActivity: entityActivity.rows
      }
    });
  } catch (error) {
    logger.error('Get audit log stats error:', error);
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch audit log statistics' }
    });
  }
};

export const getAuditLogDetail = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { query } = await import('../database/connection');

    const result = await query(
      `SELECT 
        a.id,
        a.user_id,
        u.username,
        u.full_name,
        u.email,
        u.role,
        a.action,
        a.entity_type,
        a.entity_id,
        a.before_data,
        a.after_data,
        a.ip_address,
        a.user_agent,
        a.timestamp
      FROM audit_logs a
      LEFT JOIN users u ON a.user_id = u.id
      WHERE a.id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: { message: 'Audit log not found' }
      });
    }

    return res.json({
      success: true,
      data: result.rows[0]
    });
  } catch (error) {
    logger.error('Get audit log detail error:', error);
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch audit log detail' }
    });
  }
};


