import { Response } from 'express';
import { query } from '../database/connection';
import { AuthRequest } from '../middleware/auth';
import logger from '../utils/logger';
import { normalizeAndValidateDailyDeliverables, parseDailyDeliverableQuantity } from '../utils/truckingDailyDeliverables';
import {
  appendTruckingColumnFilters,
  appendTruckingGlobalSearch,
  appendTruckingLateIndicatorFilter,
  parseColumnFiltersQuery,
} from '../utils/truckingListFilters';
import { parsePlanningSheetToMatrix, toIsoDate10FromCell } from '../utils/planningSheetDate';
import {
  allocateNextSyntheticSequenceDefault,
  buildSyntheticOperationId,
  formatDDMMYYYY,
} from '../utils/operationId';
import {
  sqlEffectiveTruckingCompletionDate,
  sqlEffectiveTruckingStartDate,
} from '../utils/truckingSapDates';

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
          COALESCE(spd.data->'raw'->>'Contract Ext No', spd.data->>'Contract Ext No') AS contract_ext_no
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
      WHERE
        COALESCE(l.contract_ext_no, '') ILIKE $1
        OR c.contract_id ILIKE $1
        OR COALESCE(c.sto_number, '') ILIKE $1
      ORDER BY COALESCE(l.contract_ext_no, c.contract_id)
      LIMIT 10
      `,
      [`%${term}%`]
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
    await ensureMissingTruckingOperationIds();
    const { status, location, loadingLocation, unloadingLocation, dateFrom, dateTo, sto, contract, plant, page = 1, limit = 10 } = req.query;
    const offset = (Number(page) - 1) * Number(limit);
    const globalSearch =
      typeof (req.query as any).search === 'string' ? (req.query as any).search.trim() : '';
    const colFilters = parseColumnFiltersQuery((req.query as any).columnFilters);
    const lateIndicatorParam = (req.query as any).lateIndicator as string | undefined;
    const sortKey = String((req.query as any).sortKey || 'created_at');
    const sortDirRaw = String((req.query as any).sortDir || 'desc').toLowerCase();
    const sortDir = sortDirRaw === 'asc' ? 'ASC' : 'DESC';

    let queryText = `
      SELECT 
        t.id,
        t.operation_id,
        t.contract_id,
        t.location,
        t.loading_location,
        t.unloading_location,
        t.trucking_owner,
        t.cargo_readiness_date,
        -- Use DB trucking dates, but fallback to SAP \"Trucking Start/Last Receive Date\" when DB is empty
        ${sqlEffectiveTruckingStartDate('c')} AS trucking_start_date,
        ${sqlEffectiveTruckingCompletionDate('c')} AS trucking_completion_date,
        t.eta_trucking_start_date,
        t.eta_trucking_completion_date,
        t.eta_delivery_start_date,
        t.eta_delivery_end_date,
        -- Quantities: prefer trucking_operations, fallback to latest SAP row for the contract
        COALESCE(
          t.quantity_sent,
          (
            SELECT CAST(REPLACE(REPLACE(TRIM(q.val), ',', ''), ' ', '') AS NUMERIC)
            FROM (
              SELECT COALESCE(
                spd.data->'raw'->>'Quantity Sent via Trucking (Based on Surat Jalan)',
                spd.data->>'quantity_sent_via_trucking_based_on_surat_jalan',
                spd.data->'raw'->>'Quantity Sent via Trucking',
                spd.data->'raw'->>'Quantity Sent',
                spd.data->>'Quantity Sent'
              ) AS val
              FROM sap_processed_data spd
              WHERE spd.contract_number = c.contract_id
              ORDER BY spd.created_at DESC NULLS LAST
              LIMIT 1
            ) q
            WHERE q.val IS NOT NULL AND trim(q.val) ~ '^[0-9.,\\s]+$'
          )
        ) AS quantity_sent,
        COALESCE(
          t.quantity_delivered,
          (
            SELECT CAST(REPLACE(REPLACE(TRIM(q.val), ',', ''), ' ', '') AS NUMERIC)
            FROM (
              SELECT COALESCE(
                spd.data->'raw'->>'Quantity Delivered via Trucking',
                spd.data->>'quantity_delivered_via_trucking',
                spd.data->'raw'->>'Qty Receive',
                spd.data->'raw'->>'Quantity Receive'
              ) AS val
              FROM sap_processed_data spd
              WHERE spd.contract_number = c.contract_id
              ORDER BY spd.created_at DESC NULLS LAST
              LIMIT 1
            ) q
            WHERE q.val IS NOT NULL AND trim(q.val) ~ '^[0-9.,\\s]+$'
          )
        ) AS quantity_delivered,
        -- UI expects quantity_receive; use delivered as a practical default
        COALESCE(
          NULL,
          t.quantity_delivered,
          (
            SELECT CAST(REPLACE(REPLACE(TRIM(q.val), ',', ''), ' ', '') AS NUMERIC)
            FROM (
              SELECT COALESCE(
                spd.data->'raw'->>'Qty Receive',
                spd.data->'raw'->>'Quantity Receive',
                spd.data->>'quantity_delivered_via_trucking'
              ) AS val
              FROM sap_processed_data spd
              WHERE spd.contract_number = c.contract_id
              ORDER BY spd.created_at DESC NULLS LAST
              LIMIT 1
            ) q
            WHERE q.val IS NOT NULL AND trim(q.val) ~ '^[0-9.,\\s]+$'
          )
        ) AS quantity_receive,
        t.gain_loss_percentage,
        t.gain_loss_amount,
        t.oa_budget,
        t.oa_actual,
        t.status,
        t.created_at,
        t.updated_at,
        CASE
          WHEN NULLIF(TRIM(c.sto_number::text), '') IS NOT NULL THEN
            (
              SELECT STRING_AGG(DISTINCT cc.contract_id, ', ' ORDER BY cc.contract_id)
              FROM contracts cc
              WHERE UPPER(COALESCE(NULLIF(TRIM(cc.transport_mode), ''), 'LAND')) = 'LAND'
                AND NULLIF(TRIM(cc.sto_number::text), '') = NULLIF(TRIM(c.sto_number::text), '')
            )
          WHEN NULLIF(TRIM(t.operation_id::text), '') IS NOT NULL THEN
            (
              SELECT STRING_AGG(DISTINCT cc2.contract_id, ', ' ORDER BY cc2.contract_id)
              FROM trucking_operations t2
              INNER JOIN contracts cc2 ON t2.contract_id = cc2.id
              WHERE NULLIF(TRIM(t2.operation_id::text), '') = NULLIF(TRIM(t.operation_id::text), '')
            )
          ELSE c.contract_id
        END AS contract_number,
        c.po_number,
        -- Prefer showing all SAP STOs when contract has multiple
        COALESCE(NULLIF(TRIM(c.sto_number::text), ''), sa.sto_numbers) AS sto_number,
        sa.sto_numbers AS sto_numbers,
        c.quantity_ordered as sto_quantity,
        c.quantity_ordered as contract_qty,
        c.delivery_start_date,
        c.delivery_end_date,
        c.supplier,
        c.buyer,
        c.product,
        c.group_name,
        s.estimated_km,
        CASE
          WHEN NULLIF(TRIM(c.sto_number::text), '') IS NOT NULL THEN
            (
              SELECT STRING_AGG(DISTINCT NULLIF(TRIM(z.v), ''), ', ' ORDER BY NULLIF(TRIM(z.v), ''))
              FROM (
                SELECT COALESCE(spd.data->'raw'->>'Contract Ext No', spd.data->>'Contract Ext No') AS v
                FROM sap_processed_data spd
                WHERE spd.contract_number IN (
                  SELECT cc.contract_id
                  FROM contracts cc
                  WHERE UPPER(COALESCE(NULLIF(TRIM(cc.transport_mode), ''), 'LAND')) = 'LAND'
                    AND NULLIF(TRIM(cc.sto_number::text), '') = NULLIF(TRIM(c.sto_number::text), '')
                )
              ) z
              WHERE NULLIF(TRIM(z.v), '') IS NOT NULL
            )
          WHEN NULLIF(TRIM(t.operation_id::text), '') IS NOT NULL THEN
            (
              SELECT STRING_AGG(DISTINCT NULLIF(TRIM(z.v), ''), ', ' ORDER BY NULLIF(TRIM(z.v), ''))
              FROM (
                SELECT COALESCE(spd.data->'raw'->>'Contract Ext No', spd.data->>'Contract Ext No') AS v
                FROM sap_processed_data spd
                WHERE spd.contract_number IN (
                  SELECT cc2.contract_id
                  FROM trucking_operations t2
                  INNER JOIN contracts cc2 ON t2.contract_id = cc2.id
                  WHERE NULLIF(TRIM(t2.operation_id::text), '') = NULLIF(TRIM(t.operation_id::text), '')
                )
              ) z
              WHERE NULLIF(TRIM(z.v), '') IS NOT NULL
            )
          ELSE
            (
              SELECT COALESCE(
                spd.data->'raw'->>'Contract Ext No',
                spd.data->>'Contract Ext No'
              )
              FROM sap_processed_data spd
              WHERE spd.contract_number = c.contract_id
              ORDER BY spd.created_at DESC NULLS LAST
              LIMIT 1
            )
        END AS contract_ext_no
      FROM trucking_operations t
      LEFT JOIN contracts c ON t.contract_id = c.id
      LEFT JOIN shipments s ON t.shipment_id = s.id
      -- Match dashboard baseline: exclude B2B "child" contracts (latest SAP says B2B + Contract Reference PO not blank)
      LEFT JOIN LATERAL (
        SELECT
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
        WHERE spd.contract_number = c.contract_id
        ORDER BY spd.created_at DESC NULLS LAST
        LIMIT 1
      ) b2b ON true
      LEFT JOIN LATERAL (
        SELECT STRING_AGG(DISTINCT x.effective_sto, ', ' ORDER BY x.effective_sto) AS sto_numbers
        FROM (
          SELECT NULLIF(TRIM(COALESCE(
            spd.sto_number::text,
            spd.data->'raw'->>'STO No.',
            spd.data->'raw'->>'STO Number',
            spd.data->'shipment'->>'sto_no',
            spd.data->'contract'->>'sto_no'
          )), '') AS effective_sto
          FROM sap_processed_data spd
          WHERE spd.contract_number = c.contract_id
        ) x
        WHERE x.effective_sto IS NOT NULL AND x.effective_sto != ''
      ) sa ON true
      WHERE 1=1
        AND NOT (
          c.contract_id IS NOT NULL
          AND UPPER(NULLIF(TRIM(COALESCE(b2b.b2b_flag_raw, c.contract_type::text, '')), '')) = 'B2B'
          AND NULLIF(TRIM(COALESCE(b2b.contract_reference_po_raw, '')), '') IS NOT NULL
        )
    `;
    const queryParams: any[] = [];
    let paramIndex = 1;

    if (status) {
      const s = String(status).toUpperCase();
      if (s === 'COMPLETED') {
        queryText += ` AND COALESCE(t.status, '') <> 'CANCELLED' AND ${sqlEffectiveTruckingCompletionDate('c')} IS NOT NULL`;
      } else if (s === 'IN_PROGRESS') {
        queryText += ` AND COALESCE(t.status, '') <> 'CANCELLED' AND ${sqlEffectiveTruckingCompletionDate('c')} IS NULL AND ${sqlEffectiveTruckingStartDate('c')} IS NOT NULL`;
      } else if (s === 'PLANNED') {
        queryText += ` AND COALESCE(t.status, '') <> 'CANCELLED' AND ${sqlEffectiveTruckingCompletionDate('c')} IS NULL AND ${sqlEffectiveTruckingStartDate('c')} IS NULL`;
      } else {
        queryText += ` AND t.status = $${paramIndex}`;
        queryParams.push(status);
        paramIndex++;
      }
    }

    if (location) {
      queryText += ` AND t.location ILIKE $${paramIndex}`;
      queryParams.push(`%${location}%`);
      paramIndex++;
    }

    if (loadingLocation) {
      queryText += ` AND t.loading_location ILIKE $${paramIndex}`;
      queryParams.push(`%${loadingLocation}%`);
      paramIndex++;
    }

    if (unloadingLocation) {
      queryText += ` AND t.unloading_location ILIKE $${paramIndex}`;
      queryParams.push(`%${unloadingLocation}%`);
      paramIndex++;
    }

    // Dashboard baseline filters by CONTRACT DATE (YTD). Keep Trucking page aligned:
    // dateFrom/dateTo apply to contracts.contract_date (not trucking_start_date).
    if (dateFrom) {
      queryText += ` AND c.contract_date >= $${paramIndex}`;
      queryParams.push(dateFrom);
      paramIndex++;
    }

    if (dateTo) {
      queryText += ` AND c.contract_date <= $${paramIndex}`;
      queryParams.push(dateTo);
      paramIndex++;
    }

    if (sto) {
      queryText += ` AND c.sto_number = $${paramIndex}`;
      queryParams.push(sto);
      paramIndex++;
    }

    if (contract) {
      queryText += ` AND c.contract_id = $${paramIndex}`;
      queryParams.push(contract);
      paramIndex++;
    }

    const plantListRaw = Array.isArray(plant) ? plant : plant ? [plant] : [];
    const plants = plantListRaw.map((v) => String(v).trim()).filter(Boolean);
    if (plants.length > 0) {
      // Plant/Site filter: map to unloading location (fallback to derived location).
      queryText += ` AND COALESCE(NULLIF(TRIM(t.unloading_location::text), ''), NULLIF(TRIM(t.location::text), ''), '') = ANY($${paramIndex}::text[])`;
      queryParams.push(plants);
      paramIndex++;
    }

    const innerParams = [...queryParams];
    const outerStart = paramIndex;

    let fp = outerStart;
    const gSearch = appendTruckingGlobalSearch(globalSearch, fp);
    fp = gSearch.nextIndex;
    const cCol = appendTruckingColumnFilters(colFilters, fp);
    fp = cCol.nextIndex;
    const li = appendTruckingLateIndicatorFilter(lateIndicatorParam, fp);
    fp = li.nextIndex;

    const outerSql = `${gSearch.sql}${cCol.sql}${li.sql}`;
    const outerParams = [...gSearch.params, ...cCol.params, ...li.params];

    const preOuterQuery = queryText;
    const allowedSort: Record<string, string> = {
      created_at: 't.created_at',
      operation_id: 't.operation_id',
      status: 't.status',
      contract_number: 'c.contract_id',
      po_number: 'c.po_number',
      sto_number: 'COALESCE(NULLIF(TRIM(c.sto_number::text), \'\'), sa.sto_numbers)',
      trucking_owner: 't.trucking_owner',
      loading_location: 't.loading_location',
      unloading_location: 't.unloading_location',
      trucking_start_date: 't.trucking_start_date',
      trucking_completion_date: 't.trucking_completion_date',
      delivery_start_date: 'c.delivery_start_date',
      delivery_end_date: 'c.delivery_end_date',
      quantity_delivered: 't.quantity_delivered',
      quantity_sent: 't.quantity_sent',
      oa_budget: 't.oa_budget',
      oa_actual: 't.oa_actual',
      gain_loss_percentage: 't.gain_loss_percentage',
      gain_loss_amount: 't.gain_loss_amount',
    };
    const orderExpr = allowedSort[sortKey] || 't.created_at';
    queryText = `${preOuterQuery}${outerSql} ORDER BY ${orderExpr} ${sortDir} NULLS LAST, t.created_at DESC LIMIT $${fp} OFFSET $${fp + 1}`;
    const mainParams = [...innerParams, ...outerParams, Number(limit), offset];

    const result = await query(queryText, mainParams);

    const countQuery = `SELECT COUNT(*)::bigint AS count FROM (${preOuterQuery}${outerSql}) AS _trucking_filtered`;
    const countParams = [...innerParams, ...outerParams];

    const countResult = await query(countQuery, countParams);
    const summaryQuery = `
      SELECT
        COUNT(*)::bigint AS total_count,
        COUNT(*) FILTER (
          WHERE COALESCE(status, '') <> 'CANCELLED'
            AND trucking_completion_date IS NULL
            AND trucking_start_date IS NULL
        )::bigint AS planned_count,
        COUNT(*) FILTER (
          WHERE COALESCE(status, '') <> 'CANCELLED'
            AND trucking_completion_date IS NULL
            AND trucking_start_date IS NOT NULL
        )::bigint AS in_progress_count,
        COUNT(*) FILTER (WHERE status = 'LOADING')::bigint AS loading_count,
        COUNT(*) FILTER (WHERE status = 'IN_TRANSIT')::bigint AS in_transit_count,
        COUNT(*) FILTER (WHERE status = 'UNLOADING')::bigint AS unloading_count,
        COUNT(*) FILTER (
          WHERE COALESCE(status, '') <> 'CANCELLED'
            AND trucking_completion_date IS NOT NULL
        )::bigint AS completed_count,
        COUNT(*) FILTER (WHERE status = 'CANCELLED')::bigint AS cancelled_count
      FROM (${preOuterQuery}${outerSql}) AS _trucking_filtered
    `;
    const summaryResult = await query(summaryQuery, countParams);
    const sr = summaryResult.rows[0] || {};

    return res.json({
      success: true,
      data: {
        truckingOperations: result.rows,
        summary: {
          total: Number(sr.total_count || 0),
          status: {
            planned: Number(sr.planned_count || 0),
            inProgress: Number(sr.in_progress_count || 0),
            loading: Number(sr.loading_count || 0),
            inTransit: Number(sr.in_transit_count || 0),
            unloading: Number(sr.unloading_count || 0),
            completed: Number(sr.completed_count || 0),
            cancelled: Number(sr.cancelled_count || 0),
          },
        },
        pagination: {
          total: parseInt(countResult.rows[0].count),
          page: Number(page),
          limit: Number(limit),
          totalPages: Math.ceil(parseInt(countResult.rows[0].count) / Number(limit)),
        },
      },
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

export const getTruckingOperationById = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const result = await query(
      `SELECT 
        t.*,
        c.contract_id as contract_number,
        c.supplier,
        c.buyer,
        c.product,
        c.group_name,
        c.quantity_ordered,
        c.unit
       FROM trucking_operations t
       LEFT JOIN contracts c ON t.contract_id = c.id
       WHERE t.id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: { message: 'Trucking operation not found' },
      });
    }

    return res.json({
      success: true,
      data: result.rows[0],
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
    // Resolve contract by Contract ID OR Contract Ext No (latest SAP)
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
      SELECT c.id
      FROM contracts c
      LEFT JOIN latest_spd l ON l.contract_number = c.contract_id
      WHERE c.contract_id = $1 OR COALESCE(l.contract_ext_no, '') = $1
      ORDER BY (c.contract_id = $1) DESC
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

    const contractId = contractResult.rows[0].id;

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
    const dd = normalizeAndValidateDailyDeliverables({
      daily_deliverables,
      startRaw: contractDates.delivery_start_date ?? trucking_start_date,
      endRaw: contractDates.delivery_end_date ?? trucking_completion_date,
      maxQtyRaw: quantity_delivered,
    });
    if (!dd.ok) {
      return res.status(400).json({ success: false, error: { message: dd.message } });
    }

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
        daily_deliverables
      ) VALUES (
        $1::uuid, $2, $3, $4, $5, $6, $7::date,
        $8::date, $9::date,
        $10::date, $11::date,
        $12::date, $13::date,
        $14::numeric, $15::numeric, $16::numeric,
        $17::numeric, $18::numeric, $19::numeric, $20,
        $21::jsonb
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
        deriveTruckingStatus(trucking_start_date, trucking_completion_date, cargo_readiness_date),
        JSON.stringify(dd.rows)
      ]
    );

    logger.info('Trucking operation created:', { id: result.rows[0].id, operation_id: finalOperationId });

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
        WHERE c.contract_id = $1
           OR COALESCE(l.contract_ext_no, '') = $1
        ORDER BY (c.contract_id = $1) DESC
        LIMIT 1
      )
      SELECT
        c.id,
        c.contract_id,
        l.contract_ext_no,
        c.sto_number,
        c.supplier,
        c.buyer,
        c.product,
        c.group_name,
        c.quantity_ordered,
        c.contract_date,
        c.delivery_start_date,
        c.delivery_end_date,
        c.plant_code,
        mp.plant_name,
        mp.company_name AS plant_company_name
      FROM matched c
      LEFT JOIN latest_spd l ON l.contract_number = c.contract_id
      LEFT JOIN master_plants mp ON mp.plant_code = c.plant_code
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

    return res.json({
      success: true,
      exists: true,
      data: result.rows[0],
    });
  } catch (error) {
    logger.error('Validate contract number error:', error);
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to validate contract number' },
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
          const dd2 = normalizeAndValidateDailyDeliverables({
            daily_deliverables: value,
            startRaw: (cur.delivery_start_date ?? updateData.trucking_start_date ?? cur.trucking_start_date),
            endRaw: (cur.delivery_end_date ?? updateData.trucking_completion_date ?? cur.trucking_completion_date),
            maxQtyRaw: updateData.quantity_delivered ?? cur.quantity_delivered,
          });
          if (!dd2.ok) {
            return res.status(400).json({ success: false, error: { message: dd2.message } });
          }
          updateFields.push(`daily_deliverables = $${paramIndex}::jsonb`);
          updateValues.push(JSON.stringify(dd2.rows));
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
    await ensureMissingTruckingOperationIds();
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

    const params: any[] = [from, to];
    let idx = 3;
    let extraWhere = '';

    if (status && String(status).toUpperCase() !== 'ALL') {
      extraWhere += ` AND t.status = $${idx}`;
      params.push(status);
      idx += 1;
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

    const gSearch = appendTruckingGlobalSearch(globalSearch, idx);
    extraWhere += gSearch.sql;
    params.push(...gSearch.params);
    idx = gSearch.nextIndex;

    const li = appendTruckingLateIndicatorFilter(lateIndicatorParam, idx);
    extraWhere += li.sql;
    params.push(...li.params);
    idx = li.nextIndex;

    const qtySentSql = `COALESCE(
          t.quantity_sent,
          (
            SELECT CAST(REPLACE(REPLACE(TRIM(q.val), ',', ''), ' ', '') AS NUMERIC)
            FROM (
              SELECT COALESCE(
                spd.data->'raw'->>'Quantity Sent via Trucking (Based on Surat Jalan)',
                spd.data->>'quantity_sent_via_trucking_based_on_surat_jalan',
                spd.data->'raw'->>'Quantity Sent via Trucking',
                spd.data->'raw'->>'Quantity Sent',
                spd.data->>'Quantity Sent'
              ) AS val
              FROM sap_processed_data spd
              WHERE spd.contract_number = c.contract_id
              ORDER BY spd.created_at DESC NULLS LAST
              LIMIT 1
            ) q
            WHERE q.val IS NOT NULL AND trim(q.val) ~ '^[0-9.,\\s]+$'
          )
        )`;
    const qtyDelSql = `COALESCE(
          t.quantity_delivered,
          (
            SELECT CAST(REPLACE(REPLACE(TRIM(q.val), ',', ''), ' ', '') AS NUMERIC)
            FROM (
              SELECT COALESCE(
                spd.data->'raw'->>'Quantity Delivered via Trucking',
                spd.data->>'quantity_delivered_via_trucking',
                spd.data->'raw'->>'Qty Receive',
                spd.data->'raw'->>'Quantity Receive'
              ) AS val
              FROM sap_processed_data spd
              WHERE spd.contract_number = c.contract_id
              ORDER BY spd.created_at DESC NULLS LAST
              LIMIT 1
            ) q
            WHERE q.val IS NOT NULL AND trim(q.val) ~ '^[0-9.,\\s]+$'
          )
        )`;
    const qtyRecvSql = `COALESCE(
          t.quantity_delivered,
          (
            SELECT CAST(REPLACE(REPLACE(TRIM(q.val), ',', ''), ' ', '') AS NUMERIC)
            FROM (
              SELECT COALESCE(
                spd.data->'raw'->>'Qty Receive',
                spd.data->'raw'->>'Quantity Receive',
                spd.data->>'quantity_delivered_via_trucking'
              ) AS val
              FROM sap_processed_data spd
              WHERE spd.contract_number = c.contract_id
              ORDER BY spd.created_at DESC NULLS LAST
              LIMIT 1
            ) q
            WHERE q.val IS NOT NULL AND trim(q.val) ~ '^[0-9.,\\s]+$'
          )
        )`;
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
    const outstandingQtySql = `GREATEST(
          COALESCE(c.quantity_ordered, 0)
          - COALESCE(${qtyRecvSql}, 0),
          0
        )`;

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
        t.updated_at
      FROM trucking_operations t
      LEFT JOIN contracts c ON t.contract_id = c.id
      LEFT JOIN latest_spd l ON l.contract_number = c.contract_id
      WHERE
        NOT (
          c.contract_id IS NOT NULL
          AND UPPER(NULLIF(TRIM(COALESCE(l.b2b_flag_raw, c.contract_type::text, '')), '')) = 'B2B'
          AND NULLIF(TRIM(COALESCE(l.contract_reference_po_raw, '')), '') IS NOT NULL
        )
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
              c.delivery_start_date,
              c.delivery_end_date,
              t.eta_delivery_start_date,
              t.eta_delivery_end_date,
              t.eta_trucking_start_date,
              t.eta_trucking_completion_date,
              t.trucking_start_date,
              t.trucking_completion_date,
              COALESCE(
                t.quantity_delivered,
                (
                  SELECT CAST(REPLACE(REPLACE(TRIM(q.val), ',', ''), ' ', '') AS NUMERIC)
                  FROM (
                    SELECT COALESCE(
                      spd.data->'raw'->>'Quantity Delivered via Trucking',
                      spd.data->>'quantity_delivered_via_trucking',
                      spd.data->'raw'->>'Qty Receive',
                      spd.data->'raw'->>'Quantity Receive'
                    ) AS val
                    FROM sap_processed_data spd
                    WHERE spd.contract_number = c.contract_id
                    ORDER BY spd.created_at DESC NULLS LAST
                    LIMIT 1
                  ) q
                  WHERE q.val IS NOT NULL AND trim(q.val) ~ '^[0-9.,\\s]+$'
                )
              ) AS quantity_delivered
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

    const dd = normalizeAndValidateDailyDeliverables({
      daily_deliverables,
      startRaw,
      endRaw,
      maxQtyRaw: cur.quantity_delivered,
    });
    if (!dd.ok) {
      return res.status(400).json({ success: false, error: { message: dd.message } });
    }

    const upd = await query(
      `UPDATE trucking_operations
       SET daily_deliverables = $2::jsonb, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1
       RETURNING *`,
      [id, JSON.stringify(dd.rows)],
    );

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
  return `COALESCE(
                t.quantity_delivered,
                (
                  SELECT CAST(REPLACE(REPLACE(TRIM(q.val), ',', ''), ' ', '') AS NUMERIC)
                  FROM (
                    SELECT COALESCE(
                      spd.data->'raw'->>'Quantity Delivered via Trucking',
                      spd.data->>'quantity_delivered_via_trucking',
                      spd.data->'raw'->>'Qty Receive',
                      spd.data->'raw'->>'Quantity Receive'
                    ) AS val
                    FROM sap_processed_data spd
                    WHERE spd.contract_number = c.contract_id
                    ORDER BY spd.created_at DESC NULLS LAST
                    LIMIT 1
                  ) q
                  WHERE q.val IS NOT NULL AND trim(q.val) ~ '^[0-9.,\\s]+$'
                )
              )`;
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

      const dd = normalizeAndValidateDailyDeliverables({
        daily_deliverables: dailyDeliverables,
        startRaw,
        endRaw,
        maxQtyRaw: cur.quantity_delivered,
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

      await query(
        `UPDATE trucking_operations
         SET daily_deliverables = $2::jsonb, updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [cur.id, JSON.stringify(dd.rows)],
      );

      operationsSucceeded += 1;
      rowsAccountedSuccess += inWindow.length;
    }

    const processedRows = lines.length;
    const succeededOps = operationsSucceeded;
    const rowLevelIssues = rowParseFailures.length;

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
  // Generate 14 date columns starting from today
  const today = new Date();
  const dateCols: string[] = [];
  for (let i = 0; i < 14; i++) {
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

    const opFailures: { contract_ext_no: string; rowNumbers: number[]; reason: string }[] = [];
    let operationsCreated = 0;
    let rowsSucceeded = 0;

    for (const [, groupLines] of byContractExt) {
      const contractExtNo = groupLines[0].contract_ext_no;
      const rowNumbers = groupLines.map((l) => l.lineNumber);

      // Resolve contract via SAP ext no
      const contractRes = await query(
        `SELECT c.id, c.delivery_start_date, c.delivery_end_date
         FROM trucking_operations t
         LEFT JOIN contracts c ON t.contract_id = c.id
         LEFT JOIN LATERAL (
           SELECT NULLIF(trim(COALESCE(spd.data->'raw'->>'Contract Ext No', spd.data->>'Contract Ext No')), '') AS ext_no
           FROM sap_processed_data spd
           WHERE spd.contract_number = c.contract_id
           ORDER BY spd.created_at DESC NULLS LAST LIMIT 1
         ) ext ON true
         WHERE trim(upper(COALESCE(ext.ext_no, ''))) = trim(upper($1::text))
         LIMIT 1`,
        [contractExtNo],
      );

      if (contractRes.rows.length === 0) {
        // Try resolving via contracts.contract_id directly or SAP lookup without existing trucking op
        const contractDirectRes = await query(
          `WITH latest_spd AS (
             SELECT DISTINCT ON (spd.contract_number) spd.contract_number,
               COALESCE(spd.data->'raw'->>'Contract Ext No', spd.data->>'Contract Ext No') AS contract_ext_no
             FROM sap_processed_data spd
             WHERE spd.contract_number IS NOT NULL
             ORDER BY spd.contract_number, spd.created_at DESC NULLS LAST
           )
           SELECT c.id, c.delivery_start_date, c.delivery_end_date
           FROM contracts c
           LEFT JOIN latest_spd l ON l.contract_number = c.contract_id
           WHERE trim(upper(COALESCE(l.contract_ext_no, ''))) = trim(upper($1::text))
           LIMIT 1`,
          [contractExtNo],
        );

        if (contractDirectRes.rows.length === 0) {
          opFailures.push({
            contract_ext_no: contractExtNo,
            rowNumbers,
            reason: 'Contract Ext No not found in SAP data. Ensure SAP data has been imported for this contract.',
          });
          continue;
        }

        // Contract found (no existing trucking op yet) — proceed with creation
        const contract = contractDirectRes.rows[0];
        try {
          const ok = await createTruckingFromGroup(contract, contractExtNo, groupLines, rowNumbers, rowParseFailures, opFailures);
          if (ok) { operationsCreated++; rowsSucceeded += groupLines.length; }
        } catch (err) {
          logger.error('createTruckingFromGroup error:', err);
          opFailures.push({ contract_ext_no: contractExtNo, rowNumbers, reason: 'Internal error creating trucking operation' });
        }
        continue;
      }

      const contract = contractRes.rows[0];
      try {
        const ok = await createTruckingFromGroup(contract, contractExtNo, groupLines, rowNumbers, rowParseFailures, opFailures);
        if (ok) { operationsCreated++; rowsSucceeded += groupLines.length; }
      } catch (err) {
        logger.error('createTruckingFromGroup error:', err);
        opFailures.push({ contract_ext_no: contractExtNo, rowNumbers, reason: 'Internal error creating trucking operation' });
      }
    }

    const processedRows = lines.length + rowParseFailures.length;

    return res.json({
      success: true,
      data: {
        processedRows,
        operationsCreated,
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

async function createTruckingFromGroup(
  contract: { id: string; delivery_start_date?: unknown; delivery_end_date?: unknown },
  contractExtNo: string,
  groupLines: { lineNumber: number; contract_ext_no: string; dateRaw: unknown; qtyRaw: unknown }[],
  rowNumbers: number[],
  rowParseFailures: { rowNumber: number; contract_ext_no: string; reason: string }[],
  opFailures: { contract_ext_no: string; rowNumbers: number[]; reason: string }[],
): Promise<boolean> {
  // Parse daily deliverables from the group rows
  const dailyRows: { date: string; quantity_delivered: number }[] = [];
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
    dailyRows.push({ date: ds, quantity_delivered: qty });
  }

  if (dailyRows.length === 0) {
    opFailures.push({ contract_ext_no: contractExtNo, rowNumbers, reason: 'No valid date/qty rows after parsing' });
    return false;
  }

  const dmy = formatDDMMYYYY(new Date());
  const seq = await allocateNextSyntheticSequenceDefault('trucking_operations', 'LAND', dmy);
  const operationId = buildSyntheticOperationId('LAND', dmy, seq);

  const sortedDates = dailyRows.map((r) => r.date).sort();
  const minDate = sortedDates[0];
  const maxDate = sortedDates[sortedDates.length - 1];

  // Use toIsoDate10FromCell to handle both Date objects and ISO strings from pg
  const etaStart = contract.delivery_start_date
    ? (toIsoDate10FromCell(contract.delivery_start_date) ?? minDate)
    : minDate;
  const etaEnd = contract.delivery_end_date
    ? (toIsoDate10FromCell(contract.delivery_end_date) ?? maxDate)
    : maxDate;

  await query(
    `INSERT INTO trucking_operations (
       contract_id, operation_id,
       eta_delivery_start_date, eta_delivery_end_date,
       status, daily_deliverables
     ) VALUES (
       $1::uuid, $2,
       $3::date, $4::date,
       $5, $6::jsonb
     )`,
    [
      contract.id,
      operationId,
      etaStart,
      etaEnd,
      'PLANNED',
      JSON.stringify(dailyRows),
    ],
  );
  return true;
}

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
