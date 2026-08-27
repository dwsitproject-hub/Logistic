import { buildListOrderByWithSapStoPriority } from './listSapStoPrioritySql';
import {
  shipmentListKlipDeliveryKgExpr,
  shipmentListKlipReceiveKgExpr,
  shipmentListRowContractQtySql,
  shipmentListSapDeliveryQtySql,
  shipmentListSapReceiveQtySql,
} from './shipmentListQtySql';
import {
  sqlShipmentResolvedDeliveryKg,
  sqlShipmentResolvedReceiveKg,
} from './shipmentManualQtyResolveSql';

/** Sortable shipment list columns mapped to filtered_shipments (`fs`) expressions. */
export const SHIPMENT_LIST_SORT_COLUMNS: Record<string, string> = {
  created_at: 'fs.created_at',
  vessel_name: "LOWER(NULLIF(TRIM(fs.vessel_name::text), ''))",
  sto_number: 'fs.sto_number',
  shipment_id: 'fs.sto_number',
  contract_numbers: 'fs.contract_numbers',
  contract_number: 'fs.contract_numbers',
  po_numbers: 'fs.po_numbers',
  status: 'fs.status',
  plant_site: 'fs.plant_site',
  supplier: 'fs.supplier',
  suppliers: 'fs.suppliers',
  product: 'fs.product',
  products: 'fs.products',
  incoterm: 'fs.incoterm',
  contract_date: 'fs.contract_date',
  charter_type: 'fs.charter_type',
  operation_id: 'fs.operation_id',
  delivery_start_date: 'fs.delivery_start_date',
  delivery_end_date: 'fs.delivery_end_date',
  delivery_start: 'fs.delivery_start_date',
  delivery_end: 'fs.delivery_end_date',
  quantity_shipped: 'fs.quantity_shipped',
  // Shell / skipSapJoin path — KLIP-first proxies (SAP Open/Close resolve needs enriched path).
  quantity_delivered:
    'COALESCE(fs.quantity_delivered_klip, fs.quantity_delivered)',
  quantity_receive: 'COALESCE(fs.actual_vessel_qty_receive, 0)',
  sfal_qty: 'fs.sfal_qty',
  sfbd_qty: 'fs.sfbd_qty',
  vessel_code: 'fs.vessel_code',
  estimated_nautical_miles: 'fs.estimated_nautical_miles',
  vessel_draft: 'fs.vessel_draft',
  vessel_loa: 'fs.vessel_loa',
  vessel_capacity: 'fs.vessel_capacity',
  vessel_hull_type: 'fs.vessel_hull_type',
  vessel_registration_year: 'fs.vessel_registration_year',
  average_vessel_speed: 'fs.average_vessel_speed',
  fuel_consumption: 'fs.fuel_consumption',
  freight: 'fs.freight',
  freight_budget: 'fs.vessel_oa_budget',
  pump_rate: 'fs.pump_rate',
  sailing_speed: 'fs.sailing_speed',
  shortage: 'fs.shortage',
  contract_reference_po: 'fs.contract_reference_po',
  eta_arrival: 'fs.eta_arrival',
  eta_berthed: 'fs.eta_berthed',
  eta_loading_start: 'fs.eta_loading_start',
  eta_loading_complete: 'fs.eta_loading_complete',
  eta_sailed: 'fs.eta_sailed',
  eta_discharge_arrival: 'fs.eta_discharge_arrival',
  eta_discharge_berthed: 'fs.eta_discharge_berthed',
  eta_discharge_start: 'fs.eta_discharge_start',
  eta_discharge_complete: 'fs.eta_discharge_complete',
  ata_vessel_completed_loading: 'fs.ata_vessel_completed_loading',
  ata_vessel_complete_discharge: 'fs.ata_vessel_complete_discharge',
  ata_vessel_arrival_at_loading_port: 'fs.ata_vessel_arrival_at_loading_port',
  ata_vessel_berthed_at_loading_port: 'fs.ata_vessel_berthed_at_loading_port',
  ata_vessel_start_loading: 'fs.ata_vessel_start_loading',
  ata_vessel_sailed_from_loading_port: 'fs.ata_vessel_sailed_from_loading_port',
  ata_vessel_arrive_at_discharge_port: 'fs.ata_vessel_arrive_at_discharge_port',
  ata_vessel_berthed_at_discharge_port: 'fs.ata_vessel_berthed_at_discharge_port',
  ata_vessel_start_discharging: 'fs.ata_vessel_start_discharging',
  late_indicator: 'fs.is_delayed',
  // Shell fallbacks so skipSapJoin=true never silently ORDER BY created_at.
  contract_qty: shipmentListRowContractQtySql('fs'),
  loading_port:
    "LOWER(COALESCE(NULLIF(TRIM(fs.loading_ports_klip), ''), NULLIF(TRIM(fs.port_of_loading), ''), ''))",
  discharge_port:
    "LOWER(COALESCE(NULLIF(TRIM(fs.discharge_ports_klip), ''), NULLIF(TRIM(fs.port_of_discharge), ''), ''))",
  contract_ext_no: "LOWER(COALESCE(NULLIF(TRIM(fs.contract_ext_no::text), ''), ''))",
};

