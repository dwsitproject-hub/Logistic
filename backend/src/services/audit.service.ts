import { query } from '../database/connection';
import logger from '../utils/logger';

interface AuditLogData {
  userId: string;
  action: string;
  entityType: string;
  entityId?: string;
  beforeData?: any;
  afterData?: any;
  ipAddress?: string;
  userAgent?: string;
}

export class AuditService {
  /**
   * Create an audit log entry
   */
  static async log(data: AuditLogData): Promise<void> {
    try {
      await query(
        `INSERT INTO audit_logs (
          user_id, action, entity_type, entity_id, 
          before_data, after_data, ip_address, user_agent
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          data.userId,
          data.action,
          data.entityType,
          data.entityId || null,
          data.beforeData ? JSON.stringify(data.beforeData) : null,
          data.afterData ? JSON.stringify(data.afterData) : null,
          data.ipAddress || null,
          data.userAgent || null
        ]
      );
      
      logger.info(`Audit log created: ${data.action} on ${data.entityType}`, {
        userId: data.userId,
        entityId: data.entityId
      });
    } catch (error) {
      logger.error('Failed to create audit log:', error);
      // Don't throw error to avoid breaking the main operation
    }
  }

  /**
   * Get audit logs with filters
   */
  static async getLogs(filters: {
    userId?: string;
    action?: string;
    entityType?: string;
    dateFrom?: string;
    dateTo?: string;
    limit?: number;
    offset?: number;
  }) {
    try {
      const params: any[] = [];
      let paramIndex = 1;
      let whereConditions = [];

      if (filters.userId) {
        whereConditions.push(`a.user_id = $${paramIndex}`);
        params.push(filters.userId);
        paramIndex++;
      }

      if (filters.action) {
        whereConditions.push(`a.action = $${paramIndex}`);
        params.push(filters.action);
        paramIndex++;
      }

      if (filters.entityType) {
        whereConditions.push(`a.entity_type = $${paramIndex}`);
        params.push(filters.entityType);
        paramIndex++;
      }

      if (filters.dateFrom) {
        whereConditions.push(`a.timestamp >= $${paramIndex}`);
        params.push(filters.dateFrom);
        paramIndex++;
      }

      if (filters.dateTo) {
        whereConditions.push(`a.timestamp <= $${paramIndex}`);
        params.push(filters.dateTo);
        paramIndex++;
      }

      const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';
      const limit = filters.limit || 100;
      const offset = filters.offset || 0;

      const result = await query(
        `SELECT 
          a.id,
          a.user_id,
          u.username,
          u.full_name,
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
        ${whereClause}
        ORDER BY a.timestamp DESC
        LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
        [...params, limit, offset]
      );

      // Get total count
      const countResult = await query(
        `SELECT COUNT(*) as total FROM audit_logs a ${whereClause}`,
        params
      );

      return {
        logs: result.rows,
        total: parseInt(countResult.rows[0].total),
        limit,
        offset
      };
    } catch (error) {
      logger.error('Failed to fetch audit logs:', error);
      throw error;
    }
  }
}


