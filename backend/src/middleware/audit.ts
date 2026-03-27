import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth';
import { AuditService } from '../services/audit.service';

/**
 * Middleware to automatically log create, update, delete actions
 */
export const auditLog = (action: string, entityType: string) => {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    const originalSend = res.json;
    const userId = req.user?.id;
    const ipAddress = req.ip || req.connection.remoteAddress;
    const userAgent = req.get('user-agent');

    // Store request body for 'before' data on updates (only fields the client attempted to change)
    const beforeData =
      req.method === 'PUT' || req.method === 'PATCH'
        ? (req.body && typeof req.body === 'object' ? { ...req.body } : {})
        : undefined;

    // Override res.json to capture response data
    res.json = function (body: any) {
      // Only log if operation was successful
      if (body.success) {
        const entityId = body.data?.id || req.params.id || body.data?.contract_id || body.data?.shipment_id;
        
        // Determine after data based on action
        let afterData = undefined;
        if (action === 'CREATE' || action === 'UPDATE') {
          // For UPDATE, avoid dumping the full row into audit logs.
          // Only include the fields that were provided in the request body so Activity Log shows true changes.
          if (action === 'UPDATE' && beforeData && typeof beforeData === 'object' && body.data && typeof body.data === 'object') {
            const keys = Object.keys(beforeData as Record<string, unknown>);
            const picked: Record<string, unknown> = {};
            keys.forEach((k) => {
              picked[k] = (body.data as any)[k];
            });
            afterData = picked;
          } else {
            afterData = body.data;
          }
        }

        // Log the audit entry (non-blocking)
        if (userId) {
          AuditService.log({
            userId,
            action,
            entityType,
            entityId,
            beforeData,
            afterData,
            ipAddress,
            userAgent
          }).catch(err => {
            console.error('Audit log failed:', err);
          });
        }
      }

      // Call original json method
      return originalSend.call(this, body);
    };

    next();
  };
};

/**
 * Manual audit logging function for complex operations
 */
export const logAudit = async (
  req: AuthRequest,
  action: string,
  entityType: string,
  entityId?: string,
  beforeData?: any,
  afterData?: any
) => {
  const userId = req.user?.id;
  if (!userId) return;

  const ipAddress = req.ip || req.connection.remoteAddress;
  const userAgent = req.get('user-agent');

  await AuditService.log({
    userId,
    action,
    entityType,
    entityId,
    beforeData,
    afterData,
    ipAddress,
    userAgent
  });
};


