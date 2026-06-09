import { Response } from 'express';
import { query } from '../database/connection';
import {
  diffCalendarDays,
  computeLateIndicatorText,
} from '../utils/calendarDays';
import { AuthRequest } from '../middleware/auth';
import logger from '../utils/logger';
import {
  appendColumnFiltersBase,
  appendGlobalSearchBase,
  parseColumnFiltersQuery,
} from '../utils/contractListFilters';
import { CONTRACTS_LIST_OUTER_SQL } from './contractsListOuterSql';
import { CONTRACTS_QTY_MOVE_CTE } from './contractsQtyMoveSql';
import { appendContractPerfSourceTypeFilter, B2B_CHILD_EXCLUSION_SQL } from './contractSqlFragments';
import { parsePlanningSheetToMatrix, toIsoDate10FromCell } from '../utils/planningSheetDate';
import {
  computeOpenCashCycleDays,
  computeOpenDpCycleDays,
  computeOpenLogCycleDays,
  resolveSapDpCalendarDate,
  resolveSapPayoffCalendarDate,
  computePerfTradeCycleDaysForRow,
  isContractIncludedInPerfDrilldownTreeWithComputed,
  isContractPerfOnTimeTradeCycle,
  runLatePerformance,
  sqlEffectiveDeliveryEndPresent,
} from '../services/latePerformance.service';
import { appendGroupPlantFilter, groupPlantExpr } from '../utils/groupPlantSql';
import { ensureUserStoContractAssignmentsTable } from '../database/ensureUserStoContractAssignments';

export { B2B_CHILD_EXCLUSION_SQL };

