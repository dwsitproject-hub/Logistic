import { performance } from 'node:perf_hooks';
import { Response } from 'express';
import { query } from '../database/connection';
import { ensureUserStoContractAssignmentsTable } from '../database/ensureUserStoContractAssignments';
import { AuthRequest } from '../middleware/auth';
import logger from '../utils/logger';
import { runShippingPerformance, invalidateShippingPerformanceRowCache } from '../services/shippingPerformance.service';
import {
  buildShipmentListCacheKey,
  buildShipmentListFilterCacheKey,
  buildShipmentPipelineDailyFilterInput,
  buildShipmentSummaryCacheKey,
  invalidateShipmentsListCache,
  loadShipmentOutstandingQtyForRequest,
  loadShipmentSummaryBundle,
  normalizeShipmentListRows,
  resolveShipmentsListForRequest,
  seedShipmentListFilteredTotal,
  type ShipmentOutstandingQtySummary,
} from '../services/shipmentList.service';
import { EMPTY_SHIPMENT_OUTSTANDING_QTY_SUMMARY } from '../utils/shipmentOutstandingQtySummarySql';
import {
  isPipelineDailySummaryEligible,
  loadShipmentStagePageFromSnapshot,
  toPipelineDailySummaryScope,
} from '../services/pipelineDailySummary.service';
import {
  buildShipmentUnplannedHybridListContext,
  countUnplannedHybridBreakdown,
  isUnplannedHybridListRequest,
  resolveUnplannedHybridShipmentsList,
  type UnplannedHybridBreakdown,
} from '../services/shipmentUnplannedHybridList.service';
import { resolveShipmentEditContext } from '../services/shipmentEditContext.service';
import { resolveShipmentEditPayload } from '../services/shipmentEditPayload.service';
import { fetchStoSapPreview } from '../services/stoSapPreview.service';
import {
  cancelKlipShipmentGroup,
  KlipShipmentCancelError,
} from '../services/cancelKlipShipment.service';
import { syncVesselLoadingPortsFromLatestSap } from '../services/vesselLoadingPortsFromSap.service';
import { loadVesselIdleList } from '../services/vesselIdle.service';
import {
  attachPurchaseOrderToShipment,
  batchSaveShipmentPoPlanQty,
  listAvailablePurchaseOrdersForShipmentEdit,
} from '../services/shipmentPoAssignment.service';
import { normalizeAndValidateShipmentDailyDeliverables, parseDailyDeliverableQuantity } from '../utils/shipmentDailyDeliverables';
import { parsePlanningSheetToMatrix, toIsoDate10FromCell } from '../utils/planningSheetDate';
import { deriveShipmentStatus, SHIPMENT_PERSISTABLE_AUTO_STATUSES } from '../utils/shipmentStatus';
import {
  appendShipmentColumnFilters,
  appendShipmentEtaBucketFilters,
  appendShipmentGlobalSearch,
  appendShipmentLateIndicatorFilter,
  appendShipmentViewOptionFilter,
  normalizeShipmentEtaBucketParam,
  parseColumnFiltersQuery,
  shipmentEffectiveStatusExpr,
} from '../utils/shipmentListFilters';
import {
  SHIPMENT_BASE_CORE_GROUP_BY_MARKER,
  buildRankedStoCtes,
  buildResolvedStoKeyPageCtes,
  buildShipmentShellEnrichWithStoLinkAgg,
  canUseShipmentStageSnapshotPaging,
  canUseShipmentStoKeyPaging,
  injectShipmentStoKeyPaging,
} from '../utils/shipmentListStoPaging';
import {
  appendShipmentPipelineScopeStageFilter,
  appendShipmentPipelineStageFilter,
  normalizeShipmentPagePipelineStageParam,
  shipmentPagePipelineSummarySelectSql,
  shipmentPagePipelineUnplannedRowPredicate,
  shipmentPagePipelineVesselNamesSelectSql,
  shipmentPipelineVesselKeyExpr,
} from '../utils/shipmentPagePipelineSql';
import {
  buildUnplannedContractBacklogTableCountCte,
  appendContractScopeToolbarFilters,
} from '../utils/shipmentUnplannedHybridSql';
import { shipmentListSpdAggCtes } from '../utils/shipmentListSapAggSql';
import {
  sqlShipmentListDischargePortsKlipAgg,
  sqlShipmentListLoadingPortsKlipAgg,
} from '../utils/shipmentListPortsSql';
import {
  shipmentListQtyMoveCteFromPage,
} from '../utils/shipmentOutstandingQtySql';
import { shipmentListPageQtySelectSql } from '../utils/shipmentListQtySql';
import { buildContractDetailsForStoSql } from '../utils/contractDetailsForStoSql';
import {
  allocateNextSyntheticSequenceDefault,
  buildSyntheticOperationId,
  formatDDMMYYYY,
} from '../utils/operationId';
import { appendGroupPlantFilter, groupPlantExpr } from '../utils/groupPlantSql';
import {
  contractExtNoSubquery,
  resolvedDischargePortNameSql,
  resolvedLoadingPortNameSql,
  resolvedPlantCodeSql,
} from '../utils/portDisplaySql';
import { sqlUserStoQtyAssignedToKgSql, stoQtyAssignedMtToKg } from '../utils/userStoAssignmentQty';
import {
  buildShipmentExcludeStoTypeTSql,
  buildShipmentSeaMixTransportSql,
  shipmentListStoKeyExpr,
  shipmentListDisplayStoNumberExpr,
} from '../utils/shipmentStoTypeSql';
import {
  buildShipmentListAtaSelectSql,
  SHIPMENT_ATA_OVERRIDES_JOIN,
  sqlEffectiveAtaArrivalDischarge,
  sqlEffectiveAtaArrivalLoading,
  sqlEffectiveAtaBerthedDischarge,
  sqlEffectiveAtaBerthedLoading,
  sqlEffectiveAtaCompleteDischarge,
  sqlEffectiveAtaCompletedLoading,
  sqlEffectiveAtaSailedLoading,
  sqlEffectiveAtaStartDischarge,
  sqlEffectiveAtaStartLoading,
  sqlSapAtaArrivalDischarge,
  sqlSapAtaArrivalLoading,
  sqlSapAtaBerthedDischarge,
  sqlSapAtaBerthedLoading,
  sqlSapAtaCompleteDischarge,
  sqlSapAtaCompletedLoading,
  sqlSapAtaSailedLoading,
  sqlSapAtaStartDischarge,
  sqlSapAtaStartLoading,
} from '../utils/shipmentAtaOverrideSql';
import { hydrateShipmentInfoAtaGaps } from '../utils/shipmentAtaHydration';
import { sqlShipmentListPrimaryIdAgg } from '../utils/shipmentListPrimaryShipmentSql';
import { SQL_CONTRACT_IMPORT_STATUS, getContractImportStatusForShipment, sqlIsContractSapClosedExpr } from '../utils/contractDeliveryStatus';
import {
  buildStoLinkedContractCountSql,
  buildStoLinkedContractNumbersSql,
  buildStoLinkedPoNumbersSql,
  buildStoLinkedSuppliersSql,
  contractsOnStoSubquery,
} from '../utils/stoLinkedContractSql';
import {
  isOfficialSapStoNumber,
  officialSapStoHasRegisteredPlanning,
} from '../utils/sapStoShipmentPlanning';

/** Normalize date-like fields for shipments / loading ports (YYYY-MM-DD or null). */
function toShipmentDateOrNull(v: unknown): string | null {
  if (v == null || v === '') return null;
  const s = String(v).trim();
  if (!s) return null;
  const iso = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  if (iso) return iso[1];
  const dmy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (dmy) {
    const dd = dmy[1].padStart(2, '0');
    const mm = dmy[2].padStart(2, '0');
    const yyyy = dmy[3];
    return `${yyyy}-${mm}-${dd}`;
  }
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }
  return null;
}

let vesselLoadingPortHasCancelColumnCache: boolean | null = null;
async function vesselLoadingPortHasCancelColumn(): Promise<boolean> {
  if (vesselLoadingPortHasCancelColumnCache !== null) return vesselLoadingPortHasCancelColumnCache;
  try {
    const result = await query(
      `SELECT EXISTS (
         SELECT 1
         FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'vessel_loading_ports'
           AND column_name = 'is_cancelled'
       ) AS has_column`
    );
    vesselLoadingPortHasCancelColumnCache = Boolean(result.rows[0]?.has_column);
  } catch (error) {
    logger.warn('Unable to determine vessel_loading_ports cancellation column availability', { error });
    vesselLoadingPortHasCancelColumnCache = false;
  }
  return vesselLoadingPortHasCancelColumnCache;
}

let vesselLoadingPortHasCancelledByColumnCache: boolean | null = null;
async function vesselLoadingPortHasCancelledByColumn(): Promise<boolean> {
  if (vesselLoadingPortHasCancelledByColumnCache !== null) return vesselLoadingPortHasCancelledByColumnCache;
  try {
    const result = await query(
      `SELECT EXISTS (
         SELECT 1
         FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'vessel_loading_ports'
           AND column_name = 'cancelled_by_user_id'
       ) AS has_column`
    );
    vesselLoadingPortHasCancelledByColumnCache = Boolean(result.rows[0]?.has_column);
  } catch (error) {
    logger.warn('Unable to determine vessel_loading_ports cancelled_by_user_id column availability', { error });
    vesselLoadingPortHasCancelledByColumnCache = false;
  }
  return vesselLoadingPortHasCancelledByColumnCache;
}

const PURCHASE_ORDER_LINES_SQL = `
  SELECT
    c.id AS contract_row_id,
    c.contract_id,
    c.po_number,
    c.quantity_ordered,
    c.delivery_start_date,
    c.delivery_end_date,
    c.supplier,
    c.buyer,
    c.product,
    c.incoterm,
    c.transport_mode,
    ${resolvedPlantCodeSql('c.contract_id', 'c.po_number', 'c.plant_code')} AS plant_code,
    ${groupPlantExpr(resolvedPlantCodeSql('c.contract_id', 'c.po_number', 'c.plant_code'), 'c.company_name')} AS plant_site,
    ${contractExtNoSubquery('c.contract_id', 'c.po_number')} AS contract_ext_no,
    ${resolvedLoadingPortNameSql('c.contract_id')} AS port_of_loading,
    ${resolvedDischargePortNameSql('c.contract_id')} AS port_of_discharge,
    GREATEST(
      0,
      COALESCE(c.quantity_ordered, 0)::numeric
      - COALESCE((
          SELECT SUM(${sqlUserStoQtyAssignedToKgSql('u.sto_qty_assigned', 'c.quantity_ordered')})
          FROM user_sto_contract_assignments u
          WHERE u.contract_number = c.contract_id
            AND COALESCE(u.po_number, '') = COALESCE(c.po_number, '')
        ), 0)::numeric
    ) AS outstanding_quantity
  FROM contracts c
  WHERE c.contract_id = $1
  ORDER BY COALESCE(c.po_number, ''), c.created_at ASC
`;

async function fetchPurchaseOrderLines(contractId: string) {
  await ensureUserStoContractAssignmentsTable();
  const result = await query(PURCHASE_ORDER_LINES_SQL, [contractId]);
  return result.rows;
}

async function upsertPoQtyAssignment(
  assignmentKey: string,
  contractNumber: string,
  poNumber: string | null,
  qtyMt: number,
) {
  const poKey = poNumber ? String(poNumber).trim() : '';
  await query(
    `
    DELETE FROM user_sto_contract_assignments
    WHERE sto_number = $1
      AND contract_number = $2
      AND COALESCE(po_number, '') = $3
    `,
    [assignmentKey, contractNumber, poKey],
  );
  if (qtyMt > 0) {
    await query(
      `
      INSERT INTO user_sto_contract_assignments (sto_number, contract_number, po_number, sto_qty_assigned)
      VALUES ($1, $2, NULLIF($3, ''), $4::numeric)
      `,
      [assignmentKey, contractNumber, poKey || null, stoQtyAssignedMtToKg(qtyMt)],
    );
  }
}

/** pg text[] (or pre-parsed array) → sorted distinct display list. */
function normalizeVesselNameList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const names = [...new Set(raw.map((v) => String(v ?? '').trim()).filter(Boolean))];
  return names.sort((a, b) => a.localeCompare(b));
}

function shipmentListSummaryPayload(
  totalCount: number,
  summaryRow: Record<string, unknown>,
  unplannedBreakdown?: UnplannedHybridBreakdown | null,
  outstandingQty?: ShipmentOutstandingQtySummary | null,
) {
  const unplannedContractRows = unplannedBreakdown
    ? unplannedBreakdown.contractRows
    : Number(summaryRow.unplanned_contract_backlog_count || 0);
  const unplannedShipmentRows = unplannedBreakdown
    ? unplannedBreakdown.shipmentRows
    : Number(summaryRow.unplanned_shipment_execution_count || 0);
  const unplannedTableTotal = unplannedBreakdown
    ? unplannedBreakdown.totalTableRows
    : unplannedContractRows + unplannedShipmentRows;
  return {
    total: totalCount,
    status: {
      /** Matches hybrid Unplanned table row total (backlog + STO execution groups). */
      unplanned: unplannedTableTotal,
      planned: Number(summaryRow.planned_count || 0),
      atLoadingPort: Number(summaryRow.at_loading_port_count || 0),
      sailed: Number(summaryRow.sailed_count || 0),
      atDischargePort: Number(summaryRow.at_discharge_port_count || 0),
      completed: Number(summaryRow.completed_count || 0),
      cancelled: Number(summaryRow.cancelled_count || 0),
    },
    /** Sorted distinct non-blank vessel names per pipeline card (Section 1 rectangles). */
    statusVesselNames: {
      unplanned: normalizeVesselNameList(summaryRow.unplanned_vessel_names),
      planned: normalizeVesselNameList(summaryRow.planned_vessel_names),
      atLoadingPort: normalizeVesselNameList(summaryRow.at_loading_port_vessel_names),
      sailed: normalizeVesselNameList(summaryRow.sailed_vessel_names),
      atDischargePort: normalizeVesselNameList(summaryRow.at_discharge_port_vessel_names),
      completed: normalizeVesselNameList(summaryRow.completed_vessel_names),
      cancelled: normalizeVesselNameList(summaryRow.cancelled_vessel_names),
    },
    loadingPortBreakdown: {
      arrived: Number(summaryRow.loading_port_arrived_count || 0),
      berthed: Number(summaryRow.loading_port_berthed_count || 0),
      loading: Number(summaryRow.loading_port_loading_count || 0),
      completedLoading: Number(summaryRow.loading_port_completed_loading_count || 0),
    },
    dischargePortBreakdown: {
      arrived: Number(summaryRow.discharge_port_arrived_count || 0),
      berthed: Number(summaryRow.discharge_port_berthed_count || 0),
      unloading: Number(summaryRow.discharge_port_unloading_count || 0),
    },
    etaLoading: {
      moreThan7D: Number(summaryRow.eta_loading_more_than_7d || 0),
      dMinus2: Number(summaryRow.eta_loading_d_minus_2 || 0),
      d: Number(summaryRow.eta_loading_d || 0),
      delay: Number(summaryRow.eta_loading_delay || 0),
      noEta: Number(summaryRow.eta_loading_no_eta || 0),
    },
    etaDischarge: {
      moreThan7D: Number(summaryRow.eta_discharge_more_than_7d || 0),
      dMinus2: Number(summaryRow.eta_discharge_d_minus_2 || 0),
      d: Number(summaryRow.eta_discharge_d || 0),
      delay: Number(summaryRow.eta_discharge_delay || 0),
      noEta: Number(summaryRow.eta_discharge_no_eta || 0),
    },
    unplannedTable: {
      contractRows: unplannedContractRows,
      shipmentRows: unplannedShipmentRows,
      totalTableRows: unplannedTableTotal,
    },
    outstandingQty: outstandingQty ?? EMPTY_SHIPMENT_OUTSTANDING_QTY_SUMMARY,
  };
}

function shouldLogShipmentsTiming(): boolean {
  return process.env.LOG_SHIPMENTS_TIMING === '1' || process.env.NODE_ENV === 'development';
}

/** Safe positive integers for inline LIMIT/OFFSET (avoids $n placeholders before regex `$` in sto key SQL). */
function shipmentListLimitOffset(limit: unknown, page: unknown): { limit: number; offset: number } {
  const safeLimit = Math.max(1, Math.min(500, Number(limit) || 20));
  const safePage = Math.max(1, Number(page) || 1);
  return { limit: safeLimit, offset: (safePage - 1) * safeLimit };
}

function emitShipmentListTimings(
  res: Response,
  timingsMs: Record<string, number>,
  meta: Record<string, unknown>
): void {
  if (!shouldLogShipmentsTiming()) return;
  const parts: string[] = [];
  for (const [k, v] of Object.entries(timingsMs)) {
    if (typeof v === 'number' && Number.isFinite(v)) {
      const name = k.replace(/[^a-zA-Z0-9_-]/g, '_');
      parts.push(`${name};dur=${v.toFixed(1)}`);
    }
  }
  if (parts.length) {
    res.setHeader('Server-Timing', parts.join(', '));
  }
  logger.info('GET /shipments timings (ms)', { ...timingsMs, ...meta });
  const total = timingsMs.total ?? 0;
  if (total > 2000) {
    logger.warn('GET /shipments slower than 2s target', { totalMs: total, ...meta });
  }
}

