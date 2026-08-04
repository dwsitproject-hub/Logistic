import { query } from '../database/connection';
import { AuthRequest } from '../middleware/auth';
import { SHIPMENT_STATUS_RANK } from '../utils/shipmentStatus';
import { toIsoDate10FromCell } from '../utils/planningSheetDate';
import {
  sapSpdDischargePortTextExpr,
  sapSpdLoadingPortTextExpr,
} from '../utils/portDisplaySql';
import { mergePoMetricsFromRows } from '../utils/shippingPerformancePoMetrics';
import {
  buildShippingPerfStoMetricsCte,
  SHIPPING_PERF_STO_GROUP_KEY_EXPR,
} from '../utils/shippingPerformanceStoMetricsSql';
import {
  shippingPerfStoGroupKeyFromRow,
  shippingPerfStoMetricsKeyExpr,
} from '../utils/shippingPerformanceStoSql';
import {
  sqlSapVesselNameFromSpdJsonb,
  sqlShipmentDisplayVesselName,
} from '../utils/sapVesselFields';
import {
  aggregateImportStatusForStoGroup,
  isContractDeliveryClosed,
  sqlContractImportStatusForStoExpr,
  sqlIsContractSapClosedForStoExpr,
} from '../utils/contractDeliveryStatus';
import {
  sqlShipmentResolvedDeliveryKg,
  sqlShipmentResolvedReceiveKg,
} from '../utils/shipmentManualQtyResolveSql';
import { deriveShipmentStatus } from '../utils/shipmentStatus';
import { SHIPMENT_ATA_OVERRIDES_JOIN } from '../utils/shipmentAtaOverrideSql';
import { buildShipmentPageSeaRowScopeSql } from '../utils/shipmentStoTypeSql';
import { computeShippingPerfDeltaFields } from '../utils/shippingPerformanceDeltas';

export type ShippingPerformancePart = 'summary' | 'tree' | 'rows';

export interface ShippingPerformanceFilters {
  scope: string;
  dateFrom: string;
  dateTo: string;
  incoterms: string[];
  plants: string[];
  cacheKey: string;
}

export interface PerVesselPerfSummary {
  vesselCount: number;
  contractCount: number;
  totalQty: number;
  avgLoadingEtaEtr: number;
  avgLoadingEtaEtb: number;
  avgLoadingEtbEtc: number;
  avgDischargeEtaEtb: number;
  avgDischargeEtbEtc: number;
  avgTotalDelta: number;
}

export interface ShippingPerfTreeNode {
  key: string;
  count: number;
  totalQty: number;
  children: ShippingPerfTreeNode[];
}

export interface ShippingPerfRemark {
  shipment_id: string;
  vessel_name: string;
  contract_number: string;
  remark: string;
}

const EMPTY_SUMMARY: PerVesselPerfSummary = {
  vesselCount: 0,
  contractCount: 0,
  totalQty: 0,
  avgLoadingEtaEtr: 0,
  avgLoadingEtaEtb: 0,
  avgLoadingEtbEtc: 0,
  avgDischargeEtaEtb: 0,
  avgDischargeEtbEtc: 0,
  avgTotalDelta: 0,
};

