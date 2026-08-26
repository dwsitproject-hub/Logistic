import { Response } from 'express';
import { query } from '../database/connection';
import {
  computeLateIndicatorText,
} from '../utils/calendarDays';
import { AuthRequest } from '../middleware/auth';
import logger from '../utils/logger';
import {
  appendColumnFiltersBase,
  appendGlobalSearchBase,
  parseColumnFiltersQuery,
} from '../utils/contractListFilters';
import {
  InvalidDateInputError,
  likeContainsPattern,
  parseOptionalStrictDateRange,
  sqlIlikeParam,
} from '../utils/strictDateInput';
import { buildContractsListOuterSql } from './contractsListOuterSql';
import {
  buildContractsListBaseCycleFieldSelectSql,
  sqlHasCycleCompletionDate,
} from '../utils/contractsListCycleSql';
import { buildQtyMoveCte, sqlContractGlobalOutstandingExpr } from './contractsQtyMoveSql';
import { parsePresenceFilter, sqlPresenceListFilter } from '../utils/sapPresenceSql';
import { resolveContractsQtyMoveCte } from '../services/contractQtyMoveSnapshot.service';
import { resolveContractsStoAggCte } from '../services/contractStoAggSnapshot.service';
import { resolveContractsLatestSpdCte } from '../services/contractLatestSpdSnapshot.service';
import {
  sqlContractOutstandingSignedExpr,
  sqlIncotermQuantityDeliveryCase,
  sqlQtyMoveJoinIncotermDelivery,
  sqlTransportModeFromContractAndJson,
} from '../utils/sapIncotermMetrics';
import { appendContractPerfSourceTypeFilter, appendContractPerfSourceTypesFilter, B2B_CHILD_EXCLUSION_SQL, PO_PLACEHOLDER_EXCLUSION_SQL } from './contractSqlFragments';
import { filterContractUpdatesForRole } from '../utils/contractUpdateFields';
import { ttlMemo } from '../utils/ttlMemo';
import { registerListCacheInvalidator } from '../utils/listCacheRegistry';
import { parsePlanningSheetToMatrix, toIsoDate10FromCell } from '../utils/planningSheetDate';
import { isTruckingPageIncoterm, contractEffectiveIncotermExpr } from '../utils/truckingIncotermScope';
import { TRUCKING_OUTSTANDING_QTY_TOLERANCE_KG } from '../utils/truckingQuantitySql';
import {
  computeClosedCashCycleDays,
  computeClosedDpCycleDays,
  computeClosedLogCycleDays,
  computeClosedTradeCycleDays,
  computeOpenCashCycleDays,
  computeOpenDpCycleDays,
  computeOpenLogCycleDays,
  resolveCycleCompletionDate,
  resolveSapDpCalendarDate,
  resolveSapPayoffCalendarDate,
  computePerfTradeCycleDaysForRow,
  isContractIncludedInPerfDrilldownTreeWithComputed,
  isContractPerfOnTimeTradeCycle,
  runLatePerformance,
  resolveOpenPerfOutstandingQtyKg,
  sqlEffectiveDeliveryEndPresent,
  sqlEffectiveDeliveryEndDateExpr,
  parseCommaSeparatedQuery,
} from '../services/latePerformance.service';
import { appendGroupPlantFilter, groupPlantExpr } from '../utils/groupPlantSql';
import {
  sqlB2bEndingBuyerAgg,
  sqlB2bEndingCompanyAgg,
  sqlB2bEndingPlantCodeAgg,
  sqlB2bEndingUnloadExpr,
  sqlB2bOriginEndingChildLateralJoin,
} from '../utils/b2bOriginEndingSql';
import { appendContractPerfProductSubstringSql, appendContractPerfProductsMultiSql } from '../utils/contractPerfProductFilterSql';
import { ensureUserStoContractAssignmentsTable } from '../database/ensureUserStoContractAssignments';
import { toSapDisplayNumber } from '../utils/sapDisplayNumber';
import {
  CONTRACT_REAL_STO_KEYS_SQL,
  CONTRACT_SAP_ONLY_STOS_SQL,
  SHIPMENT_SAP_STO_DETAIL_SQL,
  SPD_EFFECTIVE_STO_SQL,
  TRUCKING_SAP_STO_DETAIL_SQL,
  sqlSapQtyDeliveredForStoKeyExpr,
  sqlSapQtyDeliveredKgFromSpd,
  sqlSapQtyReceiveForStoKeyExpr,
  sqlSapStoQtyForContractPoExpr,
} from '../utils/contractLogisticsStoDetailSql';
import {
  resolveContractLogisticsOperationId,
  resolveContractLogisticsStoNumber,
  resolveContractLogisticsStoStatus,
  summarizeContractLogisticsStoQty,
} from '../utils/contractLogisticsStoDisplay';
import { sqlContractImportStatusExpr, sqlContractImportStatusForStoExpr, sqlContractImportStatusIsClosedExpr, sqlContractImportStatusIsOpenExpr, sqlContractListImportStatusAggExpr, normalizeContractDeliveryStatusForDisplay } from '../utils/contractDeliveryStatus';
import {
  sqlMaxTruckingLastReceiveDateForContract,
  sqlMaxTruckingWbActualsDateForContract,
  sqlSapTruckingStartReceiveDateForStoKey,
  sqlSapTruckingStartReceiveDateForLookupKeys,
  sqlStoTruckingLastReceiveDate,
  sqlStoTruckingLastReceiveDateForLookupKeys,
} from '../utils/truckingSapDates';
import { TRUCKING_REALIZATIONS_JOIN } from '../utils/truckingRealizationSql';

export { B2B_CHILD_EXCLUSION_SQL, PO_PLACEHOLDER_EXCLUSION_SQL };

function expandLogisticsLookupKeys(...values: (string | null | undefined)[]): string[] {
  return [
    ...new Set(
      values
        .flatMap((v) => String(v ?? '').split(',').map((part) => part.trim()))
        .filter((v) => v && v !== '-'),
    ),
  ];
}

/*
 * Contracts list response cache.
 *
 * getContracts had no caching of any kind: measured on a restore of staging, two identical
 * back-to-back requests both cost ~5.9s, so every user paid full price on every page load
 * forever. On a 2-vCPU host that is ~0.33 requests/second of headroom - 50 concurrent users
 * opening Contracts once is enough on its own to saturate the box.
 *
 * The payload is NOT user-scoped (no req.user reference anywhere in the handler), so one cache
 * entry per query-parameter combination is safe to share across users.
 *
 * TTL is deliberately short (60s, not the 5 minutes used by the shipment/trucking lists):
 * contract write paths in this controller have not been audited for cache invalidation, so a
 * long TTL could show a user their own edit missing. 60s still collapses a burst of concurrent
 * readers - which is the load problem - while bounding staleness to something a user would read
 * as "the page hadn't refreshed yet". Register with listCacheRegistry so a shipment/trucking
 * edit clears it too.
 *
 * Only successful 200 responses are cached; errors must never be served from memory.
 */
const CONTRACTS_LIST_CACHE = new Map<string, { payload: unknown; expiresAt: number }>();
const CONTRACTS_LIST_IN_FLIGHT = new Map<string, Promise<{ status: number; payload: unknown }>>();
const CONTRACTS_LIST_TTL_MS = 60 * 1000;
const CONTRACTS_LIST_MAX_ENTRIES = 60;

export function invalidateContractsListCache(): void {
  CONTRACTS_LIST_CACHE.clear();
}

registerListCacheInvalidator(invalidateContractsListCache);

function contractsListCacheKey(query: Record<string, unknown>): string {
  const keys = Object.keys(query).sort();
  const norm: Record<string, unknown> = {};
  for (const k of keys) norm[k] = query[k];
  return JSON.stringify(norm);
}

export const getContracts = async (req: AuthRequest, res: Response) => {
  const cacheKey = contractsListCacheKey((req.query ?? {}) as Record<string, unknown>);

  const cached = CONTRACTS_LIST_CACHE.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) {
    res.json(cached.payload);
    return;
  }
  if (cached) CONTRACTS_LIST_CACHE.delete(cacheKey);

  let run = CONTRACTS_LIST_IN_FLIGHT.get(cacheKey);
  if (!run) {
    run = (async () => {
      // Capture what the original handler would have sent, without changing it.
      let status = 200;
      let payload: unknown;
      const capture = {
        status(code: number) { status = code; return capture; },
        json(body: unknown) { payload = body; return capture; },
        send(body: unknown) { payload = body; return capture; },
        set() { return capture; },
        setHeader() { return capture; },
        headersSent: false,
      } as unknown as Response;
      await getContractsUncached(req, capture);
      return { status, payload };
    })().finally(() => {
      CONTRACTS_LIST_IN_FLIGHT.delete(cacheKey);
    });
    CONTRACTS_LIST_IN_FLIGHT.set(cacheKey, run);
  }

  const { status, payload } = await run;
  if (status === 200 && payload && (payload as { success?: boolean }).success === true) {
    CONTRACTS_LIST_CACHE.set(cacheKey, { payload, expiresAt: Date.now() + CONTRACTS_LIST_TTL_MS });
    if (CONTRACTS_LIST_CACHE.size > CONTRACTS_LIST_MAX_ENTRIES) {
      const oldest = [...CONTRACTS_LIST_CACHE.entries()].sort((a, b) => a[1].expiresAt - b[1].expiresAt)[0];
      if (oldest) CONTRACTS_LIST_CACHE.delete(oldest[0]);
    }
  }
  res.status(status).json(payload);
};

