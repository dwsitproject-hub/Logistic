import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import logger from '../utils/logger';
import {
  buildSessionUserPayload,
  loadActiveUserById,
} from '../services/sessionAuth.service';
import { findMissingEtaAlertUnits } from '../utils/missingEtaAlertSql';
import {
  buildMissingEtaAlertScopeClause,
  MISSING_ETA_BELL_PERMISSION_KEYS,
  roleMaySeeMissingEtaBell,
} from '../utils/missingEtaAlertScopeSql';
import { query } from '../database/connection';
import { runContractEtaReminderJob } from '../services/contractEtaReminder.service';

async function userHasAnyBellPermission(userId: string, roleName: string): Promise<boolean> {
  if (roleMaySeeMissingEtaBell(roleName)) return true;
  const result = await query(
    `SELECT EXISTS (
       SELECT 1
       FROM roles r
       JOIN permissions p ON p.permission_key = ANY($3::text[])
       LEFT JOIN LATERAL (
         SELECT rp.can_view
         FROM role_permissions rp
         JOIN users u ON u.id = $1
         WHERE rp.role_id = r.id
           AND rp.permission_id = p.id
           AND (
             rp.level IS NULL
             OR (
               u.level IS NOT NULL
               AND UPPER(TRIM(rp.level)) = UPPER(TRIM(u.level))
             )
           )
           AND (
             rp.transport_type IS NULL
             OR (
               u.transport_type IS NOT NULL
               AND UPPER(TRIM(rp.transport_type)) = UPPER(TRIM(u.transport_type))
             )
           )
         ORDER BY
           CASE WHEN rp.level IS NULL THEN 0 ELSE 1 END DESC,
           CASE WHEN rp.transport_type IS NULL THEN 0 ELSE 1 END DESC
         LIMIT 1
       ) scoped ON true
       WHERE r.role_name = $2
         AND r.is_active = true
         AND COALESCE(scoped.can_view, false) = true
     ) AS allowed`,
    [userId, roleName, [...MISSING_ETA_BELL_PERMISSION_KEYS]],
  );
  return !!result.rows[0]?.allowed;
}

/**
 * GET /api/alerts/missing-eta-cargo-readiness
 * Role-scoped count + list of alert units (STO/shipment/op or contract-level).
 */
export const getMissingEtaCargoReadinessAlerts = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const userId = req.user?.id;
    const role = req.user?.role;
    if (!userId || !role) {
      res.status(401).json({ success: false, error: { message: 'Unauthorized' } });
      return;
    }

    const allowed = await userHasAnyBellPermission(userId, role);
    if (!allowed) {
      res.json({
        success: true,
        data: { total: 0, items: [], scopedAsStaff: false, visible: false },
      });
      return;
    }

    const userRow = await loadActiveUserById(userId);
    if (!userRow) {
      res.status(404).json({ success: false, error: { message: 'User not found' } });
      return;
    }

    const sessionUser = await buildSessionUserPayload(userRow);
    const scope = buildMissingEtaAlertScopeClause(sessionUser);
    const { total, items } = await findMissingEtaAlertUnits(scope.sql, scope.params, 50);

    res.json({
      success: true,
      data: {
        total,
        items,
        scopedAsStaff: String(sessionUser.level ?? '').trim().toLowerCase() === 'staff',
        visible: true,
      },
    });
  } catch (error) {
    logger.error('getMissingEtaCargoReadinessAlerts error:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch missing ETA alerts' },
    });
  }
};

/**
 * POST /api/alerts/contract-eta-reminder/run
 * Admin-only manual trigger for the daily Contract ETA reminder email (testing/UAT).
 * Body (optional): { to?: string[], recipientsOnly?: boolean }
 */
export const runContractEtaReminderAlerts = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const body = (req.body ?? {}) as { to?: unknown; recipientsOnly?: unknown };
    const to = Array.isArray(body.to)
      ? body.to.map((email) => String(email).trim()).filter(Boolean)
      : typeof body.to === 'string'
        ? body.to.split(/[,;]/).map((email) => email.trim()).filter(Boolean)
        : undefined;
    const recipientsOnly = body.recipientsOnly === true;

    const result = await runContractEtaReminderJob({
      overrideRecipients: to,
      recipientsOnly: recipientsOnly && !!to?.length,
    });

    res.json({ success: true, data: result });
  } catch (error) {
    logger.error('runContractEtaReminderAlerts error:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to run contract ETA reminder job' },
    });
  }
};
