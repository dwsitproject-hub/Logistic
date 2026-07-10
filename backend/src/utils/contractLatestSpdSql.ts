/**
 * Latest sap_processed_data row per contract — same rules as Contracts list `latest_spd` CTE.
 */

export type LatestSpdContractFilter =
  | { kind: 'join_scope'; scopeCteName: string }
  | { kind: 'in_subquery'; subquery: string };

function sqlLatestSpdScopeJoin(filter: LatestSpdContractFilter, spdAlias = 'spd'): string {
  if (filter.kind === 'join_scope') {
    return `INNER JOIN ${filter.scopeCteName} cs ON cs.contract_id = ${spdAlias}.contract_number`;
  }
  return '';
}

function sqlLatestSpdScopeWhere(filter: LatestSpdContractFilter, spdAlias = 'spd'): string {
  if (filter.kind === 'in_subquery') {
    return `AND ${spdAlias}.contract_number IN (${filter.subquery})`;
  }
  return '';
}

/** Live latest_spd CTE — scoped to contract list filter. */
export function buildLatestSpdCte(filter: LatestSpdContractFilter): string {
  const join = sqlLatestSpdScopeJoin(filter);
  const extraWhere = sqlLatestSpdScopeWhere(filter);

  return `
      latest_spd AS (
        SELECT DISTINCT ON (spd.contract_number)
          spd.contract_number,
          spd.data,
          spd.created_at
        FROM sap_processed_data spd
        ${join}
        WHERE spd.contract_number IS NOT NULL AND TRIM(spd.contract_number) != ''
          ${extraWhere}
        ORDER BY spd.contract_number, spd.created_at DESC NULLS LAST, spd.id DESC
      )`;
}

/** Fast read path: join pre-computed snapshot scoped to list CTE (same columns as latest_spd). */
export function buildLatestSpdFromSnapshotCte(scopeCteName = 'contract_scope'): string {
  return `
      latest_spd AS (
        SELECT
          s.contract_number,
          s.data,
          s.spd_created_at AS created_at
        FROM contract_latest_spd_snapshot s
        INNER JOIN ${scopeCteName} cs ON cs.contract_id = s.contract_number
      )`;
}

export function buildContractLatestSpdSnapshotRefreshSql(): string {
  return `
    INSERT INTO contract_latest_spd_snapshot (
      contract_number,
      data,
      spd_created_at,
      refreshed_at
    )
    SELECT DISTINCT ON (spd.contract_number)
      spd.contract_number,
      spd.data,
      spd.created_at,
      NOW()
    FROM sap_processed_data spd
    WHERE spd.contract_number IS NOT NULL AND TRIM(spd.contract_number) != ''
    ORDER BY spd.contract_number, spd.created_at DESC NULLS LAST, spd.id DESC
    ON CONFLICT (contract_number) DO UPDATE SET
      data = EXCLUDED.data,
      spd_created_at = EXCLUDED.spd_created_at,
      refreshed_at = EXCLUDED.refreshed_at`;
}

export function buildContractLatestSpdSnapshotUpsertSql(): string {
  return `
    INSERT INTO contract_latest_spd_snapshot (
      contract_number,
      data,
      spd_created_at,
      refreshed_at
    )
    SELECT DISTINCT ON (spd.contract_number)
      spd.contract_number,
      spd.data,
      spd.created_at,
      NOW()
    FROM sap_processed_data spd
    WHERE spd.contract_number IS NOT NULL
      AND TRIM(spd.contract_number) != ''
      AND spd.contract_number = ANY($1::text[])
    ORDER BY spd.contract_number, spd.created_at DESC NULLS LAST, spd.id DESC
    ON CONFLICT (contract_number) DO UPDATE SET
      data = EXCLUDED.data,
      spd_created_at = EXCLUDED.spd_created_at,
      refreshed_at = EXCLUDED.refreshed_at`;
}