const getContractsUncached = async (req: AuthRequest, res: Response) => {
  try {
    await ensureUserStoContractAssignmentsTable();
    const { status, supplier, buyer, outstanding, companyCode, b2bFlag, page = 1, limit = 10 } = req.query;
    const { dateFrom, dateTo } = parseOptionalStrictDateRange({
      dateFrom: (req.query as { dateFrom?: unknown }).dateFrom,
      dateTo: (req.query as { dateTo?: unknown }).dateTo,
    });
    const productFilter = (req.query as any).product as string | undefined;
    const productsQuery = parseCommaSeparatedQuery((req.query as any).products);
    const productFilters =
      productsQuery.length > 0
        ? productsQuery
        : productFilter?.trim()
          ? [productFilter.trim()]
          : [];
    const sourceTypeFilter = (req.query as any).sourceType as string | undefined;
    const sourceTypesQuery = parseCommaSeparatedQuery((req.query as any).sourceTypes);
    const sourceTypeFilters =
      sourceTypesQuery.length > 0
        ? sourceTypesQuery
        : sourceTypeFilter?.trim()
          ? [sourceTypeFilter.trim()]
          : [];
    const transportMode = (req.query as any).transportMode as string | undefined;
    const unassigned = (req.query as any).unassigned as string | undefined; // 'sea' | 'land' | 'mix'
    const plant = (req.query as any).plant as string | string[] | undefined;
    const sortKeyRaw = String((req.query as any).sortKey || 'contract_date');
    const sortDirRaw = String((req.query as any).sortDir || 'desc').toLowerCase();
    const sortDir = sortDirRaw === 'asc' ? 'ASC' : 'DESC';
    // Allow filtering by a specific contract id (used by shipment details fallback)
    const contractIdFilter = (req.query as any).contract_id || (req.query as any).contractId || null;
    const isSingleContractLookup = Boolean(
      contractIdFilter && String(contractIdFilter).trim().length > 0,
    );
    const offset = (Number(page) - 1) * Number(limit);

    const cycleSortKeys = new Set(['log_cycle_days', 'trade_cycle_days', 'cash_cycle_days']);
    const wantCycleSort = cycleSortKeys.has(sortKeyRaw);
    const lateOnTimeFilterRaw = String((req.query as any).lateOnTimeFilter || 'ALL').toUpperCase();
    const wantLateFilter = lateOnTimeFilterRaw === 'LATE' || lateOnTimeFilterRaw === 'ON_TIME';
    const wantExcludeUnscheduled = String((req.query as any).excludeUnscheduled || 'false') === 'true';
    const listCompact =
      String((req.query as any).compact || '').toLowerCase() === 'true';
    const useSqlLateFilter = wantLateFilter && !wantCycleSort;
    const deferCycleFieldsToPage =
      !wantCycleSort && !wantLateFilter && !wantExcludeUnscheduled;
    const baseCycleFieldsSql = deferCycleFieldsToPage ? '' : `,${buildContractsListBaseCycleFieldSelectSql()}`;

    const queryParams: any[] = [];
    let paramIndex = 1;
    let contractScopeWhere = '';
    // Withdrawn contracts (PO cancelled/deleted in SAP) stay listed by default so their
    // history remains reachable; ?presence=present|withdrawn narrows to one or the other.
    contractScopeWhere += sqlPresenceListFilter(
      parsePresenceFilter((req.query as any).presence),
      'c',
    );
    if (contractIdFilter) {
      contractScopeWhere += ` AND c.contract_id = $${paramIndex}`;
      queryParams.push(contractIdFilter);
      paramIndex++;
    }
    if (dateFrom) {
      contractScopeWhere += ` AND c.contract_date >= $${paramIndex}`;
      queryParams.push(dateFrom);
      paramIndex++;
    }
    if (dateTo) {
      contractScopeWhere += ` AND c.contract_date <= $${paramIndex}`;
      queryParams.push(dateTo);
      paramIndex++;
    }

    const [contractsQtyMoveCte, contractsStoAggCte, contractsLatestSpdCte] = await Promise.all([
      resolveContractsQtyMoveCte('contract_scope'),
      resolveContractsStoAggCte('contract_scope'),
      resolveContractsLatestSpdCte('contract_scope'),
    ]);

    // contract_scope narrows contracts + sap_processed_data work when date / contract_id filters are present (default YTD on UI).
    let queryText = `
      WITH contract_scope AS (
        SELECT DISTINCT c.contract_id
        FROM contracts c
        WHERE 1=1
        ${contractScopeWhere}
      ),
      ${contractsLatestSpdCte},
      ${contractsQtyMoveCte},
      ${contractsStoAggCte},
      base AS (
        SELECT
          c.contract_id,
          (array_agg(c.id ORDER BY c.created_at DESC))[1] AS id,
          -- WITHDRAWN when every row of this contract's PO is gone from SAP. Surfaced so the
          -- UI can badge the row; MIN keeps a group withdrawn only if all members are.
          MIN(c.sap_presence) AS sap_presence,
          MAX(c.sap_withdrawn_reason) AS sap_withdrawn_reason,
          ${sqlB2bEndingBuyerAgg()} AS buyer,
          MAX(c.supplier) AS supplier,
          MAX(c.group_name) AS group_name,
          MAX(c.product) AS product,
          ${sqlB2bEndingCompanyAgg()} AS company_name,
          MAX(c.quantity_ordered) AS quantity_ordered,
          MAX(c.unit) AS unit,
          MAX(c.contract_date) AS contract_date,
          MAX(c.delivery_start_date) AS delivery_start_date,
          MAX(c.delivery_end_date) AS delivery_end_date,
          MAX(c.contract_value) AS contract_value,
          MAX(c.unit_price) AS unit_price,
          MAX(c.currency) AS currency,
          MAX(c.status) AS status,
          MAX(c.incoterm) AS incoterm,
          MAX(c.transport_mode) AS transport_mode,
          MAX(c.source_type) AS source_type,
          MAX(c.contract_type) AS contract_type,
          MAX(c.logistics_classification) AS logistics_classification,
          MAX(c.po_classification) AS po_classification,
          ${sqlB2bEndingPlantCodeAgg()} AS plant_code,
          MAX(c.cargo_readiness_date) AS cargo_readiness_date,
          MAX(c.created_at) AS created_at,
          STRING_AGG(DISTINCT c.po_number, ', ' ORDER BY c.po_number) FILTER (WHERE c.po_number IS NOT NULL AND c.po_number != '') AS po_numbers,
          MAX(c.sto_number) AS sto_number,
          (array_agg(l.data ORDER BY l.created_at DESC NULLS LAST))[1] AS latest_spd_data,
          (array_agg(s.sto_numbers ORDER BY s.total_sto_quantity DESC NULLS LAST))[1] AS sto_numbers_agg,
          (array_agg(s.total_sto_quantity ORDER BY s.total_sto_quantity DESC NULLS LAST))[1] AS total_sto_quantity,
          (array_agg(s.sto_count ORDER BY s.sto_count DESC NULLS LAST))[1] AS sto_count,
          ${sqlContractListImportStatusAggExpr('c')} AS import_status,
          MAX(${sqlIncotermQuantityDeliveryCase(
            'c.incoterm',
            'qm.quantity_delivery_trucking',
            'qm.quantity_delivery_vessel',
            sqlTransportModeFromContractAndJson('c.transport_mode', 'l.data'),
          )}) AS quantity_delivery,
          (array_agg(qm.quantity_receive ORDER BY qm.quantity_receive DESC NULLS LAST))[1] AS quantity_receive,
          (array_agg(qm.quantity_delivery ORDER BY qm.quantity_delivery DESC NULLS LAST))[1] AS quantity_delivery_sap,
          COUNT(DISTINCT c.po_number) FILTER (WHERE c.po_number IS NOT NULL) AS po_count${baseCycleFieldsSql}
        FROM contract_scope cs
        INNER JOIN contracts c ON c.contract_id = cs.contract_id
        LEFT JOIN latest_spd l ON l.contract_number = c.contract_id
        ${sqlB2bOriginEndingChildLateralJoin({ originPoExpr: 'c.po_number' })}
        LEFT JOIN sto_agg s ON s.contract_number = c.contract_id
        LEFT JOIN qty_move qm ON qm.contract_number = c.contract_id
        WHERE 1=1
        GROUP BY c.contract_id
      ),
      filtered AS (
        SELECT * FROM base
        WHERE 1=1
        ${isSingleContractLookup ? '' : B2B_CHILD_EXCLUSION_SQL}
        ${isSingleContractLookup ? '' : PO_PLACEHOLDER_EXCLUSION_SQL}
    `;

    const statusNorm = typeof status === 'string' ? status.trim() : '';
    if (statusNorm && statusNorm !== 'All Status' && statusNorm.toLowerCase() !== 'all') {
      if (statusNorm === 'Open' || statusNorm === 'ACTIVE') {
        queryText += ` AND ${sqlContractImportStatusIsOpenExpr(
          'base.import_status',
          'base.latest_spd_data IS NULL AND UPPER(base.status) IN (\'OPEN\', \'ACTIVE\')',
        )}`;
      } else if (statusNorm === 'Close' || statusNorm === 'CLOSE') {
        queryText += ` AND ${sqlContractImportStatusIsClosedExpr(
          'base.import_status',
          'base.latest_spd_data IS NULL AND UPPER(base.status) IN (\'CLOSE\', \'COMPLETED\', \'CLOSED\')',
        )}`;
      } else {
        queryText += ` AND (base.status = $${paramIndex} OR base.import_status = $${paramIndex})`;
        queryParams.push(statusNorm);
        paramIndex++;
      }
    }

    if (supplier) {
      queryText += ` AND base.supplier ${sqlIlikeParam(paramIndex)}`;
      queryParams.push(likeContainsPattern(String(supplier)));
      paramIndex++;
    }

    if (buyer) {
      queryText += ` AND base.buyer ${sqlIlikeParam(paramIndex)}`;
      queryParams.push(likeContainsPattern(String(buyer)));
      paramIndex++;
    }

    if (transportMode) {
      queryText += ` AND UPPER(base.transport_mode) = $${paramIndex}`;
      queryParams.push(String(transportMode).toUpperCase());
      paramIndex++;
    }

    if (companyCode) {
      queryText += ` AND (
        COALESCE(base.latest_spd_data->'contract'->>'company_code', base.latest_spd_data->'raw'->>'Company Code', base.latest_spd_data->'raw'->>'company code', base.latest_spd_data->>'Company Code', base.latest_spd_data->>'company code', '') = $${paramIndex}
      )`;
      queryParams.push(companyCode);
      paramIndex++;
    }

    if (b2bFlag) {
      queryText += ` AND (
        COALESCE(base.latest_spd_data->'contract'->>'contract_type', base.latest_spd_data->>'B2B Flag', '') = $${paramIndex}
      )`;
      queryParams.push(b2bFlag);
      paramIndex++;
    }

    const multiProductClause = appendContractPerfProductsMultiSql(
      productFilters.length > 1 ? productFilters : undefined,
      'base.product',
      paramIndex,
    );
    if (multiProductClause) {
      queryText += multiProductClause.clause;
      queryParams.push(...multiProductClause.params);
      paramIndex = multiProductClause.nextParamIndex;
    } else {
      const singleProduct =
        productFilter?.trim() || (productFilters.length === 1 ? productFilters[0] : undefined);
      const productClause = appendContractPerfProductSubstringSql(singleProduct, 'base.product', paramIndex);
      if (productClause) {
        queryText += productClause.clause;
        queryParams.push(productClause.param);
        paramIndex = productClause.nextParamIndex;
      }
    }

    if (sourceTypeFilters.length > 1) {
      queryText += appendContractPerfSourceTypesFilter(sourceTypeFilters, 'base.source_type');
    } else {
      const singleSource =
        sourceTypeFilter?.trim() || (sourceTypeFilters.length === 1 ? sourceTypeFilters[0] : undefined);
      queryText += appendContractPerfSourceTypeFilter(singleSource, 'base.source_type');
    }

    if (outstanding === 'true') {
      queryText += ` AND (${sqlContractOutstandingSignedExpr({
        contractQtyExpr: 'base.quantity_ordered',
        incotermExpr: 'base.incoterm',
        receiveExpr: 'base.quantity_receive',
        deliveryExpr: 'base.quantity_delivery',
      })}) > 0`;
    }

    // Optional: delivered=true -> only contracts that have any STO quantity (delivered > 0)
    if ((req.query as any).delivered === 'true') {
      queryText += ` AND COALESCE(base.total_sto_quantity, 0) > 0`;
    }

    const effectiveTransportExpr = `UPPER(TRIM(COALESCE(NULLIF(TRIM(base.transport_mode), ''), base.latest_spd_data->'contract'->>'transport_mode', base.latest_spd_data->'contract'->>'sea_land', base.latest_spd_data->'raw'->>'Sea / Land', base.latest_spd_data->'raw'->>'Sea_Land', '')))`;
    if (unassigned === 'sea') {
      queryText += ` AND ${effectiveTransportExpr} LIKE 'SEA%' AND NOT EXISTS (SELECT 1 FROM shipments s WHERE s.contract_id = base.id)`;
    } else if (unassigned === 'land') {
      queryText += ` AND ${effectiveTransportExpr} LIKE 'LAND%' AND NOT EXISTS (SELECT 1 FROM trucking_operations t WHERE t.contract_id = base.id)`;
    } else if (unassigned === 'mix') {
      queryText += ` AND ${effectiveTransportExpr} LIKE 'MIX%' AND (
        NOT EXISTS (SELECT 1 FROM shipments s WHERE s.contract_id = base.id)
        OR NOT EXISTS (SELECT 1 FROM trucking_operations t WHERE t.contract_id = base.id)
      )`;
    }

    // Group Plant filter via master_plants (matches contract performance / filter-options).
    const plantArr = Array.isArray(plant) ? plant : (plant ? [plant] : []);
    const plants = plantArr.map((p) => String(p)).filter((p) => p.trim() !== '');
    const groupPlantFilter = appendGroupPlantFilter(
      plants,
      paramIndex,
      groupPlantExpr('base.plant_code', 'base.company_name'),
    );
    queryText += groupPlantFilter.sql;
    queryParams.push(...groupPlantFilter.params);
    paramIndex = groupPlantFilter.nextIndex;

    const globalSearch =
      typeof (req.query as any).search === 'string' ? (req.query as any).search.trim() : '';
    const colFilters = parseColumnFiltersQuery((req.query as any).columnFilters);

    const searchFrag = appendGlobalSearchBase(globalSearch, paramIndex);
    queryText += searchFrag.sql;
    queryParams.push(...searchFrag.params);
    paramIndex = searchFrag.nextIndex;

    const colFrag = appendColumnFiltersBase(colFilters, paramIndex);
    queryText += colFrag.sql;
    queryParams.push(...colFrag.params);
    paramIndex = colFrag.nextIndex;

    const limitParam = paramIndex;
    const offsetParam = paramIndex + 1;

    const outstandingQtyExpr = sqlContractOutstandingSignedExpr({
      contractQtyExpr: 'quantity_ordered',
      incotermExpr: 'incoterm',
      receiveExpr: 'quantity_receive',
      deliveryExpr: 'quantity_delivery',
    });
    const allowedSort: Record<string, string> = {
      contract_date: 'contract_date::date',
      contract_id: 'contract_id',
      status: 'status',
      supplier: 'supplier',
      supplier_name: 'supplier',
      buyer: 'buyer',
      product: 'product',
      group_name: 'group_name',
      company_name: 'company_name',
      incoterm: 'incoterm',
      transport_mode: 'transport_mode',
      delivery_start: 'delivery_start_date::date',
      delivery_end: 'delivery_end_date::date',
      delivery_start_date: 'delivery_start_date::date',
      delivery_end_date: 'delivery_end_date::date',
      sto_count: 'sto_count',
      total_sto_quantity: 'total_sto_quantity',
      outstanding_qty: outstandingQtyExpr,
      outstanding_qty_mt: outstandingQtyExpr,
      contract_qty: 'quantity_ordered',
      created_at: 'created_at',
      // computed (JS): log_cycle_days, trade_cycle_days, cash_cycle_days, dp_cycle_days
    };
    const sortKey = allowedSort[sortKeyRaw] ? sortKeyRaw : 'contract_date';
    const orderExpr = allowedSort[sortKey] || 'contract_date::date';

    // Detect cycle sort / late filter (flags computed above before base CTE).
    // Use incoterm-aware import_status (UAT) — same as Open/Close filters and tree aggregation.
    const _statusExpr = `UPPER(TRIM(COALESCE(NULLIF(TRIM(import_status), ''), NULLIF(TRIM(status), ''), '')))`;
    const _transportExpr = `UPPER(TRIM(COALESCE(transport_mode, '')))`;
    // Signed outstanding kg over filtered/base columns — the same expression the outer
    // projection later exposes AS outstanding_quantity. These conditions run against the
    // `filtered` CTE, where that column does not exist yet (referencing it bare made
    // every excludeUnscheduled / drilldown-Late request fail with 42703).
    const filteredOutstandingSql = `(${sqlContractOutstandingSignedExpr({
      contractQtyExpr: 'quantity_ordered',
      incotermExpr: 'incoterm',
      receiveExpr: 'quantity_receive',
      deliveryExpr: 'quantity_delivery',
    })})`;

    // Schedulable = due-end present + known status + cycle Completion Date
    // (LAND: OS≈0 → Last Receive/WB else planning/ETA; SEA: ATC → ETA at LP). No Today.
    const schedulableCondition = `
      ${sqlEffectiveDeliveryEndPresent()}
      AND ${_statusExpr} IN ('OPEN','ACTIVE','CLOSE','CLOSED','COMPLETED')
      AND ${sqlHasCycleCompletionDate('transport_mode', filteredOutstandingSql)}`;

    // Push Late/On-Track filter into SQL when cycle sort is NOT also requested.
    // Open Condition A/B share the same on-time threshold (trade_cycle <= 0); trade cycle
    // uses effective due-end + completion milestones aligned with latePerformance.service.
    const effectiveDeliveryEndDateSql = sqlEffectiveDeliveryEndDateExpr();
    const landOsFulfilled = `(${filteredOutstandingSql} IS NOT NULL AND ${filteredOutstandingSql}::numeric <= ${TRUCKING_OUTSTANDING_QTY_TOLERANCE_KG})`;
    const tradeCycleSqlExpr = `
      CASE
        WHEN ${_statusExpr} IN ('CLOSE', 'CLOSED', 'COMPLETED', 'OPEN', 'ACTIVE')
             AND ${sqlEffectiveDeliveryEndPresent()}
          THEN CASE
            WHEN ${_transportExpr} LIKE 'LAND%' AND ${landOsFulfilled} AND last_trucking_completion_date IS NOT NULL
              THEN (last_trucking_completion_date::date - ${effectiveDeliveryEndDateSql})
            WHEN ${_transportExpr} LIKE 'LAND%' AND ${landOsFulfilled} AND last_trucking_wb_actuals_date IS NOT NULL
              THEN (last_trucking_wb_actuals_date::date - ${effectiveDeliveryEndDateSql})
            WHEN ${_transportExpr} LIKE 'LAND%' AND last_trucking_daily_deliverable_date IS NOT NULL
              THEN (last_trucking_daily_deliverable_date::date - ${effectiveDeliveryEndDateSql})
            WHEN ${_transportExpr} LIKE 'LAND%' AND open_standard_eta_trucking IS NOT NULL
              THEN (open_standard_eta_trucking::date - ${effectiveDeliveryEndDateSql})
            WHEN ${_transportExpr} LIKE 'SEA%' AND last_ata_vessel_complete_discharge IS NOT NULL
              THEN (last_ata_vessel_complete_discharge::date - ${effectiveDeliveryEndDateSql})
            WHEN ${_transportExpr} LIKE 'SEA%' AND open_standard_eta_vessel_loading IS NOT NULL
              THEN (open_standard_eta_vessel_loading::date - ${effectiveDeliveryEndDateSql})
            ELSE NULL END
        ELSE NULL
      END`;

    const lateConditionSql = lateOnTimeFilterRaw === 'LATE'
      ? 'tc.trade_cycle_days_sql IS NOT NULL AND tc.trade_cycle_days_sql > 0'
      : 'tc.trade_cycle_days_sql IS NOT NULL AND tc.trade_cycle_days_sql <= 0';

    const schedulableSource = wantExcludeUnscheduled ? 'filtered_perf' : 'filtered';
    const sqlExcludeUnscheduledInject = wantExcludeUnscheduled
      ? `, filtered_perf AS (SELECT * FROM filtered WHERE ${schedulableCondition})`
      : '';
    const sqlLateInject = useSqlLateFilter
      ? `, tc AS (SELECT *, ${tradeCycleSqlExpr} AS trade_cycle_days_sql FROM ${schedulableSource})
         , filtered_late AS (SELECT * FROM tc WHERE ${lateConditionSql})`
      : '';

    const pageSource = useSqlLateFilter ? 'filtered_late' : schedulableSource;

    const filteredClosedAndPage = `
      )
      ${sqlExcludeUnscheduledInject}
      ${sqlLateInject}
      , page AS (
        SELECT * FROM ${pageSource}
        ORDER BY ${orderExpr} ${sortDir} NULLS LAST, contract_date DESC NULLS LAST, contract_id DESC
        LIMIT $${limitParam} OFFSET $${offsetParam}
      )
`;
    const listQuery = queryText + filteredClosedAndPage + buildContractsListOuterSql(deferCycleFieldsToPage, { compact: listCompact });
    const listParams = [...queryParams, Number(limit), offset];

    let countQuery = `${queryText})`;
    if (wantExcludeUnscheduled) {
      countQuery += `, filtered_perf AS (SELECT * FROM filtered WHERE ${schedulableCondition})`;
    }
    const countSource = wantExcludeUnscheduled ? 'filtered_perf' : 'filtered';
    if (useSqlLateFilter) {
      countQuery += `, tc AS (SELECT *, ${tradeCycleSqlExpr} AS trade_cycle_days_sql FROM ${countSource})`;
      countQuery += `, filtered_late AS (SELECT * FROM tc WHERE ${lateConditionSql})`;
      countQuery += ` SELECT COUNT(*)::int AS count FROM filtered_late`;
    } else {
      countQuery += ` SELECT COUNT(*)::int AS count FROM ${countSource}`;
    }
    const countParams = [...queryParams];

    let totalCount = 0;
    let result: any;
    const needNodePostProcess = wantCycleSort || (wantLateFilter && !useSqlLateFilter);
    if (!needNodePostProcess) {
      const [countResult, listResult] = await Promise.all([
        query(countQuery, countParams),
        query(listQuery, listParams),
      ]);
      totalCount = Number(countResult.rows[0]?.count ?? 0);
      result = listResult;
    } else {
      const countResult = await query(countQuery, countParams);
      totalCount = Number(countResult.rows[0]?.count ?? 0);
      const cap = Math.min(totalCount, 10000);
      result = await query(listQuery, [...queryParams, cap, 0]);
    }

    const due = (d: unknown): Date | null => {
      if (d == null) return null;
      if (d instanceof Date) return d;
      if (typeof d !== 'string') return null;
      const s = d.trim();
      if (!s) return null;
      // YYYY-MM-DD (or full ISO) -> local calendar date (avoid UTC date-only drift)
      if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
        const [y, mo, d] = s.slice(0, 10).split('-').map(Number);
        if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
          const cal = new Date(y, mo - 1, d);
          if (cal.getFullYear() === y && cal.getMonth() === mo - 1 && cal.getDate() === d) return cal;
        }
        return null;
      }
      // DD/MM/YYYY (or DD-MM-YYYY, DD.MM.YYYY) -> day-first parse (Indonesia templates)
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
      // Month-name strings etc.
      const dt = new Date(s);
      return Number.isNaN(dt.getTime()) ? null : dt;
    };
    const parseDeviation = (s: unknown): number | null => {
      if (s == null) return null;
      if (typeof s === 'number' && Number.isInteger(s)) return s;
      if (typeof s === 'string') {
        const n = parseInt(s.trim(), 10);
        return Number.isNaN(n) ? null : n;
      }
      return null;
    };

    // Apply B2B origin company name override (in-memory) so UI sees correct company_name even before backfill runs.
    const b2bOriginPoNumbers: string[] = [];
    for (const row of result.rows) {
      const typeText = String(row.contract_type || row.b2b_flag || '').toUpperCase();
      const refPo = String(row.contract_reference_po || '').trim();
      if (typeText === 'B2B' && refPo === '') {
        const originPo =
          (row.po_numbers && String(row.po_numbers).split(',')[0].trim()) ||
          (row.po_number && String(row.po_number).trim()) ||
          '';
        if (originPo) {
          b2bOriginPoNumbers.push(originPo);
        }
      }
    }

    let b2bOriginCompany: Record<string, string> = {};
    if (b2bOriginPoNumbers.length > 0) {
      const q = `
        WITH latest_spd AS (
          SELECT DISTINCT ON (contract_number) contract_number, data, created_at
          FROM sap_processed_data
          WHERE contract_number IS NOT NULL AND TRIM(contract_number) != ''
          ORDER BY contract_number, created_at DESC NULLS LAST
        ),
        origin AS (
          SELECT unnest($1::text[]) AS origin_po_number
        ),
        children AS (
          SELECT
            o.origin_po_number,
            c2.contract_date,
            COALESCE(NULLIF(TRIM(c2.company_name), ''), l2.data->'raw'->>'Buyer', l2.data->>'Buyer', '') AS company_name
          FROM origin o
          JOIN contracts c2 ON 1=1
          LEFT JOIN latest_spd l2 ON l2.contract_number = c2.contract_id
          WHERE NULLIF(TRIM(COALESCE(l2.data->'contract'->>'contract_reference_po', l2.data->>'CONTRACT REFF PO')), '') = o.origin_po_number
        )
        SELECT DISTINCT ON (origin_po_number)
          origin_po_number,
          company_name
        FROM children
        WHERE company_name != ''
        ORDER BY origin_po_number, contract_date DESC NULLS LAST
      `;
      const r = await query(q, [b2bOriginPoNumbers]);
      b2bOriginCompany = (r.rows || []).reduce((acc: Record<string, string>, row: any) => {
        acc[String(row.origin_po_number)] = String(row.company_name);
        return acc;
      }, {});
    }

    for (const row of result.rows) {
      row.due_date_payment = due(row.due_date_payment_raw) ?? due(row.due_date_payment_fb) ?? row.due_date_payment;
      row.import_status = normalizeContractDeliveryStatusForDisplay(row.import_status || row.status) || row.import_status;
      row.status = normalizeContractDeliveryStatusForDisplay(row.status) || row.status;
      row.gr_po_status = normalizeContractDeliveryStatusForDisplay(row.gr_po_status) || null;
      row.gr_sto_status = normalizeContractDeliveryStatusForDisplay(row.gr_sto_status) || null;
      // DP / Payoff display: SAP raw only (payment JSON + raw columns) — no payments-table or deviation synthesis
      row.dp_date = due(row.dp_date_raw);
      row.payoff_date = due(row.payoff_date_raw);
      row.dp_date_deviation_days = parseDeviation(row.dp_date_deviation_raw) ?? row.dp_date_deviation_fb ?? row.dp_date_deviation_days;
      row.payoff_date_deviation_days = parseDeviation(row.payoff_date_deviation_raw) ?? row.payoff_date_deviation_fb ?? row.payoff_date_deviation_days;

      // Compute Over/Under Delivery Status for UI
      const statusText = String(row.import_status || row.status || '').toUpperCase();
      const outQty = typeof row.outstanding_quantity === 'number' ? row.outstanding_quantity : Number(row.outstanding_quantity) || 0;
      let overUnder: string = '-';
      if (statusText === 'CLOSE' || statusText === 'CLOSED' || statusText === 'COMPLETED') {
        // New rule: when Close, compare Outstanding vs 0.
        // outstanding < 0 => over delivery, outstanding > 0 => under delivery, outstanding = 0 => passed
        if (outQty < 0) {
          overUnder = 'Over Delivery';
        } else if (outQty > 0) {
          overUnder = 'Under Delivery';
        } else {
          overUnder = 'Passed';
        }
      }
      (row as any).over_under_delivery_status = overUnder;

      // Compute Log / Trade / Cash / DP — shared completion (LAND OS≈0 gate for Last Receive/WB)
      const transport = String(row.transport_mode || '').toUpperCase();
      let logCycle: number | null = null;
      const today = new Date();
      const todayMid = new Date(today.getFullYear(), today.getMonth(), today.getDate());

      const cargoReady = row.cargo_readiness_date;

      if (statusText === 'CLOSE' || statusText === 'CLOSED' || statusText === 'COMPLETED') {
        logCycle = computeClosedLogCycleDays(row, transport, cargoReady);
      } else if (statusText === 'OPEN' || statusText === 'ACTIVE') {
        logCycle = computeOpenLogCycleDays(row, transport, todayMid, cargoReady);
      }

      (row as any).log_cycle_days = logCycle;

      const payoffDate = resolveSapPayoffCalendarDate(row);
      const dpDate = resolveSapDpCalendarDate(row);

      // Trade Cycle — same rules as late-performance tree (Section 2).
      const tradeCycle = computePerfTradeCycleDaysForRow(row, todayMid);
      (row as any).trade_cycle_days = tradeCycle;
      if (typeof tradeCycle === 'number' && !Number.isNaN(tradeCycle)) {
        (row as any).contract_perf_on_time = isContractPerfOnTimeTradeCycle(row, tradeCycle);
      }

      const perfLateFilter = wantLateFilter ? lateOnTimeFilterRaw : 'ALL';
      (row as any).contract_perf_in_tree = isContractIncludedInPerfDrilldownTreeWithComputed(row, {
        lateOnTimeFilter: perfLateFilter,
      });

      let cashCycle: number | null = null;
      if ((statusText === 'CLOSE' || statusText === 'CLOSED' || statusText === 'COMPLETED') && payoffDate) {
        cashCycle = computeClosedCashCycleDays(row, transport, payoffDate);
      } else if ((statusText === 'OPEN' || statusText === 'ACTIVE') && payoffDate) {
        cashCycle = computeOpenCashCycleDays(row, transport, todayMid, payoffDate);
      }
      (row as any).cash_cycle_days = cashCycle;

      let dpCycle: number | null = null;
      if ((statusText === 'CLOSE' || statusText === 'CLOSED' || statusText === 'COMPLETED') && dpDate) {
        dpCycle = computeClosedDpCycleDays(row, transport, dpDate);
      } else if ((statusText === 'OPEN' || statusText === 'ACTIVE') && dpDate) {
        dpCycle = computeOpenDpCycleDays(row, transport, todayMid, dpDate);
      }
      (row as any).dp_cycle_days = dpCycle;

      delete (row as any).due_date_payment_raw;
      delete (row as any).dp_date_raw;
      delete (row as any).payoff_date_raw;
      delete (row as any).dp_date_deviation_raw;
      delete (row as any).payoff_date_deviation_raw;
      delete (row as any).due_date_payment_fb;
      delete (row as any).dp_date_fb;
      delete (row as any).payoff_date_fb;
      delete (row as any).dp_date_deviation_fb;
      delete (row as any).payoff_date_deviation_fb;

      // Payment Status (summary)
      // Treat a contract as PAID when Payoff Date exists (as per finance logic); otherwise PENDING if it has a due date.
      const paymentStatus =
        payoffDate ? 'PAID' : (due(row.due_date_payment) ? 'PENDING' : '-');
      (row as any).payment_status = paymentStatus;

      // B2B origin company name override
      const typeText = String(row.contract_type || row.b2b_flag || '').toUpperCase();
      const refPo = String(row.contract_reference_po || '').trim();
      if (typeText === 'B2B' && refPo === '') {
        const originPo =
          (row.po_numbers && String(row.po_numbers).split(',')[0].trim()) ||
          (row.po_number && String(row.po_number).trim()) ||
          '';
        const override = originPo ? b2bOriginCompany[originPo] : undefined;
        if (override) {
          (row as any).company_name = override;
        }
      }
    }

    let responseTotal = totalCount;

    // Node-side late filter / cycle sort (10k fetch when either is active).
    const needNodeLateFilter = wantLateFilter && !useSqlLateFilter;
    const needNodeExcludeFilter = wantExcludeUnscheduled && !useSqlLateFilter;
    const needNodeSort = wantCycleSort;
    if (needNodeLateFilter || needNodeExcludeFilter || needNodeSort) {
      let rows = result.rows as any[];

      if (needNodeLateFilter || needNodeExcludeFilter) {
        rows = rows.filter((r: any) =>
          isContractIncludedInPerfDrilldownTreeWithComputed(r, {
            lateOnTimeFilter: wantLateFilter ? lateOnTimeFilterRaw : 'ALL',
          }),
        );
        responseTotal = rows.length;
      }

      if (needNodeSort) {
        const dirMul = sortDir === 'ASC' ? 1 : -1;
        const getNum = (r: any) => (typeof r?.[sortKeyRaw] === 'number' ? r[sortKeyRaw] : null);
        rows = [...rows].sort((a, b) => {
          const av = getNum(a);
          const bv = getNum(b);
          if (av == null && bv == null) return 0;
          if (av == null) return 1;
          if (bv == null) return -1;
          return (av - bv) * dirMul;
        });
      }

      result.rows = rows.slice(offset, offset + Number(limit));
    }

    for (const row of result.rows) {
      // Expose for Contract Performance / Contracts table (last date from trucking daily planning).
      ;(row as any).last_planning_delivery_date =
        (row as any).last_trucking_daily_deliverable_date ?? null
      delete (row as any).first_trucking_start_date;
      delete (row as any).last_trucking_completion_date;
      delete (row as any).last_trucking_wb_actuals_date;
      delete (row as any).last_trucking_daily_deliverable_date;
      delete (row as any).first_ata_vessel_completed_loading;
      delete (row as any).last_ata_vessel_complete_discharge;
      delete (row as any).last_eta_vessel_complete_discharge;
      delete (row as any).last_vessel_name;
      delete (row as any).last_eta_vessel_completed_loading;
      delete (row as any).open_standard_eta_trucking;
      delete (row as any).open_standard_eta_vessel_loading;
    }

    res.json({
      success: true,
      data: {
        contracts: result.rows,
        pagination: {
          total: responseTotal,
          page: Number(page),
          limit: Number(limit),
          totalPages: Math.ceil(responseTotal / Number(limit)),
        },
      },
    });
  } catch (error: unknown) {
    if (error instanceof InvalidDateInputError) {
      res.status(400).json({ success: false, error: { message: error.message } });
      return;
    }
    const pgCode = (error as { code?: string })?.code;
    const pgDetail = (error as { detail?: string })?.detail;
    const pgMessage = error instanceof Error ? error.message : String(error);
    logger.error('Get contracts error:', { pgCode, pgDetail, message: pgMessage, error });
    res.status(500).json({
      success: false,
      error: {
        message: 'Failed to fetch contracts',
        ...(process.env.NODE_ENV !== 'production' && pgMessage ? { detail: pgMessage } : {}),
      },
    });
  }
};

