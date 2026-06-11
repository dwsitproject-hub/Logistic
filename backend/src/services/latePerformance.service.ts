import {
  diffCalendarDays,
  hasCalendarDate,
  isLegacyTradeCycleOnTime,
  isOpenConditionBOnTime,
  openDueDateTradeCycleDays,
} from '../utils/calendarDays';
import { query } from '../database/connection';
import logger from '../utils/logger';
import { AuthRequest } from '../middleware/auth';
import { CONTRACTS_QTY_MOVE_CTE } from '../controllers/contractsQtyMoveSql';
import { appendContractPerfSourceTypeFilter, B2B_CHILD_EXCLUSION_SQL } from '../controllers/contractSqlFragments';
import { appendContractPerfProductSubstringSql } from '../utils/contractPerfProductFilterSql';

export type LatePerformancePart = 'summary' | 'tree' | 'all';

export interface LatePerformanceFilters {
  scope: string;
  effectiveDateFrom: string | undefined;
  effectiveDateTo: string | undefined;
  debug: boolean;
  cacheKey: string;
  status: string | undefined;
  supplier: string | undefined;
  buyer: string | undefined;
  dateFrom: string | undefined;
  dateTo: string | undefined;
  companyCode: string | undefined;
  transportMode: string | undefined;
  plant: string | string[] | undefined;
  globalSearch: string;
  selectedIncoterms: string | undefined;
  b2bFlag: string | undefined;
  productFilter: string | undefined;
  sourceTypeFilter: string | undefined;
  statusNorm: string;
  plants: string[];
}