/** Sort keys that require SAP/qty enrichment before ORDER BY (match list column display). */
export const SHIPMENT_LIST_ENRICHED_SORT_KEYS = new Set<string>([
  'quantity_delivered',
  'quantity_receive',
  'outstanding_quantity',
  'outstanding_qty_planning',
  'contract_qty',
  'sto_quantity',
  'loading_port',
  'discharge_port',
  'b2b_flag',
  'contract_ext_no',
]);

/** ORDER BY columns on `list_enriched le` (post SAP/qty join). */
export const SHIPMENT_LIST_ENRICHED_ORDER_COLUMNS: Record<string, string> = {
  quantity_delivered: 'le.resolved_quantity_delivered',
  quantity_receive: 'le.resolved_quantity_receive',
  outstanding_quantity: 'le.outstanding_quantity',
  outstanding_qty_planning: 'le.outstanding_qty_planning',
  contract_qty: 'le.contract_qty',
  sto_quantity: 'le.sto_quantity',
  loading_port: "LOWER(COALESCE(le.loading_ports_sort, ''))",
  discharge_port: "LOWER(COALESCE(le.discharge_ports_sort, ''))",
  b2b_flag: "LOWER(COALESCE(le.b2b_flag_resolved, ''))",
  contract_ext_no: "LOWER(COALESCE(le.contract_ext_no_resolved, ''))",
};

/** Contract backlog slice sort (Unplanned / ALL hybrid). */
export const SHIPMENT_CONTRACT_BACKLOG_SORT_COLUMNS: Record<string, string> = {
  created_at: 'c.created_at',
  vessel_name: 'c.contract_date',
  sto_number: 'c.contract_id',
  shipment_id: 'c.contract_id',
  contract_numbers: 'c.contract_id',
  contract_number: 'c.contract_id',
  po_numbers: 'c.po_number',
  plant_site: 'c.plant_code',
  supplier: 'c.supplier',
  suppliers: 'c.supplier',
  product: 'c.product',
  products: 'c.product',
  incoterm: 'c.incoterm',
  contract_date: 'c.contract_date',
  charter_type: 'c.contract_id',
  operation_id: 'c.contract_id',
  delivery_start_date: 'c.delivery_start_date',
  delivery_end_date: 'c.delivery_end_date',
  delivery_start: 'c.delivery_start_date',
  delivery_end: 'c.delivery_end_date',
  contract_qty: 'c.quantity_ordered',
  quantity_delivered: 'quantity_delivered',
  quantity_receive: 'quantity_receive',
  outstanding_quantity: 'outstanding_quantity',
  outstanding_qty_planning: 'outstanding_quantity',
  loading_port: 'c.contract_date',
  discharge_port: 'c.contract_date',
  sto_quantity: 'c.contract_date',
  b2b_flag: 'c.contract_date',
  contract_ext_no: 'c.contract_id',
};

