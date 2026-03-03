import { Response } from 'express';
import { query } from '../database/connection';
import { AuthRequest } from '../middleware/auth';
import logger from '../utils/logger';

// Helper function to build filter WHERE clauses
const buildFilterConditions = (req: AuthRequest): { contractFilter: string; shipmentFilter: string; truckingFilter: string; params: any[] } => {
  const { dateFrom, dateTo, plant, supplier } = req.query;
  const params: any[] = [];
  let paramIndex = 1;
  let contractFilter = '';
  let shipmentFilter = '';
  let truckingFilter = '';

  // Contract date range filter
  if (dateFrom) {
    contractFilter += ` AND c.contract_date >= $${paramIndex}`;
    params.push(dateFrom);
    paramIndex++;
  }
  if (dateTo) {
    contractFilter += ` AND c.contract_date <= $${paramIndex}`;
    params.push(dateTo);
    paramIndex++;
  }

  // Supplier filter
  if (supplier) {
    contractFilter += ` AND c.supplier = $${paramIndex}`;
    params.push(supplier);
    paramIndex++;
  }

  // Plant/Site filter
  if (plant) {
    if (plant === 'Blank') {
      shipmentFilter = ` AND (s.port_of_discharge IS NULL OR s.port_of_discharge = '')`;
      truckingFilter = ` AND (t.location IS NULL OR t.location = '')`;
    } else {
      shipmentFilter = ` AND s.port_of_discharge = $${paramIndex}`;
      truckingFilter = ` AND t.location = $${paramIndex}`;
      params.push(plant);
      paramIndex++;
    }
  }

  return { contractFilter, shipmentFilter, truckingFilter, params };
};

