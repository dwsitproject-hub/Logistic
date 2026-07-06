import { query } from '../database/connection';
import { AuthRequest } from '../middleware/auth';
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
  shippingPerfOperationalStoKeyExpr,
  shippingPerfStoGroupKeyFromRow,
} from '../utils/shippingPerformanceStoSql';
import {
  sqlSapVesselNameFromSpdJsonb,
  sqlShipmentDisplayVesselName,
} from '../utils/sapVesselFields';

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
const ROW_CACHE_KEY = 'shipping-performance-rows-v26';

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

function mergeShippingPerfStoGroup(rows: Record<string, unknown>[]): Record<string, unknown> {
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

  return {
    ...pick,
    sto_key: pick.sto_key ?? shippingPerfStoGroupKey(pick).replace(/^(sto:|ship:|op:|id:)/, ''),
    po_number:
      (pick.po_numbers as string | undefined) ??
      (joinDistinctValues(rows, 'po_number') || pick.po_number),
    contract_number:
      (pick.contract_numbers as string | undefined) ??
      (joinDistinctValues(rows, 'contract_number') || pick.contract_number),
    contract_ext_no: joinDistinctValues(rows, 'contract_ext_no') || pick.contract_ext_no,
    contract_qty: metrics.contractQty,
    sto_qty: metrics.stoQty,
    received_qty: metrics.receivedQty,
    delivered_qty: metrics.deliveredQty,
    planning_qty: metrics.planningQty,
    outstanding_qty_actual: metrics.outstandingQtyActual,
    outstanding_qty_planning: metrics.outstandingQtyPlanning,
    outstanding_qty: metrics.outstandingQtyActual,
  };
}

/** Collapse raw shipment rows to one row per STO with STO-level contract / outstanding qty. */
export function aggregateShippingPerformanceRowsBySto(
  rows: Record<string, unknown>[],
): Record<string, unknown>[] {
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
}

