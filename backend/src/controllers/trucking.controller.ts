import { Response } from 'express';
import { query } from '../database/connection';
import { assertTruckingOperationContractOpen, isContractDeliveryClosed, SQL_CONTRACT_IMPORT_STATUS } from '../utils/contractDeliveryStatus';
import { sapTruckingLoadingLocationSql } from '../utils/sapTruckingLoadingLocationSql';
import { AuthRequest } from '../middleware/auth';
import logger from '../utils/logger';
import { mergeDailyDeliverablesRows, normalizeAndValidateDailyDeliverables, parseDailyDeliverableQuantity } from '../utils/truckingDailyDeliverables';
import {
  appendTruckingColumnFilters,
  appendTruckingGlobalSearch,
  appendTruckingLateIndicatorFilter,
  parseColumnFiltersQuery,
} from '../utils/truckingListFilters';
import { appendGroupPlantFilter, groupPlantExpr } from '../utils/groupPlantSql';
import { appendTruckingPipelineStageFilter } from '../utils/truckingPagePipelineSql';
import { parsePlanningSheetToMatrix, toIsoDate10FromCell } from '../utils/planningSheetDate';
import {
  allocateNextSyntheticSequenceDefault,
  buildSyntheticOperationId,
  formatDDMMYYYY,
} from '../utils/operationId';
import {
  sqlSapQtyDeliveryOnly,
  sqlSapQtyReceiveOnly,
  sqlTruckingOutstandingQtyByIncoterm,
  sqlTruckingQuantityDeliveredCoalesce,
  sqlTruckingQuantityReceiveCoalesce,
  sqlTruckingQuantitySentCoalesce,
} from '../utils/truckingQuantitySql';
import {
  isTruckingPageIncoterm,
  truckingPageListScopeWhereSql,
} from '../utils/truckingIncotermScope';
import { sqlContractGlobalOutstandingExpr } from '../utils/contractGlobalOutstandingSql';
import { buildQtyMoveCte } from '../utils/contractGlobalOutstandingSql';
import { listTruckingDailyActuals } from '../services/truckingRealization.service';
import { ensureUnplannedTruckingOpsForRequest } from '../services/truckingEnsureUnplannedOps.service';
import {
  sqlSapTruckingLastReceiveDate,
  sqlSapTruckingStartReceiveDate,
} from '../utils/truckingSapDates';
import { sqlTruckingStoActualsByContractId } from '../utils/truckingStoActualsSql';
import {
  TRUCKING_REALIZATIONS_JOIN,
  sqlRealizationEndDate,
  sqlRealizationStartDate,
} from '../utils/truckingRealizationSql';
import { hasTruckingKlipPlanning } from '../utils/truckingEffectiveStatus';
import {
  invalidateTruckingListCache,
  resolveTruckingListForRequest,
} from '../services/truckingList.service';
import { SQL_RECONCILE_TRUCKING_STATUS_FROM_SAP } from '../utils/truckingEffectiveStatus';
import {
  findActiveTruckingOpsByContractId,
  findTruckingOpForPlannedPlanningUpload,
  findTruckingOpForUnplannedPlanningUpload,
  formatDuplicateTruckingMessage,
  resolveContractByExtNoOrId,
  resolveContractForUnplannedPlanningUpload,
  truckingOperationIdIsAssigned,
} from '../utils/truckingOperationUniqueness';
import {
  buildDailyDeliverablesFromKgEntries,
  filterEntriesLockedByActuals,
  filterEntriesWithinUnplannedWindow,
  isUnplannedWidePlanningTemplateMatrix,
  parseUnplannedWidePlanningMatrix,
  resolvePlanningStartEndFromDeliverables,
  unplannedUploadCellToString,
} from '../utils/truckingUnplannedPlanningUpload';
import {
  fetchContractOutstandingQtyKg,
  fetchTruckingOperationOutstandingQtyKg,
  resolveTruckingPlanningMaxQtyKg,
  sumPlanningEntriesKg,
  validatePlanningTotalAgainstOutstandingKg,
} from '../utils/truckingUnplannedPlanningOsQty';
import {
  sqlContractMatchesStoParam,
  sqlTruckingPoAggregatedStoNumbersExpr,
} from '../utils/truckingPoStoIdentitySql';

let truckingOpIdBackfillChecked = false;
let truckingStatusReconcileLastRun = 0;
const TRUCKING_STATUS_RECONCILE_INTERVAL_MS = 10 * 60 * 1000;

async function reconcileTruckingStatusesFromSapIfDue(): Promise<void> {
  const now = Date.now();
  if (now - truckingStatusReconcileLastRun < TRUCKING_STATUS_RECONCILE_INTERVAL_MS) return;
  truckingStatusReconcileLastRun = now;
  try {
    const result = await query(SQL_RECONCILE_TRUCKING_STATUS_FROM_SAP);
    const count = result.rowCount ?? 0;
    if (count > 0) {
      invalidateTruckingListCache();
      logger.info(`Reconciled trucking status from SAP for ${count} operation(s)`);
    }
  } catch (err) {
    logger.warn('Trucking status reconcile from SAP failed (list continues)', err);
  }
}

async function ensureMissingTruckingOperationIdsIfNeeded(): Promise<void> {
  if (truckingOpIdBackfillChecked) return;
  const check = await query(
    `SELECT 1
     FROM trucking_operations t
     WHERE t.operation_id IS NULL
        OR TRIM(COALESCE(t.operation_id::text, '')) = ''
        OR TRIM(t.operation_id::text) IN ('-', 'N/A', '—')
     LIMIT 1`,
  );
  truckingOpIdBackfillChecked = true;
  if (check.rows.length === 0) return;
  await ensureMissingTruckingOperationIds();
}

function deriveTruckingStatus(
  truckingStartDate: any,
  truckingCompletionDate: any,
  cargoReadinessDate: any
): string {
  if (truckingCompletionDate) return 'COMPLETED';
  if (truckingStartDate) return 'IN_TRANSIT';
  if (cargoReadinessDate) return 'LOADING';
  return 'PLANNED';
}

export const getLandOpenContractSuggestions = async (req: AuthRequest, res: Response) => {
  try {
    const { q } = req.query;
    const term = String(q ?? '').trim();
    if (term.length < 2) {
      return res.json({ success: true, data: [] });
    }

    const result = await query(
      `
      WITH latest_spd AS (
        SELECT DISTINCT ON (spd.contract_number)
          spd.contract_number,
          COALESCE(spd.data->'raw'->>'Contract Ext No', spd.data->>'Contract Ext No') AS contract_ext_no,
          COALESCE(spd.data->'contract'->>'contract_type', spd.data->>'B2B Flag') AS b2b_flag,
          COALESCE(
            spd.data->'contract'->>'contract_reference_po',
            spd.data->>'CONTRACT REFF PO',
            spd.data->>'Contract Reff PO Ini',
            spd.data->'raw'->>'Contract Reff PO Ini',
            spd.data->'raw'->>'CONTRACT REFF PO'
          ) AS contract_reference_po
        FROM sap_processed_data spd
        WHERE spd.contract_number IS NOT NULL AND TRIM(spd.contract_number) != ''
        ORDER BY spd.contract_number, spd.created_at DESC NULLS LAST
      )
      SELECT
        c.contract_id,
        l.contract_ext_no,
        c.po_number,
        c.supplier,
        c.product,
        c.group_name,
        c.sto_number
      FROM contracts c
      LEFT JOIN latest_spd l ON l.contract_number = c.contract_id
      WHERE (
        COALESCE(l.contract_ext_no, '') ILIKE $1
        OR c.contract_id ILIKE $1
        OR COALESCE(c.po_number, '') ILIKE $1
        OR COALESCE(c.sto_number, '') ILIKE $1
      )
      AND NOT (
        UPPER(TRIM(COALESCE(l.b2b_flag, c.contract_type::text, ''))) = 'B2B'
        AND NULLIF(TRIM(COALESCE(l.contract_reference_po, '')), '') IS NOT NULL
      )
      ${truckingPageListScopeWhereSql}
      ORDER BY
        CASE
          WHEN COALESCE(c.po_number, '') = $2 THEN 0
          WHEN COALESCE(l.contract_ext_no, '') = $2 THEN 1
          WHEN c.contract_id = $2 THEN 2
          WHEN COALESCE(c.sto_number, '') = $2 THEN 3
          ELSE 4
        END,
        c.contract_date DESC NULLS LAST,
        COALESCE(l.contract_ext_no, c.contract_id)
      LIMIT 10
      `,
      [`%${term}%`, term]
    );

    return res.json({ success: true, data: result.rows });
  } catch (error) {
    logger.error('Get LAND Open contract suggestions error:', error);
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to get contract suggestions' },
    });
  }
};

/**
 * Persist OP-LAND-DDMMYYYYxxxx when operation_id was never set (SAP import / legacy rows).
 * Uses a short deterministic suffix from md5(id) so list/calendar APIs show a real ID without a manual backfill run.
 */
async function ensureMissingTruckingOperationIds(): Promise<void> {
  try {
    await query(`
      WITH ranked AS (
        SELECT
          t.id,
          TO_CHAR(COALESCE(t.created_at, CURRENT_TIMESTAMP)::date, 'DDMMYYYY') AS dmy,
          ROW_NUMBER() OVER (
            PARTITION BY TO_CHAR(COALESCE(t.created_at, CURRENT_TIMESTAMP)::date, 'DDMMYYYY')
            ORDER BY COALESCE(t.created_at, CURRENT_TIMESTAMP) NULLS LAST, t.id
          ) AS rn
        FROM trucking_operations t
        WHERE t.operation_id IS NULL
           OR TRIM(COALESCE(t.operation_id::text, '')) = ''
           OR TRIM(t.operation_id::text) IN ('-', 'N/A', '—')
      )
      UPDATE trucking_operations t
      SET
        operation_id = 'OP-LAND-' || r.dmy || (
          CASE
            WHEN r.rn < 10000 THEN LPAD(r.rn::text, 4, '0')
            ELSE r.rn::text
          END
        ),
        updated_at = CURRENT_TIMESTAMP
      FROM ranked r
      WHERE t.id = r.id;
    `);
  } catch (e) {
    logger.warn('ensureMissingTruckingOperationIds failed (non-fatal)', e);
  }
}

export const getTruckingOperations = async (req: AuthRequest, res: Response) => {
  try {
    const summaryOnly =
      String((req.query as { summaryOnly?: string }).summaryOnly || '').toLowerCase() === 'true';
    if (!summaryOnly) {
      void ensureMissingTruckingOperationIdsIfNeeded();
      void reconcileTruckingStatusesFromSapIfDue();
    }
    const data = await resolveTruckingListForRequest(req);
    return res.json({
      success: true,
      data,
    });
  } catch (error) {
    logger.error('Get trucking operations error:', error);
    const message =
      error instanceof Error
        ? error.message
        : (error as any)?.message || 'Failed to fetch trucking operations';
    return res.status(500).json({
      success: false,
      error: { message },
    });
  }
};

/** Create UNPLANNED ops + OP-LAND ids for open-PO backlog (template download prep). */
export const ensureUnplannedTruckingOps = async (req: AuthRequest, res: Response) => {
  try {
    const data = await ensureUnplannedTruckingOpsForRequest(req);
    return res.json({ success: true, data });
  } catch (error) {
    logger.error('Ensure unplanned trucking ops error:', error);
    const message =
      error instanceof Error ? error.message : 'Failed to ensure unplanned trucking operations';
    return res.status(500).json({ success: false, error: { message } });
  }
};

