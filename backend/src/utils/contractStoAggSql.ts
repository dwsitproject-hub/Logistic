/**
 * Contract STO aggregation from sap_processed_data — same rules as Contracts list `sto_agg` CTE.
 */

export type StoAggContractFilter =
  | { kind: 'join_scope'; scopeCteName: string }
  | { kind: 'in_subquery'; subquery: string };

function sqlEffectiveStoExpr(spdAlias = 'spd'): string {
  return `NULLIF(TRIM(COALESCE(
    ${spdAlias}.sto_number::text,
    ${spdAlias}.data->'raw'->>'STO No.',
    ${spdAlias}.data->'raw'->>'STO Number',
    ${spdAlias}.data->'shipment'->>'sto_no',
    ${spdAlias}.data->'contract'->>'sto_no'
  )), '')`;
}

function sqlStoQuantityNumExpr(spdAlias = 'spd'): string {
  return `CAST(REPLACE(REPLACE(COALESCE(${spdAlias}.data->'contract'->>'sto_quantity', '0'), ',', ''), ' ', '') AS NUMERIC)`;
}

function sqlStoAggScopeJoin(filter: StoAggContractFilter, spdAlias = 'spd'): string {
  if (filter.kind === 'join_scope') {
    return `INNER JOIN ${filter.scopeCteName} cs ON cs.contract_id = ${spdAlias}.contract_number`;
  }
  return '';
}

function sqlStoAggScopeWhere(filter: StoAggContractFilter, spdAlias = 'spd'): string {
  if (filter.kind === 'in_subquery') {
    return `AND ${spdAlias}.contract_number IN (${filter.subquery})`;
  }
  return '';
}

function sqlStoAggHasStoWhere(spdAlias = 'spd'): string {
  const effectiveSto = sqlEffectiveStoExpr(spdAlias);
  return `(
    (${spdAlias}.sto_number IS NOT NULL AND ${spdAlias}.sto_number::text != '')
    OR ${effectiveSto} IS NOT NULL
  )
  AND ${spdAlias}.data->'contract'->>'sto_quantity' IS NOT NULL`;
}

/** Live sto_agg CTE — scoped to contract list filter. */
export function buildStoAggCte(filter: StoAggContractFilter): string {
  const join = sqlStoAggScopeJoin(filter);
  const extraWhere = sqlStoAggScopeWhere(filter);
  const effectiveSto = sqlEffectiveStoExpr('spd');
  const stoQtyNum = sqlStoQuantityNumExpr('spd');
  const hasSto = sqlStoAggHasStoWhere('spd');

  return `
      sto_agg AS (
        SELECT x.contract_number,
          STRING_AGG(DISTINCT x.effective_sto, ', ' ORDER BY x.effective_sto) AS sto_numbers,
          SUM(x.sto_quantity_num) AS total_sto_quantity,
          COUNT(DISTINCT x.effective_sto)::int AS sto_count
        FROM (
          SELECT DISTINCT ON (spd.contract_number, effective_sto)
            spd.contract_number,
            effective_sto,
            sto_quantity_num
          FROM (
            SELECT spd.contract_number,
              ${effectiveSto} AS effective_sto,
              ${stoQtyNum} AS sto_quantity_num,
              spd.created_at
            FROM sap_processed_data spd
            ${join}
            WHERE spd.contract_number IS NOT NULL AND TRIM(spd.contract_number) != ''
              ${extraWhere}
              AND ${hasSto}
          ) spd
          WHERE effective_sto IS NOT NULL AND effective_sto != ''
          ORDER BY contract_number, effective_sto, created_at DESC NULLS LAST
        ) x
        GROUP BY x.contract_number
      )`;
}

/** Fast read path: join pre-computed snapshot scoped to list CTE (same columns as sto_agg). */
export function buildStoAggFromSnapshotCte(scopeCteName = 'contract_scope'): string {
  return `
      sto_agg AS (
        SELECT
          s.contract_number,
          s.sto_numbers,
          s.total_sto_quantity,
          s.sto_count
        FROM contract_sto_agg_snapshot s
        INNER JOIN ${scopeCteName} cs ON cs.contract_id = s.contract_number
      )`;
}

export function buildContractStoAggSnapshotRefreshSql(): string {
  return `
    WITH ${buildStoAggCte({ kind: 'in_subquery', subquery: 'SELECT contract_id FROM contracts' })}
    INSERT INTO contract_sto_agg_snapshot (
      contract_number,
      sto_numbers,
      total_sto_quantity,
      sto_count,
      refreshed_at
    )
    SELECT
      sa.contract_number,
      sa.sto_numbers,
      COALESCE(sa.total_sto_quantity, 0),
      COALESCE(sa.sto_count, 0),
      NOW()
    FROM sto_agg sa
    WHERE sa.contract_number IS NOT NULL
    ON CONFLICT (contract_number) DO UPDATE SET
      sto_numbers = EXCLUDED.sto_numbers,
      total_sto_quantity = EXCLUDED.total_sto_quantity,
      sto_count = EXCLUDED.sto_count,
      refreshed_at = EXCLUDED.refreshed_at`;
}

export function buildContractStoAggSnapshotUpsertSql(): string {
  return `
    WITH ${buildStoAggCte({ kind: 'in_subquery', subquery: 'SELECT contract_id FROM contracts WHERE contract_id = ANY($1)' })}
    INSERT INTO contract_sto_agg_snapshot (
      contract_number,
      sto_numbers,
      total_sto_quantity,
      sto_count,
      refreshed_at
    )
    SELECT
      sa.contract_number,
      sa.sto_numbers,
      COALESCE(sa.total_sto_quantity, 0),
      COALESCE(sa.sto_count, 0),
      NOW()
    FROM sto_agg sa
    WHERE sa.contract_number IS NOT NULL
    ON CONFLICT (contract_number) DO UPDATE SET
      sto_numbers = EXCLUDED.sto_numbers,
      total_sto_quantity = EXCLUDED.total_sto_quantity,
      sto_count = EXCLUDED.sto_count,
      refreshed_at = EXCLUDED.refreshed_at`;
}