export function parseShipmentListSort(
  sortKeyRaw?: unknown,
  sortDirRaw?: unknown,
): { sortKey: string; sortDir: 'ASC' | 'DESC' } {
  const keyTrim = typeof sortKeyRaw === 'string' ? sortKeyRaw.trim() : '';
  const sortKey =
    keyTrim &&
    (SHIPMENT_LIST_SORT_COLUMNS[keyTrim] ||
      SHIPMENT_LIST_ENRICHED_ORDER_COLUMNS[keyTrim])
      ? keyTrim
      : 'created_at';
  const sortDir =
    String(sortDirRaw ?? '').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  return { sortKey, sortDir };
}

export function shipmentListSortUsesEnrichedPath(sortKey: string): boolean {
  return SHIPMENT_LIST_ENRICHED_SORT_KEYS.has(sortKey);
}

function withRowPrefix(expr: string, prefix: string): string {
  if (prefix === 'fs') return expr;
  return expr.replace(/\bfs\./g, `${prefix}.`);
}

function resolveEnrichedOrderExpr(sortKey: string): string {
  if (SHIPMENT_LIST_ENRICHED_ORDER_COLUMNS[sortKey]) {
    return SHIPMENT_LIST_ENRICHED_ORDER_COLUMNS[sortKey];
  }
  const base = SHIPMENT_LIST_SORT_COLUMNS[sortKey] ?? SHIPMENT_LIST_SORT_COLUMNS.created_at;
  return withRowPrefix(base, 'le');
}

/**
 * STO-first priority is a default Unplanned/Planned convenience only.
 * Skip it when the user sorts by date/qty so the primary column wins.
 */
export const SHIPMENT_LIST_SKIP_STO_PRIORITY_SORT_KEYS = new Set<string>([
  'contract_date',
  'delivery_start_date',
  'delivery_end_date',
  'delivery_start',
  'delivery_end',
  'outstanding_quantity',
  'outstanding_qty_planning',
  'quantity_delivered',
  'quantity_receive',
  'contract_qty',
  'sto_quantity',
  'quantity_shipped',
]);

/**
 * Hybrid ALL/Unplanned: merge-sort across execution + backlog (not execution-first paging).
 * Qty columns need this so page 1 is the global top-K, not execution-first then a local re-sort.
 */
export function hybridListUsesGlobalMergeSort(sortKey: string): boolean {
  if (!sortKey || sortKey === 'created_at') return false;
  return true;
}

/** ORDER BY clause for shipment execution rows (before LIMIT/OFFSET). */
export function buildShipmentListPageOrderBy(
  sortKey: string,
  sortDir: 'ASC' | 'DESC',
  tableStatusFilter?: string,
  rowPrefix = 'fs',
): string {
  const field =
    rowPrefix === 'le'
      ? resolveEnrichedOrderExpr(sortKey)
      : withRowPrefix(
          SHIPMENT_LIST_SORT_COLUMNS[sortKey] ?? SHIPMENT_LIST_SORT_COLUMNS.created_at,
          rowPrefix,
        );
  const createdAtExpr = withRowPrefix('fs.created_at', rowPrefix);
  const stoExpr = withRowPrefix('fs.sto_number', rowPrefix);
  /*
   * `id` is the final, unique tie-break.
   *
   * Without it the ordering was `<sort field> NULLS LAST, created_at DESC` - and created_at is
   * far from unique, because bulk SAP loads stamp thousands of rows with the same microsecond.
   * Which of the tied rows landed on page 1 was therefore decided by the query plan, not by the
   * data, so any plan change silently reshuffles the page.
   *
   * Measured, not theorised: restoring this database into PostgreSQL 18 returned the same 591
   * rows with zero field differences, but a DIFFERENT 25 rows on page 1 - purely because the
   * newer planner ordered the ties differently. Trucking, which already had this tie-break, was
   * byte-identical across the same test.
   *
   * The contract-backlog builders below already end in contract_id / contract_number for the
   * same reason; this brings the execution rows in line.
   */
  const idExpr = withRowPrefix('fs.id', rowPrefix);
  const primaryOrder = `${field} ${sortDir} NULLS LAST, ${createdAtExpr} DESC, ${idExpr} ASC`;
  if (SHIPMENT_LIST_SKIP_STO_PRIORITY_SORT_KEYS.has(sortKey)) {
    return primaryOrder;
  }
  return buildListOrderByWithSapStoPriority(stoExpr, primaryOrder, tableStatusFilter);
}

