import { Response } from 'express';
import * as XLSX from 'xlsx';
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
        UPPER(COALESCE(c.status, '')) IN ('OPEN', 'ACTIVE')
        AND UPPER(COALESCE(c.transport_mode, '')) = 'LAND'
        AND (
          COALESCE(l.contract_ext_no, '') ILIKE $1
          OR c.contract_id ILIKE $1
          OR COALESCE(c.po_number, '') ILIKE $1
        )
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

export const getTruckingOperations = async (req: AuthRequest, res: Response) => {
  try {
    const { status, location, loadingLocation, unloadingLocation, dateFrom, dateTo, sto, contract, page = 1, limit = 10 } = req.query;
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
        COALESCE(
          t.trucking_start_date,
          (
            SELECT (
              CASE
                WHEN trim(v.val) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN trim(v.val)::date
                WHEN trim(v.val) ~ '^[0-9]{1,2}/[0-9]{1,2}/[0-9]{2}$' THEN to_date(trim(v.val), 'MM/DD/YY')
                ELSE NULL
              END
            )
            FROM (
              SELECT COALESCE(
                spd.data->'raw'->>'Trucking Start Receive Date',
                spd.data->>'Trucking Start Receive Date'
              ) AS val
              FROM sap_processed_data spd
              WHERE spd.contract_number = c.contract_id
              ORDER BY spd.created_at DESC NULLS LAST
              LIMIT 1
            ) v
            WHERE v.val IS NOT NULL AND length(trim(v.val)) >= 6
          )
        ) AS trucking_start_date,
        COALESCE(
          t.trucking_completion_date,
          (
            SELECT (
              CASE
                WHEN trim(v.val) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN trim(v.val)::date
                WHEN trim(v.val) ~ '^[0-9]{1,2}/[0-9]{1,2}/[0-9]{2}$' THEN to_date(trim(v.val), 'MM/DD/YY')
                ELSE NULL
              END
            )
            FROM (
              SELECT COALESCE(
                spd.data->'raw'->>'Trucking Last Receive Date',
                spd.data->>'Trucking Last Receive Date'
              ) AS val
              FROM sap_processed_data spd
              WHERE spd.contract_number = c.contract_id
              ORDER BY spd.created_at DESC NULLS LAST
              LIMIT 1
            ) v
            WHERE v.val IS NOT NULL AND length(trim(v.val)) >= 6
          )
        ) AS trucking_completion_date,
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
      queryText += ` AND t.status = $${paramIndex}`;
      queryParams.push(status);
      paramIndex++;
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
        COUNT(*) FILTER (WHERE status = 'PLANNED')::bigint AS planned_count,
        COUNT(*) FILTER (WHERE status = 'IN_PROGRESS')::bigint AS in_progress_count,
        COUNT(*) FILTER (WHERE status = 'LOADING')::bigint AS loading_count,
        COUNT(*) FILTER (WHERE status = 'IN_TRANSIT')::bigint AS in_transit_count,
        COUNT(*) FILTER (WHERE status = 'UNLOADING')::bigint AS unloading_count,
        COUNT(*) FILTER (WHERE status = 'COMPLETED')::bigint AS completed_count,
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
      status,
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

    // Generate operation_id if not provided
    const finalOperationId = operation_id || `TRUCK-${Date.now()}`;

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
        status || 'PLANNED',
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
        c.product,
        c.group_name,
        c.quantity_ordered
      FROM matched c
      LEFT JOIN latest_spd l ON l.contract_number = c.contract_id
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
    const cur = currentRes.rows[0];

    const dd = normalizeAndValidateDailyDeliverables({
      daily_deliverables,
      startRaw: cur.delivery_start_date ?? cur.trucking_start_date,
      endRaw: cur.delivery_end_date ?? cur.trucking_completion_date,
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

function parsePlanningSheetToMatrix(buffer: Buffer): string[][] {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const name = wb.SheetNames[0];
  if (!name) {
    throw new Error('The file has no worksheets');
  }
  const ws = wb.Sheets[name];
  const matrix = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false }) as unknown[][];
  return matrix
    .map((row) => row.map((c) => (c === null || c === undefined ? '' : String(c))))
    .filter((row) => row.some((c) => String(c).trim() !== ''));
}

function toIsoDate10FromCell(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    return raw.toISOString().slice(0, 10);
  }
  // Excel serial date (days since 1899-12-30)
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 20000 && raw < 120000) {
    const epoch = new Date(Date.UTC(1899, 11, 30));
    const d = new Date(epoch.getTime() + Math.round(raw) * 86400000);
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  const s = String(raw).trim();
  if (!s) return null;
  // DD/MM/YYYY (as used in templates / Indonesia UX)
  const dmy = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
  if (dmy) {
    const dd = Number(dmy[1]);
    const mm = Number(dmy[2]);
    const yyyy = Number(dmy[3]);
    if (dd >= 1 && dd <= 31 && mm >= 1 && mm <= 12) {
      const d = new Date(Date.UTC(yyyy, mm - 1, dd));
      if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    }
    return null;
  }
  const ymd = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (ymd) return s.slice(0, 10);
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
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

    let matrix: string[][];
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
      const dateToLastLine = new Map<string, { quantity_delivered: number }>();
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
        dateToLastLine.set(iso, { quantity_delivered: qn });
        validRowLines += 1;
      }

      if (dateToLastLine.size === 0) {
        continue;
      }

      const dailyDeliverables = Array.from(dateToLastLine.entries())
        .map(([date, v]) => ({
          date,
          quantity_delivered: v.quantity_delivered,
        }))
        .sort((a, b) => a.date.localeCompare(b.date));

      const opRes = await query(
        `SELECT t.id,
                t.operation_id,
                c.delivery_start_date,
                c.delivery_end_date,
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

      const cur = opRes.rows[0];
      const dd = normalizeAndValidateDailyDeliverables({
        daily_deliverables: dailyDeliverables,
        startRaw: cur.delivery_start_date ?? cur.trucking_start_date,
        endRaw: cur.delivery_end_date ?? cur.trucking_completion_date,
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
      rowsAccountedSuccess += validRowLines;
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