const ROW_CACHE = new Map<string, { rows: Record<string, unknown>[]; expiresAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000;
/** Bumped when Shipments scope ignores STO Type T (incoterm-only CIF/FOB/CFR). */
const ROW_CACHE_KEY = 'shipping-performance-rows-v37';

// Background warming keeps the (expensive) row cache populated so page loads are
// served from memory instead of paying the full SQL cost. This does not change what
// the query returns — it only pre-runs the identical query off the request path.
const KEEP_WARM_CHECK_MS = 60 * 1000; // how often the warmer wakes up
const KEEP_WARM_REFRESH_AFTER_MS = 4 * 60 * 1000; // renew cache once it is this old (< TTL)
/*
 * Stop warming when nobody is using the page. Raised from 15 to 90 minutes: the underlying query
 * costs ~3.5s even with the STO expression index, so the only way a visitor sees the page in well
 * under 3s is to be served from cache. A 15-minute window expired over any normal gap - a meeting
 * or lunch - and the next visitor paid the full query. 90 minutes covers those gaps while still
 * going quiet outside working hours, so this adds at most one 3.5s query every 4 minutes and only
 * while the page is genuinely in use.
 */
const KEEP_WARM_MAX_IDLE_MS = 90 * 60 * 1000;
let lastAccessedAt = 0;
let refreshInFlight: Promise<Record<string, unknown>[]> | null = null;
let keepWarmTimer: NodeJS.Timeout | null = null;

/** One row per STO / shipment operation (not per PO). */
export function shippingPerfStoGroupKey(row: Record<string, unknown>): string {
  return shippingPerfStoGroupKeyFromRow(row);
}

function shippingPerfRowPriority(row: Record<string, unknown>): number {
  const shipmentId = String(row.shipment_id ?? '').trim();
  if (/^\d+$/.test(shipmentId)) return 3;
  if (shipmentId.startsWith('MNL-') || shipmentId.startsWith('MSEA-')) return 1;
  return 2;
}

function joinDistinctValues(rows: Record<string, unknown>[], field: string): string {
  const values = new Set<string>();
  for (const row of rows) {
    const raw = String(row[field] ?? '').trim();
    if (!raw) continue;
    for (const part of raw.split(',')) {
      const v = part.trim();
      if (v) values.add(v);
    }
  }
  return [...values].sort((a, b) => a.localeCompare(b)).join(', ');
}

/** Milestone date fields max-merged across STO members (Shipments list MAX ATA/ETA). */
const SHIPPING_PERF_MILESTONE_FIELDS = [
  'cargo_readiness_date',
  'loading_eta_arrival',
  'loading_eta_berthed',
  'loading_eta_start',
  'loading_eta_completed',
  'loading_eta_sailed',
  'discharge_eta_arrival',
  'discharge_eta_berthed',
  'discharge_eta_start',
  'discharge_eta_completed',
  'loading_ata_arrival',
  'loading_ata_berthed',
  'loading_ata_start',
  'loading_ata_completed',
  'loading_ata_sailed',
  'discharge_ata_arrival',
  'discharge_ata_berthed',
  'discharge_ata_start',
  'discharge_ata_completed',
] as const;

function toDateMs(value: unknown): number | null {
  if (value == null || value === '') return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const ms = Date.parse(raw.length <= 10 ? `${raw}T00:00:00Z` : raw);
  return Number.isFinite(ms) ? ms : null;
}

function maxMergeMilestoneFields(rows: Record<string, unknown>[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of SHIPPING_PERF_MILESTONE_FIELDS) {
    let bestVal: unknown = null;
    let bestMs = Number.NEGATIVE_INFINITY;
    for (const row of rows) {
      const v = row[field];
      const ms = toDateMs(v);
      if (ms == null) continue;
      if (ms > bestMs) {
        bestMs = ms;
        bestVal = v;
      }
    }
    if (bestVal != null) out[field] = bestVal;
  }
  return out;
}

/**
 * Least-advanced *persisted* DB status among active members (Shipments group_status_floor).
 * CANCELLED is skipped; returns null when no active status or only one distinct active status
 * is not required here — callers check distinct count separately.
 */
function leastAdvancedPersistedStatus(rows: Record<string, unknown>[]): string | null {
  let best: string | null = null;
  let bestRank = Number.POSITIVE_INFINITY;
  for (const row of rows) {
    const status = String(row.status ?? '').trim().toUpperCase();
    if (!status) continue;
    const rank = SHIPMENT_STATUS_RANK[status];
    if (rank === undefined || rank < 0) continue;
    if (rank < bestRank) {
      bestRank = rank;
      best = status;
    }
  }
  return best;
}

function countDistinctActivePersistedStatuses(rows: Record<string, unknown>[]): number {
  const seen = new Set<string>();
  for (const row of rows) {
    const status = String(row.status ?? '').trim().toUpperCase();
    if (!status) continue;
    const rank = SHIPMENT_STATUS_RANK[status];
    if (rank === undefined || rank < 0) continue;
    seen.add(status);
  }
  return seen.size;
}

/**
 * Merge STO members like Shipments list: MAX milestones → derive once;
 * floor to least-advanced persisted DB status only when members disagree.
 */
export function mergeShippingPerfStoGroup(rows: Record<string, unknown>[]): Record<string, unknown> {
  const pick = rows.reduce((best, row) =>
    shippingPerfRowPriority(row) >= shippingPerfRowPriority(best) ? row : best,
  );

  const fromStoMetrics = pick.po_numbers != null || pick.contract_numbers != null;
  const metrics = fromStoMetrics
    ? {
        contractQty: Number(pick.contract_qty ?? 0),
        stoQty: Number(pick.sto_qty ?? 0),
        receivedQty: Number(pick.received_qty ?? 0),
        deliveredQty: Number(pick.delivered_qty ?? 0),
        planningQty: Number(pick.planning_qty ?? 0),
        outstandingQtyActual: Number(pick.outstanding_qty_actual ?? 0),
        outstandingQtyPlanning: Number(pick.outstanding_qty_planning ?? 0),
      }
    : mergePoMetricsFromRows(rows);

  const merged: Record<string, unknown> = {
    ...pick,
    ...maxMergeMilestoneFields(rows),
    sto_key: pick.sto_key ?? shippingPerfStoGroupKey(pick).replace(/^(sto:|ship:|op:|id:)/, ''),
    po_number:
      (pick.po_numbers as string | undefined) ??
      (joinDistinctValues(rows, 'po_number') || pick.po_number),
    contract_number:
      (pick.contract_numbers as string | undefined) ??
      (joinDistinctValues(rows, 'contract_number') || pick.contract_number),
    contract_ext_no: joinDistinctValues(rows, 'contract_ext_no') || pick.contract_ext_no,
    source_type: joinDistinctValues(rows, 'source_type') || pick.source_type,
    supplier: joinDistinctValues(rows, 'supplier') || pick.supplier,
    // One STO can span several contracts. Treat the group as still present if any member is,
    // so a partially-cancelled STO keeps counting rather than vanishing from the totals.
    sap_presence: rows.some((row) => String(row.sap_presence ?? 'PRESENT') !== 'WITHDRAWN')
      ? 'PRESENT'
      : 'WITHDRAWN',
    contract_qty: metrics.contractQty,
    sto_qty: metrics.stoQty,
    received_qty: metrics.receivedQty,
    delivered_qty: metrics.deliveredQty,
    planning_qty: metrics.planningQty,
    outstanding_qty_actual: metrics.outstandingQtyActual,
    outstanding_qty_planning: metrics.outstandingQtyPlanning,
    outstanding_qty: metrics.outstandingQtyActual,
    import_status:
      aggregateImportStatusForStoGroup(rows.map((row) => row.import_status)) ??
      pick.import_status,
  };

  const derived = deriveShippingPerfRowStatus(merged);
  const mixedDb = countDistinctActivePersistedStatuses(rows) > 1;
  const floor = leastAdvancedPersistedStatus(rows);
  const sapClosed = isContractDeliveryClosed(String(merged.import_status ?? ''));
  if (mixedDb && floor && !sapClosed) {
    const floorRank = SHIPMENT_STATUS_RANK[floor];
    const derivedRank = SHIPMENT_STATUS_RANK[String(derived).trim().toUpperCase()];
    if (
      floorRank !== undefined &&
      derivedRank !== undefined &&
      floorRank >= 0 &&
      floorRank < derivedRank
    ) {
      merged.status = floor;
      Object.assign(merged, computeShippingPerfDeltaFields(merged));
      return merged;
    }
  }
  merged.status = derived;
  Object.assign(merged, computeShippingPerfDeltaFields(merged));
  return merged;
}

/** Align status with Shipments page (ATA ladder + GR Close). Preserves CANCELLED. */
export function deriveShippingPerfRowStatus(row: Record<string, unknown>): string {
  if (String(row.status ?? '').trim().toUpperCase() === 'CANCELLED') {
    return 'CANCELLED';
  }
  return deriveShipmentStatus({
    eta_arrival_at_loading_port: row.loading_eta_arrival,
    eta_berthed_at_loading_port: row.loading_eta_berthed,
    eta_start_loading: row.loading_eta_start,
    eta_completed_loading: row.loading_eta_completed,
    eta_sailed_from_loading_port: row.loading_eta_sailed,
    eta_arrive_at_discharge_port: row.discharge_eta_arrival,
    eta_berthed_at_discharge_port: row.discharge_eta_berthed,
    eta_start_discharging: row.discharge_eta_start,
    eta_complete_discharge: row.discharge_eta_completed,
    ata_arrival_at_loading_port: row.loading_ata_arrival,
    ata_berthed_at_loading_port: row.loading_ata_berthed,
    ata_start_loading: row.loading_ata_start,
    ata_completed_loading: row.loading_ata_completed,
    ata_sailed_from_loading_port: row.loading_ata_sailed,
    ata_arrive_at_discharge_port: row.discharge_ata_arrival,
    ata_berthed_at_discharge_port: row.discharge_ata_berthed,
    ata_start_discharging: row.discharge_ata_start,
    ata_complete_discharge: row.discharge_ata_completed,
    contract_import_status: row.import_status,
    quantity_delivered: row.delivered_qty,
    quantity_delivered_klip: row.quantity_delivered_klip,
    quantity_delivered_sap: row.delivered_qty,
  });
}

export function applyShippingPerfDerivedStatuses(
  rows: Record<string, unknown>[],
): Record<string, unknown>[] {
  for (const row of rows) {
    row.status = deriveShippingPerfRowStatus(row);
  }
  return rows;
}

/** Collapse raw shipment rows to one row per STO with STO-level contract / outstanding qty. */
export function aggregateShippingPerformanceRowsBySto(
  rows: Record<string, unknown>[],
): Record<string, unknown>[] {
  // Keep persisted DB status until merge (Shipments floors on mixed DB status, then derives
  // from MAX-merged milestones). Do not derive before grouping.
  const groups = new Map<string, Record<string, unknown>[]>();
  for (const row of rows) {
    const key = shippingPerfStoGroupKey(row);
    const bucket = groups.get(key);
    if (bucket) bucket.push(row);
    else groups.set(key, [row]);
  }
  return [...groups.values()].map(mergeShippingPerfStoGroup);
}

/** @deprecated Use aggregateShippingPerformanceRowsBySto */
export function dedupeShippingPerformanceRows(
  rows: Record<string, unknown>[],
): Record<string, unknown>[] {
  return aggregateShippingPerformanceRowsBySto(rows);
}

export function invalidateShippingPerformanceRowCache(): void {
  ROW_CACHE.delete(ROW_CACHE_KEY);
  // If the page is in active use, rebuild the cache in the background so the next
  // viewer after an edit is served from memory instead of paying the full query cost.
  // Off the request path; falls back to a normal cold load if it fails.
  if (Date.now() - lastAccessedAt <= KEEP_WARM_MAX_IDLE_MS) {
    void warmShippingPerformanceRowCache();
  }
}

const SHIPPING_PERF_SEA_ROW_SCOPE = buildShipmentPageSeaRowScopeSql('c', 'l', 's');

const SHIPPING_PERFORMANCE_SQL = `
      WITH latest_spd_contract AS (
        SELECT DISTINCT ON (spd.contract_number)
          spd.contract_number,
          NULLIF(TRIM(COALESCE(
            spd.sto_number::text,
            spd.data->'raw'->>'STO No.',
            spd.data->'raw'->>'STO Number',
            spd.data->'shipment'->>'sto_no',
            spd.data->'contract'->>'sto_no'
          )), '') AS effective_sto,
          COALESCE(spd.data->'raw'->>'Contract Ext No', spd.data->>'Contract Ext No') AS contract_ext_no,
          UPPER(TRIM(COALESCE(
            spd.data->'contract'->>'contract_type',
            spd.data->>'B2B Flag',
            ''
          ))) AS b2b_flag,
          NULLIF(TRIM(COALESCE(
            spd.data->'contract'->>'contract_reference_po',
            spd.data->>'CONTRACT REFF PO',
            spd.data->>'Contract Reff PO Ini',
            spd.data->'raw'->>'Contract Reff PO Ini',
            spd.data->'raw'->>'CONTRACT REFF PO'
          )), '') AS contract_reference_po
        FROM sap_processed_data spd
        WHERE spd.contract_number IS NOT NULL AND TRIM(spd.contract_number) != ''
        ORDER BY spd.contract_number, spd.created_at DESC NULLS LAST
      ),
      ship_keys AS (
        SELECT
          s.id AS shipment_pk,
          c.contract_id,
          ${shippingPerfStoMetricsKeyExpr('c', 's')} AS sto_key
        FROM shipments s
        INNER JOIN contracts c ON s.contract_id = c.id
        LEFT JOIN latest_spd_contract l ON l.contract_number = c.contract_id
        WHERE ${SHIPPING_PERF_SEA_ROW_SCOPE}
      ),
      spd_keyed AS (
        SELECT
          sk.shipment_pk,
          spd.data
        FROM ship_keys sk
        INNER JOIN sap_processed_data spd ON
          NULLIF(TRIM(COALESCE(
            spd.sto_number::text,
            spd.data->'raw'->>'STO No.',
            spd.data->'raw'->>'STO Number',
            spd.data->'shipment'->>'sto_no',
            spd.data->'contract'->>'sto_no'
          )), '') = TRIM(sk.sto_key::text)
          AND (
            NULLIF(TRIM(spd.contract_number), '') IS NULL
            OR TRIM(spd.contract_number) = TRIM(sk.contract_id)
          )
      ),
      sap_agg AS (
        SELECT
          sk.shipment_pk,
          COALESCE(SUM(
            NULLIF(regexp_replace(COALESCE(
              NULLIF(TRIM(sk2.data->'contract'->>'sto_quantity'), ''),
              NULLIF(TRIM(sk2.data->'shipment'->>'sto_quantity'), ''),
              NULLIF(TRIM(sk2.data->'raw'->>'STO Quantity'), ''),
              NULLIF(TRIM(sk2.data->'raw'->>'sto quantity'), ''),
              ''
            ), '[^0-9\\.-]', '', 'g'), '')::numeric
          ), 0) AS sto_quantity,
          COALESCE(SUM(
            NULLIF(regexp_replace(COALESCE(
              NULLIF(TRIM(sk2.data->'raw'->>'Quantity Receive'), ''),
              NULLIF(TRIM(sk2.data->'raw'->>'Qty Receive'), ''),
              ''
            ), '[^0-9\\.-]', '', 'g'), '')::numeric
          ), 0) AS quantity_receive,
          COALESCE(SUM(
            NULLIF(regexp_replace(COALESCE(
              NULLIF(TRIM(sk2.data->'raw'->>'Quantity Delivered'), ''),
              NULLIF(TRIM(sk2.data->'raw'->>'Quantity Delivery'), ''),
              ''
            ), '[^0-9\\.-]', '', 'g'), '')::numeric
          ), 0) AS quantity_delivered_sap,
          MAX(NULLIF(TRIM(COALESCE(
            sk2.data->'raw'->>'Remarks',
            sk2.data->>'Remarks',
            sk2.data->'raw'->>'Remark',
            sk2.data->>'Remark'
          )), '')) AS remark,
          MAX(${sapSpdLoadingPortTextExpr('sk2')}) AS sap_vessel_loading_port_1,
          MAX(${sapSpdDischargePortTextExpr('sk2')}) AS sap_vessel_discharge_port,
          MAX(${sqlSapVesselNameFromSpdJsonb('sk2.data')}) AS vessel_name_sap
        FROM ship_keys sk
        LEFT JOIN spd_keyed sk2 ON sk2.shipment_pk = sk.shipment_pk
        GROUP BY sk.shipment_pk
      ),
      loading_port AS (
        SELECT DISTINCT ON (vlp.shipment_id)
          vlp.shipment_id,
          vlp.eta_vessel_arrival::date AS load_eta_arrival,
          vlp.eta_vessel_berthed_at_loading_port::date AS load_eta_berthed,
          vlp.eta_loading_start::date AS load_eta_start,
          vlp.eta_loading_completed::date AS load_eta_completed,
          vlp.eta_vessel_sailed::date AS load_eta_sailed,
          vlp.ata_vessel_arrival::date AS load_ata_arrival,
          vlp.ata_vessel_berthed::date AS load_ata_berthed,
          vlp.ata_loading_start::date AS load_ata_start,
          vlp.ata_loading_completed::date AS load_ata_completed,
          vlp.ata_vessel_sailed::date AS load_ata_sailed
        FROM vessel_loading_ports vlp
        WHERE COALESCE(vlp.is_discharge_port, false) = false
        ORDER BY vlp.shipment_id, vlp.port_sequence NULLS LAST, vlp.id
      ),
      discharge_port AS (
        SELECT DISTINCT ON (vlp.shipment_id)
          vlp.shipment_id,
          vlp.eta_vessel_arrive_at_discharge_port::date AS discharge_eta_arrival,
          vlp.eta_vessel_berthed_at_discharge_port::date AS discharge_eta_berthed,
          vlp.eta_vessel_start_discharging::date AS discharge_eta_start,
          vlp.eta_vessel_complete_discharge::date AS discharge_eta_completed,
          vlp.ata_vessel_arrival::date AS discharge_ata_arrival,
          vlp.ata_vessel_berthed::date AS discharge_ata_berthed,
          vlp.ata_loading_start::date AS discharge_ata_start,
          vlp.ata_loading_completed::date AS discharge_ata_completed
        FROM vessel_loading_ports vlp
        WHERE COALESCE(vlp.is_discharge_port, false) = true
        ORDER BY vlp.shipment_id, vlp.port_sequence NULLS LAST, vlp.id
      ),
      ${buildShippingPerfStoMetricsCte()}
      SELECT
        s.id,
        s.shipment_id,
        NULLIF(TRIM(s.operation_id), '') AS operation_id,
        ${SHIPPING_PERF_STO_GROUP_KEY_EXPR} AS sto_key,
        COALESCE(sm.contract_numbers, c.contract_id::text) AS contract_number,
        -- SAP presence of the owning contract, carried on the row: the page's cards are
        -- aggregated in JS from this same row set, so exclusion happens there while the
        -- table keeps showing the row.
        COALESCE(c.sap_presence, 'PRESENT') AS sap_presence,
        COALESCE(sm.po_numbers, c.po_number::text) AS po_number,
        sm.po_numbers,
        sm.contract_numbers,
        c.sto_number,
        l.contract_ext_no,
        c.contract_date::date AS contract_date,
        c.incoterm,
        c.product,
        c.source_type,
        c.supplier,
        ${sqlContractImportStatusForStoExpr('c', SHIPPING_PERF_STO_GROUP_KEY_EXPR)} AS import_status,
        COALESCE(sm.contract_qty, 0)::numeric AS contract_qty,
        ${sqlShipmentDisplayVesselName('sa.vessel_name_sap', 's.vessel_name')} AS vessel_name,
        s.status,
        COALESCE(
          NULLIF(TRIM(pnc.group_plant), ''),
          NULLIF(TRIM(pna.group_plant), ''),
          'Blank'
        ) AS plant_site,
        NULLIF(TRIM(s.port_of_loading), '') AS port_of_loading,
        NULLIF(TRIM(s.port_of_discharge), '') AS port_of_discharge,
        (
          SELECT NULLIF(TRIM(vlp.port_name), '')
          FROM vessel_loading_ports vlp
          WHERE vlp.shipment_id = s.id
            AND COALESCE(vlp.is_discharge_port, false) = false
          ORDER BY vlp.port_sequence NULLS LAST, vlp.id
          LIMIT 1
        ) AS vlp_loading_port_name,
        (
          SELECT NULLIF(TRIM(vlp.port_name), '')
          FROM vessel_loading_ports vlp
          WHERE vlp.shipment_id = s.id
            AND COALESCE(vlp.is_discharge_port, false) = true
          ORDER BY vlp.port_sequence NULLS LAST, vlp.id
          LIMIT 1
        ) AS vlp_discharge_port_name,
        sa.sap_vessel_loading_port_1,
        sa.sap_vessel_discharge_port,
        COALESCE(NULLIF(TRIM(s.port_of_loading), ''), 'Blank') AS loading_port,
        COALESCE(NULLIF(TRIM(s.port_of_discharge), ''), 'Blank') AS discharge_port,
        c.group_name,
        c.transport_mode,
        c.cargo_readiness_date::date AS cargo_readiness_date,
        COALESCE(lp.load_eta_arrival, s.eta_arrival::date) AS loading_eta_arrival,
        COALESCE(lp.load_eta_berthed, s.eta_berthed::date) AS loading_eta_berthed,
        COALESCE(lp.load_eta_start, s.eta_loading_start::date) AS loading_eta_start,
        COALESCE(lp.load_eta_completed, s.eta_loading_complete::date) AS loading_eta_completed,
        COALESCE(lp.load_eta_sailed, s.eta_sailed::date) AS loading_eta_sailed,
        COALESCE(dp.discharge_eta_arrival, s.eta_discharge_arrival::date) AS discharge_eta_arrival,
        COALESCE(dp.discharge_eta_berthed, s.eta_discharge_berthed::date) AS discharge_eta_berthed,
        COALESCE(dp.discharge_eta_start, s.eta_discharge_start::date) AS discharge_eta_start,
        COALESCE(dp.discharge_eta_completed, s.eta_discharge_complete::date) AS discharge_eta_completed,
        COALESCE(sao.ata_arrival, s.ata_arrival::date, lp.load_ata_arrival) AS loading_ata_arrival,
        COALESCE(sao.ata_berthed, s.ata_berthed::date, lp.load_ata_berthed) AS loading_ata_berthed,
        COALESCE(sao.ata_loading_start, s.ata_loading_start::date, lp.load_ata_start) AS loading_ata_start,
        COALESCE(sao.ata_loading_complete, s.ata_loading_complete::date, lp.load_ata_completed) AS loading_ata_completed,
        COALESCE(sao.ata_sailed, s.ata_sailed::date, lp.load_ata_sailed) AS loading_ata_sailed,
        COALESCE(sao.ata_discharge_arrival, s.ata_discharge_arrival::date, dp.discharge_ata_arrival) AS discharge_ata_arrival,
        COALESCE(sao.ata_discharge_berthed, s.ata_discharge_berthed::date, dp.discharge_ata_berthed) AS discharge_ata_berthed,
        COALESCE(sao.ata_discharge_start, s.ata_discharge_start::date, dp.discharge_ata_start) AS discharge_ata_start,
        COALESCE(sao.ata_discharge_complete, s.ata_discharge_complete::date, dp.discharge_ata_completed) AS discharge_ata_completed,
        (COALESCE(lp.load_eta_arrival, s.eta_arrival::date) - c.cargo_readiness_date::date)::int AS loading_delta_eta_etr_days,
        (COALESCE(lp.load_eta_arrival, s.eta_arrival::date) - COALESCE(lp.load_eta_berthed, s.eta_berthed::date))::int AS loading_delta_eta_etb_days,
        (COALESCE(lp.load_eta_berthed, s.eta_berthed::date) - COALESCE(lp.load_eta_completed, s.eta_loading_complete::date))::int AS loading_delta_etb_etc_days,
        (COALESCE(dp.discharge_eta_arrival, s.eta_discharge_arrival::date) - COALESCE(dp.discharge_eta_berthed, s.eta_discharge_berthed::date))::int AS discharge_delta_eta_etb_days,
        (COALESCE(dp.discharge_eta_berthed, s.eta_discharge_berthed::date) - COALESCE(dp.discharge_eta_completed, s.eta_discharge_complete::date))::int AS discharge_delta_etb_etc_days,
        CASE
          WHEN (COALESCE(lp.load_eta_arrival, s.eta_arrival::date) - c.cargo_readiness_date::date) IS NULL
            AND (COALESCE(lp.load_eta_arrival, s.eta_arrival::date) - COALESCE(lp.load_eta_berthed, s.eta_berthed::date)) IS NULL
            AND (COALESCE(lp.load_eta_berthed, s.eta_berthed::date) - COALESCE(lp.load_eta_completed, s.eta_loading_complete::date)) IS NULL
            AND (COALESCE(dp.discharge_eta_arrival, s.eta_discharge_arrival::date) - COALESCE(dp.discharge_eta_berthed, s.eta_discharge_berthed::date)) IS NULL
            AND (COALESCE(dp.discharge_eta_berthed, s.eta_discharge_berthed::date) - COALESCE(dp.discharge_eta_completed, s.eta_discharge_complete::date)) IS NULL
          THEN NULL
          ELSE (
            COALESCE((COALESCE(lp.load_eta_arrival, s.eta_arrival::date) - c.cargo_readiness_date::date), 0) +
            COALESCE((COALESCE(lp.load_eta_arrival, s.eta_arrival::date) - COALESCE(lp.load_eta_berthed, s.eta_berthed::date)), 0) +
            COALESCE((COALESCE(lp.load_eta_berthed, s.eta_berthed::date) - COALESCE(lp.load_eta_completed, s.eta_loading_complete::date)), 0) +
            COALESCE((COALESCE(dp.discharge_eta_arrival, s.eta_discharge_arrival::date) - COALESCE(dp.discharge_eta_berthed, s.eta_discharge_berthed::date)), 0) +
            COALESCE((COALESCE(dp.discharge_eta_berthed, s.eta_discharge_berthed::date) - COALESCE(dp.discharge_eta_completed, s.eta_discharge_complete::date)), 0)
          )::int
        END AS total_delta_days,
        (COALESCE(sao.ata_arrival, s.ata_arrival::date, lp.load_ata_arrival) - c.cargo_readiness_date::date)::int AS ata_loading_delta_eta_etr_days,
        (COALESCE(sao.ata_arrival, s.ata_arrival::date, lp.load_ata_arrival) - COALESCE(sao.ata_berthed, s.ata_berthed::date, lp.load_ata_berthed))::int AS ata_loading_delta_eta_etb_days,
        (COALESCE(sao.ata_berthed, s.ata_berthed::date, lp.load_ata_berthed) - COALESCE(sao.ata_loading_complete, s.ata_loading_complete::date, lp.load_ata_completed))::int AS ata_loading_delta_etb_etc_days,
        (COALESCE(sao.ata_discharge_arrival, s.ata_discharge_arrival::date, dp.discharge_ata_arrival) - COALESCE(sao.ata_discharge_berthed, s.ata_discharge_berthed::date, dp.discharge_ata_berthed))::int AS ata_discharge_delta_eta_etb_days,
        (COALESCE(sao.ata_discharge_berthed, s.ata_discharge_berthed::date, dp.discharge_ata_berthed) - COALESCE(sao.ata_discharge_complete, s.ata_discharge_complete::date, dp.discharge_ata_completed))::int AS ata_discharge_delta_etb_etc_days,
        CASE
          WHEN (COALESCE(sao.ata_arrival, s.ata_arrival::date, lp.load_ata_arrival) - c.cargo_readiness_date::date) IS NULL
            AND (COALESCE(sao.ata_arrival, s.ata_arrival::date, lp.load_ata_arrival) - COALESCE(sao.ata_berthed, s.ata_berthed::date, lp.load_ata_berthed)) IS NULL
            AND (COALESCE(sao.ata_berthed, s.ata_berthed::date, lp.load_ata_berthed) - COALESCE(sao.ata_loading_complete, s.ata_loading_complete::date, lp.load_ata_completed)) IS NULL
            AND (COALESCE(sao.ata_discharge_arrival, s.ata_discharge_arrival::date, dp.discharge_ata_arrival) - COALESCE(sao.ata_discharge_berthed, s.ata_discharge_berthed::date, dp.discharge_ata_berthed)) IS NULL
            AND (COALESCE(sao.ata_discharge_berthed, s.ata_discharge_berthed::date, dp.discharge_ata_berthed) - COALESCE(sao.ata_discharge_complete, s.ata_discharge_complete::date, dp.discharge_ata_completed)) IS NULL
          THEN NULL
          ELSE (
            COALESCE((COALESCE(sao.ata_arrival, s.ata_arrival::date, lp.load_ata_arrival) - c.cargo_readiness_date::date), 0) +
            COALESCE((COALESCE(sao.ata_arrival, s.ata_arrival::date, lp.load_ata_arrival) - COALESCE(sao.ata_berthed, s.ata_berthed::date, lp.load_ata_berthed)), 0) +
            COALESCE((COALESCE(sao.ata_berthed, s.ata_berthed::date, lp.load_ata_berthed) - COALESCE(sao.ata_loading_complete, s.ata_loading_complete::date, lp.load_ata_completed)), 0) +
            COALESCE((COALESCE(sao.ata_discharge_arrival, s.ata_discharge_arrival::date, dp.discharge_ata_arrival) - COALESCE(sao.ata_discharge_berthed, s.ata_discharge_berthed::date, dp.discharge_ata_berthed)), 0) +
            COALESCE((COALESCE(sao.ata_discharge_berthed, s.ata_discharge_berthed::date, dp.discharge_ata_berthed) - COALESCE(sao.ata_discharge_complete, s.ata_discharge_complete::date, dp.discharge_ata_completed)), 0)
          )::int
        END AS ata_total_delta_days,
        sa.remark,
        COALESCE(sm.sto_qty, 0)::numeric AS sto_qty,
        COALESCE((
          ${sqlShipmentResolvedReceiveKg(
            sqlIsContractSapClosedForStoExpr('c', SHIPPING_PERF_STO_GROUP_KEY_EXPR),
            's.actual_vessel_qty_receive',
            'COALESCE(sm.received_qty, 0)',
          )}
        ), 0)::numeric AS received_qty,
        COALESCE((
          ${sqlShipmentResolvedDeliveryKg(
            sqlIsContractSapClosedForStoExpr('c', SHIPPING_PERF_STO_GROUP_KEY_EXPR),
            's.quantity_delivered_klip',
            'COALESCE(sm.delivered_qty, 0)',
            's.quantity_delivered',
          )}
        ), 0)::numeric AS delivered_qty,
        COALESCE(sm.planning_qty, 0)::numeric AS planning_qty,
        COALESCE(sm.outstanding_qty_actual, 0)::numeric AS outstanding_qty_actual,
        COALESCE(sm.outstanding_qty_planning, 0)::numeric AS outstanding_qty_planning,
        COALESCE(sm.outstanding_qty_actual, 0)::numeric AS outstanding_qty
      FROM shipments s
      INNER JOIN contracts c ON s.contract_id = c.id
      ${SHIPMENT_ATA_OVERRIDES_JOIN}
      LEFT JOIN latest_spd_contract l ON l.contract_number = c.contract_id
      LEFT JOIN sto_metrics sm ON TRIM(sm.sto_key) = TRIM((${SHIPPING_PERF_STO_GROUP_KEY_EXPR}))
      LEFT JOIN sap_agg sa ON sa.shipment_pk = s.id
      LEFT JOIN loading_port lp ON lp.shipment_id = s.id
      LEFT JOIN discharge_port dp ON dp.shipment_id = s.id
      LEFT JOIN LATERAL (
        SELECT mp.group_plant
        FROM master_plants mp
        WHERE TRIM(UPPER(COALESCE(mp.plant_code, ''))) = TRIM(UPPER(COALESCE(c.plant_code, '')))
          AND NULLIF(TRIM(mp.plant_name), '') IS NOT NULL
          AND NULLIF(TRIM(c.company_name), '') IS NOT NULL
          AND TRIM(UPPER(COALESCE(mp.company_name, ''))) = TRIM(UPPER(COALESCE(c.company_name, '')))
        ORDER BY mp.updated_at DESC NULLS LAST
        LIMIT 1
      ) pnc ON TRUE
      LEFT JOIN LATERAL (
        SELECT mp.group_plant
        FROM master_plants mp
        WHERE TRIM(UPPER(COALESCE(mp.plant_code, ''))) = TRIM(UPPER(COALESCE(c.plant_code, '')))
          AND NULLIF(TRIM(mp.plant_name), '') IS NOT NULL
        ORDER BY mp.updated_at DESC NULLS LAST
        LIMIT 1
      ) pna ON TRUE
      WHERE ${SHIPPING_PERF_SEA_ROW_SCOPE}
        AND COALESCE(s.status, '') <> 'CANCELLED'
        AND NOT (
          l.contract_number IS NOT NULL
          AND COALESCE(l.b2b_flag, '') = 'B2B'
          AND l.contract_reference_po IS NOT NULL
        )
      -- id tiebreaker: bulk-imported shipments share created_at, so without it row order
      -- among ties is plan-dependent, and the STO-group merge picks fields from the last
      -- tied row it sees. Ties keep a stable order now.
      ORDER BY s.created_at DESC, s.id DESC`;

function parseStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((v) => String(v).trim()).filter(Boolean);
  }
  if (typeof value === 'string' && value.trim()) {
    return value.split(',').map((v) => v.trim()).filter(Boolean);
  }
  return [];
}

