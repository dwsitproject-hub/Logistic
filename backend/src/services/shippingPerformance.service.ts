import { query } from '../database/connection';
import { AuthRequest } from '../middleware/auth';

export type ShippingPerformancePart = 'summary' | 'tree' | 'rows';

export interface ShippingPerformanceFilters {
  scope: string;
  dateFrom: string;
  dateTo: string;
  statusFilter: string;
  incoterms: string[];
  plants: string[];
  lateOnTimeFilter: string;
  cacheKey: string;
}

export interface ShippingPerfSummary {
  count: number;
  totalQty: number;
  avgLoadingEtaEtr: number;
  avgLoadingEtaEtb: number;
  avgLoadingEtbEtc: number;
  avgDischargeEtaEtb: number;
  avgDischargeEtbEtc: number;
  avgTotalDelta: number;
  openOutstandingQty: number;
  closeOutstandingQty: number;
}

export interface ShippingPerfTreeNode {
  key: string;
  count: number;
  totalQty: number;
  children: ShippingPerfTreeNode[];
}

const EMPTY_SUMMARY: ShippingPerfSummary = {
  count: 0,
  totalQty: 0,
  avgLoadingEtaEtr: 0,
  avgLoadingEtaEtb: 0,
  avgLoadingEtbEtc: 0,
  avgDischargeEtaEtb: 0,
  avgDischargeEtbEtc: 0,
  avgTotalDelta: 0,
  openOutstandingQty: 0,
  closeOutstandingQty: 0,
};