export const getTruckingOperationById = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const result = await query(
      `SELECT 
        t.*,
        t.trucking_start_date AS planning_start_date,
        t.trucking_completion_date AS planning_end_date,
        tr.realization_start_date,
        tr.realization_end_date,
        tr.source AS realization_source,
        ${sqlRealizationStartDate('c')} AS effective_realization_start_date,
        ${sqlRealizationEndDate('c')} AS effective_realization_end_date,
        c.contract_id as contract_number,
        c.po_number,
        ${sqlTruckingPoAggregatedStoNumbersExpr('c')} AS sto_number,
        ${sqlTruckingPoAggregatedStoNumbersExpr('c')} AS sto_numbers,
        c.supplier,
        c.buyer,
        c.product,
        c.group_name,
        c.quantity_ordered,
        c.unit,
        c.delivery_start_date,
        c.delivery_end_date,
        c.cargo_readiness_date AS contract_cargo_readiness_date,
        ${sqlSapTruckingStartReceiveDate('c')} AS sap_trucking_start_receive_date,
        ${sqlSapTruckingLastReceiveDate('c')} AS sap_trucking_last_receive_date,
        ${sqlSapQtyDeliveryOnly()} AS sap_qty_delivery,
        ${sqlSapQtyReceiveOnly()} AS sap_qty_receive
       FROM trucking_operations t
       LEFT JOIN contracts c ON t.contract_id = c.id
       LEFT JOIN shipments s ON t.shipment_id = s.id
       ${TRUCKING_REALIZATIONS_JOIN}
       WHERE t.id = $1
         ${truckingPageListScopeWhereSql}`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: { message: 'Trucking operation not found' },
      });
    }

    const dailyActuals = await listTruckingDailyActuals(id);
    let stoActuals: Array<Record<string, unknown>> = [];
    const contractUuid = String((result.rows[0] as { contract_id?: string }).contract_id ?? '');
    if (contractUuid) {
      try {
        const stoRes = await query(sqlTruckingStoActualsByContractId(), [contractUuid]);
        stoActuals = stoRes.rows as Array<Record<string, unknown>>;
      } catch (stoErr) {
        logger.warn('Per-STO trucking actuals lookup failed', stoErr);
      }
    }
    return res.json({
      success: true,
      data: {
        ...result.rows[0],
        daily_actuals: dailyActuals.map((a) => ({
          date: a.progress_date,
          progress_date: a.progress_date,
          quantity_kg: a.quantity_kg,
          quantity_delivered: a.quantity_kg,
          quantity_delivery_kg:
            a.quantity_delivery_kg != null ? a.quantity_delivery_kg : a.quantity_kg,
          quantity_receive_kg: a.quantity_receive_kg,
          sto_number: a.sto_number ?? '',
        })),
        sto_actuals: stoActuals,
      },
    });
  } catch (error) {
    logger.error('Get trucking operation by ID error:', error);
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch trucking operation' },
    });
  }
};

export const createTruckingOperation = async (req: AuthRequest, res: Response) => {
  try {
    const {
      contract_number,
      operation_id,
      location,
      loading_location,
      unloading_location,
      trucking_owner,
      cargo_readiness_date,
      trucking_start_date,
      trucking_completion_date,
      eta_trucking_start_date,
      eta_trucking_completion_date,
      eta_delivery_start_date,
      eta_delivery_end_date,
      quantity_sent,
      quantity_delivered,
      gain_loss_percentage,
      gain_loss_amount,
      oa_budget,
      oa_actual,
      status: statusInput,
      daily_deliverables
    } = req.body;

    // Validate required fields
    if (!contract_number) {
      return res.status(400).json({
        success: false,
        error: { message: 'Contract number is required' },
      });
    }

    const raw = String(contract_number).trim();
    // Resolve contract by PO, Contract ID, or Contract Ext No (latest SAP)
    const contractResult = await query(
      `
      WITH latest_spd AS (
        SELECT DISTINCT ON (spd.contract_number)
          spd.contract_number,
          COALESCE(spd.data->'raw'->>'Contract Ext No', spd.data->>'Contract Ext No') AS contract_ext_no
        FROM sap_processed_data spd
        WHERE spd.contract_number IS NOT NULL AND TRIM(spd.contract_number) != ''
        ORDER BY spd.contract_number, spd.created_at DESC NULLS LAST
      )
      SELECT c.id, UPPER(TRIM(COALESCE(c.transport_mode, ''))) AS transport_mode
      FROM contracts c
      LEFT JOIN latest_spd l ON l.contract_number = c.contract_id
      WHERE COALESCE(c.po_number, '') = $1
         OR c.contract_id = $1
         OR COALESCE(l.contract_ext_no, '') = $1
      ORDER BY
        (COALESCE(c.po_number, '') = $1) DESC,
        (c.contract_id = $1) DESC,
        (COALESCE(l.contract_ext_no, '') = $1) DESC
      LIMIT 1
      `,
      [raw]
    );

    if (contractResult.rows.length === 0) {
      return res.status(400).json({
        success: false,
        error: { message: 'Contract does not exist' },
      });
    }

    const contractRow = contractResult.rows[0];
    if (contractRow.transport_mode === 'SEA') {
      return res.status(400).json({
        success: false,
        error: {
          message:
            'Trucking operations cannot be created for SEA-only contracts. Use Shipments for sea logistics, or set transport mode to MIX/LAND.',
        },
      });
    }

    const contractId = contractRow.id;

    const existingActive = await findActiveTruckingOpsByContractId(contractId);
    if (existingActive.length > 0) {
      return res.status(409).json({
        success: false,
        error: { message: formatDuplicateTruckingMessage(existingActive) },
      });
    }

    let finalOperationId =
      operation_id != null && String(operation_id).trim() !== ''
        ? String(operation_id).trim()
        : '';
    if (!finalOperationId) {
      const dmy = formatDDMMYYYY(new Date());
      const seq = await allocateNextSyntheticSequenceDefault('trucking_operations', 'LAND', dmy);
      finalOperationId = buildSyntheticOperationId('LAND', dmy, seq);
    }

    // Validate daily deliverables (if provided) using shared rules (create + update + calendar).
    // ETA dates are hidden from UI; validate against due delivery dates from the contract (fallback to actual trucking dates).
    const contractDatesRes = await query(
      `SELECT delivery_start_date, delivery_end_date FROM contracts WHERE id = $1 LIMIT 1`,
      [contractId]
    );
    const contractDates = contractDatesRes.rows[0] || {};
    const planningMaxQtyKg = await resolveTruckingPlanningMaxQtyKg(contractId);
    const dd = normalizeAndValidateDailyDeliverables({
      daily_deliverables,
      startRaw: contractDates.delivery_start_date ?? trucking_start_date,
      endRaw: contractDates.delivery_end_date ?? trucking_completion_date,
      maxQtyRaw: planningMaxQtyKg,
      maxQtyLabel: 'Outstanding Qty (kg)',
    });
    if (!dd.ok) {
      return res.status(400).json({ success: false, error: { message: dd.message } });
    }

    const allowedCreateStatuses = new Set([
      'PLANNED',
      'IN_TRANSIT',
      'ARRIVED',
      'UNLOADING',
      'COMPLETED',
      'CANCELLED',
    ]);
    const normalizedStatus = String(statusInput ?? '').trim().toUpperCase();
    const status = allowedCreateStatuses.has(normalizedStatus)
      ? normalizedStatus
      : hasTruckingKlipPlanning(dd.rows)
        ? 'PLANNED'
        : deriveTruckingStatus(null, null, cargo_readiness_date);

    const lastDdDate =
      dd.rows.length > 0
        ? dd.rows.reduce((max, row) => ((row.date || '') > max ? row.date : max), dd.rows[0].date)
        : null;

    // Insert new trucking operation
    const result = await query(
      `INSERT INTO trucking_operations (
        contract_id, operation_id, location, loading_location, unloading_location,
        trucking_owner, cargo_readiness_date,
        trucking_start_date, trucking_completion_date,
        eta_trucking_start_date, eta_trucking_completion_date,
        eta_delivery_start_date, eta_delivery_end_date,
        quantity_sent, quantity_delivered,
        gain_loss_percentage, gain_loss_amount, oa_budget, oa_actual, status,
        daily_deliverables, last_daily_deliverable_date
      ) VALUES (
        $1::uuid, $2, $3, $4, $5, $6, $7::date,
        $8::date, $9::date,
        $10::date, $11::date,
        $12::date, $13::date,
        $14::numeric, $15::numeric, $16::numeric,
        $17::numeric, $18::numeric, $19::numeric, $20,
        $21::jsonb, $22::date
      ) RETURNING *`,
      [
        contractId,
        finalOperationId,
        location || null,
        loading_location || null,
        unloading_location || null,
        trucking_owner || null,
        cargo_readiness_date || null,
        trucking_start_date || null,
        trucking_completion_date || null,
        eta_trucking_start_date || null,
        eta_trucking_completion_date || null,
        eta_delivery_start_date || null,
        eta_delivery_end_date || null,
        quantity_sent || null,
        quantity_delivered || null,
        gain_loss_percentage || null,
        gain_loss_amount || null,
        oa_budget || null,
        oa_actual || null,
        status,
        JSON.stringify(dd.rows),
        lastDdDate,
      ]
    );

    logger.info('Trucking operation created:', { id: result.rows[0].id, operation_id: finalOperationId });
    invalidateTruckingListCache();

    return res.json({
      success: true,
      data: result.rows[0],
      message: 'Trucking operation created successfully',
    });
  } catch (error) {
    logger.error('Create trucking operation error:', error);
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to create trucking operation' },
    });
  }
};