export const getContractFilterIncoterms = async (_req: AuthRequest, res: Response) => {
  try {
    const r = await query(
      `
      SELECT DISTINCT COALESCE(NULLIF(TRIM(incoterm), ''), 'Blank') AS incoterm
      FROM contracts
      ORDER BY incoterm
      `,
    );
    return res.json({ success: true, data: { incoterms: r.rows.map((x: any) => String(x.incoterm)) } });
  } catch (error) {
    logger.error('Get contract incoterm filter options error:', error);
    return res.status(500).json({ success: false, error: { message: 'Failed to fetch incoterm filter options' } });
  }
};

/** Contract Performance — Group Plant options from master_plants (same source as plant_site filter logic). */
export const getContractFilterGroupPlants = async (_req: AuthRequest, res: Response) => {
  try {
    const r = await query(
      `
      SELECT DISTINCT COALESCE(NULLIF(TRIM(group_plant), ''), 'Blank') AS group_plant
      FROM master_plants
      WHERE group_plant IS NOT NULL
      ORDER BY group_plant
      `,
    );
    return res.json({
      success: true,
      data: { groupPlants: r.rows.map((x: { group_plant: string }) => String(x.group_plant)) },
    });
  } catch (error) {
    logger.error('Get contract group plant filter options error:', error);
    return res.status(500).json({ success: false, error: { message: 'Failed to fetch group plant filter options' } });
  }
};

export const getContractFilterB2bFlags = async (_req: AuthRequest, res: Response) => {
  try {
    // Full sap_processed_data JSONB scan for a rarely-changing dropdown list —
    // memoized for 5 minutes (identical query, just not re-run per page load).
    const b2bFlags = await ttlMemo('filter-options:b2b-flags', 5 * 60 * 1000, async () => {
      const r = await query(
        `SELECT DISTINCT COALESCE(
           NULLIF(TRIM(spd.data->'contract'->>'contract_type'), ''),
           NULLIF(TRIM(spd.data->>'B2B Flag'), '')
         ) AS b2b_flag
         FROM sap_processed_data spd
         WHERE COALESCE(
           NULLIF(TRIM(spd.data->'contract'->>'contract_type'), ''),
           NULLIF(TRIM(spd.data->>'B2B Flag'), '')
         ) IS NOT NULL
         ORDER BY b2b_flag`,
      );
      return r.rows.map((x: any) => String(x.b2b_flag));
    });
    return res.json({ success: true, data: { b2bFlags } });
  } catch (error) {
    logger.error('Get contract b2b flag filter options error:', error);
    return res.status(500).json({ success: false, error: { message: 'Failed to fetch b2b flag filter options' } });
  }
};

/**
 * Contract Performance: Late Performance dashboard aggregation.
 * Includes only contracts where computed trade_cycle_days > 0 (Late).
 * Drilldown levels: Incoterm -> Plant/Site -> Product -> Group Name.
 *
 * IMPORTANT: This endpoint aggregates across the full filtered dataset (no pagination),
 * so the frontend dashboard is not limited to "current page" rows.
 */