/** ORDER BY for list_enriched pagination (SAP/qty columns). */
export function buildShipmentListEnrichedPageOrderBy(
  sortKey: string,
  sortDir: 'ASC' | 'DESC',
  tableStatusFilter?: string,
): string {
  return buildShipmentListPageOrderBy(sortKey, sortDir, tableStatusFilter, 'le');
}

/** SELECT list for list_enriched CTE (resolved qty + sort helpers). */
export function buildShipmentListEnrichedCteBody(qtySelectSql: string): string {
  const closedExpr = 'COALESCE(fs.is_contract_sap_closed, FALSE)';
  const resolvedDelivery = sqlShipmentResolvedDeliveryKg(
    closedExpr,
    shipmentListKlipDeliveryKgExpr('fs'),
    shipmentListSapDeliveryQtySql('fs'),
    'fs.quantity_delivered',
  );
  const resolvedReceive = sqlShipmentResolvedReceiveKg(
    closedExpr,
    shipmentListKlipReceiveKgExpr('fs'),
    shipmentListSapReceiveQtySql('fs'),
  );
  return `
    list_enriched AS (
      SELECT
        fs.*,
        ${qtySelectSql},
        (${resolvedDelivery})::numeric AS resolved_quantity_delivered,
        (${resolvedReceive})::numeric AS resolved_quantity_receive,
        COALESCE(
          CASE
            WHEN COALESCE(fs.is_contract_sap_closed, FALSE) IS TRUE THEN
              NULLIF(TRIM(slpa.sap_loading_ports), '')
            ELSE
              NULLIF(TRIM(fs.loading_ports_klip), '')
          END,
          CASE
            WHEN COALESCE(fs.is_contract_sap_closed, FALSE) IS TRUE THEN
              NULLIF(TRIM(fs.loading_ports_klip), '')
            ELSE
              NULLIF(TRIM(slpa.sap_loading_ports), '')
          END,
          NULLIF(TRIM(fs.port_of_loading), '')
        ) AS loading_ports_sort,
        COALESCE(
          CASE
            WHEN COALESCE(fs.is_contract_sap_closed, FALSE) IS TRUE THEN
              NULLIF(TRIM(sdpa.sap_discharge_ports), '')
            ELSE
              NULLIF(TRIM(fs.discharge_ports_klip), '')
          END,
          CASE
            WHEN COALESCE(fs.is_contract_sap_closed, FALSE) IS TRUE THEN
              NULLIF(TRIM(fs.discharge_ports_klip), '')
            ELSE
              NULLIF(TRIM(sdpa.sap_discharge_ports), '')
          END,
          NULLIF(TRIM(fs.port_of_discharge), '')
        ) AS discharge_ports_sort,
        COALESCE(sl.b2b_flag, '') AS b2b_flag_resolved,
        COALESCE(cex.contract_ext_no, fs.contract_ext_no) AS contract_ext_no_resolved
      FROM list_enrich_scope fs
      LEFT JOIN sto_metrics sm ON sm.sto_key::text = fs.sto_key::text
      LEFT JOIN sap_agg sa ON sa.sto_key::text = fs.sto_key::text
      LEFT JOIN sap_latest sl ON sl.sto_key::text = fs.sto_key::text
      LEFT JOIN sap_loading_ports_agg slpa ON slpa.sto_key::text = fs.sto_key::text
      LEFT JOIN sap_discharge_ports_agg sdpa ON sdpa.sto_key::text = fs.sto_key::text
      LEFT JOIN contract_ext_agg cex ON cex.sto_key::text = fs.sto_key::text
    )`;
}

