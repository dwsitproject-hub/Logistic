/**
 * Trucking page — Unplanned hybrid list (open PO backlog + trucking execution rows).
 */

import { sqlIsContractSapClosedExpr, SQL_CONTRACT_IMPORT_STATUS } from './contractDeliveryStatus';
import { buildQtyMoveCte, sqlContractGlobalOutstandingExpr } from './contractGlobalOutstandingSql';
import { parseColumnFiltersQuery, type ColumnFilterPayload } from './contractListFilters';
import { appendGroupPlantFilter, groupPlantExpr } from './groupPlantSql';
import {
  sqlPipelineIncotermKey,
  sqlPipelineProductKey,
} from './pipelineDailySummaryToolbarScope';
import { contractExtNoSubquery } from './portDisplaySql';
import { buildTruckingPageIncotermScopeSql } from './truckingIncotermScope';

const CB_COL: Record<string, string> = {
  contract_number: 'c.contract_id',
  po_number: 'c.po_number',
  supplier: 'c.supplier',
  buyer: 'c.buyer',
  product: 'c.product',
  group_name: 'c.group_name',
  incoterm: 'c.incoterm',
  contract_date: 'c.contract_date',
  delivery_start_date: 'c.delivery_start_date',
  delivery_end_date: 'c.delivery_end_date',
  created_at: 'c.created_at',
  status: `'UNPLANNED'`,
};

export function buildTruckingUnplannedBacklogLatestSpdCte(): string {
  return `
      latest_spd_contract AS (
        SELECT DISTINCT ON (spd.contract_number)
          spd.contract_number,
          COALESCE(
            spd.data->'contract'->>'contract_type',
            spd.data->>'B2B Flag',
            spd.data->'raw'->>'B2B Flag',
            spd.data->>'Contract Type'
          ) AS b2b_flag_raw,
          COALESCE(
            spd.data->'contract'->>'contract_reference_po',
            spd.data->>'CONTRACT REFF PO',
            spd.data->>'Contract Reff PO Ini',
            spd.data->'raw'->>'Contract Reff PO Ini',
            spd.data->'raw'->>'CONTRACT REFF PO'
          ) AS contract_reference_po_raw,
          COALESCE(
            spd.data->'raw'->>'Contract Ext No',
            spd.data->>'Contract Ext No'
          ) AS contract_ext_no_raw,
          spd.created_at
        FROM sap_processed_data spd
        WHERE spd.contract_number IS NOT NULL AND TRIM(spd.contract_number) != ''
        ORDER BY spd.contract_number, spd.created_at DESC NULLS LAST
      )`;
}

/** Open FRC/LCO LAND/MIX contracts with no active trucking operation. */
export function truckingUnplannedContractBacklogBaseWhereSql(
  contractAlias = 'c',
  spdAlias = 'l',
): string {
  return `
    ${buildTruckingPageIncotermScopeSql(contractAlias)}
    AND UPPER(COALESCE(NULLIF(TRIM(${contractAlias}.transport_mode::text), ''), 'LAND')) IN ('LAND', 'MIX')
    AND NOT (${sqlIsContractSapClosedExpr(contractAlias)})
    AND NOT (
      ${contractAlias}.contract_id IS NOT NULL
      AND UPPER(NULLIF(TRIM(COALESCE(${spdAlias}.b2b_flag_raw, ${contractAlias}.contract_type::text, '')), '')) = 'B2B'
      AND NULLIF(TRIM(COALESCE(${spdAlias}.contract_reference_po_raw, '')), '') IS NOT NULL
    )
    AND NOT EXISTS (
      SELECT 1
      FROM trucking_operations t_ns
      WHERE t_ns.contract_id = ${contractAlias}.id
        AND COALESCE(t_ns.status, '') <> 'CANCELLED'
    )`;
}