export const getShipments = async (req: AuthRequest, res: Response) => {
  let debugSql: { text: string; params: any[] } | null = null;
  const timingsMs: Record<string, number> = {};
  const tReq0 = performance.now();
  try {
    const { status, vessel, port, dateFrom, dateTo, delayed, sto, contract, plant, page = 1, limit = 10 } = req.query;
    const globalSearch =
      typeof (req.query as any).search === 'string' ? (req.query as any).search.trim() : '';
    const colFilters = parseColumnFiltersQuery((req.query as any).columnFilters);
    const lateIndicatorParam = (req.query as any).lateIndicator as string | undefined;
    const viewOptionParam = (req.query as any).viewOption as string | undefined;
    const viewQueryParam = (req.query as any).viewQuery as string | undefined;
    const etaLoadingBucket = normalizeShipmentEtaBucketParam((req.query as any).etaLoading);
    const etaDischargeBucket = normalizeShipmentEtaBucketParam((req.query as any).etaDischarge);
    const scopeStatusParam =
      typeof (req.query as any).scopeStatus === 'string'
        ? (req.query as any).scopeStatus
        : undefined;
    const offset = (Number(page) - 1) * Number(limit);
    const compact = String((req.query as any).compact || '').toLowerCase() === 'true';
    const includeSummary =
      String((req.query as any).includeSummary ?? 'true').toLowerCase() !== 'false';
    const summaryOnly = String((req.query as any).summaryOnly || '').toLowerCase() === 'true';
    /** Skip heavy SAP table joins (compact list first paint; hydrate with a second request). */
    const skipSapJoin =
      compact &&
      String((req.query as any).skipSapJoin || '').toLowerCase() === 'true' &&
      !summaryOnly;

    // Query shipments grouped by STO number or Operation ID:
    // - SAP shipments are grouped by contracts.sto_number
    // - Manual shipments (no STO) are grouped by operation_id so that multiple contracts
    //   under the same operation appear as a single transaction in the UI
    // Base query for shipments grouped by STO/operation/shipment
    // IMPORTANT: status derivation depends on ATA ladder. Even in compact view, we must
    // fallback to vessel_loading_ports so rows don't incorrectly stay PLANNED.
    // Pre-join first loading / discharge port rows (avoids ~10 correlated subqueries per shipment row).
    const vlpCtes = `
      vlp_load_first AS (
        SELECT DISTINCT ON (shipment_id)
          shipment_id,
          ata_vessel_arrival::date AS vlp_load_ata_va,
          ata_vessel_berthed::date AS vlp_load_ata_vb,
          ata_loading_start::date AS vlp_load_ata_ls,
          ata_loading_completed::date AS vlp_load_ata_lc,
          ata_vessel_sailed::date AS vlp_load_ata_vs
        FROM vessel_loading_ports
        WHERE COALESCE(is_discharge_port, false) = false AND port_sequence = 1
        ORDER BY shipment_id, id
      ),
      vlp_disc_first AS (
        SELECT DISTINCT ON (shipment_id)
          shipment_id,
          ata_vessel_arrival::date AS vlp_disc_ata_va,
          ata_vessel_berthed::date AS vlp_disc_ata_vb,
          ata_loading_start::date AS vlp_disc_ata_ls,
          ata_loading_completed::date AS vlp_disc_ata_lc
        FROM vessel_loading_ports
        WHERE COALESCE(is_discharge_port, false) = true
        ORDER BY shipment_id, port_sequence NULLS LAST, id
      ),`;

    const ataSelect = buildShipmentListAtaSelectSql();

    const etaExtraSelect = compact
      ? `
          -- ETA discharge complete (compact): shipment-level only
          MAX(s.eta_discharge_complete) as eta_vessel_complete_discharge,`
      : `
          -- Get ETA dates from shipments or vessel_loading_ports
          MAX(COALESCE(s.eta_discharge_complete, (SELECT vlpd.eta_vessel_complete_discharge::date FROM vessel_loading_ports vlpd WHERE vlpd.shipment_id = s.id AND vlpd.is_discharge_port = true LIMIT 1))) as eta_vessel_complete_discharge,`;

    const listStoKeySql = shipmentListStoKeyExpr('c', 'l', 's');
    const listStoDisplaySql = shipmentListDisplayStoNumberExpr('c', 'l', 's');

    /** Grouped STO key on shipment_base rows (safe for scalar subqueries in the outer enrich CTE). */
    const groupedStoFromRow = `NULLIF(TRIM(g.sto_key::text), '')`;
    const stoLinkedContractNumbersSql = buildStoLinkedContractNumbersSql(
      groupedStoFromRow,
      'c',
      'g.contract_numbers_from_join',
    );
    const stoLinkedPoNumbersSql = buildStoLinkedPoNumbersSql(
      groupedStoFromRow,
      'c',
      'g.po_numbers_from_join',
    );
    const stoLinkedContractCountSql = buildStoLinkedContractCountSql(
      groupedStoFromRow,
      'c',
      'g.contract_count_from_join',
    );
    const stoLinkedSuppliersSql = buildStoLinkedSuppliersSql(
      groupedStoFromRow,
      'c',
      'g.suppliers',
    );

    const contractMetaSelectCore = `
          MAX(NULLIF(TRIM(COALESCE(l.contract_reference_po_raw, '')), '')) AS contract_reference_po,
          STRING_AGG(
            DISTINCT NULLIF(TRIM(COALESCE(l.contract_ext_no_raw, '')), ''),
            ', ' ORDER BY NULLIF(TRIM(COALESCE(l.contract_ext_no_raw, '')), '')
          ) FILTER (WHERE NULLIF(TRIM(COALESCE(l.contract_ext_no_raw, '')), '') IS NOT NULL) AS contract_ext_no_from_join,
          STRING_AGG(DISTINCT c.contract_id, ', ' ORDER BY c.contract_id)
            FILTER (WHERE c.contract_id IS NOT NULL) AS contract_numbers_from_join,
          STRING_AGG(DISTINCT c.po_number, ', ' ORDER BY c.po_number)
            FILTER (WHERE c.po_number IS NOT NULL AND TRIM(c.po_number) != '') AS po_numbers_from_join,
          COUNT(DISTINCT c.contract_id) FILTER (WHERE c.contract_id IS NOT NULL) AS contract_count_from_join`;

    const contractExtNoEnrichedSql = compact
      ? `CASE
            WHEN ${groupedStoFromRow} IS NOT NULL THEN
              COALESCE(
                (SELECT STRING_AGG(DISTINCT v, ', ' ORDER BY v)
                 FROM (
                   SELECT NULLIF(TRIM(COALESCE(l2.contract_ext_no_raw, '')), '') AS v
                   FROM contracts cc
                   LEFT JOIN latest_spd_contract l2 ON l2.contract_number = cc.contract_id
                   WHERE cc.contract_id IN (${contractsOnStoSubquery(groupedStoFromRow)})
                 ) ext
                 WHERE v IS NOT NULL AND v != ''),
                g.contract_ext_no_from_join
              )
            ELSE g.contract_ext_no_from_join
          END AS contract_ext_no`
      : `(SELECT COALESCE(
            spd.data->'raw'->>'Contract Ext No',
            spd.data->>'Contract Ext No'
          )
          FROM sap_processed_data spd
          WHERE TRIM(spd.sto_number::text) = TRIM(${groupedStoFromRow})
          ORDER BY spd.created_at DESC NULLS LAST
          LIMIT 1) AS contract_ext_no`;

    const shipmentBaseEnrichCte = `,
      shipment_base AS (
        SELECT
          g.*,
          ${stoLinkedContractNumbersSql} AS contract_numbers,
          ${stoLinkedPoNumbersSql} AS po_numbers,
          ${stoLinkedContractCountSql} AS contract_count,
          ${stoLinkedSuppliersSql} AS suppliers_linked,
          ${contractExtNoEnrichedSql}
        FROM shipment_base_core g
      )`;

    /** Fast path for compact shell rows — STO-linked contract/PO expansion without SAP agg CTEs. */
    const shipmentBaseShellEnrichCte = `,
      shipment_base AS (
        SELECT
          g.*,
          ${stoLinkedContractNumbersSql} AS contract_numbers,
          ${stoLinkedPoNumbersSql} AS po_numbers,
          ${stoLinkedContractCountSql} AS contract_count,
          g.contract_ext_no_from_join AS contract_ext_no,
          ${stoLinkedSuppliersSql} AS suppliers_linked
        FROM shipment_base_core g
      )`;

    const seaMixTransportCond = buildShipmentSeaMixTransportSql('c');
    const excludeStoTypeTCond = buildShipmentExcludeStoTypeTSql('c', 'l', 's');
    const stoIsSet = Boolean(sto && String(sto).trim() !== '');
    /** STO filter may depend on SAP effective_sto — keep full latest_spd scan in that case. */
    const scopeLatestSpdToContracts = !stoIsSet;

    const coreWhereParts: string[] = [seaMixTransportCond];
    /** Contract-only scope (date/plant/contract) reused by Unplanned open-contract count. */
    const contractScopeParts: string[] = [];
    const coreParams: any[] = [];
    let cp = 1;

    if (vessel) {
      coreWhereParts.push(`s.vessel_name ILIKE $${cp}`);
      coreParams.push(`%${vessel}%`);
      cp += 1;
    }
    if (port) {
      coreWhereParts.push(`(s.port_of_loading ILIKE $${cp} OR s.port_of_discharge ILIKE $${cp + 1})`);
      coreParams.push(`%${port}%`, `%${port}%`);
      cp += 2;
    }
    if (dateFrom) {
      coreWhereParts.push(`c.contract_date >= $${cp}`);
      contractScopeParts.push(`c.contract_date >= $${cp}`);
      coreParams.push(dateFrom);
      cp += 1;
    }
    if (dateTo) {
      coreWhereParts.push(`c.contract_date <= $${cp}`);
      contractScopeParts.push(`c.contract_date <= $${cp}`);
      coreParams.push(dateTo);
      cp += 1;
    }
    if (delayed === 'true') {
      coreWhereParts.push(`s.is_delayed = true`);
    }
    if (contract) {
      coreWhereParts.push(`c.contract_id = $${cp}`);
      contractScopeParts.push(`c.contract_id = $${cp}`);
      coreParams.push(contract);
      cp += 1;
    }
    const plantListRaw = Array.isArray(plant) ? plant : plant ? [plant] : [];
    const plants = plantListRaw.map((v) => String(v).trim()).filter(Boolean);
    const groupPlantFilter = appendGroupPlantFilter(
      plants,
      cp,
      groupPlantExpr('c.plant_code', 'c.company_name'),
      'c.plant_code',
    );
    if (groupPlantFilter.sql) {
      const plantSql = groupPlantFilter.sql.replace(/^ AND /, '');
      coreWhereParts.push(plantSql);
      contractScopeParts.push(plantSql);
      coreParams.push(...groupPlantFilter.params);
      cp = groupPlantFilter.nextIndex;
    }

    const contractToolbarFilter = appendContractScopeToolbarFilters(colFilters, cp);
    if (contractToolbarFilter.sql) {
      const toolbarSql = contractToolbarFilter.sql.replace(/^ AND /, '');
      coreWhereParts.push(toolbarSql);
      contractScopeParts.push(toolbarSql);
      coreParams.push(...contractToolbarFilter.params);
      cp = contractToolbarFilter.nextIndex;
    }

    const coreWhereSql = coreWhereParts.join(' AND ');
    const contractScopeSql =
      contractScopeParts.length > 0 ? `AND ${contractScopeParts.join(' AND ')}` : '';

    const latestSpdSelectList = `
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
          spd.created_at`;

    const prelude = scopeLatestSpdToContracts
      ? `WITH ${vlpCtes}
      relevant_contract_numbers AS (
        SELECT DISTINCT c.contract_id
        FROM shipments s
        INNER JOIN contracts c ON s.contract_id = c.id
        WHERE ${coreWhereSql}
      ),
      latest_spd_contract AS (
        ${latestSpdSelectList}
        FROM sap_processed_data spd
        INNER JOIN relevant_contract_numbers rc ON rc.contract_id = spd.contract_number
        WHERE spd.contract_number IS NOT NULL AND TRIM(spd.contract_number) != ''
        ORDER BY spd.contract_number, spd.created_at DESC NULLS LAST
      ),
      shipment_base_core AS (
        SELECT 
`
      : `WITH ${vlpCtes}
      latest_spd_contract AS (
        ${latestSpdSelectList}
        FROM sap_processed_data spd
        WHERE spd.contract_number IS NOT NULL AND TRIM(spd.contract_number) != ''
        ORDER BY spd.contract_number, spd.created_at DESC NULLS LAST
      ),
      shipment_base_core AS (
        SELECT 
`;

    let queryText = `${prelude}
          ${listStoKeySql} as sto_key,
          ${sqlShipmentListPrimaryIdAgg(listStoKeySql, 'c', 'l', 's', 'cs_sto')} as id,
          MAX(${listStoDisplaySql}) as sto_number,
          MAX(s.shipment_id) as shipment_id,
          MAX(s.operation_id) as operation_id,
          MAX(NULLIF(TRIM(s.vessel_name), '')) as vessel_name,
          MAX(NULLIF(TRIM(s.vessel_code), '')) as vessel_code,
          MAX(s.voyage_no) as voyage_no,
          MAX(s.vessel_owner) as vessel_owner,
          MAX(s.vessel_draft) as vessel_draft,
          MAX(s.vessel_loa) as vessel_loa,
          MAX(s.vessel_capacity) as vessel_capacity,
          MAX(s.vessel_hull_type) as vessel_hull_type,
          MAX(s.vessel_registration_year) as vessel_registration_year,
          MAX(s.charter_type) as charter_type,
          MAX(s.shipment_date) as shipment_date,
          MAX(s.arrival_date) as arrival_date,
          MAX(s.port_of_loading) as port_of_loading,
          MAX(s.port_of_discharge) as port_of_discharge,
          MAX(${groupPlantExpr('c.plant_code', 'c.company_name')}) as plant_site,
          -- Basic ETA loading dates at shipment level (kept in sync with first loading port)
          MAX(s.eta_arrival) as eta_arrival,
          MAX(s.eta_berthed) as eta_berthed,
          MAX(s.eta_loading_start) as eta_loading_start,
          MAX(s.eta_loading_complete) as eta_loading_complete,
          MAX(s.eta_sailed) as eta_sailed,
          -- Basic ETA discharge dates at shipment level
          MAX(s.eta_discharge_arrival) as eta_discharge_arrival,
          MAX(s.eta_discharge_berthed) as eta_discharge_berthed,
          MAX(s.eta_discharge_start) as eta_discharge_start,
          MAX(s.eta_discharge_complete) as eta_discharge_complete,
          COALESCE(SUM(s.quantity_shipped), 0) as quantity_shipped,
          COALESCE(SUM(s.quantity_delivered), 0) as quantity_delivered,
          COALESCE(SUM(s.quantity_delivered_klip), 0) as quantity_delivered_klip,
          COALESCE(SUM(s.inbound_weight), 0) as inbound_weight,
          COALESCE(SUM(s.outbound_weight), 0) as outbound_weight,
          COALESCE(AVG(s.gain_loss_percentage), 0) as gain_loss_percentage,
          COALESCE(SUM(s.gain_loss_amount), 0) as gain_loss_amount,
          MAX(s.estimated_km) as estimated_km,
          MAX(s.estimated_nautical_miles) as estimated_nautical_miles,
          MAX(s.vessel_oa_budget) as vessel_oa_budget,
          MAX(s.vessel_oa_actual) as vessel_oa_actual,
          MAX(s.bl_quantity) as bl_quantity,
          MAX(s.actual_vessel_qty_receive) as actual_vessel_qty_receive,
          MAX(s.sfal_qty) as sfal_qty,
          MAX(s.sfbd_qty) as sfbd_qty,
          MAX(s.difference_final_qty_vs_bl_qty) as difference_final_qty_vs_bl_qty,
          MAX(s.average_vessel_speed) as average_vessel_speed,
          MAX(s.status) as status,
          MAX(s.sla_days) as sla_days,
          BOOL_OR(s.is_delayed) as is_delayed,
          MAX(s.sap_delivery_id) as sap_delivery_id,
          MAX(s.created_at) as created_at,
          MAX(s.updated_at) as updated_at,
          MAX(c.supplier) as supplier,
          STRING_AGG(DISTINCT c.supplier, ', ' ORDER BY c.supplier) FILTER (WHERE c.supplier IS NOT NULL) as suppliers,
          MAX(c.buyer) as buyer,
          STRING_AGG(DISTINCT c.buyer, ', ' ORDER BY c.buyer) FILTER (WHERE c.buyer IS NOT NULL) as buyers,
          MAX(c.product) as product,
          STRING_AGG(DISTINCT c.product, ', ' ORDER BY c.product) FILTER (WHERE c.product IS NOT NULL) as products,
          MAX(c.incoterm) as incoterm,
          MAX(c.group_name) as group_name,
          STRING_AGG(DISTINCT c.group_name, ', ' ORDER BY c.group_name) FILTER (WHERE c.group_name IS NOT NULL) as group_names,
          -- Get delivery dates from contracts
          MAX(c.contract_date) as contract_date,
          MAX(c.delivery_start_date) as delivery_start_date,
          MAX(c.delivery_end_date) as delivery_end_date,
          BOOL_OR(${sqlIsContractSapClosedExpr('c')}) AS is_contract_sap_closed,
          ${sqlShipmentListLoadingPortsKlipAgg()},
          ${sqlShipmentListDischargePortsKlipAgg()},
${ataSelect}
${etaExtraSelect}
${contractMetaSelectCore}
        FROM shipments s
        LEFT JOIN contracts c ON s.contract_id = c.id
        LEFT JOIN latest_spd_contract l ON l.contract_number = c.contract_id
        LEFT JOIN contract_stos cs_sto ON cs_sto.contract_id = c.id
          AND NULLIF(TRIM(cs_sto.sto_number::text), '') IS NOT NULL
          AND TRIM(cs_sto.sto_number::text) = TRIM((${listStoKeySql})::text)
        LEFT JOIN vlp_load_first vlp_l ON vlp_l.shipment_id = s.id
        LEFT JOIN vlp_disc_first vlp_d ON vlp_d.shipment_id = s.id
        LEFT JOIN vessel_loading_ports vlp_load ON vlp_load.shipment_id = s.id
          AND COALESCE(vlp_load.is_discharge_port, false) = false
        LEFT JOIN vessel_loading_ports vlp_disc ON vlp_disc.shipment_id = s.id
          AND COALESCE(vlp_disc.is_discharge_port, false) = true
        ${SHIPMENT_ATA_OVERRIDES_JOIN}
        WHERE 1=1
          AND (${coreWhereSql})
          AND (${excludeStoTypeTCond})
          -- Match dashboard baseline: exclude B2B "child" contracts
          -- (latest SAP row indicates B2B AND Contract Reference PO is not blank).
          AND NOT (
            l.contract_number IS NOT NULL
            AND UPPER(NULLIF(TRIM(COALESCE(l.b2b_flag_raw, c.contract_type::text, '')), '')) = 'B2B'
            AND NULLIF(TRIM(COALESCE(l.contract_reference_po_raw, '')), '') IS NOT NULL
          )
    `;
    const queryParams: any[] = [...coreParams];
    let paramIndex = coreParams.length + 1;

    if (stoIsSet) {
      queryText += ` AND (
        TRIM(${listStoKeySql}) = TRIM($${paramIndex}::text)
        OR s.shipment_id = $${paramIndex}
        OR TRIM(COALESCE(s.operation_id::text, '')) = TRIM($${paramIndex}::text)
      )`;
      queryParams.push(sto);
      paramIndex++;
    }

    const innerParams = [...queryParams];
    const outerFilterStartIndex = paramIndex;

    // NOTE: We intentionally avoid per-row correlated subqueries into sap_processed_data here.
    // Those are extremely slow when sap_processed_data is large, causing the shipments page to hang.

    queryText += `
        ${SHIPMENT_BASE_CORE_GROUP_BY_MARKER} GROUP BY ${listStoKeySql}
      )${shipmentBaseEnrichCte}`;

    /** Full grouped dataset (expensive on large YTD). Used for summary aggregates. */
    const shipmentBaseCteSqlFull = queryText;
    /** Summary uses shell enrich (join aggregates only) — not full STO subqueries, not bare core. */
    const shipmentBaseCteSqlSummary = shipmentBaseCteSqlFull.replace(
      shipmentBaseEnrichCte,
      shipmentBaseShellEnrichCte,
    );
    const shipmentBaseCteSqlShell = shipmentBaseCteSqlFull.replace(
      shipmentBaseEnrichCte,
      shipmentBaseShellEnrichCte,
    );

    let fp = outerFilterStartIndex;
    const gSearch = appendShipmentGlobalSearch(globalSearch, fp);
    fp = gSearch.nextIndex;
    const cCol = appendShipmentColumnFilters(colFilters, fp);
    fp = cCol.nextIndex;
    const li = appendShipmentLateIndicatorFilter(lateIndicatorParam, fp);
    fp = li.nextIndex;
    const vo = appendShipmentViewOptionFilter(viewOptionParam, viewQueryParam, fp);
    fp = vo.nextIndex;
    const etaBuckets = appendShipmentEtaBucketFilters(etaLoadingBucket, etaDischargeBucket);
    const statusFilter = appendShipmentPipelineStageFilter(
      typeof status === 'string' ? status : undefined,
      fp,
    );
    fp = statusFilter.nextIndex;

    const toolbarOuterSql = `${gSearch.sql}${cCol.sql}${li.sql}${vo.sql}`;
    const cardOuterSql = `${etaBuckets.sql}${statusFilter.sql}`;
    const outerSql = `${toolbarOuterSql}${cardOuterSql}`;
    const outerParams = [
      ...gSearch.params,
      ...cCol.params,
      ...li.params,
      ...vo.params,
      ...statusFilter.params,
    ];
    const toolbarOuterParams = [...gSearch.params, ...cCol.params, ...li.params, ...vo.params];
    const toolbarCountParams = [...innerParams, ...toolbarOuterParams];

    const shipmentListFilterCacheKey = buildShipmentListFilterCacheKey({
      vessel,
      port,
      dateFrom,
      dateTo,
      delayed,
      sto,
      contract,
      plants,
      globalSearch,
      colFilters,
      lateIndicator: lateIndicatorParam,
      viewOption: viewOptionParam,
      viewQuery: viewQueryParam,
      status: typeof status === 'string' ? status : 'ALL',
      etaLoading: etaLoadingBucket ?? 'ALL',
      etaDischarge: etaDischargeBucket ?? 'ALL',
    });

    const isUnplannedHybridList = isUnplannedHybridListRequest(status);
    const listUsesStoPaging =
      compact &&
      !summaryOnly &&
      canUseShipmentStoKeyPaging({
        summaryOnly,
        stoIsSet,
        status: typeof status === 'string' ? status : 'ALL',
        etaLoading: etaLoadingBucket,
        etaDischarge: etaDischargeBucket,
        lateIndicator: lateIndicatorParam,
        globalSearch,
        colFilters,
        viewOption: viewOptionParam,
        viewQuery: viewQueryParam,
        unplannedHybrid: isUnplannedHybridList,
      });
    const { limit: listLimit, offset: listOffset } = shipmentListLimitOffset(limit, page);

    const rankedStoBlock = buildRankedStoCtes(listStoKeySql, coreWhereSql, excludeStoTypeTCond)
      .replace('__STO_PAGE_LIMIT__', String(listLimit))
      .replace('__STO_PAGE_OFFSET__', String(listOffset));

    const shellEnrichWithStoLink = buildShipmentShellEnrichWithStoLinkAgg();
    let shipmentBaseCteSqlList = compact
      ? shipmentBaseCteSqlShell
      : skipSapJoin
        ? shipmentBaseCteSqlShell
        : shipmentBaseCteSqlFull;

    if (listUsesStoPaging) {
      const pagingBase = skipSapJoin ? shipmentBaseCteSqlShell : shipmentBaseCteSqlFull;
      const injected = injectShipmentStoKeyPaging(pagingBase, listStoKeySql, rankedStoBlock);
      if (injected) {
        shipmentBaseCteSqlList = injected.replace(shipmentBaseShellEnrichCte, shellEnrichWithStoLink);
      }
    }

    /** If string replace failed, fall back to full scan (correctness over fast path). */
    let effectiveListStoPaging =
      listUsesStoPaging && shipmentBaseCteSqlList.includes('ranked_sto AS');
    if (listUsesStoPaging && !effectiveListStoPaging) {
      shipmentBaseCteSqlList = skipSapJoin ? shipmentBaseCteSqlShell : shipmentBaseCteSqlFull;
    }

    /**
     * Status-card list requests: page STO keys from the stage snapshot (same refresh
     * cycle as the status cards) so the expensive per-row derivation/enrichment runs
     * only for the visible page. Falls back to the live full-scan path whenever the
     * snapshot is stale or the request carries non-toolbar filters.
     */
    if (
      compact &&
      !summaryOnly &&
      !isUnplannedHybridList &&
      canUseShipmentStageSnapshotPaging({
        summaryOnly,
        stoIsSet,
        status: typeof status === 'string' ? status : 'ALL',
        etaLoading: etaLoadingBucket,
        etaDischarge: etaDischargeBucket,
        lateIndicator: lateIndicatorParam,
        globalSearch,
        colFilters,
        viewOption: viewOptionParam,
        viewQuery: viewQueryParam,
        unplannedHybrid: isUnplannedHybridList,
      })
    ) {
      const stageForSnapshot = normalizeShipmentPagePipelineStageParam(
        typeof status === 'string' ? status : undefined,
      );
      const dailyFilters = { ...buildShipmentPipelineDailyFilterInput(req), status: 'ALL' };
      if (stageForSnapshot && isPipelineDailySummaryEligible(dailyFilters)) {
        const snapshotPage = await loadShipmentStagePageFromSnapshot(
          toPipelineDailySummaryScope(dailyFilters),
          stageForSnapshot,
          listLimit,
          listOffset,
        );
        if (snapshotPage) {
          const pagingBase = skipSapJoin ? shipmentBaseCteSqlShell : shipmentBaseCteSqlFull;
          const injected = injectShipmentStoKeyPaging(
            pagingBase,
            listStoKeySql,
            buildResolvedStoKeyPageCtes(snapshotPage.stoKeys),
          );
          if (injected) {
            shipmentBaseCteSqlList = injected.replace(
              shipmentBaseShellEnrichCte,
              shellEnrichWithStoLink,
            );
            effectiveListStoPaging = true;
            seedShipmentListFilteredTotal(shipmentListFilterCacheKey, snapshotPage.total);
          }
        }
      }
    }

    const shipmentBaseCteForList = effectiveListStoPaging
      ? shipmentBaseCteSqlList
      : compact
        ? shipmentBaseCteSqlShell
        : skipSapJoin
          ? shipmentBaseCteSqlShell
          : shipmentBaseCteSqlFull;

    const summaryScopeFilter = appendShipmentPipelineScopeStageFilter(
      summaryOnly ? scopeStatusParam : undefined,
      1,
    );
    const summaryScopeCte =
      summaryOnly && summaryScopeFilter.sql.trim().length > 0
        ? `,
      scoped_shipments AS (
        SELECT sb.*
        FROM filtered_shipments sb
        WHERE 1=1 ${summaryScopeFilter.sql}
      )`
        : '';
    const summaryEnrichedFrom =
      summaryOnly && summaryScopeFilter.sql.trim().length > 0
        ? 'scoped_shipments'
        : 'filtered_shipments';
    const summaryScopeParams = summaryOnly ? summaryScopeFilter.params : [];
    /** Section 1 summary cards always use toolbar scope (exclude status / ETA card filters). */
    const section1SummaryFilterSql = toolbarOuterSql;
    const section1SummaryFilterParams = toolbarCountParams;

    /** Unplanned card + table share this hybrid breakdown (toolbar scope, backlog filters, execution predicate). */
    const section1UnplannedHybridCtx = buildShipmentUnplannedHybridListContext({
      shipmentBaseCteSql: shipmentBaseCteSqlSummary,
      toolbarOuterSql,
      innerParams,
      toolbarOuterParams,
      skipSapJoin: true,
      filterCacheKey: shipmentListFilterCacheKey,
      contractScope: { dateFrom, dateTo, contract, plants },
      globalSearch,
      colFilters,
    });
    const loadSection1UnplannedBreakdown = () =>
      countUnplannedHybridBreakdown(section1UnplannedHybridCtx);

    const loadSection1OutstandingQty = () =>
      loadShipmentOutstandingQtyForRequest(req, {
        shipmentBaseCteSql: shipmentBaseCteSqlSummary,
        toolbarOuterSql: section1SummaryFilterSql,
        innerParams,
        toolbarOuterParams,
        filterCacheKey: shipmentListFilterCacheKey,
      });

    const summaryCountQuery = `${shipmentBaseCteSqlSummary}
      ${buildUnplannedContractBacklogTableCountCte(contractScopeSql)}
      , filtered_shipments AS (
        SELECT sb.*
        FROM shipment_base sb
        WHERE 1=1 ${section1SummaryFilterSql}
      )${summaryScopeCte}
      , enriched AS (
        SELECT
          f.*,
          ${shipmentEffectiveStatusExpr('f')} AS effective_status,
          (
            f.eta_arrival IS NULL AND f.eta_berthed IS NULL AND f.eta_loading_start IS NULL AND f.eta_loading_complete IS NULL AND f.eta_sailed IS NULL
          ) AS loading_no_eta,
          (
            (f.eta_arrival IS NOT NULL AND (f.eta_arrival::date - CURRENT_DATE) < 0) OR
            (f.eta_berthed IS NOT NULL AND (f.eta_berthed::date - CURRENT_DATE) < 0) OR
            (f.eta_loading_start IS NOT NULL AND (f.eta_loading_start::date - CURRENT_DATE) < 0) OR
            (f.eta_loading_complete IS NOT NULL AND (f.eta_loading_complete::date - CURRENT_DATE) < 0) OR
            (f.eta_sailed IS NOT NULL AND (f.eta_sailed::date - CURRENT_DATE) < 0)
          ) AS loading_delay,
          (
            (f.eta_arrival IS NOT NULL AND (f.eta_arrival::date - CURRENT_DATE) = 0) OR
            (f.eta_berthed IS NOT NULL AND (f.eta_berthed::date - CURRENT_DATE) = 0) OR
            (f.eta_loading_start IS NOT NULL AND (f.eta_loading_start::date - CURRENT_DATE) = 0) OR
            (f.eta_loading_complete IS NOT NULL AND (f.eta_loading_complete::date - CURRENT_DATE) = 0) OR
            (f.eta_sailed IS NOT NULL AND (f.eta_sailed::date - CURRENT_DATE) = 0)
          ) AS loading_d,
          (
            (f.eta_arrival IS NOT NULL AND (f.eta_arrival::date - CURRENT_DATE) BETWEEN 1 AND 2) OR
            (f.eta_berthed IS NOT NULL AND (f.eta_berthed::date - CURRENT_DATE) BETWEEN 1 AND 2) OR
            (f.eta_loading_start IS NOT NULL AND (f.eta_loading_start::date - CURRENT_DATE) BETWEEN 1 AND 2) OR
            (f.eta_loading_complete IS NOT NULL AND (f.eta_loading_complete::date - CURRENT_DATE) BETWEEN 1 AND 2) OR
            (f.eta_sailed IS NOT NULL AND (f.eta_sailed::date - CURRENT_DATE) BETWEEN 1 AND 2)
          ) AS loading_d_minus_2,
          (
            (f.eta_arrival IS NOT NULL AND (f.eta_arrival::date - CURRENT_DATE) > 7) OR
            (f.eta_berthed IS NOT NULL AND (f.eta_berthed::date - CURRENT_DATE) > 7) OR
            (f.eta_loading_start IS NOT NULL AND (f.eta_loading_start::date - CURRENT_DATE) > 7) OR
            (f.eta_loading_complete IS NOT NULL AND (f.eta_loading_complete::date - CURRENT_DATE) > 7) OR
            (f.eta_sailed IS NOT NULL AND (f.eta_sailed::date - CURRENT_DATE) > 7)
          ) AS loading_more_than_7d,
          (
            f.eta_discharge_arrival IS NULL AND f.eta_discharge_berthed IS NULL AND f.eta_discharge_start IS NULL AND f.eta_vessel_complete_discharge IS NULL
          ) AS discharge_no_eta,
          (
            (f.eta_discharge_arrival IS NOT NULL AND (f.eta_discharge_arrival::date - CURRENT_DATE) < 0) OR
            (f.eta_discharge_berthed IS NOT NULL AND (f.eta_discharge_berthed::date - CURRENT_DATE) < 0) OR
            (f.eta_discharge_start IS NOT NULL AND (f.eta_discharge_start::date - CURRENT_DATE) < 0) OR
            (f.eta_vessel_complete_discharge IS NOT NULL AND (f.eta_vessel_complete_discharge::date - CURRENT_DATE) < 0)
          ) AS discharge_delay,
          (
            (f.eta_discharge_arrival IS NOT NULL AND (f.eta_discharge_arrival::date - CURRENT_DATE) = 0) OR
            (f.eta_discharge_berthed IS NOT NULL AND (f.eta_discharge_berthed::date - CURRENT_DATE) = 0) OR
            (f.eta_discharge_start IS NOT NULL AND (f.eta_discharge_start::date - CURRENT_DATE) = 0) OR
            (f.eta_vessel_complete_discharge IS NOT NULL AND (f.eta_vessel_complete_discharge::date - CURRENT_DATE) = 0)
          ) AS discharge_d,
          (
            (f.eta_discharge_arrival IS NOT NULL AND (f.eta_discharge_arrival::date - CURRENT_DATE) BETWEEN 1 AND 2) OR
            (f.eta_discharge_berthed IS NOT NULL AND (f.eta_discharge_berthed::date - CURRENT_DATE) BETWEEN 1 AND 2) OR
            (f.eta_discharge_start IS NOT NULL AND (f.eta_discharge_start::date - CURRENT_DATE) BETWEEN 1 AND 2) OR
            (f.eta_vessel_complete_discharge IS NOT NULL AND (f.eta_vessel_complete_discharge::date - CURRENT_DATE) BETWEEN 1 AND 2)
          ) AS discharge_d_minus_2,
          (
            (f.eta_discharge_arrival IS NOT NULL AND (f.eta_discharge_arrival::date - CURRENT_DATE) > 7) OR
            (f.eta_discharge_berthed IS NOT NULL AND (f.eta_discharge_berthed::date - CURRENT_DATE) > 7) OR
            (f.eta_discharge_start IS NOT NULL AND (f.eta_discharge_start::date - CURRENT_DATE) > 7) OR
            (f.eta_vessel_complete_discharge IS NOT NULL AND (f.eta_vessel_complete_discharge::date - CURRENT_DATE) > 7)
          ) AS discharge_more_than_7d
        FROM ${summaryEnrichedFrom} f
      )
      SELECT
        COUNT(*)::bigint AS total_count,
        ${shipmentPagePipelineSummarySelectSql()},
        ${shipmentPagePipelineVesselNamesSelectSql()},
        ARRAY_AGG(DISTINCT ${shipmentPipelineVesselKeyExpr('e.vessel_name')}) FILTER (WHERE ${shipmentPagePipelineUnplannedRowPredicate('e')} AND ${shipmentPipelineVesselKeyExpr('e.vessel_name')} IS NOT NULL) AS unplanned_vessel_names,
        (SELECT backlog_count FROM unplanned_contract_backlog_table)::bigint AS unplanned_contract_backlog_count,
        COUNT(*) FILTER (WHERE ${shipmentPagePipelineUnplannedRowPredicate('e')})::bigint AS unplanned_shipment_execution_count,
        COUNT(*) FILTER (WHERE effective_status IN ('UNPLANNED', 'PLANNED', 'ARRIVED_LP', 'BERTHED_LP', 'LOADING', 'COMPLETED_LOADING') AND loading_no_eta)::bigint AS eta_loading_no_eta,
        COUNT(*) FILTER (WHERE effective_status IN ('UNPLANNED', 'PLANNED', 'ARRIVED_LP', 'BERTHED_LP', 'LOADING', 'COMPLETED_LOADING') AND NOT loading_no_eta AND loading_delay)::bigint AS eta_loading_delay,
        COUNT(*) FILTER (WHERE effective_status IN ('UNPLANNED', 'PLANNED', 'ARRIVED_LP', 'BERTHED_LP', 'LOADING', 'COMPLETED_LOADING') AND NOT loading_no_eta AND NOT loading_delay AND loading_d)::bigint AS eta_loading_d,
        COUNT(*) FILTER (WHERE effective_status IN ('UNPLANNED', 'PLANNED', 'ARRIVED_LP', 'BERTHED_LP', 'LOADING', 'COMPLETED_LOADING') AND NOT loading_no_eta AND NOT loading_delay AND NOT loading_d AND loading_d_minus_2)::bigint AS eta_loading_d_minus_2,
        COUNT(*) FILTER (WHERE effective_status IN ('UNPLANNED', 'PLANNED', 'ARRIVED_LP', 'BERTHED_LP', 'LOADING', 'COMPLETED_LOADING') AND NOT loading_no_eta AND NOT loading_delay AND NOT loading_d AND NOT loading_d_minus_2 AND loading_more_than_7d)::bigint AS eta_loading_more_than_7d,
        COUNT(*) FILTER (WHERE effective_status IN ('SAILED', 'ARRIVED_DP', 'BERTHED_DP', 'UNLOADING') AND discharge_no_eta)::bigint AS eta_discharge_no_eta,
        COUNT(*) FILTER (WHERE effective_status IN ('SAILED', 'ARRIVED_DP', 'BERTHED_DP', 'UNLOADING') AND NOT discharge_no_eta AND discharge_delay)::bigint AS eta_discharge_delay,
        COUNT(*) FILTER (WHERE effective_status IN ('SAILED', 'ARRIVED_DP', 'BERTHED_DP', 'UNLOADING') AND NOT discharge_no_eta AND NOT discharge_delay AND discharge_d)::bigint AS eta_discharge_d,
        COUNT(*) FILTER (WHERE effective_status IN ('SAILED', 'ARRIVED_DP', 'BERTHED_DP', 'UNLOADING') AND NOT discharge_no_eta AND NOT discharge_delay AND NOT discharge_d AND discharge_d_minus_2)::bigint AS eta_discharge_d_minus_2,
        COUNT(*) FILTER (WHERE effective_status IN ('SAILED', 'ARRIVED_DP', 'BERTHED_DP', 'UNLOADING') AND NOT discharge_no_eta AND NOT discharge_delay AND NOT discharge_d AND NOT discharge_d_minus_2 AND discharge_more_than_7d)::bigint AS eta_discharge_more_than_7d
      FROM enriched e`;

    if (compact && summaryOnly) {
      const summaryCacheKey = buildShipmentSummaryCacheKey(
        shipmentListFilterCacheKey,
        scopeStatusParam,
      );
      const tSum0 = performance.now();
      const [summaryBundle, outstandingQty] = await Promise.all([
        loadShipmentSummaryBundle(req, {
          summaryCountQuery,
          params: [...section1SummaryFilterParams, ...summaryScopeParams],
          cacheKey: summaryCacheKey,
          loadUnplannedBreakdown: loadSection1UnplannedBreakdown,
        }),
        loadSection1OutstandingQty(),
      ]);
      const { summaryRow: sr, totalCount: tc, unplannedBreakdown: unplannedBreakdownForSummary, source: summarySource } =
        summaryBundle;
      timingsMs.dbSummaryOnly = performance.now() - tSum0;
      timingsMs.total = performance.now() - tReq0;
      emitShipmentListTimings(res, timingsMs, {
        path: summarySource === 'daily' ? 'summaryOnly-compact-daily' : 'summaryOnly-compact-sql',
        compact,
        page: Number(page),
        limit: Number(limit),
        summaryCacheKey,
        summarySource,
      });
      return res.json({
        success: true,
        data: {
          shipments: [],
          summary: shipmentListSummaryPayload(tc, sr, unplannedBreakdownForSummary, outstandingQty),
          pagination: {
            total: tc,
            page: Number(page),
            limit: Number(limit),
            totalPages: Math.ceil(tc / Number(limit)) || 0,
          },
        },
      });
    }

    if (compact) {
      const filterCacheKey = shipmentListFilterCacheKey;
      const cacheKey = buildShipmentListCacheKey({
        vessel,
        port,
        dateFrom,
        dateTo,
        delayed,
        sto,
        contract,
        plants,
        globalSearch,
        colFilters,
        lateIndicator: lateIndicatorParam,
        viewOption: viewOptionParam,
        viewQuery: viewQueryParam,
        skipSapJoin,
        page: Number(page),
        limit: Number(limit),
        status: typeof status === 'string' ? status : 'ALL',
        etaLoading: etaLoadingBucket ?? 'ALL',
        etaDischarge: etaDischargeBucket ?? 'ALL',
      });

      if (isUnplannedHybridListRequest(status)) {
        const hybrid = await resolveUnplannedHybridShipmentsList(req, {
          shipmentCtx: {
            shipmentBaseCteSql: shipmentBaseCteForList,
            outerSql,
            innerParams,
            outerParams,
            skipSapJoin,
            cacheKey: `${cacheKey}:hybrid`,
            filterCacheKey,
            usesStoKeyPaging: effectiveListStoPaging,
            tableStatusFilter: typeof status === 'string' ? status : undefined,
          },
          contractScope: {
            dateFrom,
            dateTo,
            contract,
            plants,
          },
          globalSearch,
          colFilters,
        });
        let hybridSummary: ReturnType<typeof shipmentListSummaryPayload> | undefined;
        if (includeSummary) {
          const summaryCacheKey = buildShipmentSummaryCacheKey(
            shipmentListFilterCacheKey,
            scopeStatusParam,
          );
          const summaryBundle = await loadShipmentSummaryBundle(req, {
            summaryCountQuery,
            params: [...section1SummaryFilterParams, ...summaryScopeParams],
            cacheKey: summaryCacheKey,
            loadUnplannedBreakdown: loadSection1UnplannedBreakdown,
          });
          hybridSummary = shipmentListSummaryPayload(
            summaryBundle.totalCount,
            summaryBundle.summaryRow,
            hybrid.unplannedBreakdown,
          );
        }
        timingsMs.total = performance.now() - tReq0;
        emitShipmentListTimings(res, timingsMs, {
          path: 'list-unplanned-hybrid',
          compact,
          skipSapJoin,
          includeSummary,
          page: Number(page),
          limit: Number(limit),
          rowCount: hybrid.shipments.length,
          contractRows: hybrid.unplannedBreakdown.contractRows,
          shipmentRows: hybrid.unplannedBreakdown.shipmentRows,
        });
        return res.json({
          success: true,
          data: {
            shipments: hybrid.shipments,
            pagination: hybrid.pagination,
            unplannedBreakdown: hybrid.unplannedBreakdown,
            ...(hybridSummary ? { summary: hybridSummary } : {}),
          },
        });
      }

      if (includeSummary) {
        const summaryCacheKey = buildShipmentSummaryCacheKey(
          shipmentListFilterCacheKey,
          scopeStatusParam,
        );
        const loadSummaryBundle = () =>
          loadShipmentSummaryBundle(req, {
            summaryCountQuery,
            params: [...section1SummaryFilterParams, ...summaryScopeParams],
            cacheKey: summaryCacheKey,
            loadUnplannedBreakdown: loadSection1UnplannedBreakdown,
          });

        const [data, summaryBundle] = await Promise.all([
          resolveShipmentsListForRequest(req, {
            shipmentBaseCteSql: shipmentBaseCteForList,
            outerSql,
            innerParams,
            outerParams,
            skipSapJoin,
            cacheKey,
            filterCacheKey,
            usesStoKeyPaging: effectiveListStoPaging,
            tableStatusFilter: typeof status === 'string' ? status : undefined,
          }),
          loadSummaryBundle(),
        ]);
        const {
          summaryRow: sr,
          totalCount: tc,
          unplannedBreakdown: unplannedBreakdownForSummary,
          source: summarySource,
        } = summaryBundle;
        timingsMs.total = performance.now() - tReq0;
        emitShipmentListTimings(res, timingsMs, {
          path:
            summarySource === 'daily'
              ? skipSapJoin
                ? 'list-page-shell-with-summary-daily'
                : 'list-page-sap-with-summary-daily'
              : skipSapJoin
                ? 'list-page-shell-with-summary'
                : 'list-page-sap-with-summary',
          compact,
          skipSapJoin,
          includeSummary,
          effectiveListStoPaging,
          page: Number(page),
          limit: Number(limit),
          rowCount: data.shipments.length,
          cacheKey,
          summarySource,
        });
        return res.json({
          success: true,
          data: {
            ...data,
            summary: shipmentListSummaryPayload(tc, sr, unplannedBreakdownForSummary),
          },
        });
      }

      const data = await resolveShipmentsListForRequest(req, {
        shipmentBaseCteSql: shipmentBaseCteForList,
        outerSql,
        innerParams,
        outerParams,
        skipSapJoin,
        cacheKey,
        filterCacheKey,
        usesStoKeyPaging: effectiveListStoPaging,
        tableStatusFilter: typeof status === 'string' ? status : undefined,
      });
      timingsMs.total = performance.now() - tReq0;
      emitShipmentListTimings(res, timingsMs, {
        path: skipSapJoin
          ? effectiveListStoPaging
            ? 'list-page-shell-sto-paging'
            : 'list-page-shell'
          : effectiveListStoPaging
            ? 'list-page-sap-sto-paging'
            : 'list-page-sap',
        compact,
        skipSapJoin,
        effectiveListStoPaging,
        page: Number(page),
        limit: Number(limit),
        rowCount: data.shipments.length,
        cacheKey,
      });
      return res.json({
        success: true,
        data,
      });
    }

    if (summaryOnly) {
      const summaryCacheKey = buildShipmentSummaryCacheKey(
        shipmentListFilterCacheKey,
        scopeStatusParam,
      );
      const tSum0 = performance.now();
      const [summaryBundle, outstandingQty] = await Promise.all([
        loadShipmentSummaryBundle(req, {
          summaryCountQuery,
          params: [...section1SummaryFilterParams, ...summaryScopeParams],
          cacheKey: summaryCacheKey,
          loadUnplannedBreakdown: loadSection1UnplannedBreakdown,
        }),
        loadSection1OutstandingQty(),
      ]);
      const {
        summaryRow: sr,
        totalCount: tc,
        unplannedBreakdown: unplannedBreakdownForSummary,
        source: summarySource,
      } = summaryBundle;
      timingsMs.dbSummaryOnly = performance.now() - tSum0;
      timingsMs.total = performance.now() - tReq0;
      emitShipmentListTimings(res, timingsMs, {
        path: summarySource === 'daily' ? 'summaryOnly-daily' : 'summaryOnly',
        compact,
        skipSapJoin,
        effectiveListStoPaging,
        page: Number(page),
        limit: Number(limit),
        summaryCacheKey,
        summarySource,
      });
      return res.json({
        success: true,
        data: {
          shipments: [],
          summary: shipmentListSummaryPayload(tc, sr, unplannedBreakdownForSummary, outstandingQty),
          pagination: {
            total: tc,
            page: Number(page),
            limit: Number(limit),
            totalPages: Math.ceil(tc / Number(limit)) || 0,
          },
        },
      });
    }

    const shipmentPageCte = effectiveListStoPaging
      ? `shipment_page AS (
        SELECT
          fs.*,
          (SELECT COUNT(*)::bigint FROM ranked_sto) AS __filter_total
        FROM filtered_shipments fs
        ORDER BY fs.created_at DESC
      )`
      : `shipment_page AS (
        SELECT
          fs.*,
          (SELECT COUNT(*)::bigint FROM filtered_shipments) AS __filter_total
        FROM filtered_shipments fs
        ORDER BY fs.created_at DESC
        LIMIT $${fp} OFFSET $${fp + 1}
      )`;

    const spdAggCtes = shipmentListSpdAggCtes(skipSapJoin);

    queryText = `${shipmentBaseCteSqlList},
      filtered_shipments AS (
        SELECT sb.*
        FROM shipment_base sb
        WHERE 1=1 ${outerSql}
      ),
      ${shipmentPageCte},
      ${shipmentListQtyMoveCteFromPage()},
      ${spdAggCtes}
      SELECT 
        sp.*,
        ${shipmentListPageQtySelectSql('sp')},
        COALESCE(
          NULLIF(TRIM(slpa.sap_loading_ports), ''),
          NULLIF(TRIM(sp.loading_ports_klip), ''),
          NULLIF(TRIM(sp.port_of_loading), '')
        ) AS loading_ports,
        COALESCE(
          NULLIF(TRIM(sdpa.sap_discharge_ports), ''),
          NULLIF(TRIM(sp.discharge_ports_klip), ''),
          NULLIF(TRIM(sp.port_of_discharge), '')
        ) AS discharge_ports,
        slpa.sap_loading_ports,
        sdpa.sap_discharge_ports,
        NULLIF(TRIM(slpa.sap_loading_ports), '') AS sap_vessel_loading_port_1,
        NULLIF(TRIM(sdpa.sap_discharge_ports), '') AS sap_vessel_discharge_port,
        COALESCE(sl.incoterm, sp.incoterm) AS incoterm,
        sl.b2b_flag AS b2b_flag,
        sl.source_type AS source_type,
        COALESCE(cex.contract_ext_no, sp.contract_ext_no) AS contract_ext_no_merged,
        COALESCE(NULLIF(TRIM(pna.po_numbers), ''), sp.po_numbers) AS po_numbers_merged,
        sl.vessel_name_sap,
        sl.vessel_code_sap,
        sl.vessel_owner_sap
      FROM shipment_page sp
      LEFT JOIN sto_metrics sm ON TRIM(sm.sto_key::text) = TRIM(sp.sto_key::text)
      LEFT JOIN sap_agg sa ON TRIM(sa.sto_key::text) = TRIM(sp.sto_key::text)
      LEFT JOIN sap_latest sl ON TRIM(sl.sto_key::text) = TRIM(sp.sto_key::text)
      LEFT JOIN sap_loading_ports_agg slpa ON TRIM(slpa.sto_key::text) = TRIM(sp.sto_key::text)
      LEFT JOIN sap_discharge_ports_agg sdpa ON TRIM(sdpa.sto_key::text) = TRIM(sp.sto_key::text)
      LEFT JOIN contract_ext_agg cex ON TRIM(cex.sto_key::text) = TRIM(sp.sto_key::text)
      LEFT JOIN po_numbers_agg pna ON TRIM(pna.sto_key::text) = TRIM(sp.sto_key::text)`;
    const mainParams = [...innerParams, ...outerParams, Number(limit), offset];

    debugSql = { text: queryText, params: mainParams };
    const tMain0 = performance.now();
    const result = await query(queryText, mainParams);
    timingsMs.dbMainList = performance.now() - tMain0;

    let totalCount =
      result.rows.length > 0 && (result.rows[0] as { __filter_total?: unknown }).__filter_total != null
        ? parseInt(String((result.rows[0] as { __filter_total?: unknown }).__filter_total), 10)
        : 0;
    if (result.rows.length === 0) {
      let emptyCountSql: string;
      let emptyParams: any[];
      if (effectiveListStoPaging) {
        const beforePaged = shipmentBaseCteSqlList.split(/,\s*paged_sto AS\s*\(/)[0];
        emptyCountSql = `${beforePaged}
      SELECT COUNT(*)::bigint AS c FROM ranked_sto`;
        emptyParams = innerParams;
      } else {
        emptyCountSql = `${shipmentBaseCteSqlList},
      filtered_shipments AS (
        SELECT sb.* FROM shipment_base sb WHERE 1=1 ${outerSql}
      )
      SELECT COUNT(*)::bigint AS c FROM filtered_shipments`;
        emptyParams = [...innerParams, ...outerParams];
      }
      const tEc0 = performance.now();
      const emptyRes = await query(emptyCountSql, emptyParams);
      timingsMs.dbEmptyCount = performance.now() - tEc0;
      totalCount = parseInt(emptyRes.rows[0]?.c, 10) || 0;
    }

    // When grouping by STO, display STO No from sto_key when contracts.sto_number is empty,
    // but only if sto_key looks like a real STO number (numeric), not an operation ID or manual code.
    normalizeShipmentListRows(result.rows);

    let summaryRow: Record<string, unknown> = {};
    let unplannedBreakdownForSummary: UnplannedHybridBreakdown | null = null;
    let summarySource: string | undefined;
    if (includeSummary) {
      const tSa0 = performance.now();
      const summaryCacheKey = buildShipmentSummaryCacheKey(
        shipmentListFilterCacheKey,
        scopeStatusParam,
      );
      const summaryBundle = await loadShipmentSummaryBundle(req, {
        summaryCountQuery,
        params: [...section1SummaryFilterParams, ...summaryScopeParams],
        cacheKey: summaryCacheKey,
        loadUnplannedBreakdown: loadSection1UnplannedBreakdown,
      });
      summaryRow = summaryBundle.summaryRow;
      unplannedBreakdownForSummary = summaryBundle.unplannedBreakdown;
      summarySource = summaryBundle.source;
      timingsMs.dbSummaryAgg = performance.now() - tSa0;
    }

    timingsMs.total = performance.now() - tReq0;
    emitShipmentListTimings(res, timingsMs, {
      path: includeSummary && summarySource === 'daily' ? 'list-daily-summary' : 'list',
      compact,
      skipSapJoin,
      effectiveListStoPaging,
      includeSummary,
      page: Number(page),
      limit: Number(limit),
      rowCount: result.rows.length,
      ...(summarySource ? { summarySource } : {}),
    });

    return res.json({
      success: true,
      data: {
        shipments: result.rows,
        summary: shipmentListSummaryPayload(totalCount, summaryRow, unplannedBreakdownForSummary),
        pagination: {
          total: totalCount,
          page: Number(page),
          limit: Number(limit),
          totalPages: Math.ceil(totalCount / Number(limit)),
        },
      },
    });
  } catch (error: any) {
    logger.error('Get shipments error:', error);
    const errorMessage = error.message || 'Failed to fetch shipments';
    const errorDetail = error.detail || error.toString();

    const pos = typeof error.position === 'string' ? parseInt(error.position, 10) : (typeof error.position === 'number' ? error.position : null);
    const sqlSnippet =
      debugSql && typeof pos === 'number' && Number.isFinite(pos) && pos > 0
        ? debugSql.text.slice(Math.max(0, pos - 120), Math.min(debugSql.text.length, pos + 120))
        : null;

    logger.error('Error details:', {
      message: errorMessage,
      detail: errorDetail,
      code: error.code,
      position: error.position,
      sqlSnippet,
      sqlLength: debugSql?.text?.length ?? null,
      paramCount: debugSql?.params?.length ?? null,
    });
    
    return res.status(500).json({
      success: false,
      error: { 
        message: errorMessage,
        detail: process.env.NODE_ENV === 'development' ? errorDetail : undefined
      },
    });
  }
};

export const getVesselIdle = async (_req: AuthRequest, res: Response) => {
  try {
    const data = await loadVesselIdleList();
    return res.json({ success: true, data });
  } catch (error) {
    logger.error('Get vessel idle list error:', error);
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch vessel idle list' },
    });
  }
};