export function parseShippingPerformanceFilters(req: AuthRequest): ShippingPerformanceFilters {
  const scope = String((req.query as any).scope ?? 'ytd').toLowerCase();
  const now = new Date();
  const y = now.getFullYear();
  const ytdFrom = `${y}-01-01`;
  const ytdTo = `${y}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  const dateFrom = String((req.query as any).dateFrom ?? ytdFrom).slice(0, 10);
  const dateTo = String((req.query as any).dateTo ?? ytdTo).slice(0, 10);
  const incoterms = parseStringArray((req.query as any).incoterm ?? (req.query as any).incoterms);
  const plants = parseStringArray((req.query as any).plant ?? (req.query as any).plants);

  const cacheKey = JSON.stringify({ scope, dateFrom, dateTo, incoterms: [...incoterms].sort(), plants: [...plants].sort() });

  return { scope, dateFrom, dateTo, incoterms, plants, cacheKey };
}

function filterGlobalRows(rows: Record<string, unknown>[], filters: ShippingPerformanceFilters): Record<string, unknown>[] {
  return rows.filter((row) => {
    const inc = String(row.incoterm || '').trim() || 'Blank';
    if (filters.incoterms.length > 0 && !filters.incoterms.includes(inc)) return false;
    const plant = String(row.plant_site || '').trim() || 'Blank';
    if (filters.plants.length > 0 && !filters.plants.includes(plant)) return false;
    const cDate = toIsoDate10FromCell(row.contract_date) ?? '';
    if (filters.dateFrom && cDate && cDate < filters.dateFrom) return false;
    if (filters.dateTo && cDate && cDate > filters.dateTo) return false;
    return true;
  });
}

type SummaryMode = 'eta' | 'ata';

function deltaField(mode: SummaryMode, etaField: string): string {
  return mode === 'ata' ? `ata_${etaField}` : etaField;
}

function buildPerVesselSummary(rows: Record<string, unknown>[], mode: SummaryMode): PerVesselPerfSummary {
  const byVessel = new Map<string, Record<string, unknown>[]>();
  for (const row of rows) {
    const vessel = String(row.vessel_name || '').trim() || 'Unknown';
    const bucket = byVessel.get(vessel);
    if (bucket) bucket.push(row);
    else byVessel.set(vessel, [row]);
  }

  let rowCount = 0;
  let totalQty = 0;
  let sumLoadingEtaEtr = 0;
  let sumLoadingEtaEtb = 0;
  let sumLoadingEtbEtc = 0;
  let sumDischargeEtaEtb = 0;
  let sumDischargeEtbEtc = 0;
  let sumTotalDelta = 0;
  const contracts = new Set<string>();

  for (const vesselRows of byVessel.values()) {
    for (const row of vesselRows) {
      rowCount += 1;
      const contractNumber = String(row.contract_number || '').trim();
      if (contractNumber) contracts.add(contractNumber);
      totalQty += Number(row.outstanding_qty_actual ?? row.outstanding_qty ?? 0);
      sumLoadingEtaEtr += Number(row[deltaField(mode, 'loading_delta_eta_etr_days')] ?? 0);
      sumLoadingEtaEtb += Number(row[deltaField(mode, 'loading_delta_eta_etb_days')] ?? 0);
      sumLoadingEtbEtc += Number(row[deltaField(mode, 'loading_delta_etb_etc_days')] ?? 0);
      sumDischargeEtaEtb += Number(row[deltaField(mode, 'discharge_delta_eta_etb_days')] ?? 0);
      sumDischargeEtbEtc += Number(row[deltaField(mode, 'discharge_delta_etb_etc_days')] ?? 0);
      sumTotalDelta += Number(row[mode === 'ata' ? 'ata_total_delta_days' : 'total_delta_days'] ?? 0);
    }
  }

  if (rowCount === 0) return { ...EMPTY_SUMMARY };

  return {
    vesselCount: byVessel.size,
    contractCount: contracts.size,
    totalQty,
    avgLoadingEtaEtr: sumLoadingEtaEtr / rowCount,
    avgLoadingEtaEtb: sumLoadingEtaEtb / rowCount,
    avgLoadingEtbEtc: sumLoadingEtbEtc / rowCount,
    avgDischargeEtaEtb: sumDischargeEtaEtb / rowCount,
    avgDischargeEtbEtc: sumDischargeEtbEtc / rowCount,
    avgTotalDelta: sumTotalDelta / rowCount,
  };
}

function matchesPerfDrilldownRow(row: Record<string, unknown>): boolean {
  if (String(row.status || '').trim().toUpperCase() === 'COMPLETED') return false;
  if (Number(row.outstanding_qty_actual ?? row.outstanding_qty ?? 0) <= 0) return false;
  return true;
}

function buildPerfTree(rows: Record<string, unknown>[]): ShippingPerfTreeNode[] {
  type VesMap = Map<string, { count: number; totalQty: number }>;
  type IncMap = Map<string, { count: number; totalQty: number; vessels: VesMap }>;
  type PlantMap = Map<string, { count: number; totalQty: number; incoterms: IncMap }>;
  type ProdMap = Map<string, { count: number; totalQty: number; plants: PlantMap }>;
  const root: ProdMap = new Map();

  for (const row of rows) {
    if (!matchesPerfDrilldownRow(row)) continue;
    const prod = String(row.product || '').trim() || 'Blank';
    const plant = String(row.plant_site || '').trim() || 'Blank';
    const inc = String(row.incoterm || '').trim() || 'Blank';
    const ves = String(row.vessel_name || '').trim() || 'Unknown';
    const qty = Number(row.outstanding_qty_actual ?? row.outstanding_qty ?? 0);

    if (!root.has(prod)) root.set(prod, { count: 0, totalQty: 0, plants: new Map() });
    const pN = root.get(prod)!;
    pN.count += 1;
    pN.totalQty += qty;
    if (!pN.plants.has(plant)) pN.plants.set(plant, { count: 0, totalQty: 0, incoterms: new Map() });
    const plN = pN.plants.get(plant)!;
    plN.count += 1;
    plN.totalQty += qty;
    if (!plN.incoterms.has(inc)) plN.incoterms.set(inc, { count: 0, totalQty: 0, vessels: new Map() });
    const iN = plN.incoterms.get(inc)!;
    iN.count += 1;
    iN.totalQty += qty;
    if (!iN.vessels.has(ves)) iN.vessels.set(ves, { count: 0, totalQty: 0 });
    const vN = iN.vessels.get(ves)!;
    vN.count += 1;
    vN.totalQty += qty;
  }

  const srt = <T,>(m: Map<string, T & { totalQty: number }>) =>
    [...m.entries()].sort((a, b) => b[1].totalQty - a[1].totalQty);

  return srt(root).map(([prod, pN]) => ({
    key: prod,
    count: pN.count,
    totalQty: pN.totalQty,
    children: srt(pN.plants).map(([plant, plN]) => ({
      key: plant,
      count: plN.count,
      totalQty: plN.totalQty,
      children: srt(plN.incoterms).map(([inc, iN]) => ({
        key: inc,
        count: iN.count,
        totalQty: iN.totalQty,
        children: srt(iN.vessels).map(([ves, vN]) => ({
          key: ves,
          count: vN.count,
          totalQty: vN.totalQty,
          children: [],
        })),
      })),
    })),
  }));
}

function buildRemarksList(rows: Record<string, unknown>[]): ShippingPerfRemark[] {
  return rows
    .map((row) => ({
      shipment_id: String(row.shipment_id || ''),
      vessel_name: String(row.vessel_name || '').trim() || 'Unknown',
      contract_number: String(row.contract_number || ''),
      remark: String(row.remark || '').trim(),
    }))
    .filter((item) => item.remark)
    .sort((a, b) => a.vessel_name.localeCompare(b.vessel_name) || a.shipment_id.localeCompare(b.shipment_id));
}

/** Run the query and repopulate the cache. Concurrent callers share one execution. */
function refreshShippingPerformanceRows(): Promise<Record<string, unknown>[]> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    try {
      const result = await query(SHIPPING_PERFORMANCE_SQL);
      const rows = aggregateShippingPerformanceRowsBySto(result.rows as Record<string, unknown>[]);
      ROW_CACHE.set(ROW_CACHE_KEY, { rows, expiresAt: Date.now() + CACHE_TTL_MS });
      return rows;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

async function loadShippingPerformanceRows(): Promise<Record<string, unknown>[]> {
  lastAccessedAt = Date.now();
  const cached = ROW_CACHE.get(ROW_CACHE_KEY);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.rows;
  }

  // Cold (empty/expired) cache: run now and return fresh rows, exactly as before.
  // Concurrent cold requests are de-duplicated so they don't stampede the DB.
  return refreshShippingPerformanceRows();
}

/** Pre-populate the row cache off the request path (startup + background warmer). */
export async function warmShippingPerformanceRowCache(): Promise<void> {
  try {
    await refreshShippingPerformanceRows();
  } catch {
    // Warming is best-effort; a failed warm just means the next request runs cold.
  }
}

/**
 * Start a lightweight background warmer so the first visitor after a restart or an
 * idle gap does not pay the full query cost. It only refreshes while the page is in
 * active use, and renews the cache shortly before its TTL so users are always served
 * from memory. Data freshness is unchanged (cache is still at most CACHE_TTL_MS old).
 */
export function startShippingPerformanceCacheWarmer(): void {
  void warmShippingPerformanceRowCache();
  if (keepWarmTimer) return;
  keepWarmTimer = setInterval(() => {
    if (Date.now() - lastAccessedAt > KEEP_WARM_MAX_IDLE_MS) return;
    if (refreshInFlight) return;
    const cached = ROW_CACHE.get(ROW_CACHE_KEY);
    const ageMs = cached ? CACHE_TTL_MS - (cached.expiresAt - Date.now()) : Number.POSITIVE_INFINITY;
    if (ageMs >= KEEP_WARM_REFRESH_AFTER_MS) {
      void warmShippingPerformanceRowCache();
    }
  }, KEEP_WARM_CHECK_MS);
  // Do not keep the event loop alive solely for the warmer.
  keepWarmTimer.unref?.();
}

export function stopShippingPerformanceCacheWarmer(): void {
  if (keepWarmTimer) {
    clearInterval(keepWarmTimer);
    keepWarmTimer = null;
  }
}

function distinctValues(rows: Record<string, unknown>[], key: string): string[] {
  return [...new Set(rows.map((r) => String(r[key] || '').trim() || 'Blank'))].sort((a, b) => a.localeCompare(b));
}

export async function runShippingPerformance(req: AuthRequest, part: ShippingPerformancePart) {
  const filters = parseShippingPerformanceFilters(req);
  const rows = await loadShippingPerformanceRows();
  const filteredRows = filterGlobalRows(rows, filters);

  if (part === 'rows') {
    // The table keeps showing SAP-withdrawn rows (badged client-side) so their history stays
    // reachable; only the aggregates below drop them.
    return { rows: filteredRows };
  }

  // Contracts whose PO was cancelled/deleted in SAP must not contribute to the performance
  // cards or the drilldown tree - they can never complete, so they would skew every average.
  const countableRows = filteredRows.filter(
    (row) => String(row.sap_presence ?? 'PRESENT') !== 'WITHDRAWN',
  );

  if (part === 'summary') {
    return {
      etaSummary: buildPerVesselSummary(countableRows, 'eta'),
      ataSummary: buildPerVesselSummary(countableRows, 'ata'),
      meta: {
        incoterms: distinctValues(rows, 'incoterm'),
        plantSites: distinctValues(rows, 'plant_site'),
      },
    };
  }

  return {
    tree: buildPerfTree(countableRows),
    remarks: buildRemarksList(countableRows),
  };
}
