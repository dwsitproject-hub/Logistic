/**
 * Slim Unplanned grouping-template SQL.
 *
 * One query, snapshot joins only: `contract_latest_spd_snapshot` (via latest_spd_contract)
 * and `contract_qty_move_snapshot` (via qty_move). No sap_processed_data JSONB detoast,
 * no vessel_loading_ports, no list-stage snapshot rebuild, no Section 1 summary.
 */

import { query } from '../database/connection';
import { B2B_ENDING_CHILD_SNAPSHOT_TABLE } from './b2bOriginEndingSql';
import { sqlNormalizeDischargeDestination } from './dischargeDestinationAlias';
import { regionSiteDisplayExpr, appendRegionSiteFilter } from './regionSiteSql';
import { resolveContractsQtyMoveCte } from '../services/contractQtyMoveSnapshot.service';
import {
  appendUnplannedContractBacklogColumnFilters,
  parseColumnFiltersFromQuery,
  resolveUnplannedContractBacklogLatestSpdCte,
  sqlBacklogOsStillActiveSql,
  unplannedContractBacklogBaseWhereSql,
} from './shipmentUnplannedHybridSql';
import { sqlContractOutstandingFromFields, sqlQtyMoveJoinIncotermDelivery } from './sapIncotermMetrics';
import type { ColumnFilterPayload } from './contractListFilters';

export const SHIPMENT_GROUPING_TEMPLATE_ROW_LIMIT = 10_000;

/**
 * Region/Plant for the template = SAP Discharge Destination (with KIJING→TANJUNG PURA).
 * Reads the latest-SPD snapshot column + B2B ending-child snapshot — not sap_processed_data.
 */
export function sqlGroupingTemplatePlantSiteRawExpr(): string {
  const b2bDest = `(
    SELECT ${sqlNormalizeDischargeDestination(`NULLIF(TRIM(m.discharge_destination), '')`)}
    FROM ${B2B_ENDING_CHILD_SNAPSHOT_TABLE} m
    WHERE m.origin_po = NULLIF(TRIM(c.po_number::text), '')
    LIMIT 1
  )`;
  const spdDest = sqlNormalizeDischargeDestination(`NULLIF(TRIM(l.discharge_destination), '')`);
  return `COALESCE(${b2bDest}, ${spdDest})`;
}

export function sqlGroupingTemplatePlantSiteDisplayExpr(): string {
  return regionSiteDisplayExpr(sqlGroupingTemplatePlantSiteRawExpr());
}

export function sqlGroupingTemplateContractExtExpr(): string {
  return `NULLIF(TRIM(COALESCE(l.contract_ext_no_raw, '')), '')`;
}

export function appendGroupingTemplateSearch(
  searchTrim: string,
  startIndex: number,
): { sql: string; params: string[]; nextIndex: number } {
  if (!searchTrim || searchTrim.length < 2) {
    return { sql: '', params: [], nextIndex: startIndex };
  }
  const p = startIndex;
  const likeExpr = `$${p}::text`;
  const plant = sqlGroupingTemplatePlantSiteDisplayExpr();
  const ext = sqlGroupingTemplateContractExtExpr();
  const sql = `
    AND (
      COALESCE(c.contract_id::text, '') ILIKE ${likeExpr}
      OR COALESCE(c.po_number::text, '') ILIKE ${likeExpr}
      OR COALESCE(c.supplier::text, '') ILIKE ${likeExpr}
      OR COALESCE(c.product::text, '') ILIKE ${likeExpr}
      OR COALESCE((${plant})::text, '') ILIKE ${likeExpr}
      OR COALESCE((${ext})::text, '') ILIKE ${likeExpr}
    )`;
  return { sql, params: [`%${searchTrim}%`], nextIndex: startIndex + 1 };
}