const ROW_CACHE = new Map<string, { rows: Record<string, unknown>[]; expiresAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000;

const SHIPPING_PERFORMANCE_SQL = `
      WITH latest_spd_contract AS (
        SELECT DISTINCT ON (spd.contract_number)
          spd.contract_number,
          COALESCE(spd.data->'raw'->>'Contract Ext No', spd.data->>'Contract Ext No') AS contract_ext_no
        FROM sap_processed_data spd
        WHERE spd.contract_number IS NOT NULL AND TRIM(spd.contract_number) != ''
        ORDER BY spd.contract_number, spd.created_at DESC NULLS LAST
      ),
      ship_keys AS (
        SELECT
          s.id AS shipment_pk,
          c.contract_id,
          COALESCE(
            NULLIF(TRIM(c.sto_number::text), ''),
            NULLIF(TRIM(s.operation_id), ''),
            NULLIF(TRIM(s.shipment_id), ''),
            s.id::text
          ) AS sto_key
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
          ), 0) AS quantity_delivered_sap
        FROM ship_keys sk
        LEFT JOIN spd_keyed sk2 ON sk2.shipment_pk = sk.shipment_pk
        GROUP BY sk.shipment_pk
      ),
      loading_port AS (
        SELECT DISTINCT ON (vlp.shipment_id)
          vlp.shipment_id,
          vlp.eta_vessel_arrival::date AS load_eta_arrival,
          vlp.eta_vessel_berthed_at_loading_port::date AS load_eta_berthed,
          vlp.eta_loading_completed::date AS load_eta_completed
        FROM vessel_loading_ports vlp
        WHERE COALESCE(vlp.is_discharge_port, false) = false
        ORDER BY vlp.shipment_id, vlp.port_sequence NULLS LAST, vlp.id
      ),
      discharge_port AS (
        SELECT DISTINCT ON (vlp.shipment_id)
          vlp.shipment_id,
          vlp.eta_vessel_arrive_at_discharge_port::date AS discharge_eta_arrival,
          vlp.eta_vessel_berthed_at_discharge_port::date AS discharge_eta_berthed,
          vlp.eta_vessel_complete_discharge::date AS discharge_eta_completed
        FROM vessel_loading_ports vlp
        WHERE COALESCE(vlp.is_discharge_port, false) = true
        ORDER BY vlp.shipment_id, vlp.port_sequence NULLS LAST, vlp.id
      )
      SELECT
        s.id,
        s.shipment_id,
        c.contract_id AS contract_number,
        c.po_number,
        c.sto_number,
        l.contract_ext_no,
        c.contract_date::date AS contract_date,
        c.incoterm,
        c.product,
        s.vessel_name,
        s.status,
        COALESCE(NULLIF(TRIM(s.port_of_discharge), ''), 'Blank') AS plant_site,
        c.group_name,
        c.transport_mode,
        c.cargo_readiness_date::date AS cargo_readiness_date,
        COALESCE(lp.load_eta_arrival, s.eta_arrival::date) AS loading_eta_arrival,
        COALESCE(lp.load_eta_berthed, s.eta_berthed::date) AS loading_eta_berthed,
        COALESCE(lp.load_eta_completed, s.eta_loading_complete::date) AS loading_eta_completed,
        COALESCE(dp.discharge_eta_arrival, s.eta_discharge_arrival::date) AS discharge_eta_arrival,
        COALESCE(dp.discharge_eta_berthed, s.eta_discharge_berthed::date) AS discharge_eta_berthed,
        COALESCE(dp.discharge_eta_completed, s.eta_discharge_complete::date) AS discharge_eta_completed,
        (COALESCE(lp.load_eta_arrival, s.eta_arrival::date) - c.cargo_readiness_date::date)::int AS loading_delta_eta_etr_days,
        (COALESCE(lp.load_eta_arrival, s.eta_arrival::date) - COALESCE(lp.load_eta_berthed, s.eta_berthed::date))::int AS loading_delta_eta_etb_days,
        (COALESCE(lp.load_eta_berthed, s.eta_berthed::date) - COALESCE(lp.load_eta_completed, s.eta_loading_complete::date))::int AS loading_delta_etb_etc_days,
        (COALESCE(dp.discharge_eta_arrival, s.eta_discharge_arrival::date) - COALESCE(dp.discharge_eta_berthed, s.eta_discharge_berthed::date))::int AS discharge_delta_eta_etb_days,
        (COALESCE(dp.discharge_eta_berthed, s.eta_discharge_berthed::date) - COALESCE(dp.discharge_eta_completed, s.eta_discharge_complete::date))::int AS discharge_delta_etb_etc_days,
        (
          COALESCE((COALESCE(lp.load_eta_arrival, s.eta_arrival::date) - c.cargo_readiness_date::date), 0) +
          COALESCE((COALESCE(lp.load_eta_arrival, s.eta_arrival::date) - COALESCE(lp.load_eta_berthed, s.eta_berthed::date)), 0) +
          COALESCE((COALESCE(lp.load_eta_berthed, s.eta_berthed::date) - COALESCE(lp.load_eta_completed, s.eta_loading_complete::date)), 0) +
          COALESCE((COALESCE(dp.discharge_eta_arrival, s.eta_discharge_arrival::date) - COALESCE(dp.discharge_eta_berthed, s.eta_discharge_berthed::date)), 0) +
          COALESCE((COALESCE(dp.discharge_eta_berthed, s.eta_discharge_berthed::date) - COALESCE(dp.discharge_eta_completed, s.eta_discharge_complete::date)), 0)
        )::int AS total_delta_days,
        COALESCE(NULLIF(sa.sto_quantity, 0), c.sto_quantity, 0)::numeric AS sto_qty,
        COALESCE(
          CASE
            WHEN UPPER(TRIM(COALESCE(c.incoterm, ''))) IN ('FRC', 'CIF', 'CFR') THEN sa.quantity_receive
            WHEN UPPER(TRIM(COALESCE(c.incoterm, ''))) IN ('LCO', 'FOB') THEN sa.quantity_delivered_sap
            ELSE COALESCE(NULLIF(sa.quantity_receive, 0), sa.quantity_delivered_sap)
          END,
          s.actual_vessel_qty_receive,
          s.bl_quantity,
          0
        )::numeric AS received_qty,
        GREATEST(
          COALESCE(NULLIF(sa.sto_quantity, 0), c.sto_quantity, 0)::numeric
          - COALESCE(
            CASE
              WHEN UPPER(TRIM(COALESCE(c.incoterm, ''))) IN ('FRC', 'CIF', 'CFR') THEN sa.quantity_receive
              WHEN UPPER(TRIM(COALESCE(c.incoterm, ''))) IN ('LCO', 'FOB') THEN sa.quantity_delivered_sap
              ELSE COALESCE(NULLIF(sa.quantity_receive, 0), sa.quantity_delivered_sap, COALESCE(s.actual_vessel_qty_receive, s.bl_quantity, 0))
            END,
            0
          ),
          0
        )::numeric AS outstanding_qty
      FROM shipments s
      INNER JOIN contracts c ON s.contract_id = c.id
      LEFT JOIN latest_spd_contract l ON l.contract_number = c.contract_id
      LEFT JOIN sap_agg sa ON sa.shipment_pk = s.id
      LEFT JOIN loading_port lp ON lp.shipment_id = s.id
      LEFT JOIN discharge_port dp ON dp.shipment_id = s.id
      WHERE UPPER(COALESCE(NULLIF(TRIM(c.transport_mode), ''), 'SEA')) IN ('SEA', 'MIX')
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
  const statusFilter = String((req.query as any).status ?? 'ALL');
  const lateOnTimeFilter = String((req.query as any).lateOnTimeFilter ?? 'ALL');
  const incoterms = parseStringArray((req.query as any).incoterm ?? (req.query as any).incoterms);
  const plants = parseStringArray((req.query as any).plant ?? (req.query as any).plants);

  const cacheKey = JSON.stringify({ scope, dateFrom, dateTo, statusFilter, incoterms: [...incoterms].sort(), plants: [...plants].sort(), lateOnTimeFilter });

  return { scope, dateFrom, dateTo, statusFilter, incoterms, plants, lateOnTimeFilter, cacheKey };
}

function matchesShipmentStatusFilter(status: string, filter: string): boolean {
  const normalized = String(status || '').trim().toUpperCase();
  if (filter === 'ALL') return true;
  if (filter === 'Open') return normalized !== 'COMPLETED' && normalized !== 'CANCELLED' && normalized !== 'CANCELED';
  if (filter === 'Close') return normalized === 'COMPLETED';
  return normalized === filter.toUpperCase();
}

function filterSummaryBaseRows(rows: Record<string, unknown>[], filters: ShippingPerformanceFilters): Record<string, unknown>[] {
  return rows.filter((row) => {
    if (!matchesShipmentStatusFilter(String(row.status || ''), filters.statusFilter)) return false;
    const inc = String(row.incoterm || '').trim() || 'Blank';
    if (filters.incoterms.length > 0 && !filters.incoterms.includes(inc)) return false;
    const plant = String(row.plant_site || '').trim() || 'Blank';
    if (filters.plants.length > 0 && !filters.plants.includes(plant)) return false;
    const cDate = String(row.contract_date || '').slice(0, 10);
    if (filters.dateFrom && cDate && cDate < filters.dateFrom) return false;
    if (filters.dateTo && cDate && cDate > filters.dateTo) return false;
    return true;
  });
}

function filterTreeBaseRows(rows: Record<string, unknown>[], filters: ShippingPerformanceFilters): Record<string, unknown>[] {
  return filterSummaryBaseRows(rows, filters).filter((row) => {
    const total = Number(row.total_delta_days ?? 0);
    if (filters.lateOnTimeFilter === 'LATE' && !(total > 0)) return false;
    if (filters.lateOnTimeFilter === 'ON_TIME' && !(total <= 0)) return false;
    return true;
  });
}

function buildShippingPerfSummary(rows: Record<string, unknown>[], isLate: boolean): ShippingPerfSummary {
  let count = 0;
  let totalQty = 0;
  let openOutstandingQty = 0;
  let closeOutstandingQty = 0;
  let sumLoadingEtaEtr = 0;
  let sumLoadingEtaEtb = 0;
  let sumLoadingEtbEtc = 0;
  let sumDischargeEtaEtb = 0;
  let sumDischargeEtbEtc = 0;
  let sumTotalDelta = 0;

  for (const row of rows) {
    const total = Number(row.total_delta_days ?? 0);
    if (isLate ? total <= 0 : total > 0) continue;
    count += 1;
    const qty = Number(row.outstanding_qty ?? 0);
    totalQty += qty;
    const status = String(row.status || '').trim().toUpperCase();
    if (status === 'COMPLETED') closeOutstandingQty += qty;
    else openOutstandingQty += qty;

    sumLoadingEtaEtr += Number(row.loading_delta_eta_etr_days ?? 0);
    sumLoadingEtaEtb += Number(row.loading_delta_eta_etb_days ?? 0);
    sumLoadingEtbEtc += Number(row.loading_delta_etb_etc_days ?? 0);
    sumDischargeEtaEtb += Number(row.discharge_delta_eta_etb_days ?? 0);
    sumDischargeEtbEtc += Number(row.discharge_delta_etb_etc_days ?? 0);
    sumTotalDelta += total;
  }

  if (count === 0) return { ...EMPTY_SUMMARY };

  return {
    count,
    totalQty,
    openOutstandingQty,
    closeOutstandingQty,
    avgLoadingEtaEtr: sumLoadingEtaEtr / count,
    avgLoadingEtaEtb: sumLoadingEtaEtb / count,
    avgLoadingEtbEtc: sumLoadingEtbEtc / count,
    avgDischargeEtaEtb: sumDischargeEtaEtb / count,
    avgDischargeEtbEtc: sumDischargeEtbEtc / count,
    avgTotalDelta: sumTotalDelta / count,
  };
}

function matchesPerfDrilldownRow(row: Record<string, unknown>, isLate: boolean): boolean {
  const delta = Number(row.total_delta_days ?? 0);
  if (isLate ? delta <= 0 : delta > 0) return false;
  if (String(row.status || '').trim().toUpperCase() === 'COMPLETED') return false;
  if (Number(row.outstanding_qty ?? 0) <= 0) return false;
  return true;
}

function buildPerfTree(rows: Record<string, unknown>[], isLate: boolean): ShippingPerfTreeNode[] {
  type VesMap = Map<string, { count: number; totalQty: number }>;
  type IncMap = Map<string, { count: number; totalQty: number; vessels: VesMap }>;
  type PlantMap = Map<string, { count: number; totalQty: number; incoterms: IncMap }>;
  type ProdMap = Map<string, { count: number; totalQty: number; plants: PlantMap }>;
  const root: ProdMap = new Map();

  for (const row of rows) {
    if (!matchesPerfDrilldownRow(row, isLate)) continue;
    const prod = String(row.product || '').trim() || 'Blank';
    const plant = String(row.plant_site || '').trim() || 'Blank';
    const inc = String(row.incoterm || '').trim() || 'Blank';
    const ves = String(row.vessel_name || '').trim() || 'Unknown';
    const qty = Number(row.outstanding_qty ?? 0);

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

async function loadShippingPerformanceRows(cacheKey: string): Promise<Record<string, unknown>[]> {
  const cached = ROW_CACHE.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.rows;
  }

  const result = await query(SHIPPING_PERFORMANCE_SQL);
  const rows = result.rows as Record<string, unknown>[];
  ROW_CACHE.set(cacheKey, { rows, expiresAt: Date.now() + CACHE_TTL_MS });
  return rows;
}

function distinctValues(rows: Record<string, unknown>[], key: string): string[] {
  return [...new Set(rows.map((r) => String(r[key] || '').trim() || 'Blank'))].sort((a, b) => a.localeCompare(b));
}

export async function runShippingPerformance(req: AuthRequest, part: ShippingPerformancePart) {
  const filters = parseShippingPerformanceFilters(req);
  const rows = await loadShippingPerformanceRows('shipping-performance-rows-v1');
  const summaryBase = filterSummaryBaseRows(rows, filters);

  if (part === 'rows') {
    return { rows: summaryBase };
  }

  if (part === 'summary') {
    return {
      summary: buildShippingPerfSummary(summaryBase, true),
      onTrackSummary: buildShippingPerfSummary(summaryBase, false),
      meta: {
        incoterms: distinctValues(rows, 'incoterm'),
        plantSites: distinctValues(rows, 'plant_site'),
      },
    };
  }

  const treeBase = filterTreeBaseRows(rows, filters);
  return {
    tree: buildPerfTree(treeBase, true),
    onTrackTree: buildPerfTree(treeBase, false),
  };
}