export const getShippingPerformanceSummary = async (req: AuthRequest, res: Response) => {
  try {
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    const data = await runShippingPerformance(req, 'summary');
    return res.json({ success: true, data });
  } catch (error: any) {
    logger.error('Get shipping performance summary error:', error);
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch shipping performance summary' },
    });
  }
};

export const getShippingPerformanceTree = async (req: AuthRequest, res: Response) => {
  try {
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    const data = await runShippingPerformance(req, 'tree');
    return res.json({ success: true, data });
  } catch (error: any) {
    logger.error('Get shipping performance tree error:', error);
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch shipping performance drilldown' },
    });
  }
};

export const getShippingPerformance = async (req: AuthRequest, res: Response) => {
  try {
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    const data = await runShippingPerformance(req, 'rows');
    return res.json({
      success: true,
      data: data.rows,
    });
  } catch (error: any) {
    logger.error('Get shipping performance error:', error);
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch shipping performance data' },
    });
  }
};

export const getShipmentById = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const result = await query(
      `SELECT 
        s.*,
        c.contract_id as contract_number,
        c.sto_number as contract_sto_number,
        c.supplier,
        c.buyer,
        c.product,
        c.group_name,
        c.quantity_ordered,
        c.unit,
        COALESCE(
          NULLIF(TRIM(c.sto_number::text), ''),
          sap_sto.effective_sto,
          CASE
            WHEN NULLIF(TRIM(s.shipment_id::text), '') ~ '^[0-9]+$'
            THEN NULLIF(TRIM(s.shipment_id::text), '')
            ELSE NULL
          END
        ) AS sto_number
       FROM shipments s
       LEFT JOIN contracts c ON s.contract_id = c.id
       LEFT JOIN LATERAL (
         SELECT NULLIF(TRIM(COALESCE(
           spd.sto_number::text,
           spd.data->'raw'->>'STO No.',
           spd.data->'raw'->>'STO Number',
           spd.data->'shipment'->>'sto_no',
           spd.data->'contract'->>'sto_no'
         )), '') AS effective_sto
         FROM sap_processed_data spd
         WHERE spd.contract_number = c.contract_id
         ORDER BY spd.created_at DESC NULLS LAST
         LIMIT 1
       ) sap_sto ON TRUE
       WHERE s.id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: { message: 'Shipment not found' },
      });
    }

    return res.json({
      success: true,
      data: result.rows[0],
    });
  } catch (error) {
    logger.error('Get shipment by ID error:', error);
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch shipment' },
    });
  }
};

/** PO lines eligible to add on Edit Shipment (global, no SAP STO, global outstanding > 0). */
export const getShipmentAvailablePurchaseOrders = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    if (!isUUID) {
      return res.status(400).json({
        success: false,
        error: { message: 'Shipment UUID is required' },
      });
    }

    const search = String(req.query.q ?? req.query.search ?? '').trim();
    const limitRaw = parseInt(String(req.query.limit ?? '50'), 10);
    const limit = Number.isFinite(limitRaw) ? limitRaw : 50;

    const rows = await listAvailablePurchaseOrdersForShipmentEdit(id, { search, limit });
    if (rows === null) {
      return res.status(404).json({
        success: false,
        error: { message: 'Shipment not found' },
      });
    }

    return res.json({ success: true, data: rows });
  } catch (error) {
    logger.error('Get shipment available purchase orders error:', error);
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch available purchase orders' },
    });
  }
};

/** Attach a PO with STO qty assignment to an existing grouped shipment (Edit Shipment modal). */
export const attachPurchaseOrderToShipmentHandler = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    if (!isUUID) {
      return res.status(400).json({
        success: false,
        error: { message: 'Shipment UUID is required' },
      });
    }

    const contractRowId = String(req.body?.contractRowId ?? req.body?.contract_row_id ?? '').trim();
    const stoQtyAssignedMt =
      req.body?.stoQtyAssignedMt != null || req.body?.sto_qty_assigned_mt != null
        ? Number(req.body?.stoQtyAssignedMt ?? req.body?.sto_qty_assigned_mt)
        : undefined;
    const stoQtyAssignedKg =
      req.body?.stoQtyAssignedKg != null || req.body?.shipment_plan_qty_kg != null
        ? Number(req.body?.stoQtyAssignedKg ?? req.body?.shipment_plan_qty_kg)
        : undefined;

    const result = await attachPurchaseOrderToShipment({
      anchorShipmentUuid: id,
      contractRowId,
      stoQtyAssignedMt,
      stoQtyAssignedKg,
    });

    if (!result.ok) {
      return res.status(result.status).json({
        success: false,
        error: { message: result.message },
      });
    }

    invalidateShipmentsListCache();
    invalidateShippingPerformanceRowCache();

    return res.json({
      success: true,
      message: 'PO added to shipment successfully',
      data: {
        shipmentId: result.shipmentUuid,
        contractNumber: result.contractNumber,
        poNumber: result.poNumber,
      },
    });
  } catch (error) {
    logger.error('Attach purchase order to shipment error:', error);
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to add PO to shipment' },
    });
  }
};

/** Batch save Shipment Plan Qty (kg) for PO lines on Edit Shipment modal. */
export const batchSaveShipmentPoPlanQtyHandler = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    if (!isUUID) {
      return res.status(400).json({
        success: false,
        error: { message: 'Shipment UUID is required' },
      });
    }

    const rawRows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    const rows = rawRows.map((row: Record<string, unknown>) => ({
      contractNumber: String(row.contractNumber ?? row.contract_number ?? '').trim(),
      poNumber: row.poNumber ?? row.po_number ?? null,
      shipmentPlanQtyKg: Number(row.shipmentPlanQtyKg ?? row.shipment_plan_qty_kg ?? row.sto_qty_assigned ?? 0),
    }));

    const result = await batchSaveShipmentPoPlanQty({
      anchorShipmentUuid: id,
      rows,
    });

    if (!result.ok) {
      return res.status(result.status).json({
        success: false,
        error: { message: result.message },
      });
    }

    invalidateShipmentsListCache();
    invalidateShippingPerformanceRowCache();

    return res.json({
      success: true,
      message: 'Shipment Plan Qty saved successfully',
    });
  } catch (error) {
    logger.error('Batch save shipment PO plan qty error:', error);
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to save Shipment Plan Qty' },
    });
  }
};

/** Lightweight PO/contract siblings for Edit Shipment modal (one query, no SAP scan). */
export const getShipmentEditContext = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    if (!isUUID) {
      return res.status(400).json({
        success: false,
        error: { message: 'Shipment UUID is required' },
      });
    }

    const context = await resolveShipmentEditContext(id);
    if (!context) {
      return res.status(404).json({
        success: false,
        error: { message: 'Shipment not found' },
      });
    }

    return res.json({ success: true, data: context });
  } catch (error) {
    logger.error('Get shipment edit context error:', error);
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch shipment edit context' },
    });
  }
};

/** Combined modal payload — shipment + ports + contract details in one request (fast open). */
export const getShipmentEditPayload = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    if (!isUUID) {
      return res.status(400).json({
        success: false,
        error: { message: 'Shipment UUID is required' },
      });
    }

    const payload = await resolveShipmentEditPayload(id);
    if (!payload) {
      return res.status(404).json({
        success: false,
        error: { message: 'Shipment not found' },
      });
    }

    return res.json({ success: true, data: payload });
  } catch (error) {
    logger.error('Get shipment edit payload error:', error);
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch shipment edit payload' },
    });
  }
};

export const updateShipment = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    logger.info('Update shipment request:', { id, updateData });

    // shipment_id is not required for updates.
    // The route param (`id`) uniquely identifies the shipment (UUID) or the STO number to resolve to a shipment UUID.

    // Check if id is a UUID or STO number
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    
    let shipmentId: string;
    if (isUUID) {
      // id is a UUID, use it directly
      shipmentId = id;
    } else {
      // id is a STO number, find the shipment UUID
      const shipmentResult = await query(
        `SELECT s.id FROM shipments s 
         JOIN contracts c ON s.contract_id = c.id 
         WHERE c.sto_number = $1 LIMIT 1`,
        [id]
      );
      
      if (shipmentResult.rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: { message: 'Shipment not found for STO number' },
        });
      }
      
      shipmentId = shipmentResult.rows[0].id;
    }

    // Build the update query with explicit field handling
    const updateFields = [];
    const updateValues = [];
    let paramIndex = 1;

    // Handle each field explicitly with proper type casting
    // Skip shipment_id update to avoid duplicate key conflicts
    // The shipment_id should remain unchanged during updates

    // Status is auto-derived from ETA/ATA milestones; only manual override is CANCELLED.
    if (updateData.status !== undefined && updateData.status !== null) {
      const requestedStatus = String(updateData.status).trim().toUpperCase();
      if (requestedStatus === 'CANCELLED') {
        updateFields.push(`status = $${paramIndex}`);
        updateValues.push('CANCELLED');
        paramIndex++;
      }
    }

    if (updateData.vessel_code) {
      updateFields.push(`vessel_code = $${paramIndex}`);
      updateValues.push(updateData.vessel_code);
      paramIndex++;
    }

    if (updateData.vessel_loa !== undefined && updateData.vessel_loa !== null) {
      updateFields.push(`vessel_loa = $${paramIndex}::numeric`);
      updateValues.push(updateData.vessel_loa);
      paramIndex++;
    }

    if (updateData.vessel_registration_year !== undefined && updateData.vessel_registration_year !== null) {
      updateFields.push(`vessel_registration_year = $${paramIndex}::int`);
      updateValues.push(updateData.vessel_registration_year);
      paramIndex++;
    }

    if (updateData.vessel_name) {
      updateFields.push(`vessel_name = $${paramIndex}`);
      updateValues.push(updateData.vessel_name);
      paramIndex++;
    }

    if (updateData.voyage_no) {
      updateFields.push(`voyage_no = $${paramIndex}`);
      updateValues.push(updateData.voyage_no);
      paramIndex++;
    }

    if (updateData.vessel_owner) {
      updateFields.push(`vessel_owner = $${paramIndex}`);
      updateValues.push(updateData.vessel_owner);
      paramIndex++;
    }

    if (updateData.vessel_draft !== undefined && updateData.vessel_draft !== null) {
      updateFields.push(`vessel_draft = $${paramIndex}::numeric`);
      updateValues.push(updateData.vessel_draft);
      paramIndex++;
    }

    if (updateData.vessel_capacity !== undefined && updateData.vessel_capacity !== null) {
      updateFields.push(`vessel_capacity = $${paramIndex}::numeric`);
      updateValues.push(updateData.vessel_capacity);
      paramIndex++;
    }

    if (updateData.vessel_hull_type) {
      updateFields.push(`vessel_hull_type = $${paramIndex}`);
      updateValues.push(updateData.vessel_hull_type);
      paramIndex++;
    }

    if (updateData.charter_type) {
      updateFields.push(`charter_type = $${paramIndex}`);
      updateValues.push(updateData.charter_type);
      paramIndex++;
    }

    if (updateData.port_of_loading) {
      updateFields.push(`port_of_loading = $${paramIndex}`);
      updateValues.push(updateData.port_of_loading);
      paramIndex++;
    }

    if (updateData.port_of_discharge) {
      updateFields.push(`port_of_discharge = $${paramIndex}`);
      updateValues.push(updateData.port_of_discharge);
      paramIndex++;
    }

    if (updateData.shipment_date) {
      updateFields.push(`shipment_date = $${paramIndex}::date`);
      updateValues.push(updateData.shipment_date);
      paramIndex++;
    }

    if (updateData.arrival_date) {
      updateFields.push(`arrival_date = $${paramIndex}::date`);
      updateValues.push(updateData.arrival_date);
      paramIndex++;
    }

    if (updateData.quantity_shipped !== undefined && updateData.quantity_shipped !== null) {
      updateFields.push(`quantity_shipped = $${paramIndex}::numeric`);
      updateValues.push(updateData.quantity_shipped);
      paramIndex++;
    }

    if (updateData.quantity_delivered !== undefined && updateData.quantity_delivered !== null) {
      updateFields.push(`quantity_delivered = $${paramIndex}::numeric`);
      updateValues.push(updateData.quantity_delivered);
      paramIndex++;
      // Keep explicit KLIP delivery source in sync with manual KLIP edits.
      updateFields.push(`quantity_delivered_klip = $${paramIndex}::numeric`);
      updateValues.push(updateData.quantity_delivered);
      paramIndex++;
    }

    if (updateData.bl_quantity !== undefined && updateData.bl_quantity !== null) {
      updateFields.push(`bl_quantity = $${paramIndex}::numeric`);
      updateValues.push(updateData.bl_quantity);
      paramIndex++;
    }

    if (updateData.actual_vessel_qty_receive !== undefined && updateData.actual_vessel_qty_receive !== null) {
      updateFields.push(`actual_vessel_qty_receive = $${paramIndex}::numeric`);
      updateValues.push(updateData.actual_vessel_qty_receive);
      paramIndex++;
    }

    if (updateData.sfal_qty !== undefined) {
      updateFields.push(`sfal_qty = $${paramIndex}::numeric`);
      updateValues.push(updateData.sfal_qty);
      paramIndex++;
    }

    if (updateData.sfbd_qty !== undefined) {
      updateFields.push(`sfbd_qty = $${paramIndex}::numeric`);
      updateValues.push(updateData.sfbd_qty);
      paramIndex++;
    }

    if (updateData.difference_final_qty_vs_bl_qty !== undefined && updateData.difference_final_qty_vs_bl_qty !== null) {
      updateFields.push(`difference_final_qty_vs_bl_qty = $${paramIndex}::numeric`);
      updateValues.push(updateData.difference_final_qty_vs_bl_qty);
      paramIndex++;
    }

    if (updateData.gain_loss_percentage !== undefined && updateData.gain_loss_percentage !== null) {
      updateFields.push(`gain_loss_percentage = $${paramIndex}::numeric`);
      updateValues.push(updateData.gain_loss_percentage);
      paramIndex++;
    }

    if (updateData.gain_loss_amount !== undefined && updateData.gain_loss_amount !== null) {
      updateFields.push(`gain_loss_amount = $${paramIndex}::numeric`);
      updateValues.push(updateData.gain_loss_amount);
      paramIndex++;
    }

    if (updateData.estimated_km !== undefined && updateData.estimated_km !== null) {
      updateFields.push(`estimated_km = $${paramIndex}::numeric`);
      updateValues.push(updateData.estimated_km);
      paramIndex++;
    }

    if (updateData.estimated_nautical_miles !== undefined && updateData.estimated_nautical_miles !== null) {
      updateFields.push(`estimated_nautical_miles = $${paramIndex}::numeric`);
      updateValues.push(updateData.estimated_nautical_miles);
      paramIndex++;
    }

    if (updateData.vessel_oa_budget !== undefined && updateData.vessel_oa_budget !== null) {
      updateFields.push(`vessel_oa_budget = $${paramIndex}::numeric`);
      updateValues.push(updateData.vessel_oa_budget);
      paramIndex++;
    }

    if (updateData.vessel_oa_actual !== undefined && updateData.vessel_oa_actual !== null) {
      updateFields.push(`vessel_oa_actual = $${paramIndex}::numeric`);
      updateValues.push(updateData.vessel_oa_actual);
      paramIndex++;
    }

    if (updateData.average_vessel_speed !== undefined && updateData.average_vessel_speed !== null) {
      updateFields.push(`average_vessel_speed = $${paramIndex}::numeric`);
      updateValues.push(updateData.average_vessel_speed);
      paramIndex++;
    }

    if (updateData.sla_days !== undefined && updateData.sla_days !== null) {
      updateFields.push(`sla_days = $${paramIndex}::numeric`);
      updateValues.push(updateData.sla_days);
      paramIndex++;
    }

    if (updateData.is_delayed !== undefined && updateData.is_delayed !== null) {
      updateFields.push(`is_delayed = $${paramIndex}::boolean`);
      updateValues.push(updateData.is_delayed);
      paramIndex++;
    }

    if (updateData.sap_delivery_id) {
      updateFields.push(`sap_delivery_id = $${paramIndex}`);
      updateValues.push(updateData.sap_delivery_id);
      paramIndex++;
    }

    const etaShipmentFields = [
      'eta_arrival',
      'eta_berthed',
      'eta_loading_start',
      'eta_loading_complete',
      'eta_sailed',
      'eta_discharge_arrival',
      'eta_discharge_berthed',
      'eta_discharge_start',
      'eta_discharge_complete',
    ] as const;
    let etaFieldsUpdated = false;
    for (const field of etaShipmentFields) {
      if (Object.prototype.hasOwnProperty.call(updateData, field)) {
        updateFields.push(`${field} = $${paramIndex}::date`);
        updateValues.push(toShipmentDateOrNull(updateData[field]));
        paramIndex++;
        etaFieldsUpdated = true;
      }
    }

    if (updateFields.length === 0) {
      return res.status(400).json({
        success: false,
        error: { message: 'No valid fields to update' },
      });
    }

    // Add updated_at timestamp
    updateFields.push(`updated_at = CURRENT_TIMESTAMP`);
    updateValues.push(shipmentId);

    const queryText = `
      UPDATE shipments 
      SET ${updateFields.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING *
    `;

    logger.info('Executing query:', { queryText, updateValues, paramIndex });
    
    const result = await query(queryText, updateValues);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: { message: 'Shipment not found' },
      });
    }

    // Auto-derive status after milestone updates.
    const updated = result.rows[0] as any;
    const contractImportStatus = await getContractImportStatusForShipment(shipmentId);
    const autoStatus = deriveShipmentStatus({
      eta_arrival_at_loading_port: updated.eta_arrival,
      eta_berthed_at_loading_port: updated.eta_berthed,
      eta_start_loading: updated.eta_loading_start,
      eta_completed_loading: updated.eta_loading_complete,
      eta_sailed_from_loading_port: updated.eta_sailed,
      eta_arrive_at_discharge_port: updated.eta_discharge_arrival,
      eta_berthed_at_discharge_port: updated.eta_discharge_berthed,
      eta_start_discharging: updated.eta_discharge_start,
      eta_complete_discharge: updated.eta_discharge_complete,
      ata_arrival_at_loading_port: updated.ata_arrival,
      ata_berthed_at_loading_port: updated.ata_berthed,
      ata_start_loading: updated.ata_loading_start,
      ata_completed_loading: updated.ata_loading_complete,
      ata_sailed_from_loading_port: updated.ata_sailed,
      ata_arrive_at_discharge_port: updated.ata_discharge_arrival,
      ata_berthed_at_discharge_port: updated.ata_discharge_berthed,
      ata_start_discharging: updated.ata_discharge_start,
      ata_complete_discharge: updated.ata_discharge_complete,
      contract_import_status: contractImportStatus,
    });

    const persistedStatus = String(updated.status || '').trim().toUpperCase();
    if (persistedStatus === 'CANCELLED') {
      updated.status = 'CANCELLED';
    } else if (
      (SHIPMENT_PERSISTABLE_AUTO_STATUSES as readonly string[]).includes(autoStatus) &&
      persistedStatus !== autoStatus
    ) {
      const sRes = await query(
        `UPDATE shipments SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING status`,
        [autoStatus, shipmentId]
      );
      updated.status = sRes.rows?.[0]?.status ?? autoStatus;
    } else {
      updated.status = persistedStatus || 'PLANNED';
    }

    if (etaFieldsUpdated) {
      await query(
        `UPDATE vessel_loading_ports SET
          eta_vessel_arrival = $2,
          eta_vessel_berthed_at_loading_port = $3,
          eta_loading_start = $4,
          eta_loading_completed = $5,
          eta_vessel_sailed = $6,
          updated_at = CURRENT_TIMESTAMP
         WHERE shipment_id = $1 AND port_sequence = 1 AND COALESCE(is_discharge_port, false) = false`,
        [
          shipmentId,
          updated.eta_arrival,
          updated.eta_berthed,
          updated.eta_loading_start,
          updated.eta_loading_complete,
          updated.eta_sailed,
        ],
      );
      await query(
        `UPDATE vessel_loading_ports SET
          eta_vessel_arrive_at_discharge_port = $2,
          eta_vessel_berthed_at_discharge_port = $3,
          eta_vessel_start_discharging = $4,
          eta_vessel_complete_discharge = $5,
          updated_at = CURRENT_TIMESTAMP
         WHERE shipment_id = $1 AND COALESCE(is_discharge_port, false) = true`,
        [
          shipmentId,
          updated.eta_discharge_arrival,
          updated.eta_discharge_berthed,
          updated.eta_discharge_start,
          updated.eta_discharge_complete,
        ],
      );
    }

    logger.info('Shipment updated:', { id, updatedFields: updateFields.length, autoStatus });

    invalidateShipmentsListCache();
    setImmediate(() => {
      import('../services/contractQtyMoveSnapshot.service')
        .then(({ ContractQtyMoveSnapshotService }) =>
          ContractQtyMoveSnapshotService.refreshForShipmentIds([shipmentId]),
        )
        .catch((err) => {
          logger.warn('Contract qty_move snapshot refresh after shipment update failed', { err, shipmentId });
        });
    });

    return res.json({
      success: true,
      data: updated,
      message: 'Shipment updated successfully',
    });
  } catch (error) {
    logger.error('Update shipment error:', error);
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to update shipment' },
    });
  }
};

// Get vessel loading ports for a shipment or STO
export const getVesselLoadingPorts = async (req: AuthRequest, res: Response) => {
  try {
    const { shipmentId } = req.params;
    const syncSap = String(req.query.syncSap ?? 'true').toLowerCase() !== 'false';
    const hydrateAta = String(req.query.hydrateAta ?? 'true').toLowerCase() !== 'false';
    logger.info('Getting vessel loading ports for:', { shipmentId, syncSap, hydrateAta });
    const hasCancelColumn = await vesselLoadingPortHasCancelColumn();
    const hasCancelledByColumn = await vesselLoadingPortHasCancelledByColumn();
    const activePortFilter = hasCancelColumn ? 'AND COALESCE(vlp.is_cancelled, false) = false' : '';
    const activeLoadingJoinFilter = hasCancelColumn ? ' AND COALESCE(vlp1.is_cancelled, false) = false' : '';
    const activeDischargeJoinFilter = hasCancelColumn ? ' AND COALESCE(vlpd.is_cancelled, false) = false' : '';
    const cancelledBySelect = hasCancelledByColumn
      ? `vlp.cancelled_by_user_id, COALESCE(u.full_name, u.username, u.email) AS cancelled_by_name`
      : `NULL::uuid AS cancelled_by_user_id, NULL::text AS cancelled_by_name`;
    const cancelledByJoin = hasCancelledByColumn ? 'LEFT JOIN users u ON u.id = vlp.cancelled_by_user_id' : '';

    // Check if shipmentId is a UUID (individual shipment) or STO number (aggregated)
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(shipmentId);
    logger.info('Is UUID:', isUUID);

    let portsResult;
    let cancelledPortsResult = { rows: [] as any[] };
    let shipmentInfoResult;
    
    if (isUUID) {
      // Get loading ports for a specific shipment
      portsResult = await query(
        `SELECT 
          vlp.id,
          vlp.shipment_id,
          vlp.port_name,
          vlp.port_sequence,
          vlp.quantity_at_loading_port,
          vlp.eta_vessel_arrival,
          vlp.ata_vessel_arrival,
          vlp.eta_vessel_berthed,
          vlp.ata_vessel_berthed,
          vlp.eta_loading_start,
          vlp.ata_loading_start,
          vlp.eta_loading_completed,
          vlp.ata_loading_completed,
          vlp.eta_vessel_sailed,
          vlp.ata_vessel_sailed,
          vlp.eta_vessel_berthed_at_loading_port,
          vlp.eta_vessel_arrive_at_discharge_port,
          vlp.eta_vessel_berthed_at_discharge_port,
          vlp.eta_vessel_start_discharging,
          vlp.eta_vessel_complete_discharge,
          vlp.loading_rate,
          vlp.quality_ffa,
          vlp.quality_mi,
          vlp.quality_dobi,
          vlp.quality_red,
          vlp.quality_ds,
          vlp.quality_stone,
          vlp.is_discharge_port,
          vlp.created_at,
          vlp.updated_at,
          c.contract_id as contract_number
         FROM vessel_loading_ports vlp
         LEFT JOIN shipments s ON vlp.shipment_id = s.id
         LEFT JOIN contracts c ON s.contract_id = c.id
         WHERE vlp.shipment_id = $1
         ${activePortFilter}
         ORDER BY vlp.port_sequence ASC, vlp.is_discharge_port ASC`,
        [shipmentId]
      );
      if (hasCancelColumn) {
        cancelledPortsResult = await query(
          `SELECT
             vlp.id,
             vlp.shipment_id,
             vlp.port_name,
             vlp.port_sequence,
             vlp.is_discharge_port,
             vlp.cancel_remark,
             vlp.cancelled_at,
             ${cancelledBySelect},
             vlp.updated_at,
             c.contract_id as contract_number
           FROM vessel_loading_ports vlp
           LEFT JOIN shipments s ON vlp.shipment_id = s.id
           LEFT JOIN contracts c ON s.contract_id = c.id
           ${cancelledByJoin}
           WHERE vlp.shipment_id = $1
             AND COALESCE(vlp.is_cancelled, false) = true
           ORDER BY vlp.cancelled_at DESC NULLS LAST, vlp.updated_at DESC NULLS LAST`,
          [shipmentId]
        );
      }

      // Backfill: if shipment has port names but no vessel_loading_ports rows, create one loading + one discharge row from shipments
      if (portsResult.rows.length === 0) {
        const shipRow = await query(
          `SELECT id, port_of_loading, port_of_discharge, actual_vessel_qty_receive
           FROM shipments WHERE id = $1`,
          [shipmentId]
        );
        if (shipRow.rows.length > 0) {
          const s = shipRow.rows[0];
          const pol = (s.port_of_loading && String(s.port_of_loading).trim()) || null;
          const pod = (s.port_of_discharge && String(s.port_of_discharge).trim()) || null;
          if (pol) {
            await query(
              `INSERT INTO vessel_loading_ports (shipment_id, port_name, port_sequence, quantity_at_loading_port, is_discharge_port)
               VALUES ($1, $2, 1, $3::numeric, false)`,
              [shipmentId, pol, s.actual_vessel_qty_receive ?? null]
            );
          }
          if (pod) {
            await query(
              `INSERT INTO vessel_loading_ports (shipment_id, port_name, port_sequence, quantity_at_loading_port, is_discharge_port)
               VALUES ($1, $2, 999, 0, true)`,
              [shipmentId, pod]
            );
          }
          if (pol || pod) {
            portsResult = await query(
              `SELECT vlp.id, vlp.shipment_id, vlp.port_name, vlp.port_sequence, vlp.quantity_at_loading_port,
                vlp.eta_vessel_arrival, vlp.ata_vessel_arrival, vlp.eta_vessel_berthed, vlp.ata_vessel_berthed,
                vlp.eta_loading_start, vlp.ata_loading_start, vlp.eta_loading_completed, vlp.ata_loading_completed,
                vlp.eta_vessel_sailed, vlp.ata_vessel_sailed,
                vlp.eta_vessel_berthed_at_loading_port, vlp.eta_vessel_arrive_at_discharge_port,
                vlp.eta_vessel_berthed_at_discharge_port, vlp.eta_vessel_start_discharging, vlp.eta_vessel_complete_discharge,
                vlp.loading_rate, vlp.quality_ffa, vlp.quality_mi, vlp.quality_dobi, vlp.quality_red, vlp.quality_ds, vlp.quality_stone,
                vlp.is_discharge_port, vlp.created_at, vlp.updated_at,
                c.contract_id as contract_number
               FROM vessel_loading_ports vlp
               LEFT JOIN shipments sh ON vlp.shipment_id = sh.id
               LEFT JOIN contracts c ON sh.contract_id = c.id
               WHERE vlp.shipment_id = $1
              ${activePortFilter}
               ORDER BY vlp.port_sequence ASC, vlp.is_discharge_port ASC`,
              [shipmentId]
            );
          }
        }
      }

      try {
        if (syncSap) {
          const synced = await syncVesselLoadingPortsFromLatestSap(shipmentId);
          if (synced) {
          portsResult = await query(
            `SELECT 
              vlp.id,
              vlp.shipment_id,
              vlp.port_name,
              vlp.port_sequence,
              vlp.quantity_at_loading_port,
              vlp.eta_vessel_arrival,
              vlp.ata_vessel_arrival,
              vlp.eta_vessel_berthed,
              vlp.ata_vessel_berthed,
              vlp.eta_loading_start,
              vlp.ata_loading_start,
              vlp.eta_loading_completed,
              vlp.ata_loading_completed,
              vlp.eta_vessel_sailed,
              vlp.ata_vessel_sailed,
              vlp.eta_vessel_berthed_at_loading_port,
              vlp.eta_vessel_arrive_at_discharge_port,
              vlp.eta_vessel_berthed_at_discharge_port,
              vlp.eta_vessel_start_discharging,
              vlp.eta_vessel_complete_discharge,
              vlp.loading_rate,
              vlp.quality_ffa,
              vlp.quality_mi,
              vlp.quality_dobi,
              vlp.quality_red,
              vlp.quality_ds,
              vlp.quality_stone,
              vlp.is_discharge_port,
              vlp.created_at,
              vlp.updated_at,
              c.contract_id as contract_number
             FROM vessel_loading_ports vlp
             LEFT JOIN shipments s ON vlp.shipment_id = s.id
             LEFT JOIN contracts c ON s.contract_id = c.id
             WHERE vlp.shipment_id = $1
             ${activePortFilter}
             ORDER BY vlp.port_sequence ASC, vlp.is_discharge_port ASC`,
            [shipmentId],
          );
          }
        }
      } catch (syncError) {
        logger.warn('Vessel loading port SAP sync skipped', { shipmentId, syncError });
      }

      // Get shipment-level information
      // Also pull ATA dates from first loading port if not in shipments table
      // Include ETA dates from loading ports and calculate loading rate
      shipmentInfoResult = await query(
        `SELECT 
          s.quantity_delivered,
          s.actual_vessel_qty_receive,
          s.sfal_qty,
          s.sfbd_qty,
          s.vessel_oa_actual,
          s.vessel_oa_budget,
          s.bl_quantity,
          s.port_of_loading as vessel_loading_port_1,
          s.port_of_discharge as vessel_discharge_port_1,
          c.contract_id as contract_number,
          ${sqlEffectiveAtaArrivalLoading()} as ata_vessel_arrival_at_loading_port,
          ${sqlEffectiveAtaBerthedLoading()} as ata_vessel_berthed_at_loading_port,
          ${sqlEffectiveAtaStartLoading()} as ata_vessel_start_loading,
          ${sqlEffectiveAtaCompletedLoading()} as ata_vessel_completed_loading,
          ${sqlEffectiveAtaSailedLoading()} as ata_vessel_sailed_from_loading_port,
          ${sqlEffectiveAtaArrivalDischarge()} as ata_vessel_arrive_at_discharge_port,
          ${sqlEffectiveAtaBerthedDischarge()} as ata_vessel_berthed_at_discharge_port,
          ${sqlEffectiveAtaStartDischarge()} as ata_vessel_start_discharging,
          ${sqlEffectiveAtaCompleteDischarge()} as ata_vessel_complete_discharge,
          ${sqlSapAtaArrivalLoading()} as sap_ata_vessel_arrival_at_loading_port,
          ${sqlSapAtaBerthedLoading()} as sap_ata_vessel_berthed_at_loading_port,
          ${sqlSapAtaStartLoading()} as sap_ata_vessel_start_loading,
          ${sqlSapAtaCompletedLoading()} as sap_ata_vessel_completed_loading,
          ${sqlSapAtaSailedLoading()} as sap_ata_vessel_sailed_from_loading_port,
          ${sqlSapAtaArrivalDischarge()} as sap_ata_vessel_arrive_at_discharge_port,
          ${sqlSapAtaBerthedDischarge()} as sap_ata_vessel_berthed_at_discharge_port,
          ${sqlSapAtaStartDischarge()} as sap_ata_vessel_start_discharging,
          ${sqlSapAtaCompleteDischarge()} as sap_ata_vessel_complete_discharge,
          sao.ata_arrival::text as ata_override_arrival_at_loading_port,
          sao.ata_berthed::text as ata_override_berthed_at_loading_port,
          sao.ata_loading_start::text as ata_override_start_loading,
          sao.ata_loading_complete::text as ata_override_completed_loading,
          sao.ata_sailed::text as ata_override_sailed_from_loading_port,
          sao.ata_discharge_arrival::text as ata_override_arrive_at_discharge_port,
          sao.ata_discharge_berthed::text as ata_override_berthed_at_discharge_port,
          sao.ata_discharge_start::text as ata_override_start_discharging,
          sao.ata_discharge_complete::text as ata_override_complete_discharge,
          -- ETA fields: prefer vessel_loading_ports, fallback to shipments so UI shows data from either table
          COALESCE(vlp1.eta_vessel_arrival::date, s.eta_arrival) as eta_vessel_arrival_at_loading_port,
          COALESCE(vlp1.eta_vessel_berthed_at_loading_port::date, s.eta_berthed) as eta_vessel_berthed_at_loading_port,
          COALESCE(vlp1.eta_loading_start::date, s.eta_loading_start) as eta_vessel_start_loading,
          COALESCE(vlp1.eta_loading_completed::date, s.eta_loading_complete) as eta_vessel_completed_loading,
          COALESCE(vlp1.eta_vessel_sailed::date, s.eta_sailed) as eta_vessel_sailed_from_loading_port,
          COALESCE(vlpd.eta_vessel_arrive_at_discharge_port::date, s.eta_discharge_arrival) as eta_vessel_arrive_at_discharge_port,
          COALESCE(vlpd.eta_vessel_berthed_at_discharge_port::date, s.eta_discharge_berthed) as eta_vessel_berthed_at_discharge_port,
          COALESCE(vlpd.eta_vessel_start_discharging::date, s.eta_discharge_start) as eta_vessel_start_discharging,
          COALESCE(vlpd.eta_vessel_complete_discharge::date, s.eta_discharge_complete) as eta_vessel_complete_discharge,
          -- Loading rate (kg/day): Quantity Receive / (ATA Completed Loading − ATA Start Loading) in days
          CASE 
            WHEN s.actual_vessel_qty_receive > 0 
              AND ${sqlEffectiveAtaCompletedLoading()} IS NOT NULL
              AND ${sqlEffectiveAtaStartLoading()} IS NOT NULL
            THEN s.actual_vessel_qty_receive / NULLIF(
              (${sqlEffectiveAtaCompletedLoading()}::date - ${sqlEffectiveAtaStartLoading()}::date)::numeric,
              0
            )
            ELSE NULL
          END as loading_rate_kg_per_day,
          -- Quality fields from first loading port
          vlp1.quality_ffa as quality_at_loading_loc_1_ffa,
          vlp1.quality_mi as quality_at_loading_loc_1_mi,
          vlp1.quality_dobi as quality_at_loading_loc_1_dobi,
          vlp1.quality_red as quality_at_loading_loc_1_red,
          vlp1.quality_ds as quality_at_loading_loc_1_ds,
          vlp1.quality_stone as quality_at_loading_loc_1_stone,
          -- Quality fields from discharge port
          vlpd.quality_ffa as quality_at_discharge_loc_1_ffa,
          vlpd.quality_mi as quality_at_discharge_loc_1_mi,
          vlpd.quality_dobi as quality_at_discharge_loc_1_dobi,
          vlpd.quality_red as quality_at_discharge_loc_1_red,
          vlpd.quality_ds as quality_at_discharge_loc_1_ds,
          vlpd.quality_stone as quality_at_discharge_loc_1_stone
         FROM shipments s
         LEFT JOIN contracts c ON s.contract_id = c.id
         LEFT JOIN vessel_loading_ports vlp1 ON vlp1.shipment_id = s.id AND vlp1.port_sequence = 1 AND vlp1.is_discharge_port = false${activeLoadingJoinFilter}
         LEFT JOIN vessel_loading_ports vlpd ON vlpd.shipment_id = s.id AND vlpd.is_discharge_port = true${activeDischargeJoinFilter}
         ${SHIPMENT_ATA_OVERRIDES_JOIN}
         WHERE s.id = $1
         LIMIT 1`,
        [shipmentId]
      );
    } else {
      // Get loading ports for all shipments under this STO
      portsResult = await query(
        `SELECT 
          vlp.id,
          vlp.shipment_id,
          vlp.port_name,
          vlp.port_sequence,
          vlp.quantity_at_loading_port,
          vlp.eta_vessel_arrival,
          vlp.ata_vessel_arrival,
          vlp.eta_vessel_berthed,
          vlp.ata_vessel_berthed,
          vlp.eta_loading_start,
          vlp.ata_loading_start,
          vlp.eta_loading_completed,
          vlp.ata_loading_completed,
          vlp.eta_vessel_sailed,
          vlp.ata_vessel_sailed,
          vlp.eta_vessel_berthed_at_loading_port,
          vlp.eta_vessel_arrive_at_discharge_port,
          vlp.eta_vessel_berthed_at_discharge_port,
          vlp.eta_vessel_start_discharging,
          vlp.eta_vessel_complete_discharge,
          vlp.loading_rate,
          vlp.quality_ffa,
          vlp.quality_mi,
          vlp.quality_dobi,
          vlp.quality_red,
          vlp.quality_ds,
          vlp.quality_stone,
          vlp.is_discharge_port,
          vlp.created_at,
          vlp.updated_at,
          c.contract_id as contract_number
         FROM vessel_loading_ports vlp
         LEFT JOIN shipments s ON vlp.shipment_id = s.id
         LEFT JOIN contracts c ON s.contract_id = c.id
         WHERE (c.sto_number = $1 OR s.shipment_id = $1)
         ${activePortFilter}
         ORDER BY c.contract_id, vlp.port_sequence ASC, vlp.is_discharge_port ASC`,
        [shipmentId]
      );
      if (hasCancelColumn) {
        cancelledPortsResult = await query(
          `SELECT
             vlp.id,
             vlp.shipment_id,
             vlp.port_name,
             vlp.port_sequence,
             vlp.is_discharge_port,
             vlp.cancel_remark,
             vlp.cancelled_at,
             ${cancelledBySelect},
             vlp.updated_at,
             c.contract_id as contract_number
           FROM vessel_loading_ports vlp
           LEFT JOIN shipments s ON vlp.shipment_id = s.id
           LEFT JOIN contracts c ON s.contract_id = c.id
           ${cancelledByJoin}
           WHERE (c.sto_number = $1 OR s.shipment_id = $1)
             AND COALESCE(vlp.is_cancelled, false) = true
           ORDER BY vlp.cancelled_at DESC NULLS LAST, vlp.updated_at DESC NULLS LAST`,
          [shipmentId]
        );
      }
      
      // Get shipment-level information (aggregated by STO)
      // Also pull ATA dates from first loading port if not in shipments table
      // Include ETA dates from loading ports and calculate loading rate
      shipmentInfoResult = await query(
        `SELECT 
          MAX(s.quantity_delivered) as quantity_delivered,
          MAX(s.actual_vessel_qty_receive) as actual_vessel_qty_receive,
          MAX(s.sfal_qty) as sfal_qty,
          MAX(s.sfbd_qty) as sfbd_qty,
          MAX(s.vessel_oa_actual) as vessel_oa_actual,
          MAX(s.vessel_oa_budget) as vessel_oa_budget,
          MAX(s.bl_quantity) as bl_quantity,
          MAX(s.port_of_loading) as vessel_loading_port_1,
          MAX(s.port_of_discharge) as vessel_discharge_port_1,
          MAX(c.contract_id) as contract_number,
          MAX(COALESCE(sao.ata_arrival, s.ata_arrival, vlp1.ata_vessel_arrival::date)) as ata_vessel_arrival_at_loading_port,
          MAX(COALESCE(sao.ata_berthed, s.ata_berthed, vlp1.ata_vessel_berthed::date)) as ata_vessel_berthed_at_loading_port,
          MAX(COALESCE(sao.ata_loading_start, s.ata_loading_start, vlp1.ata_loading_start::date)) as ata_vessel_start_loading,
          MAX(COALESCE(sao.ata_loading_complete, s.ata_loading_complete, vlp1.ata_loading_completed::date)) as ata_vessel_completed_loading,
          MAX(COALESCE(sao.ata_sailed, s.ata_sailed, vlp1.ata_vessel_sailed::date)) as ata_vessel_sailed_from_loading_port,
          MAX(COALESCE(sao.ata_discharge_arrival, s.ata_discharge_arrival, vlpd.ata_vessel_arrival::date)) as ata_vessel_arrive_at_discharge_port,
          MAX(COALESCE(sao.ata_discharge_berthed, s.ata_discharge_berthed, vlpd.ata_vessel_berthed::date)) as ata_vessel_berthed_at_discharge_port,
          MAX(COALESCE(sao.ata_discharge_start, s.ata_discharge_start, vlpd.ata_loading_start::date)) as ata_vessel_start_discharging,
          MAX(COALESCE(sao.ata_discharge_complete, s.ata_discharge_complete, vlpd.ata_loading_completed::date)) as ata_vessel_complete_discharge,
          -- ETA fields from loading ports
          MAX(vlp1.eta_vessel_arrival::date) as eta_vessel_arrival_at_loading_port,
          MAX(vlp1.eta_vessel_berthed_at_loading_port::date) as eta_vessel_berthed_at_loading_port,
          MAX(vlp1.eta_loading_start::date) as eta_vessel_start_loading,
          MAX(vlp1.eta_loading_completed::date) as eta_vessel_completed_loading,
          MAX(vlp1.eta_vessel_sailed::date) as eta_vessel_sailed_from_loading_port,
          MAX(vlpd.eta_vessel_arrive_at_discharge_port::date) as eta_vessel_arrive_at_discharge_port,
          MAX(vlpd.eta_vessel_berthed_at_discharge_port::date) as eta_vessel_berthed_at_discharge_port,
          MAX(vlpd.eta_vessel_start_discharging::date) as eta_vessel_start_discharging,
          MAX(vlpd.eta_vessel_complete_discharge::date) as eta_vessel_complete_discharge,
          -- Loading rate (kg/day): Quantity Receive / (ATA Completed Loading − ATA Start Loading) in days
          CASE 
            WHEN MAX(s.actual_vessel_qty_receive) > 0 
              AND MAX(COALESCE(s.ata_loading_complete, vlp1.ata_loading_completed)) IS NOT NULL
              AND MAX(COALESCE(s.ata_loading_start, vlp1.ata_loading_start)) IS NOT NULL
            THEN MAX(s.actual_vessel_qty_receive) / NULLIF(
              (MAX(COALESCE(s.ata_loading_complete, vlp1.ata_loading_completed))::date - MAX(COALESCE(s.ata_loading_start, vlp1.ata_loading_start)))::numeric,
              0
            )
            ELSE NULL
          END as loading_rate_kg_per_day,
          -- Quality fields from first loading port
          MAX(vlp1.quality_ffa) as quality_at_loading_loc_1_ffa,
          MAX(vlp1.quality_mi) as quality_at_loading_loc_1_mi,
          MAX(vlp1.quality_dobi) as quality_at_loading_loc_1_dobi,
          MAX(vlp1.quality_red) as quality_at_loading_loc_1_red,
          MAX(vlp1.quality_ds) as quality_at_loading_loc_1_ds,
          MAX(vlp1.quality_stone) as quality_at_loading_loc_1_stone,
          -- Quality fields from discharge port
          MAX(vlpd.quality_ffa) as quality_at_discharge_loc_1_ffa,
          MAX(vlpd.quality_mi) as quality_at_discharge_loc_1_mi,
          MAX(vlpd.quality_dobi) as quality_at_discharge_loc_1_dobi,
          MAX(vlpd.quality_red) as quality_at_discharge_loc_1_red,
          MAX(vlpd.quality_ds) as quality_at_discharge_loc_1_ds,
          MAX(vlpd.quality_stone) as quality_at_discharge_loc_1_stone
         FROM shipments s
         LEFT JOIN contracts c ON s.contract_id = c.id
         LEFT JOIN vessel_loading_ports vlp1 ON vlp1.shipment_id = s.id AND vlp1.port_sequence = 1 AND vlp1.is_discharge_port = false${activeLoadingJoinFilter}
         LEFT JOIN vessel_loading_ports vlpd ON vlpd.shipment_id = s.id AND vlpd.is_discharge_port = true${activeDischargeJoinFilter}
         ${SHIPMENT_ATA_OVERRIDES_JOIN}
         WHERE c.sto_number = $1 OR s.shipment_id = $1
         GROUP BY COALESCE(c.sto_number, s.shipment_id)`,
        [shipmentId]
      );
    }

    let shipmentInfo = shipmentInfoResult.rows[0] || null;

    if (shipmentInfo && hydrateAta) {
      await hydrateShipmentInfoAtaGaps(shipmentId, shipmentInfo);
    }
    logger.info('ShipmentInfo result:', {
      hasData: !!shipmentInfo,
      rowCount: shipmentInfoResult.rows.length,
      sample: shipmentInfo ? {
        quantity_delivered: shipmentInfo.quantity_delivered,
        actual_vessel_qty_receive: shipmentInfo.actual_vessel_qty_receive
      } : null
    });

    return res.json({
      success: true,
      data: {
        ports: portsResult.rows,
        cancelledPorts: cancelledPortsResult.rows,
        shipmentInfo: shipmentInfo,
      },
    });
  } catch (error) {
    logger.error('Get vessel loading ports error:', error);
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch vessel loading ports' },
    });
  }
};

// Add or update vessel loading port
export const upsertVesselLoadingPort = async (req: AuthRequest, res: Response) => {
  try {
    const { shipmentId, portId } = req.params;
    
    // Check if shipmentId is a UUID or STO number/shipment_id, and convert to actual shipment UUID
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(shipmentId);
    let actualShipmentId: string;
    
    if (isUUID) {
      actualShipmentId = shipmentId;
    } else {
      // Find the shipment UUID by STO number or shipment_id
      const shipmentResult = await query(
        `SELECT s.id FROM shipments s
         LEFT JOIN contracts c ON s.contract_id = c.id
         WHERE c.sto_number = $1 OR s.shipment_id = $1
         LIMIT 1`,
        [shipmentId]
      );
      
      if (shipmentResult.rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: { message: 'Shipment not found' },
        });
      }
      
      actualShipmentId = shipmentResult.rows[0].id;
    }

    const {
      id: bodyId,
      port_name,
      port_sequence,
      quantity_at_loading_port,
      quality_ffa,
      quality_mi,
      quality_dobi,
      quality_red,
      quality_ds,
      quality_stone,
      eta_vessel_arrival,
      ata_vessel_arrival,
      eta_vessel_berthed,
      ata_vessel_berthed,
      eta_loading_start,
      ata_loading_start,
      eta_loading_completed,
      ata_loading_completed,
      eta_vessel_sailed,
      ata_vessel_sailed,
      eta_vessel_berthed_at_loading_port,
      eta_vessel_arrive_at_discharge_port,
      eta_vessel_berthed_at_discharge_port,
      eta_vessel_start_discharging,
      eta_vessel_complete_discharge
    } = req.body;

    // Normalize date-like fields: empty string or invalid -> null; always store YYYY-MM-DD for date columns.
    const toDateOrNull = (v: unknown): string | null => {
      if (v == null || v === '') return null;
      const s = String(v).trim();
      if (!s) return null;
      const iso = /^(\d{4}-\d{2}-\d{2})/.exec(s);
      if (iso) return iso[1];
      const dmy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
      if (dmy) {
        const dd = dmy[1].padStart(2, '0');
        const mm = dmy[2].padStart(2, '0');
        const yyyy = dmy[3];
        return `${yyyy}-${mm}-${dd}`;
      }
      const d = new Date(s);
      if (!Number.isNaN(d.getTime())) {
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        return `${yyyy}-${mm}-${dd}`;
      }
      return null;
    };
    const eta_vessel_arrival_n = toDateOrNull(eta_vessel_arrival);
    const ata_vessel_arrival_n = toDateOrNull(ata_vessel_arrival);
    const eta_vessel_berthed_n = toDateOrNull(eta_vessel_berthed);
    const ata_vessel_berthed_n = toDateOrNull(ata_vessel_berthed);
    const eta_loading_start_n = toDateOrNull(eta_loading_start);
    const ata_loading_start_n = toDateOrNull(ata_loading_start);
    const eta_loading_completed_n = toDateOrNull(eta_loading_completed);
    const ata_loading_completed_n = toDateOrNull(ata_loading_completed);
    const eta_vessel_sailed_n = toDateOrNull(eta_vessel_sailed);
    const ata_vessel_sailed_n = toDateOrNull(ata_vessel_sailed);
    const eta_vessel_berthed_at_loading_port_n = toDateOrNull(eta_vessel_berthed_at_loading_port);
    const eta_vessel_arrive_at_discharge_port_n = toDateOrNull(eta_vessel_arrive_at_discharge_port);
    const eta_vessel_berthed_at_discharge_port_n = toDateOrNull(eta_vessel_berthed_at_discharge_port);
    const eta_vessel_start_discharging_n = toDateOrNull(eta_vessel_start_discharging);
    const eta_vessel_complete_discharge_n = toDateOrNull(eta_vessel_complete_discharge);

    const toNumberOrNull = (v: unknown): number | null => {
      if (v == null || v === '') return null;
      const n = typeof v === 'number' ? v : parseFloat(String(v));
      return Number.isFinite(n) ? n : null;
    };
    const quality_ffa_n = toNumberOrNull(quality_ffa);
    const quality_mi_n = toNumberOrNull(quality_mi);
    const quality_dobi_n = toNumberOrNull(quality_dobi);
    const quality_red_n = toNumberOrNull(quality_red);
    const quality_ds_n = toNumberOrNull(quality_ds);
    const quality_stone_n = toNumberOrNull(quality_stone);

    // Prefer explicit id from body, then fallback to route param (for PUT /:shipmentId/loading-ports/:portId)
    const id = bodyId || portId;

    // Loading rate (kg/day): quantity_at_loading_port / (ATA completed − ATA start) in days
    let loading_rate = null;
    if (ata_loading_completed_n && ata_loading_start_n && quantity_at_loading_port) {
      const startTime = new Date(ata_loading_start_n);
      const endTime = new Date(ata_loading_completed_n);
      const days = (endTime.getTime() - startTime.getTime()) / (1000 * 60 * 60 * 24);
      if (days > 0) {
        loading_rate = parseFloat(String(quantity_at_loading_port)) / days;
      }
    }

    if (id) {
      // Update existing loading port
      const result = await query(
        `UPDATE vessel_loading_ports 
         SET 
           port_name = $2,
           port_sequence = $3,
           quantity_at_loading_port = $4,
           quality_ffa = $5,
           quality_mi = $6,
           quality_dobi = $7,
           quality_red = $8,
           quality_ds = $9,
           quality_stone = $10,
           eta_vessel_arrival = $11,
           ata_vessel_arrival = $12,
           eta_vessel_berthed = $13,
           ata_vessel_berthed = $14,
           eta_loading_start = $15,
           ata_loading_start = $16,
           eta_loading_completed = $17,
           ata_loading_completed = $18,
           eta_vessel_sailed = $19,
           ata_vessel_sailed = $20,
           eta_vessel_berthed_at_loading_port = $21,
           eta_vessel_arrive_at_discharge_port = $22,
           eta_vessel_berthed_at_discharge_port = $23,
           eta_vessel_start_discharging = $24,
           eta_vessel_complete_discharge = $25,
           loading_rate = $26,
           updated_at = CURRENT_TIMESTAMP
         WHERE id = $1 AND shipment_id = $27
         RETURNING *`,
        [
          id, port_name, port_sequence, quantity_at_loading_port,
          quality_ffa_n,
          quality_mi_n,
          quality_dobi_n,
          quality_red_n,
          quality_ds_n,
          quality_stone_n,
          eta_vessel_arrival_n,
          ata_vessel_arrival_n,
          eta_vessel_berthed_n,
          ata_vessel_berthed_n,
          eta_loading_start_n,
          ata_loading_start_n,
          eta_loading_completed_n,
          ata_loading_completed_n,
          eta_vessel_sailed_n,
          ata_vessel_sailed_n,
          eta_vessel_berthed_at_loading_port_n,
          eta_vessel_arrive_at_discharge_port_n,
          eta_vessel_berthed_at_discharge_port_n,
          eta_vessel_start_discharging_n,
          eta_vessel_complete_discharge_n,
          loading_rate,
          actualShipmentId,
        ]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: { message: 'Vessel loading port not found' },
        });
      }

      const updated = result.rows[0];
      if (updated.port_sequence === 1 && !updated.is_discharge_port) {
        await query(
          `UPDATE shipments SET
            eta_arrival = $2, eta_berthed = $3, eta_loading_start = $4, eta_loading_complete = $5, eta_sailed = $6,
            updated_at = CURRENT_TIMESTAMP
           WHERE id = $1`,
          [actualShipmentId, eta_vessel_arrival_n, eta_vessel_berthed_at_loading_port_n, eta_loading_start_n, eta_loading_completed_n, eta_vessel_sailed_n]
        );
      }

      invalidateShipmentsListCache();

      return res.json({
        success: true,
        data: result.rows[0],
        message: 'Vessel loading port updated successfully',
      });
    } else {
      // Create new loading port
      const result = await query(
        `INSERT INTO vessel_loading_ports 
         (shipment_id, port_name, port_sequence, quantity_at_loading_port,
          quality_ffa, quality_mi, quality_dobi, quality_red, quality_ds, quality_stone,
          eta_vessel_arrival, ata_vessel_arrival, eta_vessel_berthed, ata_vessel_berthed,
          eta_loading_start, ata_loading_start, eta_loading_completed, ata_loading_completed,
          eta_vessel_sailed, ata_vessel_sailed,
          eta_vessel_berthed_at_loading_port,
          eta_vessel_arrive_at_discharge_port,
          eta_vessel_berthed_at_discharge_port,
          eta_vessel_start_discharging,
          eta_vessel_complete_discharge,
          loading_rate)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26)
         RETURNING *`,
        [
          actualShipmentId, port_name, port_sequence, quantity_at_loading_port,
          quality_ffa_n,
          quality_mi_n,
          quality_dobi_n,
          quality_red_n,
          quality_ds_n,
          quality_stone_n,
          eta_vessel_arrival_n,
          ata_vessel_arrival_n,
          eta_vessel_berthed_n,
          ata_vessel_berthed_n,
          eta_loading_start_n,
          ata_loading_start_n,
          eta_loading_completed_n,
          ata_loading_completed_n,
          eta_vessel_sailed_n,
          ata_vessel_sailed_n,
          eta_vessel_berthed_at_loading_port_n,
          eta_vessel_arrive_at_discharge_port_n,
          eta_vessel_berthed_at_discharge_port_n,
          eta_vessel_start_discharging_n,
          eta_vessel_complete_discharge_n,
          loading_rate,
        ]
      );

      const inserted = result.rows[0];
      if (inserted.port_sequence === 1 && !inserted.is_discharge_port) {
        await query(
          `UPDATE shipments SET
            eta_arrival = $2, eta_berthed = $3, eta_loading_start = $4, eta_loading_complete = $5, eta_sailed = $6,
            updated_at = CURRENT_TIMESTAMP
           WHERE id = $1`,
          [actualShipmentId, eta_vessel_arrival_n, eta_vessel_berthed_at_loading_port_n, eta_loading_start_n, eta_loading_completed_n, eta_vessel_sailed_n]
        );
      }

      invalidateShipmentsListCache();

      return res.json({
        success: true,
        data: result.rows[0],
        message: 'Vessel loading port created successfully',
      });
    }
  } catch (error) {
    logger.error('Upsert vessel loading port error:', error);
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to save vessel loading port' },
    });
  }
};

// Cancel vessel loading port (soft cancel with required remark)
export const deleteVesselLoadingPort = async (req: AuthRequest, res: Response) => {
  try {
    const { shipmentId, portId } = req.params;
    const remark = String(req.body?.remark ?? '').trim();
    const hasCancelColumn = await vesselLoadingPortHasCancelColumn();
    const hasCancelledByColumn = await vesselLoadingPortHasCancelledByColumn();
    const cancelledByUserId = req.user?.id ?? null;

    if (!remark) {
      return res.status(400).json({
        success: false,
        error: { message: 'Cancellation remark is required' },
      });
    }

    if (!hasCancelColumn) {
      return res.status(409).json({
        success: false,
        error: { message: 'Cancellation is not ready: please run latest database migration first' },
      });
    }

    const existing = await query(
      'SELECT * FROM vessel_loading_ports WHERE id = $1 AND shipment_id = $2',
      [portId, shipmentId]
    );

    if (existing.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: { message: 'Vessel loading port not found' },
      });
    }

    const port = existing.rows[0];
    if (port.is_discharge_port) {
      return res.status(400).json({
        success: false,
        error: { message: 'Discharge ports cannot be cancelled via this action' },
      });
    }

    if (port.is_cancelled) {
      return res.status(400).json({
        success: false,
        error: { message: 'Loading port is already cancelled' },
      });
    }

    const result = hasCancelledByColumn
      ? await query(
          `UPDATE vessel_loading_ports
           SET is_cancelled = true,
               cancel_remark = $3,
               cancelled_at = CURRENT_TIMESTAMP,
               cancelled_by_user_id = $4,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $1 AND shipment_id = $2
           RETURNING *`,
          [portId, shipmentId, remark, cancelledByUserId]
        )
      : await query(
          `UPDATE vessel_loading_ports
           SET is_cancelled = true,
               cancel_remark = $3,
               cancelled_at = CURRENT_TIMESTAMP,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $1 AND shipment_id = $2
           RETURNING *`,
          [portId, shipmentId, remark]
        );

    invalidateShipmentsListCache();

    return res.json({
      success: true,
      data: result.rows[0],
      message: 'Vessel loading port cancelled successfully',
    });
  } catch (error) {
    logger.error('Cancel vessel loading port error:', error);
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to cancel vessel loading port' },
    });
  }
};

// =========================
// Daily Planning Deliverables (SEA Shipments)
// =========================

const MAX_BULK_SHIPMENT_PLANNING_ROWS = 10000;

function normalizePlanningHeader(v: unknown): string {
  return String(v ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function findPlanningColumnIndex(headers: unknown[], candidates: string[]): number {
  const norm = headers.map(normalizePlanningHeader);
  const candNorm = candidates.map(normalizePlanningHeader);
  for (let i = 0; i < norm.length; i++) {
    const h = norm[i].replace(/\s/g, '_');
    for (const c of candNorm) {
      const cc = c.replace(/\s/g, '_');
      if (norm[i] === c || h === cc) return i;
    }
  }
  return -1;
}

export const downloadShipmentDailyPlanningDeliverablesTemplate = async (_req: AuthRequest, res: Response) => {
  const header = 'contract_ext_no,date,quantity_delivered';
  const example = 'EXT-12345,15/04/2026,1000';
  const bom = '\ufeff';
  const body = `${bom}${header}\n${example}\n`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="shipment_daily_planning_deliverables_template.csv"');
  return res.status(200).send(body);
};

export const getShipmentDailyDeliverablesCalendar = async (req: AuthRequest, res: Response) => {
  try {
    const from = String((req.query as any).from || '').slice(0, 10);
    const to = String((req.query as any).to || '').slice(0, 10);
    if (!from || !to) {
      return res.status(400).json({ success: false, error: { message: 'from and to are required (YYYY-MM-DD)' } });
    }

    const result = await query(
      `
      WITH latest_spd AS (
        SELECT DISTINCT ON (spd.contract_number)
          spd.contract_number,
          COALESCE(spd.data->'raw'->>'Contract Ext No', spd.data->>'Contract Ext No') AS contract_ext_no,
          spd.data AS data
        FROM sap_processed_data spd
        WHERE spd.contract_number IS NOT NULL AND TRIM(spd.contract_number) != ''
        ORDER BY spd.contract_number, spd.created_at DESC NULLS LAST
      ),
      vlp_disc_first AS (
        SELECT DISTINCT ON (shipment_id)
          shipment_id,
          ata_loading_completed::date AS ata_vessel_complete_discharge
        FROM vessel_loading_ports
        WHERE COALESCE(is_discharge_port, false) = true
        ORDER BY shipment_id, port_sequence NULLS LAST, id
      )
      SELECT
        s.id,
        s.shipment_id,
        c.contract_id AS contract_number,
        COALESCE(NULLIF(TRIM(c.sto_number::text), ''), NULL) AS sto_number,
        COALESCE(l.contract_ext_no, NULL) AS contract_ext_no,
        s.vessel_name,
        c.supplier,
        c.product,
        c.group_name,
        c.source_type,
        COALESCE(l.data->'contract'->>'ltc_spot', c.contract_type::text) AS lt_spot,
        c.delivery_start_date,
        c.delivery_end_date,
        s.bl_quantity,
        s.quantity_shipped,
        s.actual_vessel_qty_receive,
        GREATEST(COALESCE(c.quantity_ordered, 0) - COALESCE(s.actual_vessel_qty_receive, s.bl_quantity, s.quantity_shipped, 0), 0) AS outstanding_quantity,
        s.daily_deliverables,
        COALESCE(s.ata_discharge_complete::date, vd.ata_vessel_complete_discharge) AS ata_vessel_complete_discharge,
        s.updated_at
      FROM shipments s
      LEFT JOIN contracts c ON s.contract_id = c.id
      LEFT JOIN latest_spd l ON l.contract_number = c.contract_id
      LEFT JOIN vlp_disc_first vd ON vd.shipment_id = s.id
      WHERE
        UPPER(COALESCE(NULLIF(TRIM(c.transport_mode), ''), 'SEA')) IN ('SEA', 'MIX')
        AND COALESCE(c.delivery_start_date, s.shipment_date, c.delivery_end_date, s.arrival_date) <= $2::date
        AND COALESCE(c.delivery_end_date, s.arrival_date, c.delivery_start_date, s.shipment_date) >= $1::date
      ORDER BY COALESCE(s.ata_discharge_complete::date, vd.ata_vessel_complete_discharge) ASC NULLS LAST, COALESCE(c.delivery_start_date, s.shipment_date) ASC NULLS LAST, s.shipment_id ASC
      `,
      [from, to],
    );

    return res.json({ success: true, data: result.rows });
  } catch (error) {
    logger.error('Get shipment daily deliverables calendar error:', error);
    return res.status(500).json({ success: false, error: { message: 'Failed to load shipment daily planning deliverables' } });
  }
};

export const updateShipmentDailyDeliverables = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { daily_deliverables } = req.body || {};

    const curRes = await query(
      `SELECT s.id,
              c.delivery_start_date,
              c.delivery_end_date,
              COALESCE(s.bl_quantity, s.quantity_shipped, s.actual_vessel_qty_receive) AS max_qty
       FROM shipments s
       LEFT JOIN contracts c ON s.contract_id = c.id
       WHERE s.id = $1
       LIMIT 1`,
      [id],
    );
    if (curRes.rows.length === 0) {
      return res.status(404).json({ success: false, error: { message: 'Shipment not found' } });
    }
    const cur = curRes.rows[0];

    const dd = normalizeAndValidateShipmentDailyDeliverables({
      daily_deliverables,
      startRaw: cur.delivery_start_date,
      endRaw: cur.delivery_end_date,
      maxQtyRaw: cur.max_qty,
    });
    if (!dd.ok) {
      return res.status(400).json({ success: false, error: { message: dd.message } });
    }

    const upd = await query(
      `UPDATE shipments
       SET daily_deliverables = $2::jsonb, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1
       RETURNING *`,
      [id, JSON.stringify(dd.rows)],
    );

    return res.json({ success: true, data: upd.rows[0], message: 'Shipment daily planning deliverables updated successfully' });
  } catch (error) {
    logger.error('Update shipment daily deliverables error:', error);
    return res.status(500).json({ success: false, error: { message: 'Failed to update shipment daily planning deliverables' } });
  }
};

export const bulkUploadShipmentDailyDeliverables = async (req: AuthRequest, res: Response) => {
  try {
    const file = (req as AuthRequest & { file?: Express.Multer.File }).file;
    if (!file?.buffer) {
      return res.status(400).json({ success: false, error: { message: 'File is required (CSV or Excel)' } });
    }

    let matrix: unknown[][];
    try {
      matrix = parsePlanningSheetToMatrix(file.buffer);
    } catch (e: any) {
      return res.status(400).json({ success: false, error: { message: e?.message || 'Could not read spreadsheet' } });
    }
    if (matrix.length < 2) {
      return res.status(400).json({ success: false, error: { message: 'File must include a header row and at least one data row' } });
    }

    const headerRow = matrix[0];
    const extIdx = findPlanningColumnIndex(headerRow, ['contract_ext_no', 'contract ext no', 'ext no']);
    const dateIdx = findPlanningColumnIndex(headerRow, ['date', 'tanggal']);
    const qtyIdx = findPlanningColumnIndex(headerRow, ['quantity_delivered', 'quantity delivered', 'quantity', 'qty']);
    if (extIdx < 0 || dateIdx < 0 || qtyIdx < 0) {
      return res.status(400).json({
        success: false,
        error: { message: 'Missing required columns. Expected headers: contract_ext_no, date, quantity_delivered' },
      });
    }

    type ParsedLine = { lineNumber: number; contract_ext_no: string; dateRaw: unknown; qtyRaw: unknown };
    const lines: ParsedLine[] = [];
    const rowParseFailures: { rowNumber: number; contract_ext_no: string; reason: string }[] = [];

    for (let rIdx = 1; rIdx < matrix.length; rIdx++) {
      const row = matrix[rIdx];
      const ext = String(row[extIdx] ?? '').trim();
      const dateRaw = row[dateIdx];
      const qtyCell = row[qtyIdx];
      const emptyRow =
        !ext &&
        (dateRaw === undefined || dateRaw === null || String(dateRaw).trim() === '') &&
        (qtyCell === undefined || qtyCell === null || String(qtyCell).trim() === '');
      if (emptyRow) continue;

      const lineNumber = rIdx + 1;
      if (lines.length >= MAX_BULK_SHIPMENT_PLANNING_ROWS) {
        rowParseFailures.push({ rowNumber: lineNumber, contract_ext_no: ext || '-', reason: `File exceeds maximum of ${MAX_BULK_SHIPMENT_PLANNING_ROWS} data rows` });
        break;
      }
      if (!ext) {
        rowParseFailures.push({ rowNumber: lineNumber, contract_ext_no: '-', reason: 'contract_ext_no is required' });
        continue;
      }
      lines.push({ lineNumber, contract_ext_no: ext, dateRaw: dateRaw ?? '', qtyRaw: qtyCell });
    }

    const byExt = new Map<string, ParsedLine[]>();
    for (const ln of lines) {
      const k = ln.contract_ext_no.trim().toLowerCase();
      const list = byExt.get(k) || [];
      list.push(ln);
      byExt.set(k, list);
    }

    const opFailures: { contract_ext_no: string; rowNumbers: number[]; reason: string; shipment_ids?: string[] }[] = [];
    let succeeded = 0;
    let succeededRows = 0;

    for (const [, group] of byExt.entries()) {
      const ext = group[0].contract_ext_no.trim();
      const rowNumbers = group.map((g) => g.lineNumber);
      const dateToLast = new Map<string, { quantity_delivered: number; lineNumber: number }>();
      let validLines = 0;

      for (const g of group) {
        const iso = toIsoDate10FromCell(g.dateRaw);
        if (!iso) {
          rowParseFailures.push({ rowNumber: g.lineNumber, contract_ext_no: ext, reason: 'date is missing or invalid (use DD/MM/YYYY or YYYY-MM-DD)' });
          continue;
        }
        const qn = parseDailyDeliverableQuantity(g.qtyRaw);
        if (qn === null || qn < 0) {
          rowParseFailures.push({ rowNumber: g.lineNumber, contract_ext_no: ext, reason: 'quantity_delivered must be a valid non-negative number' });
          continue;
        }
        dateToLast.set(iso, { quantity_delivered: qn, lineNumber: g.lineNumber });
        validLines += 1;
      }
      if (dateToLast.size === 0) continue;

      const dailyWithLine = Array.from(dateToLast.entries())
        .map(([date, v]) => ({ date, quantity_delivered: v.quantity_delivered, lineNumber: v.lineNumber }))
        .sort((a, b) => a.date.localeCompare(b.date));

      const shipRes = await query(
        `SELECT s.id,
                s.shipment_id,
                c.delivery_start_date,
                c.delivery_end_date,
                COALESCE(s.bl_quantity, s.quantity_shipped, s.actual_vessel_qty_receive) AS max_qty
         FROM shipments s
         LEFT JOIN contracts c ON s.contract_id = c.id
         LEFT JOIN LATERAL (
           SELECT NULLIF(trim(COALESCE(spd.data->'raw'->>'Contract Ext No', spd.data->>'Contract Ext No')), '') AS ext_no
           FROM sap_processed_data spd
           WHERE spd.contract_number = c.contract_id
           ORDER BY spd.created_at DESC NULLS LAST
           LIMIT 1
         ) ext ON true
         WHERE trim(upper(COALESCE(ext.ext_no, ''))) = trim(upper($1::text))`,
        [ext],
      );

      if (shipRes.rows.length === 0) {
        opFailures.push({ contract_ext_no: ext, rowNumbers, reason: 'No shipment found for this Contract Ext No' });
        continue;
      }
      if (shipRes.rows.length > 1) {
        opFailures.push({ contract_ext_no: ext, rowNumbers, reason: 'Multiple shipments share this Contract Ext No; cannot apply upload automatically', shipment_ids: shipRes.rows.map((r: any) => r.shipment_id) });
        continue;
      }

      const cur = shipRes.rows[0];
      const startS = toIsoDate10FromCell(cur.delivery_start_date);
      const endS = toIsoDate10FromCell(cur.delivery_end_date);

      const inWindow =
        startS && endS
          ? dailyWithLine.filter((r) => {
              const ok = r.date >= startS && r.date <= endS;
              if (!ok) {
                rowParseFailures.push({
                  rowNumber: r.lineNumber,
                  contract_ext_no: ext,
                  reason: `date ${r.date} is outside Due Start (${startS}) … Due End (${endS}) and was skipped`,
                });
              }
              return ok;
            })
          : dailyWithLine;

      if (inWindow.length === 0) {
        opFailures.push({
          contract_ext_no: ext,
          rowNumbers,
          reason:
            startS && endS
              ? `All rows are outside Due Start (${startS}) … Due End (${endS}); nothing to upload`
              : 'Due Start/Due End are required when daily deliverables are provided',
        });
        continue;
      }

      const daily = inWindow.map(({ date, quantity_delivered }) => ({ date, quantity_delivered }));
      const dd = normalizeAndValidateShipmentDailyDeliverables({
        daily_deliverables: daily,
        startRaw: cur.delivery_start_date,
        endRaw: cur.delivery_end_date,
        maxQtyRaw: cur.max_qty,
      });
      if (!dd.ok) {
        opFailures.push({ contract_ext_no: ext, rowNumbers, reason: dd.message, shipment_ids: [cur.shipment_id] });
        continue;
      }

      await query(
        `UPDATE shipments SET daily_deliverables = $2::jsonb, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [cur.id, JSON.stringify(dd.rows)],
      );
      succeeded += 1;
      succeededRows += inWindow.length;
    }

    return res.json({
      success: true,
      data: {
        processedRows: lines.length,
        succeededOperations: succeeded,
        failedOperations: opFailures.length,
        succeededRows,
        rowLevelIssues: rowParseFailures.length,
        operationLevelFailures: opFailures.length,
        rowParseFailures,
        operationFailures: opFailures,
      },
    });
  } catch (error) {
    logger.error('Bulk upload shipment daily planning deliverables error:', error);
    return res.status(500).json({ success: false, error: { message: 'Failed to process upload' } });
  }
};