export function buildGroupingTemplateToolbarScope(input: {
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
  const plantFilter = appendRegionSiteFilter(
    input.plants,
    cp,
    sqlGroupingTemplatePlantSiteRawExpr(),
  );
  if (plantFilter.sql) {
    parts.push(plantFilter.sql.replace(/^ AND /, ''));
    params.push(...plantFilter.params);
  }

  const sql = parts.length > 0 ? `AND ${parts.join(' AND ')}` : '';
  return { sql, params };
}

/**
 * Column filters for the template. `plant_site` uses the snapshot expression so a Region/Plant
 * header filter cannot force a sap_processed_data JSONB scan.
 */
export function appendGroupingTemplateColumnFilters(
  filters: ColumnFilterPayload,
  startIndex: number,
): { sql: string; params: unknown[]; nextIndex: number } {
  const rest: ColumnFilterPayload = { ...filters };
  delete rest.plant_site;
  const base = appendUnplannedContractBacklogColumnFilters(rest, startIndex);
  const plantFilter = filters.plant_site;
  if (!plantFilter || typeof plantFilter !== 'object') return base;

  const expr = sqlGroupingTemplatePlantSiteDisplayExpr();
  const parts: string[] = [];
  const params: unknown[] = [...base.params];
  let pi = base.nextIndex;
  if (plantFilter.emptyOnly) {
    parts.push(` AND (${expr} IS NULL OR TRIM(${expr}::text) = '')`);
  } else if (plantFilter.type === 'text') {
    const v = String(plantFilter.value ?? '').trim();
    if (v) {
      if (plantFilter.exact) {
        parts.push(` AND LOWER(TRIM(${expr}::text)) = LOWER($${pi}::text)`);
      } else {
        parts.push(` AND ${expr}::text ILIKE $${pi}`);
      }
      params.push(plantFilter.exact ? v : `%${v}%`);
      pi += 1;
    }
  } else if (plantFilter.type === 'multi') {
    const vals = Array.isArray(plantFilter.values)
      ? plantFilter.values.filter((x) => x != null && String(x).trim() !== '')
      : [];
    const ors: string[] = [];
    if (plantFilter.includeBlank) {
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
  return { sql: `${base.sql}${parts.join('')}`, params, nextIndex: pi };
}

export type GroupingTemplateQueryInput = {
  dateFrom?: unknown;
  dateTo?: unknown;
  contract?: unknown;
  plants: string[];
  search: string;
  columnFilters: ColumnFilterPayload;
  limit?: number;
};

export async function buildShipmentGroupingTemplateQuery(
  input: GroupingTemplateQueryInput,
): Promise<{ sql: string; params: unknown[]; limit: number }> {
  const limit = input.limit ?? SHIPMENT_GROUPING_TEMPLATE_ROW_LIMIT;
  const scope = buildGroupingTemplateToolbarScope({
    dateFrom: input.dateFrom,
    dateTo: input.dateTo,
    contract: input.contract,
    plants: input.plants,
  });
  let idx = scope.params.length + 1;
  const search = appendGroupingTemplateSearch(input.search, idx);
  idx = search.nextIndex;
  const col = appendGroupingTemplateColumnFilters(input.columnFilters, idx);
  const toolbarSql = `${search.sql}${col.sql}`;
  const params = [...scope.params, ...search.params, ...col.params];
  const backlogWhere = `${unplannedContractBacklogBaseWhereSql('c', 'l')}${scope.sql}${toolbarSql}`;
  const outstandingExpr = sqlContractOutstandingFromFields({
    contractQtyExpr: 'c.quantity_ordered',
    incotermExpr: 'c.incoterm',
    receiveExpr: 'qm.quantity_receive',
    deliveryExpr: sqlQtyMoveJoinIncotermDelivery('c.incoterm', 'qm', 'c.transport_mode'),
    clampAtZero: true,
  });
  const plantSite = sqlGroupingTemplatePlantSiteDisplayExpr();
  const qtyMoveCte = await resolveContractsQtyMoveCte({
    kind: 'in_subquery',
    subquery: 'SELECT contract_id FROM backlog_contract_ids',
  });
  const sql = `
    WITH ${await resolveUnplannedContractBacklogLatestSpdCte()},
    backlog_contract_ids AS MATERIALIZED (
      SELECT c.id, c.contract_id
      FROM contracts c
      LEFT JOIN latest_spd_contract l ON l.contract_number = c.contract_id
      WHERE ${backlogWhere}
    ),
    ${qtyMoveCte}
    SELECT
      c.id::text AS id,
      c.supplier,
      (${plantSite}) AS plant_site,
      c.product,
      c.incoterm,
      c.buyer,
      NULLIF(TRIM(c.po_number::text), '') AS po_number,
      c.contract_date,
      c.quantity_ordered AS contract_qty_kg,
      (${outstandingExpr})::numeric AS outstanding_qty_kg
    FROM backlog_contract_ids b
    INNER JOIN contracts c ON c.id = b.id
    LEFT JOIN latest_spd_contract l ON l.contract_number = c.contract_id
    LEFT JOIN qty_move qm ON qm.contract_number = c.contract_id
    WHERE ${sqlBacklogOsStillActiveSql()}
    ORDER BY
      LOWER(TRIM(COALESCE(c.supplier, ''))) ASC NULLS LAST,
      LOWER(TRIM(COALESCE((${plantSite})::text, ''))) ASC NULLS LAST,
      LOWER(TRIM(COALESCE(c.product, ''))) ASC NULLS LAST,
      LOWER(TRIM(COALESCE(c.incoterm, ''))) ASC NULLS LAST,
      c.contract_date ASC NULLS LAST,
      NULLIF(TRIM(c.po_number::text), '') ASC NULLS LAST
    LIMIT ${limit + 1}`;

  return { sql, params, limit };
}

export async function fetchShipmentGroupingTemplateRows(
  input: GroupingTemplateQueryInput,
): Promise<{ rows: GroupingTemplateDbRow[]; truncated: boolean; limit: number }> {
  const { sql, params, limit } = await buildShipmentGroupingTemplateQuery(input);
  const res = await query(sql, params);
  const truncated = res.rows.length > limit;
  const rows = (truncated ? res.rows.slice(0, limit) : res.rows) as GroupingTemplateDbRow[];
  return { rows, truncated, limit };
}

export interface GroupingTemplateDbRow {
  id: string;
  supplier: string | null;
  plant_site: string | null;
  product: string | null;
  incoterm: string | null;
  buyer: string | null;
  po_number: string | null;
  contract_date: string | Date | null;
  contract_qty_kg: number | string | null;
  outstanding_qty_kg: number | string | null;
}

/** All currently eligible Unplanned identities — one prefetch for bulk upload matching. */
export async function buildManualGroupingEligibleIdentityQuery(): Promise<{
  sql: string;
  params: unknown[];
}> {
  const qtyMoveCte = await resolveContractsQtyMoveCte({
    kind: 'in_subquery',
    subquery: 'SELECT contract_id FROM backlog_contract_ids',
  });
  const sql = `
    WITH ${await resolveUnplannedContractBacklogLatestSpdCte()},
    backlog_contract_ids AS MATERIALIZED (
      SELECT c.id, c.contract_id
      FROM contracts c
      LEFT JOIN latest_spd_contract l ON l.contract_number = c.contract_id
      WHERE ${unplannedContractBacklogBaseWhereSql('c', 'l')}
    ),
    ${qtyMoveCte}
    SELECT
      c.id::text AS id,
      NULLIF(TRIM(c.po_number::text), '') AS po_number
    FROM backlog_contract_ids b
    INNER JOIN contracts c ON c.id = b.id
    LEFT JOIN latest_spd_contract l ON l.contract_number = c.contract_id
    LEFT JOIN qty_move qm ON qm.contract_number = c.contract_id
    WHERE ${sqlBacklogOsStillActiveSql()}
  `;
  return { sql, params: [] };
}

export async function prefetchManualGroupingEligibleIdentities(): Promise<
  Array<{ id: string; poNumber: string }>
> {
  const { sql, params } = await buildManualGroupingEligibleIdentityQuery();
  const res = await query(sql, params);
  return res.rows.map((row) => ({
    id: String(row.id),
    poNumber: String(row.po_number ?? ''),
  }));
}

export function parseGroupingTemplateQueryFromRequest(queryParams: Record<string, unknown>): {
  dateFrom?: unknown;
  dateTo?: unknown;
  contract?: unknown;
  plants: string[];
  search: string;
  columnFilters: ColumnFilterPayload;
} {
  const plantRaw = queryParams.plant;
  const plantList = Array.isArray(plantRaw) ? plantRaw : plantRaw ? [plantRaw] : [];
  const plants = plantList.map((v) => String(v).trim()).filter(Boolean);
  const search = typeof queryParams.search === 'string' ? queryParams.search.trim() : '';
  return {
    dateFrom: queryParams.dateFrom || undefined,
    dateTo: queryParams.dateTo || undefined,
    contract: queryParams.contract || undefined,
    plants,
    search,
    columnFilters: parseColumnFiltersFromQuery(queryParams.columnFilters),
  };
}

export { parseColumnFiltersFromQuery };