/** PostgreSQL rejects ORDER BY 'literal' ("non-integer constant in ORDER BY"). */
function isUnsafeSqlOrderExpr(expr: string): boolean {
  const trimmed = expr.trim();
  if (!trimmed) return true;
  if (/^\d+$/.test(trimmed)) return true;
  return (
    (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
  );
}

const BACKLOG_DEFAULT_ORDER = (sortDir: 'ASC' | 'DESC') =>
  `c.contract_date ${sortDir} NULLS LAST, c.contract_id ASC`;

/** ORDER BY for Unplanned / ALL hybrid contract backlog page queries. */
export function buildShipmentContractBacklogOrderBy(
  sortKey: string,
  sortDir: 'ASC' | 'DESC',
): string {
  if (sortKey === 'created_at' || sortKey === 'status' || !SHIPMENT_CONTRACT_BACKLOG_SORT_COLUMNS[sortKey]) {
    return BACKLOG_DEFAULT_ORDER(sortDir);
  }
  if (sortKey === 'outstanding_quantity' || sortKey === 'outstanding_qty_planning') {
    return `outstanding_quantity ${sortDir} NULLS LAST, c.contract_date DESC NULLS LAST, c.contract_id ASC`;
  }
  const field = SHIPMENT_CONTRACT_BACKLOG_SORT_COLUMNS[sortKey];
  if (isUnsafeSqlOrderExpr(field)) {
    return BACKLOG_DEFAULT_ORDER(sortDir);
  }
  return `${field} ${sortDir} NULLS LAST, c.contract_date DESC NULLS LAST, c.contract_id ASC`;
}

function shipmentListRowSortNumeric(row: Record<string, unknown>, sortKey: string): number | null {
  const pick = (...keys: string[]): number | null => {
    for (const key of keys) {
      const raw = row[key];
      if (raw == null || raw === '') continue;
      const n = Number(raw);
      if (Number.isFinite(n)) return n;
    }
    return null;
  };
  switch (sortKey) {
    case 'outstanding_quantity':
    case 'outstanding_qty_planning':
      return pick('outstanding_quantity', 'outstanding_qty_planning');
    case 'quantity_delivered':
      return pick(
        'resolved_quantity_delivered',
        'quantity_delivered',
        'quantity_delivered_sap',
        'quantity_delivered_klip',
      );
    case 'quantity_receive':
      return pick('resolved_quantity_receive', 'quantity_receive', 'actual_vessel_qty_receive');
    case 'contract_qty':
      return pick('contract_qty');
    case 'sto_quantity':
      return pick('sto_quantity');
    default:
      return null;
  }
}

function shipmentListRowSortDateMs(row: Record<string, unknown>, sortKey: string): number | null {
  const field =
    sortKey === 'delivery_start' || sortKey === 'delivery_start_date'
      ? 'delivery_start_date'
      : sortKey === 'delivery_end' || sortKey === 'delivery_end_date'
        ? 'delivery_end_date'
        : sortKey === 'contract_date'
          ? 'contract_date'
          : sortKey;
  const raw = row[field];
  if (raw == null || raw === '') return null;
  if (raw instanceof Date) {
    const t = raw.getTime();
    return Number.isFinite(t) ? t : null;
  }
  const s = String(raw).trim();
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

function shipmentListRowSortString(row: Record<string, unknown>, sortKey: string): string {
  const col =
    SHIPMENT_LIST_SORT_COLUMNS[sortKey] ??
    SHIPMENT_CONTRACT_BACKLOG_OUTER_SORT_COLUMNS[sortKey];
  if (!col || col.includes('(')) {
    const direct = row[sortKey];
    return direct == null ? '' : String(direct).trim().toLowerCase();
  }
  const field = col.includes('.') ? col.split('.').pop()! : col;
  const raw = row[field];
  return raw == null ? '' : String(raw).trim().toLowerCase();
}

/** In-memory sort for merged hybrid pages (execution + contract backlog rows). */
export function sortShipmentListRows<T extends Record<string, unknown>>(
  rows: T[],
  sortKey: string,
  sortDir: 'ASC' | 'DESC',
): T[] {
  if (rows.length <= 1) return rows;
  const dirMul = sortDir === 'ASC' ? 1 : -1;
  const usesDate =
    sortKey === 'contract_date' ||
    sortKey === 'delivery_start_date' ||
    sortKey === 'delivery_end_date' ||
    sortKey === 'delivery_start' ||
    sortKey === 'delivery_end';
  const usesNumeric =
    shipmentListSortUsesEnrichedPath(sortKey) || sortKey === 'quantity_shipped';

  return [...rows].sort((a, b) => {
    if (usesDate) {
      const aDate = shipmentListRowSortDateMs(a, sortKey);
      const bDate = shipmentListRowSortDateMs(b, sortKey);
      if (aDate != null && bDate != null) {
        const diff = (aDate - bDate) * dirMul;
        if (diff !== 0) return diff;
      } else if (aDate != null) return -1 * dirMul;
      else if (bDate != null) return 1 * dirMul;
    } else if (usesNumeric || shipmentListRowSortNumeric(a, sortKey) != null) {
      const aNum = shipmentListRowSortNumeric(a, sortKey);
      const bNum = shipmentListRowSortNumeric(b, sortKey);
      if (aNum != null && bNum != null) {
        const diff = (aNum - bNum) * dirMul;
        if (diff !== 0) return diff;
      } else if (aNum != null) return -1 * dirMul;
      else if (bNum != null) return 1 * dirMul;
    }
    const aStr = shipmentListRowSortString(a, sortKey);
    const bStr = shipmentListRowSortString(b, sortKey);
    const cmp = aStr.localeCompare(bStr, undefined, { numeric: true, sensitivity: 'base' });
    if (cmp !== 0) return cmp * dirMul;
    const aCreated = String(a.created_at ?? a.contract_date ?? '');
    const bCreated = String(b.created_at ?? b.contract_date ?? '');
    return bCreated.localeCompare(aCreated) * dirMul;
  });
}

/**
 * ORDER BY when sorting a contract-backlog CTE result (e.g. all_contract_backlog).
 * Column names match unplannedContractBacklogRowSelectSql output — no `c` alias.
 */
export const SHIPMENT_CONTRACT_BACKLOG_OUTER_SORT_COLUMNS: Record<string, string> = {
  created_at: 'created_at',
  vessel_name: 'contract_date',
  sto_number: 'contract_number',
  shipment_id: 'contract_number',
  contract_numbers: 'contract_number',
  contract_number: 'contract_number',
  po_numbers: 'po_numbers',
  status: 'status',
  plant_site: 'plant_site',
  supplier: 'supplier',
  suppliers: 'supplier',
  product: 'product',
  products: 'product',
  incoterm: 'incoterm',
  contract_date: 'contract_date',
  charter_type: 'contract_number',
  operation_id: 'contract_number',
  delivery_start_date: 'delivery_start_date',
  delivery_end_date: 'delivery_end_date',
  delivery_start: 'delivery_start_date',
  delivery_end: 'delivery_end_date',
  contract_qty: 'contract_qty',
  quantity_delivered: 'quantity_delivered',
  quantity_receive: 'quantity_receive',
  outstanding_quantity: 'outstanding_quantity',
  outstanding_qty_planning: 'outstanding_quantity',
  contract_ext_no: 'contract_ext_no',
};

const BACKLOG_OUTER_DEFAULT_ORDER = (sortDir: 'ASC' | 'DESC') =>
  `contract_date ${sortDir} NULLS LAST, contract_number ASC`;

export function buildShipmentContractBacklogOuterOrderBy(
  sortKey: string,
  sortDir: 'ASC' | 'DESC',
): string {
  const field =
    SHIPMENT_CONTRACT_BACKLOG_OUTER_SORT_COLUMNS[sortKey] ??
    SHIPMENT_CONTRACT_BACKLOG_OUTER_SORT_COLUMNS.created_at;
  if (
    sortKey === 'created_at' ||
    !SHIPMENT_CONTRACT_BACKLOG_OUTER_SORT_COLUMNS[sortKey] ||
    isUnsafeSqlOrderExpr(field)
  ) {
    return BACKLOG_OUTER_DEFAULT_ORDER(sortDir);
  }
  return `${field} ${sortDir} NULLS LAST, contract_date DESC NULLS LAST, contract_number ASC`;
}