export const getContracts = async (req: AuthRequest, res: Response) => {
  try {
    await ensureUserStoContractAssignmentsTable();
    const { status, supplier, buyer, dateFrom, dateTo, outstanding, companyCode, b2bFlag, page = 1, limit = 10 } = req.query;
    const productFilter = (req.query as any).product as string | undefined;
    const sourceTypeFilter = (req.query as any).sourceType as string | undefined;
    const transportMode = (req.query as any).transportMode as string | undefined;
    const unassigned = (req.query as any).unassigned as string | undefined; // 'sea' | 'land' | 'mix'
    const plant = (req.query as any).plant as string | string[] | undefined;
    const sortKeyRaw = String((req.query as any).sortKey || 'contract_date');
    const sortDirRaw = String((req.query as any).sortDir || 'desc').toLowerCase();
    const sortDir = sortDirRaw === 'asc' ? 'ASC' : 'DESC';
    // Allow filtering by a specific contract id (used by shipment details fallback)
    const contractIdFilter = (req.query as any).contract_id || (req.query as any).contractId || null;
    const offset = (Number(page) - 1) * Number(limit);

    const queryParams: any[] = [];
    let paramIndex = 1;
    let contractScopeWhere = '';
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

    // contract_scope narrows contracts + sap_processed_data work when date / contract_id filters are present (default YTD on UI).
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
          STRING_AGG(DISTINCT x.effective_sto, ', ' ORDER BY x.effective_sto) AS sto_numbers,
          SUM(x.sto_quantity_num) AS total_sto_quantity,
          COUNT(DISTINCT x.effective_sto) AS sto_count
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
          MAX(c.buyer) AS buyer,
          MAX(c.supplier) AS supplier,
          MAX(c.group_name) AS group_name,
          MAX(c.product) AS product,
          MAX(c.company_name) AS company_name,
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
          MAX(c.plant_code) AS plant_code,
          MAX(c.cargo_readiness_date) AS cargo_readiness_date,
          MAX(c.created_at) AS created_at,
          STRING_AGG(DISTINCT c.po_number, ', ' ORDER BY c.po_number) FILTER (WHERE c.po_number IS NOT NULL AND c.po_number != '') AS po_numbers,
          MAX(c.sto_number) AS sto_number,
          (array_agg(l.data ORDER BY l.created_at DESC NULLS LAST))[1] AS latest_spd_data,
          (array_agg(s.sto_numbers ORDER BY s.total_sto_quantity DESC NULLS LAST))[1] AS sto_numbers_agg,
          (array_agg(s.total_sto_quantity ORDER BY s.total_sto_quantity DESC NULLS LAST))[1] AS total_sto_quantity,
          (array_agg(s.sto_count ORDER BY s.sto_count DESC NULLS LAST))[1] AS sto_count,
          (array_agg(qm.quantity_delivery ORDER BY qm.quantity_delivery DESC NULLS LAST))[1] AS quantity_delivery,
          (array_agg(qm.quantity_receive ORDER BY qm.quantity_receive DESC NULLS LAST))[1] AS quantity_receive,
          COUNT(DISTINCT c.po_number) FILTER (WHERE c.po_number IS NOT NULL) AS po_count,
          -- For Log Cycle calculation (LAND): earliest and latest trucking dates
          (SELECT MIN(t.trucking_start_date) FROM trucking_operations t WHERE t.contract_id = (array_agg(c.id ORDER BY c.created_at DESC))[1]) AS first_trucking_start_date,
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
          -- For Trade/Cash Cycle calculation (LAND open): latest date in daily_deliverables JSONB
          (
            SELECT MAX((dd->>'date')::date)
            FROM trucking_operations tdd
            CROSS JOIN LATERAL jsonb_array_elements(COALESCE(tdd.daily_deliverables, '[]'::jsonb)) AS dd
            WHERE tdd.contract_id = (array_agg(c.id ORDER BY c.created_at DESC))[1]
              AND (dd->>'date') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
          ) AS last_trucking_daily_deliverable_date,
          -- Open standard ETA (LAND): from trucking ETA columns
          (
            SELECT MAX(COALESCE(t.eta_trucking_completion_date::date, t.eta_delivery_end_date::date))
            FROM trucking_operations t
            WHERE t.contract_id = (array_agg(c.id ORDER BY c.created_at DESC))[1]
          ) AS open_standard_eta_trucking,
          -- For Log Cycle calculation (SEA): earliest ATA loading complete and latest ATA discharge complete
          (SELECT MIN(s2.ata_loading_complete::date) FROM shipments s2 WHERE s2.contract_id = (array_agg(c.id ORDER BY c.created_at DESC))[1] AND s2.ata_loading_complete IS NOT NULL) AS first_ata_vessel_completed_loading,
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
          -- Latest vessel name (SEA contracts; for list display)
          (
            SELECT s2.vessel_name
            FROM shipments s2
            WHERE s2.contract_id = (array_agg(c.id ORDER BY c.created_at DESC))[1]
              AND NULLIF(TRIM(s2.vessel_name), '') IS NOT NULL
            ORDER BY s2.updated_at DESC NULLS LAST, s2.created_at DESC NULLS LAST
            LIMIT 1
          ) AS last_vessel_name,
          -- Latest ETA vessel completed loading (loading port)
          (
            SELECT MAX(
              COALESCE(
                s2.eta_loading_complete::date,
                (
                  SELECT vlpd.eta_loading_completed::date
                  FROM vessel_loading_ports vlpd
                  WHERE vlpd.shipment_id = s2.id
                    AND COALESCE(vlpd.is_discharge_port, false) = false
                  ORDER BY vlpd.updated_at DESC NULLS LAST, vlpd.created_at DESC NULLS LAST
                  LIMIT 1
                )
              )
            )
            FROM shipments s2
            WHERE s2.contract_id = (array_agg(c.id ORDER BY c.created_at DESC))[1]
          ) AS last_eta_vessel_completed_loading,
          -- Open standard ETA (SEA): from first loading-port ETA vessel arrival
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
          -- For Trade/Cash Cycle calculation (SEA open): latest ETA vessel complete discharge
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
      ),
      filtered AS (
        SELECT * FROM base
        WHERE 1=1
        ${B2B_CHILD_EXCLUSION_SQL}
    `;

    const statusNorm = typeof status === 'string' ? status.trim() : '';
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

    if (supplier) {
      queryText += ` AND base.supplier ILIKE $${paramIndex}`;
      queryParams.push(`%${supplier}%`);
      paramIndex++;
    }

    if (buyer) {
      queryText += ` AND base.buyer ILIKE $${paramIndex}`;
      queryParams.push(`%${buyer}%`);
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

    if (productFilter && productFilter.trim().length > 0) {
      queryText += ` AND COALESCE(base.product, '') ILIKE $${paramIndex}`;
      queryParams.push(`%${productFilter.trim()}%`);
      paramIndex++;
    }

    queryText += appendContractPerfSourceTypeFilter(sourceTypeFilter, 'base.source_type');

    if (outstanding === 'true') {
      queryText += ` AND (
        base.quantity_ordered - COALESCE(
          CASE
            WHEN UPPER(TRIM(COALESCE(base.incoterm, ''))) IN ('FRC', 'CIF', 'CFR') THEN base.quantity_receive
            WHEN UPPER(TRIM(COALESCE(base.incoterm, ''))) IN ('LCO', 'FOB') THEN base.quantity_delivery
            ELSE base.total_sto_quantity
          END,
          0
        )
      ) > 0`;
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

    const outstandingQtyExpr = `(
      quantity_ordered - COALESCE(
        CASE
          WHEN UPPER(TRIM(COALESCE(incoterm, ''))) IN ('FRC', 'CIF', 'CFR') THEN quantity_receive
          WHEN UPPER(TRIM(COALESCE(incoterm, ''))) IN ('LCO', 'FOB') THEN quantity_delivery
          ELSE total_sto_quantity
        END,
        0
      )
    )`;
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

    // Detect cycle sort / late filter BEFORE building the query so we can inject SQL-level filtering.
    const cycleSortKeys = new Set(['log_cycle_days', 'trade_cycle_days', 'cash_cycle_days']);
    const wantCycleSort = cycleSortKeys.has(sortKeyRaw);
    const lateOnTimeFilterRaw = String((req.query as any).lateOnTimeFilter || 'ALL').toUpperCase();
    const wantLateFilter = lateOnTimeFilterRaw === 'LATE' || lateOnTimeFilterRaw === 'ON_TIME';

    // When true (Method 1 / Apply mode): exclude contracts that are not counted in the
    // performance drilldown tree — i.e. no delivery_end_date, or Closed without a completion
    // date. This makes Section 3 row count exactly match Section 2 drilldown node count.
    const wantExcludeUnscheduled = String((req.query as any).excludeUnscheduled || 'false') === 'true';

    // Reusable SQL fragments that mirror latePerformance.service.ts inclusion rules.
    const _statusExpr = `UPPER(TRIM(COALESCE(NULLIF(TRIM(COALESCE(latest_spd_data->'contract'->>'status', '')), ''), NULLIF(TRIM(status), ''), '')))`;
    const _transportExpr = `UPPER(TRIM(COALESCE(transport_mode, '')))`;
    // A contract is "schedulable" (counted in late/ontrack tree) when:
    //   - delivery_end_date exists, AND
    //   - status is known, AND
    //   - if Closed: has a completion date (LAND→last_trucking_completion_date, SEA→last_ata_vessel_complete_discharge)
    //   - if Open/Active: always schedulable (service applies today-vs-deliveryEnd fallback)
    const schedulableCondition = `
      ${sqlEffectiveDeliveryEndPresent()}
      AND ${_statusExpr} IN ('OPEN','ACTIVE','CLOSE','CLOSED','COMPLETED')
      AND (
        ${_statusExpr} IN ('OPEN','ACTIVE')
        OR (
          ${_statusExpr} IN ('CLOSE','CLOSED','COMPLETED') AND (
            (${_transportExpr} LIKE 'LAND%' AND last_trucking_completion_date IS NOT NULL)
            OR (${_transportExpr} NOT LIKE 'LAND%' AND last_ata_vessel_complete_discharge IS NOT NULL)
          )
        )
      )`;

    // Push Late/On-Track filter into SQL when cycle sort is NOT also requested.
    // This avoids fetching up to 10 000 rows just to filter them in Node.js.
    // Keep late/on-time filtering in Node so it mirrors late-performance service logic
    // (effective due-date fallback + Open Condition B when standard ETA is empty).
    const useSqlLateFilter = false;

    // SQL expression that mirrors the JS trade_cycle_days computation:
    //   positive  = delivered / projected AFTER delivery_end_date  → LATE
    //   negative  = on / ahead of schedule                         → ON TRACK
    const tradeCycleSqlExpr = `
      CASE
        WHEN UPPER(TRIM(COALESCE(NULLIF(TRIM(COALESCE(latest_spd_data->'contract'->>'status', '')), ''), NULLIF(TRIM(status), ''), ''))) IN ('CLOSE', 'CLOSED', 'COMPLETED')
             AND delivery_end_date IS NOT NULL
          THEN CASE
            WHEN UPPER(TRIM(COALESCE(transport_mode, ''))) LIKE 'LAND%' AND last_trucking_completion_date IS NOT NULL
              THEN (last_trucking_completion_date::date - delivery_end_date::date)
            WHEN UPPER(TRIM(COALESCE(transport_mode, ''))) LIKE 'SEA%' AND last_ata_vessel_complete_discharge IS NOT NULL
              THEN (last_ata_vessel_complete_discharge::date - delivery_end_date::date)
            ELSE NULL END
        WHEN UPPER(TRIM(COALESCE(NULLIF(TRIM(COALESCE(latest_spd_data->'contract'->>'status', '')), ''), NULLIF(TRIM(status), ''), ''))) IN ('OPEN', 'ACTIVE')
             AND delivery_end_date IS NOT NULL
          THEN CASE
            WHEN UPPER(TRIM(COALESCE(transport_mode, ''))) LIKE 'LAND%' AND last_trucking_daily_deliverable_date IS NOT NULL
              THEN (last_trucking_daily_deliverable_date::date - delivery_end_date::date)
            WHEN UPPER(TRIM(COALESCE(transport_mode, ''))) LIKE 'SEA%' AND last_eta_vessel_complete_discharge IS NOT NULL
              THEN (last_eta_vessel_complete_discharge::date - delivery_end_date::date)
            ELSE NULL END
        ELSE NULL
      END`;

    const lateConditionSql = lateOnTimeFilterRaw === 'LATE'
      ? 'tc.trade_cycle_days_sql IS NOT NULL AND tc.trade_cycle_days_sql > 0'
      : 'tc.trade_cycle_days_sql IS NOT NULL AND tc.trade_cycle_days_sql <= 0';

    // When using SQL late filter: inject two extra CTEs between filtered and page.
    const sqlLateInject = useSqlLateFilter
      ? `, tc AS (SELECT *, ${tradeCycleSqlExpr} AS trade_cycle_days_sql FROM filtered)
         , filtered_late AS (SELECT * FROM tc WHERE ${lateConditionSql})`
      : '';

    // Method 1 (Apply mode): inject CTE that mirrors the performance tree's inclusion rules.
    // Contracts without delivery_end or Closed without completion date are excluded so that
    // Section 3 row count equals Section 2 drilldown node count exactly.
    const sqlExcludeUnscheduledInject = wantExcludeUnscheduled
      ? `, filtered_perf AS (SELECT * FROM filtered WHERE ${schedulableCondition})`
      : '';

    const pageSource = wantExcludeUnscheduled
      ? 'filtered_perf'
      : useSqlLateFilter
        ? 'filtered_late'
        : 'filtered';

    const filteredClosedAndPage = `
      )
      ${sqlLateInject}
      ${sqlExcludeUnscheduledInject}
      , page AS (
        SELECT * FROM ${pageSource}
        ORDER BY ${orderExpr} ${sortDir} NULLS LAST, contract_date DESC NULLS LAST, contract_id DESC
        LIMIT $${limitParam} OFFSET $${offsetParam}
      )
`;
    const listQuery = queryText + filteredClosedAndPage + CONTRACTS_LIST_OUTER_SQL;
    const listParams = [...queryParams, Number(limit), offset];

    const countQuery = wantExcludeUnscheduled
      ? `${queryText}), filtered_perf AS (SELECT * FROM filtered WHERE ${schedulableCondition}) SELECT COUNT(*)::int AS count FROM filtered_perf`
      : useSqlLateFilter
        ? `${queryText}), tc AS (SELECT *, ${tradeCycleSqlExpr} AS trade_cycle_days_sql FROM filtered), filtered_late AS (SELECT * FROM tc WHERE ${lateConditionSql}) SELECT COUNT(*)::int AS count FROM filtered_late`
        : `${queryText}) SELECT COUNT(*)::int AS count FROM filtered`;
    const countParams = [...queryParams];

    const countResult = await query(countQuery, countParams);
    const totalCount = Number(countResult.rows[0]?.count ?? 0);

    let result: any;
    if (!wantCycleSort && !wantLateFilter && !wantExcludeUnscheduled) {
      // Fast path: SQL handles everything, fetch only the page slice.
      result = await query(listQuery, listParams);
    } else if (useSqlLateFilter) {
      // SQL late filter: also fetch only the page slice (SQL already filtered).
      result = await query(listQuery, listParams);
    } else {
      // Cycle sort (or combined late+cycle): fetch all matching rows in Node for JS sort.
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
    const addDays = (date: Date, days: number): Date => {
      const out = new Date(date);
      out.setUTCDate(out.getUTCDate() + days);
      return out;
    };
    const diffInDays = (start: unknown, end: unknown): number | null => diffCalendarDays(start, end);

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
      row.dp_date = due(row.dp_date_raw) ?? due(row.dp_date_fb) ?? row.dp_date;
      row.payoff_date = due(row.payoff_date_raw) ?? due(row.payoff_date_fb) ?? row.payoff_date;
      row.dp_date_deviation_days = parseDeviation(row.dp_date_deviation_raw) ?? row.dp_date_deviation_fb ?? row.dp_date_deviation_days;
      row.payoff_date_deviation_days = parseDeviation(row.payoff_date_deviation_raw) ?? row.payoff_date_deviation_fb ?? row.payoff_date_deviation_days;
      const dueDate = due(row.due_date_payment);
      if (dueDate) {
        if (row.dp_date == null && typeof row.dp_date_deviation_days === 'number') {
          row.dp_date = addDays(dueDate, row.dp_date_deviation_days);
        }
        if (row.payoff_date == null && typeof row.payoff_date_deviation_days === 'number') {
          row.payoff_date = addDays(dueDate, row.payoff_date_deviation_days);
        }
      }

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

      // Compute Log Cycle (days) based on transport mode and status
      const transport = String(row.transport_mode || '').toUpperCase();
      let logCycle: number | null = null;
      const today = new Date();
      const todayMid = new Date(today.getFullYear(), today.getMonth(), today.getDate());

      const lastTruck = row.last_trucking_completion_date;
      const lastAtaDischarge = row.last_ata_vessel_complete_discharge;
      const cargoReady = row.cargo_readiness_date;

      if (statusText === 'CLOSE' || statusText === 'CLOSED' || statusText === 'COMPLETED') {
        if (transport.startsWith('LAND')) {
          const d = diffInDays(cargoReady, lastTruck);
          if (d != null) logCycle = d;
        } else if (transport.startsWith('SEA')) {
          const d = diffInDays(cargoReady, lastAtaDischarge);
          if (d != null) logCycle = d;
        }
      } else if (statusText === 'OPEN' || statusText === 'ACTIVE') {
        logCycle = computeOpenLogCycleDays(row, transport, todayMid, cargoReady);
      }

      (row as any).log_cycle_days = logCycle;

      const payoffDate = resolveSapPayoffCalendarDate(row);
      const dpDate = resolveSapDpCalendarDate(row);

      // Trade Cycle — same rules as late-performance tree (Section 2).
      let tradeCycle = computePerfTradeCycleDaysForRow(row, todayMid);
      (row as any).trade_cycle_days = tradeCycle;
      if (typeof tradeCycle === 'number' && !Number.isNaN(tradeCycle)) {
        (row as any).contract_perf_on_time = isContractPerfOnTimeTradeCycle(row, tradeCycle);
      }

      const perfLateFilter = wantLateFilter ? lateOnTimeFilterRaw : 'ALL';
      (row as any).contract_perf_in_tree = isContractIncludedInPerfDrilldownTreeWithComputed(row, {
        lateOnTimeFilter: perfLateFilter,
      });

      // Compute Cash Cycle (days)
      // - Closed: keep legacy behavior (as-is)
      // - Open: per request
      //   LAND -> latest date from daily_deliverables - Payoff Date
      //   SEA  -> ETA Vessel Complete Discharge - Payoff Date
      let cashCycle: number | null = null;
      if ((statusText === 'CLOSE' || statusText === 'CLOSED' || statusText === 'COMPLETED') && payoffDate) {
        if (transport.startsWith('LAND')) {
          const d = diffInDays(lastTruck, payoffDate);
          if (d != null) cashCycle = d;
        } else if (transport.startsWith('SEA')) {
          const d = diffInDays(lastAtaDischarge, payoffDate);
          if (d != null) cashCycle = d;
        }
      } else if ((statusText === 'OPEN' || statusText === 'ACTIVE') && payoffDate) {
        cashCycle = computeOpenCashCycleDays(row, transport, todayMid, payoffDate);
      }
      (row as any).cash_cycle_days = cashCycle;

      // Compute DP Cycle (days) — same structure as Cash Cycle, using DP Date instead of Payoff Date
      let dpCycle: number | null = null;
      if ((statusText === 'CLOSE' || statusText === 'CLOSED' || statusText === 'COMPLETED') && dpDate) {
        if (transport.startsWith('LAND')) {
          const d = diffInDays(lastTruck, dpDate);
          if (d != null) dpCycle = d;
        } else if (transport.startsWith('SEA')) {
          const d = diffInDays(lastAtaDischarge, dpDate);
          if (d != null) dpCycle = d;
        }
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
    // useSqlLateFilter is already handled in SQL — skip JS late filter for that case.
    const needNodeLateFilter = wantLateFilter && !useSqlLateFilter;
    const needNodeSort = wantCycleSort;
    if (needNodeLateFilter || needNodeSort || wantExcludeUnscheduled) {
      let rows = result.rows as any[];

      if (needNodeLateFilter || wantExcludeUnscheduled) {
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
      delete (row as any).first_trucking_start_date;
      delete (row as any).last_trucking_completion_date;
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
    return res.json({ success: true, data: { b2bFlags: r.rows.map((x: any) => String(x.b2b_flag)) } });
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
      dateFrom,
      dateTo,
      companyCode,
    } = req.query as any;

    const scope = String((req.query as any).scope ?? 'ytd').toLowerCase(); // 'ytd' | 'filtered'
    const debug = String((req.query as any).debug ?? '').toLowerCase() === '1' || String((req.query as any).debug ?? '').toLowerCase() === 'true';
    const transportMode = (req.query as any).transportMode as string | undefined;
    const plant = (req.query as any).plant as string | string[] | undefined;
    const globalSearch = typeof (req.query as any).search === 'string' ? (req.query as any).search.trim() : '';
    const selectedIncoterms = (req.query as any).incoterms as string | undefined; // comma-separated
    const b2bFlag = (req.query as any).b2bFlag as string | undefined;
    const productFilter = (req.query as any).product as string | undefined;

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
          -- Align with GET /contracts: SAP import status is the primary "open/close" signal in Contract Performance.
          (array_agg(l.data->'contract'->>'status' ORDER BY l.created_at DESC NULLS LAST))[1] AS import_status,
          MAX(c.delivery_end_date) AS delivery_end_date,
          MAX(c.cargo_readiness_date) AS cargo_readiness_date,
          (array_agg(l.data ORDER BY l.created_at DESC NULLS LAST))[1] AS latest_spd_data,
          (array_agg(s.total_sto_quantity ORDER BY s.total_sto_quantity DESC NULLS LAST))[1] AS total_sto_quantity,
          (array_agg(qm.quantity_delivery ORDER BY qm.quantity_delivery DESC NULLS LAST))[1] AS quantity_delivery,
          (array_agg(qm.quantity_receive ORDER BY qm.quantity_receive DESC NULLS LAST))[1] AS quantity_receive,
          -- For Trade Cycle (LAND open): latest date in daily_deliverables JSONB
          (
            SELECT MAX((dd->>'date')::date)
            FROM trucking_operations tdd
            CROSS JOIN LATERAL jsonb_array_elements(COALESCE(tdd.daily_deliverables, '[]'::jsonb)) AS dd
            WHERE tdd.contract_id = (array_agg(c.id ORDER BY c.created_at DESC))[1]
              AND (dd->>'date') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
          ) AS last_trucking_daily_deliverable_date,
          -- For Log/Trade Cycle calculation (LAND): latest trucking completion with SAP fallback
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
          -- For Trade Cycle (SEA closed): latest ATA discharge complete
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
          -- For Trade Cycle (SEA open): latest ETA vessel complete discharge
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

    const statusNorm = scope === 'filtered' && typeof status === 'string' ? status.trim() : '';
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
        base.contract_id ILIKE $${paramIndex}
        OR COALESCE(base.product, '') ILIKE $${paramIndex}
        OR COALESCE(base.group_name, '') ILIKE $${paramIndex}
        OR COALESCE(NULLIF(TRIM(pnc.plant_name), ''), NULLIF(TRIM(pna.plant_name), ''), base.plant_code, '') ILIKE $${paramIndex}
      )`;
      queryParams.push(`%${globalSearch}%`);
      paramIndex++;
    }

    const result = await query(queryText, queryParams);

    // Use the same due()/diffInDays() helpers as GET /contracts.
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
    const diffInDays = (start: unknown, end: unknown): number | null => diffCalendarDays(start, end);
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
        if (transport.startsWith('LAND')) {
          debugCounts.branchClosedLand += 1;
          if (row.last_trucking_completion_date) debugCounts.haveLastTruckCompletion += 1;
          if (!row.last_trucking_completion_date) {
            debugCounts.missingCompletionDate += 1;
            pushSample('missingCompletionDate', String(row.contract_id || ''));
          }
          // positive = delivered AFTER due date (LATE), negative = on / ahead of schedule
          tradeCycle = diffCalendarDays(row.delivery_end_date, row.last_trucking_completion_date);
        } else {
          debugCounts.branchClosedSea += 1;
          if (row.last_ata_vessel_complete_discharge) debugCounts.haveLastAtaDischarge += 1;
          if (!row.last_ata_vessel_complete_discharge) {
            debugCounts.missingCompletionDate += 1;
            pushSample('missingCompletionDate', String(row.contract_id || ''));
          }
          tradeCycle = diffCalendarDays(row.delivery_end_date, row.last_ata_vessel_complete_discharge);
        }
      } else if (isOpen) {
        if (transport.startsWith('LAND')) {
          debugCounts.branchOpenLand += 1;
          if (row.last_trucking_daily_deliverable_date) debugCounts.haveLastTruckDeliverable += 1;
          if (!row.last_trucking_daily_deliverable_date) {
            debugCounts.missingCompletionDate += 1;
            pushSample('missingCompletionDate', String(row.contract_id || ''));
          }
          tradeCycle = diffCalendarDays(row.delivery_end_date, row.last_trucking_daily_deliverable_date);
        } else {
          debugCounts.branchOpenSea += 1;
          if (row.last_eta_vessel_complete_discharge) debugCounts.haveLastEtaDischarge += 1;
          if (!row.last_eta_vessel_complete_discharge) {
            debugCounts.missingCompletionDate += 1;
            pushSample('missingCompletionDate', String(row.contract_id || ''));
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

      // Log Cycle: Cargo Readiness → completion (closed) or open A/B end (today when ETA empty)
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
    // Helpful SQL context for debugging (kept small to avoid huge logs).
    try {
      const anyErr = error as any;
      const pos = typeof anyErr?.position === 'string' || typeof anyErr?.position === 'number' ? Number(anyErr.position) : null;
      if (pos && typeof queryText === 'string') {
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
    const { search, b2bFlag, dateFrom, dateTo, product, transportMode } = req.query as Record<string, string>;

    const params: any[] = [];

    // Row-level conditions (applied before GROUP BY — work on individual contract rows)
    const rowConditions: string[] = [];

    // Aggregate-level conditions (applied after GROUP BY — mirror getContracts filter logic)
    const aggConditions: string[] = [];

    if (search && search.trim().length >= 2) {
      params.push(`%${search.trim()}%`);
      const p = `$${params.length}`;
      rowConditions.push(`(c.contract_id ILIKE ${p} OR c.group_name ILIKE ${p})`);
    }

    if (dateFrom) {
      params.push(dateFrom);
      rowConditions.push(`c.contract_date >= $${params.length}`);
    }

    if (dateTo) {
      params.push(dateTo);
      rowConditions.push(`c.contract_date <= $${params.length}`);
    }

    // Summary alert cards always count Open contracts only (ignore global status filter from client).
    aggConditions.push(`(
      (base.spd_data->'contract'->>'status' = 'Open' OR UPPER(base.spd_data->'contract'->>'status') = 'ACTIVE')
      OR (base.spd_data IS NULL AND UPPER(base.raw_status) IN ('OPEN', 'ACTIVE'))
    )`);

    // B2B flag — use JSONB contract_type (same as getContracts)
    if (b2bFlag && b2bFlag !== 'ALL') {
      params.push(b2bFlag);
      aggConditions.push(`COALESCE(base.spd_data->'contract'->>'contract_type', base.spd_data->>'B2B Flag', '') = $${params.length}`);
    }

    // Product — ILIKE with wildcard (same as getContracts)
    if (product && product !== 'ALL') {
      params.push(`%${product.trim()}%`);
      aggConditions.push(`COALESCE(base.raw_product, '') ILIKE $${params.length}`);
    }

    // Transport mode — filter on effective_transport_mode (includes JSONB fallback)
    if (transportMode && transportMode.toUpperCase() !== 'ALL') {
      params.push(`${transportMode.toUpperCase()}%`);
      aggConditions.push(`UPPER(base.effective_transport_mode) LIKE $${params.length}`);
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
          MAX(c.product) AS raw_product,
          (array_agg(l.data ORDER BY l.created_at DESC NULLS LAST))[1] AS spd_data,
          COALESCE(NULLIF(TRIM(MAX(c.transport_mode)), ''), (array_agg(l.data ORDER BY l.created_at DESC NULLS LAST))[1]->'contract'->>'transport_mode', (array_agg(l.data ORDER BY l.created_at DESC NULLS LAST))[1]->'contract'->>'sea_land', (array_agg(l.data ORDER BY l.created_at DESC NULLS LAST))[1]->'raw'->>'Sea / Land', (array_agg(l.data ORDER BY l.created_at DESC NULLS LAST))[1]->'raw'->>'Sea_Land', '') AS effective_transport_mode
        FROM contracts c
        LEFT JOIN latest_spd l ON l.contract_number = c.contract_id
        ${rowWhereSql}
        GROUP BY c.contract_id
      ),
      filtered AS (
        SELECT * FROM base
        WHERE 1=1 ${aggWhereSql}
        AND NOT (
          UPPER(TRIM(COALESCE(
            base.spd_data->'contract'->>'contract_type',
            base.spd_data->>'B2B Flag',
            ''
          ))) = 'B2B'
          AND NULLIF(TRIM(COALESCE(
            base.spd_data->'contract'->>'contract_reference_po',
            base.spd_data->>'CONTRACT REFF PO',
            base.spd_data->>'Contract Reff PO Ini',
            base.spd_data->'raw'->>'Contract Reff PO Ini',
            base.spd_data->'raw'->>'CONTRACT REFF PO'
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
    res.json({
      success: true,
      data: {
        seaWithoutShipments: parseInt(String(row.sea_without_shipments), 10) || 0,
        landWithoutTrucking: parseInt(String(row.land_without_trucking), 10) || 0,
        mixWithoutLogistics: parseInt(String(row.mix_without_logistics), 10) || 0,
      },
    });
  } catch (error) {
    logger.error('Get unassigned counts error:', error);
    res.status(500).json({
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
      params.push(`%${search}%`);
      where += ` AND TRIM(buyer) ILIKE $${params.length}`;
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

export const getContract = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const result = await query('SELECT * FROM contracts WHERE id = $1', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: { message: 'Contract not found' },
      });
    }

    // Get related shipments
    const shipmentsResult = await query(
      'SELECT * FROM shipments WHERE contract_id = $1 ORDER BY created_at DESC',
      [id]
    );

    // Get related payments
    const paymentsResult = await query(
      'SELECT * FROM payments WHERE contract_id = $1 ORDER BY created_at DESC',
      [id]
    );

    return res.json({
      success: true,
      data: {
        contract: result.rows[0],
        shipments: shipmentsResult.rows,
        payments: paymentsResult.rows,
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
    const contractResult = await query('SELECT id, contract_id, delivery_end_date, transport_mode FROM contracts WHERE id = $1', [id]);
    if (contractResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: { message: 'Contract not found' } });
    }
    const contract = contractResult.rows[0];
    const deliveryEnd = contract.delivery_end_date ?? null;
    const transportMode = String(contract.transport_mode ?? '').trim().toUpperCase();
    const includeShipments =
      transportMode === '' || transportMode === 'SEA' || transportMode === 'MIX';
    const includeTrucking =
      transportMode === '' || transportMode === 'LAND' || transportMode === 'MIX';

    // Shipment STOs: group by effective STO (prefer contracts.sto_number, then latest SAP STO, then operation/shipment ids)
    const shipmentStosQuery = `
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
          spd.created_at
        FROM sap_processed_data spd
        WHERE spd.contract_number IS NOT NULL AND TRIM(spd.contract_number) != ''
        ORDER BY spd.contract_number, spd.created_at DESC NULLS LAST
      ),
      shipment_base AS (
        SELECT
          COALESCE(c.sto_number::text, l.effective_sto, s.operation_id, s.shipment_id) AS sto_key,
          MAX(COALESCE(c.sto_number::text, l.effective_sto)) AS sto_number,
          MAX(s.operation_id) AS operation_id,
          MAX(s.status) AS status,
          COALESCE(SUM(s.quantity_delivered), 0) AS quantity_delivered_db,
          MAX(s.vessel_name) AS vessel_name,
          MAX(s.ata_discharge_complete) AS ata_discharge_complete,
          MAX(s.eta_discharge_complete) AS eta_discharge_complete,
          MAX((SELECT vlp.eta_vessel_arrival::date FROM vessel_loading_ports vlp WHERE vlp.shipment_id = s.id AND vlp.is_discharge_port = false ORDER BY vlp.port_sequence ASC LIMIT 1)) AS eta_loading_port
        FROM shipments s
        LEFT JOIN contracts c ON s.contract_id = c.id
        LEFT JOIN latest_spd_contract l ON l.contract_number = c.contract_id
        WHERE s.contract_id = $1
        GROUP BY COALESCE(c.sto_number::text, l.effective_sto, s.operation_id, s.shipment_id)
      )
      SELECT
        sb.sto_key,
        sb.sto_number,
        sb.operation_id,
        sb.status,
        -- Prefer STO quantity from SAP (by STO), else from latest contract row quantity_ordered via contract UUID.
        COALESCE((
          SELECT SUM(NULLIF(regexp_replace(COALESCE(
            NULLIF(TRIM(spd.data->'contract'->>'sto_quantity'), ''),
            NULLIF(TRIM(spd.data->'shipment'->>'sto_quantity'), ''),
            NULLIF(TRIM(spd.data->'raw'->>'STO Quantity'), ''),
            NULLIF(TRIM(spd.data->'raw'->>'sto quantity'), ''),
            ''
          ), '[^0-9\\.-]', '', 'g'), '')::numeric)
          FROM sap_processed_data spd
          WHERE NULLIF(TRIM(COALESCE(spd.sto_number::text, spd.data->'raw'->>'STO No.', spd.data->'raw'->>'STO Number')), '') = TRIM(sb.sto_key::text)
        ), 0) AS sto_quantity,
        -- Quantities: if shipment row is synthetic (OP-SEA-*), pull from SAP by contract_number; otherwise from SAP by STO.
        COALESCE((
          SELECT SUM(NULLIF(regexp_replace(COALESCE(
            NULLIF(TRIM(spd.data->'raw'->>'Quantity Delivered'), ''),
            NULLIF(TRIM(spd.data->'raw'->>'Quantity Delivery'), ''),
            ''
          ), '[^0-9\\.-]', '', 'g'), '')::numeric)
          FROM sap_processed_data spd
          WHERE (
            (TRIM(sb.sto_key::text) ~ '^OP-SEA-' AND spd.contract_number = (SELECT contract_id FROM contracts WHERE id = $1))
            OR (NULLIF(TRIM(COALESCE(spd.sto_number::text, spd.data->'raw'->>'STO No.', spd.data->'raw'->>'STO Number')), '') = TRIM(sb.sto_key::text))
          )
        ), sb.quantity_delivered_db, 0) AS quantity_delivered,
        COALESCE((
          SELECT SUM(NULLIF(regexp_replace(COALESCE(
            NULLIF(TRIM(spd.data->'raw'->>'Quantity Receive'), ''),
            NULLIF(TRIM(spd.data->'raw'->>'Qty Receive'), ''),
            ''
          ), '[^0-9\\.-]', '', 'g'), '')::numeric)
          FROM sap_processed_data spd
          WHERE (
            (TRIM(sb.sto_key::text) ~ '^OP-SEA-' AND spd.contract_number = (SELECT contract_id FROM contracts WHERE id = $1))
            OR (NULLIF(TRIM(COALESCE(spd.sto_number::text, spd.data->'raw'->>'STO No.', spd.data->'raw'->>'STO Number')), '') = TRIM(sb.sto_key::text))
          )
        ), 0) AS quantity_receive,
        sb.vessel_name,
        sb.eta_loading_port AS eta_vessel_arrival_loading_port,
        sb.ata_discharge_complete,
        sb.eta_discharge_complete
      FROM shipment_base sb
      ORDER BY sb.sto_key
    `;
    const shipmentRows = includeShipments
      ? await query(shipmentStosQuery, [id])
      : { rows: [] };

    // Trucking STOs: prioritize operation_id / LAND SAP STO — never reuse vessel contracts.sto_number on SEA contracts
    const truckingStosQuery = `
      WITH land_sto_agg AS (
        SELECT
          x.contract_number,
          STRING_AGG(DISTINCT x.effective_sto, ', ' ORDER BY x.effective_sto) AS sto_numbers
        FROM (
          SELECT
            spd.contract_number,
            NULLIF(TRIM(COALESCE(
              spd.sto_number::text,
              spd.data->'raw'->>'STO No.',
              spd.data->'raw'->>'STO Number',
              spd.data->'shipment'->>'sto_no',
              spd.data->'contract'->>'sto_no'
            )), '') AS effective_sto,
            UPPER(TRIM(COALESCE(
              spd.data->'raw'->>'SEA / LAND',
              spd.data->'contract'->>'sea_land',
              spd.data->'contract'->>'transport_mode',
              ''
            ))) AS sea_land
          FROM sap_processed_data spd
          WHERE spd.contract_number IS NOT NULL AND TRIM(spd.contract_number) != ''
        ) x
        WHERE x.effective_sto IS NOT NULL AND x.effective_sto != ''
          AND x.sea_land LIKE 'LAND%'
        GROUP BY x.contract_number
      )
      SELECT
        COALESCE(
          NULLIF(TRIM(t.operation_id::text), ''),
          NULLIF(TRIM(lsa.sto_numbers), ''),
          CASE
            WHEN UPPER(TRIM(COALESCE(c.transport_mode, ''))) IN ('LAND', 'MIX')
            THEN NULLIF(TRIM(c.sto_number::text), '')
            ELSE NULL
          END,
          t.id::text
        ) AS sto_number,
        t.operation_id,
        t.status,
        c.quantity_ordered AS sto_quantity,
        COALESCE(t.quantity_delivered, 0) AS quantity_receive_db,
        COALESCE(t.quantity_delivered, 0) AS quantity_delivered_db,
        COALESCE((
          SELECT SUM(NULLIF(regexp_replace(COALESCE(
            NULLIF(TRIM(spd.data->'raw'->>'Quantity Receive'), ''),
            NULLIF(TRIM(spd.data->'raw'->>'Qty Receive'), ''),
            ''
          ), '[^0-9\\.-]', '', 'g'), '')::numeric)
          FROM sap_processed_data spd
          WHERE spd.contract_number = c.contract_id
        ), 0) AS quantity_receive_sap,
        COALESCE((
          SELECT SUM(NULLIF(regexp_replace(COALESCE(
            NULLIF(TRIM(spd.data->'raw'->>'Quantity Delivered'), ''),
            NULLIF(TRIM(spd.data->'raw'->>'Quantity Delivery'), ''),
            ''
          ), '[^0-9\\.-]', '', 'g'), '')::numeric)
          FROM sap_processed_data spd
          WHERE spd.contract_number = c.contract_id
        ), 0) AS quantity_delivered_sap,
        t.trucking_owner,
        t.eta_trucking_completion_date,
        COALESCE(t.trucking_completion_date, (
          SELECT NULLIF(TRIM(COALESCE(
            NULLIF(spd.data->>'trucking_last_receive_date', ''),
            NULLIF(spd.data->'raw'->>'Trucking Last Receive Date', ''),
            NULLIF(spd.data->'raw'->>'trucking last receive date', '')
          )), '')::date
          FROM sap_processed_data spd
          WHERE spd.contract_number = c.contract_id
            AND COALESCE(
              NULLIF(spd.data->>'trucking_last_receive_date', ''),
              NULLIF(spd.data->'raw'->>'Trucking Last Receive Date', ''),
              NULLIF(spd.data->'raw'->>'trucking last receive date', '')
            ) IS NOT NULL
          ORDER BY spd.created_at DESC
          LIMIT 1
        )) AS trucking_completion_date
      FROM trucking_operations t
      LEFT JOIN contracts c ON t.contract_id = c.id
      LEFT JOIN land_sto_agg lsa ON lsa.contract_number = c.contract_id
      WHERE t.contract_id = $1
      ORDER BY t.created_at DESC
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
        type: 'shipment',
        sto_number: r.sto_number || r.sto_key || '-',
        operation_id: r.operation_id || r.sto_key || null,
        late_indicator: lateIndicator,
        status: r.status || '-',
        sto_quantity: Number(r.sto_quantity) || 0,
        quantity_delivered: Number(r.quantity_delivered) || 0,
        quantity_receive: Number(r.quantity_receive) || 0,
        vessel_name: r.vessel_name || '-',
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
        type: 'trucking',
        sto_number: r.sto_number || '-',
        operation_id: r.operation_id || null,
        late_indicator: lateIndicator,
        status: r.status || '-',
        sto_quantity: Number(r.sto_quantity) || 0,
        quantity_receive: Number(r.quantity_receive_sap ?? r.quantity_receive_db) || 0,
        quantity_delivered: Number(r.quantity_delivered_sap ?? r.quantity_delivered_db) || 0,
        trucking_owner: r.trucking_owner || '-',
        eta_trucking_completion_date: r.eta_trucking_completion_date || null,
        trucking_completion_date: r.trucking_completion_date || null,
      };
    });

    const stos = [...shipmentStos, ...truckingStos];
    return res.json({ success: true, data: { stos } });
  } catch (error) {
    logger.error('Get contract STO information error:', error);
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch STO information' },
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
    const updates = req.body;

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
    return res.status(400).json({ success: false, error: { message: 'CSV must have columns: po_number, cargo_readiness_date' } });
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