export const getDashboardStats = async (req: AuthRequest, res: Response) => {
  try {
    const { contractFilter, params } = buildFilterConditions(req);
    
    // Get basic contract statistics (status derived from latest SAP data where available)
    const contractsStats = await query(`
      WITH latest_spd AS (
        SELECT DISTINCT ON (spd.contract_number)
          spd.contract_number,
          spd.data
        FROM sap_processed_data spd
        ORDER BY spd.contract_number, spd.created_at DESC NULLS LAST
      )
      SELECT 
        COUNT(DISTINCT c.contract_id) as total_contracts,
        -- Open contracts (status = Open/ACTIVE from SAP, fallback to contracts.status)
        COUNT(DISTINCT c.contract_id) FILTER (
          WHERE
            (
              l.data->'contract'->>'status' = 'Open'
              OR UPPER(l.data->'contract'->>'status') = 'ACTIVE'
            )
            OR (
              l.data IS NULL
              AND UPPER(COALESCE(c.status, '')) IN ('ACTIVE', 'OPEN')
            )
        ) as open_contracts,
        -- Closed contracts (Close/CLOSED/COMPLETED/CANCELLED from SAP, fallback to contracts.status)
        COUNT(DISTINCT c.contract_id) FILTER (
          WHERE
            (
              l.data->'contract'->>'status' = 'Close'
              OR UPPER(l.data->'contract'->>'status') IN ('CLOSE', 'CLOSED', 'COMPLETED', 'CANCELLED')
            )
            OR (
              l.data IS NULL
              AND UPPER(COALESCE(c.status, '')) IN ('CLOSE', 'CLOSED', 'COMPLETED', 'CANCELLED')
            )
        ) as closed_contracts
      FROM contracts c
      LEFT JOIN latest_spd l ON l.contract_number = c.contract_id
      WHERE 1=1 ${contractFilter}
    `, params);

    // Quantity statistics across all contracts
    // Total Quantity = sum of contract quantities
    // Quantity Delivered = sum of STO quantities from sap_processed_data
    // Outstanding Quantity = Total Quantity - Quantity Delivered
    const outstandingStats = await query(`
      SELECT 
        COALESCE(SUM(contract_quantity), 0) as total_quantity,
        COALESCE(SUM(delivered_quantity), 0) as delivered_quantity,
        COALESCE(SUM(contract_quantity - delivered_quantity), 0) as outstanding_quantity
      FROM (
        SELECT 
          c.contract_id,
          MAX(c.quantity_ordered) as contract_quantity,
          COALESCE((
            SELECT SUM(CAST(REPLACE(REPLACE(spd.data->'contract'->>'sto_quantity', ',', ''), ' ', '') AS NUMERIC))
            FROM sap_processed_data spd
            WHERE spd.contract_number = c.contract_id 
              AND spd.data->'contract'->>'sto_quantity' IS NOT NULL
          ), 0) as delivered_quantity
        FROM contracts c
        WHERE 1=1 ${contractFilter}
        GROUP BY c.contract_id
      ) q
    `, params);

    // Get shipment statistics by status
    const shipmentsStats = await query(`
      SELECT 
        COUNT(*) as total_shipments,
        COUNT(*) FILTER (WHERE s.status = 'PLANNED') as planned_shipments,
        COUNT(*) FILTER (WHERE s.status = 'IN_PROGRESS') as in_progress_shipments,
        COUNT(*) FILTER (WHERE s.status = 'LOADING') as loading_shipments,
        COUNT(*) FILTER (WHERE s.status = 'IN_TRANSIT') as in_transit_shipments,
        COUNT(*) FILTER (WHERE s.status = 'ARRIVED') as arrived_shipments,
        COUNT(*) FILTER (WHERE s.status = 'UNLOADING') as unloading_shipments,
        COUNT(*) FILTER (WHERE s.status = 'COMPLETED') as completed_shipments,
        COUNT(*) FILTER (WHERE s.status = 'CANCELLED') as cancelled_shipments,
        COUNT(*) FILTER (WHERE s.is_delayed = true) as late_shipments
      FROM shipments s
      LEFT JOIN contracts c ON s.contract_id = c.id
      WHERE 1=1 ${contractFilter} ${req.query.plant ? buildFilterConditions(req).shipmentFilter : ''}
    `, params);

    // Get trucking operations statistics by status
    const truckingStats = await query(`
      SELECT 
        COUNT(*) as total_trucking_operations,
        COUNT(*) FILTER (WHERE t.status = 'PLANNED') as planned_trucking_operations,
        COUNT(*) FILTER (WHERE t.status = 'IN_PROGRESS') as in_progress_trucking_operations,
        COUNT(*) FILTER (WHERE t.status = 'LOADING') as loading_trucking_operations,
        COUNT(*) FILTER (WHERE t.status = 'IN_TRANSIT') as in_transit_trucking_operations,
        COUNT(*) FILTER (WHERE t.status = 'UNLOADING') as unloading_trucking_operations,
        COUNT(*) FILTER (WHERE t.status = 'COMPLETED') as completed_trucking_operations,
        COUNT(*) FILTER (WHERE t.status = 'CANCELLED') as cancelled_trucking_operations,
        COUNT(*) FILTER (WHERE t.status = 'LATE') as late_trucking_operations
      FROM trucking_operations t
      LEFT JOIN contracts c ON t.contract_id = c.id
      WHERE 1=1 ${contractFilter} ${req.query.plant ? buildFilterConditions(req).truckingFilter : ''}
    `, params);

    // Get finance statistics (counts and amounts aligned with Finance page)
    const financeStats = await query(`
      SELECT 
        COUNT(*) as total_payments,
        COUNT(*) FILTER (WHERE p.payment_status = 'PENDING' AND (p.payment_due_date IS NULL OR p.payment_due_date >= CURRENT_DATE)) as pending_payments,
        COUNT(*) FILTER (WHERE p.payment_status = 'PAID') as paid_payments,
        COUNT(*) FILTER (WHERE p.payment_status = 'OVERDUE' OR (p.payment_status = 'PENDING' AND p.payment_due_date IS NOT NULL AND p.payment_due_date < CURRENT_DATE)) as overdue_payments,
        COALESCE(SUM(p.payment_amount), 0) as total_amount,
        COALESCE(SUM(p.payment_amount) FILTER (WHERE p.payment_status = 'PENDING' AND (p.payment_due_date IS NULL OR p.payment_due_date >= CURRENT_DATE)), 0) as pending_amount,
        COALESCE(SUM(p.payment_amount) FILTER (WHERE p.payment_status = 'PAID'), 0) as paid_amount,
        COALESCE(SUM(p.payment_amount) FILTER (WHERE p.payment_status = 'OVERDUE' OR (p.payment_status = 'PENDING' AND p.payment_due_date IS NOT NULL AND p.payment_due_date < CURRENT_DATE)), 0) as overdue_amount
      FROM payments p
      LEFT JOIN contracts c ON p.contract_id = c.id
      WHERE 1=1 ${contractFilter}
    `, params);

    const stats = {
      contracts: {
        total: parseInt(contractsStats.rows[0].total_contracts) || 0,
        // Active/Open contracts
        active: parseInt(contractsStats.rows[0].open_contracts) || 0,
        // Closed contracts (Close / Closed / Completed / Cancelled)
        closed: parseInt(contractsStats.rows[0].closed_contracts) || 0,
        completed: 0,
        cancelled: 0,
        // Outstanding contracts count = Open contracts
        outstanding: parseInt(contractsStats.rows[0].open_contracts) || 0,
        // Quantity performance metrics
        totalQuantity: parseFloat(outstandingStats.rows[0].total_quantity) || 0,
        deliveredQuantity: parseFloat(outstandingStats.rows[0].delivered_quantity) || 0,
        outstandingQuantity: parseFloat(outstandingStats.rows[0].outstanding_quantity) || 0
      },
      shipments: {
        total: parseInt(shipmentsStats.rows[0].total_shipments) || 0,
        planned: parseInt(shipmentsStats.rows[0].planned_shipments) || 0,
        inProgress: parseInt(shipmentsStats.rows[0].in_progress_shipments) || 0,
        loading: parseInt(shipmentsStats.rows[0].loading_shipments) || 0,
        inTransit: parseInt(shipmentsStats.rows[0].in_transit_shipments) || 0,
        arrived: parseInt(shipmentsStats.rows[0].arrived_shipments) || 0,
        unloading: parseInt(shipmentsStats.rows[0].unloading_shipments) || 0,
        completed: parseInt(shipmentsStats.rows[0].completed_shipments) || 0,
        cancelled: parseInt(shipmentsStats.rows[0].cancelled_shipments) || 0,
        late: parseInt(shipmentsStats.rows[0].late_shipments) || 0
      },
      trucking: {
        total: parseInt(truckingStats.rows[0].total_trucking_operations) || 0,
        planned: parseInt(truckingStats.rows[0].planned_trucking_operations) || 0,
        inProgress: parseInt(truckingStats.rows[0].in_progress_trucking_operations) || 0,
        loading: parseInt(truckingStats.rows[0].loading_trucking_operations) || 0,
        inTransit: parseInt(truckingStats.rows[0].in_transit_trucking_operations) || 0,
        unloading: parseInt(truckingStats.rows[0].unloading_trucking_operations) || 0,
        completed: parseInt(truckingStats.rows[0].completed_trucking_operations) || 0,
        cancelled: parseInt(truckingStats.rows[0].cancelled_trucking_operations) || 0,
        late: parseInt(truckingStats.rows[0].late_trucking_operations) || 0
      },
      finance: {
        total: parseInt(financeStats.rows[0].total_payments) || 0,
        pending: parseInt(financeStats.rows[0].pending_payments) || 0,
        paid: parseInt(financeStats.rows[0].paid_payments) || 0,
        overdue: parseInt(financeStats.rows[0].overdue_payments) || 0,
        totalAmount: parseFloat(financeStats.rows[0].total_amount) || 0,
        pendingAmount: parseFloat(financeStats.rows[0].pending_amount) || 0,
        paidAmount: parseFloat(financeStats.rows[0].paid_amount) || 0,
        overdueAmount: parseFloat(financeStats.rows[0].overdue_amount) || 0,
        revenue: parseFloat(financeStats.rows[0].paid_amount) || 0
      }
    };

    return res.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    logger.error('Get dashboard stats error:', error);
    const message =
      error instanceof Error
        ? error.message
        : (error as any)?.message || 'Failed to fetch dashboard statistics';
    return res.status(500).json({
      success: false,
      error: { message },
    });
  }
};