export const bulkUpdateShipments = async (req: AuthRequest, res: Response) => {
  try {
    const file = (req as AuthRequest & { file?: Express.Multer.File }).file;
    if (!file?.buffer) {
      return res.status(400).json({ success: false, error: { message: 'File is required (CSV or Excel)' } });
    }

    let matrix: unknown[][];
    try {
      matrix = parsePlanningSheetToMatrix(file.buffer);
    } catch (e: any) {
      return res.status(400).json({ success: false, error: { message: e?.message || 'Could not read file' } });
    }
    if (matrix.length < 2) {
      return res.status(400).json({ success: false, error: { message: 'File must include a header row and at least one data row' } });
    }

    const headerRow = matrix[0];
    const poIdx       = findPlanningColumnIndex(headerRow, ['po number', 'po_number', 'sto number', 'sto_number']);
    const vesselIdx   = findPlanningColumnIndex(headerRow, ['vessel name', 'vessel_name']);
    const lpPortIdx   = findPlanningColumnIndex(headerRow, ['loading port', 'loading_port']);
    const dpPortIdx   = findPlanningColumnIndex(headerRow, ['discharge port', 'discharge_port']);
    const qtyIdx      = findPlanningColumnIndex(headerRow, ['qty delivery', 'qty_delivery', 'quantity delivered', 'quantity_delivered']);
    const etaLpArrIdx = findPlanningColumnIndex(headerRow, ['eta vessel arrival at loading port', 'eta_vessel_arrival']);
    const etaLpBrtIdx = findPlanningColumnIndex(headerRow, ['eta vessel berthed at loading port', 'eta_vessel_berthed']);
    const etaLpStaIdx = findPlanningColumnIndex(headerRow, ['eta vessel start loading', 'eta_loading_start']);
    const etaLpCmpIdx = findPlanningColumnIndex(headerRow, ['eta vessel completed loading', 'eta_loading_completed']);
    const etaLpSalIdx = findPlanningColumnIndex(headerRow, ['eta vessel sailed from loading port', 'eta_vessel_sailed']);
    const etaDpArrIdx = findPlanningColumnIndex(headerRow, ['eta vessel arrive at discharge port', 'eta_discharge_arrival']);
    const etaDpBrtIdx = findPlanningColumnIndex(headerRow, ['eta vessel berthed at discharge port', 'eta_discharge_berthed']);
    const etaDpStaIdx = findPlanningColumnIndex(headerRow, ['eta vessel start discharging', 'eta_discharge_start']);
    const etaDpCmpIdx = findPlanningColumnIndex(headerRow, ['eta vessel complete discharge', 'eta_discharge_complete']);

    if (poIdx < 0) {
      return res.status(400).json({ success: false, error: { message: 'Missing required column: "PO Number"' } });
    }

    const successes: string[] = [];
    const failures: { poNumber: string; reason: string }[] = [];

    for (let rIdx = 1; rIdx < matrix.length; rIdx++) {
      const row = matrix[rIdx];
      const poNumber = String(row[poIdx] ?? '').trim();
      if (!poNumber) continue;

      // Find shipment by STO number (contracts) or shipment_id
      let shipRes: any;
      try {
        shipRes = await query(
          `SELECT DISTINCT s.id
           FROM shipments s
           JOIN contracts c ON s.contract_id = c.id
           WHERE TRIM(COALESCE(c.sto_number::text, '')) = $1
              OR TRIM(s.shipment_id) = $1
           LIMIT 2`,
          [poNumber],
        );
      } catch {
        failures.push({ poNumber, reason: 'Database error during lookup' });
        continue;
      }

      if (shipRes.rows.length === 0) {
        failures.push({ poNumber, reason: 'Shipment not found' });
        continue;
      }
      if (shipRes.rows.length > 1) {
        failures.push({ poNumber, reason: 'Multiple shipments found for this PO Number — cannot update automatically' });
        continue;
      }
      const shipUuid = shipRes.rows[0].id;

      // --- Update shipments table ---
      const shipCols: string[] = [];
      const shipVals: any[] = [];

      const addShipText = (idx: number, col: string) => {
        const v = String(row[idx] ?? '').trim();
        if (v) { shipCols.push(col); shipVals.push(v); }
      };
      const addShipDate = (idx: number, col: string) => {
        if (idx < 0) return;
        const iso = toIsoDate10FromCell(row[idx]);
        if (iso) { shipCols.push(col); shipVals.push(iso); }
      };
      const addShipNum = (idx: number, col: string) => {
        if (idx < 0) return;
        const n = parseFloat(String(row[idx] ?? '').replace(/,/g, ''));
        if (!isNaN(n) && n >= 0) { shipCols.push(col); shipVals.push(n); }
      };

      if (vesselIdx >= 0) addShipText(vesselIdx, 'vessel_name');
      if (dpPortIdx >= 0) addShipText(dpPortIdx, 'plant_site');
      addShipNum(qtyIdx, 'quantity_delivered');
      addShipDate(etaDpArrIdx, 'eta_discharge_arrival');
      addShipDate(etaDpBrtIdx, 'eta_discharge_berthed');
      addShipDate(etaDpStaIdx, 'eta_discharge_start');
      addShipDate(etaDpCmpIdx, 'eta_discharge_complete');

      if (shipCols.length > 0) {
        const setClauses = shipCols.map((c, i) => `${c} = $${i + 2}`).join(', ');
        await query(
          `UPDATE shipments SET ${setClauses}, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
          [shipUuid, ...shipVals],
        );
      }

      // --- Update vessel_loading_ports (port_sequence=1, not discharge) ---
      const lpCols: string[] = [];
      const lpVals: any[] = [];

      const addLpText = (idx: number, col: string) => {
        const v = String(row[idx] ?? '').trim();
        if (v) { lpCols.push(col); lpVals.push(v); }
      };
      const addLpDate = (idx: number, col: string) => {
        if (idx < 0) return;
        const iso = toIsoDate10FromCell(row[idx]);
        if (iso) { lpCols.push(col); lpVals.push(iso); }
      };

      if (lpPortIdx >= 0) addLpText(lpPortIdx, 'port_name');
      addLpDate(etaLpArrIdx, 'eta_vessel_arrival');
      addLpDate(etaLpBrtIdx, 'eta_vessel_berthed');
      addLpDate(etaLpStaIdx, 'eta_loading_start');
      addLpDate(etaLpCmpIdx, 'eta_loading_completed');
      addLpDate(etaLpSalIdx, 'eta_vessel_sailed');

      if (lpCols.length > 0) {
        const setClauses = lpCols.map((c, i) => `${c} = $${i + 2}`).join(', ');
        const upd = await query(
          `UPDATE vessel_loading_ports SET ${setClauses}, updated_at = CURRENT_TIMESTAMP
           WHERE shipment_id = $1 AND port_sequence = 1 AND COALESCE(is_discharge_port, false) = false`,
          [shipUuid, ...lpVals],
        );
        if ((upd.rowCount ?? 0) === 0) {
          const allCols = ['shipment_id', 'port_sequence', 'is_discharge_port', ...lpCols];
          const allVals = [shipUuid, 1, false, ...lpVals];
          const placeholders = allVals.map((_, i) => `$${i + 1}`).join(', ');
          await query(
            `INSERT INTO vessel_loading_ports (${allCols.join(', ')}) VALUES (${placeholders})`,
            allVals,
          );
        }
      }

      successes.push(poNumber);
    }

    if (successes.length > 0) invalidateShipmentsListCache();

    return res.json({
      success: true,
      data: {
        updated: successes.length,
        failed: failures.length,
        failures,
      },
    });
  } catch (error) {
    logger.error('Bulk update shipments error:', error);
    return res.status(500).json({ success: false, error: { message: 'Failed to process bulk update' } });
  }
};

// Get contract suggestions for auto-complete
export const getContractSuggestions = async (req: AuthRequest, res: Response) => {
  try {
    const { q } = req.query;
    
    if (!q || String(q).trim().length < 2) {
      return res.json({
        success: true,
        data: []
      });
    }

    const result = await query(
      `
      SELECT 
        c.contract_id,
        c.po_number,
        c.supplier,
        c.product,
        c.group_name,
        COALESCE(
          NULLIF(TRIM(c.sto_number::text), ''),
          (
            SELECT NULLIF(TRIM(COALESCE(
              spd.sto_number::text,
              spd.data->'raw'->>'STO No.',
              spd.data->'raw'->>'STO Number',
              spd.data->'shipment'->>'sto_no',
              spd.data->'contract'->>'sto_no'
            )), '')
            FROM sap_processed_data spd
            WHERE spd.contract_number = c.contract_id
            ORDER BY spd.created_at DESC NULLS LAST
            LIMIT 1
          )
        ) AS sto_number,
        c.sto_quantity
      FROM contracts c
      LEFT JOIN LATERAL (
        SELECT
          COALESCE(spd.data->'contract'->>'contract_type', spd.data->>'B2B Flag') AS b2b_flag,
          COALESCE(
            spd.data->'contract'->>'contract_reference_po',
            spd.data->>'CONTRACT REFF PO',
            spd.data->>'Contract Reff PO Ini',
            spd.data->'raw'->>'Contract Reff PO Ini',
            spd.data->'raw'->>'CONTRACT REFF PO'
          ) AS contract_reference_po
        FROM sap_processed_data spd
        WHERE spd.contract_number = c.contract_id
        ORDER BY spd.created_at DESC NULLS LAST
        LIMIT 1
      ) spd_b2b ON TRUE
      WHERE UPPER(COALESCE(c.status, '')) IN ('OPEN', 'ACTIVE')
        AND (
          c.po_number ILIKE $1
          OR c.contract_id ILIKE $1
        )
        AND NOT (
          UPPER(TRIM(COALESCE(spd_b2b.b2b_flag, c.contract_type::text, ''))) = 'B2B'
          AND NULLIF(TRIM(COALESCE(spd_b2b.contract_reference_po, '')), '') IS NOT NULL
        )
      ORDER BY COALESCE(NULLIF(TRIM(c.po_number), ''), c.contract_id)
      LIMIT 10
    `,
      [`%${q}%`],
    );

    return res.json({
      success: true,
      data: result.rows
    });
  } catch (error) {
    logger.error('Get contract suggestions error:', error);
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to get contract suggestions' },
    });
  }
};

export const getContractPurchaseOrders = async (req: AuthRequest, res: Response) => {
  try {
    const contractId = String(req.params.contractId || '').trim();
    if (!contractId) {
      return res.status(400).json({
        success: false,
        error: { message: 'Contract ID is required' },
      });
    }

    const exists = await query(
      `SELECT 1 FROM contracts WHERE contract_id = $1 LIMIT 1`,
      [contractId],
    );
    if (exists.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: { message: 'Contract not found' },
      });
    }

    const purchaseOrders = await fetchPurchaseOrderLines(contractId);
    return res.json({
      success: true,
      data: purchaseOrders,
    });
  } catch (error) {
    logger.error('Get contract purchase orders error:', error);
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch purchase orders' },
    });
  }
};

// Validate contract number and return contract details
export const validateContractNumber = async (req: AuthRequest, res: Response) => {
  try {
    const { contract_number } = req.query;

    if (!contract_number) {
      return res.status(400).json({
        success: false,
        error: { message: 'Contract number is required' },
      });
    }

    const raw = String(contract_number).trim();
    const result = await query(
      `
      WITH matched AS (
        SELECT c.*
        FROM contracts c
        WHERE c.contract_id = $1
           OR c.po_number = $1
        ORDER BY (c.contract_id = $1) DESC
        LIMIT 1
      )
      SELECT 
        c.id,
        c.contract_id,
        c.po_number,
        COALESCE(
          NULLIF(TRIM(c.sto_number::text), ''),
          (
            SELECT NULLIF(TRIM(COALESCE(
              spd.sto_number::text,
              spd.data->'raw'->>'STO No.',
              spd.data->'raw'->>'STO Number',
              spd.data->'shipment'->>'sto_no',
              spd.data->'contract'->>'sto_no'
            )), '')
            FROM sap_processed_data spd
            WHERE spd.contract_number = c.contract_id
            ORDER BY spd.created_at DESC NULLS LAST
            LIMIT 1
          )
        ) AS sto_number,
        c.supplier,
        c.buyer,
        c.product,
        c.incoterm,
        c.group_name,
        c.quantity_ordered,
        COALESCE(
          c.quantity_ordered - COALESCE(
            CASE
              WHEN UPPER(TRIM(COALESCE(c.incoterm, ''))) IN ('FRC', 'CIF', 'CFR') THEN (
                SELECT SUM(CAST(REPLACE(REPLACE(COALESCE(spd.data->'raw'->>'Quantity Receive', spd.data->'raw'->>'Qty Receive'), ',', ''), ' ', '') AS NUMERIC))
                FROM sap_processed_data spd
                WHERE spd.contract_number = c.contract_id
                  AND NULLIF(TRIM(COALESCE(spd.data->'raw'->>'Quantity Receive', spd.data->'raw'->>'Qty Receive')), '') IS NOT NULL
              )
              WHEN UPPER(TRIM(COALESCE(c.incoterm, ''))) IN ('LCO', 'FOB') THEN (
                SELECT SUM(CAST(REPLACE(REPLACE(COALESCE(spd.data->'raw'->>'Quantity Delivered', spd.data->'raw'->>'Quantity Delivery'), ',', ''), ' ', '') AS NUMERIC))
                FROM sap_processed_data spd
                WHERE spd.contract_number = c.contract_id
                  AND NULLIF(TRIM(COALESCE(spd.data->'raw'->>'Quantity Delivered', spd.data->'raw'->>'Quantity Delivery')), '') IS NOT NULL
              )
              ELSE (
                SELECT SUM(CAST(REPLACE(REPLACE(data->'contract'->>'sto_quantity', ',', ''), ' ', '') AS NUMERIC))
                FROM sap_processed_data 
                WHERE contract_number = c.contract_id 
                  AND sto_number IS NOT NULL 
                  AND data->'contract'->>'sto_quantity' IS NOT NULL
              )
            END,
            0
          ),
          c.quantity_ordered
        ) AS outstanding_quantity,
        c.unit,
        c.contract_date,
        c.delivery_start_date,
        c.delivery_end_date,
        c.transport_mode,
        ${resolvedPlantCodeSql('c.contract_id', 'c.po_number', 'c.plant_code')} AS plant_code,
        ${groupPlantExpr(resolvedPlantCodeSql('c.contract_id', 'c.po_number', 'c.plant_code'), 'c.company_name')} AS plant_site,
        ${contractExtNoSubquery('c.contract_id', 'c.po_number')} AS contract_ext_no,
        ${resolvedLoadingPortNameSql('c.contract_id')} AS port_of_loading,
        ${resolvedDischargePortNameSql('c.contract_id')} AS port_of_discharge,
        ${SQL_CONTRACT_IMPORT_STATUS} AS import_status
      FROM matched c
      LIMIT 1
      `,
      [raw]
    );

    if (result.rows.length === 0) {
      return res.json({
        success: true,
        exists: false,
        message: 'Contract number does not exist',
      });
    }

    const contractRow = result.rows[0];
    const purchaseOrders = await fetchPurchaseOrderLines(String(contractRow.contract_id));

    return res.json({
      success: true,
      exists: true,
      data: contractRow,
      purchase_orders: purchaseOrders,
    });
  } catch (error) {
    logger.error('Validate contract number error:', error);
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to validate contract number' },
    });
  }
};

// Check if STO number already exists
export const checkStoExists = async (req: AuthRequest, res: Response) => {
  try {
    const { stoNumber } = req.params;
    
    const result = await query(`
      SELECT 
        sto_number,
        STRING_AGG(DISTINCT contract_id, ', ' ORDER BY contract_id) as contract_numbers,
        COUNT(DISTINCT contract_id) as contract_count
      FROM contracts 
      WHERE sto_number = $1
      GROUP BY sto_number
    `, [stoNumber]);

    if (result.rows.length > 0) {
      return res.json({
        success: true,
        exists: true,
        data: result.rows[0]
      });
    }

    return res.json({
      success: true,
      exists: false,
      data: null
    });
  } catch (error) {
    logger.error('Check STO exists error:', error);
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to check STO number' },
    });
  }
};

/** SAP vessel / discharge preview for Add Shipment when STO already exists in SAP. */
export const getStoSapPreview = async (req: AuthRequest, res: Response) => {
  try {
    const sto = String(req.query.sto ?? '').trim();
    if (!sto) {
      return res.status(400).json({
        success: false,
        error: { message: 'STO number is required' },
      });
    }
    const data = await fetchStoSapPreview(sto);
    return res.json({ success: true, data });
  } catch (error) {
    logger.error('Get STO SAP preview error:', error);
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch SAP STO preview' },
    });
  }
};

// Create new shipment
// Get contract details with STO quantity assigned for a specific STO
export const getContractDetailsForSto = async (req: AuthRequest, res: Response) => {
  try {
    const { sto, contractNumbers } = req.query;

    if (!sto) {
      return res.status(400).json({
        success: false,
        error: { message: 'STO number is required' },
      });
    }

    const stoTrim = String(sto).trim();
    const contractList = contractNumbers ? String(contractNumbers).split(',').map(c => c.trim()).filter(Boolean) : [];

    await ensureUserStoContractAssignmentsTable();

    const queryText = buildContractDetailsForStoSql();
    const result = await query(queryText, [stoTrim, contractList]);

    return res.json({
      success: true,
      data: result.rows,
    });
  } catch (error) {
    logger.error('Get contract details for STO error:', error);
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch contract details' },
    });
  }
};

// Update STO quantity assigned for a contract (user input)
export const updateStoQtyAssigned = async (req: AuthRequest, res: Response) => {
  try {
    const { sto, contractNumber, stoQtyAssigned } = req.body;

    if (!sto || !contractNumber || stoQtyAssigned === undefined) {
      return res.status(400).json({
        success: false,
        error: { message: 'STO number, contract number, and STO quantity assigned are required' },
      });
    }

    await ensureUserStoContractAssignmentsTable();

    // Create update timestamp trigger if it doesn't exist
    await query(`
      CREATE OR REPLACE FUNCTION update_user_sto_contract_assignments_updated_at()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = CURRENT_TIMESTAMP;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);

    await query(`
      DROP TRIGGER IF EXISTS update_user_sto_contract_assignments_updated_at ON user_sto_contract_assignments;
      CREATE TRIGGER update_user_sto_contract_assignments_updated_at
      BEFORE UPDATE ON user_sto_contract_assignments
      FOR EACH ROW EXECUTE FUNCTION update_user_sto_contract_assignments_updated_at();
    `);

    // Upsert the STO quantity assigned
    await query(`
      INSERT INTO user_sto_contract_assignments (sto_number, contract_number, sto_qty_assigned)
      VALUES ($1, $2, $3::numeric)
      ON CONFLICT (sto_number, contract_number)
      DO UPDATE SET 
        sto_qty_assigned = EXCLUDED.sto_qty_assigned,
        updated_at = CURRENT_TIMESTAMP
    `, [sto, contractNumber, parseFloat(String(stoQtyAssigned)) || 0]);

    invalidateShipmentsListCache();

    return res.json({
      success: true,
      message: 'STO quantity assigned updated successfully',
    });
  } catch (error) {
    logger.error('Update STO quantity assigned error:', error);
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to update STO quantity assigned' },
    });
  }
};

