import { Response } from 'express';
import { query } from '../database/connection';
import { AuthRequest } from '../middleware/auth';
import logger from '../utils/logger';

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
        t.trucking_start_date,
        t.trucking_completion_date,
        t.eta_trucking_start_date,
        t.eta_trucking_completion_date,
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
        s.estimated_km
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
      quantity_sent,
      quantity_delivered,
      gain_loss_percentage,
      gain_loss_amount,
      oa_budget,
      oa_actual,
      status
    } = req.body;

    // Validate required fields
    if (!contract_number) {
      return res.status(400).json({
        success: false,
        error: { message: 'Contract number is required' },
      });
    }

    // Check if contract exists
    const contractResult = await query(
      `SELECT id FROM contracts WHERE contract_id = $1 LIMIT 1`,
      [contract_number]
    );

    if (contractResult.rows.length === 0) {
      return res.status(400).json({
        success: false,
        error: { message: 'Contract number does not exist' },
      });
    }

    const contractId = contractResult.rows[0].id;

    // Generate operation_id if not provided
    const finalOperationId = operation_id || `TRUCK-${Date.now()}`;

    // Insert new trucking operation
    const result = await query(
      `INSERT INTO trucking_operations (
        contract_id, operation_id, location, loading_location, unloading_location,
        trucking_owner, cargo_readiness_date,
        trucking_start_date, trucking_completion_date,
        eta_trucking_start_date, eta_trucking_completion_date,
        quantity_sent, quantity_delivered,
        gain_loss_percentage, gain_loss_amount, oa_budget, oa_actual, status
      ) VALUES (
        $1::uuid, $2, $3, $4, $5, $6, $7::date,
        $8::date, $9::date,
        $10::date, $11::date,
        $12::numeric, $13::numeric, $14::numeric,
        $15::numeric, $16::numeric, $17
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
        quantity_sent || null,
        quantity_delivered || null,
        gain_loss_percentage || null,
        gain_loss_amount || null,
        oa_budget || null,
        oa_actual || null,
        status || 'PLANNED'
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

    const result = await query(
      `SELECT id, contract_id, sto_number, supplier, product, group_name, quantity_ordered 
       FROM contracts 
       WHERE contract_id = $1 LIMIT 1`,
      [contract_number]
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

    // Validate required fields
    if (!updateData.operation_id) {
      return res.status(400).json({
        success: false,
        error: { message: 'Operation ID is required' },
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
      'eta_trucking_start_date', 'eta_trucking_completion_date',
      'quantity_sent', 'quantity_delivered', 'gain_loss_percentage',
      'gain_loss_amount', 'oa_budget', 'oa_actual', 'status'
    ];

    // Date fields that need casting
    const dateFields = [
      'cargo_readiness_date',
      'trucking_start_date', 'trucking_completion_date',
      'eta_trucking_start_date', 'eta_trucking_completion_date'
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
