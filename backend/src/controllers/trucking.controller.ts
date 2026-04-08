import { Response } from 'express';
import { query } from '../database/connection';
import { AuthRequest } from '../middleware/auth';
import logger from '../utils/logger';
import { normalizeAndValidateDailyDeliverables } from '../utils/truckingDailyDeliverables';

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
        t.quantity_sent,
        t.quantity_delivered,
        t.gain_loss_percentage,
        t.gain_loss_amount,
        t.oa_budget,
        t.oa_actual,
        t.status,
        t.created_at,
        t.updated_at,
        c.contract_id as contract_number,
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
        (SELECT COALESCE(
                  spd.data->'raw'->>'Contract Ext No',
                  spd.data->>'Contract Ext No'
                )
         FROM sap_processed_data spd
         WHERE spd.contract_number = c.contract_id
         ORDER BY spd.created_at DESC NULLS LAST
         LIMIT 1) AS contract_ext_no
      FROM trucking_operations t
      LEFT JOIN contracts c ON t.contract_id = c.id
      LEFT JOIN shipments s ON t.shipment_id = s.id
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

    if (dateFrom) {
      queryText += ` AND t.trucking_start_date >= $${paramIndex}`;
      queryParams.push(dateFrom);
      paramIndex++;
    }

    if (dateTo) {
      queryText += ` AND t.trucking_start_date <= $${paramIndex}`;
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

    queryText += ` ORDER BY t.created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    queryParams.push(Number(limit), offset);

    const result = await query(queryText, queryParams);

    let countQuery = `
      SELECT COUNT(*) as count
      FROM trucking_operations t
      LEFT JOIN contracts c ON t.contract_id = c.id
      LEFT JOIN shipments s ON t.shipment_id = s.id
      WHERE 1=1
    `;
    const countParams: any[] = [];
    let countParamIndex = 1;

    if (status) {
      countQuery += ` AND t.status = $${countParamIndex}`;
      countParams.push(status);
      countParamIndex++;
    }

    if (location) {
      countQuery += ` AND t.location ILIKE $${countParamIndex}`;
      countParams.push(`%${location}%`);
      countParamIndex++;
    }

    if (dateFrom) {
      countQuery += ` AND t.trucking_start_date >= $${countParamIndex}`;
      countParams.push(dateFrom);
      countParamIndex++;
    }

    if (dateTo) {
      countQuery += ` AND t.trucking_start_date <= $${countParamIndex}`;
      countParams.push(dateTo);
      countParamIndex++;
    }

    if (sto) {
      countQuery += ` AND c.sto_number = $${countParamIndex}`;
      countParams.push(sto);
      countParamIndex++;
    }

    if (contract) {
      countQuery += ` AND c.contract_id = $${countParamIndex}`;
      countParams.push(contract);
      countParamIndex++;
    }

    const countResult = await query(countQuery, countParams);

    return res.json({
      success: true,
      data: {
        truckingOperations: result.rows,
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
    const dd = normalizeAndValidateDailyDeliverables({
      daily_deliverables,
      startRaw: eta_trucking_start_date ?? trucking_start_date,
      endRaw: eta_trucking_completion_date ?? trucking_completion_date,
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
      `SELECT id, eta_trucking_start_date, eta_trucking_completion_date, trucking_start_date, trucking_completion_date, quantity_delivered, daily_deliverables
       FROM trucking_operations WHERE id = $1 LIMIT 1`,
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
      'eta_trucking_start_date', 'eta_trucking_completion_date',
      'eta_delivery_start_date', 'eta_delivery_end_date',
      'quantity_sent', 'quantity_delivered', 'gain_loss_percentage',
      'gain_loss_amount', 'oa_budget', 'oa_actual', 'status',
      'daily_deliverables'
    ];

    // Date fields that need casting
    const dateFields = [
      'cargo_readiness_date',
      'trucking_start_date', 'trucking_completion_date',
      'eta_trucking_start_date', 'eta_trucking_completion_date',
      'eta_delivery_start_date', 'eta_delivery_end_date'
    ];

    for (const [key, value] of Object.entries(updateData)) {
      if (allowedFields.includes(key)) {
        if (key === 'daily_deliverables') {
          // Validate against merged record state (updates override current).
          const dd2 = normalizeAndValidateDailyDeliverables({
            daily_deliverables: value,
            startRaw:
              (updateData.eta_trucking_start_date ?? updateData.trucking_start_date ?? cur.eta_trucking_start_date ?? cur.trucking_start_date),
            endRaw:
              (updateData.eta_trucking_completion_date ?? updateData.trucking_completion_date ?? cur.eta_trucking_completion_date ?? cur.trucking_completion_date),
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

    const result = await query(
      `
      SELECT
        t.id,
        t.operation_id,
        c.contract_id AS contract_number,
        c.po_number,
        c.supplier,
        c.product,
        c.group_name,
        t.loading_location,
        t.unloading_location,
        t.trucking_owner,
        t.eta_trucking_start_date,
        t.eta_trucking_completion_date,
        t.trucking_start_date,
        t.trucking_completion_date,
        t.quantity_delivered,
        t.daily_deliverables,
        t.updated_at
      FROM trucking_operations t
      LEFT JOIN contracts c ON t.contract_id = c.id
      WHERE
        -- overlap with requested window using ETA (fallback to actual trucking dates)
        COALESCE(t.eta_trucking_start_date, t.trucking_start_date) <= $2::date
        AND COALESCE(t.eta_trucking_completion_date, t.trucking_completion_date) >= $1::date
      ORDER BY COALESCE(t.eta_trucking_start_date, t.trucking_start_date) ASC NULLS LAST, t.operation_id ASC
      `,
      [from, to],
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
      `SELECT id, eta_trucking_start_date, eta_trucking_completion_date, trucking_start_date, trucking_completion_date, quantity_delivered
       FROM trucking_operations WHERE id = $1 LIMIT 1`,
      [id],
    );
    if (currentRes.rows.length === 0) {
      return res.status(404).json({ success: false, error: { message: 'Trucking operation not found' } });
    }
    const cur = currentRes.rows[0];

    const dd = normalizeAndValidateDailyDeliverables({
      daily_deliverables,
      startRaw: cur.eta_trucking_start_date ?? cur.trucking_start_date,
      endRaw: cur.eta_trucking_completion_date ?? cur.trucking_completion_date,
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
