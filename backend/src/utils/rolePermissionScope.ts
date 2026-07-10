export const VALID_ROLE_LEVELS = ['Dept Head', 'Section Head', 'Staff', 'Admin'] as const;
export const VALID_ROLE_TRANSPORT_TYPES = ['SEA', 'LAND', 'ALL', 'MIX'] as const;

export type RoleLevel = (typeof VALID_ROLE_LEVELS)[number];
export type RoleTransportType = (typeof VALID_ROLE_TRANSPORT_TYPES)[number];

export interface ParsedRoleScope {
  level: RoleLevel | null;
  transportType: RoleTransportType | null;
}

export function normalizeRoleLevel(value: unknown): RoleLevel | null {
  if (value == null || String(value).trim() === '') return null;
  const raw = String(value).trim();
  const match = VALID_ROLE_LEVELS.find((level) => level.toUpperCase() === raw.toUpperCase());
  return match ?? null;
}

export function normalizeRoleTransportType(value: unknown): RoleTransportType | null {
  if (value == null || String(value).trim() === '') return null;
  const raw = String(value).trim().toUpperCase();
  return VALID_ROLE_TRANSPORT_TYPES.includes(raw as RoleTransportType)
    ? (raw as RoleTransportType)
    : null;
}

export function parseRoleScopeQuery(query: {
  level?: unknown;
  transportType?: unknown;
}): { scope: ParsedRoleScope; error?: string } {
  const hasLevel = query.level != null && String(query.level).trim() !== '';
  const hasTransport =
    query.transportType != null && String(query.transportType).trim() !== '';

  const level = hasLevel ? normalizeRoleLevel(query.level) : null;
  if (hasLevel && !level) {
    return {
      scope: { level: null, transportType: null },
      error: `Invalid level. Allowed: ${VALID_ROLE_LEVELS.join(', ')}`,
    };
  }

  const transportType = hasTransport ? normalizeRoleTransportType(query.transportType) : null;
  if (hasTransport && !transportType) {
    return {
      scope: { level: null, transportType: null },
      error: `Invalid transport type. Allowed: ${VALID_ROLE_TRANSPORT_TYPES.join(', ')}`,
    };
  }

  return { scope: { level, transportType } };
}

/** Admin role editor: level is mandatory; transport remains optional (all transport = unscoped). */
export function parseAdminRoleScopeQuery(query: {
  level?: unknown;
  transportType?: unknown;
}): { scope: ParsedRoleScope; error?: string } {
  const hasLevel = query.level != null && String(query.level).trim() !== '';
  if (!hasLevel) {
    return {
      scope: { level: null, transportType: null },
      error: `Level is required. Choose one of: ${VALID_ROLE_LEVELS.join(', ')}`,
    };
  }
  return parseRoleScopeQuery(query);
}

/** SQL for LATERAL join: pick the most specific matching role_permissions row for a user/query scope. */
export const ROLE_PERMISSION_LATERAL_MATCH_SQL = `
  AND (
    rp.level IS NULL
    OR (
      $LEVEL::text IS NOT NULL
      AND UPPER(TRIM(rp.level)) = UPPER(TRIM($LEVEL::text))
    )
  )
  AND (
    rp.transport_type IS NULL
    OR (
      $TRANSPORT::text IS NOT NULL
      AND UPPER(TRIM(rp.transport_type)) = UPPER(TRIM($TRANSPORT::text))
    )
  )
`;

export const ROLE_PERMISSION_LATERAL_ORDER_SQL = `
  ORDER BY
    CASE WHEN rp.level IS NULL THEN 0 ELSE 1 END DESC,
    CASE WHEN rp.transport_type IS NULL THEN 0 ELSE 1 END DESC
  LIMIT 1
`;

/** Delete only rows for the exact admin-selected scope (no cross-level / cross-transport deletes). */
export const DELETE_ROLE_PERMISSIONS_EXACT_SCOPE_SQL = `
  DELETE FROM role_permissions
  WHERE role_id = $1
    AND (
      ($2::text IS NULL AND level IS NULL)
      OR (
        $2::text IS NOT NULL
        AND level IS NOT NULL
        AND UPPER(TRIM(level)) = UPPER(TRIM($2::text))
      )
    )
    AND (
      ($3::text IS NULL AND transport_type IS NULL)
      OR (
        $3::text IS NOT NULL
        AND transport_type IS NOT NULL
        AND UPPER(TRIM(transport_type)) = UPPER(TRIM($3::text))
      )
    )
`;

export function formatRoleScopeLabel(scope: ParsedRoleScope): string {
  return [
    `level=${scope.level ?? 'all'}`,
    `transport=${scope.transportType ?? 'all'}`,
  ].join(', ');
}