export function truckingUnplannedContractBacklogRowSelectSql(outstandingExpr: string): string {
  const contractExtNoExpr = `COALESCE(
    NULLIF(TRIM(COALESCE(l.contract_ext_no_raw, '')), ''),
    ${contractExtNoSubquery('c.contract_id', 'c.po_number')}
  )`;
  return `
    ('contract:' || c.id::text) AS id,
    'contract_backlog'::text AS row_kind,
    c.id AS contract_id,
    NULL::text AS operation_id,
    NULL::text AS location,
    NULL::text AS loading_location,
    NULL::text AS unloading_location,
    NULL::text AS trucking_owner,
    NULL::date AS cargo_readiness_date,
    NULL::jsonb AS daily_deliverables,
    NULL::date AS planning_start_date,
    NULL::date AS planning_end_date,
    NULL::date AS realization_start_date,
    NULL::date AS realization_end_date,
    NULL::date AS trucking_start_date,
    NULL::date AS trucking_completion_date,
    NULL::timestamptz AS eta_trucking_start_date,
    NULL::timestamptz AS eta_trucking_completion_date,
    NULL::timestamptz AS eta_delivery_start_date,
    NULL::timestamptz AS eta_delivery_end_date,
    NULL::numeric AS quantity_sent,
    NULL::numeric AS quantity_delivered,
    NULL::numeric AS quantity_receive,
    NULL::numeric AS gain_loss_percentage,
    NULL::numeric AS gain_loss_amount,
    NULL::numeric AS oa_budget,
    NULL::numeric AS oa_actual,
    NULL::text AS status_db,
    'UNPLANNED'::text AS status,
    c.created_at AS created_at,
    c.updated_at AS updated_at,
    c.contract_id AS contract_number,
    c.po_number AS po_number,
    NULL::text AS sto_number,
    NULL::text AS sto_numbers,
    c.quantity_ordered AS sto_quantity,
    c.quantity_ordered AS contract_qty,
    c.contract_date AS contract_date,
    c.delivery_start_date AS delivery_start_date,
    c.delivery_end_date AS delivery_end_date,
    c.supplier AS supplier,
    c.buyer AS buyer,
    c.product AS product,
    c.incoterm AS incoterm,
    c.group_name AS group_name,
    c.source_type AS source_type,
    ${outstandingExpr} AS outstanding_quantity,
    NULL::numeric AS estimated_km,
    ${contractExtNoExpr} AS contract_ext_no,
    ${SQL_CONTRACT_IMPORT_STATUS} AS contract_import_status`;
}

export function appendTruckingUnplannedBacklogGlobalSearch(
  searchTrim: string,
  startIndex: number,
): { sql: string; params: string[]; nextIndex: number } {
  if (!searchTrim || searchTrim.length < 2) {
    return { sql: '', params: [], nextIndex: startIndex };
  }
  const p = startIndex;
  const likeExpr = `$${p}::text`;
  const sql = `
    AND (
      COALESCE(c.contract_id::text, '') ILIKE ${likeExpr}
      OR COALESCE(c.po_number::text, '') ILIKE ${likeExpr}
      OR COALESCE(c.supplier::text, '') ILIKE ${likeExpr}
      OR COALESCE(c.product::text, '') ILIKE ${likeExpr}
      OR COALESCE(${contractExtNoSubquery('c.contract_id', 'c.po_number')}::text, '') ILIKE ${likeExpr}
      OR COALESCE(${groupPlantExpr('c.plant_code', 'c.company_name')}::text, '') ILIKE ${likeExpr}
    )`;
  return { sql, params: [`%${searchTrim}%`], nextIndex: startIndex + 1 };
}

export function appendTruckingUnplannedBacklogColumnFilters(
  filters: ColumnFilterPayload,
  startIndex: number,
): { sql: string; params: unknown[]; nextIndex: number } {
  const parts: string[] = [];
  const params: unknown[] = [];
  let pi = startIndex;

  for (const [colId, raw] of Object.entries(filters)) {
    const expr = CB_COL[colId];
    if (!expr || !raw || typeof raw !== 'object') continue;
    const f = raw as ColumnFilterPayload[string];
    if (f.emptyOnly) {
      parts.push(` AND (${expr} IS NULL OR TRIM(${expr}::text) = '')`);
      continue;
    }
    if (f.type === 'text') {
      const v = String(f.value ?? '').trim();
      if (!v) continue;
      if (f.exact) {
        parts.push(` AND LOWER(TRIM(${expr}::text)) = LOWER($${pi}::text)`);
        params.push(v);
        pi += 1;
      } else {
        parts.push(` AND ${expr}::text ILIKE $${pi}`);
        params.push(`%${v}%`);
        pi += 1;
      }
      continue;
    }
    if (f.type === 'multi') {
      const vals = Array.isArray(f.values)
        ? f.values.filter((x) => x != null && String(x).trim() !== '')
        : [];
      const incBlank = Boolean(f.includeBlank);
      const ors: string[] = [];
      if (incBlank) ors.push(`(${expr} IS NULL OR TRIM(${expr}::text) = '')`);
      if (vals.length > 0) {
        ors.push(`${expr}::text = ANY($${pi}::text[])`);
        params.push(vals);
        pi += 1;
      }
      if (ors.length > 0) parts.push(` AND (${ors.join(' OR ')})`);
    }
  }
  return { sql: parts.join(''), params, nextIndex: pi };
}