export const createShipment = async (req: AuthRequest, res: Response) => {
  try {
    const {
      operationId,
      stoNumber,
      contractNumbers,
      contractQtyAssigned,
      poQtyAssigned,
      vesselName,
      vesselCode,
      voyageNo,
      vesselOwner,
      vesselDraft,
      vesselCapacity,
      vesselHullType,
      charterType,
      portOfLoading,
      portOfDischarge,
      quantityShipped,
      quantityDelivered,
      eta_arrival,
      eta_berthed,
      eta_loading_start,
      eta_loading_complete,
      eta_sailed,
      eta_discharge_arrival,
      eta_discharge_berthed,
      eta_discharge_start,
      eta_discharge_complete,
      etaByContract,
    } = req.body;

    // Validate required fields - Contract Numbers are required, STO Number is optional
    if (!contractNumbers || !Array.isArray(contractNumbers) || contractNumbers.length === 0) {
      return res.status(400).json({
        success: false,
        error: { message: 'At least one Contract Number is required' },
      });
    }

    // For manual shipments, STO Number should be empty (will be filled from SAP Data later)
    // Only check STO if it's explicitly provided and not empty
    const hasStoNumber = stoNumber && stoNumber.trim() !== ''
    if (hasStoNumber) {
      const stoTrim = String(stoNumber).trim();
      if (isOfficialSapStoNumber(stoTrim)) {
        if (await officialSapStoHasRegisteredPlanning(stoTrim)) {
          return res.status(400).json({
            success: false,
            error: {
              message: `STO Number ${stoTrim} already has shipment planning. Please update the existing shipment instead of creating a new one.`,
            },
          });
        }
      } else {
        const stoCheck = await query(`
          SELECT sto_number FROM contracts WHERE sto_number = $1 LIMIT 1
        `, [stoTrim]);

        if (stoCheck.rows.length > 0) {
          return res.status(400).json({
            success: false,
            error: { message: `STO Number ${stoTrim} already exists. Please update the existing shipment instead of creating a new one.` },
          });
        }
      }
    }

    // Validate that all contract numbers exist
    const contractCheck = await query(`
      SELECT contract_id, id FROM contracts 
      WHERE contract_id = ANY($1)
    `, [contractNumbers]);

    if (contractCheck.rows.length !== contractNumbers.length) {
      const foundContracts = contractCheck.rows.map(row => row.contract_id);
      const missingContracts = contractNumbers.filter(id => !foundContracts.includes(id));
      return res.status(400).json({
        success: false,
        error: { message: `The following contract numbers do not exist: ${missingContracts.join(', ')}` },
      });
    }

    // Create shipment for each contract
    // All shipments will share the same operation_id (one transaction)
    // If STO is not provided (manual shipment), operation_id is used as the grouping key in list queries.
    const shipmentIds: string[] = [];
    const timestamp = Date.now().toString()
    
    // Vessel capacity vs plan qty validation temporarily disabled (incomplete master vessel data).
    let resolvedOperationId: string | null =
      operationId != null && String(operationId).trim() !== ''
        ? String(operationId).trim()
        : null;
    if (!resolvedOperationId && !hasStoNumber) {
      const dmy = formatDDMMYYYY(new Date());
      const seq = await allocateNextSyntheticSequenceDefault('shipments', 'SEA', dmy);
      resolvedOperationId = buildSyntheticOperationId('SEA', dmy, seq);
    }

    type PerContractEtaPayload = {
      port_of_loading?: string | null;
      eta_arrival?: string | null;
      eta_berthed?: string | null;
      eta_loading_start?: string | null;
      eta_loading_complete?: string | null;
      eta_sailed?: string | null;
      eta_discharge_arrival?: string | null;
      eta_discharge_berthed?: string | null;
      eta_discharge_start?: string | null;
      eta_discharge_complete?: string | null;
    };

    const legacyEta: PerContractEtaPayload = {
      port_of_loading: portOfLoading || null,
      eta_arrival: eta_arrival || null,
      eta_berthed: eta_berthed || null,
      eta_loading_start: eta_loading_start || null,
      eta_loading_complete: eta_loading_complete || null,
      eta_sailed: eta_sailed || null,
      eta_discharge_arrival: eta_discharge_arrival || null,
      eta_discharge_berthed: eta_discharge_berthed || null,
      eta_discharge_start: eta_discharge_start || null,
      eta_discharge_complete: eta_discharge_complete || null,
    };

    const etaByContractMap =
      etaByContract && typeof etaByContract === 'object' && !Array.isArray(etaByContract)
        ? (etaByContract as Record<string, PerContractEtaPayload>)
        : {};

    for (const contract of contractCheck.rows) {
      const contractIdKey = String(contract.contract_id).trim();
      const perContractEta =
        etaByContractMap[contractIdKey] && typeof etaByContractMap[contractIdKey] === 'object'
          ? etaByContractMap[contractIdKey]
          : legacyEta;

      // Generate shipment_id:
      // - If STO is provided, use "<STO>-<CONTRACT_ID>" so all contracts under an STO can be grouped
      // - If STO is NOT provided (manual shipment), generate an internal unique id (do NOT mirror operation_id),
      //   and keep STO empty until it is updated from SAP.
      const shipmentId = hasStoNumber
        ? `${stoNumber}-${contract.contract_id}`
        : `MNL-${timestamp.slice(-8)}-${contract.contract_id}`;
      
      const derivedStatus = deriveShipmentStatus({
        eta_arrival_at_loading_port: perContractEta.eta_arrival,
        eta_berthed_at_loading_port: perContractEta.eta_berthed,
        eta_start_loading: perContractEta.eta_loading_start,
        eta_completed_loading: perContractEta.eta_loading_complete,
        eta_sailed_from_loading_port: perContractEta.eta_sailed,
        eta_arrive_at_discharge_port: perContractEta.eta_discharge_arrival,
        eta_berthed_at_discharge_port: perContractEta.eta_discharge_berthed,
        eta_start_discharging: perContractEta.eta_discharge_start,
        eta_complete_discharge: perContractEta.eta_discharge_complete,
      });

      // Guard: avoid creating a duplicate shipment for the same contract.
      // Check 1: same operation_id + contract (re-submit of same planned operation).
      // Check 2: same vessel name (case-insensitive) + contract (vessel already assigned here).
      let existingShipmentId: string | null = null;
      if (resolvedOperationId) {
        const byOp = await query(
          `SELECT id FROM shipments WHERE contract_id = $1::uuid AND operation_id = $2 LIMIT 1`,
          [contract.id, resolvedOperationId]
        );
        if (byOp.rows.length > 0) existingShipmentId = byOp.rows[0].id;
      }
      if (!existingShipmentId && vesselName) {
        const byVessel = await query(
          `SELECT id FROM shipments WHERE contract_id = $1::uuid AND LOWER(TRIM(vessel_name)) = LOWER(TRIM($2)) LIMIT 1`,
          [contract.id, vesselName]
        );
        if (byVessel.rows.length > 0) existingShipmentId = byVessel.rows[0].id;
      }
      if (!existingShipmentId) {
        const byActiveContract = await query(
          `SELECT id FROM shipments
           WHERE contract_id = $1::uuid
             AND COALESCE(status, '') <> 'CANCELLED'
           ORDER BY created_at DESC
           LIMIT 1`,
          [contract.id],
        );
        if (byActiveContract.rows.length > 0) {
          existingShipmentId = byActiveContract.rows[0].id;
        }
      }

      let resultId: string;
      if (existingShipmentId) {
        // Update existing instead of inserting a duplicate
        await query(`
          UPDATE shipments SET
            operation_id  = COALESCE($1, operation_id),
            vessel_name   = COALESCE($2, vessel_name),
            vessel_code   = COALESCE($3, vessel_code),
            voyage_no     = COALESCE($4, voyage_no),
            vessel_owner  = COALESCE($5, vessel_owner),
            vessel_draft  = COALESCE($6::numeric, vessel_draft),
            vessel_capacity = COALESCE($7::numeric, vessel_capacity),
            vessel_hull_type = COALESCE($8, vessel_hull_type),
            charter_type  = COALESCE($9, charter_type),
            port_of_loading = COALESCE($10, port_of_loading),
            port_of_discharge = COALESCE($11, port_of_discharge),
            quantity_shipped = COALESCE($12::numeric, quantity_shipped),
            quantity_delivered = COALESCE($13::numeric, quantity_delivered),
            eta_arrival   = COALESCE($14::date, eta_arrival),
            eta_berthed   = COALESCE($15::date, eta_berthed),
            eta_loading_start = COALESCE($16::date, eta_loading_start),
            eta_loading_complete = COALESCE($17::date, eta_loading_complete),
            eta_sailed    = COALESCE($18::date, eta_sailed),
            eta_discharge_arrival = COALESCE($19::date, eta_discharge_arrival),
            eta_discharge_berthed = COALESCE($20::date, eta_discharge_berthed),
            eta_discharge_start = COALESCE($21::date, eta_discharge_start),
            eta_discharge_complete = COALESCE($22::date, eta_discharge_complete),
            status        = $23,
            updated_at    = CURRENT_TIMESTAMP
          WHERE id = $24
        `, [
          resolvedOperationId,
          vesselName || null,
          vesselCode || null,
          voyageNo || null,
          vesselOwner || null,
          vesselDraft ? parseFloat(String(vesselDraft)) : null,
          vesselCapacity ? parseFloat(String(vesselCapacity)) : null,
          vesselHullType || null,
          charterType || null,
          perContractEta.port_of_loading || portOfLoading || null,
          portOfDischarge || null,
          quantityShipped ? parseFloat(String(quantityShipped)) : null,
          quantityDelivered ? parseFloat(String(quantityDelivered)) : null,
          perContractEta.eta_arrival || null,
          perContractEta.eta_berthed || null,
          perContractEta.eta_loading_start || null,
          perContractEta.eta_loading_complete || null,
          perContractEta.eta_sailed || null,
          perContractEta.eta_discharge_arrival || null,
          perContractEta.eta_discharge_berthed || null,
          perContractEta.eta_discharge_start || null,
          perContractEta.eta_discharge_complete || null,
          derivedStatus,
          existingShipmentId,
        ]);
        resultId = existingShipmentId;
      } else {
        const result = await query(`
          INSERT INTO shipments (
            shipment_id, operation_id, contract_id, vessel_name, vessel_code, voyage_no, vessel_owner,
            vessel_draft, vessel_capacity, vessel_hull_type, charter_type,
            port_of_loading, port_of_discharge, quantity_shipped, quantity_delivered,
            eta_arrival, eta_berthed, eta_loading_start, eta_loading_complete, eta_sailed,
            eta_discharge_arrival, eta_discharge_berthed, eta_discharge_start, eta_discharge_complete,
            status
          ) VALUES (
            $1, $2, $3::uuid, $4, $5, $6, $7, $8::numeric, $9::numeric, $10, $11,
            $12, $13, $14::numeric, $25::numeric,
            $15::date, $16::date, $17::date, $18::date, $19::date,
            $20::date, $21::date, $22::date, $23::date,
            $24
          ) RETURNING id
        `, [
          shipmentId,
          resolvedOperationId,
          contract.id,
          vesselName || null,
          vesselCode || null,
          voyageNo || null,
          vesselOwner || null,
          vesselDraft ? parseFloat(String(vesselDraft)) : null,
          vesselCapacity ? parseFloat(String(vesselCapacity)) : null,
          vesselHullType || null,
          charterType || null,
          perContractEta.port_of_loading || portOfLoading || null,
          portOfDischarge || null,
          quantityShipped ? parseFloat(String(quantityShipped)) : null,
          perContractEta.eta_arrival || null,
          perContractEta.eta_berthed || null,
          perContractEta.eta_loading_start || null,
          perContractEta.eta_loading_complete || null,
          perContractEta.eta_sailed || null,
          perContractEta.eta_discharge_arrival || null,
          perContractEta.eta_discharge_berthed || null,
          perContractEta.eta_discharge_start || null,
          perContractEta.eta_discharge_complete || null,
          derivedStatus,
          quantityDelivered ? parseFloat(String(quantityDelivered)) : null,
        ]);
        resultId = result.rows[0].id;
      }

      shipmentIds.push(resultId);
    }

    // Persist user contract qty assignment (keyed by STO if exists; else operationId; else shipment_id)
    const assignmentKey = (hasStoNumber && stoNumber && String(stoNumber).trim())
      ? String(stoNumber).trim()
      : (resolvedOperationId && String(resolvedOperationId).trim())
        ? String(resolvedOperationId).trim()
        : `MNL-${timestamp.slice(-8)}`;

    // Planning only (user_sto_contract_assignments). Delivery Qty KLIP is set only via
    // updateShipment when the user explicitly edits quantity_delivered (SLD/SDD path).
    const hasPoAssignments =
      poQtyAssigned && typeof poQtyAssigned === 'object' && Object.keys(poQtyAssigned as object).length > 0;
    const hasContractAssignments =
      contractQtyAssigned && typeof contractQtyAssigned === 'object' && Object.keys(contractQtyAssigned as object).length > 0;

    if (hasPoAssignments || hasContractAssignments) {
      await ensureUserStoContractAssignmentsTable();

      if (hasPoAssignments) {
        const rowIds = Object.keys(poQtyAssigned as Record<string, any>).filter(Boolean);
        const rowsResult = await query(
          `SELECT id, contract_id, po_number FROM contracts WHERE id = ANY($1::uuid[])`,
          [rowIds],
        );
        const rowById = new Map(
          rowsResult.rows.map((r: { id: string; contract_id: string; po_number: string | null }) => [String(r.id), r]),
        );

        for (const [rowId, qty] of Object.entries(poQtyAssigned as Record<string, any>)) {
          const row = rowById.get(String(rowId));
          if (!row) continue;
          const n = parseFloat(String(qty));
          if (Number.isNaN(n) || n <= 0) continue;
          await upsertPoQtyAssignment(
            assignmentKey,
            String(row.contract_id).trim(),
            row.po_number ? String(row.po_number).trim() : null,
            n,
          );
        }
      } else if (hasContractAssignments) {
        for (const [rawKey, qty] of Object.entries(contractQtyAssigned as Record<string, any>)) {
          if (!rawKey) continue;
          const n = parseFloat(String(qty));
          if (Number.isNaN(n) || n <= 0) continue;
          const key = String(rawKey).trim();
          let contractNumber = key;
          let poNumber: string | null = null;
          if (key.includes('::')) {
            const [cn, po] = key.split('::');
            contractNumber = String(cn ?? '').trim();
            poNumber = String(po ?? '').trim() || null;
          }
          if (!contractNumber) continue;
          await upsertPoQtyAssignment(assignmentKey, contractNumber, poNumber, n);
        }
      }
    }

    // Update contracts with STO number (only if STO is explicitly provided)
    // For manual shipments, STO remains empty and will be filled from SAP Data later
    if (hasStoNumber) {
      await query(`
        UPDATE contracts 
        SET sto_number = $1, updated_at = CURRENT_TIMESTAMP
        WHERE contract_id = ANY($2)
      `, [stoNumber, contractNumbers]);
    }

    invalidateShipmentsListCache();
    if (shipmentIds.length > 0) {
      setImmediate(() => {
        import('../services/contractQtyMoveSnapshot.service')
          .then(({ ContractQtyMoveSnapshotService }) =>
            ContractQtyMoveSnapshotService.refreshForShipmentIds(shipmentIds),
          )
          .catch((err) => {
            logger.warn('Contract qty_move snapshot refresh after shipment create failed', {
              err,
              shipmentIds,
            });
          });
      });
    }

    return res.json({
      success: true,
      message: stoNumber 
        ? `Shipment created successfully for STO ${stoNumber}`
        : `Shipment created successfully for contracts: ${contractNumbers.join(', ')}`,
      data: {
        stoNumber: stoNumber || null,
        contractNumbers,
        shipmentIds
      }
    });
  } catch (error: any) {
    logger.error('Create shipment error:', error);
    return res.status(500).json({
      success: false,
      error: { 
        message: error.message || 'Failed to create shipment',
        details: error.detail || error.toString()
      },
    });
  }
};