export const getLatePerformance = async (req: AuthRequest, res: Response) => {
  let queryText = '';
  try {
    // Prevent browser/proxy caching (this endpoint is used for dashboards and must be fresh).
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    const {
      status,
      supplier,
      buyer,
      companyCode,
    } = req.query as any;
    const { dateFrom, dateTo } = parseOptionalStrictDateRange({
      dateFrom: (req.query as { dateFrom?: unknown }).dateFrom,
      dateTo: (req.query as { dateTo?: unknown }).dateTo,
    });

    const scope = String((req.query as any).scope ?? 'ytd').toLowerCase(); // 'ytd' | 'filtered'
    const debug = String((req.query as any).debug ?? '').toLowerCase() === '1' || String((req.query as any).debug ?? '').toLowerCase() === 'true';
    const transportMode = (req.query as any).transportMode as string | undefined;
    const plant = (req.query as any).plant as string | string[] | undefined;
    const globalSearch = typeof (req.query as any).search === 'string' ? (req.query as any).search.trim() : '';
    const selectedIncoterms = (req.query as any).incoterms as string | undefined; // comma-separated
    const b2bFlag = (req.query as any).b2bFlag as string | undefined;
    const productFilter = (req.query as any).product as string | undefined;
    const productsQuery = parseCommaSeparatedQuery((req.query as any).products);
    const productFilters =
      productsQuery.length > 0
        ? productsQuery
        : productFilter?.trim()
          ? [productFilter.trim()]
          : [];
    const sourceTypeFilter = (req.query as any).sourceType as string | undefined;
    const sourceTypesQuery = parseCommaSeparatedQuery((req.query as any).sourceTypes);
    const sourceTypeFilters =
      sourceTypesQuery.length > 0
        ? sourceTypesQuery
        : sourceTypeFilter?.trim()
          ? [sourceTypeFilter.trim()]
          : [];

    const now = new Date();
    const y = now.getFullYear();
    const ytdFrom = `${y}-01-01`;
    const ytdTo = `${y}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const effectiveDateFrom = scope === 'filtered' ? dateFrom : (dateFrom || ytdFrom);
    const effectiveDateTo = scope === 'filtered' ? dateTo : (dateTo || ytdTo);

    // Reuse the same contract_scope narrowing logic as GET /contracts but return all rows needed for aggregation.
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

    const [contractsQtyMoveCte, contractsStoAggCte, contractsLatestSpdCte] = await Promise.all([
      resolveContractsQtyMoveCte('contract_scope'),
      resolveContractsStoAggCte('contract_scope'),
      resolveContractsLatestSpdCte('contract_scope'),
    ]);

    let queryText = `
      WITH contract_scope AS (
        SELECT DISTINCT c.contract_id
        FROM contracts c
        WHERE 1=1
        ${contractScopeWhere}
      ),
      ${contractsLatestSpdCte},
      ${contractsQtyMoveCte},
      ${contractsStoAggCte},
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
          ${sqlB2bEndingPlantCodeAgg()} AS plant_code,
          ${sqlB2bEndingCompanyAgg()} AS company_name,
          -- Align with GET /contracts: incoterm-aware SAP import status (GR PO vs GR STO).
          ${sqlContractListImportStatusAggExpr('c')} AS import_status,
          MAX(c.delivery_end_date) AS delivery_end_date,
          MAX(c.cargo_readiness_date) AS cargo_readiness_date,
          (array_agg(l.data ORDER BY l.created_at DESC NULLS LAST))[1] AS latest_spd_data,
          (array_agg(s.total_sto_quantity ORDER BY s.total_sto_quantity DESC NULLS LAST))[1] AS total_sto_quantity,
          MAX(${sqlIncotermQuantityDeliveryCase(
            'c.incoterm',
            'qm.quantity_delivery_trucking',
            'qm.quantity_delivery_vessel',
            sqlTransportModeFromContractAndJson('c.transport_mode', 'l.data'),
          )}) AS quantity_delivery,
          (array_agg(qm.quantity_receive ORDER BY qm.quantity_receive DESC NULLS LAST))[1] AS quantity_receive,
          (array_agg(qm.quantity_delivery ORDER BY qm.quantity_delivery DESC NULLS LAST))[1] AS quantity_delivery_sap,
          MAX(${sqlContractOutstandingSignedExpr({
            contractQtyExpr: 'c.quantity_ordered',
            incotermExpr: 'c.incoterm',
            receiveExpr: 'qm.quantity_receive',
            deliveryExpr: sqlQtyMoveJoinIncotermDelivery(
              'c.incoterm',
              'qm',
              sqlTransportModeFromContractAndJson('c.transport_mode', 'l.data'),
            ),
          })}) AS outstanding_quantity,
          -- ETA Trucking Completion = last Daily Planning date
          (
            SELECT MAX(
              COALESCE(
                tdd.last_daily_deliverable_date::date,
                (
                  SELECT MAX((NULLIF(TRIM(dd.elem->>'date'), ''))::date)
                  FROM jsonb_array_elements(COALESCE(tdd.daily_deliverables, '[]'::jsonb)) AS dd(elem)
                  WHERE NULLIF(TRIM(dd.elem->>'date'), '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
                )
              )
            )
            FROM trucking_operations tdd
            WHERE tdd.contract_id = (array_agg(c.id ORDER BY c.created_at DESC))[1]
          ) AS last_trucking_daily_deliverable_date,
          ${sqlMaxTruckingLastReceiveDateForContract(
            '(array_agg(c.id ORDER BY c.created_at DESC))[1]',
            '(array_agg(c.contract_id ORDER BY c.created_at DESC))[1]',
          )} AS last_trucking_completion_date,
          ${sqlMaxTruckingWbActualsDateForContract(
            '(array_agg(c.id ORDER BY c.created_at DESC))[1]',
          )} AS last_trucking_wb_actuals_date,
          (
            SELECT MAX(s2.ata_discharge_complete::date)
            FROM shipments s2
            WHERE s2.contract_id = (array_agg(c.id ORDER BY c.created_at DESC))[1]
              AND s2.ata_discharge_complete IS NOT NULL
          ) AS last_ata_vessel_complete_discharge,
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
          ) AS open_standard_eta_vessel_loading,
          -- For Trade Cycle (SEA open legacy): latest ETA vessel complete discharge
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
        ${sqlB2bOriginEndingChildLateralJoin({ originPoExpr: 'c.po_number' })}
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
      ${PO_PLACEHOLDER_EXCLUSION_SQL}
    `;

    const statusNorm = scope === 'filtered' && typeof status === 'string' ? status.trim() : '';
    if (statusNorm && statusNorm !== 'All Status' && statusNorm.toLowerCase() !== 'all') {
      if (statusNorm === 'Open' || statusNorm === 'ACTIVE') {
        queryText += ` AND ${sqlContractImportStatusIsOpenExpr(
          'base.import_status',
          'base.latest_spd_data IS NULL AND UPPER(base.status) IN (\'OPEN\', \'ACTIVE\')',
        )}`;
      } else if (statusNorm === 'Close' || statusNorm === 'CLOSE') {
        queryText += ` AND ${sqlContractImportStatusIsClosedExpr(
          'base.import_status',
          'base.latest_spd_data IS NULL AND UPPER(base.status) IN (\'CLOSE\', \'COMPLETED\', \'CLOSED\')',
        )}`;
      } else {
        queryText += ` AND (base.status = $${paramIndex} OR base.import_status = $${paramIndex})`;
        queryParams.push(statusNorm);
        paramIndex++;
      }
    }

    if (scope === 'filtered' && supplier) {
      queryText += ` AND (base.latest_spd_data->'raw'->>'Supplier' ${sqlIlikeParam(paramIndex)} OR base.latest_spd_data->>'Supplier' ${sqlIlikeParam(paramIndex)} OR $${paramIndex}::text IS NULL)`;
      queryParams.push(likeContainsPattern(String(supplier)));
      paramIndex++;
    }
    if (scope === 'filtered' && buyer) {
      queryText += ` AND (base.latest_spd_data->'raw'->>'Buyer' ${sqlIlikeParam(paramIndex)} OR base.latest_spd_data->>'Buyer' ${sqlIlikeParam(paramIndex)} OR $${paramIndex}::text IS NULL)`;
      queryParams.push(likeContainsPattern(String(buyer)));
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

    const multiProductClauseLegacy = appendContractPerfProductsMultiSql(
      productFilters.length > 1 ? productFilters : undefined,
      'base.product',
      paramIndex,
    );
    if (multiProductClauseLegacy) {
      queryText += multiProductClauseLegacy.clause;
      queryParams.push(...multiProductClauseLegacy.params);
      paramIndex = multiProductClauseLegacy.nextParamIndex;
    } else {
      const singleProduct =
        productFilter?.trim() || (productFilters.length === 1 ? productFilters[0] : undefined);
      const productClause = appendContractPerfProductSubstringSql(singleProduct, 'base.product', paramIndex);
      if (productClause) {
        queryText += productClause.clause;
        queryParams.push(productClause.param);
        paramIndex = productClause.nextParamIndex;
      }
    }

    if (sourceTypeFilters.length > 1) {
      queryText += appendContractPerfSourceTypesFilter(sourceTypeFilters, 'base.source_type');
    } else {
      const singleSource =
        sourceTypeFilter?.trim() || (sourceTypeFilters.length === 1 ? sourceTypeFilters[0] : undefined);
      queryText += appendContractPerfSourceTypeFilter(singleSource, 'base.source_type');
    }

    // Plant filter is same as GET /contracts: exists in SEA discharge port or LAND location.
    const plantArr = scope === 'filtered' ? (Array.isArray(plant) ? plant : (plant ? [plant] : [])) : [];
    const plants = plantArr.map((p) => String(p)).filter((p) => p.trim() !== '');
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
        base.contract_id ${sqlIlikeParam(paramIndex)}
        OR COALESCE(base.product, '') ${sqlIlikeParam(paramIndex)}
        OR COALESCE(base.group_name, '') ${sqlIlikeParam(paramIndex)}
        OR COALESCE(NULLIF(TRIM(pnc.plant_name), ''), NULLIF(TRIM(pna.plant_name), ''), base.plant_code, '') ${sqlIlikeParam(paramIndex)}
      )`;
      queryParams.push(likeContainsPattern(globalSearch));
      paramIndex++;
    }

    const result = await query(queryText, queryParams);

    // Use the same due() helpers as GET /contracts.
    // Important: SAP-derived strings can be DD/MM/YYYY, MM/DD/YY, etc.
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

      // YYYY-MM-DD
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
        const dt = new Date(`${s}T00:00:00`);
        return Number.isNaN(dt.getTime()) ? null : dt;
      }

      // DD/MM/YYYY (or DD-MM-YYYY, DD.MM.YYYY) -> day-first parse
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

      // MM/DD/YY (SAP exports sometimes)
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

      // Month-name strings etc.
      const dt = new Date(s);
      return Number.isNaN(dt.getTime()) ? null : dt;
    };
    const todayMid = new Date();
    todayMid.setHours(0, 0, 0, 0);

    type AggNode = { key: string; count: number; totalDays: number; maxDays: number; totalQtyDelivery: number; children: Map<string, AggNode> };
    const root = new Map<string, AggNode>();
    const add = (m: Map<string, AggNode>, key: string) => {
      const k = key && key.trim() ? key.trim() : 'Blank';
      const ex = m.get(k);
      if (ex) return ex;
      const node: AggNode = { key: k, count: 0, totalDays: 0, maxDays: 0, totalQtyDelivery: 0, children: new Map() };
      m.set(k, node);
      return node;
    };

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

    const onTrackRoot = new Map<string, AggNode>();
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

    type DistBucket = { count: number; qty: number };
    const dist: Record<string, DistBucket> = {
      noData:  { count: 0, qty: 0 },
      onTime:  { count: 0, qty: 0 },
      d1_7:    { count: 0, qty: 0 },
      d8_14:   { count: 0, qty: 0 },
      d15_30:  { count: 0, qty: 0 },
      d31_60:  { count: 0, qty: 0 },
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

    for (const row of result.rows as any[]) {
      debugCounts.totalRows += 1;
      const plantSiteText = String(row.plant_site || '').trim();
      if (plantSiteText) debugCounts.nonBlankPlantSite += 1;
      else debugCounts.blankPlantSite += 1;
      // Match GET /contracts SQL late/on-time filter: SAP import status first, then contracts.status.
      const statusText = String(row.import_status || row.status || '').trim().toUpperCase();
      const transport = String(row.transport_mode || '').trim().toUpperCase();
      const deliveryEnd = due(row.delivery_end_date);
      if (!deliveryEnd) {
        debugCounts.missingDeliveryEnd += 1;
        pushSample('missingDeliveryEnd', String(row.contract_id || ''));
        continue;
      }

      if (!statusText) {
        debugCounts.missingStatus += 1;
        pushSample('missingStatus', String(row.contract_id || ''));
        continue;
      }

      const isClosed = statusText === 'CLOSE' || statusText === 'CLOSED' || statusText === 'COMPLETED';
      const isOpen = statusText === 'OPEN' || statusText === 'ACTIVE';
      if (!isClosed && !isOpen) {
        debugCounts.unknownStatus += 1;
        pushSample('unknownStatus', `${String(row.contract_id || '')}:${statusText}`);
        continue;
      }

      let tradeCycle: number | null = null;
      if (isClosed) {
        if (transport.startsWith('LAND')) debugCounts.branchClosedLand += 1;
        else debugCounts.branchClosedSea += 1;
        if (resolveCycleCompletionDate(row, transport)) {
          if (transport.startsWith('LAND')) debugCounts.haveLastTruckCompletion += 1;
          else debugCounts.haveLastAtaDischarge += 1;
        } else {
          debugCounts.missingCompletionDate += 1;
          pushSample('missingCompletionDate', String(row.contract_id || ''));
        }
        tradeCycle = computeClosedTradeCycleDays(row, transport, row.delivery_end_date);
      } else if (isOpen) {
        if (transport.startsWith('LAND')) {
          debugCounts.branchOpenLand += 1;
          if (resolveCycleCompletionDate(row, transport)) debugCounts.haveLastTruckDeliverable += 1;
          else {
            debugCounts.missingCompletionDate += 1;
            pushSample('missingCompletionDate', String(row.contract_id || ''));
          }
        } else {
          debugCounts.branchOpenSea += 1;
          if (resolveCycleCompletionDate(row, transport)) debugCounts.haveLastEtaDischarge += 1;
          else {
            debugCounts.missingCompletionDate += 1;
            pushSample('missingCompletionDate', String(row.contract_id || ''));
          }
        }
        tradeCycle = computePerfTradeCycleDaysForRow(row, todayMid);
      }

      const _qtyOrdered = Number(row.quantity_ordered || 0);
      const _outstandingQty = isOpen
        ? resolveOpenPerfOutstandingQtyKg(row)
        : _qtyOrdered;

      const cargoReady = row.cargo_readiness_date;
      let logCycle: number | null = null;
      if (cargoReady) {
        if (isClosed) {
          logCycle = computeClosedLogCycleDays(row, transport, cargoReady);
        } else if (isOpen) {
          logCycle = computeOpenLogCycleDays(row, transport, todayMid, cargoReady);
        }
      }

      const payoffDate = resolveSapPayoffCalendarDate(row);
      let cashCycle: number | null = null;
      if (payoffDate) {
        if (isClosed) {
          cashCycle = computeClosedCashCycleDays(row, transport, payoffDate);
        } else if (isOpen) {
          cashCycle = computeOpenCashCycleDays(row, transport, todayMid);
        }
      }

      if (tradeCycle == null) {
        debugCounts.tradeCycleNull += 1;
        pushSample('tradeCycleNull', String(row.contract_id || ''));
        dist.noData.count += 1;
        dist.noData.qty += _outstandingQty;
        continue;
      }
      if (tradeCycle <= 0) {
        debugCounts.tradeCycleNonPositive += 1;
        pushSample('tradeCycleNonPositive', `${String(row.contract_id || '')}:${tradeCycle}`);
        dist.onTime.count += 1;
        dist.onTime.qty += _outstandingQty;

        const daysAhead = -tradeCycle; // 0 = exactly on time, positive = days ahead of deadline
        onTrackCount += 1;
        onTrackTotalDaysAhead += daysAhead;
        onTrackMaxDaysAhead = Math.max(onTrackMaxDaysAhead, daysAhead);
        onTrackTotalQtyDelivery += _outstandingQty;
        if (logCycle != null) { onTrackTotalLogCycle += logCycle; onTrackLogCycleCount++; }
        if (cashCycle != null) { onTrackTotalCashCycle += cashCycle; onTrackCashCycleCount++; }
        if (isOpen) onTrackOpenOutstandingQty += _outstandingQty;
        else onTrackCloseOutstandingQty += _outstandingQty;

        const otInc = String(row.incoterm || '').trim() || 'Blank';
        const otPl  = String(row.plant_site || '').trim() || 'Blank';
        const otProd = String(row.product || '').trim() || 'Blank';
        const otGn  = String(row.group_name || '').trim() || 'Blank';
        const otSup = String(row.supplier || '').trim() || 'Blank';
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
        continue;
      }

      if (tradeCycle <= 7)       { dist.d1_7.count    += 1; dist.d1_7.qty    += _outstandingQty; }
      else if (tradeCycle <= 14) { dist.d8_14.count   += 1; dist.d8_14.qty   += _outstandingQty; }
      else if (tradeCycle <= 30) { dist.d15_30.count  += 1; dist.d15_30.qty  += _outstandingQty; }
      else if (tradeCycle <= 60) { dist.d31_60.count  += 1; dist.d31_60.qty  += _outstandingQty; }
      else                       { dist.d61plus.count += 1; dist.d61plus.qty += _outstandingQty; }

      lateCount += 1;
      lateTotalDays += tradeCycle;
      lateMaxDays = Math.max(lateMaxDays, tradeCycle);
      lateTotalQtyDelivery += _outstandingQty;
      if (logCycle != null) { lateTotalLogCycle += logCycle; lateLogCycleCount++; }
      if (cashCycle != null) { lateTotalCashCycle += cashCycle; lateCashCycleCount++; }
      if (isOpen) lateOpenOutstandingQty += _outstandingQty;
      else lateCloseOutstandingQty += _outstandingQty;
      debugCounts.includedLate += 1;
      pushSample('includedLate', `${String(row.contract_id || '')}:${tradeCycle}`);

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

    const toSorted = (m: Map<string, AggNode>): any[] =>
      [...m.values()]
        .sort((a, b) => b.totalQtyDelivery - a.totalQtyDelivery || b.count - a.count || a.key.localeCompare(b.key))
        .map((n) => ({ key: n.key, count: n.count, totalDays: n.totalDays, maxDays: n.maxDays, totalQtyDelivery: n.totalQtyDelivery, children: toSorted(n.children) }));

    if (process.env.NODE_ENV === 'development') {
      logger.info('Late Performance debug', {
        scope: scope === 'filtered' ? 'filtered' : 'ytd',
        ytd_range: { dateFrom: effectiveDateFrom, dateTo: effectiveDateTo },
        counts: debugCounts,
        samples: debugSamples,
      });
    }

    return res.json({
      success: true,
      data: {
        scope: scope === 'filtered' ? 'filtered' : 'ytd',
        ytd_range: { dateFrom: effectiveDateFrom, dateTo: effectiveDateTo },
        summary: {
          count: lateCount,
          totalDays: lateTotalDays,
          avgDays: lateCount > 0 ? lateTotalDays / lateCount : 0,
          maxDays: lateMaxDays,
          totalQtyDelivery: lateTotalQtyDelivery,
          avgLogCycle: lateLogCycleCount > 0 ? Math.round(lateTotalLogCycle / lateLogCycleCount) : null,
          avgCashCycle: lateCashCycleCount > 0 ? Math.round(lateTotalCashCycle / lateCashCycleCount) : null,
          openOutstandingQty: lateOpenOutstandingQty,
          closeOutstandingQty: lateCloseOutstandingQty,
        },
        onTrackSummary: {
          count: onTrackCount,
          totalDays: onTrackTotalDaysAhead,
          avgDays: onTrackCount > 0 ? onTrackTotalDaysAhead / onTrackCount : 0,
          maxDays: onTrackMaxDaysAhead,
          totalQtyDelivery: onTrackTotalQtyDelivery,
          avgLogCycle: onTrackLogCycleCount > 0 ? Math.round(onTrackTotalLogCycle / onTrackLogCycleCount) : null,
          avgCashCycle: onTrackCashCycleCount > 0 ? Math.round(onTrackTotalCashCycle / onTrackCashCycleCount) : null,
          openOutstandingQty: onTrackOpenOutstandingQty,
          closeOutstandingQty: onTrackCloseOutstandingQty,
        },
        distribution: dist,
        tree: toSorted(root),
        onTrackTree: toSorted(onTrackRoot),
        ...(debug
          ? {
              debug: {
                counts: debugCounts,
                samples: debugSamples,
              },
            }
          : {}),
      },
    });
  } catch (error) {
    if (error instanceof InvalidDateInputError) {
      return res.status(400).json({ success: false, error: { message: error.message } });
    }
    // Helpful SQL context for debugging (kept small to avoid huge logs).
    try {
      const anyErr = error as any;
      const pos = typeof anyErr?.position === 'string' || typeof anyErr?.position === 'number' ? Number(anyErr.position) : null;
      if (pos && typeof queryText === 'string' && queryText) {
        const start = Math.max(0, pos - 200);
        const end = Math.min(queryText.length, pos + 200);
        logger.error('Get late performance SQL near position', {
          pos,
          snippet: queryText.slice(start, end),
        });
      }
    } catch {
      // ignore logging failures
    }
    logger.error('Get late performance error:', error);
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch late performance dashboard' },
    });
  }
};