const SHIPPING_PERFORMANCE_SQL = `
      WITH latest_spd_contract AS (
        SELECT DISTINCT ON (spd.contract_number)
          spd.contract_number,
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
          ${shippingPerfOperationalStoKeyExpr('c', 's')} AS sto_key
        FROM shipments s
        INNER JOIN contracts c ON s.contract_id = c.id
        WHERE UPPER(COALESCE(NULLIF(TRIM(c.transport_mode), ''), 'SEA')) IN ('SEA', 'MIX')
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
          vlp.eta_loading_completed::date AS load_eta_completed,
          vlp.ata_vessel_arrival::date AS load_ata_arrival,
          vlp.ata_vessel_berthed::date AS load_ata_berthed,
          vlp.ata_loading_completed::date AS load_ata_completed
        FROM vessel_loading_ports vlp
        WHERE COALESCE(vlp.is_discharge_port, false) = false
        ORDER BY vlp.shipment_id, vlp.port_sequence NULLS LAST, vlp.id
      ),
      discharge_port AS (
        SELECT DISTINCT ON (vlp.shipment_id)
          vlp.shipment_id,
          vlp.eta_vessel_arrive_at_discharge_port::date AS discharge_eta_arrival,
          vlp.eta_vessel_berthed_at_discharge_port::date AS discharge_eta_berthed,
          vlp.eta_vessel_complete_discharge::date AS discharge_eta_completed,
          vlp.ata_vessel_arrival::date AS discharge_ata_arrival,
          vlp.ata_vessel_berthed::date AS discharge_ata_berthed,
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
        COALESCE(sm.po_numbers, c.po_number::text) AS po_number,
        sm.po_numbers,
        sm.contract_numbers,
        c.sto_number,
        l.contract_ext_no,
        c.contract_date::date AS contract_date,
        c.incoterm,
        c.product,
        c.supplier,
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
        COALESCE(lp.load_eta_completed, s.eta_loading_complete::date) AS loading_eta_completed,
        COALESCE(dp.discharge_eta_arrival, s.eta_discharge_arrival::date) AS discharge_eta_arrival,
        COALESCE(dp.discharge_eta_berthed, s.eta_discharge_berthed::date) AS discharge_eta_berthed,
        COALESCE(dp.discharge_eta_completed, s.eta_discharge_complete::date) AS discharge_eta_completed,
        COALESCE(lp.load_ata_arrival, s.ata_arrival::date) AS loading_ata_arrival,
        COALESCE(lp.load_ata_berthed, s.ata_berthed::date) AS loading_ata_berthed,
        COALESCE(lp.load_ata_completed, s.ata_loading_complete::date) AS loading_ata_completed,
        COALESCE(dp.discharge_ata_arrival, s.ata_discharge_arrival::date) AS discharge_ata_arrival,
        COALESCE(dp.discharge_ata_berthed, s.ata_discharge_berthed::date) AS discharge_ata_berthed,
        COALESCE(dp.discharge_ata_completed, s.ata_discharge_complete::date) AS discharge_ata_completed,
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
        (COALESCE(lp.load_ata_arrival, s.ata_arrival::date) - c.cargo_readiness_date::date)::int AS ata_loading_delta_eta_etr_days,
        (COALESCE(lp.load_ata_arrival, s.ata_arrival::date) - COALESCE(lp.load_ata_berthed, s.ata_berthed::date))::int AS ata_loading_delta_eta_etb_days,
        (COALESCE(lp.load_ata_berthed, s.ata_berthed::date) - COALESCE(lp.load_ata_completed, s.ata_loading_complete::date))::int AS ata_loading_delta_etb_etc_days,
        (COALESCE(dp.discharge_ata_arrival, s.ata_discharge_arrival::date) - COALESCE(dp.discharge_ata_berthed, s.ata_discharge_berthed::date))::int AS ata_discharge_delta_eta_etb_days,
        (COALESCE(dp.discharge_ata_berthed, s.ata_discharge_berthed::date) - COALESCE(dp.discharge_ata_completed, s.ata_discharge_complete::date))::int AS ata_discharge_delta_etb_etc_days,
        CASE
          WHEN (COALESCE(lp.load_ata_arrival, s.ata_arrival::date) - c.cargo_readiness_date::date) IS NULL
            AND (COALESCE(lp.load_ata_arrival, s.ata_arrival::date) - COALESCE(lp.load_ata_berthed, s.ata_berthed::date)) IS NULL
            AND (COALESCE(lp.load_ata_berthed, s.ata_berthed::date) - COALESCE(lp.load_ata_completed, s.ata_loading_complete::date)) IS NULL
            AND (COALESCE(dp.discharge_ata_arrival, s.ata_discharge_arrival::date) - COALESCE(dp.discharge_ata_berthed, s.ata_discharge_berthed::date)) IS NULL
            AND (COALESCE(dp.discharge_ata_berthed, s.ata_discharge_berthed::date) - COALESCE(dp.discharge_ata_completed, s.ata_discharge_complete::date)) IS NULL
          THEN NULL
          ELSE (
            COALESCE((COALESCE(lp.load_ata_arrival, s.ata_arrival::date) - c.cargo_readiness_date::date), 0) +
            COALESCE((COALESCE(lp.load_ata_arrival, s.ata_arrival::date) - COALESCE(lp.load_ata_berthed, s.ata_berthed::date)), 0) +
            COALESCE((COALESCE(lp.load_ata_berthed, s.ata_berthed::date) - COALESCE(lp.load_ata_completed, s.ata_loading_complete::date)), 0) +
            COALESCE((COALESCE(dp.discharge_ata_arrival, s.ata_discharge_arrival::date) - COALESCE(dp.discharge_ata_berthed, s.ata_discharge_berthed::date)), 0) +
            COALESCE((COALESCE(dp.discharge_ata_berthed, s.ata_discharge_berthed::date) - COALESCE(dp.discharge_ata_completed, s.ata_discharge_complete::date)), 0)
          )::int
        END AS ata_total_delta_days,
        sa.remark,
        COALESCE(sm.sto_qty, 0)::numeric AS sto_qty,
        COALESCE(sm.received_qty, 0)::numeric AS received_qty,
        COALESCE(sm.delivered_qty, 0)::numeric AS delivered_qty,
        COALESCE(sm.planning_qty, 0)::numeric AS planning_qty,
        COALESCE(sm.outstanding_qty_actual, 0)::numeric AS outstanding_qty_actual,
        COALESCE(sm.outstanding_qty_planning, 0)::numeric AS outstanding_qty_planning,
        COALESCE(sm.outstanding_qty_actual, 0)::numeric AS outstanding_qty
      FROM shipments s
      INNER JOIN contracts c ON s.contract_id = c.id
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
      WHERE UPPER(COALESCE(NULLIF(TRIM(c.transport_mode), ''), 'SEA')) IN ('SEA', 'MIX')
        AND COALESCE(s.status, '') <> 'CANCELLED'
        AND NOT (
          l.contract_number IS NOT NULL
          AND COALESCE(l.b2b_flag, '') = 'B2B'
          AND l.contract_reference_po IS NOT NULL
        )
      ORDER BY s.created_at DESC`;

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

async function loadShippingPerformanceRows(): Promise<Record<string, unknown>[]> {
  const cached = ROW_CACHE.get(ROW_CACHE_KEY);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.rows;
  }

  const result = await query(SHIPPING_PERFORMANCE_SQL);
  const rows = aggregateShippingPerformanceRowsBySto(result.rows as Record<string, unknown>[]);
  ROW_CACHE.set(ROW_CACHE_KEY, { rows, expiresAt: Date.now() + CACHE_TTL_MS });
  return rows;
}

function distinctValues(rows: Record<string, unknown>[], key: string): string[] {
  return [...new Set(rows.map((r) => String(r[key] || '').trim() || 'Blank'))].sort((a, b) => a.localeCompare(b));
}

export async function runShippingPerformance(req: AuthRequest, part: ShippingPerformancePart) {
  const filters = parseShippingPerformanceFilters(req);
  const rows = await loadShippingPerformanceRows();
  const filteredRows = filterGlobalRows(rows, filters);

  if (part === 'rows') {
    return { rows: filteredRows };
  }

  if (part === 'summary') {
    return {
      etaSummary: buildPerVesselSummary(filteredRows, 'eta'),
      ataSummary: buildPerVesselSummary(filteredRows, 'ata'),
      meta: {
        incoterms: distinctValues(rows, 'incoterm'),
        plantSites: distinctValues(rows, 'plant_site'),
      },
    };
  }

  return {
    tree: buildPerfTree(filteredRows),
    remarks: buildRemarksList(filteredRows),
  };
}
