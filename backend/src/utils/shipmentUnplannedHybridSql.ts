/**
 * Shipments page — Unplanned hybrid list (contract backlog + shipment execution rows).
 */

import { sqlIsContractSapClosedExpr } from './contractDeliveryStatus';
import { appendGroupPlantFilter, groupPlantExpr } from './groupPlantSql';
import { parseColumnFiltersQuery, type ColumnFilterPayload } from './contractListFilters';
import {
  buildShipmentPageUnplannedOpenContractsCte,
  shipmentPageExcludeB2bChildCond,
  shipmentPagePipelineUnplannedRowPredicate,
  sqlContractHasNoRegisteredEtaExpr,
} from './shipmentPagePipelineSql';
import { buildShipmentSeaMixTransportSql } from './shipmentStoTypeSql';

export { buildShipmentPageUnplannedOpenContractsCte };

const CB_COL: Record<string, string> = {
  contract_numbers: 'c.contract_id',
  contract_number: 'c.contract_id',
  po_numbers: 'c.po_number',
  supplier: 'c.supplier',
  buyer: 'c.buyer',
  product: 'c.product',
  group_name: 'c.group_name',
  incoterm: 'c.incoterm',
  plant_site: groupPlantExpr('c.plant_code', 'c.company_name'),
  contract_date: 'c.contract_date',
  delivery_start: 'c.delivery_start_date',
  delivery_end: 'c.delivery_end_date',
  delivery_start_date: 'c.delivery_start_date',
  delivery_end_date: 'c.delivery_end_date',
  created_at: 'c.created_at',
  status: `'UNPLANNED'`,
};