export const getLatePerformanceSummary = async (req: AuthRequest, res: Response) => {
  try {
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    const data = await runLatePerformance(req, 'summary');
    return res.json({ success: true, data });
  } catch (error) {
    if (error instanceof InvalidDateInputError) {
      return res.status(400).json({ success: false, error: { message: error.message } });
    }
    logger.error('Get late performance summary error:', error);
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch late performance summary' },
    });
  }
};

export const getLatePerformanceTree = async (req: AuthRequest, res: Response) => {
  try {
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    const data = await runLatePerformance(req, 'tree');
    return res.json({ success: true, data });
  } catch (error) {
    if (error instanceof InvalidDateInputError) {
      return res.status(400).json({ success: false, error: { message: error.message } });
    }
    logger.error('Get late performance tree error:', error);
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch late performance tree' },
    });
  }
};

/** Combined endpoint: returns both summary and tree in a single SQL execution.
 *  Frontend uses this to halve the number of database round-trips on page load and
 *  on every filter change. */
export const getLatePerformanceData = async (req: AuthRequest, res: Response) => {
  try {
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    const data = await runLatePerformance(req, 'all');
    return res.json({ success: true, data });
  } catch (error) {
    if (error instanceof InvalidDateInputError) {
      return res.status(400).json({ success: false, error: { message: error.message } });
    }
    logger.error('Get late performance data error:', error);
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch late performance data' },
    });
  }
};

/** Get counts of SEA/LAND/MIX contracts missing required logistics (for dashboard cards) */
export const getUnassignedCounts = async (req: AuthRequest, res: Response) => {
  try {
    const { search, b2bFlag, product, transportMode, plant, columnFilters } =
      req.query as Record<string, string | string[]>;
    const { dateFrom, dateTo } = parseOptionalStrictDateRange({
      dateFrom: (req.query as { dateFrom?: unknown }).dateFrom,
      dateTo: (req.query as { dateTo?: unknown }).dateTo,
    });

    const params: any[] = [];
    let paramIndex = 1;

    // Row-level conditions (applied before GROUP BY — work on individual contract rows)
    const rowConditions: string[] = [];

    // Post-aggregate conditions (mirror getContracts filter logic on `base` alias)
    const aggConditions: string[] = [];

    if (dateFrom) {
      params.push(dateFrom);
      rowConditions.push(`c.contract_date >= $${paramIndex++}`);
    }

    if (dateTo) {
      params.push(dateTo);
      rowConditions.push(`c.contract_date <= $${paramIndex++}`);
    }

    // Section 1 alert cards always count Open contracts only (toolbar status does not apply).
    aggConditions.push(`(
      UPPER(TRIM(COALESCE(base.import_status, ''))) IN ('OPEN', 'ACTIVE')
      OR (base.latest_spd_data IS NULL AND UPPER(base.raw_status) IN ('OPEN', 'ACTIVE'))
    )`);

    // B2B flag — use JSONB contract_type (same as getContracts)
    if (b2bFlag && b2bFlag !== 'ALL') {
      params.push(b2bFlag);
      aggConditions.push(
        `COALESCE(base.latest_spd_data->'contract'->>'contract_type', base.latest_spd_data->>'B2B Flag', '') = $${paramIndex++}`,
      );
    }

    // Legacy single-product query param (Contract Performance toolbar)
    if (product && product !== 'ALL' && String(product).trim().length > 0) {
      params.push(likeContainsPattern(String(product).trim()));
      aggConditions.push(`COALESCE(base.product, '') ${sqlIlikeParam(paramIndex++)}`);
    }

    // Transport mode — mirror getContracts list filter (contracts.transport_mode column).
    if (transportMode && String(transportMode).toUpperCase() !== 'ALL') {
      params.push(String(transportMode).toUpperCase());
      aggConditions.push(`UPPER(base.transport_mode) = $${paramIndex++}`);
    }

    const plantArr = Array.isArray(plant) ? plant : plant ? [plant] : [];
    const plants = plantArr.map((p) => String(p)).filter((p) => p.trim() !== '');
    const useB2bEndingOverlay = plants.length > 0;
    const groupPlantFilter = appendGroupPlantFilter(
      plants,
      paramIndex,
      groupPlantExpr('base.plant_code', 'base.company_name'),
    );
    if (groupPlantFilter.sql) {
      aggConditions.push(groupPlantFilter.sql.replace(/^\s*AND\s*/, ''));
      params.push(...groupPlantFilter.params);
      paramIndex = groupPlantFilter.nextIndex;
    }

    const globalSearch = typeof search === 'string' ? search.trim() : '';
    const searchFrag = appendGlobalSearchBase(globalSearch, paramIndex);
    if (searchFrag.sql) {
      aggConditions.push(searchFrag.sql.replace(/^\s*AND\s*/, ''));
      params.push(...searchFrag.params);
      paramIndex = searchFrag.nextIndex;
    }

    const colFilters = parseColumnFiltersQuery(columnFilters);
    const colFrag = appendColumnFiltersBase(colFilters, paramIndex);
    if (colFrag.sql) {
      aggConditions.push(colFrag.sql.replace(/^\s*AND\s*/, ''));
      params.push(...colFrag.params);
      paramIndex = colFrag.nextIndex;
    }

    const rowWhereSql = rowConditions.length > 0 ? `WHERE ${rowConditions.join(' AND ')}` : '';
    const aggWhereSql = aggConditions.length > 0 ? `AND ${aggConditions.join(' AND ')}` : '';

    const q = `
      WITH latest_spd AS (
        SELECT DISTINCT ON (contract_number) contract_number, data, created_at
        FROM sap_processed_data
        ORDER BY contract_number, created_at DESC NULLS LAST
      ),
      base AS (
        SELECT
          c.contract_id,
          (array_agg(c.id ORDER BY c.created_at DESC))[1] AS id,
          MAX(c.status) AS raw_status,
          MAX(c.status) AS status,
          ${sqlContractListImportStatusAggExpr('c')} AS import_status,
          MAX(c.product) AS product,
          MAX(c.incoterm) AS incoterm,
          MAX(c.supplier) AS supplier,
          ${useB2bEndingOverlay ? sqlB2bEndingBuyerAgg() : 'MAX(c.buyer)'} AS buyer,
          MAX(c.group_name) AS group_name,
          ${useB2bEndingOverlay ? sqlB2bEndingPlantCodeAgg() : 'MAX(c.plant_code)'} AS plant_code,
          ${useB2bEndingOverlay ? sqlB2bEndingCompanyAgg() : 'MAX(c.company_name)'} AS company_name,
          MAX(c.transport_mode) AS transport_mode,
          MAX(c.contract_date) AS contract_date,
          STRING_AGG(DISTINCT c.po_number, ', ' ORDER BY c.po_number) FILTER (WHERE c.po_number IS NOT NULL AND c.po_number != '') AS po_numbers,
          MAX(c.sto_number) AS sto_number,
          NULL::text AS sto_numbers_agg,
          (array_agg(l.data ORDER BY l.created_at DESC NULLS LAST))[1] AS latest_spd_data,
          COALESCE(NULLIF(TRIM(MAX(c.transport_mode)), ''), (array_agg(l.data ORDER BY l.created_at DESC NULLS LAST))[1]->'contract'->>'transport_mode', (array_agg(l.data ORDER BY l.created_at DESC NULLS LAST))[1]->'contract'->>'sea_land', (array_agg(l.data ORDER BY l.created_at DESC NULLS LAST))[1]->'raw'->>'Sea / Land', (array_agg(l.data ORDER BY l.created_at DESC NULLS LAST))[1]->'raw'->>'Sea_Land', '') AS effective_transport_mode
        FROM contracts c
        LEFT JOIN latest_spd l ON l.contract_number = c.contract_id
        ${useB2bEndingOverlay ? sqlB2bOriginEndingChildLateralJoin({ originPoExpr: 'c.po_number' }) : ''}
        ${rowWhereSql}
        GROUP BY c.contract_id
      ),
      filtered AS (
        SELECT * FROM base
        WHERE 1=1 ${aggWhereSql}
        AND NOT (
          UPPER(TRIM(COALESCE(
            base.latest_spd_data->'contract'->>'contract_type',
            base.latest_spd_data->>'B2B Flag',
            ''
          ))) = 'B2B'
          AND NULLIF(TRIM(COALESCE(
            base.latest_spd_data->'contract'->>'contract_reference_po',
            base.latest_spd_data->>'CONTRACT REFF PO',
            base.latest_spd_data->>'Contract Reff PO Ini',
            base.latest_spd_data->'raw'->>'Contract Reff PO Ini',
            base.latest_spd_data->'raw'->>'CONTRACT REFF PO'
          )), '') IS NOT NULL
        )
      ),
      sea_no_ship AS (
        SELECT 1
        FROM filtered f
        WHERE UPPER(TRIM(f.effective_transport_mode)) LIKE 'SEA%'
          AND NOT EXISTS (SELECT 1 FROM shipments s WHERE s.contract_id = f.id)
      ),
      land_no_truck AS (
        SELECT 1
        FROM filtered f
        WHERE UPPER(TRIM(f.effective_transport_mode)) LIKE 'LAND%'
          AND NOT EXISTS (SELECT 1 FROM trucking_operations t WHERE t.contract_id = f.id)
      ),
      mix_incomplete AS (
        SELECT 1
        FROM filtered f
        WHERE UPPER(TRIM(f.effective_transport_mode)) LIKE 'MIX%'
          AND (
            NOT EXISTS (SELECT 1 FROM shipments s WHERE s.contract_id = f.id)
            OR NOT EXISTS (SELECT 1 FROM trucking_operations t WHERE t.contract_id = f.id)
          )
      )
      SELECT
        (SELECT COUNT(*) FROM sea_no_ship) AS sea_without_shipments,
        (SELECT COUNT(*) FROM land_no_truck) AS land_without_trucking,
        (SELECT COUNT(*) FROM mix_incomplete) AS mix_without_logistics
    `;
    const result = await query(q, params);
    const row = result.rows[0] || { sea_without_shipments: 0, land_without_trucking: 0, mix_without_logistics: 0 };
    return res.json({
      success: true,
      data: {
        seaWithoutShipments: parseInt(String(row.sea_without_shipments), 10) || 0,
        landWithoutTrucking: parseInt(String(row.land_without_trucking), 10) || 0,
        mixWithoutLogistics: parseInt(String(row.mix_without_logistics), 10) || 0,
      },
    });
  } catch (error) {
    if (error instanceof InvalidDateInputError) {
      return res.status(400).json({ success: false, error: { message: error.message } });
    }
    logger.error('Get unassigned counts error:', error);
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch unassigned counts' },
    });
  }
};

