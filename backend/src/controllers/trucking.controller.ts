import { Response } from 'express';
import { query } from '../database/connection';
import { AuthRequest } from '../middleware/auth';
import logger from '../utils/logger';

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
        c.sto_number,
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

    // Validate daily deliverables (if provided)
    let dailyDeliverablesJson: any[] = [];
    if (daily_deliverables != null) {
      if (!Array.isArray(daily_deliverables)) {
        return res.status(400).json({
          success: false,
          error: { message: 'daily_deliverables must be an array' },
        });
      }

      const startRaw = (eta_trucking_start_date ?? trucking_start_date) as any;
      const endRaw = (eta_trucking_completion_date ?? trucking_completion_date) as any;
      const start = startRaw ? new Date(String(startRaw)) : null;
      const end = endRaw ? new Date(String(endRaw)) : null;
      if (!start || Number.isNaN(start.getTime()) || !end || Number.isNaN(end.getTime())) {
        return res.status(400).json({
          success: false,
          error: { message: 'ETA Trucking Start/Last Receive Date are required when daily deliverables are provided' },
        });
      }

      const maxQty = quantity_delivered != null && String(quantity_delivered).trim() !== '' ? Number(quantity_delivered) : null;
      const sum = (daily_deliverables as any[]).reduce((acc, r) => acc + (Number(r?.quantity_delivered) || 0), 0);

      for (const [idx, row] of (daily_deliverables as any[]).entries()) {
        const d = String(row?.date || '').trim();
        const q = row?.quantity_delivered;
        const qn = Number(q);
        if (!d) {
          return res.status(400).json({ success: false, error: { message: `Daily deliverables row ${idx + 1}: date is required` } });
        }
        if (!Number.isFinite(qn) || qn < 0) {
          return res.status(400).json({ success: false, error: { message: `Daily deliverables row ${idx + 1}: quantity must be a valid number` } });
        }
        const dt = new Date(d);
        if (Number.isNaN(dt.getTime())) {
          return res.status(400).json({ success: false, error: { message: `Daily deliverables row ${idx + 1}: invalid date` } });
        }
        // compare by yyyy-mm-dd string (safe for date-only inputs)
        const ds = d.slice(0, 10);
        const startS = String(startRaw).slice(0, 10);
        const endS = String(endRaw).slice(0, 10);
        if (ds < startS) {
          return res.status(400).json({ success: false, error: { message: `Daily deliverables row ${idx + 1}: date cannot be before Trucking Start Receive Date` } });
        }
        if (ds > endS) {
          return res.status(400).json({ success: false, error: { message: `Daily deliverables row ${idx + 1}: date cannot be after Trucking Last Receive Date` } });
        }
        if (maxQty != null && Number.isFinite(maxQty) && qn > maxQty) {
          return res.status(400).json({ success: false, error: { message: `Daily deliverables row ${idx + 1}: quantity cannot exceed Quantity Delivered` } });
        }
        dailyDeliverablesJson.push({ date: ds, quantity_delivered: qn });
      }

      if (maxQty != null && Number.isFinite(maxQty) && sum > maxQty) {
        return res.status(400).json({ success: false, error: { message: 'Sum of daily deliverables quantity cannot exceed Quantity Delivered' } });
      }
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
        JSON.stringify(dailyDeliverablesJson)
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
      'gain_loss_amount', 'oa_budget', 'oa_actual', 'status'
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