export function appendUnplannedContractBacklogGlobalSearch(
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
      OR COALESCE(${groupPlantExpr('c.plant_code', 'c.company_name')}::text, '') ILIKE ${likeExpr}
    )`;
  return { sql, params: [`%${searchTrim}%`], nextIndex: startIndex + 1 };
}

export function appendUnplannedContractBacklogColumnFilters(
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
      if (incBlank) {
        ors.push(`(${expr} IS NULL OR TRIM(${expr}::text) = '')`);
      }
      if (vals.length > 0) {
        ors.push(`${expr}::text = ANY($${pi}::text[])`);
        params.push(vals);
        pi += 1;
      }
      if (ors.length > 0) {
        parts.push(` AND (${ors.join(' OR ')})`);
      }
    }
  }
  return { sql: parts.join(''), params, nextIndex: pi };
}

/** Product / Incoterm toolbar filters on contract rows (summary unplanned + core scope). */
export function appendContractScopeToolbarFilters(
  filters: ColumnFilterPayload,
  startIndex: number,
): { sql: string; params: unknown[]; nextIndex: number } {
  const parts: string[] = [];
  const params: unknown[] = [];
  let pi = startIndex;

  for (const colId of ['product', 'incoterm'] as const) {
    const raw = filters[colId];
    if (!raw || typeof raw !== 'object') continue;
    const f = raw as ColumnFilterPayload[string];
    if (f.type !== 'multi') continue;

    const expr = colId === 'product' ? 'c.product' : 'c.incoterm';
    const vals = Array.isArray(f.values)
      ? f.values.filter((x) => x != null && String(x).trim() !== '')
      : [];
    const incBlank = Boolean(f.includeBlank);
    const ors: string[] = [];
    if (incBlank) {
      ors.push(`(${expr} IS NULL OR TRIM(${expr}::text) = '')`);
    }
    if (vals.length > 0) {
      ors.push(`${expr}::text = ANY($${pi}::text[])`);
      params.push(vals);
      pi += 1;
    }
    if (ors.length > 0) {
      parts.push(`(${ors.join(' OR ')})`);
    }
  }

  return {
    sql: parts.length > 0 ? ` AND ${parts.join(' AND ')}` : '',
    params,
    nextIndex: pi,
  };
}

/** Shared WHERE for open SEA/MIX contracts without shipment and without registered ETA. */
export function unplannedContractBacklogBaseWhereSql(contractAlias = 'c', spdAlias = 'l'): string {
  return `
    ${buildShipmentSeaMixTransportSql(contractAlias)}
    AND NOT (${sqlIsContractSapClosedExpr(contractAlias)})
    AND ${shipmentPageExcludeB2bChildCond(spdAlias)}
    AND ${sqlContractHasNoRegisteredEtaExpr(contractAlias)}
    AND NOT EXISTS (
      SELECT 1 FROM shipments s_ns WHERE s_ns.contract_id = ${contractAlias}.id
    )`;
}

/** SELECT list aligned with shipment list row shape for contract backlog rows. */
export function unplannedContractBacklogRowSelectSql(): string {
  const plant = groupPlantExpr('c.plant_code', 'c.company_name');
  return `
    c.id::text AS id,
    'contract_backlog'::text AS row_kind,
    ('contract:' || c.id::text) AS sto_key,
    NULL::text AS sto_number,
    NULL::text AS shipment_id,
    NULL::text AS operation_id,
    c.contract_id AS contract_number,
    c.contract_id AS contract_numbers,
    NULLIF(TRIM(c.po_number::text), '') AS po_numbers,
    c.supplier AS supplier,
    c.supplier AS suppliers,
    c.buyer AS buyer,
    c.buyer AS buyers,
    c.product AS product,
    c.product AS products,
    c.group_name AS group_name,
    c.group_name AS group_names,
    ${plant} AS plant_site,
    c.incoterm AS incoterm,
    c.contract_date AS contract_date,
    c.delivery_start_date AS delivery_start_date,
    c.delivery_end_date AS delivery_end_date,
    NULL::text AS vessel_name,
    NULL::text AS vessel_code,
    NULL::text AS vessel_owner,
    NULL::text AS port_of_loading,
    NULL::text AS port_of_discharge,
    NULL::date AS shipment_date,
    NULL::date AS arrival_date,
    0::numeric AS quantity_shipped,
    0::numeric AS quantity_delivered,
    0::numeric AS inbound_weight,
    0::numeric AS outbound_weight,
    0::numeric AS gain_loss_percentage,
    0::numeric AS gain_loss_amount,
    'UNPLANNED'::text AS status,
    FALSE AS is_contract_sap_closed,
    c.created_at AS created_at,
    c.id::text AS contract_row_id,
    NULL::text AS contract_ext_no,
    NULL::text AS contract_reference_po,
    1::bigint AS contract_count,
    NULL::date AS eta_arrival,
    NULL::date AS eta_berthed,
    NULL::date AS eta_loading_start,
    NULL::date AS eta_loading_complete,
    NULL::date AS eta_sailed,
    NULL::date AS eta_discharge_arrival,
    NULL::date AS eta_discharge_berthed,
    NULL::date AS eta_discharge_start,
    NULL::date AS eta_discharge_complete,
    NULL::date AS eta_vessel_complete_discharge,
    NULL::date AS ata_vessel_arrival_at_loading_port,
    NULL::date AS ata_vessel_berthed_at_loading_port,
    NULL::date AS ata_vessel_start_loading,
    NULL::date AS ata_vessel_completed_loading,
    NULL::date AS ata_vessel_sailed_from_loading_port,
    NULL::date AS ata_vessel_arrive_at_discharge_port,
    NULL::date AS ata_vessel_berthed_at_discharge_port,
    NULL::date AS ata_vessel_start_discharging,
    NULL::date AS ata_vessel_complete_discharge`;
}

export function buildUnplannedContractBacklogLatestSpdCte(): string {
  return `
      latest_spd_contract AS (
        SELECT DISTINCT ON (spd.contract_number)
          spd.contract_number,
          NULLIF(TRIM(COALESCE(
            spd.sto_number::text,
            spd.data->'raw'->>'STO No.',
            spd.data->'raw'->>'STO Number',
            spd.data->'shipment'->>'sto_no',
            spd.data->'contract'->>'sto_no'
          )), '') AS effective_sto,
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

export function buildUnplannedContractBacklogCountQuery(
  contractScopeSql: string,
  toolbarSql: string,
): string {
  return `
    WITH ${buildUnplannedContractBacklogLatestSpdCte()},
    unplanned_contract_backlog AS (
      SELECT c.id
      FROM contracts c
      LEFT JOIN latest_spd_contract l ON l.contract_number = c.contract_id
      WHERE ${unplannedContractBacklogBaseWhereSql('c', 'l')}
        ${contractScopeSql}
        ${toolbarSql}
    )
    SELECT COUNT(*)::bigint AS c FROM unplanned_contract_backlog`;
}

export function buildUnplannedContractBacklogPageQuery(
  contractScopeSql: string,
  toolbarSql: string,
  limit: number,
  offset: number,
): string {
  return `
    WITH ${buildUnplannedContractBacklogLatestSpdCte()},
    unplanned_contract_backlog AS (
      SELECT ${unplannedContractBacklogRowSelectSql()}
      FROM contracts c
      LEFT JOIN latest_spd_contract l ON l.contract_number = c.contract_id
      WHERE ${unplannedContractBacklogBaseWhereSql('c', 'l')}
        ${contractScopeSql}
        ${toolbarSql}
      ORDER BY c.contract_date DESC NULLS LAST, c.contract_id ASC
      LIMIT ${limit} OFFSET ${offset}
    )
    SELECT * FROM unplanned_contract_backlog`;
}

/** Shipment-side unplanned filter (toolbar + unplanned execution predicate). */
export function unplannedShipmentExecutionOuterSql(toolbarOuterSql: string): string {
  return `${toolbarOuterSql} AND ${shipmentPagePipelineUnplannedRowPredicate('sb')}`;
}

export function buildUnplannedShipmentExecutionCountQuery(
  shipmentBaseCteSql: string,
  outerSql: string,
): string {
  return `
    ${shipmentBaseCteSql},
    filtered_shipments AS (
      SELECT sb.*
      FROM shipment_base sb
      WHERE 1=1 ${outerSql}
    )
    SELECT COUNT(*)::bigint AS c FROM filtered_shipments`;
}

export function buildUnplannedContractBacklogTableCountCte(contractScopeSql = ''): string {
  return `,
      unplanned_contract_backlog_table AS (
        SELECT COUNT(*)::bigint AS backlog_count
        FROM contracts c
        LEFT JOIN latest_spd_contract l ON l.contract_number = c.contract_id
        WHERE ${unplannedContractBacklogBaseWhereSql('c', 'l')}
          ${contractScopeSql}
      )`;
}

export function parseColumnFiltersFromQuery(raw: unknown): ColumnFilterPayload {
  return parseColumnFiltersQuery(raw);
}

/** Toolbar contract scope (date / plant / contract) with fresh $1… param indices. */
export function buildUnplannedContractToolbarScope(input: {
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
  const groupPlantFilter = appendGroupPlantFilter(
    input.plants,
    cp,
    groupPlantExpr('c.plant_code', 'c.company_name'),
    'c.plant_code',
  );
  if (groupPlantFilter.sql) {
    parts.push(groupPlantFilter.sql.replace(/^ AND /, ''));
    params.push(...groupPlantFilter.params);
  }

  const sql = parts.length > 0 ? `AND ${parts.join(' AND ')}` : '';
  return { sql, params };
}
