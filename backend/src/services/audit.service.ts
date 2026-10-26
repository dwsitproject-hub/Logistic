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
    /** One value or several (any of them matches). */
    action?: string | string[];
    entityType?: string | string[];
    /** Free text: user name, username, the entity id, or anything in after_data (PO, file name, ...). */
    search?: string;
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

      const list = (value: string | string[] | undefined) =>
        (Array.isArray(value) ? value : value ? String(value).split(',') : []).map((v) => v.trim()).filter(Boolean);

      const actions = list(filters.action);
      if (actions.length) {
        whereConditions.push(`a.action = ANY($${paramIndex}::text[])`);
        params.push(actions);
        paramIndex++;
      }

      const entityTypes = list(filters.entityType);
      if (entityTypes.length) {
        whereConditions.push(`a.entity_type = ANY($${paramIndex}::text[])`);
        params.push(entityTypes);
        paramIndex++;
      }

      if (filters.search?.trim()) {
        whereConditions.push(`(
          u.full_name ILIKE $${paramIndex}
          OR u.username ILIKE $${paramIndex}
          OR a.entity_id::text ILIKE $${paramIndex}
          OR a.after_data::text ILIKE $${paramIndex}
        )`);
        params.push(`%${filters.search.trim()}%`);
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
        `SELECT COUNT(*) as total FROM audit_logs a LEFT JOIN users u ON a.user_id = u.id ${whereClause}`,
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