const ROW_CACHE = new Map<string, { rows: any[]; expiresAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000;

function buildCacheKey(f: Omit<LatePerformanceFilters, 'cacheKey'>): string {
  const norm = {
    scope: f.scope,
    effectiveDateFrom: f.effectiveDateFrom ?? '',
    effectiveDateTo: f.effectiveDateTo ?? '',
    statusNorm: f.statusNorm,
    supplier: f.supplier ?? '',
    buyer: f.buyer ?? '',
    companyCode: f.companyCode ?? '',
    transportMode: f.transportMode ?? '',
    plants: [...f.plants].sort(),
    globalSearch: f.globalSearch,
    selectedIncoterms: f.selectedIncoterms ?? '',
    b2bFlag: f.b2bFlag ?? '',
    productFilter: f.productFilter ?? '',
    sourceTypeFilter: f.sourceTypeFilter ?? '',
  };
  return JSON.stringify(norm);
}

export function parseLatePerformanceFilters(
  req: AuthRequest,
  part?: LatePerformancePart,
): LatePerformanceFilters {
  const {
    status,
    supplier,
    buyer,
    dateFrom,
    dateTo,
    companyCode,
  } = req.query as any;

  const scope = String((req.query as any).scope ?? 'ytd').toLowerCase();
  const debug =
    String((req.query as any).debug ?? '').toLowerCase() === '1' ||
    String((req.query as any).debug ?? '').toLowerCase() === 'true';
  const transportMode = (req.query as any).transportMode as string | undefined;
  const plant = (req.query as any).plant as string | string[] | undefined;
  const globalSearch = typeof (req.query as any).search === 'string' ? (req.query as any).search.trim() : '';
  const selectedIncoterms = (req.query as any).incoterms as string | undefined;
  const b2bFlag = (req.query as any).b2bFlag as string | undefined;
  const productFilter = (req.query as any).product as string | undefined;
  const sourceTypeFilter = (req.query as any).sourceType as string | undefined;

  const now = new Date();
  const y = now.getFullYear();
  const ytdFrom = `${y}-01-01`;
  const ytdTo = `${y}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const effectiveDateFrom = scope === 'filtered' ? dateFrom : (dateFrom || ytdFrom);
  const effectiveDateTo = scope === 'filtered' ? dateTo : (dateTo || ytdTo);

  let statusNorm = scope === 'filtered' && typeof status === 'string' ? status.trim() : '';
  if (part === 'summary') {
    statusNorm = '';
  }
  const plantArr = scope === 'filtered' ? (Array.isArray(plant) ? plant : plant ? [plant] : []) : [];
  const plants = plantArr.map((p) => String(p)).filter((p) => p.trim() !== '');

  const base: Omit<LatePerformanceFilters, 'cacheKey'> = {
    scope,
    effectiveDateFrom,
    effectiveDateTo,
    debug,
    status,
    supplier,
    buyer,
    dateFrom,
    dateTo,
    companyCode,
    transportMode,
    plant,
    globalSearch,
    selectedIncoterms,
    b2bFlag,
    productFilter,
    sourceTypeFilter,
    statusNorm,
    plants,
  };

  return {
    ...base,
    cacheKey: buildCacheKey(base),
  };
}

export function buildLatePerformanceQuery(filters: LatePerformanceFilters): {
  queryText: string;
  queryParams: any[];
} {
  const {
    scope,
    effectiveDateFrom,
    effectiveDateTo,
    statusNorm,
    supplier,
    buyer,
    companyCode,
    transportMode,
    plants,
    globalSearch,
    selectedIncoterms,
    b2bFlag,
    productFilter,
    sourceTypeFilter,
  } = filters;

  const queryParams: any[] = [];
  let paramIndex = 1;
  let contractScopeWhere = '';

  if (effectiveDateFrom) {
    contractScopeWhere += ` AND c.contract_date >= $${paramIndex}`;
    queryParams.push(effectiveDateFrom);
    paramIndex++;
  }
  if (effectiveDateTo) {
    contractScopeWhere += ` AND c.contract_date <= $${paramIndex}`;
    queryParams.push(effectiveDateTo);
    paramIndex++;
  }

  let queryText = `
      WITH contract_scope AS (
        SELECT DISTINCT c.contract_id
        FROM contracts c
        WHERE 1=1
        ${contractScopeWhere}
      ),
      latest_spd AS (
        SELECT DISTINCT ON (spd.contract_number) spd.contract_number, spd.data, spd.created_at
        FROM sap_processed_data spd
        INNER JOIN contract_scope cs ON cs.contract_id = spd.contract_number
        ORDER BY spd.contract_number, spd.created_at DESC NULLS LAST
      ),
      ${CONTRACTS_QTY_MOVE_CTE},
      sto_agg AS (
        SELECT x.contract_number,
          SUM(x.sto_quantity_num) AS total_sto_quantity
        FROM (
          SELECT DISTINCT ON (spd.contract_number, effective_sto)
            spd.contract_number,
            effective_sto,
            sto_quantity_num
          FROM (
            SELECT spd.contract_number,
              NULLIF(TRIM(COALESCE(spd.sto_number::text, spd.data->'raw'->>'STO No.', spd.data->'raw'->>'STO Number', spd.data->'shipment'->>'sto_no', spd.data->'contract'->>'sto_no')), '') AS effective_sto,
              CAST(REPLACE(REPLACE(COALESCE(spd.data->'contract'->>'sto_quantity', '0'), ',', ''), ' ', '') AS NUMERIC) AS sto_quantity_num,
              spd.created_at
            FROM sap_processed_data spd
            INNER JOIN contract_scope cs ON cs.contract_id = spd.contract_number
            WHERE ((spd.sto_number IS NOT NULL AND spd.sto_number::text != '') OR NULLIF(TRIM(COALESCE(spd.data->'raw'->>'STO No.', spd.data->'raw'->>'STO Number', spd.data->'shipment'->>'sto_no', spd.data->'contract'->>'sto_no')), '') IS NOT NULL)
              AND spd.data->'contract'->>'sto_quantity' IS NOT NULL
          ) spd
          WHERE effective_sto IS NOT NULL AND effective_sto != ''
          ORDER BY contract_number, effective_sto, created_at DESC NULLS LAST
        ) x
        GROUP BY x.contract_number
      ),
      base AS (
        SELECT
          c.contract_id,
          (array_agg(c.id ORDER BY c.created_at DESC))[1] AS id,
          MAX(c.product) AS product,
          MAX(c.group_name) AS group_name,
          MAX(c.supplier) AS supplier,
          MAX(c.incoterm) AS incoterm,
          MAX(c.quantity_ordered) AS quantity_ordered,
          MAX(c.transport_mode) AS transport_mode,
          MAX(c.source_type) AS source_type,
          MAX(c.status) AS status,
          MAX(c.plant_code) AS plant_code,
          MAX(c.company_name) AS company_name,
          (array_agg(l.data->'contract'->>'status' ORDER BY l.created_at DESC NULLS LAST))[1] AS import_status,
          MAX(c.delivery_end_date) AS delivery_end_date,
          MAX(c.cargo_readiness_date) AS cargo_readiness_date,
          (array_agg(l.data ORDER BY l.created_at DESC NULLS LAST))[1] AS latest_spd_data,
          (array_agg(s.total_sto_quantity ORDER BY s.total_sto_quantity DESC NULLS LAST))[1] AS total_sto_quantity,
          (array_agg(qm.quantity_delivery ORDER BY qm.quantity_delivery DESC NULLS LAST))[1] AS quantity_delivery,
          (array_agg(qm.quantity_receive ORDER BY qm.quantity_receive DESC NULLS LAST))[1] AS quantity_receive,
          -- Use the denormalized column instead of CROSS JOIN LATERAL jsonb_array_elements
          (
            SELECT MAX(t.last_daily_deliverable_date)
            FROM trucking_operations t
            WHERE t.contract_id = (array_agg(c.id ORDER BY c.created_at DESC))[1]
          ) AS last_trucking_daily_deliverable_date,
          (
            WITH trucking_contract AS (
              SELECT (array_agg(c.contract_id ORDER BY c.created_at DESC))[1] AS contract_number
            ),
            latest_spd AS (
              SELECT DISTINCT ON (spd.contract_number)
                spd.contract_number,
                COALESCE(spd.data->'raw'->>'Trucking Last Receive Date', spd.data->>'Trucking Last Receive Date') AS last_receive_raw
              FROM sap_processed_data spd
              JOIN trucking_contract tc ON tc.contract_number = spd.contract_number
              ORDER BY spd.contract_number, spd.created_at DESC NULLS LAST
            ),
            latest_receive AS (
              SELECT
                contract_number,
                CASE
                  WHEN last_receive_raw IS NULL OR length(trim(last_receive_raw)) < 6 THEN NULL
                  WHEN trim(last_receive_raw) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN trim(last_receive_raw)::date
                  WHEN trim(last_receive_raw) ~ '^[0-9]{1,2}/[0-9]{1,2}/[0-9]{2}$' THEN to_date(trim(last_receive_raw), 'MM/DD/YY')
                  ELSE NULL
                END AS trucking_last_receive_date
              FROM latest_spd
            )
            SELECT MAX(
              COALESCE(
                t.trucking_completion_date,
                lr.trucking_last_receive_date,
                t.eta_trucking_completion_date,
                t.eta_delivery_end_date
              )
            )
            FROM trucking_operations t
            LEFT JOIN latest_receive lr ON lr.contract_number = (array_agg(c.contract_id ORDER BY c.created_at DESC))[1]
            WHERE t.contract_id = (array_agg(c.id ORDER BY c.created_at DESC))[1]
          ) AS last_trucking_completion_date,
          (
            SELECT MAX(
              COALESCE(
                s2.ata_discharge_complete::date,
                s2.arrival_date::date,
                s2.eta_discharge_complete::date
              )
            )
            FROM shipments s2
            WHERE s2.contract_id = (array_agg(c.id ORDER BY c.created_at DESC))[1]
          ) AS last_ata_vessel_complete_discharge,
          (
            SELECT MAX(
              COALESCE(
                s2.eta_discharge_complete::date,
                (
                  SELECT vlpd.eta_vessel_complete_discharge::date
                  FROM vessel_loading_ports vlpd
                  WHERE vlpd.shipment_id = s2.id
                    AND vlpd.is_discharge_port = true
                  ORDER BY vlpd.updated_at DESC NULLS LAST, vlpd.created_at DESC NULLS LAST
                  LIMIT 1
                )
              )
            )
            FROM shipments s2
            WHERE s2.contract_id = (array_agg(c.id ORDER BY c.created_at DESC))[1]
          ) AS last_eta_vessel_complete_discharge,
          (
            SELECT MAX(COALESCE(t.eta_trucking_completion_date::date, t.eta_delivery_end_date::date))
            FROM trucking_operations t
            WHERE t.contract_id = (array_agg(c.id ORDER BY c.created_at DESC))[1]
          ) AS open_standard_eta_trucking,
          (
            SELECT MAX(
              (
                SELECT vlp.eta_vessel_arrival::date
                FROM vessel_loading_ports vlp
                WHERE vlp.shipment_id = s2.id
                  AND COALESCE(vlp.is_discharge_port, false) = false
                ORDER BY vlp.port_sequence ASC NULLS LAST, vlp.updated_at DESC NULLS LAST, vlp.created_at DESC NULLS LAST
                LIMIT 1
              )
            )
            FROM shipments s2
            WHERE s2.contract_id = (array_agg(c.id ORDER BY c.created_at DESC))[1]
          ) AS open_standard_eta_vessel_loading
        FROM contract_scope cs
        INNER JOIN contracts c ON c.contract_id = cs.contract_id
        LEFT JOIN latest_spd l ON l.contract_number = c.contract_id
        LEFT JOIN sto_agg s ON s.contract_number = c.contract_id
        LEFT JOIN qty_move qm ON qm.contract_number = c.contract_id
        WHERE 1=1
        GROUP BY c.contract_id
      )
      SELECT
        base.*,
        COALESCE(
          NULLIF(TRIM(pnc.group_plant), ''),
          NULLIF(TRIM(pna.group_plant), ''),
          'Blank'
        ) AS plant_site
      FROM base
      LEFT JOIN LATERAL (
        SELECT mp.group_plant, mp.plant_name
        FROM master_plants mp
        WHERE TRIM(UPPER(COALESCE(mp.plant_code, ''))) = TRIM(UPPER(COALESCE(base.plant_code, '')))
          AND NULLIF(TRIM(mp.plant_name), '') IS NOT NULL
          AND NULLIF(TRIM(base.company_name), '') IS NOT NULL
          AND TRIM(UPPER(COALESCE(mp.company_name, ''))) = TRIM(UPPER(COALESCE(base.company_name, '')))
        ORDER BY mp.updated_at DESC NULLS LAST
        LIMIT 1
      ) pnc ON TRUE
      LEFT JOIN LATERAL (
        SELECT mp.group_plant, mp.plant_name
        FROM master_plants mp
        WHERE TRIM(UPPER(COALESCE(mp.plant_code, ''))) = TRIM(UPPER(COALESCE(base.plant_code, '')))
          AND NULLIF(TRIM(mp.plant_name), '') IS NOT NULL
        ORDER BY mp.updated_at DESC NULLS LAST
        LIMIT 1
      ) pna ON TRUE
      WHERE 1=1
      ${B2B_CHILD_EXCLUSION_SQL}
    `;

  if (statusNorm && statusNorm !== 'All Status' && statusNorm.toLowerCase() !== 'all') {
    if (statusNorm === 'Open' || statusNorm === 'ACTIVE') {
      queryText += ` AND (
          (base.latest_spd_data->'contract'->>'status' = 'Open' OR UPPER(base.latest_spd_data->'contract'->>'status') = 'ACTIVE')
          OR (base.latest_spd_data IS NULL AND UPPER(base.status) IN ('OPEN', 'ACTIVE'))
        )`;
    } else if (statusNorm === 'Close' || statusNorm === 'CLOSE') {
      queryText += ` AND (
          (base.latest_spd_data->'contract'->>'status' = 'Close' OR UPPER(base.latest_spd_data->'contract'->>'status') IN ('CLOSE', 'COMPLETED', 'CLOSED'))
          OR (base.latest_spd_data IS NULL AND UPPER(base.status) IN ('CLOSE', 'COMPLETED', 'CLOSED'))
        )`;
    } else {
      queryText += ` AND (base.status = $${paramIndex} OR base.latest_spd_data->'contract'->>'status' = $${paramIndex})`;
      queryParams.push(statusNorm);
      paramIndex++;
    }
  }

  if (scope === 'filtered' && supplier) {
    queryText += ` AND (base.latest_spd_data->'raw'->>'Supplier' ILIKE $${paramIndex} OR base.latest_spd_data->>'Supplier' ILIKE $${paramIndex} OR $${paramIndex}::text IS NULL)`;
    queryParams.push(`%${supplier}%`);
    paramIndex++;
  }
  if (scope === 'filtered' && buyer) {
    queryText += ` AND (base.latest_spd_data->'raw'->>'Buyer' ILIKE $${paramIndex} OR base.latest_spd_data->>'Buyer' ILIKE $${paramIndex} OR $${paramIndex}::text IS NULL)`;
    queryParams.push(`%${buyer}%`);
    paramIndex++;
  }
  if (scope === 'filtered' && companyCode) {
    queryText += ` AND (
        COALESCE(base.latest_spd_data->'contract'->>'company_code', base.latest_spd_data->'raw'->>'Company Code', base.latest_spd_data->'raw'->>'company code', base.latest_spd_data->>'Company Code', base.latest_spd_data->>'company code', '') = $${paramIndex}
      )`;
    queryParams.push(companyCode);
    paramIndex++;
  }

  if (transportMode && String(transportMode).toUpperCase() !== 'ALL') {
    queryText += ` AND UPPER(COALESCE(NULLIF(TRIM(base.transport_mode), ''), '')) LIKE $${paramIndex}`;
    queryParams.push(`${String(transportMode).toUpperCase()}%`);
    paramIndex++;
  }

  if (b2bFlag && b2bFlag.toUpperCase() !== 'ALL') {
    if (b2bFlag.toUpperCase() === 'B2B') {
      queryText += ` AND UPPER(COALESCE(base.latest_spd_data->'contract'->>'contract_type', base.latest_spd_data->>'B2B Flag', '')) = 'B2B'`;
    } else {
      queryText += ` AND UPPER(COALESCE(base.latest_spd_data->'contract'->>'contract_type', base.latest_spd_data->>'B2B Flag', '')) != 'B2B'`;
    }
  }

  const productClause = appendContractPerfProductSubstringSql(productFilter, 'base.product', paramIndex);
  if (productClause) {
    queryText += productClause.clause;
    queryParams.push(productClause.param);
    paramIndex = productClause.nextParamIndex;
  }

  queryText += appendContractPerfSourceTypeFilter(sourceTypeFilter, 'base.source_type');

  if (plants.length > 0) {
    const blankIncluded = plants.some((p) => p === 'Blank');
    const nonBlank = plants.filter((p) => p !== 'Blank');
    const parts: string[] = [];
    const groupPlantResolved = `COALESCE(NULLIF(TRIM(pnc.group_plant), ''), NULLIF(TRIM(pna.group_plant), ''), 'Blank')`;
    if (blankIncluded) parts.push(`(${groupPlantResolved} = 'Blank')`);
    if (nonBlank.length > 0) {
      const ph = nonBlank.map(() => `$${paramIndex++}`).join(', ');
      parts.push(`${groupPlantResolved} IN (${ph})`);
      queryParams.push(...nonBlank);
    }
    queryText += ` AND (${parts.join(' OR ')})`;
  }

  if (scope === 'filtered' && selectedIncoterms) {
    const incs = selectedIncoterms.split(',').map((s) => s.trim()).filter(Boolean);
    if (incs.length > 0) {
      const blankIncluded = incs.some((v) => v === 'Blank');
      const nonBlank = incs.filter((v) => v !== 'Blank');
      const parts: string[] = [];
      if (blankIncluded) parts.push(`(base.incoterm IS NULL OR TRIM(base.incoterm) = '')`);
      if (nonBlank.length > 0) {
        const ph = nonBlank.map(() => `$${paramIndex++}`).join(', ');
        parts.push(`base.incoterm IN (${ph})`);
        queryParams.push(...nonBlank);
      }
      queryText += ` AND (${parts.join(' OR ')})`;
    }
  }

  if (scope === 'filtered' && globalSearch.length >= 2) {
    queryText += ` AND (
        base.contract_id ILIKE $${paramIndex}
        OR COALESCE(base.product, '') ILIKE $${paramIndex}
        OR COALESCE(base.group_name, '') ILIKE $${paramIndex}
        OR COALESCE(NULLIF(TRIM(pnc.plant_name), ''), NULLIF(TRIM(pna.plant_name), ''), base.plant_code, '') ILIKE $${paramIndex}
      )`;
    queryParams.push(`%${globalSearch}%`);
    paramIndex++;
  }

  return { queryText, queryParams };
}

export async function loadLatePerformanceRows(filters: LatePerformanceFilters): Promise<any[]> {
  const cached = ROW_CACHE.get(filters.cacheKey);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.rows;
  }
  if (cached) {
    ROW_CACHE.delete(filters.cacheKey);
  }

  const { queryText, queryParams } = buildLatePerformanceQuery(filters);
  const result = await query(queryText, queryParams);
  const rows = result.rows as any[];
  ROW_CACHE.set(filters.cacheKey, { rows, expiresAt: Date.now() + CACHE_TTL_MS });
  return rows;
}

const due = (v: unknown): Date | null => {
  if (v == null) return null;
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v;
  if (typeof v === 'number' && Number.isFinite(v)) {
    const dt = new Date(v);
    return Number.isNaN(dt.getTime()) ? null : dt;
  }
  const s0 = String(v).trim();
  if (!s0) return null;
  const s = s0.replace(/\u200e|\u200f/g, '').trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const dt = new Date(`${s}T00:00:00`);
    return Number.isNaN(dt.getTime()) ? null : dt;
  }

  const dmy = /^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/.exec(s);
  if (dmy) {
    const dd = Number(dmy[1]);
    const mm = Number(dmy[2]);
    const yyyy = Number(dmy[3]);
    if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
      const cal = new Date(yyyy, mm - 1, dd);
      if (cal.getFullYear() === yyyy && cal.getMonth() === mm - 1 && cal.getDate() === dd) return cal;
    }
    return null;
  }

  const mdy2 = /^(\d{1,2})\/(\d{1,2})\/(\d{2})$/.exec(s);
  if (mdy2) {
    const mm = Number(mdy2[1]);
    const dd = Number(mdy2[2]);
    const yy = Number(mdy2[3]);
    const yyyy = yy >= 70 ? 1900 + yy : 2000 + yy;
    if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
      const cal = new Date(yyyy, mm - 1, dd);
      if (cal.getFullYear() === yyyy && cal.getMonth() === mm - 1 && cal.getDate() === dd) return cal;
    }
    return null;
  }

  const dt = new Date(s);
  return Number.isNaN(dt.getTime()) ? null : dt;
};

/** Due date delivery end from contracts table, else latest SAP processed contract/raw fields. */
export function resolveEffectiveDeliveryEnd(row: {
  delivery_end_date?: unknown;
  latest_spd_data?: unknown;
}): Date | null {
  const fromDb = due(row.delivery_end_date);
  if (fromDb) return fromDb;

  const spd = row.latest_spd_data as
    | { contract?: { due_date_delivery_end?: unknown }; raw?: Record<string, unknown> }
    | null
    | undefined;
  if (!spd) return null;

  const fromContractJson = due(spd.contract?.due_date_delivery_end);
  if (fromContractJson) return fromContractJson;

  const raw = spd.raw;
  if (!raw) return null;
  return (
    due(raw['Due Date Delivery\r\n(End)']) ??
    due(raw['Due Date Delivery (End)']) ??
    due(raw['Due Date Delivery End']) ??
    null
  );
}

const diffInDays = (start: unknown, end: unknown): number | null => diffCalendarDays(start, end);

type AggNode = {
  key: string;
  count: number;
  totalDays: number;
  maxDays: number;
  totalQtyDelivery: number;
  children: Map<string, AggNode>;
};

const add = (m: Map<string, AggNode>, key: string) => {
  const k = key && key.trim() ? key.trim() : 'Blank';
  const ex = m.get(k);
  if (ex) return ex;
  const node: AggNode = { key: k, count: 0, totalDays: 0, maxDays: 0, totalQtyDelivery: 0, children: new Map() };
  m.set(k, node);
  return node;
};

/** Incoterm → Plant → Product → Group → Supplier (matches frontend flatten). */
function addContractRowToPerfTree(
  treeRoot: Map<string, AggNode>,
  row: any,
  tradeCycleDays: number,
  outstandingQty: number,
) {
  const inc = String(row.incoterm || '').trim() || 'Blank';
  const pl = String(row.plant_site || '').trim() || 'Blank';
  const prod = String(row.product || '').trim() || 'Blank';
  const gn = String(row.group_name || '').trim() || 'Blank';
  const sup = String(row.supplier || '').trim() || 'Blank';

  const n1 = add(treeRoot, inc);
  const n2 = add(n1.children, pl);
  const n3 = add(n2.children, prod);
  const n4 = add(n3.children, gn);
  const n5 = add(n4.children, sup);
  const daysForAgg = tradeCycleDays <= 0 ? Math.max(0, -tradeCycleDays) : tradeCycleDays;
  for (const n of [n1, n2, n3, n4, n5]) {
    n.count += 1;
    n.totalDays += daysForAgg;
    n.maxDays = Math.max(n.maxDays, daysForAgg);
    n.totalQtyDelivery += outstandingQty;
  }
}

const toSorted = (m: Map<string, AggNode>): any[] =>
  [...m.values()]
    .sort((a, b) => b.totalQtyDelivery - a.totalQtyDelivery || b.count - a.count || a.key.localeCompare(b.key))
    .map((n) => ({
      key: n.key,
      count: n.count,
      totalDays: n.totalDays,
      maxDays: n.maxDays,
      totalQtyDelivery: n.totalQtyDelivery,
      children: toSorted(n.children),
    }));

function resolveOpenStandardEta(row: any, transport: string): unknown {
  if (transport.startsWith('LAND')) return row.open_standard_eta_trucking;
  if (transport.startsWith('SEA')) return row.open_standard_eta_vessel_loading;
  return null;
}

function sapPayoffRawString(row: any): string | null {
  const fromList = row.payoff_date_raw;
  if (fromList != null && String(fromList).trim() !== '') return String(fromList).trim();

  const spd = row.latest_spd_data as
    | { payment?: { payoff_date?: unknown }; raw?: Record<string, unknown> }
    | null
    | undefined;
  if (!spd) return null;
  const fromPayment = spd.payment?.payoff_date != null ? String(spd.payment.payoff_date).trim() : '';
  if (fromPayment) return fromPayment;
  const fromRaw = spd.raw?.['Payoff Date'] != null ? String(spd.raw['Payoff Date']).trim() : '';
  return fromRaw || null;
}

function sapDpRawString(row: any): string | null {
  const fromList = row.dp_date_raw;
  if (fromList != null && String(fromList).trim() !== '') return String(fromList).trim();

  const spd = row.latest_spd_data as
    | { payment?: { dp_date?: unknown }; raw?: Record<string, unknown> }
    | null
    | undefined;
  if (!spd) return null;
  const fromPayment = spd.payment?.dp_date != null ? String(spd.payment.dp_date).trim() : '';
  if (fromPayment) return fromPayment;
  const fromRaw = spd.raw?.['DP Date'] != null ? String(spd.raw['DP Date']).trim() : '';
  return fromRaw || null;
}

/** Payoff Date from SAP/SPD only — never payments-table fallback. */
export function resolveSapPayoffCalendarDate(row: any): Date | null {
  const raw = sapPayoffRawString(row);
  if (!raw) return null;
  return due(raw);
}

/** DP Date from SAP/SPD only — never payments-table fallback. */
export function resolveSapDpCalendarDate(row: any): Date | null {
  const raw = sapDpRawString(row);
  if (!raw) return null;
  return due(raw);
}

/**
 * Open projected completion end for cycle math (ETA side only):
 * - Condition B: standard ETA empty → Today (substitute missing ETA only)
 * - Condition A: standard ETA present → require planning/discharge date (no Today substitute)
 */
export function resolveOpenEffectiveCompletionEnd(
  row: any,
  transport: string,
  todayMid: Date = new Date(),
): Date | null {
  const t = String(transport || '').trim().toUpperCase();
  const standardEta = resolveOpenStandardEta(row, t);

  if (!hasCalendarDate(standardEta)) {
    const today = new Date(todayMid);
    today.setHours(0, 0, 0, 0);
    return today;
  }

  const completion =
    t.startsWith('LAND')
      ? row.last_trucking_daily_deliverable_date
      : t.startsWith('SEA')
        ? row.last_eta_vessel_complete_discharge
        : null;

  if (!hasCalendarDate(completion)) return null;
  return due(completion);
}

/** @deprecated Use resolveOpenEffectiveCompletionEnd — kept for tests/imports. */
export function resolveOpenCycleCompletionEnd(
  row: any,
  transport: string,
  todayMid: Date = new Date(),
): Date | string | null {
  return resolveOpenEffectiveCompletionEnd(row, transport, todayMid);
}

/** Open Log Cycle: Cargo Readiness → effective completion (Today only when standard ETA is empty). */
export function computeOpenLogCycleDays(
  row: any,
  transport: string,
  todayMid: Date,
  cargoReady: unknown,
): number | null {
  if (!hasCalendarDate(cargoReady)) return null;
  const end = resolveOpenEffectiveCompletionEnd(row, transport, todayMid);
  if (!end) return null;
  return diffCalendarDays(cargoReady, end);
}

/** Open Cash Cycle: requires SAP Payoff Date; ETA may use Today only when standard ETA is empty. */
export function computeOpenCashCycleDays(
  row: any,
  transport: string,
  todayMid: Date,
  payoffDate?: unknown,
): number | null {
  const payoff = hasCalendarDate(payoffDate) ? due(payoffDate) : resolveSapPayoffCalendarDate(row);
  if (!payoff) return null;
  const end = resolveOpenEffectiveCompletionEnd(row, transport, todayMid);
  if (!end) return null;
  return diffCalendarDays(payoff, end);
}

/** Open DP Cycle: requires SAP DP Date; ETA may use Today only when standard ETA is empty. */
export function computeOpenDpCycleDays(
  row: any,
  transport: string,
  todayMid: Date,
  dpDate?: unknown,
): number | null {
  const dp = hasCalendarDate(dpDate) ? due(dpDate) : resolveSapDpCalendarDate(row);
  if (!dp) return null;
  const end = resolveOpenEffectiveCompletionEnd(row, transport, todayMid);
  if (!end) return null;
  return diffCalendarDays(dp, end);
}

/** Mirrors aggregateLatePerformanceRows contractPerfOnTime (Section 2 tree vs Section 3 filter). */
export function isContractPerfOnTimeTradeCycle(row: any, tradeCycle: number): boolean {
  const statusText = String(row.import_status || row.status || '').trim().toUpperCase();
  const transport = String(row.transport_mode || '').trim().toUpperCase();
  const isOpen = statusText === 'OPEN' || statusText === 'ACTIVE';
  if (!isOpen) return isLegacyTradeCycleOnTime(tradeCycle);
  const openUsesConditionB = !hasCalendarDate(resolveOpenStandardEta(row, transport));
  return openUsesConditionB ? isOpenConditionBOnTime(tradeCycle) : isLegacyTradeCycleOnTime(tradeCycle);
}

/**
 * Open contracts — Trade Cycle for drilldown.
 *   A) Standard ETA present → delivery_end vs planning/discharge (unchanged).
 *   B) Standard ETA empty → today vs due date delivery end (Late if today >= due end).
 * Condition B applies to every Open row. Section-1 "Open" card only gates extra UI copy, not this rule.
 */
function computeOpenTradeCycleDays(
  row: any,
  transport: string,
  todayMid: Date,
  deliveryEnd: Date,
): number | null {
  if (hasCalendarDate(resolveOpenStandardEta(row, transport))) {
    if (transport.startsWith('LAND')) {
      return diffCalendarDays(deliveryEnd, row.last_trucking_daily_deliverable_date);
    }
    if (transport.startsWith('SEA')) {
      return diffCalendarDays(deliveryEnd, row.last_eta_vessel_complete_discharge);
    }
    return null;
  }

  return openDueDateTradeCycleDays(deliveryEnd, todayMid);
}

/** SQL fragment — mirrors resolveEffectiveDeliveryEnd (DB or latest SAP fields). */
export function sqlEffectiveDeliveryEndPresent(): string {
  return `(
    delivery_end_date IS NOT NULL
    OR NULLIF(TRIM(COALESCE(latest_spd_data->'contract'->>'due_date_delivery_end', '')), '') <> ''
    OR NULLIF(TRIM(COALESCE(latest_spd_data->'raw'->>'Due Date Delivery (End)', '')), '') <> ''
    OR NULLIF(TRIM(COALESCE(latest_spd_data->'raw'->>'Due Date Delivery\r\n(End)', '')), '') <> ''
    OR NULLIF(TRIM(COALESCE(latest_spd_data->'raw'->>'Due Date Delivery End', '')), '') <> ''
  )`;
}

/** Trade cycle for performance tree / Section 3 schedulable checks (mirrors aggregateLatePerformanceRows). */
export function computePerfTradeCycleDaysForRow(row: any, todayMid: Date = new Date()): number | null {
  const statusText = String(row.import_status || row.status || '').trim().toUpperCase();
  const transport = String(row.transport_mode || '').trim().toUpperCase();
  const deliveryEnd = resolveEffectiveDeliveryEnd(row);
  if (!deliveryEnd) return null;

  const today = new Date(todayMid);
  today.setHours(0, 0, 0, 0);

  if (statusText === 'CLOSE' || statusText === 'CLOSED' || statusText === 'COMPLETED') {
    if (transport.startsWith('LAND')) {
      return diffCalendarDays(deliveryEnd, row.last_trucking_completion_date);
    }
    if (transport.startsWith('SEA')) {
      return diffCalendarDays(deliveryEnd, row.last_ata_vessel_complete_discharge);
    }
    return null;
  }
  if (statusText === 'OPEN' || statusText === 'ACTIVE') {
    return computeOpenTradeCycleDays(row, transport, today, deliveryEnd);
  }
  return null;
}

/**
 * True when a contract is counted in the late/on-time performance drilldown tree
 * (not the unscheduled bucket). Used by GET /contracts?excludeUnscheduled=true.
 */
export function isContractIncludedInPerfDrilldownTree(
  row: any,
  options: { lateOnTimeFilter?: string } = {},
): boolean {
  if (!resolveEffectiveDeliveryEnd(row)) return false;

  const statusText = String(row.import_status || row.status || '').trim().toUpperCase();
  if (!statusText) return false;

  const isClosed =
    statusText === 'CLOSE' || statusText === 'CLOSED' || statusText === 'COMPLETED';
  const isOpen = statusText === 'OPEN' || statusText === 'ACTIVE';
  if (!isClosed && !isOpen) return false;

  const todayMid = new Date();
  todayMid.setHours(0, 0, 0, 0);

  let tradeCycle = computePerfTradeCycleDaysForRow(row, todayMid);
  if (tradeCycle == null) {
    if (isOpen) tradeCycle = -1;
    else return false;
  }

  const filter = String(options.lateOnTimeFilter || 'ALL').toUpperCase();
  if (filter === 'LATE' || filter === 'ON_TIME') {
    if (tradeCycle == null || Number.isNaN(tradeCycle)) return filter === 'LATE';
    const onTime = isContractPerfOnTimeTradeCycle(row, tradeCycle);
    return filter === 'ON_TIME' ? onTime : !onTime;
  }
  return true;
}

/**
 * Section 3 list filter after GET /contracts has computed trade_cycle_days / contract_perf_on_time.
 * Uses those fields so perf helper columns can be stripped from the response payload.
 */
export function isContractIncludedInPerfDrilldownTreeWithComputed(
  row: any,
  options: { lateOnTimeFilter?: string } = {},
): boolean {
  if (!resolveEffectiveDeliveryEnd(row)) return false;

  const statusText = String(row.import_status || row.status || '').trim().toUpperCase();
  if (!statusText) return false;

  const isClosed =
    statusText === 'CLOSE' || statusText === 'CLOSED' || statusText === 'COMPLETED';
  const isOpen = statusText === 'OPEN' || statusText === 'ACTIVE';
  if (!isClosed && !isOpen) return false;

  const filter = String(options.lateOnTimeFilter || 'ALL').toUpperCase();
  const tradeCycleRaw = row.trade_cycle_days;
  const hasTradeCycle =
    tradeCycleRaw != null && !Number.isNaN(Number(tradeCycleRaw));

  if (filter === 'LATE' || filter === 'ON_TIME') {
    if (typeof row.contract_perf_on_time === 'boolean') {
      return filter === 'ON_TIME' ? row.contract_perf_on_time : !row.contract_perf_on_time;
    }
    if (!hasTradeCycle) return filter === 'LATE';
    const onTime = isContractPerfOnTimeTradeCycle(row, Number(tradeCycleRaw));
    return filter === 'ON_TIME' ? onTime : !onTime;
  }

  if (isClosed && !hasTradeCycle) return false;
  return true;
}

export function aggregateLatePerformanceRows(
  rows: any[],
  filters: LatePerformanceFilters,
  part: LatePerformancePart
) {
  const includeSummary = part === 'summary' || part === 'all';
  const includeTree = part === 'tree' || part === 'all';
  const todayMid = new Date();
  todayMid.setHours(0, 0, 0, 0);

  const root = new Map<string, AggNode>();
  const onTrackRoot = new Map<string, AggNode>();
  const unscheduledRoot = new Map<string, AggNode>();
  const debugNoScheduleRows: Array<{
    contract_id: string;
    product: string;
    outstanding_qty: number;
    transport_mode: string;
  }> = [];

  let lateCount = 0;
  let lateTotalDays = 0;
  let lateMaxDays = 0;
  let lateTotalQtyDelivery = 0;
  let lateTotalLogCycle = 0;
  let lateLogCycleCount = 0;
  let lateTotalCashCycle = 0;
  let lateCashCycleCount = 0;
  let lateOpenOutstandingQty = 0;
  let lateCloseOutstandingQty = 0;

  let onTrackCount = 0;
  let onTrackTotalDaysAhead = 0;
  let onTrackMaxDaysAhead = 0;
  let onTrackTotalQtyDelivery = 0;
  let onTrackTotalLogCycle = 0;
  let onTrackLogCycleCount = 0;
  let onTrackTotalCashCycle = 0;
  let onTrackCashCycleCount = 0;
  let onTrackOpenOutstandingQty = 0;
  let onTrackCloseOutstandingQty = 0;

  let openStatusOutstandingQty = 0;
  let closeStatusContractQty = 0;
  let openStatusTradeCount = 0;
  let openStatusOnTimeCount = 0;
  let openStatusLateCount = 0;
  let openStatusTradeMagnitudeSum = 0;
  let openStatusTradeSignedSum = 0;
  let openStatusLogCycleTotal = 0;
  let openStatusLogCycleCount = 0;
  let openStatusCashCycleTotal = 0;
  let openStatusCashCycleCount = 0;
  let openStatusDpCycleTotal = 0;
  let openStatusDpCycleCount = 0;
  let closeStatusTradeCount = 0;
  let closeStatusOnTimeCount = 0;
  let closeStatusLateCount = 0;
  let closeStatusTradeMagnitudeSum = 0;
  let closeStatusTradeSignedSum = 0;
  let closeStatusLogCycleTotal = 0;
  let closeStatusLogCycleCount = 0;
  let closeStatusCashCycleTotal = 0;
  let closeStatusCashCycleCount = 0;
  let closeStatusDpCycleTotal = 0;
  let closeStatusDpCycleCount = 0;

  type DistBucket = { count: number; qty: number };
  const dist: Record<string, DistBucket> = {
    noData: { count: 0, qty: 0 },
    onTime: { count: 0, qty: 0 },
    d1_7: { count: 0, qty: 0 },
    d8_14: { count: 0, qty: 0 },
    d15_30: { count: 0, qty: 0 },
    d31_60: { count: 0, qty: 0 },
    d61plus: { count: 0, qty: 0 },
  };

  const debugCounts = {
    totalRows: 0,
    missingDeliveryEnd: 0,
    missingStatus: 0,
    unknownStatus: 0,
    missingCompletionDate: 0,
    tradeCycleNull: 0,
    tradeCycleNonPositive: 0,
    includedLate: 0,
    branchClosedLand: 0,
    branchClosedSea: 0,
    branchOpenLand: 0,
    branchOpenSea: 0,
    haveLastTruckCompletion: 0,
    haveLastTruckDeliverable: 0,
    haveLastAtaDischarge: 0,
    haveLastEtaDischarge: 0,
    blankPlantSite: 0,
    nonBlankPlantSite: 0,
  };
  const debugSamples: Record<string, string[]> = {
    missingDeliveryEnd: [],
    missingStatus: [],
    unknownStatus: [],
    missingCompletionDate: [],
    tradeCycleNull: [],
    tradeCycleNonPositive: [],
    includedLate: [],
  };
  const pushSample = (k: keyof typeof debugSamples, contractId: string) => {
    const arr = debugSamples[k];
    if (arr.length < 8) arr.push(contractId);
  };

  for (const row of rows) {
    if (includeSummary) {
      debugCounts.totalRows += 1;
      const plantSiteText = String(row.plant_site || '').trim();
      if (plantSiteText) debugCounts.nonBlankPlantSite += 1;
      else debugCounts.blankPlantSite += 1;
    }

    const statusText = String(row.import_status || row.status || '').trim().toUpperCase();
    const transport = String(row.transport_mode || '').trim().toUpperCase();
    // Section 1 + Section 2: skip contracts with no due date delivery end (DB or SAP).
    const deliveryEnd = resolveEffectiveDeliveryEnd(row);
    if (!deliveryEnd) {
      if (includeSummary) {
        debugCounts.missingDeliveryEnd += 1;
        pushSample('missingDeliveryEnd', String(row.contract_id || ''));
      }
      continue;
    }

    if (!statusText) {
      if (includeSummary) {
        debugCounts.missingStatus += 1;
        pushSample('missingStatus', String(row.contract_id || ''));
      }
      continue;
    }

    const isClosed = statusText === 'CLOSE' || statusText === 'CLOSED' || statusText === 'COMPLETED';
    const isOpen = statusText === 'OPEN' || statusText === 'ACTIVE';
    if (!isClosed && !isOpen) {
      if (includeSummary) {
        debugCounts.unknownStatus += 1;
        pushSample('unknownStatus', `${String(row.contract_id || '')}:${statusText}`);
      }
      continue;
    }

    let tradeCycle: number | null = null;
    if (isClosed) {
      if (transport.startsWith('LAND')) {
        if (includeSummary) {
          debugCounts.branchClosedLand += 1;
          if (row.last_trucking_completion_date) debugCounts.haveLastTruckCompletion += 1;
          if (!row.last_trucking_completion_date) {
            debugCounts.missingCompletionDate += 1;
            pushSample('missingCompletionDate', String(row.contract_id || ''));
          }
        }
        tradeCycle = diffCalendarDays(deliveryEnd, row.last_trucking_completion_date);
      } else {
        if (includeSummary) {
          debugCounts.branchClosedSea += 1;
          if (row.last_ata_vessel_complete_discharge) debugCounts.haveLastAtaDischarge += 1;
          if (!row.last_ata_vessel_complete_discharge) {
            debugCounts.missingCompletionDate += 1;
            pushSample('missingCompletionDate', String(row.contract_id || ''));
          }
        }
        tradeCycle = diffCalendarDays(deliveryEnd, row.last_ata_vessel_complete_discharge);
      }
    } else if (isOpen) {
      if (transport.startsWith('LAND')) {
        if (includeSummary) {
          debugCounts.branchOpenLand += 1;
          if (row.last_trucking_daily_deliverable_date) debugCounts.haveLastTruckDeliverable += 1;
          if (!row.last_trucking_daily_deliverable_date) {
            debugCounts.missingCompletionDate += 1;
            pushSample('missingCompletionDate', String(row.contract_id || ''));
          }
        }
      } else {
        if (includeSummary) {
          debugCounts.branchOpenSea += 1;
          if (row.last_eta_vessel_complete_discharge) debugCounts.haveLastEtaDischarge += 1;
          if (!row.last_eta_vessel_complete_discharge) {
            debugCounts.missingCompletionDate += 1;
            pushSample('missingCompletionDate', String(row.contract_id || ''));
          }
        }
      }
      tradeCycle = computeOpenTradeCycleDays(row, transport, todayMid, deliveryEnd);
    }

    const openUsesConditionB =
      isOpen && !hasCalendarDate(resolveOpenStandardEta(row, transport));

    const _inc = String(row.incoterm || '').trim().toUpperCase();
    const _qtyOrdered = Number(row.quantity_ordered || 0);
    const _subtracted = ['FRC', 'CIF', 'CFR'].includes(_inc)
      ? Number(row.quantity_receive || 0)
      : ['LCO', 'FOB'].includes(_inc)
        ? Number(row.quantity_delivery || 0)
        : Number(row.total_sto_quantity || 0);
    const _outstandingQty = Math.max(0, _qtyOrdered - _subtracted);
    /** Open Section 1/2: outstanding qty. Close Section 1/2: total contract qty (quantity_ordered). */
    const _qtyForPerf = isClosed ? _qtyOrdered : _outstandingQty;

    // Section 1 status cards — only contracts with a resolved due date delivery end (see skip above).
    if (includeSummary) {
      if (isOpen) openStatusOutstandingQty += _outstandingQty;
      else if (isClosed) closeStatusContractQty += _qtyOrdered;
    }

    const cargoReady = row.cargo_readiness_date;
    let logCycle: number | null = null;
    if (cargoReady) {
      if (isClosed) {
        logCycle = transport.startsWith('LAND')
          ? diffInDays(cargoReady, row.last_trucking_completion_date)
          : diffInDays(cargoReady, row.last_ata_vessel_complete_discharge);
      } else if (isOpen) {
        logCycle = computeOpenLogCycleDays(row, transport, todayMid, cargoReady);
      }
    }

    const payoffDate = resolveSapPayoffCalendarDate(row);
    let cashCycle: number | null = null;
    if (payoffDate) {
      if (isClosed) {
        cashCycle = transport.startsWith('LAND')
          ? diffInDays(row.last_trucking_completion_date, payoffDate)
          : diffInDays(row.last_ata_vessel_complete_discharge, payoffDate);
      } else if (isOpen) {
        cashCycle = computeOpenCashCycleDays(row, transport, todayMid, payoffDate);
      }
    }

    const dpDate = resolveSapDpCalendarDate(row);
    let dpCycle: number | null = null;
    if (dpDate) {
      if (isClosed) {
        dpCycle = transport.startsWith('LAND')
          ? diffInDays(row.last_trucking_completion_date, dpDate)
          : diffInDays(row.last_ata_vessel_complete_discharge, dpDate);
      } else if (isOpen) {
        dpCycle = computeOpenDpCycleDays(row, transport, todayMid, dpDate);
      }
    }

    if (tradeCycle == null) {
      if (isOpen) {
        // Open + due end present but Trade Cycle still null (e.g. bad transport) → On Time so qty is not dropped.
        tradeCycle = -1;
      } else {
        if (includeSummary) {
          debugCounts.tradeCycleNull += 1;
          pushSample('tradeCycleNull', String(row.contract_id || ''));
          dist.noData.count += 1;
          dist.noData.qty += _qtyForPerf;
        }
        if (includeTree) {
          addContractRowToPerfTree(unscheduledRoot, row, 0, _qtyForPerf);
        }
        if (filters.debug && debugNoScheduleRows.length < 500) {
          debugNoScheduleRows.push({
            contract_id: String(row.contract_id || ''),
            product: String(row.product || '').trim() || 'Blank',
            outstanding_qty: _qtyForPerf,
            transport_mode: transport,
          });
        }
        continue;
      }
    }

    const contractPerfOnTime = openUsesConditionB
      ? isOpenConditionBOnTime(tradeCycle)
      : isLegacyTradeCycleOnTime(tradeCycle);

    if (includeSummary) {
      const tradeMagnitude = tradeCycle <= 0 ? -tradeCycle : tradeCycle;
      if (isOpen) {
        openStatusTradeCount += 1;
        if (contractPerfOnTime) openStatusOnTimeCount += 1;
        else openStatusLateCount += 1;
        openStatusTradeMagnitudeSum += tradeMagnitude;
        openStatusTradeSignedSum += tradeCycle;
        if (logCycle != null) {
          openStatusLogCycleTotal += logCycle;
          openStatusLogCycleCount += 1;
        }
        if (cashCycle != null) {
          openStatusCashCycleTotal += cashCycle;
          openStatusCashCycleCount += 1;
        }
        if (dpCycle != null) {
          openStatusDpCycleTotal += dpCycle;
          openStatusDpCycleCount += 1;
        }
      } else if (isClosed) {
        closeStatusTradeCount += 1;
        if (isLegacyTradeCycleOnTime(tradeCycle)) closeStatusOnTimeCount += 1;
        else closeStatusLateCount += 1;
        closeStatusTradeMagnitudeSum += tradeMagnitude;
        closeStatusTradeSignedSum += tradeCycle;
        if (logCycle != null) {
          closeStatusLogCycleTotal += logCycle;
          closeStatusLogCycleCount += 1;
        }
        if (cashCycle != null) {
          closeStatusCashCycleTotal += cashCycle;
          closeStatusCashCycleCount += 1;
        }
        if (dpCycle != null) {
          closeStatusDpCycleTotal += dpCycle;
          closeStatusDpCycleCount += 1;
        }
      }
    }

    if (contractPerfOnTime) {
      if (includeSummary) {
        debugCounts.tradeCycleNonPositive += 1;
        pushSample('tradeCycleNonPositive', `${String(row.contract_id || '')}:${tradeCycle}`);
        dist.onTime.count += 1;
        dist.onTime.qty += _qtyForPerf;

        const daysAhead = openUsesConditionB ? Math.max(0, -tradeCycle) : -tradeCycle;
        onTrackCount += 1;
        onTrackTotalDaysAhead += daysAhead;
        onTrackMaxDaysAhead = Math.max(onTrackMaxDaysAhead, daysAhead);
        onTrackTotalQtyDelivery += _qtyForPerf;
        if (logCycle != null) {
          onTrackTotalLogCycle += logCycle;
          onTrackLogCycleCount++;
        }
        if (cashCycle != null) {
          onTrackTotalCashCycle += cashCycle;
          onTrackCashCycleCount++;
        }
        if (isOpen) onTrackOpenOutstandingQty += _outstandingQty;
        else onTrackCloseOutstandingQty += _qtyOrdered;
      }

      if (includeTree) {
        addContractRowToPerfTree(onTrackRoot, row, tradeCycle, _qtyForPerf);
      }
      continue;
    }

    if (includeSummary) {
      if (tradeCycle <= 7) {
        dist.d1_7.count += 1;
        dist.d1_7.qty += _qtyForPerf;
      } else if (tradeCycle <= 14) {
        dist.d8_14.count += 1;
        dist.d8_14.qty += _qtyForPerf;
      } else if (tradeCycle <= 30) {
        dist.d15_30.count += 1;
        dist.d15_30.qty += _qtyForPerf;
      } else if (tradeCycle <= 60) {
        dist.d31_60.count += 1;
        dist.d31_60.qty += _qtyForPerf;
      } else {
        dist.d61plus.count += 1;
        dist.d61plus.qty += _qtyForPerf;
      }

      lateCount += 1;
      lateTotalDays += tradeCycle;
      lateMaxDays = Math.max(lateMaxDays, tradeCycle);
      lateTotalQtyDelivery += _qtyForPerf;
      if (logCycle != null) {
        lateTotalLogCycle += logCycle;
        lateLogCycleCount++;
      }
      if (cashCycle != null) {
        lateTotalCashCycle += cashCycle;
        lateCashCycleCount++;
      }
      if (isOpen) lateOpenOutstandingQty += _outstandingQty;
      else lateCloseOutstandingQty += _qtyOrdered;
      debugCounts.includedLate += 1;
      pushSample('includedLate', `${String(row.contract_id || '')}:${tradeCycle}`);
    }

    if (includeTree) {
      addContractRowToPerfTree(root, row, tradeCycle, _qtyForPerf);
    }
  }

  if (process.env.NODE_ENV === 'development') {
    logger.info('Late Performance debug', {
      scope: filters.scope === 'filtered' ? 'filtered' : 'ytd',
      ytd_range: { dateFrom: filters.effectiveDateFrom, dateTo: filters.effectiveDateTo },
      counts: debugCounts,
      samples: debugSamples,
    });
  }

  const out: {
    summary?: Record<string, unknown>;
    onTrackSummary?: Record<string, unknown>;
    statusCardSummary?: {
      openOutstandingQty: number;
      closeContractQty: number;
      openOnTimeCount: number;
      openLateCount: number;
      closeOnTimeCount: number;
      closeLateCount: number;
      openAvgDays: number;
      openAvgLogCycle: number | null;
      openAvgDpCycle: number | null;
      openAvgCashCycle: number | null;
      openIsLateContext: boolean;
      closeAvgDays: number;
      closeAvgLogCycle: number | null;
      closeAvgDpCycle: number | null;
      closeAvgCashCycle: number | null;
      closeIsLateContext: boolean;
    };
    distribution?: Record<string, DistBucket>;
    tree?: any[];
    onTrackTree?: any[];
    unscheduledTree?: any[];
    debug?: {
      counts: typeof debugCounts;
      samples: typeof debugSamples;
      noScheduleRows?: typeof debugNoScheduleRows;
    };
  } = {};

  if (includeSummary) {
    out.summary = {
      count: lateCount,
      totalDays: lateTotalDays,
      avgDays: lateCount > 0 ? lateTotalDays / lateCount : 0,
      maxDays: lateMaxDays,
      totalQtyDelivery: lateTotalQtyDelivery,
      avgLogCycle: lateLogCycleCount > 0 ? Math.round(lateTotalLogCycle / lateLogCycleCount) : null,
      avgCashCycle: lateCashCycleCount > 0 ? Math.round(lateTotalCashCycle / lateCashCycleCount) : null,
      openOutstandingQty: lateOpenOutstandingQty,
      closeOutstandingQty: lateCloseOutstandingQty,
    };
    out.onTrackSummary = {
      count: onTrackCount,
      totalDays: onTrackTotalDaysAhead,
      avgDays: onTrackCount > 0 ? onTrackTotalDaysAhead / onTrackCount : 0,
      maxDays: onTrackMaxDaysAhead,
      totalQtyDelivery: onTrackTotalQtyDelivery,
      avgLogCycle: onTrackLogCycleCount > 0 ? Math.round(onTrackTotalLogCycle / onTrackLogCycleCount) : null,
      avgCashCycle: onTrackCashCycleCount > 0 ? Math.round(onTrackTotalCashCycle / onTrackCashCycleCount) : null,
      openOutstandingQty: onTrackOpenOutstandingQty,
      closeOutstandingQty: onTrackCloseOutstandingQty,
    };
    out.statusCardSummary = {
      openOutstandingQty: openStatusOutstandingQty,
      closeContractQty: closeStatusContractQty,
      openOnTimeCount: openStatusOnTimeCount,
      openLateCount: openStatusLateCount,
      closeOnTimeCount: closeStatusOnTimeCount,
      closeLateCount: closeStatusLateCount,
      openAvgDays: openStatusTradeCount > 0 ? openStatusTradeMagnitudeSum / openStatusTradeCount : 0,
      openAvgLogCycle:
        openStatusLogCycleCount > 0 ? Math.round(openStatusLogCycleTotal / openStatusLogCycleCount) : null,
      openAvgDpCycle:
        openStatusDpCycleCount > 0 ? Math.round(openStatusDpCycleTotal / openStatusDpCycleCount) : null,
      openAvgCashCycle:
        openStatusCashCycleCount > 0 ? Math.round(openStatusCashCycleTotal / openStatusCashCycleCount) : null,
      openIsLateContext: openStatusTradeCount > 0 ? openStatusTradeSignedSum / openStatusTradeCount > 0 : false,
      closeAvgDays: closeStatusTradeCount > 0 ? closeStatusTradeMagnitudeSum / closeStatusTradeCount : 0,
      closeAvgLogCycle:
        closeStatusLogCycleCount > 0 ? Math.round(closeStatusLogCycleTotal / closeStatusLogCycleCount) : null,
      closeAvgDpCycle:
        closeStatusDpCycleCount > 0 ? Math.round(closeStatusDpCycleTotal / closeStatusDpCycleCount) : null,
      closeAvgCashCycle:
        closeStatusCashCycleCount > 0 ? Math.round(closeStatusCashCycleTotal / closeStatusCashCycleCount) : null,
      closeIsLateContext: closeStatusTradeCount > 0 ? closeStatusTradeSignedSum / closeStatusTradeCount > 0 : false,
    };
    out.distribution = dist;
    if (filters.debug) {
      out.debug = {
        counts: debugCounts,
        samples: debugSamples,
        noScheduleRows: debugNoScheduleRows,
      };
    }
  }

  if (includeTree) {
    out.tree = toSorted(root);
    out.onTrackTree = toSorted(onTrackRoot);
    out.unscheduledTree = toSorted(unscheduledRoot);
  }

  return out;
}

export async function runLatePerformance(req: AuthRequest, part: LatePerformancePart) {
  const filters = parseLatePerformanceFilters(req, part);
  const rows = await loadLatePerformanceRows(filters);
  const aggregated = aggregateLatePerformanceRows(rows, filters, part);

  return {
    scope: filters.scope === 'filtered' ? 'filtered' : 'ytd',
    ytd_range: { dateFrom: filters.effectiveDateFrom, dateTo: filters.effectiveDateTo },
    ...aggregated,
  };
}