export const validateContractNumber = async (req: AuthRequest, res: Response) => {
  try {
    const po_number = req.query.po_number;
    const contract_number = req.query.contract_number;
    const lookupTerm = String(po_number ?? contract_number ?? '').trim();
    const lookupByPo = po_number != null && String(po_number).trim() !== '';

    if (!lookupTerm) {
      return res.status(400).json({
        success: false,
        error: { message: lookupByPo ? 'PO Number is required' : 'Contract number is required' },
      });
    }

    const raw = lookupTerm;
    // PO lookup also accepts STO → same contract (multi-STO per PO).
    const matchWhereSql = lookupByPo
      ? `(
          COALESCE(c.po_number, '') = $1
          OR ${sqlContractMatchesStoParam('c', 1)}
        )`
      : `(
          COALESCE(c.po_number, '') = $1
           OR c.contract_id = $1
           OR COALESCE(l.contract_ext_no, '') = $1
           OR c.id::text = $1
           OR ${sqlContractMatchesStoParam('c', 1)}
        )`;
    const result = await query(
      `
      WITH latest_spd AS (
        SELECT DISTINCT ON (spd.contract_number)
          spd.contract_number,
          COALESCE(spd.data->'raw'->>'Contract Ext No', spd.data->>'Contract Ext No') AS contract_ext_no
        FROM sap_processed_data spd
        WHERE spd.contract_number IS NOT NULL AND TRIM(spd.contract_number) != ''
        ORDER BY spd.contract_number, spd.created_at DESC NULLS LAST
      ),
      matched AS (
        SELECT c.*
        FROM contracts c
        LEFT JOIN latest_spd l ON l.contract_number = c.contract_id
        WHERE ${matchWhereSql}
        ORDER BY
          (COALESCE(c.po_number, '') = $1) DESC,
          (c.contract_id = $1) DESC,
          (COALESCE(l.contract_ext_no, '') = $1) DESC,
          c.contract_date DESC NULLS LAST
        LIMIT 1
      ),
      contract_candidates AS (
        SELECT contract_id AS contract_number FROM matched
      ),
      ${buildQtyMoveCte({ kind: 'in_subquery', subquery: 'SELECT contract_number FROM contract_candidates' })}
      SELECT
        c.id,
        c.contract_id,
        c.po_number,
        l.contract_ext_no,
        ${sqlTruckingPoAggregatedStoNumbersExpr('c')} AS sto_number,
        ${sqlTruckingPoAggregatedStoNumbersExpr('c')} AS sto_numbers,
        c.supplier,
        c.buyer,
        c.product,
        c.group_name,
        c.quantity_ordered,
        c.contract_date,
        c.delivery_start_date,
        c.delivery_end_date,
        c.cargo_readiness_date,
        c.transport_mode,
        c.incoterm,
        c.status AS contract_status,
        ${SQL_CONTRACT_IMPORT_STATUS} AS sap_import_status,
        ${SQL_CONTRACT_IMPORT_STATUS} AS import_status,
        c.plant_code,
        mp.plant_name,
        mp.company_name AS plant_company_name,
        NULLIF(TRIM(mp.group_plant), '') AS group_plant_suggestion,
        COALESCE(sap_loc.sap_loading_location, NULLIF(TRIM(c.supplier), '')) AS sap_loading_location,
        (
          SELECT s.mills
          FROM suppliers s
          WHERE c.supplier IS NOT NULL AND TRIM(c.supplier) != ''
            AND NULLIF(TRIM(s.mills), '') IS NOT NULL
            AND (
              TRIM(LOWER(COALESCE(s.parent_company, ''))) = TRIM(LOWER(c.supplier))
              OR TRIM(LOWER(COALESCE(s.mills, ''))) = TRIM(LOWER(c.supplier))
              OR TRIM(LOWER(COALESCE(s.group_holding, ''))) = TRIM(LOWER(c.supplier))
            )
          ORDER BY s.updated_at DESC NULLS LAST, s.created_at DESC NULLS LAST
          LIMIT 1
        ) AS supplier_mills_suggestion,
        ${sqlContractGlobalOutstandingExpr({
          contractQtyExpr: 'COALESCE(c.quantity_ordered, 0)',
          incotermExpr: 'c.incoterm',
          contractNumberExpr: 'c.contract_id',
        })} AS outstanding_quantity
      FROM matched c
      LEFT JOIN latest_spd l ON l.contract_number = c.contract_id
      LEFT JOIN master_plants mp ON mp.plant_code = c.plant_code
      LEFT JOIN LATERAL (
        SELECT
          ${sapTruckingLoadingLocationSql} AS sap_loading_location
        FROM sap_processed_data spd
        WHERE spd.contract_number = c.contract_id
        ORDER BY spd.created_at DESC NULLS LAST
        LIMIT 1
      ) sap_loc ON TRUE
      LIMIT 1
      `,
      [raw]
    );

    if (result.rows.length === 0) {
      return res.json({
        success: true,
        exists: false,
        message: lookupByPo ? 'PO Number does not exist' : 'Contract does not exist',
      });
    }

    const row = result.rows[0] as {
      id?: string;
      po_number?: string | null;
      buyer?: string | null;
      transport_mode?: string | null;
      incoterm?: string | null;
      contract_id?: string | null;
    };
    if (!isTruckingPageIncoterm(row.incoterm)) {
      return res.json({
        success: true,
        exists: false,
        message:
          'Trucking operations are only available for FRC/LCO incoterms. Use Shipments for sea logistics (CIF/FOB/CFR).',
      });
    }

    // B2B origin (Contract Reff PO empty): Unloading Location = Buyer of child PO
    // (child rows whose Contract Reff PO Ini points at this origin PO).
    let b2bChildBuyer: string | null = null;
    let isB2bOrigin = false;
    let stoActuals: Array<Record<string, unknown>> = [];
    try {
      if (row.id) {
        const stoRes = await query(sqlTruckingStoActualsByContractId(), [row.id]);
        stoActuals = stoRes.rows as Array<Record<string, unknown>>;
      }
    } catch (stoErr) {
      logger.warn('Per-STO trucking actuals on validate failed', stoErr);
    }
    try {
      const b2bMeta = await query(
        `
        WITH latest_spd AS (
          SELECT DISTINCT ON (contract_number) contract_number, data
          FROM sap_processed_data
          WHERE contract_number IS NOT NULL AND TRIM(contract_number) != ''
          ORDER BY contract_number, created_at DESC NULLS LAST
        )
        SELECT
          UPPER(NULLIF(TRIM(COALESCE(
            l.data->'contract'->>'contract_type',
            l.data->>'B2B Flag',
            l.data->'raw'->>'B2B Flag',
            c.contract_type::text,
            ''
          )), '')) AS b2b_flag,
          NULLIF(TRIM(COALESCE(
            l.data->'contract'->>'contract_reference_po',
            l.data->>'CONTRACT REFF PO',
            l.data->>'Contract Reff PO Ini',
            l.data->'raw'->>'Contract Reff PO Ini',
            l.data->'raw'->>'CONTRACT REFF PO'
          )), '') AS contract_reference_po,
          COALESCE(
            NULLIF(TRIM(c.po_number), ''),
            NULLIF(TRIM(l.data->'contract'->>'po_no'), ''),
            NULLIF(TRIM(l.data->'raw'->>'PO No.'), ''),
            NULLIF(TRIM(l.data->>'PO No.'), '')
          ) AS origin_po_number
        FROM contracts c
        LEFT JOIN latest_spd l ON l.contract_number = c.contract_id
        WHERE c.id = $1
        LIMIT 1
        `,
        [row.id],
      );
      const meta = b2bMeta.rows[0] as
        | { b2b_flag?: string | null; contract_reference_po?: string | null; origin_po_number?: string | null }
        | undefined;
      const originPo = String(meta?.origin_po_number ?? row.po_number ?? '').trim();
      isB2bOrigin =
        String(meta?.b2b_flag ?? '').toUpperCase() === 'B2B' &&
        !String(meta?.contract_reference_po ?? '').trim();
      if (isB2bOrigin && originPo) {
        const childRes = await query(
          `
          WITH latest_spd AS (
            SELECT DISTINCT ON (contract_number) contract_number, data
            FROM sap_processed_data
            WHERE contract_number IS NOT NULL AND TRIM(contract_number) != ''
            ORDER BY contract_number, created_at DESC NULLS LAST
          )
          SELECT
            COALESCE(
              NULLIF(TRIM(c.company_name), ''),
              NULLIF(TRIM(l.data->'raw'->>'Buyer'), ''),
              NULLIF(TRIM(l.data->>'Buyer'), ''),
              NULLIF(TRIM(c.buyer), '')
            ) AS child_buyer
          FROM contracts c
          LEFT JOIN latest_spd l ON l.contract_number = c.contract_id
          WHERE NULLIF(TRIM(COALESCE(
            l.data->'contract'->>'contract_reference_po',
            l.data->>'CONTRACT REFF PO',
            l.data->>'Contract Reff PO Ini',
            l.data->'raw'->>'Contract Reff PO Ini',
            l.data->'raw'->>'CONTRACT REFF PO'
          )), '') = $1
          ORDER BY c.contract_date DESC NULLS LAST, c.created_at DESC NULLS LAST
          LIMIT 1
          `,
          [originPo],
        );
        b2bChildBuyer = String((childRes.rows[0] as { child_buyer?: string } | undefined)?.child_buyer ?? '').trim() || null;
      }
    } catch (b2bErr) {
      logger.warn('B2B child buyer lookup failed during trucking contract validate', b2bErr);
    }

    return res.json({
      success: true,
      exists: true,
      data: {
        ...result.rows[0],
        is_b2b_origin: isB2bOrigin,
        b2b_child_buyer: b2bChildBuyer,
        unloading_location_suggestion: b2bChildBuyer || String(row.buyer ?? '').trim() || null,
        sto_actuals: stoActuals,
      },
    });
  } catch (error) {
    logger.error('Validate contract number error:', error);
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to validate contract lookup' },
    });
  }
};

export const updateTruckingOperation = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    // Load current record so we can validate daily_deliverables with the same rules as create.
    const currentRes = await query(
      `SELECT t.id,
              t.contract_id,
              c.delivery_start_date,
              c.delivery_end_date,
              t.trucking_start_date,
              t.trucking_completion_date,
              t.quantity_delivered,
              t.daily_deliverables
       FROM trucking_operations t
       LEFT JOIN contracts c ON t.contract_id = c.id
       WHERE t.id = $1
       LIMIT 1`,
      [id],
    );
    if (currentRes.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: { message: 'Trucking operation not found' },
      });
    }
    const cur = currentRes.rows[0];

    const contractOpen = await assertTruckingOperationContractOpen(id);
    if (!contractOpen.ok) {
      return res.status(403).json({
        success: false,
        error: { message: contractOpen.message },
      });
    }

    // Build dynamic update query
    const updateFields = [];
    const updateValues = [];
    let paramIndex = 1;

    // List of allowed fields that can be updated
    const allowedFields = [
      'operation_id', 'location', 'loading_location', 'unloading_location',
      'trucking_owner', 'cargo_readiness_date',
      'trucking_start_date', 'trucking_completion_date',
      'quantity_sent', 'quantity_delivered', 'gain_loss_percentage',
      'gain_loss_amount', 'oa_budget', 'oa_actual', 'status',
      'daily_deliverables'
    ];

    // Date fields that need casting
    const dateFields = [
      'cargo_readiness_date',
      'trucking_start_date', 'trucking_completion_date',
    ];

    for (const [key, value] of Object.entries(updateData)) {
      if (allowedFields.includes(key)) {
        if (key === 'daily_deliverables') {
          // Validate against merged record state (updates override current).
          const planningMaxQtyKg = await resolveTruckingPlanningMaxQtyKg(cur.contract_id);
          const dd2 = normalizeAndValidateDailyDeliverables({
            daily_deliverables: value,
            startRaw: (cur.delivery_start_date ?? updateData.trucking_start_date ?? cur.trucking_start_date),
            endRaw: (cur.delivery_end_date ?? updateData.trucking_completion_date ?? cur.trucking_completion_date),
            maxQtyRaw: planningMaxQtyKg,
            maxQtyLabel: 'Outstanding Qty (kg)',
          });
          if (!dd2.ok) {
            return res.status(400).json({ success: false, error: { message: dd2.message } });
          }
          updateFields.push(`daily_deliverables = $${paramIndex}::jsonb`);
          updateValues.push(JSON.stringify(dd2.rows));
          paramIndex++;
          // Keep denormalized date in sync
          const lastDd = dd2.rows.length > 0
            ? dd2.rows.reduce((mx, r) => (!mx || r.date > mx ? r.date : mx), '')
            : null;
          updateFields.push(`last_daily_deliverable_date = $${paramIndex}::date`);
          updateValues.push(lastDd);
          paramIndex++;
          continue;
        }

        if (dateFields.includes(key) && value) {
          // Cast date fields explicitly
          updateFields.push(`${key} = $${paramIndex}::date`);
        } else {
          updateFields.push(`${key} = $${paramIndex}`);
        }
        // Convert empty strings to null for date fields
        updateValues.push(dateFields.includes(key) && value === '' ? null : value);
        paramIndex++;
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
    updateValues.push(id);

    const queryText = `
      UPDATE trucking_operations 
      SET ${updateFields.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING *
    `;

    const result = await query(queryText, updateValues);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: { message: 'Trucking operation not found' },
      });
    }

    logger.info('Trucking operation updated:', { id, updatedFields: updateFields.length });
    invalidateTruckingListCache();

    return res.json({
      success: true,
      data: result.rows[0],
      message: 'Trucking operation updated successfully',
    });
  } catch (error) {
    logger.error('Update trucking operation error:', error);
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to update trucking operation' },
    });
  }
};