export const getTopSuppliers = async (req: AuthRequest, res: Response) => {
  try {
    const { contractFilter, params } = buildFilterConditions(req);
    
    const result = await query(`
      SELECT 
        c.supplier,
        COUNT(DISTINCT c.contract_id) as contract_count,
        SUM(c.quantity_ordered) as total_quantity,
        AVG(c.unit_price) as avg_unit_price,
        SUM(c.contract_value) as total_contract_value
      FROM contracts c
      WHERE c.supplier IS NOT NULL AND c.supplier != '' ${contractFilter}
      GROUP BY c.supplier
      ORDER BY total_quantity DESC
      LIMIT 5
    `, params);

    return res.json({
      success: true,
      data: result.rows,
    });
  } catch (error) {
    logger.error('Get top suppliers error:', error);
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch top suppliers' },
    });
  }
};

export const getTopTruckingOwners = async (req: AuthRequest, res: Response) => {
  try {
    const { contractFilter, truckingFilter, params } = buildFilterConditions(req);
    
    const result = await query(`
      SELECT 
        t.trucking_owner,
        COUNT(*) as operation_count,
        SUM(t.quantity_sent) as total_quantity_sent,
        SUM(t.quantity_delivered) as total_quantity_delivered,
        AVG(t.gain_loss_percentage) as avg_gain_loss_percentage,
        SUM(t.oa_actual) as total_oa_actual
      FROM trucking_operations t
      LEFT JOIN contracts c ON t.contract_id = c.id
      WHERE t.trucking_owner IS NOT NULL AND t.trucking_owner != '' ${contractFilter} ${truckingFilter}
      GROUP BY t.trucking_owner
      ORDER BY total_quantity_sent DESC
      LIMIT 5
    `, params);

    return res.json({
      success: true,
      data: result.rows,
    });
  } catch (error) {
    logger.error('Get top trucking owners error:', error);
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch top trucking owners' },
    });
  }
};

