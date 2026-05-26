import { diffCalendarDays } from '../utils/calendarDays';
import { query } from '../database/connection';
import logger from '../utils/logger';
import { AuthRequest } from '../middleware/auth';
import { CONTRACTS_QTY_MOVE_CTE } from '../controllers/contractsQtyMoveSql';
import { B2B_CHILD_EXCLUSION_SQL } from '../controllers/contractSqlFragments';

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
  };
  return JSON.stringify(norm);
}

export function parseLatePerformanceFilters(req: AuthRequest): LatePerformanceFilters {
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

  const now = new Date();
  const y = now.getFullYear();
  const ytdFrom = `${y}-01-01`;
  const ytdTo = `${y}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const effectiveDateFrom = scope === 'filtered' ? dateFrom : (dateFrom || ytdFrom);
  const effectiveDateTo = scope === 'filtered' ? dateTo : (dateTo || ytdTo);

  const statusNorm = scope === 'filtered' && typeof status === 'string' ? status.trim() : '';
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
          (
            SELECT MAX((dd->>'date')::date)
            FROM trucking_operations tdd
            CROSS JOIN LATERAL jsonb_array_elements(COALESCE(tdd.daily_deliverables, '[]'::jsonb)) AS dd
            WHERE tdd.contract_id = (array_agg(c.id ORDER BY c.created_at DESC))[1]
              AND (dd->>'date') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
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
          ) AS last_eta_vessel_complete_discharge
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

  if (productFilter && productFilter.toUpperCase() !== 'ALL') {
    queryText += ` AND UPPER(COALESCE(base.product, '')) = UPPER($${paramIndex})`;
    queryParams.push(productFilter);
    paramIndex++;
  }

  if (plants.length > 0) {
    const blankIncluded = plants.some((p) => p === 'Blank');
    const nonBlank = plants.filter((p) => p !== 'Blank');
    const parts: string[] = [];
    if (blankIncluded) parts.push(`(base.plant_code IS NULL OR TRIM(base.plant_code) = '')`);
    if (nonBlank.length > 0) {
      const ph = nonBlank.map(() => `$${paramIndex++}`).join(', ');
      parts.push(
        `COALESCE(NULLIF(TRIM(pnc.group_plant), ''), NULLIF(TRIM(pna.group_plant), ''), 'Blank') IN (${ph})`
      );
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
  let openStatusTradeMagnitudeSum = 0;
  let openStatusTradeSignedSum = 0;
  let openStatusLogCycleTotal = 0;
  let openStatusLogCycleCount = 0;
  let openStatusCashCycleTotal = 0;
  let openStatusCashCycleCount = 0;
  let openStatusDpCycleTotal = 0;
  let openStatusDpCycleCount = 0;
  let closeStatusTradeCount = 0;
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
    const deliveryEnd = due(row.delivery_end_date);
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
        tradeCycle = diffCalendarDays(row.delivery_end_date, row.last_trucking_completion_date);
      } else {
        if (includeSummary) {
          debugCounts.branchClosedSea += 1;
          if (row.last_ata_vessel_complete_discharge) debugCounts.haveLastAtaDischarge += 1;
          if (!row.last_ata_vessel_complete_discharge) {
            debugCounts.missingCompletionDate += 1;
            pushSample('missingCompletionDate', String(row.contract_id || ''));
          }
        }
        tradeCycle = diffCalendarDays(row.delivery_end_date, row.last_ata_vessel_complete_discharge);
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
        tradeCycle = diffCalendarDays(row.delivery_end_date, row.last_trucking_daily_deliverable_date);
      } else {
        if (includeSummary) {
          debugCounts.branchOpenSea += 1;
          if (row.last_eta_vessel_complete_discharge) debugCounts.haveLastEtaDischarge += 1;
          if (!row.last_eta_vessel_complete_discharge) {
            debugCounts.missingCompletionDate += 1;
            pushSample('missingCompletionDate', String(row.contract_id || ''));
          }
        }
        tradeCycle = diffCalendarDays(row.delivery_end_date, row.last_eta_vessel_complete_discharge);
      }
    }

    const _inc = String(row.incoterm || '').trim().toUpperCase();
    const _qtyOrdered = Number(row.quantity_ordered || 0);
    const _subtracted = ['FRC', 'CIF', 'CFR'].includes(_inc)
      ? Number(row.quantity_receive || 0)
      : ['LCO', 'FOB'].includes(_inc)
        ? Number(row.quantity_delivery || 0)
        : Number(row.total_sto_quantity || 0);
    const _outstandingQty = Math.max(0, _qtyOrdered - _subtracted);

    if (includeSummary) {
      if (isOpen) openStatusOutstandingQty += _outstandingQty;
      else if (isClosed) closeStatusContractQty += _qtyOrdered;
    }

    const cargoReady = row.cargo_readiness_date;
    let logCycle: number | null = null;
    if (cargoReady) {
      if (transport.startsWith('LAND')) {
        logCycle = isClosed
          ? diffInDays(cargoReady, row.last_trucking_completion_date)
          : diffInDays(cargoReady, todayMid);
      } else {
        logCycle = isClosed
          ? diffInDays(cargoReady, row.last_ata_vessel_complete_discharge)
          : diffInDays(cargoReady, todayMid);
      }
    }

    const spd = row.latest_spd_data as any;
    const payoffRaw =
      (spd?.payment?.payoff_date && String(spd.payment.payoff_date).trim()) ||
      (spd?.raw?.['Payoff Date'] && String(spd.raw['Payoff Date']).trim()) ||
      null;
    const payoffDate = payoffRaw ? due(payoffRaw) : null;
    let cashCycle: number | null = null;
    if (payoffDate) {
      if (isClosed) {
        cashCycle = transport.startsWith('LAND')
          ? diffInDays(row.last_trucking_completion_date, payoffDate)
          : diffInDays(row.last_ata_vessel_complete_discharge, payoffDate);
      } else if (isOpen) {
        cashCycle = transport.startsWith('LAND')
          ? diffInDays(payoffDate, row.last_trucking_daily_deliverable_date)
          : diffInDays(payoffDate, row.last_eta_vessel_complete_discharge);
      }
    }

    const dpRaw =
      (spd?.payment?.dp_date && String(spd.payment.dp_date).trim()) ||
      (spd?.raw?.['DP Date'] && String(spd.raw['DP Date']).trim()) ||
      null;
    const dpDate = dpRaw ? due(dpRaw) : null;
    let dpCycle: number | null = null;
    if (dpDate) {
      if (isClosed) {
        dpCycle = transport.startsWith('LAND')
          ? diffInDays(row.last_trucking_completion_date, dpDate)
          : diffInDays(row.last_ata_vessel_complete_discharge, dpDate);
      } else if (isOpen) {
        dpCycle = transport.startsWith('LAND')
          ? diffInDays(dpDate, row.last_trucking_daily_deliverable_date)
          : diffInDays(dpDate, row.last_eta_vessel_complete_discharge);
      }
    }

    if (tradeCycle == null) {
      if (includeSummary) {
        debugCounts.tradeCycleNull += 1;
        pushSample('tradeCycleNull', String(row.contract_id || ''));
        dist.noData.count += 1;
        dist.noData.qty += _outstandingQty;
      }
      continue;
    }

    if (includeSummary) {
      const tradeMagnitude = tradeCycle <= 0 ? -tradeCycle : tradeCycle;
      if (isOpen) {
        openStatusTradeCount += 1;
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

    if (tradeCycle <= 0) {
      if (includeSummary) {
        debugCounts.tradeCycleNonPositive += 1;
        pushSample('tradeCycleNonPositive', `${String(row.contract_id || '')}:${tradeCycle}`);
        dist.onTime.count += 1;
        dist.onTime.qty += _outstandingQty;

        const daysAhead = -tradeCycle;
        onTrackCount += 1;
        onTrackTotalDaysAhead += daysAhead;
        onTrackMaxDaysAhead = Math.max(onTrackMaxDaysAhead, daysAhead);
        onTrackTotalQtyDelivery += _outstandingQty;
        if (logCycle != null) {
          onTrackTotalLogCycle += logCycle;
          onTrackLogCycleCount++;
        }
        if (cashCycle != null) {
          onTrackTotalCashCycle += cashCycle;
          onTrackCashCycleCount++;
        }
        if (isOpen) onTrackOpenOutstandingQty += _outstandingQty;
        else onTrackCloseOutstandingQty += _outstandingQty;
      }

      if (includeTree) {
        const otInc = String(row.incoterm || '').trim() || 'Blank';
        const otPl = String(row.plant_site || '').trim() || 'Blank';
        const otProd = String(row.product || '').trim() || 'Blank';
        const otGn = String(row.group_name || '').trim() || 'Blank';
        const otSup = String(row.supplier || '').trim() || 'Blank';
        const daysAhead = -tradeCycle;
        const ot1 = add(onTrackRoot, otInc);
        const ot2 = add(ot1.children, otPl);
        const ot3 = add(ot2.children, otProd);
        const ot4 = add(ot3.children, otGn);
        const ot5 = add(ot4.children, otSup);
        for (const n of [ot1, ot2, ot3, ot4, ot5]) {
          n.count += 1;
          n.totalDays += daysAhead;
          n.maxDays = Math.max(n.maxDays, daysAhead);
          n.totalQtyDelivery += _outstandingQty;
        }
      }
      continue;
    }

    if (includeSummary) {
      if (tradeCycle <= 7) {
        dist.d1_7.count += 1;
        dist.d1_7.qty += _outstandingQty;
      } else if (tradeCycle <= 14) {
        dist.d8_14.count += 1;
        dist.d8_14.qty += _outstandingQty;
      } else if (tradeCycle <= 30) {
        dist.d15_30.count += 1;
        dist.d15_30.qty += _outstandingQty;
      } else if (tradeCycle <= 60) {
        dist.d31_60.count += 1;
        dist.d31_60.qty += _outstandingQty;
      } else {
        dist.d61plus.count += 1;
        dist.d61plus.qty += _outstandingQty;
      }

      lateCount += 1;
      lateTotalDays += tradeCycle;
      lateMaxDays = Math.max(lateMaxDays, tradeCycle);
      lateTotalQtyDelivery += _outstandingQty;
      if (logCycle != null) {
        lateTotalLogCycle += logCycle;
        lateLogCycleCount++;
      }
      if (cashCycle != null) {
        lateTotalCashCycle += cashCycle;
        lateCashCycleCount++;
      }
      if (isOpen) lateOpenOutstandingQty += _outstandingQty;
      else lateCloseOutstandingQty += _outstandingQty;
      debugCounts.includedLate += 1;
      pushSample('includedLate', `${String(row.contract_id || '')}:${tradeCycle}`);
    }

    if (includeTree) {
      const inc = String(row.incoterm || '').trim() || 'Blank';
      const pl = String(row.plant_site || '').trim() || 'Blank';
      const prod = String(row.product || '').trim() || 'Blank';
      const gn = String(row.group_name || '').trim() || 'Blank';
      const sup = String(row.supplier || '').trim() || 'Blank';

      const n1 = add(root, inc);
      const n2 = add(n1.children, pl);
      const n3 = add(n2.children, prod);
      const n4 = add(n3.children, gn);
      const n5 = add(n4.children, sup);
      for (const n of [n1, n2, n3, n4, n5]) {
        n.count += 1;
        n.totalDays += tradeCycle;
        n.maxDays = Math.max(n.maxDays, tradeCycle);
        n.totalQtyDelivery += _outstandingQty;
      }
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
    debug?: { counts: typeof debugCounts; samples: typeof debugSamples };
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
      };
    }
  }

  if (includeTree) {
    out.tree = toSorted(root);
    out.onTrackTree = toSorted(onTrackRoot);
  }

  return out;
}

export async function runLatePerformance(req: AuthRequest, part: LatePerformancePart) {
  const filters = parseLatePerformanceFilters(req);
  const rows = await loadLatePerformanceRows(filters);
  const aggregated = aggregateLatePerformanceRows(rows, filters, part);

  return {
    scope: filters.scope === 'filtered' ? 'filtered' : 'ytd',
    ytd_range: { dateFrom: filters.effectiveDateFrom, dateTo: filters.effectiveDateTo },
    ...aggregated,
  };
}