export const getTruckingDailyDeliverablesCalendar = async (req: AuthRequest, res: Response) => {
  try {
    await ensureMissingTruckingOperationIdsIfNeeded();
    const from = String((req.query as any).from || '').slice(0, 10);
    const to = String((req.query as any).to || '').slice(0, 10);
    if (!from || !to) {
      return res.status(400).json({ success: false, error: { message: 'from and to are required (YYYY-MM-DD)' } });
    }

    const globalSearch =
      typeof (req.query as any).search === 'string' ? (req.query as any).search.trim() : '';
    const lateIndicatorParam = (req.query as any).lateIndicator as string | undefined;
    const status = (req.query as any).status as string | undefined;
    const loadingLocation = (req.query as any).loadingLocation as string | undefined;
    const unloadingLocation = (req.query as any).unloadingLocation as string | undefined;
    const dateFrom = (req.query as any).dateFrom as string | undefined;
    const dateTo = (req.query as any).dateTo as string | undefined;
    const sto = (req.query as any).sto as string | undefined;
    const contract = (req.query as any).contract as string | undefined;
    const plant = (req.query as any).plant;
    const colFilters = parseColumnFiltersQuery((req.query as any).columnFilters);

    const params: any[] = [from, to];
    let idx = 3;
    let extraWhere = '';
    const truckingStoExprForStatus = `NULLIF(TRIM(c.sto_number::text), '')`;

    if (status && String(status).toUpperCase() !== 'ALL') {
      const stageFilter = appendTruckingPipelineStageFilter(
        String(status),
        truckingStoExprForStatus,
        idx,
      );
      extraWhere += stageFilter.sql;
      params.push(...stageFilter.params);
      idx = stageFilter.nextIndex;
    }
    if (loadingLocation && String(loadingLocation).trim() !== '') {
      extraWhere += ` AND t.loading_location ILIKE $${idx}`;
      params.push(`%${String(loadingLocation).trim()}%`);
      idx += 1;
    }
    if (unloadingLocation && String(unloadingLocation).trim() !== '') {
      extraWhere += ` AND t.unloading_location ILIKE $${idx}`;
      params.push(`%${String(unloadingLocation).trim()}%`);
      idx += 1;
    }
    // Dashboard baseline filters by CONTRACT DATE (YTD). Keep calendar filters aligned:
    // dateFrom/dateTo apply to contracts.contract_date (not trucking_start_date).
    if (dateFrom && String(dateFrom).trim() !== '') {
      extraWhere += ` AND c.contract_date >= $${idx}::date`;
      params.push(String(dateFrom).trim());
      idx += 1;
    }
    if (dateTo && String(dateTo).trim() !== '') {
      extraWhere += ` AND c.contract_date <= $${idx}::date`;
      params.push(String(dateTo).trim());
      idx += 1;
    }
    if (sto && String(sto).trim() !== '') {
      extraWhere += ` AND c.sto_number = $${idx}`;
      params.push(String(sto).trim());
      idx += 1;
    }
    if (contract && String(contract).trim() !== '') {
      extraWhere += ` AND c.contract_id = $${idx}`;
      params.push(String(contract).trim());
      idx += 1;
    }

    const plantListRaw = Array.isArray(plant) ? plant : plant ? [plant] : [];
    const plants = plantListRaw.map((v) => String(v).trim()).filter(Boolean);
    const groupPlantFilter = appendGroupPlantFilter(
      plants,
      idx,
      groupPlantExpr('c.plant_code', 'c.company_name'),
      'c.plant_code',
    );
    extraWhere += groupPlantFilter.sql;
    params.push(...groupPlantFilter.params);
    idx = groupPlantFilter.nextIndex;

    const gSearch = appendTruckingGlobalSearch(globalSearch, idx);
    extraWhere += gSearch.sql;
    params.push(...gSearch.params);
    idx = gSearch.nextIndex;

    const cCol = appendTruckingColumnFilters(colFilters, idx);
    extraWhere += cCol.sql;
    params.push(...cCol.params);
    idx = cCol.nextIndex;

    const li = appendTruckingLateIndicatorFilter(lateIndicatorParam, idx);
    extraWhere += li.sql;
    params.push(...li.params);
    idx = li.nextIndex;

    const qtySentSql = sqlTruckingQuantitySentCoalesce();
    const qtyDelSql = sqlTruckingQuantityDeliveredCoalesce();
    const qtyRecvSql = sqlTruckingQuantityReceiveCoalesce();
    const contractExtSql = `COALESCE(
          l.contract_ext_no,
          (SELECT COALESCE(spd.data->'raw'->>'Contract Ext No', spd.data->>'Contract Ext No')
           FROM sap_processed_data spd WHERE spd.contract_number = c.contract_id
           ORDER BY spd.created_at DESC NULLS LAST LIMIT 1)
        )`;
    const ltSpotSql = `COALESCE(
          (SELECT spd.data->'contract'->>'ltc_spot'
           FROM sap_processed_data spd
           WHERE spd.contract_number = c.contract_id
           ORDER BY spd.created_at DESC NULLS LAST
           LIMIT 1),
          c.contract_type::text
        )`;
    const outstandingQtySql = sqlTruckingOutstandingQtyByIncoterm(qtyDelSql, qtyRecvSql);

    const result = await query(
      `
      WITH latest_spd AS (
        SELECT DISTINCT ON (spd.contract_number)
          spd.contract_number,
          COALESCE(spd.data->'raw'->>'Contract Ext No', spd.data->>'Contract Ext No') AS contract_ext_no,
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
          ) AS contract_reference_po_raw
        FROM sap_processed_data spd
        WHERE spd.contract_number IS NOT NULL AND TRIM(spd.contract_number) != ''
        ORDER BY spd.contract_number, spd.created_at DESC NULLS LAST
      )
      SELECT
        t.id,
        t.operation_id,
        c.contract_id AS contract_number,
        ${contractExtSql} AS contract_ext_no,
        COALESCE(NULLIF(TRIM(c.sto_number::text), ''), NULL) AS sto_number,
        c.po_number,
        c.supplier,
        c.product,
        c.group_name,
        c.incoterm,
        c.source_type,
        ${ltSpotSql} AS lt_spot,
        t.loading_location,
        t.unloading_location,
        t.trucking_owner,
        t.eta_trucking_start_date,
        t.eta_trucking_completion_date,
        t.eta_delivery_start_date,
        t.eta_delivery_end_date,
        c.delivery_start_date,
        c.delivery_end_date,
        t.trucking_start_date,
        t.trucking_completion_date,
        ${qtySentSql} AS quantity_sent,
        ${qtyDelSql} AS quantity_delivered,
        ${qtyRecvSql} AS quantity_receive,
        ${outstandingQtySql} AS outstanding_quantity,
        t.daily_deliverables,
        COALESCE(
          (
            SELECT jsonb_agg(
              jsonb_build_object('date', da.progress_date::text, 'quantity_delivered', da.quantity_kg)
              ORDER BY da.progress_date
            )
            FROM trucking_daily_actuals da
            WHERE da.trucking_operation_id = t.id
          ),
          '[]'::jsonb
        ) AS daily_actuals,
        t.updated_at
      FROM trucking_operations t
      LEFT JOIN contracts c ON t.contract_id = c.id
      LEFT JOIN shipments s ON t.shipment_id = s.id
      ${TRUCKING_REALIZATIONS_JOIN}
      LEFT JOIN latest_spd l ON l.contract_number = c.contract_id
      WHERE
        NOT (
          c.contract_id IS NOT NULL
          AND UPPER(NULLIF(TRIM(COALESCE(l.b2b_flag_raw, c.contract_type::text, '')), '')) = 'B2B'
          AND NULLIF(TRIM(COALESCE(l.contract_reference_po_raw, '')), '') IS NOT NULL
        )
        ${truckingPageListScopeWhereSql}
        AND
        COALESCE(
          c.delivery_start_date,
          t.trucking_start_date,
          c.delivery_end_date,
          t.trucking_completion_date
        ) <= $2::date
        AND COALESCE(
          c.delivery_end_date,
          t.trucking_completion_date,
          c.delivery_start_date,
          t.trucking_start_date
        ) >= $1::date
        ${extraWhere}
      ORDER BY COALESCE(c.delivery_start_date, t.trucking_start_date) ASC NULLS LAST, t.operation_id ASC
      `,
      params,
    );

    return res.json({ success: true, data: result.rows });
  } catch (error) {
    logger.error('Get trucking daily deliverables calendar error:', error);
    return res.status(500).json({ success: false, error: { message: 'Failed to load daily planning deliverables' } });
  }
};

export const updateTruckingDailyDeliverables = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { daily_deliverables } = req.body || {};

    const currentRes = await query(
      `SELECT t.id,
              t.contract_id,
              c.delivery_start_date,
              c.delivery_end_date,
              t.eta_delivery_start_date,
              t.eta_delivery_end_date,
              t.eta_trucking_start_date,
              t.eta_trucking_completion_date,
              t.trucking_start_date,
              t.trucking_completion_date,
              ${sqlTruckingQuantityDeliveredCoalesce()} AS quantity_delivered
       FROM trucking_operations t
       LEFT JOIN contracts c ON t.contract_id = c.id
       WHERE t.id = $1
       LIMIT 1`,
      [id],
    );
    if (currentRes.rows.length === 0) {
      return res.status(404).json({ success: false, error: { message: 'Trucking operation not found' } });
    }
    const cur = currentRes.rows[0] as {
      contract_id: string;
      delivery_start_date?: string | null;
      delivery_end_date?: string | null;
      eta_delivery_start_date?: string | null;
      eta_delivery_end_date?: string | null;
      eta_trucking_start_date?: string | null;
      eta_trucking_completion_date?: string | null;
      trucking_start_date?: string | null;
      trucking_completion_date?: string | null;
      quantity_delivered?: unknown;
    };

    const contractOpen = await assertTruckingOperationContractOpen(id);
    if (!contractOpen.ok) {
      return res.status(403).json({
        success: false,
        error: { message: contractOpen.message },
      });
    }

    const startRaw =
      cur.delivery_start_date ??
      cur.eta_delivery_start_date ??
      cur.eta_trucking_start_date ??
      cur.trucking_start_date;
    const endRaw =
      cur.delivery_end_date ??
      cur.eta_delivery_end_date ??
      cur.eta_trucking_completion_date ??
      cur.trucking_completion_date;

    const planningMaxQtyKg = await resolveTruckingPlanningMaxQtyKg(cur.contract_id);
    const dd = normalizeAndValidateDailyDeliverables({
      daily_deliverables,
      startRaw,
      endRaw,
      maxQtyRaw: planningMaxQtyKg,
      maxQtyLabel: 'Outstanding Qty (kg)',
    });
    if (!dd.ok) {
      return res.status(400).json({ success: false, error: { message: dd.message } });
    }

    const lastDdDate = dd.rows.length > 0
      ? dd.rows.reduce((mx, r) => (!mx || r.date > mx ? r.date : mx), '')
      : null;
    const upd = await query(
      `UPDATE trucking_operations
       SET daily_deliverables = $2::jsonb,
           last_daily_deliverable_date = $3::date,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1
       RETURNING *`,
      [id, JSON.stringify(dd.rows), lastDdDate],
    );

    invalidateTruckingListCache();
    return res.json({ success: true, data: upd.rows[0], message: 'Daily planning deliverables updated successfully' });
  } catch (error) {
    logger.error('Update trucking daily deliverables error:', error);
    return res.status(500).json({ success: false, error: { message: 'Failed to update daily planning deliverables' } });
  }
};

const MAX_BULK_PLANNING_ROWS = 10000;

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

/** Same resolved quantity_delivered subquery as single-operation update (SAP fallback). */
function sqlResolvedQuantityDelivered(): string {
  return sqlTruckingQuantityDeliveredCoalesce();
}

export const downloadDailyPlanningDeliverablesTemplate = async (_req: AuthRequest, res: Response) => {
  const header = 'contract_ext_no,date,quantity_delivered';
  const example = 'EXT-12345,15/04/2026,1000';
  const bom = '\ufeff';
  const body = `${bom}${header}\n${example}\n`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="daily_planning_deliverables_template.csv"');
  return res.status(200).send(body);
};

