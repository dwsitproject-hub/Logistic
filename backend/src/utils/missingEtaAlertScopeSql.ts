import { groupPlantExpr } from './groupPlantSql';
import { normalizeRoleLevel } from './rolePermissionScope';
import type { SessionUserPayload } from '../services/sessionAuth.service';
import { canonicalizeUserRegionSites } from './userRegionSite';

export interface MissingEtaAlertScopeClause {
  sql: string;
  params: unknown[];
}

const GROUP_PLANT = groupPlantExpr('c.plant_code', 'c.company_name');

function isStaffLevel(level: string | null | undefined): boolean {
  return normalizeRoleLevel(level) === 'Staff';
}

/**
 * Build contract-level WHERE fragments for missing-ETA alert queries.
 *
 * - Non-Staff (Dept Head / Section Head / Admin / null): no plant/product/transport narrowing
 * - Staff: optional filters when user fields are populated (transport_type, group_plants, products)
 */
export function buildMissingEtaAlertScopeClause(user: SessionUserPayload): MissingEtaAlertScopeClause {
  if (!isStaffLevel(user.level)) {
    return { sql: '', params: [] };
  }

  const parts: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  const transport = String(user.transport_type ?? '').trim().toUpperCase();
  if (transport && transport !== 'ALL') {
    parts.push(`UPPER(TRIM(COALESCE(c.transport_mode, ''))) LIKE $${paramIndex}::text`);
    params.push(`${transport}%`);
    paramIndex += 1;
  }

  const groupPlants = canonicalizeUserRegionSites(user.group_plants ?? []);
  if (groupPlants.length > 0) {
    const placeholders = groupPlants.map((_, i) => `UPPER($${paramIndex + i})`).join(', ');
    parts.push(`UPPER(NULLIF(TRIM(${GROUP_PLANT}), 'Blank')) IN (${placeholders})`);
    params.push(...groupPlants);
    paramIndex += groupPlants.length;
  }

  const products = (user.products ?? []).map((p) => String(p).trim()).filter(Boolean);
  if (products.length > 0) {
    parts.push(`TRIM(COALESCE(c.product::text, '')) = ANY($${paramIndex}::text[])`);
    params.push(products);
    paramIndex += 1;
  }

  if (parts.length === 0) {
    return { sql: '', params: [] };
  }

  return {
    sql: ` AND (${parts.join(' AND ')})`,
    params,
  };
}

/** Roles that always see the header bell (non-staff sees all units in their role domain). */
export function roleMaySeeMissingEtaBell(role: string | null | undefined): boolean {
  const r = String(role ?? '').trim().toUpperCase();
  return ['LOGISTICS', 'TRADING', 'ADMIN', 'MANAGEMENT'].includes(r);
}

/** Permission keys that also grant bell visibility for other roles. */
export const MISSING_ETA_BELL_PERMISSION_KEYS = ['page.shipments', 'page.trucking'] as const;