export const getTopVessels = async (req: AuthRequest, res: Response) => {
  try {
    const { contractFilter, shipmentFilter, params } = buildFilterConditions(req);
    
    const result = await query(`
      SELECT 
        s.vessel_name,
        COUNT(*) as shipment_count,
        SUM(s.quantity_shipped) as total_quantity_shipped,
        SUM(s.quantity_delivered) as total_quantity_delivered,
        AVG(s.gain_loss_percentage) as avg_gain_loss_percentage,
        COUNT(*) FILTER (WHERE s.is_delayed = true) as delayed_count
      FROM shipments s
      LEFT JOIN contracts c ON s.contract_id = c.id
      WHERE s.vessel_name IS NOT NULL AND s.vessel_name != '' ${contractFilter} ${shipmentFilter}
      GROUP BY s.vessel_name
      ORDER BY total_quantity_shipped DESC
      LIMIT 5
    `, params);

    return res.json({
      success: true,
      data: result.rows,
    });
  } catch (error) {
    logger.error('Get top vessels error:', error);
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch top vessels' },
    });
  }
};

export const getContractsByStatus = async (req: AuthRequest, res: Response) => {
  try {
    const { status } = req.query as { status?: string };
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 100;

    const { contractFilter, params } = buildFilterConditions(req);
    let paramIndex = params.length + 1;

    let queryText = `
      SELECT 
        c.contract_id,
        c.supplier,
        c.buyer,
        c.product,
        c.quantity_ordered,
        c.unit,
        c.contract_value,
        c.currency,
        c.status,
        c.contract_date,
        c.delivery_start_date,
        c.delivery_end_date
      FROM contracts c
      WHERE 1=1 ${contractFilter}
    `;
    const finalParams: any[] = [...params];

    if (status) {
      queryText += ` AND c.status = $${paramIndex}`;
      finalParams.push(status);
      paramIndex++;
    }

    queryText += ` ORDER BY c.contract_date DESC LIMIT $${paramIndex}`;
    finalParams.push(limit);

    const result = await query(queryText, finalParams);

    return res.json({
      success: true,
      data: result.rows,
    });
  } catch (error) {
    logger.error('Get contracts by status error:', error);
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch contracts' },
    });
  }
};

export const getShipmentsByStatus = async (req: AuthRequest, res: Response) => {
  try {
    const { status, delayed } = req.query as { status?: string; delayed?: string };
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 100;

    // Reuse dashboard filter conditions
    const { contractFilter, shipmentFilter, params } = buildFilterConditions(req);
    let paramIndex = params.length + 1;

    let queryText = `
      SELECT 
        s.shipment_id,
        s.vessel_name,
        s.status,
        s.quantity_shipped,
        s.quantity_delivered,
        s.port_of_loading,
        s.port_of_discharge,
        s.is_delayed,
        c.contract_id,
        c.supplier,
        c.product
      FROM shipments s
      LEFT JOIN contracts c ON s.contract_id = c.id
      WHERE 1=1 ${contractFilter} ${shipmentFilter}
    `;

    const finalParams: any[] = [...params];

    if (status) {
      queryText += ` AND s.status = $${paramIndex}`;
      finalParams.push(status);
      paramIndex++;
    }

    if (delayed === 'true') {
      queryText += ` AND s.is_delayed = true`;
    }

    queryText += ` ORDER BY s.created_at DESC LIMIT $${paramIndex}`;
    finalParams.push(limit);

    const result = await query(queryText, finalParams);

    return res.json({
      success: true,
      data: result.rows,
    });
  } catch (error) {
    logger.error('Get shipments by status error:', error);
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch shipments' },
    });
  }
};