export const bulkUploadDailyPlanningDeliverables = async (req: AuthRequest, res: Response) => {
  try {
    const file = (req as AuthRequest & { file?: Express.Multer.File }).file;
    if (!file?.buffer) {
      return res.status(400).json({ success: false, error: { message: 'File is required (CSV or Excel)' } });
    }

    let matrix: unknown[][];
    try {
      matrix = parsePlanningSheetToMatrix(file.buffer);
    } catch (e: any) {
      return res.status(400).json({
        success: false,
        error: { message: e?.message || 'Could not read spreadsheet' },
      });
    }

    if (matrix.length < 2) {
      return res.status(400).json({
        success: false,
        error: { message: 'File must include a header row and at least one data row' },
      });
    }

    const headerRow = matrix[0];
    const extIdx = findPlanningColumnIndex(headerRow, [
      'contract_ext_no',
      'contract ext no',
      'contractextno',
      'contract ext',
      'ext no',
    ]);
    const dateIdx = findPlanningColumnIndex(headerRow, ['date', 'tanggal']);
    const qtyIdx = findPlanningColumnIndex(headerRow, [
      'quantity_delivered',
      'quantity delivered',
      'quantity',
      'qty',
      'qty_delivered',
    ]);

    if (extIdx < 0 || dateIdx < 0 || qtyIdx < 0) {
      return res.status(400).json({
        success: false,
        error: {
          message:
            'Missing required columns. Expected headers: contract_ext_no, date, quantity_delivered (labels are case-insensitive)',
        },
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
      if (lines.length >= MAX_BULK_PLANNING_ROWS) {
        rowParseFailures.push({
          rowNumber: lineNumber,
          contract_ext_no: ext || '-',
          reason: `File exceeds maximum of ${MAX_BULK_PLANNING_ROWS} data rows`,
        });
        break;
      }

      if (!ext) {
        rowParseFailures.push({ rowNumber: lineNumber, contract_ext_no: '-', reason: 'contract_ext_no is required' });
        continue;
      }

      lines.push({ lineNumber, contract_ext_no: ext, dateRaw: dateRaw ?? '', qtyRaw: qtyCell });
    }

    const byContractExt = new Map<string, ParsedLine[]>();
    for (const ln of lines) {
      const k = ln.contract_ext_no.trim().toLowerCase();
      const list = byContractExt.get(k) || [];
      list.push(ln);
      byContractExt.set(k, list);
    }

    const opFailures: { contract_ext_no: string; rowNumbers: number[]; reason: string; operation_ids?: string[] }[] =
      [];
    let operationsSucceeded = 0;
    let rowsAccountedSuccess = 0;

    const qtySql = sqlResolvedQuantityDelivered();

    for (const [, group] of byContractExt.entries()) {
      const contractExtNo = group[0].contract_ext_no.trim();
      const rowNumbers = group.map((g) => g.lineNumber);
      const dateToLastLine = new Map<string, { quantity_delivered: number; lineNumber: number }>();
      let validRowLines = 0;

      for (const g of group) {
        const iso = toIsoDate10FromCell(g.dateRaw);
        if (!iso) {
          rowParseFailures.push({
            rowNumber: g.lineNumber,
            contract_ext_no: contractExtNo,
            reason: 'date is missing or could not be parsed (use YYYY-MM-DD or Excel date)',
          });
          continue;
        }
        const qn = parseDailyDeliverableQuantity(g.qtyRaw);
        if (qn === null || qn < 0) {
          rowParseFailures.push({
            rowNumber: g.lineNumber,
            contract_ext_no: contractExtNo,
            reason: 'quantity_delivered must be a valid non-negative number',
          });
          continue;
        }
        dateToLastLine.set(iso, { quantity_delivered: qn, lineNumber: g.lineNumber });
        validRowLines += 1;
      }

      if (dateToLastLine.size === 0) {
        continue;
      }

      const dailyDeliverablesWithLine = Array.from(dateToLastLine.entries())
        .map(([date, v]) => ({
          date,
          quantity_delivered: v.quantity_delivered,
          lineNumber: v.lineNumber,
        }))
        .sort((a, b) => a.date.localeCompare(b.date));

      const opRes = await query(
        `SELECT t.id,
                t.operation_id,
                t.contract_id,
                c.delivery_start_date,
                c.delivery_end_date,
                t.eta_delivery_start_date,
                t.eta_delivery_end_date,
                t.eta_trucking_start_date,
                t.eta_trucking_completion_date,
                t.trucking_start_date,
                t.trucking_completion_date,
                ${qtySql} AS quantity_delivered
         FROM trucking_operations t
         LEFT JOIN contracts c ON t.contract_id = c.id
         LEFT JOIN LATERAL (
           SELECT NULLIF(
             trim(COALESCE(spd.data->'raw'->>'Contract Ext No', spd.data->>'Contract Ext No')),
             ''
           ) AS ext_no
           FROM sap_processed_data spd
           WHERE spd.contract_number = c.contract_id
           ORDER BY spd.created_at DESC NULLS LAST
           LIMIT 1
         ) ext ON true
         WHERE trim(upper(COALESCE(ext.ext_no, ''))) = trim(upper($1::text))`,
        [contractExtNo],
      );

      if (opRes.rows.length === 0) {
        opFailures.push({
          contract_ext_no: contractExtNo,
          rowNumbers,
          reason:
            'No trucking operation found for this Contract Ext No (check SAP Contract Ext No matches a LAND contract with a trucking operation)',
        });
        continue;
      }

      if (opRes.rows.length > 1) {
        opFailures.push({
          contract_ext_no: contractExtNo,
          rowNumbers,
          reason: 'Multiple trucking operations share this Contract Ext No; cannot apply upload automatically',
          operation_ids: opRes.rows.map((r: { operation_id: string }) => r.operation_id),
        });
        continue;
      }

      const cur = opRes.rows[0] as {
        id: string;
        operation_id: string;
        contract_id: string;
        delivery_start_date?: string | null;
        delivery_end_date?: string | null;
        eta_delivery_start_date?: string | null;
        eta_delivery_end_date?: string | null;
        eta_trucking_start_date?: string | null;
        eta_trucking_completion_date?: string | null;
        trucking_start_date?: string | null;
        trucking_completion_date?: string | null;
        quantity_delivered?: unknown;
      };
      // Same “effective due window” idea as calendar overlap: prefer contract dates, then trucking ETAs, then actuals.
      const startRaw =
        cur.delivery_start_date ??
        cur.eta_delivery_start_date ??
        cur.eta_trucking_start_date ??
        cur.trucking_start_date;
      const endRaw =
        cur.delivery_end_date ??
        cur.eta_delivery_end_date ??
        cur.eta_trucking_completion_date ??
        cur.trucking_completion_date;
      const startS = toIsoDate10FromCell(startRaw);
      const endS = toIsoDate10FromCell(endRaw);
      const inWindow =
        startS && endS
          ? dailyDeliverablesWithLine.filter((r) => {
              const ok = r.date >= startS && r.date <= endS;
              if (!ok) {
                rowParseFailures.push({
                  rowNumber: r.lineNumber,
                  contract_ext_no: contractExtNo,
                  reason: `date ${r.date} is outside Due Start (${startS}) … Due End (${endS}) and was skipped`,
                });
              }
              return ok;
            })
          : dailyDeliverablesWithLine;

      if (inWindow.length === 0) {
        opFailures.push({
          contract_ext_no: contractExtNo,
          rowNumbers,
          reason:
            startS && endS
              ? `All rows are outside Due Start (${startS}) … Due End (${endS}); nothing to upload`
              : 'Due Start/Due End are required when daily deliverables are provided',
          operation_ids: [cur.operation_id],
        });
        continue;
      }

      const dailyDeliverables = inWindow.map(({ date, quantity_delivered }) => ({ date, quantity_delivered }));

      const planningMaxQtyKg = await resolveTruckingPlanningMaxQtyKg(cur.contract_id);
      const dd = normalizeAndValidateDailyDeliverables({
        daily_deliverables: dailyDeliverables,
        startRaw,
        endRaw,
        maxQtyRaw: planningMaxQtyKg,
        maxQtyLabel: 'Outstanding Qty (kg)',
      });

      if (!dd.ok) {
        opFailures.push({
          contract_ext_no: contractExtNo,
          rowNumbers,
          reason: dd.message,
          operation_ids: [cur.operation_id],
        });
        continue;
      }

      const lastDdDateBulk = dd.rows.length > 0
        ? dd.rows.reduce((mx: string, r: { date: string }) => (!mx || r.date > mx ? r.date : mx), '')
        : null;
      await query(
        `UPDATE trucking_operations
         SET daily_deliverables = $2::jsonb,
             last_daily_deliverable_date = $3::date,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [cur.id, JSON.stringify(dd.rows), lastDdDateBulk],
      );

      operationsSucceeded += 1;
      rowsAccountedSuccess += inWindow.length;
    }

    const processedRows = lines.length;
    const succeededOps = operationsSucceeded;
    const rowLevelIssues = rowParseFailures.length;

    invalidateTruckingListCache();
    return res.json({
      success: true,
      data: {
        processedRows,
        succeededOperations: succeededOps,
        failedOperations: opFailures.length,
        /** File rows that were valid and applied inside a successful operation update */
        succeededRows: rowsAccountedSuccess,
        rowLevelIssues,
        operationLevelFailures: opFailures.length,
        rowParseFailures,
        operationFailures: opFailures,
      },
    });
  } catch (error) {
    logger.error('Bulk upload daily planning deliverables error:', error);
    return res.status(500).json({ success: false, error: { message: 'Failed to process upload' } });
  }
};

// ---------------------------------------------------------------------------
// Bulk Create Trucking Operations from CSV
// CSV columns: Contract Ext No | Date | Qty Delivery
// ---------------------------------------------------------------------------

export const downloadBulkCreateTruckingTemplate = async (_req: AuthRequest, res: Response) => {
  // Generate 60 date columns starting from today
  const today = new Date();
  const dateCols: string[] = [];
  for (let i = 0; i < 60; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    dateCols.push(`${dd}/${mm}/${d.getFullYear()}`);
  }
  const header = ['Contract Ext No', ...dateCols].join(',');
  // Example: two contracts with some filled quantities
  const row1Qty = dateCols.map((_, i) => (i === 0 ? '1000' : i === 1 ? '1500' : ''));
  const row2Qty = dateCols.map((_, i) => (i === 2 ? '2000' : i === 3 ? '2000' : ''));
  const rows = [
    ['01/HAP-PFAD/2026', ...row1Qty].join(','),
    ['002/KJG/CPO/2026', ...row2Qty].join(','),
  ].join('\n');
  const bom = '﻿';
  const body = `${bom}${header}\n${rows}\n`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="bulk_create_trucking_template.csv"');
  return res.status(200).send(body);
};

export const bulkCreateTruckingOperations = async (req: AuthRequest, res: Response) => {
  try {
    const file = (req as AuthRequest & { file?: Express.Multer.File }).file;
    if (!file?.buffer) {
      return res.status(400).json({ success: false, error: { message: 'File is required (CSV or Excel)' } });
    }

    let matrix: unknown[][];
    try {
      matrix = parsePlanningSheetToMatrix(file.buffer);
    } catch (e: any) {
      return res.status(400).json({
        success: false,
        error: { message: e?.message || 'Could not read spreadsheet' },
      });
    }

    if (matrix.length < 2) {
      return res.status(400).json({
        success: false,
        error: { message: 'File must include a header row and at least one data row' },
      });
    }

    const headerRow = matrix[0];

    // Detect format: wide (pivot) if the 2nd column header parses as a date; otherwise long format
    const secondColRaw = headerRow[1];
    const secondColStr = String(secondColRaw ?? '').trim().toLowerCase();
    const isWideFormat =
      secondColStr !== 'date' &&
      secondColStr !== 'tanggal' &&
      secondColStr !== 'qty' &&
      secondColStr !== 'qty delivery' &&
      toIsoDate10FromCell(secondColRaw) !== null;

    type ParsedLine = { lineNumber: number; contract_ext_no: string; dateRaw: unknown; qtyRaw: unknown };
    const lines: ParsedLine[] = [];
    const rowParseFailures: { rowNumber: number; contract_ext_no: string; reason: string }[] = [];

    if (isWideFormat) {
      // Wide/pivot format: header row = [Contract Ext No, date1, date2, ...]
      // Each data row: [contractExtNo, qty1, qty2, ...]
      const dateColumns: { colIdx: number; dateRaw: unknown }[] = [];
      for (let ci = 1; ci < headerRow.length; ci++) {
        const cellVal = headerRow[ci];
        if (cellVal !== null && cellVal !== undefined && String(cellVal).trim() !== '') {
          dateColumns.push({ colIdx: ci, dateRaw: cellVal });
        }
      }

      if (dateColumns.length === 0) {
        return res.status(400).json({
          success: false,
          error: { message: 'Wide format detected but no date columns found in header row' },
        });
      }

      for (let rIdx = 1; rIdx < matrix.length; rIdx++) {
        const row = matrix[rIdx];
        const ext = String(row[0] ?? '').trim();
        const hasAnyQty = dateColumns.some(({ colIdx }) => {
          const v = row[colIdx];
          return v !== undefined && v !== null && String(v).trim() !== '';
        });
        if (!ext && !hasAnyQty) continue;

        const lineNumber = rIdx + 1;
        if (!ext) {
          rowParseFailures.push({ rowNumber: lineNumber, contract_ext_no: '-', reason: 'Contract Ext No is required' });
          continue;
        }
        if (ext.toUpperCase() === 'TBA') {
          rowParseFailures.push({ rowNumber: lineNumber, contract_ext_no: ext, reason: 'Contract Ext No "TBA" is not allowed — please fill in the actual contract number first' });
          continue;
        }

        let rowLimitHit = false;
        for (const { colIdx, dateRaw } of dateColumns) {
          const qtyCell = row[colIdx];
          if (qtyCell === undefined || qtyCell === null || String(qtyCell).trim() === '') continue;
          if (lines.length >= MAX_BULK_PLANNING_ROWS) {
            rowParseFailures.push({ rowNumber: lineNumber, contract_ext_no: ext, reason: `Exceeds max ${MAX_BULK_PLANNING_ROWS} rows` });
            rowLimitHit = true;
            break;
          }
          lines.push({ lineNumber, contract_ext_no: ext, dateRaw, qtyRaw: qtyCell });
        }
        if (rowLimitHit) break;
      }
    } else {
      // Long format: Contract Ext No | Date | Qty Delivery
      const extIdx = findPlanningColumnIndex(headerRow, [
        'contract_ext_no', 'contract ext no', 'contractextno', 'contract ext', 'ext no',
      ]);
      const dateIdx = findPlanningColumnIndex(headerRow, ['date', 'tanggal']);
      const qtyIdx = findPlanningColumnIndex(headerRow, [
        'qty_delivery', 'qty delivery', 'quantity_delivered', 'quantity delivered', 'quantity', 'qty',
      ]);

      if (extIdx < 0 || dateIdx < 0 || qtyIdx < 0) {
        return res.status(400).json({
          success: false,
          error: { message: 'Missing required columns. Expected: "Contract Ext No", "Date", "Qty Delivery"' },
        });
      }

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
        if (lines.length >= MAX_BULK_PLANNING_ROWS) {
          rowParseFailures.push({ rowNumber: lineNumber, contract_ext_no: ext || '-', reason: `Exceeds max ${MAX_BULK_PLANNING_ROWS} rows` });
          break;
        }
        if (!ext) {
          rowParseFailures.push({ rowNumber: lineNumber, contract_ext_no: '-', reason: 'Contract Ext No is required' });
          continue;
        }
        if (ext.toUpperCase() === 'TBA') {
          rowParseFailures.push({ rowNumber: lineNumber, contract_ext_no: ext, reason: 'Contract Ext No "TBA" is not allowed — please fill in the actual contract number first' });
          continue;
        }
        lines.push({ lineNumber, contract_ext_no: ext, dateRaw: dateRaw ?? '', qtyRaw: qtyCell });
      }
    }

    // Group rows by Contract Ext No
    const byContractExt = new Map<string, ParsedLine[]>();
    for (const ln of lines) {
      const k = ln.contract_ext_no.trim().toLowerCase();
      const list = byContractExt.get(k) || [];
      list.push(ln);
      byContractExt.set(k, list);
    }

    const opFailures: {
      contract_ext_no: string;
      rowNumbers: number[];
      reason: string;
      operation_ids?: string[];
    }[] = [];
    let operationsCreated = 0;
    let operationsUpdated = 0;
    let rowsSucceeded = 0;

    for (const [, groupLines] of byContractExt) {
      const contractExtNo = groupLines[0].contract_ext_no;
      const rowNumbers = groupLines.map((l) => l.lineNumber);

      const contract = await resolveContractByExtNoOrId(contractExtNo);
      if (!contract) {
        opFailures.push({
          contract_ext_no: contractExtNo,
          rowNumbers,
          reason: 'Contract Ext No not found in SAP data. Ensure SAP data has been imported for this contract.',
        });
        continue;
      }

      try {
        const outcome = await upsertTruckingDailyFromGroup(
          contract,
          contractExtNo,
          groupLines,
          rowNumbers,
          rowParseFailures,
          opFailures,
        );
        if (outcome === 'created') {
          operationsCreated += 1;
          rowsSucceeded += groupLines.length;
        } else if (outcome === 'updated') {
          operationsUpdated += 1;
          rowsSucceeded += groupLines.length;
        }
      } catch (err) {
        logger.error('upsertTruckingDailyFromGroup error:', err);
        opFailures.push({
          contract_ext_no: contractExtNo,
          rowNumbers,
          reason: 'Internal error saving trucking operation',
        });
      }
    }

    const processedRows = lines.length + rowParseFailures.length;

    if (operationsCreated > 0 || operationsUpdated > 0) invalidateTruckingListCache();
    return res.json({
      success: true,
      data: {
        processedRows,
        operationsCreated,
        operationsUpdated,
        operationsFailed: opFailures.length,
        succeededRows: rowsSucceeded,
        rowParseFailures,
        operationFailures: opFailures,
      },
    });
  } catch (error) {
    logger.error('Bulk create trucking operations error:', error);
    return res.status(500).json({ success: false, error: { message: 'Failed to process upload' } });
  }
};

type BulkTruckingOpFailure = {
  contract_ext_no: string;
  rowNumbers: number[];
  reason: string;
  operation_ids?: string[];
};

type FailedUnplannedRetemplateRow = {
  rowNumber: number;
  po_number: string;
  contract_ext_no: string;
  cells: string[];
  reason: string;
};

function resolveTruckingDueWindow(cur: {
  delivery_start_date?: unknown;
  delivery_end_date?: unknown;
  eta_delivery_start_date?: unknown;
  eta_delivery_end_date?: unknown;
  eta_trucking_start_date?: unknown;
  eta_trucking_completion_date?: unknown;
  trucking_start_date?: unknown;
  trucking_completion_date?: unknown;
}): { startRaw: unknown; endRaw: unknown } {
  return {
    startRaw:
      cur.delivery_start_date ??
      cur.eta_delivery_start_date ??
      cur.eta_trucking_start_date ??
      cur.trucking_start_date,
    endRaw:
      cur.delivery_end_date ??
      cur.eta_delivery_end_date ??
      cur.eta_trucking_completion_date ??
      cur.trucking_completion_date,
  };
}

/** Bulk-create: insert first operation per contract, otherwise update daily deliverables on the single active row. */
async function upsertTruckingDailyFromGroup(
  contract: { id: string; delivery_start_date?: unknown; delivery_end_date?: unknown },
  contractExtNo: string,
  groupLines: { lineNumber: number; contract_ext_no: string; dateRaw: unknown; qtyRaw: unknown }[],
  rowNumbers: number[],
  rowParseFailures: { rowNumber: number; contract_ext_no: string; reason: string }[],
  opFailures: BulkTruckingOpFailure[],
): Promise<'created' | 'updated' | false> {
  const dateToQty = new Map<string, { quantity_delivered: number; lineNumber: number }>();
  for (const ln of groupLines) {
    const ds = toIsoDate10FromCell(ln.dateRaw);
    if (!ds) {
      rowParseFailures.push({ rowNumber: ln.lineNumber, contract_ext_no: ln.contract_ext_no, reason: 'Invalid date' });
      continue;
    }
    const qty = parseDailyDeliverableQuantity(ln.qtyRaw);
    if (qty === null || qty < 0) {
      rowParseFailures.push({ rowNumber: ln.lineNumber, contract_ext_no: ln.contract_ext_no, reason: 'Invalid quantity' });
      continue;
    }
    dateToQty.set(ds, { quantity_delivered: qty, lineNumber: ln.lineNumber });
  }

  if (dateToQty.size === 0) {
    opFailures.push({ contract_ext_no: contractExtNo, rowNumbers, reason: 'No valid date/qty rows after parsing' });
    return false;
  }

  const dailyDeliverablesWithLine = Array.from(dateToQty.entries())
    .map(([date, v]) => ({
      date,
      quantity_delivered: v.quantity_delivered,
      lineNumber: v.lineNumber,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const activeOps = await findActiveTruckingOpsByContractId(contract.id);

  if (activeOps.length > 1) {
    opFailures.push({
      contract_ext_no: contractExtNo,
      rowNumbers,
      reason:
        'Multiple trucking operations share this contract; merge duplicates or cancel extras before bulk upload',
      operation_ids: activeOps
        .map((r) => (r.operation_id && String(r.operation_id).trim()) || r.id)
        .filter(Boolean),
    });
    return false;
  }

  if (activeOps.length === 1) {
    const cur = activeOps[0];
    const { startRaw, endRaw } = resolveTruckingDueWindow(cur);
    const startS = toIsoDate10FromCell(startRaw);
    const endS = toIsoDate10FromCell(endRaw);
    const inWindow =
      startS && endS
        ? dailyDeliverablesWithLine.filter((r) => {
            const ok = r.date >= startS && r.date <= endS;
            if (!ok) {
              rowParseFailures.push({
                rowNumber: r.lineNumber,
                contract_ext_no: contractExtNo,
                reason: `date ${r.date} is outside Due Start (${startS}) … Due End (${endS}) and was skipped`,
              });
            }
            return ok;
          })
        : dailyDeliverablesWithLine;

    if (inWindow.length === 0) {
      opFailures.push({
        contract_ext_no: contractExtNo,
        rowNumbers,
        reason:
          startS && endS
            ? `All rows are outside Due Start (${startS}) … Due End (${endS}); nothing to upload`
            : 'Due Start/Due End are required when daily deliverables are provided',
        operation_ids: cur.operation_id ? [String(cur.operation_id)] : [cur.id],
      });
      return false;
    }

    const dailyDeliverables = inWindow.map(({ date, quantity_delivered }) => ({ date, quantity_delivered }));
    const planningMaxQtyKg = await resolveTruckingPlanningMaxQtyKg(contract.id);
    const dd = normalizeAndValidateDailyDeliverables({
      daily_deliverables: dailyDeliverables,
      startRaw,
      endRaw,
      maxQtyRaw: planningMaxQtyKg,
      maxQtyLabel: 'Outstanding Qty (kg)',
    });
    if (!dd.ok) {
      opFailures.push({
        contract_ext_no: contractExtNo,
        rowNumbers,
        reason: dd.message,
        operation_ids: cur.operation_id ? [String(cur.operation_id)] : [cur.id],
      });
      return false;
    }

    const lastDdDate =
      dd.rows.length > 0
        ? dd.rows.reduce((mx: string, r: { date: string }) => (!mx || r.date > mx ? r.date : mx), '')
        : null;

    await query(
      `UPDATE trucking_operations
       SET daily_deliverables = $2::jsonb,
           last_daily_deliverable_date = $3::date,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1::uuid`,
      [cur.id, JSON.stringify(dd.rows), lastDdDate],
    );
    return 'updated';
  }

  const dailyRows = dailyDeliverablesWithLine.map(({ date, quantity_delivered }) => ({
    date,
    quantity_delivered,
  }));
  const sortedDates = dailyRows.map((r) => r.date).sort();
  const minDate = sortedDates[0];
  const maxDate = sortedDates[sortedDates.length - 1];
  const etaStart = contract.delivery_start_date
    ? (toIsoDate10FromCell(contract.delivery_start_date) ?? minDate)
    : minDate;
  const etaEnd = contract.delivery_end_date
    ? (toIsoDate10FromCell(contract.delivery_end_date) ?? maxDate)
    : maxDate;

  const dd = normalizeAndValidateDailyDeliverables({
    daily_deliverables: dailyRows,
    startRaw: contract.delivery_start_date ?? etaStart,
    endRaw: contract.delivery_end_date ?? etaEnd,
    maxQtyRaw: null,
  });
  if (!dd.ok) {
    opFailures.push({ contract_ext_no: contractExtNo, rowNumbers, reason: dd.message });
    return false;
  }

  const dmy = formatDDMMYYYY(new Date());
  const seq = await allocateNextSyntheticSequenceDefault('trucking_operations', 'LAND', dmy);
  const operationId = buildSyntheticOperationId('LAND', dmy, seq);
  const lastDdDate =
    dd.rows.length > 0
      ? dd.rows.reduce((mx: string, r: { date: string }) => (!mx || r.date > mx ? r.date : mx), '')
      : null;

  await query(
    `INSERT INTO trucking_operations (
       contract_id, operation_id,
       eta_delivery_start_date, eta_delivery_end_date,
       status, daily_deliverables, last_daily_deliverable_date
     ) VALUES (
       $1::uuid, $2,
       $3::date, $4::date,
       $5, $6::jsonb, $7::date
     )`,
    [
      contract.id,
      operationId,
      etaStart,
      etaEnd,
      'PLANNED',
      JSON.stringify(dd.rows),
      lastDdDate,
    ],
  );
  return 'created';
}

/** Daily planning XLSX (Unplanned + Planned): Status column informational; route by PO state. */
export const bulkUploadUnplannedPlanning = async (req: AuthRequest, res: Response) => {
  try {
    const file = (req as AuthRequest & { file?: Express.Multer.File }).file;
    if (!file?.buffer) {
      return res.status(400).json({ success: false, error: { message: 'File is required (CSV or Excel)' } });
    }

    let matrix: unknown[][];
    try {
      matrix = parsePlanningSheetToMatrix(file.buffer);
    } catch (e: any) {
      return res.status(400).json({
        success: false,
        error: { message: e?.message || 'Could not read spreadsheet' },
      });
    }

    if (matrix.length < 2) {
      return res.status(400).json({
        success: false,
        error: { message: 'File must include a header row and at least one data row' },
      });
    }

    if (!isUnplannedWidePlanningTemplateMatrix(matrix)) {
      return res.status(400).json({
        success: false,
        error: {
          message:
            'Invalid daily planning template. Expected headers: Group, Supplier, Source, Contract Date, Contract Ext No, PO, Status (optional), OS Qty (MT), Plan Qty (MT), then date columns (today … +60 days).',
        },
      });
    }

    const { rows: parsedRows, rowParseFailures } = parseUnplannedWidePlanningMatrix(matrix);
    const operationFailures: BulkTruckingOpFailure[] = [];
    const operationWarnings: BulkTruckingOpFailure[] = [];
    const failedRetemplateRows: FailedUnplannedRetemplateRow[] = [];
    const uploadHeaderRow = (matrix[0] ?? []).map((cell) => unplannedUploadCellToString(cell));
    let operationsCreated = 0;
    let operationsUpdated = 0;
    let succeededRows = 0;

    const allocateLandTruckingOperationId = async (): Promise<string> => {
      const dmy = formatDDMMYYYY(new Date());
      const seq = await allocateNextSyntheticSequenceDefault('trucking_operations', 'LAND', dmy);
      return buildSyntheticOperationId('LAND', dmy, seq);
    };

    for (const parsed of parsedRows) {
      const label = parsed.contract_ext_no || parsed.po_number || '-';

      // Status column is informational — route by PO state (Planned/In Progress with Operation ID).
      const plannedOp = await findTruckingOpForPlannedPlanningUpload({
        poNumber: parsed.po_number,
        contractExtNo: parsed.contract_ext_no,
      });

      if (plannedOp && truckingOperationIdIsAssigned(plannedOp.operation_id)) {
        const contractOpen = await assertTruckingOperationContractOpen(plannedOp.id);
        if (!contractOpen.ok) {
          operationFailures.push({
            contract_ext_no: label,
            rowNumbers: [parsed.rowNumber],
            reason: contractOpen.message,
            operation_ids: [String(plannedOp.operation_id)],
          });
          continue;
        }

        const inWindowEntriesPlanned = filterEntriesWithinUnplannedWindow(
          parsed.entries,
          plannedOp.delivery_end_date,
          label,
          rowParseFailures,
        );
        const editableEntries = filterEntriesLockedByActuals(
          inWindowEntriesPlanned,
          plannedOp.daily_actuals,
          label,
          rowParseFailures,
        );
        if (editableEntries.length === 0) {
          operationFailures.push({
            contract_ext_no: label,
            rowNumbers: [parsed.rowNumber],
            reason:
              'No editable planning quantities — all dates are outside the window or locked by WB actuals',
            operation_ids: [String(plannedOp.operation_id)],
          });
          continue;
        }

        const totalPlanningKgPlanned = sumPlanningEntriesKg(editableEntries);
        const outstandingKgPlanned = await fetchTruckingOperationOutstandingQtyKg(plannedOp.id);
        const osValidationPlanned = validatePlanningTotalAgainstOutstandingKg(
          totalPlanningKgPlanned,
          outstandingKgPlanned,
        );
        if (!osValidationPlanned.ok) {
          operationFailures.push({
            contract_ext_no: label,
            rowNumbers: [parsed.rowNumber],
            reason: osValidationPlanned.reason,
            operation_ids: [String(plannedOp.operation_id)],
          });
          failedRetemplateRows.push({
            rowNumber: parsed.rowNumber,
            po_number: parsed.po_number,
            contract_ext_no: parsed.contract_ext_no,
            cells: parsed.rawCells.map((cell) => unplannedUploadCellToString(cell)),
            reason: osValidationPlanned.reason,
          });
          continue;
        }

        const incomingDailyPlanned = buildDailyDeliverablesFromKgEntries(editableEntries);
        const mergedDailyPlanned = mergeDailyDeliverablesRows(
          plannedOp.daily_deliverables,
          incomingDailyPlanned,
        );
        const planningDatesPlanned = resolvePlanningStartEndFromDeliverables(mergedDailyPlanned);
        if (!planningDatesPlanned) {
          operationFailures.push({
            contract_ext_no: label,
            rowNumbers: [parsed.rowNumber],
            reason: 'No valid planning quantities after parsing',
            operation_ids: [String(plannedOp.operation_id)],
          });
          continue;
        }

        const duePlanned = resolveTruckingDueWindow(plannedOp);
        const ddPlanned = normalizeAndValidateDailyDeliverables({
          daily_deliverables: mergedDailyPlanned,
          startRaw: duePlanned.startRaw,
          endRaw: duePlanned.endRaw,
          maxQtyRaw: null,
        });
        if (!ddPlanned.ok) {
          operationFailures.push({
            contract_ext_no: label,
            rowNumbers: [parsed.rowNumber],
            reason: ddPlanned.message,
            operation_ids: [String(plannedOp.operation_id)],
          });
          continue;
        }

        const lastDdDatePlanned =
          ddPlanned.rows.length > 0
            ? ddPlanned.rows.reduce(
                (mx: string, r: { date: string }) => (!mx || r.date > mx ? r.date : mx),
                '',
              )
            : null;

        await query(
          `UPDATE trucking_operations
           SET daily_deliverables = $2::jsonb,
               last_daily_deliverable_date = $3::date,
               trucking_start_date = COALESCE(trucking_start_date, $4::date),
               trucking_completion_date = GREATEST(
                 COALESCE(trucking_completion_date, $5::date),
                 $5::date
               ),
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $1::uuid`,
          [
            plannedOp.id,
            JSON.stringify(ddPlanned.rows),
            lastDdDatePlanned,
            planningDatesPlanned.startIso,
            planningDatesPlanned.endIso,
          ],
        );
        operationsUpdated += 1;
        succeededRows += editableEntries.length;

        const siblingCountPlanned = Number(plannedOp.duplicate_sibling_count ?? 1);
        if (siblingCountPlanned > 1) {
          operationWarnings.push({
            contract_ext_no: label,
            rowNumbers: [parsed.rowNumber],
            reason: `Multiple trucking operations exist for this PO/contract (${siblingCountPlanned} active). Updated the Planned operation with Operation ID only.`,
            operation_ids: [String(plannedOp.operation_id)],
          });
        }
        continue;
      }

      const op = await findTruckingOpForUnplannedPlanningUpload({
        poNumber: parsed.po_number,
        contractExtNo: parsed.contract_ext_no,
      });

      let deliveryEnd: unknown;
      let contractForCreate: Awaited<ReturnType<typeof resolveContractForUnplannedPlanningUpload>> = null;
      let dueWindowSource: {
        delivery_start_date?: unknown;
        delivery_end_date?: unknown;
        eta_delivery_start_date?: unknown;
        eta_delivery_end_date?: unknown;
        eta_trucking_start_date?: unknown;
        eta_trucking_completion_date?: unknown;
        trucking_start_date?: unknown;
        trucking_completion_date?: unknown;
        quantity_delivered?: unknown;
      };

      if (op) {
        const contractOpen = await assertTruckingOperationContractOpen(op.id);
        if (!contractOpen.ok) {
          operationFailures.push({
            contract_ext_no: label,
            rowNumbers: [parsed.rowNumber],
            reason: contractOpen.message,
            operation_ids: op.operation_id ? [String(op.operation_id)] : [op.id],
          });
          continue;
        }
        deliveryEnd = op.delivery_end_date;
        dueWindowSource = op;
      } else {
        const contract = await resolveContractForUnplannedPlanningUpload({
          poNumber: parsed.po_number,
          contractExtNo: parsed.contract_ext_no,
        });
        if (!contract) {
          operationFailures.push({
            contract_ext_no: label,
            rowNumbers: [parsed.rowNumber],
            reason: 'Contract not found for this PO / Contract Ext No',
          });
          continue;
        }
        if (String(contract.transport_mode ?? '').trim().toUpperCase() === 'SEA') {
          operationFailures.push({
            contract_ext_no: label,
            rowNumbers: [parsed.rowNumber],
            reason: 'Cannot create trucking operation for SEA-only contract',
          });
          continue;
        }
        const importStatusRes = await query(
          `SELECT ${SQL_CONTRACT_IMPORT_STATUS} AS import_status FROM contracts c WHERE c.id = $1::uuid LIMIT 1`,
          [contract.id],
        );
        const importStatus = (importStatusRes.rows[0] as { import_status?: string | null } | undefined)
          ?.import_status;
        if (isContractDeliveryClosed(importStatus)) {
          operationFailures.push({
            contract_ext_no: label,
            rowNumbers: [parsed.rowNumber],
            reason: 'Contract status is Close — cannot add Unplanned planning',
          });
          continue;
        }
        deliveryEnd = contract.delivery_end_date;
        dueWindowSource = contract;
        contractForCreate = contract;
      }

      if (!deliveryEnd) {
        operationFailures.push({
          contract_ext_no: label,
          rowNumbers: [parsed.rowNumber],
          reason: 'Due Date Delivery (End) is missing for this contract/operation',
          operation_ids: op?.operation_id ? [String(op.operation_id)] : undefined,
        });
        continue;
      }

      const inWindowEntries = filterEntriesWithinUnplannedWindow(
        parsed.entries,
        deliveryEnd,
        label,
        rowParseFailures,
      );

      if (inWindowEntries.length === 0) {
        operationFailures.push({
          contract_ext_no: label,
          rowNumbers: [parsed.rowNumber],
          reason: 'All quantity cells are outside the allowed Unplanned planning date window',
          operation_ids: op?.operation_id ? [String(op.operation_id)] : undefined,
        });
        continue;
      }

      const contractUuid =
        contractForCreate?.id ??
        (
          await resolveContractForUnplannedPlanningUpload({
            poNumber: parsed.po_number,
            contractExtNo: parsed.contract_ext_no,
          })
        )?.id ??
        null;

      const totalPlanningKg = sumPlanningEntriesKg(inWindowEntries);
      const outstandingKg = contractUuid ? await fetchContractOutstandingQtyKg(contractUuid) : null;
      const osValidation = validatePlanningTotalAgainstOutstandingKg(totalPlanningKg, outstandingKg);
      if (!osValidation.ok) {
        operationFailures.push({
          contract_ext_no: label,
          rowNumbers: [parsed.rowNumber],
          reason: osValidation.reason,
          operation_ids: op?.operation_id ? [String(op.operation_id)] : undefined,
        });
        failedRetemplateRows.push({
          rowNumber: parsed.rowNumber,
          po_number: parsed.po_number,
          contract_ext_no: parsed.contract_ext_no,
          cells: parsed.rawCells.map((cell) => unplannedUploadCellToString(cell)),
          reason: osValidation.reason,
        });
        continue;
      }

      const incomingDaily = buildDailyDeliverablesFromKgEntries(inWindowEntries);
      const mergedDaily =
        op && truckingOperationIdIsAssigned(op.operation_id)
          ? mergeDailyDeliverablesRows(op.daily_deliverables, incomingDaily)
          : incomingDaily;
      const planningDates = resolvePlanningStartEndFromDeliverables(mergedDaily);
      if (!planningDates) {
        operationFailures.push({
          contract_ext_no: label,
          rowNumbers: [parsed.rowNumber],
          reason: 'No valid planning quantities after parsing',
          operation_ids: op?.operation_id ? [String(op.operation_id)] : undefined,
        });
        continue;
      }

      const { startRaw, endRaw } = resolveTruckingDueWindow(dueWindowSource);
      // Planning qty is kg and OS total is already validated above. Do not cap by
      // t.quantity_delivered — SAP often stores MT-scale values (e.g. 250 MT as 250).
      const dd = normalizeAndValidateDailyDeliverables({
        daily_deliverables: mergedDaily,
        startRaw,
        endRaw,
        maxQtyRaw: null,
      });
      if (!dd.ok) {
        operationFailures.push({
          contract_ext_no: label,
          rowNumbers: [parsed.rowNumber],
          reason: dd.message,
          operation_ids: op?.operation_id ? [String(op.operation_id)] : undefined,
        });
        continue;
      }

      const lastDdDate =
        dd.rows.length > 0
          ? dd.rows.reduce((mx: string, r: { date: string }) => (!mx || r.date > mx ? r.date : mx), '')
          : null;

      if (op && truckingOperationIdIsAssigned(op.operation_id)) {
        await query(
          `UPDATE trucking_operations
           SET daily_deliverables = $2::jsonb,
               last_daily_deliverable_date = $3::date,
               trucking_start_date = COALESCE(trucking_start_date, $4::date),
               trucking_completion_date = GREATEST(
                 COALESCE(trucking_completion_date, $5::date),
                 $5::date
               ),
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $1::uuid`,
          [op.id, JSON.stringify(dd.rows), lastDdDate, planningDates.startIso, planningDates.endIso],
        );
        operationsUpdated += 1;
        succeededRows += inWindowEntries.length;

        const siblingCount = Number(op.duplicate_sibling_count ?? 1);
        if (siblingCount > 1) {
          operationWarnings.push({
            contract_ext_no: label,
            rowNumbers: [parsed.rowNumber],
            reason: `Multiple trucking operations exist for this PO/contract (${siblingCount} active). Updated the operation with Operation ID only.`,
            operation_ids: [String(op.operation_id)],
          });
        }
        continue;
      }

      const newOperationId = await allocateLandTruckingOperationId();
      const etaStart =
        toIsoDate10FromCell(dueWindowSource.delivery_start_date) ?? planningDates.startIso;
      const etaEnd =
        toIsoDate10FromCell(dueWindowSource.delivery_end_date) ?? planningDates.endIso;

      if (op) {
        await query(
          `UPDATE trucking_operations
           SET operation_id = $2,
               daily_deliverables = $3::jsonb,
               last_daily_deliverable_date = $4::date,
               trucking_start_date = COALESCE(trucking_start_date, $5::date),
               trucking_completion_date = GREATEST(
                 COALESCE(trucking_completion_date, $6::date),
                 $6::date
               ),
               eta_delivery_start_date = COALESCE(eta_delivery_start_date, $7::date),
               eta_delivery_end_date = COALESCE(eta_delivery_end_date, $8::date),
               status = CASE WHEN status IS NULL OR TRIM(status) = '' THEN 'PLANNED' ELSE status END,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $1::uuid
             AND (operation_id IS NULL OR TRIM(operation_id::text) = '')`,
          [
            op.id,
            newOperationId,
            JSON.stringify(dd.rows),
            lastDdDate,
            planningDates.startIso,
            planningDates.endIso,
            etaStart,
            etaEnd,
          ],
        );
        operationsCreated += 1;
        succeededRows += inWindowEntries.length;
        continue;
      }

      if (!contractForCreate) {
        operationFailures.push({
          contract_ext_no: label,
          rowNumbers: [parsed.rowNumber],
          reason: 'Contract not found for this PO / Contract Ext No',
        });
        continue;
      }

      await query(
        `INSERT INTO trucking_operations (
           contract_id, operation_id,
           eta_delivery_start_date, eta_delivery_end_date,
           trucking_start_date, trucking_completion_date,
           status, daily_deliverables, last_daily_deliverable_date
         ) VALUES (
           $1::uuid, $2,
           $3::date, $4::date,
           $5::date, $6::date,
           'PLANNED', $7::jsonb, $8::date
         )`,
        [
          contractForCreate.id,
          newOperationId,
          etaStart,
          etaEnd,
          planningDates.startIso,
          planningDates.endIso,
          JSON.stringify(dd.rows),
          lastDdDate,
        ],
      );
      operationsCreated += 1;
      succeededRows += inWindowEntries.length;
    }

    if (operationsCreated > 0 || operationsUpdated > 0) invalidateTruckingListCache();

    return res.json({
      success: true,
      data: {
        processedRows: parsedRows.length + rowParseFailures.length,
        operationsCreated,
        operationsUpdated,
        operationsFailed: operationFailures.length,
        succeededRows,
        rowParseFailures,
        operationFailures,
        operationWarnings,
        failedRetemplateRows,
        uploadHeaderRow,
      },
    });
  } catch (error) {
    logger.error('Bulk upload daily planning error:', error);
    return res.status(500).json({ success: false, error: { message: 'Failed to process daily planning upload' } });
  }
};

/** Same PO-based combined handler as Unplanned (Status column ignored). */
export const bulkUploadPlannedPlanning = bulkUploadUnplannedPlanning;

/** Alias for combined Unplanned + Planned daily planning upload. */
export const bulkUploadCombinedDailyPlanning = bulkUploadUnplannedPlanning;

export const downloadCargoReadinessTemplate = async (_req: AuthRequest, res: Response) => {
  const header = 'PO,Date';
  const examples = [
    'OP-LAND-15042026001,15/04/2026',
    'OP-LAND-16042026002,16/04/2026',
  ].join('\n');
  const bom = '﻿';
  const body = `${bom}${header}\n${examples}\n`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="cargo_readiness_template.csv"');
  return res.status(200).send(body);
};

export const bulkUpdateCargoReadiness = async (req: AuthRequest, res: Response) => {
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
    const poIdx = findPlanningColumnIndex(headerRow, ['po', 'operation_id', 'operation id', 'op id']);
    const dateIdx = findPlanningColumnIndex(headerRow, [
      'date', 'cargo readiness date', 'cargo_readiness_date', 'cargo date', 'tanggal',
    ]);

    if (poIdx < 0) {
      return res.status(400).json({ success: false, error: { message: 'Missing required column: PO' } });
    }
    if (dateIdx < 0) {
      return res.status(400).json({ success: false, error: { message: 'Missing required column: Date' } });
    }

    let updated = 0;
    const errors: string[] = [];

    for (let i = 1; i < matrix.length; i++) {
      const row = matrix[i];
      const po = String(row[poIdx] ?? '').trim();
      const dateRaw = row[dateIdx];
      const cargoDate = toIsoDate10FromCell(dateRaw);

      if (!po && !dateRaw) continue;
      if (!po) { errors.push(`Row ${i + 1}: Missing PO`); continue; }
      if (!cargoDate) { errors.push(`Row ${i + 1}: Invalid date "${dateRaw}"`); continue; }

      // Match by operation_id first, then po_number from linked contract
      const result = await query(
        `UPDATE trucking_operations t
         SET cargo_readiness_date = $2, updated_at = CURRENT_TIMESTAMP
         WHERE t.operation_id = $1
            OR EXISTS (
              SELECT 1 FROM contracts c
              WHERE c.id = t.contract_id AND c.po_number = $1
            )`,
        [po, cargoDate],
      );

      if ((result.rowCount ?? 0) === 0) {
        errors.push(`Row ${i + 1}: No trucking operation found for PO "${po}"`);
      } else {
        updated += result.rowCount ?? 0;
      }
    }

    if (updated > 0) invalidateTruckingListCache();
    return res.json({
      success: true,
      data: { updated, errors },
      message: `Updated ${updated} operation(s)`,
    });
  } catch (error) {
    logger.error('Bulk update cargo readiness error:', error);
    return res.status(500).json({ success: false, error: { message: 'Failed to update cargo readiness dates' } });
  }
};

/** Activity / audit trail for a single trucking operation (modal history section). */
export const getTruckingActivityLog = async (req: AuthRequest, res: Response) => {
  try {
    const truckingId = String(req.params.truckingId || '').trim();
    if (!truckingId) {
      return res.status(400).json({ success: false, error: { message: 'Trucking operation ID is required' } });
    }

    const exists = await query(`SELECT id FROM trucking_operations WHERE id = $1 LIMIT 1`, [truckingId]);
    if (exists.rows.length === 0) {
      return res.status(404).json({ success: false, error: { message: 'Trucking operation not found' } });
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
       WHERE a.entity_type = 'TRUCKING_OPERATION' AND a.entity_id = $1
       ORDER BY a.timestamp DESC
       LIMIT 200`,
      [truckingId],
    );

    return res.json({ success: true, data: result.rows });
  } catch (error) {
    logger.error('Get trucking activity log error:', error);
    return res.status(500).json({ success: false, error: { message: 'Failed to load trucking activity log' } });
  }
};