/** Distinct buyer names from `contracts` (for trucking unloading location, etc.). */
export const getDistinctBuyers = async (req: AuthRequest, res: Response) => {
  try {
    const search = req.query.search != null ? String(req.query.search).trim() : '';
    const limitRaw = parseInt(String(req.query.limit ?? '30'), 10);
    const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? limitRaw : 30, 1), 100);

    const params: unknown[] = [];
    let where = `WHERE buyer IS NOT NULL AND TRIM(buyer) <> ''`;
    if (search) {
      params.push(likeContainsPattern(search));
      where += ` AND TRIM(buyer) ${sqlIlikeParam(params.length)}`;
    }
    params.push(limit);

    const result = await query(
      `
      SELECT DISTINCT TRIM(buyer) AS buyer
      FROM contracts
      ${where}
      ORDER BY buyer ASC
      LIMIT $${params.length}
      `,
      params
    );

    const items = (result.rows as { buyer: string }[]).map((r) => r.buyer).filter(Boolean);
    return res.json({
      success: true,
      data: { items },
    });
  } catch (error) {
    logger.error('Get distinct buyers error:', error);
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch buyers' },
    });
  }
};

const CONTRACT_ID_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Accepts a contract UUID, a contract number, or a PO number.
 *
 * `contracts.id` is a uuid column, so passing a PO number straight into `WHERE id = $1` made
 * Postgres raise "invalid input syntax for type uuid"; the catch below turned that into a 500.
 * Business users hold PO numbers rather than UUIDs, so the identifier they actually have was the
 * one path that failed - and it failed as a server fault rather than a 404.
 *
 * The uuid path is byte-for-byte what it was. Only non-uuid input takes the new branch, which
 * previously could not succeed at all.
 *
 * A PO number can legitimately span several contracts (multi-STO). Rather than guess silently,
 * this returns one deterministically - exact contract number first, then newest, with `id` as a
 * final unique key so the choice cannot shift between query plans - and reports `match_count` so
 * a caller can tell a unique hit from a collapsed set. Those two fields are additive; existing
 * consumers of `contract` / `shipments` / `payments` are unaffected.
 */
export const getContract = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const rawId = String(id ?? '').trim();
    const isUuid = CONTRACT_ID_UUID_RE.test(rawId);

    const result = isUuid
      ? await query('SELECT * FROM contracts WHERE id = $1', [id])
      : await query(
          `SELECT * FROM contracts
             WHERE TRIM(COALESCE(contract_id::text, '')) = $1
                OR TRIM(COALESCE(po_number::text, '')) = $1
             ORDER BY
               CASE WHEN TRIM(COALESCE(contract_id::text, '')) = $1 THEN 0 ELSE 1 END,
               created_at DESC NULLS LAST,
               id ASC
             LIMIT 1`,
          [rawId]
        );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: { message: 'Contract not found' },
      });
    }

    let matchCount = result.rows.length;
    if (!isUuid) {
      const countResult = await query(
        `SELECT COUNT(*)::int AS n FROM contracts
          WHERE TRIM(COALESCE(contract_id::text, '')) = $1
             OR TRIM(COALESCE(po_number::text, '')) = $1`,
        [rawId]
      );
      matchCount = Number(countResult.rows[0]?.n ?? 1);
    }

    // Related records key off the contract's uuid, which is not necessarily what the caller sent.
    const contractUuid = result.rows[0].id;

    // Get related shipments
    const shipmentsResult = await query(
      'SELECT * FROM shipments WHERE contract_id = $1 ORDER BY created_at DESC',
      [contractUuid]
    );

    // Get related payments
    const paymentsResult = await query(
      'SELECT * FROM payments WHERE contract_id = $1 ORDER BY created_at DESC',
      [contractUuid]
    );

    return res.json({
      success: true,
      data: {
        contract: result.rows[0],
        shipments: shipmentsResult.rows,
        payments: paymentsResult.rows,
        matched_by: isUuid ? 'uuid' : 'contract_or_po_number',
        match_count: matchCount,
      },
    });
  } catch (error) {
    logger.error('Get contract error:', error);
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch contract' },
    });
  }
};

/** Get STO information for a contract (shipment and trucking STOs) for detail view */
export const getContractStoInformation = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const contractResult = await query(
      `SELECT id, contract_id, delivery_end_date, transport_mode, incoterm,
              ${sqlContractImportStatusExpr('c')} AS import_status
       FROM contracts c WHERE c.id = $1`,
      [id],
    );
    if (contractResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: { message: 'Contract not found' } });
    }
    const contract = contractResult.rows[0];
    const contractImportStatus = contract.import_status ?? null;
    const deliveryEnd = contract.delivery_end_date ?? null;
    const transportMode = String(contract.transport_mode ?? '').trim().toUpperCase();
    const contractIncoterm = String(contract.incoterm ?? '').trim();
    const includeShipments =
      transportMode === '' || transportMode === 'SEA' || transportMode === 'MIX';
    const includeTrucking =
      transportMode === '' || transportMode === 'LAND' || transportMode === 'MIX'
      || isTruckingPageIncoterm(contractIncoterm);

    // Shipment STOs: enumerate contract_stos ∪ SAP (like trucking), then attach matching shipment rows.
    // Do not group only by contracts.sto_number — that collapses multi-STO POs into one row.
    const shipmentStosQuery = `
      WITH real_sto_keys AS (
        ${CONTRACT_REAL_STO_KEYS_SQL}
      ),
      op_fallback_keys AS (
        SELECT DISTINCT TRIM(s.operation_id::text) AS sto_key
        FROM shipments s
        WHERE s.contract_id = $1
          AND NULLIF(TRIM(s.operation_id::text), '') IS NOT NULL
          AND COALESCE(s.status, '') <> 'CANCELLED'
          AND NOT EXISTS (SELECT 1 FROM real_sto_keys)
      ),
      sto_keys AS (
        SELECT sto_key FROM real_sto_keys
        UNION
        SELECT sto_key FROM op_fallback_keys
      )
      SELECT
        sk.sto_key,
        sk.sto_key AS sto_number,
        sp.operation_id,
        sp.status,
        COALESCE(NULLIF(${sqlSapStoQtyForContractPoExpr({
          contractAlias: 'c_po',
          stoKeyExpr: 'sk.sto_key',
        })}, 0), 0) AS sto_quantity,
        COALESCE(
          NULLIF(${sqlSapQtyDeliveredForStoKeyExpr({
            contractAlias: 'c_po',
            stoKeyExpr: 'sk.sto_key',
            contractQtyExpr: 'c_po.quantity_ordered',
          })}, 0),
          sp.quantity_delivered_db,
          0
        ) AS quantity_delivered,
        COALESCE(
          NULLIF(${sqlSapQtyReceiveForStoKeyExpr({
            contractAlias: 'c_po',
            stoKeyExpr: 'sk.sto_key',
          })}, 0),
          0
        ) AS quantity_receive,
        sp.vessel_name,
        sp.eta_loading_port AS eta_vessel_arrival_loading_port,
        sp.ata_discharge_complete,
        sp.eta_discharge_complete,
        (${sqlContractImportStatusForStoExpr('c_po', 'sk.sto_key')}) AS sto_import_status
      FROM sto_keys sk
      CROSS JOIN contracts c_po
      LEFT JOIN LATERAL (
        SELECT
          s.operation_id,
          s.status,
          COALESCE(s.quantity_delivered, 0) AS quantity_delivered_db,
          s.vessel_name,
          s.ata_discharge_complete,
          s.eta_discharge_complete,
          (
            SELECT vlp.eta_vessel_arrival::date
            FROM vessel_loading_ports vlp
            WHERE vlp.shipment_id = s.id AND vlp.is_discharge_port = false
            ORDER BY vlp.port_sequence ASC
            LIMIT 1
          ) AS eta_loading_port
        FROM shipments s
        WHERE s.contract_id = $1
          AND COALESCE(s.status, '') <> 'CANCELLED'
          AND (
            TRIM(COALESCE(s.shipment_id::text, '')) = sk.sto_key
            OR TRIM(COALESCE(s.operation_id::text, '')) = sk.sto_key
            OR (
              sk.sto_key ~ '^(OP-|MNL-|MSEA-)'
              AND TRIM(COALESCE(s.operation_id::text, '')) = sk.sto_key
            )
          )
        ORDER BY
          CASE WHEN TRIM(COALESCE(s.shipment_id::text, '')) = sk.sto_key THEN 0 ELSE 1 END,
          s.updated_at DESC NULLS LAST,
          s.created_at DESC NULLS LAST
        LIMIT 1
      ) sp ON TRUE
      WHERE c_po.id = $1
      ORDER BY sk.sto_key
    `;
    const shipmentRows = includeShipments
      ? await query(shipmentStosQuery, [id])
      : { rows: [] };

    // Trucking STOs: SAP/contract STOs first; if none, fall back to Operation ID rows.
    // STO Qty always from SAP STO Quantity (by STO or by PO) — never Contract/PO Qty.
    const truckingStosQuery = `
      WITH real_sto_keys AS (
        ${CONTRACT_REAL_STO_KEYS_SQL}
      ),
      op_fallback_keys AS (
        SELECT DISTINCT TRIM(t.operation_id::text) AS sto_key
        FROM trucking_operations t
        WHERE t.contract_id = $1
          AND NULLIF(TRIM(t.operation_id::text), '') IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM real_sto_keys)
      ),
      sto_keys AS (
        SELECT sto_key FROM real_sto_keys
        UNION
        SELECT sto_key FROM op_fallback_keys
      )
      SELECT
        sk.sto_key AS sto_number,
        sk.sto_key AS sto_key,
        tp.operation_id,
        tp.status,
        COALESCE(
          NULLIF((
            SELECT NULLIF(cs.sto_quantity, 0)::numeric
            FROM contract_stos cs
            WHERE cs.contract_id = c.id
              AND TRIM(cs.sto_number::text) = sk.sto_key
            LIMIT 1
          ), 0),
          NULLIF(${sqlSapStoQtyForContractPoExpr({
            contractAlias: 'c',
            stoKeyExpr: 'sk.sto_key',
          })}, 0),
          0
        ) AS sto_quantity,
        COALESCE(tp.quantity_delivered, 0) AS quantity_receive_db,
        COALESCE(tp.quantity_delivered, 0) AS quantity_delivered_db,
        ${sqlSapQtyReceiveForStoKeyExpr({
          contractAlias: 'c',
          stoKeyExpr: 'sk.sto_key',
        })} AS quantity_receive_sap,
        ${sqlSapQtyDeliveredForStoKeyExpr({
          contractAlias: 'c',
          stoKeyExpr: 'sk.sto_key',
          contractQtyExpr: 'c.quantity_ordered',
        })} AS quantity_delivered_sap,
        COALESCE((
          SELECT SUM(NULLIF(regexp_replace(COALESCE(
            NULLIF(TRIM(spd.data->'contract'->>'sto_quantity'), ''),
            ''
          ), '[^0-9\\.-]', '', 'g'), '')::numeric)
          FROM sap_processed_data spd
          WHERE spd.contract_number = c.contract_id
            AND TRIM(COALESCE(
              spd.sto_number::text,
              spd.data->'raw'->>'STO No.',
              spd.data->'raw'->>'STO Number',
              spd.data->'shipment'->>'sto_no'
            )) = sk.sto_key
            AND spd.data->'contract'->>'sto_quantity' IS NOT NULL
        ), 0) AS sto_qty_assigned,
        tp.trucking_owner,
        -- ETA Trucking Completion = last date on Daily Planning Deliverables (upload)
        COALESCE(
          tp.last_daily_deliverable_date,
          (
            SELECT MAX((NULLIF(TRIM(dd.elem->>'date'), ''))::date)
            FROM jsonb_array_elements(COALESCE(tp.daily_deliverables, '[]'::jsonb)) AS dd(elem)
            WHERE NULLIF(TRIM(dd.elem->>'date'), '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
          )
        ) AS eta_trucking_completion_date,
        -- Trucking Last Receive: realization_end → SAP AW → WB Actuals
        ${sqlStoTruckingLastReceiveDate('c.contract_id', 'sk.sto_key', 'tp.id')} AS trucking_completion_date,
        COALESCE(
          (SELECT tr.realization_start_date FROM trucking_realizations tr WHERE tr.trucking_operation_id = tp.id LIMIT 1),
          ${sqlSapTruckingStartReceiveDateForStoKey('c.contract_id', 'sk.sto_key')}
        ) AS trucking_start_date
      FROM sto_keys sk
      CROSS JOIN contracts c
      LEFT JOIN LATERAL (
        SELECT t.*
        FROM trucking_operations t
        WHERE t.contract_id = $1
          AND (
            (sk.sto_key ~ '^(OP-|MNL-|MSEA-)' AND TRIM(t.operation_id::text) = sk.sto_key)
            OR (sk.sto_key !~ '^(OP-|MNL-|MSEA-)')
          )
        ORDER BY
          CASE WHEN TRIM(COALESCE(t.operation_id::text, '')) = sk.sto_key THEN 0 ELSE 1 END,
          t.created_at DESC NULLS LAST
        LIMIT 1
      ) tp ON TRUE
      WHERE c.id = $1
      ORDER BY sk.sto_key
    `;
    const truckingRows = includeTrucking
      ? await query(truckingStosQuery, [id])
      : { rows: [] };

    const shipmentStos = shipmentRows.rows.map((r: any) => {
      const lateIndicator = computeLateIndicatorText(
        deliveryEnd,
        r.ata_discharge_complete,
        r.eta_vessel_arrival_loading_port,
      );
      return {
        type: 'shipment' as const,
        sto_number: resolveContractLogisticsStoNumber(r.sto_number),
        operation_id: resolveContractLogisticsOperationId(r.operation_id, r.sto_key),
        late_indicator: lateIndicator,
        status: resolveContractLogisticsStoStatus({
          contractImportStatus: r.sto_import_status ?? contractImportStatus,
          dbStatus: r.status,
          logisticsType: 'shipment',
          shipmentMilestones: {
            eta_arrival_at_loading_port: r.eta_vessel_arrival_loading_port,
            eta_complete_discharge: r.eta_discharge_complete,
            ata_complete_discharge: r.ata_discharge_complete,
          },
        }),
        sto_quantity: toSapDisplayNumber(r.sto_quantity),
        quantity_delivered: toSapDisplayNumber(r.quantity_delivered),
        quantity_receive: toSapDisplayNumber(r.quantity_receive),
        vessel_name: r.vessel_name || null,
        eta_vessel_arrival_loading_port: r.eta_vessel_arrival_loading_port || null,
        ata_discharge_complete: r.ata_discharge_complete || null,
      };
    });

    const truckingStos = truckingRows.rows.map((r: any) => {
      const lateIndicator = computeLateIndicatorText(
        deliveryEnd,
        r.trucking_completion_date,
        r.eta_trucking_completion_date,
      );
      return {
        type: 'trucking' as const,
        sto_number: resolveContractLogisticsStoNumber(r.sto_number),
        operation_id: resolveContractLogisticsOperationId(r.operation_id),
        late_indicator: lateIndicator,
        status: resolveContractLogisticsStoStatus({
          contractImportStatus,
          dbStatus: r.status,
          logisticsType: 'trucking',
          truckingOptions: {
            realizationEndDate: r.trucking_completion_date,
            realizationStartDate: r.trucking_start_date,
            stoNumber: r.sto_number,
          },
        }),
        sto_quantity: toSapDisplayNumber(r.sto_quantity),
        // Prefer SAP; treat 0 as missing so Operation ID rows can fall back to trucking DB qty.
        quantity_receive: toSapDisplayNumber(
          Number(r.quantity_receive_sap) > 0 ? r.quantity_receive_sap : r.quantity_receive_db,
        ),
        quantity_delivered: toSapDisplayNumber(
          Number(r.quantity_delivered_sap) > 0 ? r.quantity_delivered_sap : r.quantity_delivered_db,
        ),
        trucking_owner: r.trucking_owner || null,
        eta_trucking_completion_date: r.eta_trucking_completion_date || null,
        trucking_completion_date: r.trucking_completion_date || null,
      };
    });

    const coveredKeys = [
      ...new Set([
        ...shipmentRows.rows.flatMap((r: any) =>
          expandLogisticsLookupKeys(r.sto_key, r.sto_number, r.operation_id),
        ),
        ...truckingRows.rows.flatMap((r: any) =>
          expandLogisticsLookupKeys(r.sto_key, r.sto_number, r.operation_id),
        ),
      ]),
    ];
    const sapOnlyRows = await query(CONTRACT_SAP_ONLY_STOS_SQL, [id, coveredKeys]);

    const sapOnlyStos = sapOnlyRows.rows
      .filter((r: any) => {
        const logisticsType = String(r.logistics_type ?? 'shipment');
        if (logisticsType === 'shipment') return includeShipments;
        return includeTrucking;
      })
      .map((r: any) => {
        const isShipment = String(r.logistics_type ?? 'shipment') === 'shipment';
        const lateIndicator = computeLateIndicatorText(
          deliveryEnd,
          isShipment ? r.ata_discharge_complete : r.trucking_completion_date,
          isShipment ? r.eta_vessel_arrival_loading_port : r.eta_trucking_completion_date,
        );
        if (isShipment) {
          return {
            type: 'shipment' as const,
            sto_number: resolveContractLogisticsStoNumber(r.sto_number),
            operation_id: resolveContractLogisticsOperationId(r.operation_id),
            late_indicator: lateIndicator,
            status: resolveContractLogisticsStoStatus({
              contractImportStatus,
              dbStatus: r.status,
              logisticsType: 'shipment',
              shipmentMilestones: {
                eta_arrival_at_loading_port: r.eta_vessel_arrival_loading_port,
                eta_complete_discharge: r.eta_discharge_complete,
                ata_complete_discharge: r.ata_discharge_complete,
              },
            }),
            sto_quantity: toSapDisplayNumber(r.sto_quantity),
            quantity_delivered: toSapDisplayNumber(r.quantity_delivered),
            quantity_receive: toSapDisplayNumber(r.quantity_receive),
            vessel_name: r.vessel_name || null,
            eta_vessel_arrival_loading_port: r.eta_vessel_arrival_loading_port || null,
            ata_discharge_complete: r.ata_discharge_complete || null,
          };
        }
        return {
          type: 'trucking' as const,
          sto_number: resolveContractLogisticsStoNumber(r.sto_number),
          operation_id: resolveContractLogisticsOperationId(r.operation_id),
          late_indicator: lateIndicator,
          status: resolveContractLogisticsStoStatus({
            contractImportStatus,
            dbStatus: r.status,
            logisticsType: 'trucking',
            truckingOptions: {
              realizationEndDate: r.trucking_completion_date,
              stoNumber: r.sto_number,
            },
          }),
          sto_quantity: toSapDisplayNumber(r.sto_quantity),
          quantity_receive: toSapDisplayNumber(r.quantity_receive),
          quantity_delivered: toSapDisplayNumber(r.quantity_delivered),
          trucking_owner: r.trucking_owner || null,
          eta_trucking_completion_date: r.eta_trucking_completion_date || null,
          trucking_completion_date: r.trucking_completion_date || null,
        };
      });

    const stos = [...shipmentStos, ...truckingStos, ...sapOnlyStos];
    const summary = summarizeContractLogisticsStoQty(stos);
    return res.json({ success: true, data: { stos, summary } });
  } catch (error) {
    logger.error('Get contract STO information error:', error);
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch STO information' },
    });
  }
};