export const getTruckingOperationsByStatus = async (req: AuthRequest, res: Response) => {
  try {
    const { status } = req.query;
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 10;

    let queryText = `
      SELECT 
        t.operation_id,
        t.location,
        t.trucking_owner,
        t.status,
        t.quantity_sent,
        t.quantity_delivered,
        t.gain_loss_percentage,
        c.contract_id,
        c.supplier,
        c.product
      FROM trucking_operations t
      LEFT JOIN contracts c ON t.contract_id = c.id
      WHERE 1=1
    `;
    const params: any[] = [];
    let paramIndex = 1;

    if (status) {
      queryText += ` AND t.status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }

    queryText += ` ORDER BY t.created_at DESC LIMIT $${paramIndex}`;
    params.push(limit);

    const result = await query(queryText, params);

    return res.json({
      success: true,
      data: result.rows,
    });
  } catch (error) {
    logger.error('Get trucking operations by status error:', error);
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch trucking operations' },
    });
  }
};

// Get contract quantity by product materials
export const getContractQuantityByProduct = async (req: AuthRequest, res: Response) => {
  try {
    const { contractFilter, params } = buildFilterConditions(req);
    
    const result = await query(`
      SELECT 
        product,
        contract_count,
        total_quantity,
        completed_quantity,
        total_quantity - completed_quantity as outstanding_quantity,
        avg_unit_price,
        total_contract_value,
        supplier_count
      FROM (
        SELECT 
          c.product,
          COUNT(DISTINCT c.contract_id) as contract_count,
          SUM(c.quantity_ordered) as total_quantity,
          COALESCE((
            SELECT SUM(CAST(REPLACE(REPLACE(s.data->'contract'->>'sto_quantity', ',', ''), ' ', '') AS NUMERIC))
            FROM sap_processed_data s
            WHERE s.product = c.product
            AND s.sto_number IS NOT NULL 
            AND s.data->'contract'->>'sto_quantity' IS NOT NULL
          ), 0) as completed_quantity,
          AVG(c.unit_price) as avg_unit_price,
          SUM(c.contract_value) as total_contract_value,
          COUNT(DISTINCT c.supplier) as supplier_count
        FROM contracts c
        WHERE c.product IS NOT NULL AND c.product != '' ${contractFilter}
        GROUP BY c.product
      ) product_data
      ORDER BY total_quantity DESC
      LIMIT 10
    `, params);

    return res.json({
      success: true,
      data: result.rows,
    });
  } catch (error) {
    logger.error('Get contract quantity by product error:', error);
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch contract quantity by product' },
    });
  }
};

// Get contract quantity by Incoterm (same logic pattern as product, but grouped by incoterm)
export const getContractQuantityByIncoterm = async (req: AuthRequest, res: Response) => {
  try {
    const { contractFilter, params } = buildFilterConditions(req);

    const result = await query(`
      SELECT
        incoterm,
        contract_count,
        total_quantity,
        completed_quantity,
        total_quantity - completed_quantity AS outstanding_quantity,
        avg_unit_price,
        total_contract_value,
        supplier_count
      FROM (
        SELECT
          COALESCE(c.incoterm, 'Blank') AS incoterm,
          COUNT(DISTINCT c.contract_id) AS contract_count,
          SUM(c.quantity_ordered) AS total_quantity,
          -- Sum of STO quantities from SAP data for all contracts under this incoterm
          SUM(
            COALESCE((
              SELECT SUM(CAST(REPLACE(REPLACE(spd.data->'contract'->>'sto_quantity', ',', ''), ' ', '') AS NUMERIC))
              FROM sap_processed_data spd
              WHERE spd.contract_number = c.contract_id
                AND spd.sto_number IS NOT NULL
                AND spd.data->'contract'->>'sto_quantity' IS NOT NULL
            ), 0)
          ) AS completed_quantity,
          AVG(c.unit_price) AS avg_unit_price,
          SUM(c.contract_value) AS total_contract_value,
          COUNT(DISTINCT c.supplier) AS supplier_count
        FROM contracts c
        WHERE 1=1 ${contractFilter}
        GROUP BY COALESCE(c.incoterm, 'Blank')
      ) incoterm_data
      ORDER BY total_quantity DESC
      LIMIT 10
    `, params);

    return res.json({
      success: true,
      data: result.rows,
    });
  } catch (error) {
    logger.error('Get contract quantity by incoterm error:', error);
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch contract quantity by incoterm' },
    });
  }
};

// Get contract quantity by plant (Sea/Land logic)
// Updated to use actual shipped/delivered quantities from Shipments and Trucking
export const getContractQuantityByPlant = async (req: AuthRequest, res: Response) => {
  try {
    const { contractFilter, shipmentFilter, truckingFilter, params } = buildFilterConditions(req);

    // Get quantities from Shipments (Sea transport) - using port_of_discharge as Plant/Site
    const shipmentResult = await query(`
      SELECT 
        CASE 
          WHEN s.port_of_discharge IS NULL OR s.port_of_discharge = '' THEN 'Blank'
          ELSE s.port_of_discharge
        END as plant_location,
        COUNT(DISTINCT c.contract_id) as contract_count,
        SUM(COALESCE(s.quantity_shipped, 0)) as total_quantity_shipped,
        SUM(COALESCE(s.quantity_delivered, 0)) as total_quantity_delivered,
        SUM(COALESCE(s.quantity_shipped, 0) + COALESCE(s.quantity_delivered, 0)) as total_quantity,
        SUM(c.contract_value) as total_contract_value,
        COUNT(DISTINCT c.supplier) as supplier_count
      FROM shipments s
      LEFT JOIN contracts c ON s.contract_id = c.id
      WHERE 1=1 ${contractFilter} ${shipmentFilter}
      GROUP BY 
        CASE 
          WHEN s.port_of_discharge IS NULL OR s.port_of_discharge = '' THEN 'Blank'
          ELSE s.port_of_discharge
        END
    `, params);

    // Get quantities from Trucking (Land transport) - using truck_unloading_date location as Plant/Site
    const truckingResult = await query(`
      SELECT 
        CASE 
          WHEN t.location IS NULL OR t.location = '' THEN 'Blank'
          ELSE t.location
        END as plant_location,
        COUNT(DISTINCT c.contract_id) as contract_count,
        SUM(COALESCE(t.quantity_sent, 0)) as total_quantity_shipped,
        SUM(COALESCE(t.quantity_delivered, 0)) as total_quantity_delivered,
        SUM(COALESCE(t.quantity_sent, 0) + COALESCE(t.quantity_delivered, 0)) as total_quantity,
        SUM(c.contract_value) as total_contract_value,
        COUNT(DISTINCT c.supplier) as supplier_count
      FROM trucking_operations t
      LEFT JOIN contracts c ON t.contract_id = c.id
      WHERE 1=1 ${contractFilter} ${truckingFilter}
      GROUP BY 
        CASE 
          WHEN t.location IS NULL OR t.location = '' THEN 'Blank'
          ELSE t.location
        END
    `, params);

    // Aggregate by plant_location (combine Sea + Land)
    type PlantAgg = {
      plant_location: string;
      contract_count: number;
      total_quantity_shipped: number;
      total_quantity_delivered: number;
      total_quantity: number;
      total_contract_value: number;
      supplier_count: number;
    };

    const plantMap = new Map<string, PlantAgg>();

    const addRow = (row: any) => {
      const key = row.plant_location as string;
      const existing = plantMap.get(key) || {
        plant_location: key,
        contract_count: 0,
        total_quantity_shipped: 0,
        total_quantity_delivered: 0,
        total_quantity: 0,
        total_contract_value: 0,
        supplier_count: 0,
      };

      existing.contract_count += parseInt(row.contract_count) || 0;
      existing.total_quantity_shipped += parseFloat(row.total_quantity_shipped) || 0;
      existing.total_quantity_delivered += parseFloat(row.total_quantity_delivered) || 0;
      existing.total_quantity += parseFloat(row.total_quantity) || 0;
      existing.total_contract_value += parseFloat(row.total_contract_value) || 0;
      existing.supplier_count += parseInt(row.supplier_count) || 0;

      plantMap.set(key, existing);
    };

    shipmentResult.rows.forEach(addRow);
    truckingResult.rows.forEach(addRow);

    let combined = Array.from(plantMap.values()).map(p => ({
      plant_location: p.plant_location,
      contract_count: p.contract_count,
      total_quantity: p.total_quantity,
      total_quantity_shipped: p.total_quantity_shipped,
      total_quantity_delivered: p.total_quantity_delivered,
      // Derive avg_unit_price from totals where possible
      avg_unit_price: p.total_quantity > 0 ? p.total_contract_value / p.total_quantity : 0,
      total_contract_value: p.total_contract_value,
      supplier_count: p.supplier_count,
    }));

    // Sort by total_quantity descending and limit to top 10
    combined.sort((a, b) => b.total_quantity - a.total_quantity);
    const topPlants = combined.slice(0, 10);

    return res.json({
      success: true,
      data: topPlants,
    });
  } catch (error) {
    logger.error('Get contract quantity by plant error:', error);
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch contract quantity by plant' },
    });
  }
};

// Get detailed contract information for a specific plant
export const getPlantDetails = async (req: AuthRequest, res: Response) => {
  try {
    const { plant } = req.query;

    if (!plant) {
      return res.status(400).json({
        success: false,
        error: { message: 'Plant location is required' },
      });
    }

    let shipmentsResult;
    let truckingResult;

    if (plant === 'Blank') {
      // For blank plant locations, get records where port_of_discharge/location is NULL or empty
      shipmentsResult = await query(`
        SELECT 
          c.contract_id,
          c.sto_number,
          c.supplier,
          c.product,
          COALESCE(s.quantity_shipped, 0) as quantity_shipped,
          COALESCE(s.quantity_delivered, 0) as quantity_delivered,
          COALESCE(s.quantity_shipped, 0) + COALESCE(s.quantity_delivered, 0) as total_quantity,
          COALESCE(s.status, 'UNKNOWN') as status
        FROM shipments s
        LEFT JOIN contracts c ON s.contract_id = c.id
        WHERE s.port_of_discharge IS NULL OR s.port_of_discharge = ''
        ORDER BY c.contract_id
      `);

      truckingResult = await query(`
        SELECT 
          c.contract_id,
          c.sto_number,
          c.supplier,
          c.product,
          COALESCE(t.quantity_sent, 0) as quantity_shipped,
          COALESCE(t.quantity_delivered, 0) as quantity_delivered,
          COALESCE(t.quantity_sent, 0) + COALESCE(t.quantity_delivered, 0) as total_quantity,
          COALESCE(t.status, 'UNKNOWN') as status
        FROM trucking_operations t
        LEFT JOIN contracts c ON t.contract_id = c.id
        WHERE t.location IS NULL OR t.location = ''
        ORDER BY c.contract_id
      `);
    } else {
      shipmentsResult = await query(`
        SELECT 
          c.contract_id,
          c.sto_number,
          c.supplier,
          c.product,
          COALESCE(s.quantity_shipped, 0) as quantity_shipped,
          COALESCE(s.quantity_delivered, 0) as quantity_delivered,
          COALESCE(s.quantity_shipped, 0) + COALESCE(s.quantity_delivered, 0) as total_quantity,
          COALESCE(s.status, 'UNKNOWN') as status
        FROM shipments s
        LEFT JOIN contracts c ON s.contract_id = c.id
        WHERE s.port_of_discharge = $1
        ORDER BY c.contract_id
      `, [plant]);

      truckingResult = await query(`
        SELECT 
          c.contract_id,
          c.sto_number,
          c.supplier,
          c.product,
          COALESCE(t.quantity_sent, 0) as quantity_shipped,
          COALESCE(t.quantity_delivered, 0) as quantity_delivered,
          COALESCE(t.quantity_sent, 0) + COALESCE(t.quantity_delivered, 0) as total_quantity,
          COALESCE(t.status, 'UNKNOWN') as status
        FROM trucking_operations t
        LEFT JOIN contracts c ON t.contract_id = c.id
        WHERE t.location = $1
        ORDER BY c.contract_id
      `, [plant]);
    }

    const resultRows = [...shipmentsResult.rows, ...truckingResult.rows];

    return res.json({
      success: true,
      data: resultRows,
    });
  } catch (error) {
    logger.error('Get plant details error:', error);
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch plant details' },
    });
  }
};

// Get detailed contract information for a specific product
export const getProductDetails = async (req: AuthRequest, res: Response) => {
  try {
    const { product } = req.query;

    if (!product) {
      return res.status(400).json({
        success: false,
        error: { message: 'Product name is required' },
      });
    }

    // Get contract details for the product including completed and outstanding quantities
    const result = await query(`
      SELECT 
        c.contract_id,
        c.sto_number,
        c.supplier,
        c.product,
        c.quantity_ordered as total_quantity,
        COALESCE((
          SELECT SUM(CAST(REPLACE(REPLACE(s.data->'contract'->>'sto_quantity', ',', ''), ' ', '') AS NUMERIC))
          FROM sap_processed_data s
          WHERE s.contract_number = c.contract_id
          AND s.sto_number IS NOT NULL 
          AND s.data->'contract'->>'sto_quantity' IS NOT NULL
        ), 0) as quantity_delivered,
        c.quantity_ordered - COALESCE((
          SELECT SUM(CAST(REPLACE(REPLACE(s.data->'contract'->>'sto_quantity', ',', ''), ' ', '') AS NUMERIC))
          FROM sap_processed_data s
          WHERE s.contract_number = c.contract_id
          AND s.sto_number IS NOT NULL 
          AND s.data->'contract'->>'sto_quantity' IS NOT NULL
        ), 0) as quantity_shipped,
        c.status
      FROM contracts c
      WHERE c.product = $1
      ORDER BY c.contract_id
    `, [product]);

    return res.json({
      success: true,
      data: result.rows,
    });
  } catch (error) {
    logger.error('Get product details error:', error);
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch product details' },
    });
  }
};

// Get detailed contract information for a specific incoterm
export const getIncotermDetails = async (req: AuthRequest, res: Response) => {
  try {
    const { incoterm } = req.query;

    if (!incoterm) {
      return res.status(400).json({
        success: false,
        error: { message: 'Incoterm is required' },
      });
    }

    const result = await query(
      `
      SELECT
        c.contract_id,
        c.sto_number,
        c.supplier,
        c.product,
        c.quantity_ordered AS total_quantity,
        COALESCE((
          SELECT SUM(CAST(REPLACE(REPLACE(s.data->'contract'->>'sto_quantity', ',', ''), ' ', '') AS NUMERIC))
          FROM sap_processed_data s
          WHERE s.contract_number = c.contract_id
            AND s.sto_number IS NOT NULL
            AND s.data->'contract'->>'sto_quantity' IS NOT NULL
        ), 0) AS quantity_delivered,
        c.quantity_ordered - COALESCE((
          SELECT SUM(CAST(REPLACE(REPLACE(s.data->'contract'->>'sto_quantity', ',', ''), ' ', '') AS NUMERIC))
          FROM sap_processed_data s
          WHERE s.contract_number = c.contract_id
            AND s.sto_number IS NOT NULL
            AND s.data->'contract'->>'sto_quantity' IS NOT NULL
        ), 0) AS quantity_shipped,
        c.status
      FROM contracts c
      WHERE COALESCE(c.incoterm, 'Blank') = $1
      ORDER BY c.contract_id
      `,
      [incoterm],
    );

    return res.json({
      success: true,
      data: result.rows,
    });
  } catch (error) {
    logger.error('Get incoterm details error:', error);
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch incoterm details' },
    });
  }
};

// Get filter options for plants
export const getFilterPlants = async (_req: AuthRequest, res: Response) => {
  try {
    // Get unique plants from both shipments and trucking operations
    const result = await query(`
      SELECT DISTINCT plant_location 
      FROM (
        SELECT 
          CASE 
            WHEN s.port_of_discharge IS NULL OR s.port_of_discharge = '' THEN 'Blank'
            ELSE s.port_of_discharge
          END as plant_location
        FROM shipments s
        UNION
        SELECT 
          CASE 
            WHEN t.location IS NULL OR t.location = '' THEN 'Blank'
            ELSE t.location
          END as plant_location
        FROM trucking_operations t
      ) plants
      WHERE plant_location IS NOT NULL
      ORDER BY plant_location
    `);

    return res.json({
      success: true,
      data: result.rows.map(row => row.plant_location),
    });
  } catch (error) {
    logger.error('Get filter plants error:', error);
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch plant filter options' },
    });
  }
};

// Get filter options for suppliers
export const getFilterSuppliers = async (_req: AuthRequest, res: Response) => {
  try {
    const result = await query(`
      SELECT DISTINCT supplier
      FROM contracts
      WHERE supplier IS NOT NULL AND supplier != ''
      ORDER BY supplier
    `);

    return res.json({
      success: true,
      data: result.rows.map(row => row.supplier),
    });
  } catch (error) {
    logger.error('Get filter suppliers error:', error);
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch supplier filter options' },
    });
  }
};

// Return contracts list respecting dashboard filters
export const getFilteredContracts = async (req: AuthRequest, res: Response) => {
  try {
    const { contractFilter, params } = buildFilterConditions(req);

    const result = await query(`
      SELECT 
        c.id,
        c.contract_id,
        c.buyer,
        c.supplier,
        c.product,
        c.quantity_ordered,
        c.unit,
        c.incoterm,
        c.loading_site,
        c.unloading_site,
        c.contract_date,
        c.delivery_start_date,
        c.delivery_end_date,
        c.contract_value,
        c.currency,
        c.status
      FROM contracts c
      WHERE 1=1 ${contractFilter}
      ORDER BY c.contract_date DESC
      LIMIT 500
    `, params);

    return res.json({ success: true, data: result.rows });
  } catch (error) {
    logger.error('Get filtered contracts error:', error);
    return res.status(500).json({ success: false, error: { message: 'Failed to get filtered contracts' } });
  }
};