export function buildTruckingUnplannedContractToolbarScope(input: {
  dateFrom?: unknown;
  dateTo?: unknown;
  contract?: unknown;
  plants: string[];
}): { sql: string; params: unknown[] } {
  const parts: string[] = [];
  const params: unknown[] = [];
  let cp = 1;

  if (input.dateFrom) {
    parts.push(`c.contract_date >= $${cp}`);
    params.push(input.dateFrom);
    cp += 1;
  }
  if (input.dateTo) {
    parts.push(`c.contract_date <= $${cp}`);
    params.push(input.dateTo);
    cp += 1;
  }
  if (input.contract) {
    parts.push(`c.contract_id = $${cp}`);
    params.push(input.contract);
    cp += 1;
  }
  const plantFilter = appendGroupPlantFilter(
    input.plants,
    cp,
    groupPlantExpr('c.plant_code', 'c.company_name'),
    'c.plant_code',
  );
  if (plantFilter.sql) {
    parts.push(plantFilter.sql.replace(/^ AND /, ''));
    params.push(...plantFilter.params);
  }

  return {
    sql: parts.length > 0 ? ` AND ${parts.join(' AND ')}` : '',
    params,
  };
}

export function buildTruckingUnplannedBacklogCountQuery(
  contractScopeSql: string,
  toolbarSql: string,
): string {
  return `
    WITH ${buildTruckingUnplannedBacklogLatestSpdCte()},
    unplanned_trucking_backlog AS (
      SELECT c.id
      FROM contracts c
      LEFT JOIN latest_spd_contract l ON l.contract_number = c.contract_id
      WHERE ${truckingUnplannedContractBacklogBaseWhereSql('c', 'l')}
        ${contractScopeSql}
        ${toolbarSql}
    )
    SELECT COUNT(*)::bigint AS c FROM unplanned_trucking_backlog`;
}

export function buildTruckingUnplannedBacklogPageQuery(
  contractScopeSql: string,
  toolbarSql: string,
  limit: number,
  offset: number,
): string {
  const backlogWhere = `${truckingUnplannedContractBacklogBaseWhereSql('c', 'l')}${contractScopeSql}${toolbarSql}`;
  const outstandingExpr = sqlContractGlobalOutstandingExpr({
    contractQtyExpr: 'c.quantity_ordered',
    incotermExpr: 'c.incoterm',
    contractNumberExpr: 'c.contract_id',
  });
  const qtyMoveCte = buildQtyMoveCte({
    kind: 'in_subquery',
    subquery: `SELECT c.contract_id
      FROM contracts c
      LEFT JOIN latest_spd_contract l ON l.contract_number = c.contract_id
      WHERE ${backlogWhere}`,
  });
  return `
    WITH ${buildTruckingUnplannedBacklogLatestSpdCte()},
    ${qtyMoveCte},
    unplanned_trucking_backlog AS (
      SELECT ${truckingUnplannedContractBacklogRowSelectSql(outstandingExpr)}
      FROM contracts c
      LEFT JOIN latest_spd_contract l ON l.contract_number = c.contract_id
      WHERE ${backlogWhere}
      ORDER BY c.contract_date DESC NULLS LAST, c.contract_id ASC
      LIMIT ${limit} OFFSET ${offset}
    )
    SELECT * FROM unplanned_trucking_backlog`;
}

export function buildTruckingUnplannedBacklogSummaryCountQuery(
  contractScopeSql: string,
  toolbarSql: string,
): string {
  return buildTruckingUnplannedBacklogCountQuery(contractScopeSql, toolbarSql);
}

/** Daily refresh — open contract backlog grouped by group_plant + contract_date. */
export function buildTruckingUnplannedBacklogDailySummarySql(): string {
  const plant = groupPlantExpr('c.plant_code', 'c.company_name');
  return `
    INSERT INTO trucking_pipeline_daily_summary (group_plant, contract_date, product, incoterm, unplanned_contract_backlog)
    WITH ${buildTruckingUnplannedBacklogLatestSpdCte()},
    backlog AS (
      SELECT
        ${plant} AS group_plant,
        COALESCE(c.contract_date, DATE '1970-01-01')::date AS contract_date,
        ${sqlPipelineProductKey('c.product')} AS product,
        ${sqlPipelineIncotermKey('c.incoterm')} AS incoterm,
        COUNT(*)::bigint AS unplanned_contract_backlog
      FROM contracts c
      LEFT JOIN latest_spd_contract l ON l.contract_number = c.contract_id
      WHERE ${truckingUnplannedContractBacklogBaseWhereSql('c', 'l')}
      GROUP BY 1, 2, 3, 4
    )
    SELECT group_plant, contract_date, product, incoterm, unplanned_contract_backlog FROM backlog
    ON CONFLICT (group_plant, contract_date, product, incoterm) DO UPDATE SET
      unplanned_contract_backlog = EXCLUDED.unplanned_contract_backlog`;
}

export { parseColumnFiltersQuery };