/** Activity / audit trail for a single shipment (modal history section). */
export const getShipmentActivityLog = async (req: AuthRequest, res: Response) => {
  try {
    const shipmentId = String(req.params.shipmentId || '').trim();
    if (!shipmentId) {
      return res.status(400).json({ success: false, error: { message: 'Shipment ID is required' } });
    }

    const exists = await query(`SELECT id FROM shipments WHERE id = $1 LIMIT 1`, [shipmentId]);
    if (exists.rows.length === 0) {
      return res.status(404).json({ success: false, error: { message: 'Shipment not found' } });
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
         COALESCE(u.username, '') AS username,
         COALESCE(u.full_name, '') AS full_name
       FROM audit_logs a
       LEFT JOIN users u ON a.user_id = u.id
       WHERE (
         (a.entity_type = 'SHIPMENT' AND a.entity_id = $1::uuid)
         OR (a.entity_type = 'LOADING_PORT' AND a.entity_id IN (
           SELECT vlp.id FROM vessel_loading_ports vlp WHERE vlp.shipment_id = $1::uuid
         ))
         OR (a.entity_type = 'STO_QTY_ASSIGNED' AND a.entity_id = $1::uuid)
       )
       ORDER BY a.timestamp DESC
       LIMIT 200`,
      [shipmentId],
    );

    return res.json({ success: true, data: result.rows });
  } catch (error) {
    logger.error('Get shipment activity log error:', error);
    return res.status(500).json({ success: false, error: { message: 'Failed to load shipment activity log' } });
  }
};

/** Cancel KLIP-created shipment group (no official SAP STO) + clear plan qty assignments. */
export const cancelKlipShipment = async (req: AuthRequest, res: Response) => {
  try {
    const shipmentId = String(req.params.id ?? '').trim();
    if (!shipmentId) {
      return res.status(400).json({ success: false, error: { message: 'Shipment ID is required' } });
    }

    const remark = String(req.body?.remark ?? '').trim();
    if (!remark) {
      return res.status(400).json({
        success: false,
        error: { message: 'Cancellation remark is required' },
      });
    }

    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: { message: 'Unauthorized' } });
    }

    const result = await cancelKlipShipmentGroup(shipmentId, remark, userId);
    return res.json({
      success: true,
      message: 'Shipment cancelled successfully',
      data: {
        id: shipmentId,
        ...result,
      },
    });
  } catch (error) {
    if (error instanceof KlipShipmentCancelError) {
      return res.status(error.statusCode).json({
        success: false,
        error: { message: error.message },
      });
    }
    logger.error('Cancel KLIP shipment error:', error);
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to cancel shipment' },
    });
  }
};