/** Shipment/trucking detail for Contract Detail modal (no shipments-page SAP STO Type filters). */
export const getContractLogisticsStoDetail = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const type = String(req.query.type ?? '').trim().toLowerCase();
    const sto = String(req.query.sto ?? '').trim();
    const operationId = String(req.query.operation_id ?? '').trim();
    const uniqueKeys = expandLogisticsLookupKeys(sto, operationId);

    if (!['shipment', 'trucking'].includes(type) || uniqueKeys.length === 0) {
      return res.status(400).json({
        success: false,
        error: { message: 'type (shipment|trucking) and sto or operation_id are required' },
      });
    }

    const contractResult = await query(
      `SELECT id, contract_id, delivery_start_date, delivery_end_date, product,
              ${sqlContractImportStatusExpr('c')} AS import_status
       FROM contracts c WHERE c.id = $1`,
      [id],
    );
    if (contractResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: { message: 'Contract not found' } });
    }

    const contractImportStatus = contractResult.rows[0].import_status ?? null;
    const stoKeyForImport = sto || operationId;
    let shipmentStoImportStatus = contractImportStatus;
    if (type === 'shipment' && stoKeyForImport) {
      const stoImport = await query(
        `SELECT ${sqlContractImportStatusForStoExpr('c', 'q.sto_key')} AS import_status
         FROM contracts c
         CROSS JOIN (SELECT $2::text AS sto_key) q
         WHERE c.id = $1::uuid
         LIMIT 1`,
        [id, stoKeyForImport],
      );
      shipmentStoImportStatus = stoImport.rows[0]?.import_status ?? contractImportStatus;
    }

    if (type === 'shipment') {
      const shipmentResult = await query(
        `SELECT
          s.id,
          COALESCE(NULLIF(TRIM(c.sto_number::text), ''), NULLIF(TRIM(s.operation_id::text), ''), s.shipment_id) AS sto_number,
          s.operation_id,
          s.status,
          s.vessel_name,
          c.contract_id AS contract_numbers,
          s.port_of_loading,
          s.port_of_discharge,
          s.quantity_shipped AS sto_quantity,
          s.quantity_delivered,
          (
            SELECT SUM(NULLIF(regexp_replace(COALESCE(
              NULLIF(TRIM(spd.data->'raw'->>'Quantity Receive'), ''),
              NULLIF(TRIM(spd.data->'raw'->>'Qty Receive'), ''),
              ''
            ), '[^0-9\\.-]', '', 'g'), '')::numeric)
            FROM sap_processed_data spd
            WHERE spd.contract_number = c.contract_id
              AND (
                NULLIF(TRIM(COALESCE(spd.sto_number::text, spd.data->'raw'->>'STO No.', spd.data->'raw'->>'STO Number')), '')
                  = ANY($2::text[])
                OR NULLIF(TRIM(COALESCE(spd.data->'raw'->>'Operation ID', '')), '') = ANY($2::text[])
              )
          ) AS quantity_receive,
          c.delivery_start_date,
          c.delivery_end_date,
          c.product,
          COALESCE(s.eta_loading_complete, (
            SELECT vlp.eta_loading_completed::date
            FROM vessel_loading_ports vlp
            WHERE vlp.shipment_id = s.id AND vlp.is_discharge_port = false
            ORDER BY vlp.port_sequence ASC
            LIMIT 1
          )) AS eta_vessel_completed_loading,
          COALESCE(s.ata_loading_complete, (
            SELECT vlp.ata_loading_completed::date
            FROM vessel_loading_ports vlp
            WHERE vlp.shipment_id = s.id AND vlp.is_discharge_port = false
            ORDER BY vlp.port_sequence ASC
            LIMIT 1
          )) AS ata_vessel_completed_loading,
          COALESCE(s.ata_discharge_complete, (
            SELECT vlp.ata_loading_completed::date
            FROM vessel_loading_ports vlp
            WHERE vlp.shipment_id = s.id AND vlp.is_discharge_port = true
            ORDER BY vlp.port_sequence ASC
            LIMIT 1
          )) AS ata_vessel_complete_discharge,
          COALESCE(
            s.eta_discharge_complete,
            (
              SELECT vlp.eta_vessel_complete_discharge::date
              FROM vessel_loading_ports vlp
              WHERE vlp.shipment_id = s.id AND vlp.is_discharge_port = true
              ORDER BY vlp.port_sequence ASC
              LIMIT 1
            )
          ) AS eta_vessel_complete_discharge
        FROM shipments s
        INNER JOIN contracts c ON s.contract_id = c.id
        WHERE c.id = $1
          AND (
            TRIM(COALESCE(c.sto_number::text, '')) = ANY($2::text[])
            OR TRIM(COALESCE(s.operation_id::text, '')) = ANY($2::text[])
            OR TRIM(COALESCE(s.shipment_id::text, '')) = ANY($2::text[])
            OR EXISTS (
              SELECT 1
              FROM sap_processed_data spd
              WHERE spd.contract_number = c.contract_id
                AND ${SPD_EFFECTIVE_STO_SQL} = ANY($2::text[])
            )
          )
        ORDER BY s.created_at DESC NULLS LAST
        LIMIT 1`,
        [id, uniqueKeys],
      );

      if (shipmentResult.rows.length === 0) {
        const sapShipmentResult = await query(SHIPMENT_SAP_STO_DETAIL_SQL, [id, uniqueKeys]);
        if (sapShipmentResult.rows.length > 0) {
          const row = sapShipmentResult.rows[0] as Record<string, unknown>;
          row.status = resolveContractLogisticsStoStatus({
            contractImportStatus: shipmentStoImportStatus,
            dbStatus: row.status,
            logisticsType: 'shipment',
            shipmentMilestones: {
              eta_completed_loading: row.eta_vessel_completed_loading,
              ata_completed_loading: row.ata_vessel_completed_loading,
              ata_complete_discharge: row.ata_vessel_complete_discharge,
              eta_complete_discharge: row.eta_vessel_complete_discharge,
            },
          });
          return res.json({ success: true, data: row, source: 'sap' });
        }
        const sapTruckingCrossResult = await query(TRUCKING_SAP_STO_DETAIL_SQL, [id, uniqueKeys]);
        if (sapTruckingCrossResult.rows.length > 0) {
          const row = sapTruckingCrossResult.rows[0] as Record<string, unknown>;
          row.status = resolveContractLogisticsStoStatus({
            contractImportStatus,
            dbStatus: row.status,
            logisticsType: 'trucking',
            truckingOptions: {
              realizationEndDate: row.trucking_completion_date,
              realizationStartDate: row.trucking_start_date,
              stoNumber: row.sto_number,
            },
          });
          return res.json({ success: true, data: row, source: 'sap' });
        }
        return res.status(404).json({
          success: false,
          error: { message: 'Shipment not found for this contract STO / operation' },
        });
      }

      const shipmentRow = shipmentResult.rows[0] as Record<string, unknown>;
      shipmentRow.status = resolveContractLogisticsStoStatus({
        contractImportStatus: shipmentStoImportStatus,
        dbStatus: shipmentRow.status,
        logisticsType: 'shipment',
        shipmentMilestones: {
          eta_completed_loading: shipmentRow.eta_vessel_completed_loading,
          ata_completed_loading: shipmentRow.ata_vessel_completed_loading,
          ata_complete_discharge: shipmentRow.ata_vessel_complete_discharge,
          eta_complete_discharge: shipmentRow.eta_vessel_complete_discharge,
        },
      });
      return res.json({ success: true, data: shipmentRow });
    }

    const truckingResult = await query(
      `WITH contract_candidates AS (
        SELECT c.contract_id AS contract_number
        FROM contracts c
        WHERE c.id = $1
      ),
      ${buildQtyMoveCte({ kind: 'in_subquery', subquery: 'SELECT contract_number FROM contract_candidates' })}
      SELECT
        t.id,
        COALESCE(
          (
            SELECT TRIM(k.key)
            FROM unnest($2::text[]) AS k(key)
            WHERE TRIM(k.key) != ''
              AND (
                EXISTS (
                  SELECT 1 FROM contract_stos cs
                  WHERE cs.contract_id = c.id AND TRIM(cs.sto_number::text) = TRIM(k.key)
                )
                OR EXISTS (
                  SELECT 1 FROM sap_processed_data spd
                  WHERE spd.contract_number = c.contract_id
                    AND ${SPD_EFFECTIVE_STO_SQL} = TRIM(k.key)
                )
              )
            ORDER BY TRIM(k.key)
            LIMIT 1
          ),
          NULLIF(TRIM(t.operation_id::text), ''),
          '-'
        ) AS sto_number,
        t.operation_id,
        t.status,
        t.trucking_owner,
        c.contract_id AS contract_number,
        t.loading_location,
        ${sqlB2bEndingUnloadExpr('t.unloading_location')} AS unloading_location,
        c.quantity_ordered AS contract_qty,
        COALESCE(NULLIF((
          SELECT SUM(${sqlSapQtyDeliveredKgFromSpd('spd', 'c.quantity_ordered', 'c.incoterm')})
          FROM sap_processed_data spd
          WHERE (
            spd.contract_number = c.contract_id
            OR (
              NULLIF(TRIM(c.po_number::text), '') IS NOT NULL
              AND TRIM(COALESCE(spd.po_number::text, spd.data->'raw'->>'PO No', spd.data->'raw'->>'PO No.', '')) = TRIM(c.po_number::text)
            )
          )
            AND (
              ${SPD_EFFECTIVE_STO_SQL} = ANY($2::text[])
              OR (
                EXISTS (
                  SELECT 1 FROM unnest($2::text[]) AS k(key)
                  WHERE TRIM(k.key) ~ '^(OP-|MNL-|MSEA-)'
                )
                AND (
                  NULLIF(TRIM(COALESCE(
                    spd.data->'raw'->>'Operation ID',
                    spd.data->'trucking'->0->'data'->>'operation_id',
                    ''
                  )), '') = ANY($2::text[])
                  OR ${SPD_EFFECTIVE_STO_SQL} IS NULL
                )
              )
            )
        ), 0), t.quantity_delivered) AS quantity_delivered,
        COALESCE(NULLIF((
          SELECT SUM(NULLIF(regexp_replace(COALESCE(
            NULLIF(TRIM(spd.data->'raw'->>'Quantity Receive'), ''),
            NULLIF(TRIM(spd.data->'raw'->>'Qty Receive'), ''),
            ''
          ), '[^0-9\\.-]', '', 'g'), '')::numeric)
          FROM sap_processed_data spd
          WHERE (
            spd.contract_number = c.contract_id
            OR (
              NULLIF(TRIM(c.po_number::text), '') IS NOT NULL
              AND TRIM(COALESCE(spd.po_number::text, spd.data->'raw'->>'PO No', spd.data->'raw'->>'PO No.', '')) = TRIM(c.po_number::text)
            )
          )
            AND (
              ${SPD_EFFECTIVE_STO_SQL} = ANY($2::text[])
              OR (
                EXISTS (
                  SELECT 1 FROM unnest($2::text[]) AS k(key)
                  WHERE TRIM(k.key) ~ '^(OP-|MNL-|MSEA-)'
                )
                AND (
                  NULLIF(TRIM(COALESCE(
                    spd.data->'raw'->>'Operation ID',
                    spd.data->'trucking'->0->'data'->>'operation_id',
                    ''
                  )), '') = ANY($2::text[])
                  OR ${SPD_EFFECTIVE_STO_SQL} IS NULL
                )
              )
            )
        ), 0), t.quantity_delivered) AS quantity_receive,
        ${sqlContractGlobalOutstandingExpr({
          contractQtyExpr: 'c.quantity_ordered',
          incotermExpr: contractEffectiveIncotermExpr('c'),
          contractNumberExpr: 'c.contract_id',
        })} AS outstanding_quantity,
        c.delivery_start_date,
        c.delivery_end_date,
        c.product,
        COALESCE(
          tr.realization_start_date,
          ${sqlSapTruckingStartReceiveDateForLookupKeys('c.contract_id', '$2::text[]')}
        ) AS trucking_start_date,
        -- Trucking Last Receive: realization_end → SAP AW → WB Actuals
        ${sqlStoTruckingLastReceiveDateForLookupKeys(
          'c.contract_id',
          '$2::text[]',
          't.id',
        )} AS trucking_completion_date,
        t.eta_trucking_start_date,
        -- ETA Trucking Completion = last date on Daily Planning Deliverables (upload)
        COALESCE(
          t.last_daily_deliverable_date,
          (
            SELECT MAX((NULLIF(TRIM(dd.elem->>'date'), ''))::date)
            FROM jsonb_array_elements(COALESCE(t.daily_deliverables, '[]'::jsonb)) AS dd(elem)
            WHERE NULLIF(TRIM(dd.elem->>'date'), '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
          )
        ) AS eta_trucking_completion_date
      FROM trucking_operations t
      INNER JOIN contracts c ON t.contract_id = c.id
      ${sqlB2bOriginEndingChildLateralJoin({ originPoExpr: 'c.po_number' })}
      ${TRUCKING_REALIZATIONS_JOIN}
      WHERE c.id = $1
        AND (
          TRIM(COALESCE(t.operation_id::text, '')) = ANY($2::text[])
          OR EXISTS (
            SELECT 1 FROM contract_stos cs
            WHERE cs.contract_id = c.id AND TRIM(cs.sto_number::text) = ANY($2::text[])
          )
          OR EXISTS (
            SELECT 1
            FROM sap_processed_data spd
            WHERE spd.contract_number = c.contract_id
              AND ${SPD_EFFECTIVE_STO_SQL} = ANY($2::text[])
          )
        )
      ORDER BY t.created_at DESC NULLS LAST
      LIMIT 1`,
      [id, uniqueKeys],
    );

    if (truckingResult.rows.length === 0) {
      const sapTruckingResult = await query(TRUCKING_SAP_STO_DETAIL_SQL, [id, uniqueKeys]);
      if (sapTruckingResult.rows.length > 0) {
        const row = sapTruckingResult.rows[0] as Record<string, unknown>;
        row.status = resolveContractLogisticsStoStatus({
          contractImportStatus,
          dbStatus: row.status,
          logisticsType: 'trucking',
          truckingOptions: {
            realizationEndDate: row.trucking_completion_date,
            realizationStartDate: row.trucking_start_date,
            stoNumber: row.sto_number,
          },
        });
        return res.json({ success: true, data: row, source: 'sap' });
      }
      const sapShipmentCrossResult = await query(SHIPMENT_SAP_STO_DETAIL_SQL, [id, uniqueKeys]);
      if (sapShipmentCrossResult.rows.length > 0) {
        const row = sapShipmentCrossResult.rows[0] as Record<string, unknown>;
        row.status = resolveContractLogisticsStoStatus({
          contractImportStatus: shipmentStoImportStatus,
          dbStatus: row.status,
          logisticsType: 'shipment',
          shipmentMilestones: {
            eta_completed_loading: row.eta_vessel_completed_loading,
            ata_completed_loading: row.ata_vessel_completed_loading,
            ata_complete_discharge: row.ata_vessel_complete_discharge,
            eta_complete_discharge: row.eta_vessel_complete_discharge,
          },
        });
        return res.json({ success: true, data: row, source: 'sap' });
      }
      return res.status(404).json({
        success: false,
        error: { message: 'Trucking operation not found for this contract STO / operation' },
      });
    }

    const truckingRow = truckingResult.rows[0] as Record<string, unknown>;
    truckingRow.status = resolveContractLogisticsStoStatus({
      contractImportStatus,
      dbStatus: truckingRow.status,
      logisticsType: 'trucking',
      truckingOptions: {
        realizationEndDate: truckingRow.trucking_completion_date,
        realizationStartDate: truckingRow.trucking_start_date,
        stoNumber: truckingRow.sto_number,
      },
    });
    return res.json({ success: true, data: truckingRow });
  } catch (error) {
    logger.error('Get contract logistics STO detail error:', error);
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch logistics STO detail' },
    });
  }
};

/** Get activity log for a contract: changes to contract, STO (shipments, trucking, loading ports), documents, payments */
export const getContractActivityLog = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const contractCheck = await query('SELECT id FROM contracts WHERE id = $1', [id]);
    if (contractCheck.rows.length === 0) {
      return res.status(404).json({ success: false, error: { message: 'Contract not found' } });
    }

    const result = await query(
      `SELECT
         a.id,
         a.action,
         a.entity_type,
         a.entity_id,
         a.before_data,
         a.after_data,
         a.timestamp,
         u.username,
         u.full_name
       FROM audit_logs a
       LEFT JOIN users u ON a.user_id = u.id
       WHERE (
         (a.entity_type = 'CONTRACT' AND a.entity_id = $1)
         OR (a.entity_type = 'SHIPMENT' AND a.entity_id IN (SELECT id FROM shipments WHERE contract_id = $1))
         OR (a.entity_type = 'TRUCKING_OPERATION' AND a.entity_id IN (SELECT id FROM trucking_operations WHERE contract_id = $1))
         OR (a.entity_type = 'PAYMENT' AND a.entity_id IN (SELECT id FROM payments WHERE contract_id = $1))
         OR (a.entity_type = 'DOCUMENT' AND a.entity_id IN (SELECT id FROM documents WHERE contract_id = $1))
         OR (a.entity_type = 'LOADING_PORT' AND a.entity_id IN (SELECT vlp.id FROM vessel_loading_ports vlp JOIN shipments s ON s.id = vlp.shipment_id WHERE s.contract_id = $1))
       )
       ORDER BY a.timestamp DESC
       LIMIT 200`,
      [id]
    );

    const logs = result.rows.map((row) => ({
      id: row.id,
      action: row.action,
      entity_type: row.entity_type,
      entity_id: row.entity_id,
      before_data: row.before_data,
      after_data: row.after_data,
      timestamp: row.timestamp,
      username: row.username || row.full_name || 'System',
      full_name: row.full_name,
    }));

    return res.json({ success: true, data: logs });
  } catch (error) {
    logger.error('Get contract activity log error:', error);
    return res.status(500).json({ success: false, error: { message: 'Failed to load activity log' } });
  }
};

/** Get B2B parties for an "origin" contract: contracts whose Contract Reff PO Ini points to this contract's PO Number */
export const getB2bPartiesForContract = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const contractCheck = await query(
      `
      WITH latest_spd AS (
        SELECT DISTINCT ON (contract_number)
          contract_number,
          data,
          created_at
        FROM sap_processed_data
        WHERE contract_number IS NOT NULL AND TRIM(contract_number) != ''
        ORDER BY contract_number, created_at DESC NULLS LAST
      )
      SELECT
        c.id,
        c.contract_id,
        COALESCE(
          NULLIF(TRIM(c.po_number), ''),
          NULLIF(TRIM(l.data->'contract'->>'po_no'), ''),
          NULLIF(TRIM(l.data->'raw'->>'PO No.'), ''),
          NULLIF(TRIM(l.data->>'PO No.'), ''),
          NULLIF(TRIM(l.data->>'PO Number'), '')
        ) AS origin_po_number
      FROM contracts c
      LEFT JOIN latest_spd l ON l.contract_number = c.contract_id
      WHERE c.id = $1
      `,
      [id]
    );
    if (contractCheck.rows.length === 0) {
      return res.status(404).json({ success: false, error: { message: 'Contract not found' } });
    }
    const originPoNumber: string | null = contractCheck.rows[0].origin_po_number || null;
    if (!originPoNumber) {
      // Without a PO number, we cannot resolve B2B children by Contract Reff PO
      return res.json({ success: true, data: [] });
    }

    const q = `
      WITH latest_spd AS (
        SELECT DISTINCT ON (contract_number) contract_number, data, created_at
        FROM sap_processed_data
        WHERE contract_number IS NOT NULL AND TRIM(contract_number) != ''
        ORDER BY contract_number, created_at DESC NULLS LAST
      )
      SELECT
        c.contract_id,
        MAX(c.contract_date) AS contract_date,
        STRING_AGG(DISTINCT c.po_number, ', ' ORDER BY c.po_number) FILTER (WHERE c.po_number IS NOT NULL AND c.po_number != '') AS po_numbers,
        MAX(COALESCE(l.data->'raw'->>'Contract Ext No', l.data->>'Contract Ext No')) AS contract_ext_no,
        MAX(COALESCE(NULLIF(TRIM(c.company_name), ''), l.data->'raw'->>'Buyer', l.data->>'Buyer')) AS company_name,
        MAX(c.supplier) AS supplier,
        MAX(COALESCE(NULLIF(TRIM(c.incoterm), ''), l.data->'contract'->>'incoterm', l.data->>'Incoterm')) AS incoterm,
        MAX(COALESCE(
          l.data->'raw'->>'Certification',
          l.data->'raw'->>'certification',
          l.data->>'Certification',
          l.data->>'certification'
        )) AS certification
      FROM contracts c
      LEFT JOIN latest_spd l ON l.contract_number = c.contract_id
      WHERE NULLIF(TRIM(COALESCE(
        l.data->'contract'->>'contract_reference_po',
        l.data->>'CONTRACT REFF PO',
        l.data->>'Contract Reff PO Ini',
        l.data->'raw'->>'Contract Reff PO Ini'
      )), '') = $1
      GROUP BY c.contract_id
      ORDER BY MAX(c.contract_date) DESC NULLS LAST
      LIMIT 200
    `;
    const result = await query(q, [originPoNumber]);

    return res.json({ success: true, data: result.rows });
  } catch (error) {
    logger.error('Get B2B parties error:', error);
    return res.status(500).json({ success: false, error: { message: 'Failed to load B2B parties' } });
  }
};

export const createContract = async (req: AuthRequest, res: Response) => {
  try {
    const {
      contract_id,
      buyer,
      supplier,
      product,
      quantity_ordered,
      unit,
      incoterm,
      loading_site,
      unloading_site,
      contract_date,
      delivery_start_date,
      delivery_end_date,
      contract_value,
      currency,
      sap_contract_id,
    } = req.body;

    const result = await query(
      `INSERT INTO contracts (
        contract_id, buyer, supplier, product, quantity_ordered, unit, incoterm,
        loading_site, unloading_site, contract_date, delivery_start_date,
        delivery_end_date, contract_value, currency, sap_contract_id, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      RETURNING *`,
      [
        contract_id,
        buyer,
        supplier,
        product,
        quantity_ordered,
        unit,
        incoterm,
        loading_site,
        unloading_site,
        contract_date,
        delivery_start_date,
        delivery_end_date,
        contract_value,
        currency,
        sap_contract_id,
        req.user?.id,
      ]
    );

    logger.info(`Contract created: ${contract_id} by ${req.user?.username}`);

    void import('../services/prePlannedGroup.service').then(({ schedulePrePlannedRebuildIfEnabled }) =>
      schedulePrePlannedRebuildIfEnabled('contract-create'),
    );

    res.status(201).json({
      success: true,
      data: result.rows[0],
    });
  } catch (error) {
    logger.error('Create contract error:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to create contract' },
    });
  }
};

export const updateContract = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const filtered = filterContractUpdatesForRole(req.user?.role, req.body ?? {});
    if (!filtered.ok) {
      return res.status(403).json({
        success: false,
        error: { message: filtered.message },
      });
    }
    const updates = filtered.updates;

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        success: false,
        error: { message: 'No valid fields to update' },
      });
    }

    const setClause = Object.keys(updates)
      .map((key, index) => `${key} = $${index + 2}`)
      .join(', ');

    const values = [id, ...Object.values(updates)];

    const result = await query(
      `UPDATE contracts SET ${setClause}, updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: { message: 'Contract not found' },
      });
    }

    const triggerFields = [
      'delivery_start_date',
      'delivery_end_date',
      'quantity_ordered',
      'plant_code',
      'transport_mode',
      'company_name',
    ];
    if (Object.keys(updates).some((k) => triggerFields.includes(k))) {
      void import('../services/prePlannedGroup.service').then(({ schedulePrePlannedRebuildIfEnabled }) =>
        schedulePrePlannedRebuildIfEnabled('contract-update'),
      );
    }

    return res.json({
      success: true,
      data: result.rows[0],
    });
  } catch (error) {
    logger.error('Update contract error:', error);
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to update contract' },
    });
  }
};

function normalizePlanningHeader(v: unknown): string {
  return String(v ?? '').trim().toLowerCase().replace(/[\s_-]+/g, '');
}

function findCargoColumnIndex(headers: unknown[], candidates: string[]): number {
  const norm = headers.map(normalizePlanningHeader);
  const candNorm = candidates.map(s => s.toLowerCase().replace(/[\s_-]+/g, ''));
  for (const c of candNorm) {
    const idx = norm.indexOf(c);
    if (idx !== -1) return idx;
  }
  return -1;
}

export const bulkUpdateCargoReadiness = async (req: AuthRequest & { file?: Express.Multer.File }, res: Response) => {
  const file = req.file;
  if (!file?.buffer) {
    return res.status(400).json({ success: false, error: { message: 'File is required' } });
  }

  let matrix: unknown[][];
  try {
    matrix = parsePlanningSheetToMatrix(file.buffer);
  } catch (e: any) {
    return res.status(400).json({ success: false, error: { message: e?.message || 'Could not read file' } });
  }

  if (matrix.length < 2) {
    return res.status(400).json({ success: false, error: { message: 'File must have a header row and at least one data row' } });
  }

  const headerRow = matrix[0];
  const poIdx = findCargoColumnIndex(headerRow, ['po_number', 'po number', 'po']);
  const dateIdx = findCargoColumnIndex(headerRow, ['cargo_readiness_date', 'cargo readiness date', 'cargo readiness', 'date', 'tanggal']);

  if (poIdx === -1 || dateIdx === -1) {
    return res.status(400).json({ success: false, error: { message: 'File must have columns: po_number, cargo_readiness_date' } });
  }

  let updated = 0;
  let notFound = 0;
  const errors: { po_number: string; reason: string }[] = [];

  for (let i = 1; i < matrix.length; i++) {
    const row = matrix[i];
    const po = String(row[poIdx] ?? '').trim();
    if (!po) continue;

    const dateRaw = row[dateIdx];
    const cargoDate = dateRaw != null && String(dateRaw).trim() !== ''
      ? toIsoDate10FromCell(dateRaw)
      : null;

    try {
      const result = await query(
        `UPDATE contracts SET cargo_readiness_date = $1, updated_at = CURRENT_TIMESTAMP WHERE po_number = $2 RETURNING id`,
        [cargoDate, po]
      );
      if (result.rows.length > 0) {
        updated++;
        await query(
          `UPDATE trucking_operations t
           SET cargo_readiness_date = $1, updated_at = CURRENT_TIMESTAMP
           FROM contracts c
           WHERE t.contract_id = c.id AND c.po_number = $2`,
          [cargoDate, po]
        );
      } else {
        notFound++;
        errors.push({ po_number: po, reason: 'Not found' });
      }
    } catch {
      errors.push({ po_number: po, reason: 'Update failed' });
    }
  }

  return res.json({ success: true, data: { updated, notFound, errors } });
};

